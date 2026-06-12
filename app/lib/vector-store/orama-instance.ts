/**
 * Orama Database Instance Helper
 * Creates and manages Orama databases with vector search capabilities
 */

import { create, insert, search, type Orama, type Results } from '@orama/orama';
import { DEFAULT_VECTOR_CONFIG, type VectorStoreConfig } from './types';

// ─── User Profile Schema ──────────────────────────────────────────

export const userProfileSchema = {
  id: 'string',
  type: 'string',
  content: 'string',
  category: 'string',
  embedding: 'vector[1536]',
  sourceChatId: 'string',
  confidence: 'number',
  lastReferencedAt: 'string',
  accessCount: 'number',
  createdAt: 'string',
  updatedAt: 'string',
} as const;

export type UserProfileDB = Orama<typeof userProfileSchema>;

// ─── Project Context Schema ────────────────────────────────────────

export const projectContextSchema = {
  id: 'string',
  type: 'string',
  content: 'string',
  embedding: 'vector[1536]',
  sourceChatId: 'string',
  sourcePointId: 'string',
  filePaths: 'string',  // JSON-stringified array for Orama compatibility
  metadata: 'string',   // JSON-stringified object
  accessCount: 'number',
  createdAt: 'string',
  updatedAt: 'string',
} as const;

export type ProjectContextDB = Orama<typeof projectContextSchema>;

// ─── Database Factory ─────────────────────────────────────────────

let userProfileDBInstance: UserProfileDB | null = null;
const projectDBCache: Map<string, ProjectContextDB> = new Map();

/**
 * Create (or get cached) user profile Orama database
 */
export function getUserProfileDB(config?: Partial<VectorStoreConfig>): UserProfileDB {
  if (userProfileDBInstance) {
    return userProfileDBInstance;
  }

  userProfileDBInstance = create({
    schema: userProfileSchema,
    id: 'user-profile-store',
  });

  return userProfileDBInstance;
}

/**
 * Create (or get cached) project context Orama database for a specific project
 */
export function getProjectContextDB(projectId: string, config?: Partial<VectorStoreConfig>): ProjectContextDB {
  const cached = projectDBCache.get(projectId);
  if (cached) {
    return cached;
  }

  const db = create({
    schema: projectContextSchema,
    id: `project-context-${projectId}`,
  });

  projectDBCache.set(projectId, db);
  return db;
}

/**
 * Dispose of a project context DB (free memory)
 */
export function disposeProjectDB(projectId: string): void {
  projectDBCache.delete(projectId);
}

/**
 * Get all cached project DB IDs
 */
export function getCachedProjectDBIds(): string[] {
  return Array.from(projectDBCache.keys());
}

// ─── Search Helpers ───────────────────────────────────────────────

export interface VectorSearchParams {
  query: string;
  embedding: number[];
  topK?: number;
  minScore?: number;
  filterType?: string;
}

/**
 * Hybrid search: combines vector similarity with full-text matching
 */
export async function hybridSearch<T extends Record<string, any>>(
  db: Orama<any>,
  params: VectorSearchParams
): Promise<(Results<T>['hits'][number] & { score: number })[]> {
  const { query, embedding, topK = 10, minScore = 0.3, filterType } = params;

  // Vector search
  const vectorResults = await search(db, {
    mode: 'vector',
    vector: {
      value: embedding,
      property: 'embedding',
    },
    limit: topK * 2, // Over-fetch to allow re-ranking
    ...(filterType ? { where: { type: filterType } } : {}),
  });

  // Full-text search (for exact matches)
  const textResults = await search(db, {
    mode: 'fulltext',
    term: query,
    limit: topK,
    properties: ['content'],
    ...(filterType ? { where: { type: filterType } } : {}),
  });

  // Merge and deduplicate by ID, boosting text matches slightly
  const merged = new Map<string, (typeof vectorResults.hits[number] & { score: number; textBoost: number })>();

  for (const hit of vectorResults.hits) {
    const id = hit.id as string;
    const score = (hit.score as number) || 0;
    merged.set(id, { ...hit, score, textBoost: 0 });
  }

  for (const hit of textResults.hits) {
    const id = hit.id as string;
    const existing = merged.get(id);
    if (existing) {
      // Boost score if found in both searches
      existing.score = Math.max(existing.score, (hit.score as number) || 0) * 1.1;
      existing.textBoost = 1;
    } else {
      merged.set(id, { ...hit, score: (hit.score as number) || 0, textBoost: 1 });
    }
  }

  // Sort by score descending, filter by threshold, limit
  return Array.from(merged.values())
    .filter((item) => item.score >= minScore)
    .sort((a, b) => b.score - a.score)
    .slice(0, topK)
    .map((item) => ({
      ...item,
      score: item.score,
      document: item.document as T,
    }));
}

// ─── Serialization ────────────────────────────────────────────────

/**
 * Serialize an Orama database to a JSON-compatible object for IndexedDB storage
 * Note: Orama doesn't have a built-in serialize, so we store individual documents
 */
export async function exportDocuments<T extends Record<string, any>>(
  db: Orama<any>
): Promise<T[]> {
  const allResults = await search(db, {
    mode: 'fulltext',
    term: '',
    limit: 100000,
  });

  return allResults.hits.map((hit) => hit.document as unknown as T);
}

/**
 * Import documents into an Orama database
 */
export async function importDocuments<T extends Record<string, any>>(
  db: Orama<any>,
  documents: T[]
): Promise<void> {
  for (const doc of documents) {
    try {
      await insert(db, doc as any);
    } catch (e) {
      console.warn(`Failed to import document:`, e);
    }
  }
}

/**
 * Serialize a database including its data for IndexedDB persistence
 */
export interface SerializedDB<T> {
  schemaId: string;
  documentCount: number;
  documents: T[];
  exportedAt: string;
}

export async function serializeDB<T extends Record<string, any>>(
  db: Orama<any>,
  schemaId: string
): Promise<SerializedDB<T>> {
  const documents = await exportDocuments<T>(db);

  return {
    schemaId,
    documentCount: documents.length,
    documents,
    exportedAt: new Date().toISOString(),
  };
}

export async function deserializeDB<T extends Record<string, any>>(
  db: Orama<any>,
  data: SerializedDB<T>
): Promise<void> {
  await importDocuments(db, data.documents);
}