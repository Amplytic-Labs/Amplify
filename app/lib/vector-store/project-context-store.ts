/**
 * Project Context Vector Store
 *
 * Each project gets its own Orama database that accumulates knowledge across
 * all linked chats (decisions, errors, patterns, requirements, don'ts).
 * Databases are persisted to IndexedDB and cached in memory (LRU, max 5).
 */

import { insert, search, type Orama } from '@orama/orama';
import {
  type ProjectContextEntry,
  type ProjectContextType,
  type ProjectContextSearchOptions,
  type ProjectContextSearchResult,
  type StoreStats,
  DEFAULT_VECTOR_CONFIG,
} from './types';
import {
  type ProjectContextDB,
  getProjectContextDB,
  disposeProjectDB,
  hybridSearch,
  serializeDB,
  deserializeDB,
  type SerializedDB,
} from './orama-instance';
import { embeddingService } from './embedding-service';

// ─── Constants ──────────────────────────────────────────────────────

const MAX_CACHED_PROJECTS = 5;
const DB_NAME = 'boltHistory';
const DB_VERSION = 3;
const SNAPSHOT_STORE = 'vectorSnapshots';

// ─── Internal Types ─────────────────────────────────────────────────

/** Raw document shape stored in Orama (stringified JSON fields). */
interface RawProjectDocument {
  id: string;
  type: string;
  content: string;
  embedding: number[];
  sourceChatId?: string;
  sourcePointId?: string;
  filePaths: string;
  metadata: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

interface CachedProject {
  db: ProjectContextDB;
  lastAccessedAt: number;
}

// ─── IndexedDB Helper ───────────────────────────────────────────────

function openVectorDB(): Promise<IDBDatabase | undefined> {
  if (typeof indexedDB === 'undefined') {
    console.error('indexedDB is not available in this environment.');
    return Promise.resolve(undefined);
  }

  return new Promise((resolve) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Preserve existing object stores from v1/v2
      if (event.oldVersion < 1) {
        if (!db.objectStoreNames.contains('chats')) {
          const store = db.createObjectStore('chats', { keyPath: 'id' });
          store.createIndex('id', 'id', { unique: true });
          store.createIndex('urlId', 'urlId', { unique: true });
        }
      }

      if (event.oldVersion < 2) {
        if (!db.objectStoreNames.contains('snapshots')) {
          db.createObjectStore('snapshots', { keyPath: 'chatId' });
        }
      }

      // v3 — vector store snapshots
      if (event.oldVersion < 3) {
        if (!db.objectStoreNames.contains(SNAPSHOT_STORE)) {
          db.createObjectStore(SNAPSHOT_STORE);
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      console.error('Failed to open vector DB:', (event.target as IDBOpenDBRequest).error);
      resolve(undefined);
    };
  });
}

// ─── Helpers ────────────────────────────────────────────────────────

function generateId(): string {
  return `pce-${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function snapshotKey(projectId: string): string {
  return `project-${projectId}`;
}

function isZeroVector(vec: number[]): boolean {
  return vec.every((v) => v === 0);
}

function toRawEntry(entry: ProjectContextEntry): RawProjectDocument {
  return {
    id: entry.id,
    type: entry.type,
    content: entry.content,
    embedding: entry.embedding ?? new Array(DEFAULT_VECTOR_CONFIG.embeddingDimensions).fill(0),
    sourceChatId: entry.sourceChatId,
    sourcePointId: entry.sourcePointId,
    filePaths: JSON.stringify(entry.filePaths ?? []),
    metadata: JSON.stringify(entry.metadata ?? {}),
    accessCount: entry.accessCount,
    createdAt: entry.createdAt,
    updatedAt: entry.updatedAt,
  };
}

function fromRawDocument(doc: RawProjectDocument): ProjectContextSearchResult {
  return {
    id: doc.id,
    type: doc.type as ProjectContextType,
    content: doc.content,
    embedding: doc.embedding,
    sourceChatId: doc.sourceChatId,
    sourcePointId: doc.sourcePointId,
    filePaths: safeJsonParse<string[]>(doc.filePaths, []),
    metadata: safeJsonParse<ProjectContextEntry['metadata']>(doc.metadata, {}),
    accessCount: doc.accessCount,
    createdAt: doc.createdAt,
    updatedAt: doc.updatedAt,
    score: 1,
  };
}

function safeJsonParse<T>(value: string, fallback: T): T {
  try {
    return JSON.parse(value) as T;
  } catch {
    return fallback;
  }
}

// ─── Sub-chat Extraction Patterns ───────────────────────────────────

interface SubChatMessage {
  role: string;
  content: string;
}

interface ExtractedEntry {
  type: ProjectContextType;
  content: string;
  metadata?: ProjectContextEntry['metadata'];
}

const EXTRACTION_PATTERNS: {
  type: ProjectContextType;
  patterns: RegExp[];
}[] = [
  {
    type: 'error',
    patterns: [
      /(?:error|fail(?:ed)?|exception|bug|issue)\s*[:\-—]\s*(.+)/gi,
      /(?:fix(?:ed)?|resolved?|solution)\s*[:\-—]\s*(.+)/gi,
    ],
  },
  {
    type: 'decision',
    patterns: [
      /(?:decided|decision|chose|going with|let'?s use|we'?ll use)\s*[:\-—]?\s*(.+)/gi,
      /(?:using|adopting|implementing)\s+(?:the\s+)?(\w.+?)(?:\n|\.)/gi,
    ],
  },
  {
    type: 'dont',
    patterns: [
      /(?:don'?t|do not|never|avoid|must not)\s+(?:use|do|import|touch|modify|delete|remove|call)\s+(.+)/gi,
      /(?:never|always avoid|do not)\s*[:\-—]\s*(.+)/gi,
    ],
  },
  {
    type: 'pattern',
    patterns: [
      /(?:pattern|convention|style|approach|pattern used)\s*[:\-—]\s*(.+)/gi,
      /(?:consistent|standardize|always)\s+(.+)/gi,
    ],
  },
  {
    type: 'requirement',
    patterns: [
      /(?:require(?:ment|s)?|must have|needs? to|should|spec)\s*[:\-—]\s*(.+)/gi,
      /(?:feature|functionality|behavior)\s*[:\-—]\s*(.+)/gi,
    ],
  },
];

// ─── ProjectContextStore ────────────────────────────────────────────

class ProjectContextStore {
  /** In-memory LRU cache of project DBs */
  private cache = new Map<string, CachedProject>();

  // ─── Cache Management ─────────────────────────────────────────────

  private touch(projectId: string): void {
    const cached = this.cache.get(projectId);
    if (cached) {
      cached.lastAccessedAt = Date.now();
    }
  }

  private async evictLRU(): Promise<void> {
    if (this.cache.size < MAX_CACHED_PROJECTS) return;

    // Find least recently accessed
    let lruProjectId: string | undefined;
    let lruTime = Infinity;

    for (const [id, entry] of Array.from(this.cache.entries())) {
      if (entry.lastAccessedAt < lruTime) {
        lruTime = entry.lastAccessedAt;
        lruProjectId = id;
      }
    }

    if (lruProjectId) {
      // Persist before evicting
      await this.persist(lruProjectId).catch((err) => {
        console.warn(`Failed to persist evicted project ${lruProjectId}:`, err);
      });
      disposeProjectDB(lruProjectId);
      this.cache.delete(lruProjectId);
    }
  }

  private async getOrLoadDB(projectId: string): Promise<ProjectContextDB> {
    const cached = this.cache.get(projectId);
    if (cached) {
      cached.lastAccessedAt = Date.now();
      return cached.db;
    }

    // Evict if at capacity
    await this.evictLRU();

    // Try loading from IndexedDB
    const db = getProjectContextDB(projectId);
    const loaded = await this.loadFromIndexedDB(projectId, db);
    if (loaded) {
      this.cache.set(projectId, { db, lastAccessedAt: Date.now() });
    } else {
      // Fresh DB — still cache it
      this.cache.set(projectId, { db, lastAccessedAt: Date.now() });
    }

    return db;
  }

  // ─── Persistence ──────────────────────────────────────────────────

  private async loadFromIndexedDB(projectId: string, db: ProjectContextDB): Promise<boolean> {
    const idb = await openVectorDB();
    if (!idb) return false;

    return new Promise((resolve) => {
      const tx = idb.transaction(SNAPSHOT_STORE, 'readonly');
      const store = tx.objectStore(SNAPSHOT_STORE);
      const request = store.get(snapshotKey(projectId));

      request.onsuccess = async () => {
        const data = request.result as SerializedDB<RawProjectDocument> | undefined;
        if (!data || !data.documents?.length) {
          resolve(false);
          return;
        }

        try {
          await deserializeDB(db, data);
          resolve(true);
        } catch (err) {
          console.error(`Failed to deserialize project ${projectId}:`, err);
          resolve(false);
        }
      };

      request.onerror = () => {
        console.error('Failed to read snapshot from IndexedDB:', request.error);
        resolve(false);
      };
    });
  }

  // ─── Public API ───────────────────────────────────────────────────

  /**
   * Initialize (or load) the Orama database for a project.
   * If a persisted snapshot exists in IndexedDB it will be restored.
   */
  async initializeProject(projectId: string): Promise<void> {
    await this.getOrLoadDB(projectId);
  }

  /**
   * Add a new context entry to a project's store.
   */
  async add(
    projectId: string,
    entry: Omit<ProjectContextEntry, 'id' | 'embedding' | 'accessCount' | 'createdAt' | 'updatedAt'>,
  ): Promise<ProjectContextEntry> {
    const db = await this.getOrLoadDB(projectId);
    const now = new Date().toISOString();

    // Generate embedding for the content
    const embedding = await embeddingService.embed(entry.content);

    const fullEntry: ProjectContextEntry = {
      ...entry,
      id: generateId(),
      embedding: isZeroVector(embedding) ? undefined : embedding,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
    };

    const raw = toRawEntry(fullEntry);
    raw.embedding = embedding; // Always store the vector (even zero) for Orama

    await insert(db, raw as any);

    this.touch(projectId);
    return fullEntry;
  }

  /**
   * Search a project's context using hybrid (vector + fulltext) search.
   */
  async search(
    projectId: string,
    query: string,
    options?: ProjectContextSearchOptions,
  ): Promise<ProjectContextSearchResult[]> {
    const db = await this.getOrLoadDB(projectId);
    const { topK = 10, minScore = DEFAULT_VECTOR_CONFIG.similarityThreshold, types } = options ?? {};

    // Embed the query
    const queryEmbedding = await embeddingService.embed(query);

    // If embedding is a zero vector, fall back to fulltext-only
    if (isZeroVector(queryEmbedding)) {
      const whereClause = types?.length ? { type: types as unknown as string } : undefined;
      const results = await search(db, {
        mode: 'fulltext',
        term: query,
        limit: topK,
        properties: ['content'],
        ...(whereClause ? { where: whereClause } : {}),
      });

      return results.hits
        .map((hit) => {
          const doc = hit.document as unknown as RawProjectDocument;
          return { ...fromRawDocument(doc), score: (hit.score as number) ?? 0.5 };
        })
        .filter((r) => r.score >= minScore);
    }

    // Hybrid search with optional type filter
    // hybridSearch only supports a single filterType, so we run multiple
    // searches when multiple types are requested and merge.
    if (types && types.length > 0 && types.length <= 7) {
      const allHits = await Promise.all(
        types.map((t) =>
          hybridSearch(db, {
            query,
            embedding: queryEmbedding,
            topK,
            minScore,
            filterType: t,
          }),
        ),
      );

      const merged = new Map<string, (typeof allHits[number])[number]>();
      for (const hits of allHits) {
        for (const hit of hits) {
          const id = hit.id as string;
          const existing = merged.get(id);
          if (!existing || (hit.score ?? 0) > (existing.score ?? 0)) {
            merged.set(id, hit);
          }
        }
      }

      return Array.from(merged.values())
        .sort((a, b) => (b.score ?? 0) - (a.score ?? 0))
        .slice(0, topK)
        .map((hit) => fromRawDocument(hit.document as unknown as RawProjectDocument))
        .map((r) => ({ ...r, score: (r as any).score ?? 0 }));
    }

    const hits = await hybridSearch(db, {
      query,
      embedding: queryEmbedding,
      topK,
      minScore,
    });

    const results = hits.map((hit) => fromRawDocument(hit.document as unknown as RawProjectDocument));

    // Update accessCount for returned entries
    this.touch(projectId);
    return results;
  }

  /**
   * Search with a type filter.
   */
  async searchByType(
    projectId: string,
    types: ProjectContextType[],
    query?: string,
  ): Promise<ProjectContextSearchResult[]> {
    if (query) {
      return this.search(projectId, query, { types, topK: 50 });
    }

    // No query — return all entries of the requested types
    const db = await this.getOrLoadDB(projectId);
    const whereClause = { type: types as unknown as string };

    const results = await search(db, {
      mode: 'fulltext',
      term: '',
      limit: 500,
      where: whereClause,
    });

    this.touch(projectId);
    return results.hits.map((hit) => fromRawDocument(hit.document as unknown as RawProjectDocument));
  }

  /**
   * Get all error entries for a project.
   */
  async getErrorHistory(projectId: string): Promise<ProjectContextSearchResult[]> {
    return this.searchByType(projectId, ['error']);
  }

  /**
   * Get all decision entries for a project.
   */
  async getDecisions(projectId: string): Promise<ProjectContextSearchResult[]> {
    return this.searchByType(projectId, ['decision']);
  }

  /**
   * Get all pattern entries for a project.
   */
  async getPatterns(projectId: string): Promise<ProjectContextSearchResult[]> {
    return this.searchByType(projectId, ['pattern']);
  }

  /**
   * Get all "don't" entries. These are critical constraints that should
   * always be included in the system prompt.
   */
  async getDonts(projectId: string): Promise<ProjectContextSearchResult[]> {
    return this.searchByType(projectId, ['dont']);
  }

  /**
   * Convenience: add an error + fix pair.
   */
  async addError(
    projectId: string,
    error: string,
    fix: string,
    filePaths?: string[],
    sourceChatId?: string,
  ): Promise<ProjectContextEntry> {
    return this.add(projectId, {
      type: 'error',
      content: `Error: ${error}\nFix: ${fix}`,
      filePaths,
      sourceChatId,
      metadata: { error, fix },
    });
  }

  /**
   * Convenience: add a project decision.
   */
  async addDecision(
    projectId: string,
    content: string,
    reason?: string,
    filePaths?: string[],
    sourceChatId?: string,
  ): Promise<ProjectContextEntry> {
    return this.add(projectId, {
      type: 'decision',
      content: reason ? `${content} (Reason: ${reason})` : content,
      filePaths,
      sourceChatId,
      metadata: reason ? { reason } : undefined,
    });
  }

  /**
   * Convenience: add a "don't" constraint.
   */
  async addDont(
    projectId: string,
    content: string,
    filePaths?: string[],
    sourceChatId?: string,
  ): Promise<ProjectContextEntry> {
    return this.add(projectId, {
      type: 'dont',
      content,
      filePaths,
      sourceChatId,
    });
  }

  /**
   * Analyze a sub-chat's messages and extract context entries
   * (decisions, errors, patterns, requirements, don'ts).
   *
   * Uses simple regex / pattern matching. Returns the extracted entries
   * without inserting them — the caller decides what to keep.
   */
  async extractFromSubChat(
    projectId: string,
    messages: SubChatMessage[],
    filePaths?: string[],
  ): Promise<ExtractedEntry[]> {
    // Combine assistant messages for analysis (they contain the decisions/facts)
    const textBlocks = messages
      .filter((m) => m.role === 'assistant')
      .map((m) => m.content)
      .join('\n\n');

    if (!textBlocks.trim()) return [];

    const extracted: ExtractedEntry[] = [];
    const seen = new Set<string>();

    for (const group of EXTRACTION_PATTERNS) {
      for (const pattern of group.patterns) {
        let match: RegExpExecArray | null;

        // Reset lastIndex since we reuse patterns
        pattern.lastIndex = 0;

        while ((match = pattern.exec(textBlocks)) !== null) {
          const content = match[1]?.trim();
          if (!content || content.length < 10 || content.length > 500) continue;

          const dedupeKey = `${group.type}:${content.slice(0, 80).toLowerCase()}`;
          if (seen.has(dedupeKey)) continue;
          seen.add(dedupeKey);

          const entry: ExtractedEntry = { type: group.type, content };

          // Enrich error entries with fix if adjacent
          if (group.type === 'error' && match[2]?.trim()) {
            entry.metadata = { error: content, fix: match[2].trim() };
          }

          extracted.push(entry);
        }
      }
    }

    return extracted;
  }

  /**
   * Persist a single project's DB to IndexedDB.
   */
  async persist(projectId: string): Promise<void> {
    const cached = this.cache.get(projectId);
    if (!cached) return;

    const idb = await openVectorDB();
    if (!idb) return;

    const serialized = await serializeDB<RawProjectDocument>(
      cached.db,
      `project-context-${projectId}`,
    );

    return new Promise((resolve, reject) => {
      const tx = idb.transaction(SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(SNAPSHOT_STORE);
      const request = store.put(serialized, snapshotKey(projectId));

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
  }

  /**
   * Persist all cached project DBs to IndexedDB.
   */
  async persistAll(): Promise<void> {
    const projectIds = Array.from(this.cache.keys());
    await Promise.allSettled(projectIds.map((id) => this.persist(id)));
  }

  /**
   * Delete a project's DB — removes from cache, disposes Orama instance,
   * and deletes the IndexedDB snapshot.
   */
  async deleteProject(projectId: string): Promise<void> {
    // Remove from cache and dispose Orama
    this.cache.delete(projectId);
    disposeProjectDB(projectId);

    // Delete from IndexedDB
    const idb = await openVectorDB();
    if (!idb) return;

    return new Promise((resolve) => {
      const tx = idb.transaction(SNAPSHOT_STORE, 'readwrite');
      const store = tx.objectStore(SNAPSHOT_STORE);
      const request = store.delete(snapshotKey(projectId));

      request.onsuccess = () => resolve();
      request.onerror = () => {
        console.warn(`Failed to delete project ${projectId} from IndexedDB:`, request.error);
        resolve();
      };
    });
  }

  /**
   * Get store statistics for a project.
   */
  getStats(projectId: string): StoreStats {
    const cached = this.cache.get(projectId);
    if (!cached) {
      return {
        totalEntries: 0,
        entriesByType: {},
        lastUpdated: new Date().toISOString(),
      };
    }

    // Synchronous stats from cache metadata.
    // For accurate counts we would need an async search, but the caller
    // typically just wants a quick snapshot.
    // We use the cache timestamp as lastUpdated.
    const lastAccessed = new Date(cached.lastAccessedAt).toISOString();

    return {
      totalEntries: -1, // -1 signals "not yet counted — needs async"
      entriesByType: {},
      lastUpdated: lastAccessed,
    };
  }

  /**
   * Get async stats (accurate counts) for a project.
   */
  async getStatsAsync(projectId: string): Promise<StoreStats> {
    const db = await this.getOrLoadDB(projectId);

    const results = await search(db, {
      mode: 'fulltext',
      term: '',
      limit: 100000,
    });

    const entriesByType: Record<string, number> = {};
    let lastUpdated = '';

    for (const hit of results.hits) {
      const doc = hit.document as unknown as RawProjectDocument;
      entriesByType[doc.type] = (entriesByType[doc.type] ?? 0) + 1;
      if (doc.updatedAt > lastUpdated) {
        lastUpdated = doc.updatedAt;
      }
    }

    return {
      totalEntries: results.hits.length,
      entriesByType,
      lastUpdated: lastUpdated || new Date().toISOString(),
    };
  }

  /**
   * Format search results for inclusion in a system prompt.
   * Groups entries by type with clear section headers.
   */
  formatForPrompt(results: ProjectContextSearchResult[]): string {
    if (!results.length) return '';

    const grouped = new Map<ProjectContextType, ProjectContextSearchResult[]>();

    for (const result of results) {
      const existing = grouped.get(result.type) ?? [];
      existing.push(result);
      grouped.set(result.type, existing);
    }

    const SECTION_ORDER: ProjectContextType[] = [
      'dont',
      'requirement',
      'architecture',
      'decision',
      'pattern',
      'error',
      'fix',
    ];

    const SECTION_LABELS: Record<ProjectContextType, string> = {
      dont: '⛔ Critical Constraints (DO NOT violate)',
      requirement: '📋 Requirements',
      architecture: '🏗️ Architecture',
      decision: '✅ Decisions',
      pattern: '🔄 Patterns & Conventions',
      error: '❌ Errors & Fixes',
      fix: '🔧 Fixes Applied',
    };

    const lines: string[] = [
      '<project-context>',
      'The following is accumulated project knowledge. Follow constraints and patterns closely.',
      '',
    ];

    for (const type of SECTION_ORDER) {
      const entries = grouped.get(type);
      if (!entries?.length) continue;

      lines.push(SECTION_LABELS[type]);

      for (const entry of entries) {
        const prefix = entry.filePaths?.length
          ? `[${entry.filePaths.join(', ')}] `
          : '';
        lines.push(`- ${prefix}${entry.content}`);

        // For errors, append the fix if available
        if ((type === 'error' || type === 'fix') && entry.metadata?.fix) {
          lines.push(`  → Fix: ${entry.metadata.fix}`);
        }

        // For decisions, append the reason if available
        if (type === 'decision' && entry.metadata?.reason) {
          lines.push(`  → Reason: ${entry.metadata.reason}`);
        }
      }

      lines.push('');
    }

    // Handle any types not in the predefined order
    for (const [type, entries] of Array.from(grouped.entries())) {
      if (SECTION_ORDER.includes(type)) continue;
      lines.push(`## ${type}`);
      for (const entry of entries) {
        lines.push(`- ${entry.content}`);
      }
      lines.push('');
    }

    lines.push('</project-context>');
    return lines.join('\n');
  }
}

// ─── Singleton Export ───────────────────────────────────────────────

export const projectContextStore = new ProjectContextStore();