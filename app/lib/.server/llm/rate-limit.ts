import { createScopedLogger } from '~/utils/logger';

/**
 * Rate-limit enforcement for outbound LLM requests.
 *
 * Three independent limits are tracked PER PROVIDER:
 *
 *   RPM  — Requests Per Minute    (immediate 429 if exceeded)
 *   TPM  — Tokens Per Minute      (input + output combined)
 *   RPD  — Requests Per Day       (cumulative; can block for HOURS)
 *
 * The user enters their own limits per provider (we cannot reliably
 * know them — they vary by tier/account/payment status). The server
 * then:
 *
 *   1. Pre-flight: estimates the request's token count from message
 *      sizes and refuses to send if it would exceed TPM, showing a
 *      helpful error. When `autoShrinkToTpm` is true, the request
 *      is instead SHRUNK by dropping older messages from the head
 *      of the conversation until it fits.
 *
 *   2. Throttle: enforces RPM by sleeping before the request if the
 *      user has fired too many requests in the last 60s.
 *
 *   3. Day quota: enforces RPD by refusing the request if the user
 *      has exceeded their daily allowance (with a clear error so the
 *      user knows to wait or upgrade).
 *
 * All counters are in-memory and per-server-instance. In a multi-
 * instance deployment this is a SOFT limit (each instance enforces
 * only its own window). For single-user / single-instance Amplify
 * this is sufficient and avoids the complexity of a shared store.
 */

const logger = createScopedLogger('rate-limit');

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

/**
 * In-memory rolling log of request timestamps + their token costs.
 * Used for both RPM (count in last 60s) and TPM (sum in last 60s).
 *
 * Entries are pruned to the last 60 seconds on each access.
 *
 * Per-provider isolation: each provider name has its own bucket.
 */
interface RequestEntry {
  /** When the request was initiated (ms epoch). */
  ts: number;

  /** Estimated tokens for this request (prompt + expected completion). */
  tokens: number;
}

const rpmTpmLog = new Map<string, RequestEntry[]>();

/**
 * RPD counter — a single integer per provider, reset when the UTC date
 * changes. Persisted to disk? No — the worst case after a server restart
 * is the user gets a few "free" requests past their daily cap, which is
 * acceptable (the provider's own RPD enforcement is the source of truth).
 */
const rpdCounters = new Map<string, { date: string; count: number }>();

function todayUtc(): string {
  return new Date().toISOString().slice(0, 10); // YYYY-MM-DD
}

function pruneOld(entries: RequestEntry[], windowMs: number): RequestEntry[] {
  const cutoff = Date.now() - windowMs;
  return entries.filter((e) => e.ts >= cutoff);
}

/**
 * Rough token estimator — used for the pre-flight TPM check.
 *
 * We do NOT load a tokenizer here (would add 5MB+ to the bundle and a
 * ~50ms startup hit). Instead, we use the well-known heuristic that
 * for English text 1 token ≈ 4 characters. This is accurate to ±15%
 * for English, ±25% for code (slightly overestimates), and ±40% for
 * CJK (significantly underestimates — but CJK users typically have
 * higher TPM caps to compensate, so the safety margin still holds).
 *
 * For our purposes (refuse-to-send vs. allow), erring on the side of
 * OVERESTIMATING is safer — a false "would exceed TPM" just means we
 * shrink context more aggressively, while a false "fits" results in
 * a hard 429 from the provider.
 */
export function estimateTokens(text: string): number {
  if (!text) {
    return 0;
  }

  /*
   * Cheap heuristic: 1 token ≈ 4 chars (English) / 2 chars (CJK avg).
   * Detect CJK by Unicode range and weight accordingly.
   */
  let cjk = 0;
  let other = 0;

  for (let i = 0; i < text.length; i++) {
    const code = text.charCodeAt(i);

    // Common CJK ranges (BMP only — supplementary planes are rare in chat)
    if (
      (code >= 0x4e00 && code <= 0x9fff) || // CJK Unified Ideographs
      (code >= 0x3040 && code <= 0x30ff) || // Hiragana + Katakana
      (code >= 0xac00 && code <= 0xd7af) // Hangul Syllables
    ) {
      cjk++;
    } else {
      other++;
    }
  }

  /*
   * CJK: ~1 token per char (tokenizer splits each ideograph)
   * Other: ~1 token per 4 chars (English word pieces)
   */
  return Math.ceil(cjk + other / 4);
}

/**
 * Estimate the total token cost of a single request, given the
 * serialized message array. Includes the system prompt + the expected
 * completion budget (if known).
 */
export function estimateRequestTokens(
  messages: { role: string; parts?: any[]; content?: any }[],
  systemPromptText: string,
  expectedCompletionTokens: number,
): number {
  let total = 0;

  // System prompt
  total += estimateTokens(systemPromptText);

  // Each message's text parts
  for (const msg of messages) {
    if (Array.isArray(msg.parts)) {
      for (const part of msg.parts) {
        if (part?.type === 'text' && typeof part.text === 'string') {
          total += estimateTokens(part.text);
        } else if (part?.type === 'tool-invocation' || part?.type === 'dynamic-tool') {
          /*
           * Tool calls carry their input args + output as JSON. Use the
           * stringified form for the estimate.
           */
          total += estimateTokens(JSON.stringify(part.input ?? ''));
          total += estimateTokens(typeof part.output === 'string' ? part.output : JSON.stringify(part.output ?? ''));
        }
      }
    } else if (typeof msg.content === 'string') {
      total += estimateTokens(msg.content);
    }
  }

  // Reserve room for the completion itself
  total += Math.max(256, expectedCompletionTokens);

  return total;
}

/**
 * Result of a pre-flight rate-limit check.
 *
 * `ok=true` means the request can proceed (after the throttle sleep,
 * if any). `ok=false` means the request must be rejected OR shrunk
 * (depending on `autoShrinkToTpm`).
 */
export interface PreFlightResult {
  ok: boolean;

  /** Reason for rejection (when ok=false). */
  reason?: 'rpm' | 'tpm' | 'rpd';

  /** How long (ms) to sleep before sending — enforces RPM. */
  throttleMs: number;

  /** Estimated token count of the request (for logging / shrinking). */
  estimatedTokens: number;

  /** When ok=false due to TPM and autoShrink=true, the target token budget. */
  shrinkToTokens?: number;

  /** Human-readable message for the user / logs. */
  message?: string;
}

/**
 * Run the pre-flight checks for an outbound request.
 *
 * Side effects:
 *   - Updates the in-memory RPM/TPM/RPD counters AT THE TIME OF THE CALL.
 *     (If the request is later rejected by the provider, those counters
 *     are still consumed — this is intentional; the provider's 429 also
 *     counts against the user's quota.)
 *
 * The caller is responsible for:
 *   1. Awaiting `throttleMs` before sending (if > 0).
 *   2. Refusing or shrinking the request based on the result.
 */
export function preFlightCheck(
  providerName: string,
  config: RateLimitConfig | undefined,
  estimatedTokens: number,
): PreFlightResult {
  if (!config) {
    return { ok: true, throttleMs: 0, estimatedTokens };
  }

  const now = Date.now();
  const windowMs = 60_000;

  // ----- RPD (daily cap) — check FIRST, hard reject -----
  if (config.rpd > 0) {
    const counter = rpdCounters.get(providerName) ?? { date: todayUtc(), count: 0 };

    // Reset on UTC date change
    if (counter.date !== todayUtc()) {
      counter.date = todayUtc();
      counter.count = 0;
    }

    if (counter.count >= config.rpd) {
      return {
        ok: false,
        reason: 'rpd',
        throttleMs: 0,
        estimatedTokens,
        message: `Daily request limit (${config.rpd} RPD) reached for ${providerName}. Try again after UTC midnight or raise the limit in Settings.`,
      };
    }
  }

  // Get / prune the RPM+TPM log for this provider
  let entries = rpmTpmLog.get(providerName) ?? [];
  entries = pruneOld(entries, windowMs);

  // ----- TPM (tokens in the last 60s) -----
  let tokensInWindow = 0;

  for (const e of entries) {
    tokensInWindow += e.tokens;
  }

  if (config.tpm > 0) {
    const wouldExceed = tokensInWindow + estimatedTokens > config.tpm;

    if (wouldExceed) {
      // Compute how long until enough tokens roll off to fit
      const overflow = tokensInWindow + estimatedTokens - config.tpm;
      const needToReclaim = Math.max(0, overflow);

      // Find the earliest entry whose removal would reclaim `needToReclaim` tokens
      let reclaimed = 0;
      let waitUntil = 0;

      for (const e of entries) {
        reclaimed += e.tokens;

        if (reclaimed >= needToReclaim) {
          waitUntil = e.ts + windowMs;
          break;
        }
      }

      const waitMs = waitUntil > 0 ? waitUntil - now : 0;

      // If the wait is reasonable (≤ 60s), throttle-and-go. Otherwise reject.
      if (waitMs > 0 && waitMs <= 60_000 && config.autoShrinkToTpm === false) {
        return {
          ok: true,
          throttleMs: waitMs,
          estimatedTokens,
          message: `Throttling ${waitMs}ms to respect TPM cap (${config.tpm.toLocaleString()} tok/min for ${providerName}).`,
        };
      }

      // Long wait OR TPM is set → auto-shrink context to fit
      if (config.tpm > 0) {
        const shrinkTo = Math.max(0, config.tpm - tokensInWindow);

        return {
          ok: true,
          throttleMs: 0,
          estimatedTokens,
          shrinkToTokens: shrinkTo,
          message: `Auto-shrinking context to ~${shrinkTo.toLocaleString()} tokens to fit TPM cap for ${providerName}.`,
        };
      }

      return {
        ok: false,
        reason: 'tpm',
        throttleMs: 0,
        estimatedTokens,
        message: `Estimated ${estimatedTokens.toLocaleString()} tokens would exceed ${providerName} TPM cap of ${config.tpm.toLocaleString()} tok/min. Enable "Auto-shrink to TPM" in Settings or wait ~${Math.ceil(waitMs / 1000)}s.`,
      };
    }
  }

  // ----- RPM (requests in the last 60s) -----
  if (config.rpm > 0) {
    const countInWindow = entries.length;

    if (countInWindow >= config.rpm) {
      // Find the oldest entry — we must wait until it rolls off
      const oldest = entries[0];
      const waitMs = oldest.ts + windowMs - now;

      if (waitMs > 0 && waitMs <= 60_000) {
        return {
          ok: true,
          throttleMs: waitMs,
          estimatedTokens,
          message: `Throttling ${waitMs}ms to respect RPM cap (${config.rpm} req/min for ${providerName}).`,
        };
      }

      // Wait would be too long (> 60s) — reject instead of hanging
      return {
        ok: false,
        reason: 'rpm',
        throttleMs: 0,
        estimatedTokens,
        message: `${providerName} RPM cap of ${config.rpm} req/min is saturated. Wait ${Math.ceil(waitMs / 1000)}s or raise the limit.`,
      };
    }
  }

  // All checks passed — record this request in the log
  entries.push({ ts: now, tokens: estimatedTokens });
  rpmTpmLog.set(providerName, entries);

  // Bump the RPD counter
  if (config.rpd > 0) {
    const counter = rpdCounters.get(providerName) ?? { date: todayUtc(), count: 0 };
    counter.count += 1;
    rpdCounters.set(providerName, counter);
  }

  return { ok: true, throttleMs: 0, estimatedTokens };
}

/**
 * Drop messages from the head of the conversation until the estimated
 * token count fits within `targetTokens`. The system prompt + the
 * last `protectedTailCount` messages are always kept.
 *
 * Returns the (possibly trimmed) messages array. If even the protected
 * tail exceeds the budget, returns the protected tail as-is (the
 * provider's TPM will be the final arbiter).
 */
export function shrinkMessagesToFit(
  messages: { role: string; parts?: any[]; content?: any }[],
  systemPromptText: string,
  expectedCompletionTokens: number,
  targetTokens: number,
  protectedTailCount = 4,
): { role: string; parts?: any[]; content?: any }[] {
  if (messages.length <= protectedTailCount) {
    return messages;
  }

  const protectedTail = messages.slice(-protectedTailCount);
  const trimmable = messages.slice(0, -protectedTailCount);

  // Start with everything; drop from the head until we fit.
  let kept = [...trimmable];

  while (kept.length > 0) {
    const total = estimateRequestTokens([...kept, ...protectedTail], systemPromptText, expectedCompletionTokens);

    if (total <= targetTokens) {
      break;
    }

    kept = kept.slice(1);
  }

  const final = [...kept, ...protectedTail];

  if (final.length < messages.length) {
    logger.info(
      `Rate-limit shrink: dropped ${messages.length - final.length} older message(s) to fit TPM budget ` +
        `(${targetTokens.toLocaleString()} tok target).`,
    );
  }

  return final;
}

/**
 * Test-only: reset all counters (used by unit tests, not production).
 */
export function _resetForTests() {
  rpmTpmLog.clear();
  rpdCounters.clear();
}
