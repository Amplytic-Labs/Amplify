/**
 * Vector Store Type Definitions
 * Shared types for User Profile Store, Project Context Store, and Embedding Service
 */

// ─── Embedding Types ───────────────────────────────────────────────

export interface EmbeddingRequest {
  text: string;
  model?: string;
  provider?: string;
  apiKey?: string;
}

export interface EmbeddingBatchRequest {
  texts: string[];
  model?: string;
  provider?: string;
  apiKey?: string;
}

export interface EmbeddingResponse {
  embedding: number[];
  model: string;
  dimensions: number;
}

export interface EmbeddingBatchResponse {
  embeddings: number[][];
  model: string;
  dimensions: number;
}

export interface EmbeddingHealthResponse {
  status: 'ok' | 'error';
  model: string;
  cacheSize: number;
  provider: string;
  dimensions?: number;
}

// ─── User Profile Types ────────────────────────────────────────────

export type UserProfileCategory = 'preference' | 'behavior' | 'fact' | 'feedback' | 'skill-level';

export interface UserProfileEntry {
  id: string;
  type: UserProfileCategory;
  content: string;
  embedding?: number[];
  sourceChatId?: string;
  confidence: number;
  lastReferencedAt?: string;
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface UserProfileSearchResult extends UserProfileEntry {
  score: number;
}

export interface UserProfileSearchOptions {
  topK?: number;
  minScore?: number;
  category?: UserProfileCategory[];
  includeAllCategories?: boolean;
}

// ─── Project Context Types ─────────────────────────────────────────

export type ProjectContextType = 'decision' | 'error' | 'pattern' | 'requirement' | 'architecture' | 'fix' | 'dont';

export interface ProjectContextEntry {
  id: string;
  type: ProjectContextType;
  content: string;
  embedding?: number[];
  sourceChatId?: string;
  sourcePointId?: string;
  filePaths?: string[];
  metadata?: {
    error?: string;
    fix?: string;
    reason?: string;
    severity?: 'critical' | 'major' | 'minor';
  };
  accessCount: number;
  createdAt: string;
  updatedAt: string;
}

export interface ProjectContextSearchResult extends ProjectContextEntry {
  score: number;
}

export interface ProjectContextSearchOptions {
  topK?: number;
  minScore?: number;
  types?: ProjectContextType[];
}

// ─── Vector Store Configuration ────────────────────────────────────

export interface VectorStoreConfig {
  embeddingDimensions: number;
  similarityThreshold: number;
  maxEntries: number;
  persistDebounceMs: number;
}

export const DEFAULT_VECTOR_CONFIG: VectorStoreConfig = {
  embeddingDimensions: 1536,
  similarityThreshold: 0.6,
  maxEntries: 10000,
  persistDebounceMs: 2000,
};

// ─── Runtime Dimension Tracking ────────────────────────────────────
// Mutable: the embedding service updates this after the first successful
// embed call so that Orama schemas can be created with the right size.

let _currentEmbeddingDimensions: number = DEFAULT_VECTOR_CONFIG.embeddingDimensions;

/** Get the current embedding dimension (updated dynamically by the embedding service). */
export function getEmbeddingDimensions(): number {
  return _currentEmbeddingDimensions;
}

/** Update the known embedding dimension (called by the embedding service). */
export function setEmbeddingDimensions(dims: number): void {
  if (dims > 0 && dims !== _currentEmbeddingDimensions) {
    console.warn(`[VectorStore] Embedding dimensions changed from ${_currentEmbeddingDimensions} to ${dims}`);
    _currentEmbeddingDimensions = dims;
  }
}

// ─── Store Stats ───────────────────────────────────────────────────

export interface StoreStats {
  totalEntries: number;
  entriesByType: Record<string, number>;
  lastUpdated: string;
  sizeBytes?: number;
}