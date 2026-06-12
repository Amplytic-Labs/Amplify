/**
 * Embedding Service — Client-side service for generating embeddings
 * 
 * Communicates with the embedding mini-service at port 3020.
 * Falls back to direct API calls if the mini-service is unavailable.
 */

import type { EmbeddingRequest, EmbeddingResponse, EmbeddingBatchRequest, EmbeddingBatchResponse, EmbeddingHealthResponse } from './types';
import { getEmbeddingDimensions, setEmbeddingDimensions } from './types';

const EMBEDDING_PORT = 3020;

function embedUrl(path: string): string {
  return `${path}?XTransformPort=${EMBEDDING_PORT}`;
}

// In-memory cache for embeddings
const embeddingCache = new Map<string, number[]>();
const MAX_CACHE_SIZE = 5000;

// Request queue for batching
let batchQueue: { text: string; resolve: (embedding: number[]) => void; reject: (err: Error) => void }[] = [];
let batchTimer: ReturnType<typeof setTimeout> | null = null;
const BATCH_INTERVAL_MS = 50;

export class EmbeddingService {
  private static instance: EmbeddingService;
  private provider: string = 'openai';
  private model: string = 'text-embedding-3-small';
  private apiKey: string = '';
  private baseUrl: string = '';
  private available: boolean | null = null;
  private knownDimensions: number | null = null;

  private constructor() {}

  static getInstance(): EmbeddingService {
    if (!EmbeddingService.instance) {
      EmbeddingService.instance = new EmbeddingService();
    }
    return EmbeddingService.instance;
  }

  /**
   * Configure the embedding service
   */
  configure(config: { provider?: string; model?: string; apiKey?: string; baseUrl?: string }): void {
    if (config.provider) this.provider = config.provider;
    if (config.model) this.model = config.model;
    if (config.apiKey) this.apiKey = config.apiKey;
    if (config.baseUrl) this.baseUrl = config.baseUrl;
  }

  /**
   * Get the known embedding dimension. Returns the tracked dimension if
   * available, otherwise falls back to the global default (1536).
   */
  getDimensions(): number {
    return this.knownDimensions ?? getEmbeddingDimensions();
  }

  /**
   * Check if the embedding service is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(embedUrl('/health'), {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      this.available = res.ok;

      // Parse dimensions from health response to update schema before any DB is created
      if (res.ok) {
        try {
          const health = (await res.json()) as EmbeddingHealthResponse;
          if (health.dimensions && health.dimensions > 0) {
            this.knownDimensions = health.dimensions;
            setEmbeddingDimensions(health.dimensions);
          }
        } catch {
          // Non-critical: dimensions will be learned from the first embed call
        }
      }

      return this.available;
    } catch {
      this.available = false;
      return false;
    }
  }

  /**
   * Generate an embedding for a single text
   */
  async embed(text: string): Promise<number[]> {
    // Check cache first
    const cacheKey = this.getCacheKey(text);
    const cached = embeddingCache.get(cacheKey);
    if (cached) return cached;

    let embedding: number[];

    try {
      // Try mini-service first
      if (await this.isAvailable()) {
        embedding = await this.embedViaService(text);
      } else {
        // Fallback: direct API call
        embedding = await this.embedDirectly(text);
      }
    } catch (error) {
      console.error('Embedding generation failed:', error);
      // Return a zero vector as absolute fallback
      embedding = new Array(this.getDimensions()).fill(0);
    }

    // Cache the result
    this.cacheEmbedding(cacheKey, embedding);
    return embedding;
  }

  /**
   * Generate embeddings for multiple texts (batched for efficiency)
   */
  async embedBatch(texts: string[]): Promise<number[][]> {
    // Check cache for all texts first
    const results: number[][] = [];
    const uncachedIndices: number[] = [];
    const uncachedTexts: string[] = [];

    for (let i = 0; i < texts.length; i++) {
      const cacheKey = this.getCacheKey(texts[i]);
      const cached = embeddingCache.get(cacheKey);
      if (cached) {
        results[i] = cached;
      } else {
        results[i] = []; // placeholder
        uncachedIndices.push(i);
        uncachedTexts.push(texts[i]);
      }
    }

    if (uncachedTexts.length === 0) return results;

    try {
      let embeddings: number[][];

      if (await this.isAvailable()) {
        embeddings = await this.embedBatchViaService(uncachedTexts);
      } else {
        // Fallback: embed one by one
        embeddings = await Promise.all(uncachedTexts.map((t) => this.embedDirectly(t)));
      }

      for (let i = 0; i < uncachedIndices.length; i++) {
        const idx = uncachedIndices[i];
        results[idx] = embeddings[i];
        this.cacheEmbedding(this.getCacheKey(uncachedTexts[i]), embeddings[i]);
      }
    } catch (error) {
      console.error('Batch embedding failed:', error);
      for (const idx of uncachedIndices) {
        results[idx] = new Array(this.getDimensions()).fill(0);
      }
    }

    return results;
  }

  /**
   * Get cached embedding without making an API call
   */
  getCached(text: string): number[] | undefined {
    return embeddingCache.get(this.getCacheKey(text));
  }

  /**
   * Clear the embedding cache
   */
  clearCache(): void {
    embeddingCache.clear();
  }

  getCacheStats(): { size: number; maxSize: number } {
    return { size: embeddingCache.size, maxSize: MAX_CACHE_SIZE };
  }

  // ─── Private Methods ─────────────────────────────────────

  private getCacheKey(text: string): string {
    return text.trim().toLowerCase().slice(0, 500);
  }

  private cacheEmbedding(key: string, embedding: number[]): void {
    // Evict old entries if cache is full (simple FIFO)
    if (embeddingCache.size >= MAX_CACHE_SIZE) {
      const firstKey = embeddingCache.keys().next().value;
      if (firstKey) embeddingCache.delete(firstKey);
    }
    embeddingCache.set(key, embedding);
  }

  private async embedViaService(text: string): Promise<number[]> {
    const res = await fetch(embedUrl('/embed'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        text,
        model: this.model,
        provider: this.provider,
        apiKey: this.apiKey,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Embedding service error: ${err}`);
    }

    const data: EmbeddingResponse = await res.json();
    // Track actual dimensions for Orama schema compatibility
    if (data.dimensions && data.dimensions > 0) {
      this.knownDimensions = data.dimensions;
      setEmbeddingDimensions(data.dimensions);
    }
    return data.embedding;
  }

  private async embedBatchViaService(texts: string[]): Promise<number[][]> {
    const res = await fetch(embedUrl('/embed-batch'), {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        texts,
        model: this.model,
        provider: this.provider,
        apiKey: this.apiKey,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Embedding service error: ${err}`);
    }

    const data: EmbeddingBatchResponse = await res.json();
    // Track actual dimensions for Orama schema compatibility
    if (data.dimensions && data.dimensions > 0) {
      this.knownDimensions = data.dimensions;
      setEmbeddingDimensions(data.dimensions);
    }
    return data.embeddings;
  }

  private async embedDirectly(text: string): Promise<number[]> {
    // Direct OpenAI-compatible API call
    const baseUrl = this.baseUrl || 'https://api.openai.com/v1';

    const res = await fetch(`${baseUrl}/embeddings`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${this.apiKey}`,
      },
      body: JSON.stringify({
        model: this.model,
        input: text,
      }),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Direct embedding API error: ${err}`);
    }

    const data: { data: Array<{ embedding: number[] }> } = await res.json();
    const embedding = data.data[0].embedding;
    // Track actual dimensions for Orama schema compatibility
    if (embedding && embedding.length > 0) {
      this.knownDimensions = embedding.length;
      setEmbeddingDimensions(embedding.length);
    }
    return embedding;
  }
}

export const embeddingService = EmbeddingService.getInstance();