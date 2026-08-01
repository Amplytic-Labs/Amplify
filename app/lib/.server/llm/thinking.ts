import type { ModelConfigWire, ReasoningEffort } from '~/lib/stores/model-config';
import type { ModelCapabilities } from '~/lib/modules/llm/types';

/**
 * Server-side thinking / reasoning translator — converts the unified
 * `ModelConfigWire` (edited by the ChatBox settings popup) into the
 * per-provider `providerOptions` shape the Vercel AI SDK expects.
 *
 * This module NO LONGER uses hardcoded regex patterns to detect
 * reasoning models. Instead, it reads `ModelCapabilities` from
 * `ModelInfo.capabilities`, which is populated at model-fetch time
 * by `detectModelCapabilities()` in `detect-capabilities.ts`.
 *
 * This means:
 *   - New model variants (Gemini 4.x, Claude 5, etc.) work automatically
 *     as long as the provider's `detectModelCapabilities` handles them
 *   - Dynamic models from API endpoints get capabilities set at fetch time
 *   - No regex is evaluated per-request — capabilities are cached
 *
 * VERIFIED RESEARCH (2025-2026):
 *
 *   Google Gemini 2.5  →  providerOptions.google.thinkingConfig
 *                          { thinkingBudget: 0..N, includeThoughts: true }
 *                          - thinkingBudget=0 disables thinking on 2.5
 *                          - includeThoughts=true is REQUIRED to receive
 *                            thought summaries in the response.
 *                          Source: ai.google.dev/gemini-api/docs/generate-content/thinking
 *
 *   Google Gemini 3.x  →  providerOptions.google.thinkingConfig
 *                          { thinkingLevel: 'minimal'|'low'|'medium'|'high',
 *                            includeThoughts: true }
 *                          - CANNOT combine thinkingBudget + thinkingLevel
 *                          Source: ai.google.dev/gemini-api/docs/thinking
 *
 *   Anthropic Claude 3.7 / Opus 4 / Sonnet 4
 *                     →  providerOptions.anthropic.thinking
 *                          { type: 'enabled', budgetTokens: 1024..N }
 *                          { type: 'disabled' }
 *                          Source: platform.claude.com/docs/en/build-with-claude/extended-thinking
 *
 *   Anthropic Claude Opus 4.6+ / Sonnet 4.6+
 *                     →  providerOptions.anthropic.thinking
 *                          { type: 'adaptive' }     // ADAPTIVE, no budget
 *                          { type: 'disabled' }
 *                          Source: claudeapi.com/en/blog/dev-guides/claude-extended-thinking-practical-guide-2026
 *
 *   OpenAI o1/o3/o4-mini / gpt-5
 *                     →  providerOptions.openai
 *                          { reasoningEffort: 'low'|'medium'|'high',
 *                            reasoningSummary: 'auto' }
 *                          Source: developers.openai.com/api/docs/guides/reasoning
 *
 *   xAI Grok 3 / 3 mini / 3 fast
 *                     →  providerOptions.openai
 *                          { reasoningEffort: 'low'|'medium'|'high' }
 *                          Source: docs.x.ai/developers/model-capabilities/text/reasoning
 *
 *   Mistral Magistral  →  providerOptions.mistral
 *                          { reasoningEffort: 'high' | 'none' }
 *                          Source: docs.mistral.ai/studio-api/conversations/reasoning
 *
 *   DeepSeek Reasoner  →  (no providerOptions needed)
 *                          - reasoning_content returned AUTOMATICALLY
 *                          Source: api-docs.deepseek.com/guides/thinking_mode
 *
 *   OpenAI-compatible (Groq, GitHub, OpenRouter, etc.)
 *                     →  providerOptions.openai
 *                          { reasoningEffort: 'low'|'medium'|'high' }
 *                          - Passthrough — underlying API ignores unknown keys
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
   * All OpenAI-compatible providers in this project use createOpenAI()
   * from @ai-sdk/openai, which reads providerOptions.openai.*.
   */
  [key: string]: unknown;
}

// ---------- effort mappers ----------

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
 * into the `streamText` call. Returns an empty object when the model
 * doesn't support thinking config (so the SDK uses its default behavior).
 *
 * @param providerName  The provider's `name` field (e.g. 'Google', 'Anthropic')
 * @param modelId       The model's `name` field (e.g. 'gemini-3.1-flash-lite')
 * @param config        The unified thinking config from the ChatBox popup
 * @param capabilities  Model capabilities from ModelInfo.capabilities
 *                       (populated at model-fetch time, not regex-matched per-request)
 */
export function buildThinkingProviderOptions(
  providerName: string,
  modelId: string,
  config: ModelConfigWire | undefined,
  capabilities?: ModelCapabilities,
): ThinkingProviderOptions {
  if (!config) {
    return {};
  }

  // If capabilities are available, use them directly — no regex needed
  if (capabilities?.thinking) {
    return buildFromCapabilities(providerName, config, capabilities);
  }

  // No capabilities → model does not support thinking
  return {};
}

/**
 * Build providerOptions from ModelCapabilities.
 * This is the capability-driven path — NO regex matching.
 */
function buildFromCapabilities(
  providerName: string,
  config: ModelConfigWire,
  capabilities: ModelCapabilities,
): ThinkingProviderOptions {
  const opts: ThinkingProviderOptions = {};
  const thinkingType = capabilities.thinking;

  switch (thinkingType) {
    case 'budget': {
      // Budget-based thinking: Gemini 2.5, Claude 3.7/4
      if (providerName === 'Google') {
        opts.google = {
          thinkingConfig: {
            thinkingBudget: config.thinkingEnabled ? config.budgetTokens : 0,
            includeThoughts: config.thinkingEnabled,
          },
        };
      } else if (providerName === 'Anthropic') {
        if (!config.thinkingEnabled) {
          opts.anthropic = { thinking: { type: 'disabled' } };
        } else {
          const safeBudget = Math.max(1024, Math.min(config.budgetTokens, 32768));
          opts.anthropic = {
            thinking: { type: 'enabled', budgetTokens: safeBudget },
          };
        }
      }
      break;
    }

    case 'effort': {
      // Effort-based thinking: Gemini 3.x, OpenAI o-series, xAI Grok, Mistral
      if (providerName === 'Google') {
        // Gemini 3.x+ — thinkingLevel + includeThoughts
        opts.google = {
          thinkingConfig: {
            thinkingLevel: config.thinkingEnabled ? effortToGemini3Level(config.effort) : 'minimal',
            includeThoughts: true,
          },
        };
      } else if (providerName === 'OpenAI') {
        // OpenAI — reasoningEffort + reasoningSummary (auto for summaries)
        opts.openai = {
          reasoningEffort: config.effort,
          reasoningSummary: 'auto',
        };
      } else if (providerName === 'xAI') {
        // xAI — reasoningEffort only (no reasoningSummary)
        opts.openai = {
          reasoningEffort: config.effort,
        };
      } else if (providerName === 'Mistral') {
        // Mistral — reasoningEffort (only 'high' | 'none' per SDK)
        opts.mistral = {
          reasoningEffort: config.thinkingEnabled ? effortToMagistralEffort(config.effort) : 'none',
        };
      } else if (capabilities.reasoningEffort) {
        // Generic OpenAI-compatible provider with reasoning_effort support
        // (Groq, GitHub, HuggingFace, Hyperbolic, OpenRouter, etc.)
        opts.openai = {
          reasoningEffort: config.effort,
        };
      }
      break;
    }

    case 'adaptive': {
      // Adaptive thinking: Claude 4.6+ (no budget_tokens)
      if (providerName === 'Anthropic') {
        if (!config.thinkingEnabled) {
          opts.anthropic = { thinking: { type: 'disabled' } };
        } else {
          opts.anthropic = { thinking: { type: 'adaptive' } };
        }
      }
      break;
    }

    case 'automatic': {
      // DeepSeek R1, etc. — reasoning is always on, no providerOptions needed.
      // The AI SDK handles reasoning_content natively.
      break;
    }
  }

  return opts;
}

/**
 * Determine whether a model supports thinking configuration AT ALL.
 * Used by the server to decide whether to even attempt to merge
 * providerOptions (saves a noop object spread on every request).
 *
 * Now reads from ModelCapabilities instead of regex matching.
 */
export function supportsThinkingConfig(
  providerName: string,
  modelId: string,
  capabilities?: ModelCapabilities,
): boolean {
  if (!capabilities?.thinking) {
    return false;
  }

  // 'automatic' means the model always reasons — no toggle/config needed
  // We don't claim "support" here because there's nothing for the user to tune
  if (capabilities.thinking === 'automatic') {
    return false;
  }

  return true;
}
