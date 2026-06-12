/**
 * Embedding Service — Client-side service for generating embeddings
 * 
 * Communicates with the embedding mini-service at port 3020.
 * Falls back to direct API calls if the mini-service is unavailable.
 */

import type { EmbeddingRequest, EmbeddingResponse, EmbeddingBatchRequest, EmbeddingBatchResponse, EmbeddingHealthResponse } from './types';

const EMBEDDING_SERVICE_URL = '/?XTransformPort=3020';

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
   * Check if the embedding service is available
   */
  async isAvailable(): Promise<boolean> {
    if (this.available !== null) return this.available;

    try {
      const controller = new AbortController();
      const timeout = setTimeout(() => controller.abort(), 3000);

      const res = await fetch(`${EMBEDDING_SERVICE_URL}/health`, {
        signal: controller.signal,
      });
      clearTimeout(timeout);

      this.available = res.ok;
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
      embedding = new Array(1536).fill(0);
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
        results[idx] = new Array(1536).fill(0);
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
    const res = await fetch(`${EMBEDDING_SERVICE_URL}/embed`, {
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
    return data.embedding;
  }

  private async embedBatchViaService(texts: string[]): Promise<number[][]> {
    const res = await fetch(`${EMBEDDING_SERVICE_URL}/embed-batch`, {
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

    const data = await res.json();
    return data.data[0].embedding;
  }
}

export const embeddingService = EmbeddingService.getInstance();