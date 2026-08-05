/**
 * Tool Output Cache
 *
 * The Planner AI emits *references* to tool outputs (not the raw
 * outputs) in the task contract. When a worker starts, the runtime
 * resolves these references by either:
 *  1. Returning a cached result (if the same tool+args were called
 *     earlier in the main chat or a previous sub-chat), or
 *  2. Background-fetching the output by executing the tool.
 *
 * This keeps the plan JSON small (references instead of 10k tokens
 * of documentation) while still giving the worker the full context
 * it needs.
 */

import type { ToolOutputReference } from './types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ToolOutputCache');

/*
 * ============================================================
 * Types
 * ============================================================
 */

export interface CachedToolOutput {
  /**
   * Matches the `id` field of the ToolOutputReference.
   */
  id: string;

  /**
   * The tool that produced this output.
   */
  tool: string;

  /**
   * The arguments used to produce this output.
   */
  args: Record<string, unknown>;

  /**
   * The output itself (string for text, object for structured).
   */
  output: string;

  /**
   * ISO 8601 timestamp of when this was cached.
   */
  cachedAt: string;

  /**
   * Whether this output was fetched fresh or served from cache.
   */
  source: 'cache' | 'fetched';
}

export interface ToolExecutor {
  /**
   * Executes a tool and returns its output as a string.
   */
  execute(tool: string, args: Record<string, unknown>): Promise<string>;
}

/*
 * ============================================================
 * ToolOutputCache (in-memory + persisted to IndexedDB)
 * ============================================================
 */

const CACHE_DB_NAME = 'amplify_tool_output_cache';
const CACHE_DB_VERSION = 1;
const CACHE_STORE_NAME = 'tool_outputs';

class ToolOutputCache {
  private _memoryCache: Map<string, CachedToolOutput> = new Map();
  private _initialized = false;

  /**
   * Opens the IndexedDB database for persisted cache.
   */
  private async openDB(): Promise<IDBDatabase | null> {
    if (typeof window === 'undefined' || typeof indexedDB === 'undefined') {
      return null;
    }

    return new Promise((resolve) => {
      try {
        const request = indexedDB.open(CACHE_DB_NAME, CACHE_DB_VERSION);

        request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
          const db = (event.target as IDBOpenDBRequest).result;

          if (!db.objectStoreNames.contains(CACHE_STORE_NAME)) {
            db.createObjectStore(CACHE_STORE_NAME, { keyPath: 'id' });
          }
        };

        request.onsuccess = (event: Event) => {
          resolve((event.target as IDBOpenDBRequest).result);
        };

        request.onerror = () => {
          resolve(null);
        };
      } catch {
        resolve(null);
      }
    });
  }

  /**
   * Loads the persisted cache into memory on first use.
   */
  private async ensureInit(): Promise<void> {
    if (this._initialized) {
      return;
    }

    this._initialized = true;

    const db = await this.openDB();

    if (!db) {
      return;
    }

    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(CACHE_STORE_NAME, 'readonly');
        const store = tx.objectStore(CACHE_STORE_NAME);
        const request = store.getAll();

        request.onsuccess = () => {
          const results = (request.result || []) as CachedToolOutput[];

          for (const item of results) {
            this._memoryCache.set(item.id, item);
          }
          db.close();
          resolve();
        };

        request.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch (e) {
      logger.warn('Failed to load tool output cache from IDB:', e);
    }
  }

  /**
   * Persists a single cached output to IndexedDB.
   */
  private async persist(entry: CachedToolOutput): Promise<void> {
    const db = await this.openDB();

    if (!db) {
      return;
    }

    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(CACHE_STORE_NAME);
        store.put(entry);

        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      // Non-critical
    }
  }

  /**
   * Adds a tool output to the cache manually (e.g. from the main
   * chat's tool results, so sub-chats can reuse them).
   */
  async put(id: string, tool: string, args: Record<string, unknown>, output: string): Promise<void> {
    await this.ensureInit();

    const entry: CachedToolOutput = {
      id,
      tool,
      args,
      output,
      cachedAt: new Date().toISOString(),
      source: 'cache',
    };

    this._memoryCache.set(id, entry);
    await this.persist(entry);
  }

  /**
   * Gets a cached output by ID (no fetching).
   */
  async get(id: string): Promise<CachedToolOutput | null> {
    await this.ensureInit();
    return this._memoryCache.get(id) ?? null;
  }

  /**
   * Resolves a list of references, fetching any that aren't cached.
   *
   * Returns a map of referenceId -> output string.
   * If a fetch fails, the reference is skipped (with a warning).
   */
  async resolveMany(
    references: ToolOutputReference[],
    executor?: ToolExecutor,
  ): Promise<Map<string, CachedToolOutput>> {
    await this.ensureInit();

    const results = new Map<string, CachedToolOutput>();

    for (const ref of references) {
      // 1. Check cache first
      const cached = this._memoryCache.get(ref.id);

      if (cached) {
        results.set(ref.id, cached);
        continue;
      }

      // 2. If no cache and no executor, skip
      if (!executor) {
        logger.warn(`Tool output ${ref.id} not cached and no executor provided`);
        continue;
      }

      // 3. Fetch fresh
      try {
        const output = await executor.execute(ref.tool, ref.args || {});

        const entry: CachedToolOutput = {
          id: ref.id,
          tool: ref.tool,
          args: ref.args || {},
          output,
          cachedAt: new Date().toISOString(),
          source: 'fetched',
        };

        this._memoryCache.set(ref.id, entry);
        await this.persist(entry);
        results.set(ref.id, entry);
      } catch (e) {
        logger.warn(`Failed to fetch tool output ${ref.id}:`, e);
      }
    }

    return results;
  }

  /**
   * Formats resolved tool outputs into a labeled text block for
   * injection into the worker's system prompt.
   */
  formatForPrompt(references: ToolOutputReference[], resolved: Map<string, CachedToolOutput>): string {
    const lines: string[] = ['===== TOOL RESULTS ====='];

    for (const ref of references) {
      const output = resolved.get(ref.id);

      if (!output) {
        lines.push(`[${ref.tool}] ${ref.label || ref.id}: (not available)`);
        continue;
      }

      const label = ref.label || ref.id;
      lines.push(`[${ref.tool}] ${label} (${output.source}):`);

      // Truncate very long outputs to keep context lean
      const maxLen = 4000;
      const text = output.output.length > maxLen ? output.output.slice(0, maxLen) + '\n... (truncated)' : output.output;
      lines.push(text);
      lines.push('');
    }

    return lines.join('\n');
  }

  /**
   * Clears the entire cache (for debugging / reset).
   */
  async clear(): Promise<void> {
    this._memoryCache.clear();

    const db = await this.openDB();

    if (!db) {
      return;
    }

    try {
      await new Promise<void>((resolve) => {
        const tx = db.transaction(CACHE_STORE_NAME, 'readwrite');
        const store = tx.objectStore(CACHE_STORE_NAME);
        store.clear();

        tx.oncomplete = () => {
          db.close();
          resolve();
        };

        tx.onerror = () => {
          db.close();
          resolve();
        };
      });
    } catch {
      // Non-critical
    }
  }
}

export const toolOutputCache = new ToolOutputCache();
