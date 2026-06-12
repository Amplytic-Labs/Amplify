/**
 * User Profile Vector Store
 *
 * Manages semantic memories about the user (preferences, behaviors, facts)
 * using Orama as the vector database. Persists to IndexedDB for durability.
 */

import { insert, remove as oramaRemove, search as oramaSearch, getByID, count } from '@orama/orama';
import { createScopedLogger } from '~/utils/logger';
import {
  type UserProfileEntry,
  type UserProfileCategory,
  type UserProfileSearchOptions,
  type UserProfileSearchResult,
  type StoreStats,
  DEFAULT_VECTOR_CONFIG,
  getEmbeddingDimensions,
} from './types';
import { getUserProfileDB, hybridSearch, serializeDB, deserializeDB, type UserProfileDB } from './orama-instance';
import { embeddingService } from './embedding-service';

const logger = createScopedLogger('UserProfileStore');

// ─── UUID Helper ────────────────────────────────────────────────────

function generateId(): string {
  return crypto.randomUUID();
}

// ─── IndexedDB Helper ───────────────────────────────────────────────

const DB_NAME = 'boltHistory';
const DB_VERSION = 3;
const STORE_NAME = 'vectorSnapshots';

async function openVectorDB(): Promise<IDBDatabase> {
  if (typeof indexedDB === 'undefined') {
    throw new Error('IndexedDB is not available in this environment.');
  }

  return new Promise((resolve, reject) => {
    const request = indexedDB.open(DB_NAME, DB_VERSION);

    request.onupgradeneeded = (event: IDBVersionChangeEvent) => {
      const db = (event.target as IDBOpenDBRequest).result;

      // Preserve existing stores from earlier versions
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

      if (event.oldVersion < 3) {
        if (!db.objectStoreNames.contains(STORE_NAME)) {
          db.createObjectStore(STORE_NAME);
        }
      }
    };

    request.onsuccess = (event: Event) => {
      resolve((event.target as IDBOpenDBRequest).result);
    };

    request.onerror = (event: Event) => {
      reject((event.target as IDBOpenDBRequest).error);
    };
  });
}

async function loadFromIndexedDB<T>(): Promise<T | null> {
  try {
    const db = await openVectorDB();
    const result = await new Promise<T | null>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readonly');
      const store = tx.objectStore(STORE_NAME);
      const request = store.get('user-profile');

      request.onsuccess = () => resolve((request.result as T) ?? null);
      request.onerror = () => reject(request.error);
    });
    db.close();
    return result;
  } catch (error) {
    logger.warn('Failed to load user profile from IndexedDB', error);
    return null;
  }
}

async function saveToIndexedDB<T>(data: T): Promise<void> {
  try {
    const db = await openVectorDB();
    await new Promise<void>((resolve, reject) => {
      const tx = db.transaction(STORE_NAME, 'readwrite');
      const store = tx.objectStore(STORE_NAME);
      const request = store.put(data, 'user-profile');

      request.onsuccess = () => resolve();
      request.onerror = () => reject(request.error);
    });
    db.close();
  } catch (error) {
    logger.error('Failed to persist user profile to IndexedDB', error);
  }
}

// ─── Category Labels ────────────────────────────────────────────────

const CATEGORY_LABELS: Record<UserProfileCategory, string> = {
  preference: 'User Preference',
  behavior: 'User Behavior',
  fact: 'User Fact',
  feedback: 'User Feedback',
  'skill-level': 'Skill Level',
};

// ─── Regex Patterns for Preference Extraction ────────────────────────

const PREFERENCE_PATTERNS: {
  pattern: RegExp;
  category: UserProfileCategory;
}[] = [
  {
    pattern: /\bI\s+prefer\s+(?:to\s+)?(.+?)(?:\.|!|\?|$)/gi,
    category: 'preference',
  },
  {
    pattern: /\b(always\s+(?:use|do|go\s+with|choose)\s+)(.+?)(?:\.|!|\?|$)/gi,
    category: 'preference',
  },
  {
    pattern: /\b(never\s+(?:use|do|go\s+with|choose)\s+)(.+?)(?:\.|!|\?|$)/gi,
    category: 'preference',
  },
  {
    pattern: /\b(don'?t\s+(?:use|like|want)\s+)(.+?)(?:\.|!|\?|$)/gi,
    category: 'preference',
  },
  {
    pattern: /\bI\s+(?:always|usually|typically|normally)\s+(.+?)(?:\.|!|\?|$)/gi,
    category: 'behavior',
  },
  {
    pattern: /\bI\s+(?:work\s+(?:at|for|in|with)|am\s+(?:a|an))\s+(.+?)(?:\.|!|\?|$)/gi,
    category: 'fact',
  },
  {
    pattern: /\b(I(?:'m| am)\s+(?:a\s+)?(?:beginner|intermediate|expert|senior|junior|lead|staff))\s*(.+?)(?:\.|!|\?|$)/gi,
    category: 'skill-level',
  },
];

// ─── UserProfileStore Class ─────────────────────────────────────────

class UserProfileStore {
  private db: UserProfileDB | null = null;
  private initialized = false;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;
  private initializing: Promise<void> | null = null;

  constructor() {}

  // ─── Initialization ───────────────────────────────────────────

  async initialize(): Promise<void> {
    // Prevent concurrent initialization
    if (this.initialized) return;
    if (this.initializing) return this.initializing;

    this.initializing = this._initialize();
    await this.initializing;
  }

  private async _initialize(): Promise<void> {
    try {
      // Get or create the Orama database (use the embedding service's known dimensions)
      this.db = getUserProfileDB(undefined, embeddingService.getDimensions());

      // Attempt to restore from IndexedDB
      const serialized = await loadFromIndexedDB<
        Awaited<ReturnType<typeof serializeDB<UserProfileEntry>>>
      >();

      if (serialized && serialized.documents && serialized.documents.length > 0) {
        logger.info(`Restoring ${serialized.documents.length} user profile entries from IndexedDB`);
        await deserializeDB<UserProfileEntry>(this.db, serialized);
      }

      this.initialized = true;
      logger.info('User profile store initialized');
    } catch (error) {
      logger.error('Failed to initialize user profile store', error);
      // Create a fresh DB on failure
      this.db = getUserProfileDB(undefined, embeddingService.getDimensions());
      this.initialized = true;
    } finally {
      this.initializing = null;
    }
  }

  // ─── Add Entry ────────────────────────────────────────────────

  async add(
    entry: Omit<UserProfileEntry, 'id' | 'embedding' | 'accessCount' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'>,
  ): Promise<UserProfileEntry> {
    this.ensureInitialized();

    const now = new Date().toISOString();
    const embedding = await embeddingService.embed(entry.content);

    const fullEntry: UserProfileEntry = {
      ...entry,
      id: generateId(),
      embedding,
      accessCount: 0,
      createdAt: now,
      updatedAt: now,
      lastReferencedAt: undefined,
    };

    // Map the `type` field to both `type` and ensure schema compatibility
    // The Orama schema uses 'type' for the category field
    await insert(this.db!, {
      id: fullEntry.id,
      type: fullEntry.type,
      content: fullEntry.content,
      category: fullEntry.type, // Orama schema has both type and category
      embedding,
      sourceChatId: fullEntry.sourceChatId ?? '',
      confidence: fullEntry.confidence,
      lastReferencedAt: fullEntry.lastReferencedAt ?? '',
      accessCount: fullEntry.accessCount,
      createdAt: fullEntry.createdAt,
      updatedAt: fullEntry.updatedAt,
    });

    logger.debug(`Added user profile entry [${fullEntry.type}]: ${fullEntry.content.slice(0, 80)}`);

    this.schedulePersist();
    return fullEntry;
  }

  // ─── Search ───────────────────────────────────────────────────

  async search(
    query: string,
    options?: UserProfileSearchOptions,
  ): Promise<UserProfileSearchResult[]> {
    this.ensureInitialized();

    const { topK = 10, minScore = DEFAULT_VECTOR_CONFIG.similarityThreshold, category } = options ?? {};
    const embedding = await embeddingService.embed(query);

    // Check if embedding is a zero vector (service was unavailable)
    const isZeroVector = embedding.every((v) => v === 0);

    let hits: { id: string; score: number; document: UserProfileEntry }[];

    if (isZeroVector) {
      // Fall back to full-text search when embedding is unavailable
      logger.debug('Zero vector detected, falling back to full-text search');
      const results = await oramaSearch(this.db!, {
        mode: 'fulltext',
        term: query,
        limit: topK,
        properties: ['content'],
      });

      hits = results.hits.map((hit) => ({
        id: hit.id as string,
        score: (hit.score as number) || 0,
        document: hit.document as unknown as UserProfileEntry,
      }));
    } else {
      // Use hybrid search
      // Build a filter: if a single category is specified, pass it; otherwise search all
      const filterType = category && category.length === 1 ? category[0] : undefined;

      const searchResults = await hybridSearch<UserProfileEntry>(this.db!, {
        query,
        embedding,
        topK,
        minScore,
        filterType,
      });

      hits = searchResults.map((r) => ({
        id: r.id as string,
        score: r.score,
        document: r.document,
      }));

      // If multiple categories specified, filter post-hoc
      if (category && category.length > 1) {
        hits = hits.filter((h) => category.includes(h.document.type as UserProfileCategory));
      }
    }

    // Build search results with updated metadata (access tracking)
    // Note: accessCount and lastReferencedAt are bumped in the returned
    // objects but not written back per-hit to avoid thrashing.  The caller
    // can persist the full DB when it chooses.
    const now = new Date().toISOString();
    const results: UserProfileSearchResult[] = hits.map((hit) => ({
      ...hit.document,
      accessCount: hit.document.accessCount + 1,
      lastReferencedAt: now,
      score: hit.score,
    }));

    return results;
  }

  // ─── Search by Category ───────────────────────────────────────

  async searchByCategory(
    query: string,
    categories: UserProfileCategory[],
  ): Promise<UserProfileSearchResult[]> {
    return this.search(query, { category: categories });
  }

  // ─── Update Entry ─────────────────────────────────────────────

  async update(id: string, updates: Partial<UserProfileEntry>): Promise<void> {
    this.ensureInitialized();

    // Find existing entry by ID
    const existingDoc = await getByID(this.db!, id);

    if (!existingDoc) {
      throw new Error(`User profile entry not found: ${id}`);
    }

    const current = existingDoc as unknown as UserProfileEntry;

    // Build updated document
    const updated: UserProfileEntry = {
      ...current,
      ...updates,
      id: current.id, // Prevent ID mutation
      updatedAt: new Date().toISOString(),
    };

    // If content changed, regenerate embedding
    if (updates.content && updates.content !== current.content) {
      updated.embedding = await embeddingService.embed(updates.content);
    }

    // Remove old and insert updated (Orama doesn't have in-place update)
    await oramaRemove(this.db!, id);
    await insert(this.db!, {
      id: updated.id,
      type: updated.type,
      content: updated.content,
      category: updated.type,
      embedding: updated.embedding ?? new Array(getEmbeddingDimensions()).fill(0),
      sourceChatId: updated.sourceChatId ?? '',
      confidence: updated.confidence,
      lastReferencedAt: updated.lastReferencedAt ?? '',
      accessCount: updated.accessCount,
      createdAt: updated.createdAt,
      updatedAt: updated.updatedAt,
    });

    this.schedulePersist();
  }

  // ─── Remove Entry ─────────────────────────────────────────────

  async remove(id: string): Promise<void> {
    this.ensureInitialized();

    await oramaRemove(this.db!, id);
    this.schedulePersist();
  }

  // ─── Extract from Chat ────────────────────────────────────────

  async extractFromChat(
    messages: { role: string; content: string }[],
  ): Promise<Omit<UserProfileEntry, 'id' | 'embedding' | 'accessCount' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'>[]> {
    const extracted: Omit<UserProfileEntry, 'id' | 'embedding' | 'accessCount' | 'createdAt' | 'updatedAt' | 'lastReferencedAt'>[] =
      [];

    for (const message of messages) {
      // Only extract from user messages
      if (message.role !== 'user') continue;

      const content = message.content;

      for (const { pattern, category } of PREFERENCE_PATTERNS) {
        // Reset regex lastIndex for each iteration
        pattern.lastIndex = 0;
        let match: RegExpExecArray | null;

        while ((match = pattern.exec(content)) !== null) {
          const matchedText = match[0].trim();
          // Skip very short or empty matches
          if (matchedText.length < 10) continue;

          extracted.push({
            type: category,
            content: matchedText,
            confidence: 0.7,
          });
        }
      }
    }

    return extracted;
  }

  // ─── Persist ──────────────────────────────────────────────────

  async persist(): Promise<void> {
    if (!this.db) return;

    // Clear any pending debounce
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }

    try {
      const serialized = await serializeDB<UserProfileEntry>(this.db, 'user-profile');
      await saveToIndexedDB(serialized);
      logger.debug(`Persisted ${serialized.documentCount} user profile entries`);
    } catch (error) {
      logger.error('Failed to persist user profile store', error);
    }
  }

  // ─── Stats ────────────────────────────────────────────────────

  getStats(): StoreStats {
    this.ensureInitialized();

    return {
      totalEntries: count(this.db!),
      entriesByType: {}, // Detailed per-type counts require async search
      lastUpdated: new Date().toISOString(),
    };
  }

  // ─── Format for Prompt ────────────────────────────────────────

  formatForPrompt(results: UserProfileSearchResult[]): string {
    if (results.length === 0) return '';

    const lines = results.map((r) => {
      const label = CATEGORY_LABELS[r.type as UserProfileCategory] ?? r.type;
      const confidence = Math.round(r.confidence * 100);
      return `- [${label}] ${r.content} (confidence: ${confidence}%)`;
    });

    return `## User Profile\n\n${lines.join('\n')}`;
  }

  // ─── Destroy ──────────────────────────────────────────────────

  async destroy(): Promise<void> {
    await this.persist();
    this.db = null;
    this.initialized = false;
    this.clearPersistTimer();
  }

  // ─── Private Helpers ──────────────────────────────────────────

  private ensureInitialized(): void {
    if (!this.initialized || !this.db) {
      throw new Error('UserProfileStore has not been initialized. Call initialize() first.');
    }
  }

  private schedulePersist(): void {
    this.clearPersistTimer();
    this.persistTimer = setTimeout(() => {
      this.persist().catch((err) => logger.error('Debounced persist failed', err));
    }, DEFAULT_VECTOR_CONFIG.persistDebounceMs);
  }

  private clearPersistTimer(): void {
    if (this.persistTimer !== null) {
      clearTimeout(this.persistTimer);
      this.persistTimer = null;
    }
  }
}

// ─── Singleton Export ───────────────────────────────────────────────

export const userProfileStore = new UserProfileStore();