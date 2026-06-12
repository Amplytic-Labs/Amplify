import { createHash } from "crypto";
import { EmbeddingCache } from "./cache.ts";

const cache = new EmbeddingCache();

const DEFAULT_MODEL = "text-embedding-3-small";
const OPENAI_BASE_URL = "https://api.openai.com";
const OLLAMA_BASE_URL = "http://localhost:11434";
const OLLAMA_MODEL = "nomic-embed-text";

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

function hashText(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

function json(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: {
      "Content-Type": "application/json",
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "Content-Type, Authorization",
    },
  });
}

function error(message: string, status = 500): Response {
  return json({ error: message }, status);
}

// ---------------------------------------------------------------------------
// Provider implementations
// ---------------------------------------------------------------------------

async function embedOpenAI(
  text: string,
  model: string,
  baseUrl: string,
  apiKey: string,
): Promise<number[]> {
  const url = `${baseUrl}/v1/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: text, model }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI embedding failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    data: { embedding: number[] }[];
  };
  return data.data[0].embedding;
}

async function embedOpenAIBatch(
  texts: string[],
  model: string,
  baseUrl: string,
  apiKey: string,
): Promise<number[][]> {
  const url = `${baseUrl}/v1/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ input: texts, model }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`OpenAI batch embedding failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as {
    data: { embedding: number[]; index: number }[];
  };
  // Sort by index to guarantee order
  const sorted = data.data.sort((a, b) => a.index - b.index);
  return sorted.map((d) => d.embedding);
}

async function embedOllama(
  text: string,
  model = OLLAMA_MODEL,
): Promise<number[]> {
  const url = `${OLLAMA_BASE_URL}/api/embeddings`;
  const res = await fetch(url, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ model, prompt: text }),
  });

  if (!res.ok) {
    const body = await res.text();
    throw new Error(`Ollama embedding failed (${res.status}): ${body}`);
  }

  const data = (await res.json()) as { embedding: number[] };
  return data.embedding;
}

// ---------------------------------------------------------------------------
// Embed with fallback chain
// ---------------------------------------------------------------------------

type Provider = "openai" | "ollama";

async function embedWithFallback(
  text: string,
  provider: Provider,
  model: string,
  apiKey: string,
  baseUrl: string,
): Promise<{ embedding: number[]; usedProvider: Provider; usedModel: string }> {
  const errors: string[] = [];

  // 1) Try the requested provider first
  try {
    if (provider === "openai") {
      const embedding = await embedOpenAI(text, model, baseUrl, apiKey);
      return { embedding, usedProvider: "openai", usedModel: model };
    } else {
      const embedding = await embedOllama(text, model);
      return { embedding, usedProvider: "ollama", usedModel: model };
    }
  } catch (err) {
    errors.push(`${provider}: ${(err as Error).message}`);
  }

  // 2) Fallback to Ollama (unless that was already the primary)
  if (provider !== "ollama") {
    try {
      const embedding = await embedOllama(text);
      return { embedding, usedProvider: "ollama", usedModel: OLLAMA_MODEL };
    } catch (err) {
      errors.push(`ollama: ${(err as Error).message}`);
    }
  }

  // 3) Fallback to OpenAI (unless that was already the primary)
  if (provider !== "openai") {
    try {
      const embedding = await embedOpenAI(text, DEFAULT_MODEL, OPENAI_BASE_URL, apiKey);
      return { embedding, usedProvider: "openai", usedModel: DEFAULT_MODEL };
    } catch (err) {
      errors.push(`openai: ${(err as Error).message}`);
    }
  }

  throw new Error(`All providers failed:\n  ${errors.join("\n  ")}`);
}

// ---------------------------------------------------------------------------
// Routes
// ---------------------------------------------------------------------------

async function handleHealth(): Promise<Response> {
  return json({
    status: "ok",
    model: DEFAULT_MODEL,
    cacheSize: cache.size,
    provider: "openai",
  });
}

async function handleEmbed(body: Record<string, unknown>): Promise<Response> {
  if (typeof body.text !== "string" || body.text.length === 0) {
    return error("Missing or empty 'text' field", 400);
  }

  const text: string = body.text;
  const model: string =
    typeof body.model === "string" ? body.model : DEFAULT_MODEL;
  const provider: Provider =
    body.provider === "ollama" ? "ollama" : "openai";
  const apiKey: string =
    typeof body.apiKey === "string" ? body.apiKey : process.env.OPENAI_API_KEY ?? "";
  const baseUrl: string =
    typeof body.baseUrl === "string"
      ? body.baseUrl
      : process.env.OPENAI_BASE_URL ?? OPENAI_BASE_URL;

  // Check cache
  const key = hashText(`${provider}:${model}:${text}`);
  const cached = cache.get(key);
  if (cached) {
    return json({ embedding: cached, model, dimensions: cached.length });
  }

  // Call provider(s)
  const result = await embedWithFallback(text, provider, model, apiKey, baseUrl);

  // Store in cache
  cache.set(key, result.embedding);

  return json({
    embedding: result.embedding,
    model: result.usedModel,
    dimensions: result.embedding.length,
  });
}

async function handleEmbedBatch(body: Record<string, unknown>): Promise<Response> {
  if (!Array.isArray(body.texts) || body.texts.length === 0) {
    return error("Missing or empty 'texts' array", 400);
  }

  const texts: string[] = body.texts;
  const model: string =
    typeof body.model === "string" ? body.model : DEFAULT_MODEL;
  const provider: Provider =
    body.provider === "ollama" ? "ollama" : "openai";
  const apiKey: string =
    typeof body.apiKey === "string" ? body.apiKey : process.env.OPENAI_API_KEY ?? "";
  const baseUrl: string =
    typeof body.baseUrl === "string"
      ? body.baseUrl
      : process.env.OPENAI_BASE_URL ?? OPENAI_BASE_URL;

  // Check cache for each text
  const embeddings: (number[] | null)[] = texts.map((t) => {
    const key = hashText(`${provider}:${model}:${t}`);
    return cache.get(key) ?? null;
  });

  // Identify uncached indices
  const uncachedIndices: number[] = [];
  for (let i = 0; i < texts.length; i++) {
    if (embeddings[i] === null) uncachedIndices.push(i);
  }

  // Fetch uncached embeddings
  if (uncachedIndices.length > 0) {
    try {
      if (provider === "openai") {
        const uncachedTexts = uncachedIndices.map((i) => texts[i]);
        const results = await embedOpenAIBatch(
          uncachedTexts,
          model,
          baseUrl,
          apiKey,
        );
        for (let j = 0; j < results.length; j++) {
          const idx = uncachedIndices[j];
          embeddings[idx] = results[j];
          const key = hashText(`${provider}:${model}:${texts[idx]}`);
          cache.set(key, results[j]);
        }
      } else {
        // Ollama: parallel individual requests
        const results = await Promise.all(
          uncachedIndices.map(async (idx) => {
            const emb = await embedOllama(texts[idx], model);
            return { idx, emb };
          }),
        );
        for (const { idx, emb } of results) {
          embeddings[idx] = emb;
          const key = hashText(`${provider}:${model}:${texts[idx]}`);
          cache.set(key, emb);
        }
      }
    } catch (err) {
      // On batch failure, try fallback for each uncached individually
      for (const idx of uncachedIndices) {
        try {
          const result = await embedWithFallback(
            texts[idx],
            provider,
            model,
            apiKey,
            baseUrl,
          );
          embeddings[idx] = result.embedding;
          const key = hashText(`${provider}:${model}:${texts[idx]}`);
          cache.set(key, result.embedding);
        } catch (singleErr) {
          throw new Error(
            `Failed to embed text at index ${idx}: ${(singleErr as Error).message}`,
          );
        }
      }
    }
  }

  const finalEmbeddings = embeddings as number[][];
  return json({
    embeddings: finalEmbeddings,
    model,
    dimensions: finalEmbeddings[0]?.length ?? 0,
  });
}

async function handleModels(): Promise<Response> {
  return json({
    models: {
      openai: [
        "text-embedding-3-small",
        "text-embedding-3-large",
        "text-embedding-ada-002",
      ],
      ollama: ["nomic-embed-text", "mxbai-embed-large", "all-minilm"],
    },
  });
}

// ---------------------------------------------------------------------------
// Server
// ---------------------------------------------------------------------------

Bun.serve({
  port: 3020,
  async fetch(req) {
    const url = new URL(req.url);

    // CORS preflight
    if (req.method === "OPTIONS") {
      return new Response(null, {
        status: 204,
        headers: {
          "Access-Control-Allow-Origin": "*",
          "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
          "Access-Control-Allow-Headers": "Content-Type, Authorization",
        },
      });
    }

    try {
      // GET /health
      if (url.pathname === "/health" && req.method === "GET") {
        return await handleHealth();
      }

      // GET /models
      if (url.pathname === "/models" && req.method === "GET") {
        return await handleModels();
      }

      // POST /embed
      if (url.pathname === "/embed" && req.method === "POST") {
        const body = (await req.json()) as Record<string, unknown>;
        return await handleEmbed(body);
      }

      // POST /embed-batch
      if (url.pathname === "/embed-batch" && req.method === "POST") {
        const body = (await req.json()) as Record<string, unknown>;
        return await handleEmbedBatch(body);
      }

      return error("Not found", 404);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return error(`Internal server error: ${message}`, 500);
    }
  },
});

console.log("Embedding service running on http://localhost:3020");