import { atom } from 'nanostores';

/**
 * Per-provider rate-limit configuration.
 *
 * WHY THIS EXISTS
 * ---------------
 * Most LLM providers enforce three independent limits:
 *
 *   RPM  — Requests Per Minute    (immediate 429 if exceeded)
 *   TPM  — Tokens Per Minute      (input + output combined)
 *   RPD  — Requests Per Day       (cumulative; can block the user for HOURS)
 *
 * The model's "context window" (1M tokens for Gemini, 200k for Claude) is
 * almost ALWAYS larger than the provider's TPM cap. A Gemini model that
 * accepts 1M tokens but whose provider tier only allows 250k TPM will
 * reject (429) any request whose estimated token count exceeds 250k —
 * and on some providers (DeepSeek), repeated 429s trigger an account-level
 * cooldown that persists for hours even after the per-minute window resets.
 *
 * Rather than hardcoding limits (which we cannot reliably know — they vary
 * by tier, account, and payment status), we let the USER input their own
 * limits per provider. The server then:
 *
 *   1. Pre-flight: estimates the request's token count from message sizes
 *      and refuses to send if it would exceed the user's TPM cap, showing
 *      a helpful "would exceed your TPM limit of X" message instead.
 *   2. Throttle: enforces RPM by sleeping before the request if the user
 *      has fired too many requests in the last 60s.
 *   3. Auto-shrink: if the estimated token count > TPM, the server
 *      automatically reduces the context (via earlier summarization) to
 *      fit, rather than failing.
 *
 * VERIFIED DEFAULTS (2025-2026 official docs — see research notes):
 *
 *   Gemini Free:    2 RPM,  50 RPD, ~250k TPM
 *   Gemini Tier 1:  100 RPM, 1k RPD, ~250k TPM
 *   Anthropic T1:   50 RPM, 30k ITPM, 30k OTPM
 *   Anthropic T4:   1000+ RPM, 400k+ ITPM
 *   OpenAI T1:      500 RPM, 200k TPM
 *   OpenAI T5:      5000+ RPM, 10M+ TPM
 *   DeepSeek:       Concurrency-limited (no published RPM, but ~1 RPS)
 *   xAI T1:         60 RPM, 16k TPM
 *   xAI T2:         480 RPM, 2M TPM
 *   Mistral Free:   ~10 RPM, low TPM
 *   Groq Free:      30 RPM, 14400 RPD, 30k TPM
 *   OpenRouter Free: 20 RPM, 1000 RPD
 *   Cerebras Free:  50 RPM, 200k TPM
 *   Together:       60 RPM typical
 *   Fireworks Free: 10 RPM (6000 with card)
 *
 * These are SUGGESTED defaults — the user can override every value. The
 * store is persisted to localStorage.
 */

export interface RateLimitConfig {
  /** Requests per minute. 0 = unlimited (no throttle). */
  rpm: number;

  /** Tokens per minute (input + output combined). 0 = unlimited. */
  tpm: number;

  /** Requests per day. 0 = unlimited. */
  rpd: number;

  /** When true, the server auto-shrinks context to fit TPM instead of erroring. */
  autoShrinkToTpm: boolean;
}

export type RateLimitStore = Record<string, RateLimitConfig>;

const STORAGE_KEY = 'amplify:rate-limits';

/**
 * Suggested defaults per provider (the user can override).
 * Source: official docs as of 2025-2026 (see research notes above).
 */
export const SUGGESTED_DEFAULTS: Record<string, RateLimitConfig> = {
  Google: { rpm: 10, tpm: 250000, rpd: 1000, autoShrinkToTpm: true },
  Anthropic: { rpm: 50, tpm: 80000, rpd: 0, autoShrinkToTpm: true },
  OpenAI: { rpm: 500, tpm: 200000, rpd: 0, autoShrinkToTpm: true },
  Deepseek: { rpm: 60, tpm: 100000, rpd: 0, autoShrinkToTpm: true },
  xAI: { rpm: 60, tpm: 16000, rpd: 0, autoShrinkToTpm: true },
  Mistral: { rpm: 10, tpm: 50000, rpd: 0, autoShrinkToTpm: true },
  Groq: { rpm: 30, tpm: 30000, rpd: 14400, autoShrinkToTpm: true },
  OpenRouter: { rpm: 20, tpm: 200000, rpd: 1000, autoShrinkToTpm: true },
  Together: { rpm: 60, tpm: 100000, rpd: 0, autoShrinkToTpm: true },
  Fireworks: { rpm: 10, tpm: 100000, rpd: 0, autoShrinkToTpm: true },
  HuggingFace: { rpm: 30, tpm: 50000, rpd: 0, autoShrinkToTpm: true },
  Cerebras: { rpm: 50, tpm: 200000, rpd: 0, autoShrinkToTpm: true },
  Perplexity: { rpm: 50, tpm: 200000, rpd: 0, autoShrinkToTpm: true },
  Hyperbolic: { rpm: 30, tpm: 100000, rpd: 0, autoShrinkToTpm: true },
  Cohere: { rpm: 100, tpm: 100000, rpd: 0, autoShrinkToTpm: true },
  Github: { rpm: 30, tpm: 100000, rpd: 0, autoShrinkToTpm: true },
  AmazonBedrock: { rpm: 60, tpm: 100000, rpd: 0, autoShrinkToTpm: true },

  // Local providers — no limits.
  Ollama: { rpm: 0, tpm: 0, rpd: 0, autoShrinkToTpm: false },
  LMStudio: { rpm: 0, tpm: 0, rpd: 0, autoShrinkToTpm: false },
  OpenAILike: { rpm: 0, tpm: 0, rpd: 0, autoShrinkToTpm: false },
  Zai: { rpm: 60, tpm: 100000, rpd: 0, autoShrinkToTpm: true },
};

const DEFAULT_STORE: RateLimitStore = { ...SUGGESTED_DEFAULTS };

function readFromStorage(): RateLimitStore {
  if (typeof window === 'undefined') {
    return { ...DEFAULT_STORE };
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return { ...DEFAULT_STORE };
    }

    const parsed = JSON.parse(raw) as Partial<RateLimitStore>;

    /*
     * Merge — user's saved values override defaults, but new providers
     * added in updates still get their suggested default. Strip any
     * undefined entries (from older partial saves) before merging so
     * the result type stays clean.
     */
    const parsedClean: RateLimitStore = {};

    for (const [k, v] of Object.entries(parsed)) {
      if (v) {
        parsedClean[k] = v;
      }
    }

    return { ...DEFAULT_STORE, ...parsedClean };
  } catch {
    return { ...DEFAULT_STORE };
  }
}

function writeToStorage(value: RateLimitStore) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export const rateLimitStore = atom<RateLimitStore>(readFromStorage());

rateLimitStore.listen((value) => {
  writeToStorage(value);
});

/**
 * Wire format sent to the server. Only includes the CURRENT provider's
 * config (the server doesn't need every provider's settings).
 */
export function getRateLimitWire(providerName: string): RateLimitConfig | undefined {
  return rateLimitStore.get()[providerName];
}

/** Update a single provider's rate-limit config. */
export function updateRateLimit(providerName: string, patch: Partial<RateLimitConfig>) {
  const current = rateLimitStore.get();
  const existing = current[providerName] ??
    SUGGESTED_DEFAULTS[providerName] ?? {
      rpm: 0,
      tpm: 0,
      rpd: 0,
      autoShrinkToTpm: false,
    };

  rateLimitStore.set({
    ...current,
    [providerName]: { ...existing, ...patch },
  });
}

/** Reset a single provider's config back to the suggested default. */
export function resetRateLimit(providerName: string) {
  const current = rateLimitStore.get();
  const next = { ...current };

  if (SUGGESTED_DEFAULTS[providerName]) {
    next[providerName] = { ...SUGGESTED_DEFAULTS[providerName] };
  } else {
    delete next[providerName];
  }

  rateLimitStore.set(next);
}
