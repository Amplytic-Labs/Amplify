import type { ModelConfigWire, ReasoningEffort } from '~/lib/stores/model-config';

/**
 * Server-side thinking / reasoning translator — converts the unified
 * `ModelConfigWire` (edited by the ChatBox settings popup) into the
 * per-provider `providerOptions` shape the Vercel AI SDK expects.
 *
 * VERIFIED RESEARCH (2025-2026):
 *
 *   Google Gemini 2.5  →  providerOptions.google.thinkingConfig
 *                          { thinkingBudget: 0..N, includeThoughts: true }
 *                          - thinkingBudget=0 disables thinking on 2.5
 *                          - includeThoughts=true is REQUIRED to receive
 *                            thought summaries in the response. Without it
 *                            Gemini thinks internally but returns zero
 *                            reasoning parts to the client.
 *                          Source: ai.google.dev/gemini-api/docs/generate-content/thinking
 *
 *   Google Gemini 3.x  →  providerOptions.google.thinkingConfig
 *                          { thinkingLevel: 'minimal'|'low'|'medium'|'high',
 *                            includeThoughts: true }
 *                          - CANNOT combine thinkingBudget + thinkingLevel
 *                            (API rejects with 400 INVALID_ARGUMENT)
 *                          - 'minimal' produces ~zero thought tokens
 *                            (closest to "off" for Gemini 3)
 *                          - includeThoughts=true REQUIRED for thoughts
 *                          Source: ai.google.dev/gemini-api/docs/thinking
 *
 *   Anthropic Claude 3.7 / Opus 4 / Sonnet 4
 *                     →  providerOptions.anthropic.thinking
 *                          { type: 'enabled', budgetTokens: 1024..N }
 *                          { type: 'disabled' }
 *                          - budgetTokens MUST be >= 1024 and < maxTokens
 *                          Source: platform.claude.com/docs/en/build-with-claude/extended-thinking
 *
 *   Anthropic Claude Opus 4.6+ / Sonnet 4.6+
 *                     →  providerOptions.anthropic.thinking
 *                          { type: 'adaptive' }     // ADAPTIVE, no budget
 *                          { type: 'disabled' }
 *                          - budget_tokens DEPRECATED on 4.6+ models
 *                          Source: claudeapi.com/en/blog/dev-guides/claude-extended-thinking-practical-guide-2026
 *
 *   OpenAI o1/o3/o4-mini / gpt-5
 *                     →  providerOptions.openai
 *                          { reasoningEffort: 'low'|'medium'|'high',
 *                            reasoningSummary: 'auto' }
 *                          - reasoningSummary defaults to 'none' — you MUST
 *                            set 'auto' (or 'concise'/'detailed') to receive
 *                            reasoning summaries back in the response.
 *                          Source: developers.openai.com/api/docs/guides/reasoning
 *
 *   xAI Grok 3 / 3 mini / 3 fast
 *                     →  providerOptions.openaiCompatible
 *                          { reasoningEffort: 'low'|'medium'|'high' }
 *                          - Uses @ai-sdk/openai-compatible which sends
 *                            `reasoning_effort` in the request body
 *                          Source: docs.x.ai/developers/model-capabilities/text/reasoning
 *
 *   xAI Grok 4 (original) → NO reasoning_effort support (always reasons)
 *                          - Only grok-4.3 and grok-4.20-multi-agent support
 *                            reasoning.effort on the Responses API
 *                          Source: github.com/NousResearch/hermes-agent/issues/23088
 *
 *   Mistral Magistral  →  providerOptions.mistral
 *                          { reasoningEffort: 'high' | 'none' }
 *                          - ONLY 'high' or 'none' supported on Magistral
 *                          - Mistral Small 4 / Medium 3.5 support
 *                            'low'|'medium'|'high'
 *                          Source: docs.mistral.ai/studio-api/conversations/reasoning
 *
 *   DeepSeek Reasoner  →  (no providerOptions needed)
 *                          - reasoning_content is returned AUTOMATICALLY
 *                          - In multi-turn tool use, reasoning_content from
 *                            prior assistant messages MUST be passed back
 *                            unmodified (the AI SDK handles this natively)
 *                          Source: api-docs.deepseek.com/guides/thinking_mode
 *
 *   OpenRouter         →  passthrough — sets the underlying provider's
 *                          reasoning options. Treated like OpenAILike here;
 *                          user must configure the underlying model.
 */

export interface ThinkingProviderOptions {
  google?: {
    thinkingConfig?: {
      thinkingBudget?: number;
      thinkingLevel?: 'minimal' | 'low' | 'medium' | 'high';
      includeThoughts?: boolean;
    };
  };
  anthropic?: {
    thinking?: { type: 'enabled'; budgetTokens: number } | { type: 'disabled' } | { type: 'adaptive' };
  };
  openai?: {
    reasoningEffort?: 'low' | 'medium' | 'high';
    reasoningSummary?: 'auto' | 'concise' | 'detailed';
  };
  mistral?: {
    reasoningEffort?: 'high' | 'none';
  };

  /*
   * NOTE: 'openaiCompatible' is intentionally NOT used here.
   *
   * VERIFIED from SDK source: every "OpenAI-compatible" provider in
   * this project (xAI, Groq, Together, OpenAILike, HuggingFace,
   * Hyperbolic, Github, Perplexity) is constructed via
   * `createOpenAI()` from `@ai-sdk/openai`, NOT via
   * `@ai-sdk/openai-compatible`. The `@ai-sdk/openai` SDK reads
   * `providerOptions.openai.*`, so we set our reasoning options
   * there for ALL such providers. Only providers built with
   * `createOpenAICompatible()` would read `providerOptions.openaiCompatible`,
   * and we have none of those in this project.
   */
  [key: string]: unknown;
}

// ---------- model-pattern matchers ----------

function isGemini3Model(modelId: string): boolean {
  return /^gemini-3[.-]/i.test(modelId);
}

function isGemini25Model(modelId: string): boolean {
  return /^gemini-2\.5/i.test(modelId);
}

/**
 * Claude 3.7 Sonnet, Opus 4, Sonnet 4 — use budget_tokens.
 * Claude Opus 4.6+ and Sonnet 4.6+ deprecate budget_tokens.
 */
function isClaudeBudgetModel(modelId: string): boolean {
  const id = modelId.toLowerCase();

  return /claude-3-7/.test(id) || /claude-3\.7/.test(id) || /claude-opus-4-/.test(id) || /claude-sonnet-4-/.test(id);
}

/**
 * Claude 4.6+ — uses adaptive thinking, no budget_tokens.
 */
function isClaudeAdaptiveModel(modelId: string): boolean {
  const id = modelId.toLowerCase();

  /*
   * Match claude-opus-4-6, claude-opus-4-6-x, claude-sonnet-4-6, etc.
   * Avoid matching claude-opus-4-1 through 4-5.
   */
  return /claude-opus-4-[6-9]/.test(id) || /claude-sonnet-4-[6-9]/.test(id);
}

function isClaudeReasoningModel(modelId: string): boolean {
  return isClaudeBudgetModel(modelId) || isClaudeAdaptiveModel(modelId);
}

function isOpenAIReasoningModel(modelId: string): boolean {
  return /^(o1|o3|o4|gpt-5)/i.test(modelId);
}

/**
 * xAI Grok 3 / 3 mini / 3 fast — support reasoning_effort.
 * Original Grok 4 does NOT — only grok-4.3+ does.
 */
function isXaiGrok3Model(modelId: string): boolean {
  return /grok-3/i.test(modelId);
}

function isXaiGrok43PlusModel(modelId: string): boolean {
  // grok-4.3, grok-4.3-fast, grok-4.20-multi-agent, etc.
  return /grok-4\.[3-9]/i.test(modelId) || /grok-4\.20/i.test(modelId);
}

function isMistralMagistralModel(modelId: string): boolean {
  return /magistral/i.test(modelId);
}

function isMistralAdjustableModel(modelId: string): boolean {
  // Mistral Small 4 / Medium 3.5 — supports low/medium/high
  return /mistral-small-4/i.test(modelId) || /mistral-medium-3/i.test(modelId);
}

function effortToGemini3Level(effort: ReasoningEffort): 'minimal' | 'low' | 'medium' | 'high' {
  switch (effort) {
    case 'low':
      return 'low';
    case 'medium':
      return 'medium';
    case 'high':
      return 'high';
    default:
      return 'medium';
  }
}

/**
 * Magistral only accepts 'high' or 'none'. Map our 3-value effort:
 *   - 'low'    → 'none'   (closest to "minimal")
 *   - 'medium' → 'high'   (Magistral has no medium)
 *   - 'high'   → 'high'
 */
function effortToMagistralEffort(effort: ReasoningEffort): 'high' | 'none' {
  return effort === 'low' ? 'none' : 'high';
}

/**
 * Build the per-provider `providerOptions` fragment that will be merged
 * into the `streamText` call. Returns an empty object when the provider
 * doesn't support thinking config (so the SDK uses its default behavior).
 *
 * @param providerName  The provider's `name` field (e.g. 'Google', 'Anthropic')
 * @param modelId       The model's `name` field (e.g. 'gemini-3.1-flash-lite')
 * @param config        The unified thinking config from the ChatBox popup
 */
export function buildThinkingProviderOptions(
  providerName: string,
  modelId: string,
  config: ModelConfigWire | undefined,
): ThinkingProviderOptions {
  if (!config) {
    return {};
  }

  const opts: ThinkingProviderOptions = {};

  // ----- Google Gemini -----
  if (providerName === 'Google') {
    if (isGemini3Model(modelId)) {
      /*
       * Gemini 3.x — thinkingLevel + includeThoughts.
       * When enabled=false, we set 'minimal' (closest to "off" the API
       * offers — there's no hard off switch for Gemini 3, but 'minimal'
       * produces near-zero reasoning tokens).
       * includeThoughts is ALWAYS true so any thoughts the model DOES
       * produce are streamed back to the client.
       */
      opts.google = {
        thinkingConfig: {
          thinkingLevel: config.thinkingEnabled ? effortToGemini3Level(config.effort) : 'minimal',
          includeThoughts: true,
        },
      };
    } else if (isGemini25Model(modelId)) {
      /*
       * Gemini 2.5 — thinkingBudget (token count) + includeThoughts.
       * thinkingBudget=0 disables thinking entirely on 2.5.
       */
      opts.google = {
        thinkingConfig: {
          thinkingBudget: config.thinkingEnabled ? config.budgetTokens : 0,
          includeThoughts: config.thinkingEnabled,
        },
      };
    }

    // Other Google models (Gemma, gemini-1.5, robotics) — no thinkingConfig.

    return opts;
  }

  // ----- Anthropic Claude -----
  if (providerName === 'Anthropic') {
    if (isClaudeReasoningModel(modelId)) {
      if (!config.thinkingEnabled) {
        opts.anthropic = { thinking: { type: 'disabled' } };
      } else if (isClaudeAdaptiveModel(modelId)) {
        // Opus 4.6+ / Sonnet 4.6+ — adaptive, no budget_tokens.
        opts.anthropic = { thinking: { type: 'adaptive' } };
      } else {
        /*
         * 3.7 / Opus 4 / Sonnet 4 — budgetTokens required.
         * Anthropic requires budgetTokens >= 1024 and < maxTokens.
         */
        const safeBudget = Math.max(1024, Math.min(config.budgetTokens, 32768));

        opts.anthropic = {
          thinking: { type: 'enabled', budgetTokens: safeBudget },
        };
      }
    }

    return opts;
  }

  // ----- OpenAI o-series / GPT-5 -----
  if (providerName === 'OpenAI') {
    if (isOpenAIReasoningModel(modelId)) {
      opts.openai = {
        reasoningEffort: config.effort,

        /*
         * 'auto' = richest level available; CRITICAL — without this the
         * SDK defaults reasoningSummary to 'none' and the user gets NO
         * reasoning text back even though the model spent tokens thinking.
         */
        reasoningSummary: 'auto',
      };
    }

    return opts;
  }

  /*
   * ----- xAI Grok -----
   *
   * VERIFIED from app/lib/modules/llm/providers/xai.ts: xAI uses
   * `createOpenAI()` from `@ai-sdk/openai`, so it reads
   * `providerOptions.openai.*`, NOT `providerOptions.openaiCompatible.*`.
   * Sending `openaiCompatible` would be silently ignored.
   *
   * The `@ai-sdk/openai` SDK passes `reasoningEffort` through as
   * `reasoning_effort` in the request body, which xAI's API accepts
   * for grok-3-mini and grok-4.3+. `reasoningSummary` is OpenAI-only
   * (Responses API) — omitted for xAI to avoid sending unsupported fields.
   */
  if (providerName === 'xAI') {
    if (isXaiGrok3Model(modelId) || isXaiGrok43PlusModel(modelId)) {
      opts.openai = {
        reasoningEffort: config.effort,
      };
    }

    // Original Grok 4 — no reasoning_effort support (always reasons).

    return opts;
  }

  /*
   * ----- Mistral -----
   *
   * VERIFIED from @ai-sdk/mistral SDK source (index.d.ts line 13):
   *   reasoningEffort: z.ZodOptional<z.ZodEnum<{ none: "none"; high: "high" }>>
   *
   * The SDK zod-parses providerOptions.mistral.reasoningEffort and
   * accepts ONLY 'none' or 'high'. Any other value ('low'/'medium')
   * throws a runtime zod validation error.
   *
   * Mistral docs (docs.mistral.ai/studio-api/conversations/reasoning)
   * mention 'low'|'medium'|'high' for newer models like Mistral Small 4
   * / Medium 3.5, but the @ai-sdk/mistral SDK as of v4.0.10 does NOT
   * accept those values — the SDK schema is hardcoded to {none, high}.
   * Sending 'low'/'medium' will crash. Map ALL effort levels to either
   * 'none' (off) or 'high' (on) until the SDK is updated.
   */
  if (providerName === 'Mistral') {
    if (isMistralMagistralModel(modelId) || isMistralAdjustableModel(modelId)) {
      opts.mistral = {
        reasoningEffort: config.thinkingEnabled ? effortToMagistralEffort(config.effort) : 'none',
      };
    }

    return opts;
  }

  /*
   * DeepSeek Reasoner returns reasoning_content automatically — no opts needed.
   * OpenRouter, OpenAILike, LMStudio, Ollama: passthrough depends on the
   * underlying model; the upstream API ignores unknown providerOptions keys.
   */

  return opts;
}

/**
 * Determine whether a (provider, model) pair supports thinking configuration
 * AT ALL. Used by the server to decide whether to even attempt to merge
 * providerOptions (saves a noop object spread on every request).
 */
export function supportsThinkingConfig(providerName: string, modelId: string): boolean {
  if (providerName === 'Google' && (isGemini3Model(modelId) || isGemini25Model(modelId))) {
    return true;
  }

  if (providerName === 'Anthropic' && isClaudeReasoningModel(modelId)) {
    return true;
  }

  if (providerName === 'OpenAI' && isOpenAIReasoningModel(modelId)) {
    return true;
  }

  if (providerName === 'xAI' && (isXaiGrok3Model(modelId) || isXaiGrok43PlusModel(modelId))) {
    return true;
  }

  if (providerName === 'Mistral' && (isMistralMagistralModel(modelId) || isMistralAdjustableModel(modelId))) {
    return true;
  }

  /*
   * DeepSeek Reasoner thinks automatically (no opts), so we don't claim
   * "support" here — the user can't tune it.
   */
  return false;
}
