/**
 * User Profile Vector Store
 *
 * Stores and retrieves facts about the user using Orama full-text search.
 * This replaces the simple localStorage-based substring matching in MemoryStore
 * with proper BM25-ranked semantic search.
 *
 * Key features:
 * - BM25 full-text search with stemming and stop-word removal
 * - Category-based filtering (preferences, tech_stack, coding_style, etc.)
 * - Access count tracking for relevance boosting
 * - Confidence scoring for explicit vs. inferred facts
 * - IndexedDB persistence via Orama serialization
 * - Automatic deduplication of similar entries
 *
 * Usage flow:
 * 1. User sends a message -> client searches for relevant user context
 * 2. Top N results are formatted and sent to the server with the chat request
 * 3. Server injects them into the system prompt as <user_context>
 * 4. After AI responds, new user facts are extracted and stored
 */

import { create, insert, search, remove, save, load } from '@orama/orama';
import type {
  UserProfileEntry,
  UserProfileEntryCategory,
  UserProfileSchema,
  VectorSearchOptions,
  VectorSearchResult,
} from './types';
import { saveOramaToIDB, loadOramaFromIDB, deleteOramaFromIDB } from './persistence';

const STORE_NAME = 'user_profile';
const DB_KEY = `vector_store_${STORE_NAME}`;

export class UserProfileVectorStore {
  private static _instance: UserProfileVectorStore;
  private db: any = null;
  private _initialized = false;

  private constructor() {}

  static getInstance(): UserProfileVectorStore {
    if (!UserProfileVectorStore._instance) {
      UserProfileVectorStore._instance = new UserProfileVectorStore();
    }

    return UserProfileVectorStore._instance;
  }

  /**
   * Initializes the Orama database. Attempts to load from IndexedDB first,
   * falls back to creating a new empty database.
   * MUST be called before any other operation.
   */
  async initialize(): Promise<void> {
    if (this._initialized) {
      return;
    }

    try {
      const savedData = await loadOramaFromIDB(DB_KEY);

      if (savedData) {
        /*
         * Use Orama's native load() API — JSON.parse produces a plain object
         * that lacks Orama's internal methods (search, insert, etc.)
         */
        this.db = await create({
          schema: {
            id: 'string',
            content: 'string',
            category: 'string',
            createdAt: 'string',
            updatedAt: 'string',
            accessCount: 'number',
            source: 'string',
            confidence: 'number',
          },
          language: 'english',
        });

        const rawData = JSON.parse(savedData);
        await load(this.db, rawData);
        console.log(`[UserProfileVectorStore] Loaded from IndexedDB`);
      }
    } catch (error) {
      console.warn('[UserProfileVectorStore] Failed to load from IndexedDB, creating new:', error);
    }

    if (!this.db) {
      this.db = await create({
        schema: {
          id: 'string',
          content: 'string',
          category: 'string',
          createdAt: 'string',
          updatedAt: 'string',
          accessCount: 'number',
          source: 'string',
          confidence: 'number',
        },
        language: 'english',
      });
      console.log(`[UserProfileVectorStore] Created new database`);
    }

    this._initialized = true;
  }

  /**
   * Ensures the store is initialized before proceeding.
   */
  private async ensureInit(): Promise<void> {
    if (!this._initialized) {
      await this.initialize();
    }
  }

  /**
   * Adds a new user profile entry.
   * Performs deduplication: if an entry with similar content exists,
   * updates its timestamp and access count instead of creating a duplicate.
   */
  async add(
    entry: Omit<UserProfileEntry, 'id' | 'createdAt' | 'updatedAt' | 'accessCount'>,
  ): Promise<UserProfileEntry> {
    await this.ensureInit();

    if (!this.db) {
      throw new Error('UserProfileVectorStore not initialized');
    }

    // Deduplication check
    const existing = await this.search(entry.content, { limit: 1, threshold: 0.8 });

    if (existing.length > 0 && existing[0].score > 0.8) {
      // Update existing entry
      const existingEntry = existing[0].entry;
      const updated: UserProfileEntry = {
        ...existingEntry,
        content: entry.content, // Use the newer wording
        confidence: Math.max(existingEntry.confidence, entry.confidence),
        updatedAt: new Date().toISOString(),
        accessCount: existingEntry.accessCount + 1,
      };
      await this.update(updated);

      return updated;
    }

    const newEntry: UserProfileEntry = {
      ...entry,
      id: crypto.randomUUID(),
      createdAt: new Date().toISOString(),
      updatedAt: new Date().toISOString(),
      accessCount: 0,
    };

    await insert(this.db, {
      id: newEntry.id,
      content: newEntry.content,
      category: newEntry.category,
      createdAt: newEntry.createdAt,
      updatedAt: newEntry.updatedAt,
      accessCount: newEntry.accessCount,
      source: newEntry.source,
      confidence: newEntry.confidence,
    });

    await this.persist();

    return newEntry;
  }

  /**
   * Updates an existing entry.
   */
  async update(entry: UserProfileEntry): Promise<void> {
    await this.ensureInit();

    if (!this.db) {
      throw new Error('UserProfileVectorStore not initialized');
    }

    // Remove old and re-insert (Orama doesn't have a native update)
    try {
      await remove(this.db, entry.id);
    } catch {
      // Entry might not exist, ignore
    }

    await insert(this.db, {
      id: entry.id,
      content: entry.content,
      category: entry.category,
      createdAt: entry.createdAt,
      updatedAt: new Date().toISOString(),
      accessCount: entry.accessCount + 1,
      source: entry.source,
      confidence: entry.confidence,
    });

    await this.persist();
  }

  /**
   * Searches the user profile store using BM25 full-text search.
   * Returns results sorted by relevance score (descending).
   */
  async search(query: string, options?: VectorSearchOptions): Promise<VectorSearchResult<UserProfileEntry>[]> {
    await this.ensureInit();

    if (!this.db) {
      return [];
    }

    const limit = options?.limit ?? 5;
    const category = options?.category;

    const searchParams: any = {
      term: query,
      limit: limit * 2, // Over-fetch for filtering
      properties: options?.properties ?? ['content'],
    };

    if (category) {
      searchParams.where = {
        category: { eq: category },
      };
    }

    const result = await search(this.db, searchParams);

    const hits = Array.isArray(result.hits) ? result.hits : [];

    const mapped: VectorSearchResult<UserProfileEntry>[] = hits
      .filter((hit: any) => hit.score > 0)
      .map((hit: any) => ({
        entry: hit.document as unknown as UserProfileEntry,
        score: hit.score,
      }));

    // Apply threshold filter
    const threshold = options?.threshold ?? 0;
    const filtered = threshold > 0 ? mapped.filter((r) => r.score >= threshold) : mapped;

    // Sort by score descending and take limit
    return filtered.sort((a, b) => b.score - a.score).slice(0, limit);
  }

  /**
   * Gets all entries, optionally filtered by category.
   */
  async getAll(category?: UserProfileEntryCategory): Promise<UserProfileEntry[]> {
    await this.ensureInit();

    if (!this.db) {
      return [];
    }

    if (!category) {
      const result = await search(this.db, { term: '', limit: 1000, properties: ['content'] });
      return (Array.isArray(result.hits) ? result.hits : []).map((h: any) => h.document as unknown as UserProfileEntry);
    }

    const result = await search(this.db, {
      term: '',
      limit: 1000,
      properties: ['content'],
      where: { category: { eq: category } },
    });

    return (Array.isArray(result.hits) ? result.hits : []).map((h: any) => h.document as unknown as UserProfileEntry);
  }

  /**
   * Deletes an entry by ID.
   */
  async delete(id: string): Promise<boolean> {
    await this.ensureInit();

    if (!this.db) {
      return false;
    }

    try {
      await remove(this.db, id);
      await this.persist();

      return true;
    } catch {
      return false;
    }
  }

  /**
   * Clears all entries.
   */
  async clearAll(): Promise<void> {
    if (this.db) {
      await deleteOramaFromIDB(DB_KEY);
      this.db = null;
      this._initialized = false;
      await this.initialize();
    }
  }

  /**
   * Formats relevant context for injection into the system prompt.
   * This is the main method called by the chat system to get user context.
   *
   * @param query The current user message to find relevant context for
   * @param maxTokens Approximate token budget for the context (default: 500)
   * @returns Formatted string ready for prompt injection
   */
  async formatContextForPrompt(query: string, maxTokens: number = 500): Promise<string> {
    const results = await this.search(query, { limit: 10 });

    if (results.length === 0) {
      return '';
    }

    let output = '';
    let estimatedTokens = 0;
    const charsPerToken = 4;

    for (const { entry, score } of results) {
      const line = `- [${entry.category}] ${entry.content}`;
      const lineTokens = Math.ceil(line.length / charsPerToken);

      if (estimatedTokens + lineTokens > maxTokens) {
        break;
      }

      output += line + '\n';
      estimatedTokens += lineTokens;
    }

    return output.trim();
  }

  /**
   * Persists the current database state to IndexedDB.
   */
  private async persist(): Promise<void> {
    if (!this.db) {
      return;
    }

    try {
      // Use Orama's native save() API to get a serializable snapshot
      const rawData = await save(this.db);
      await saveOramaToIDB(DB_KEY, JSON.stringify(rawData));
    } catch (error) {
      console.error('[UserProfileVectorStore] Failed to persist:', error);
    }
  }

  /**
   * Returns the total number of entries.
   */
  async count(): Promise<number> {
    await this.ensureInit();

    if (!this.db) {
      return 0;
    }

    const result = await search(this.db, { term: '', limit: 10000, properties: ['content'] });

    return Array.isArray(result.hits) ? result.hits.length : 0;
  }
}

export const userProfileStore = UserProfileVectorStore.getInstance();
