/**
 * Context-budget utilities for deciding WHEN to trigger chat summarization.
 *
 * The previous logic used a fixed message-count threshold (e.g. "> 8 messages")
 * which is wrong: a single huge pasted-file message can overflow a 16k-context
 * model on turn 2, while a 1M-context Gemini model should never need to
 * summarize a short conversation.
 *
 * Instead, we estimate the current conversation's token footprint and trigger
 * summarization when it approaches the model's actual context window
 * (`maxTokenAllowed` from ModelInfo).
 *
 * What gets summarized (handled in create-summary.ts + stream-text.ts):
 *   - Earlier user + assistant TEXT messages → collapsed into a CHAT SUMMARY block
 *   - Tool-call structured parts are skipped (only text extracted)
 *
 * What SURVIVES (never summarized):
 *   - The system prompt (rebuilt fresh every turn)
 *   - Workspace file PATHS (injected into system prompt)
 *   - The CHAT SUMMARY text itself (injected into system prompt)
 *   - The last few messages (kept verbatim via messageSliceId)
 */

import type { UIMessage } from 'ai';
import type { IProviderSetting } from '~/types/model';
import { countTokens } from '~/lib/utils/token-counter';
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';
import { LLMManager } from '~/lib/modules/llm/manager';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { extractPropertiesFromMessage } from './utils';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('context-budget');

/**
 * Reserve for the system prompt + workspace file list + guardrails.
 * The Amplify system prompt is heavyweight (~5-8k tokens with capabilities,
 * xml rules, examples). We reserve 8192 to be safe.
 */
export const SYSTEM_PROMPT_RESERVE = 8192;

/**
 * Default maxTokenAllowed when we can't resolve the model (safe fallback).
 */
export const DEFAULT_CONTEXT_WINDOW = 128000;

/**
 * Default maxCompletionTokens when the model doesn't specify one.
 */
export const DEFAULT_MAX_COMPLETION_TOKENS = 8192;

/**
 * Trigger summarization when estimated conversation tokens reach this fraction
 * of the usable budget. 0.7 leaves headroom for the summary LLM call itself
 * + the next user turn + tool outputs.
 */
export const SUMMARIZATION_THRESHOLD = 0.7;

/**
 * Extract the raw text from a message's content (handles string + array parts).
 * Tool-call structured parts (type !== 'text') are skipped — only text is
 * counted, matching what create-summary actually summarizes.
 */
function extractText(message: UIMessage): string {
  // UIMessage v7 uses parts array
  if (Array.isArray(message.parts)) {
    return message.parts
      .map((part) => {
        if (part.type === 'text') {
          return 'text' in part ? (part as { text: string }).text : '';
        }

        // Tool results / image parts contribute some tokens but much less text
        if (part.type === 'tool-result') {
          const toolPart = part as any;
          return typeof toolPart.result === 'string' ? toolPart.result : JSON.stringify(toolPart.result || '');
        }

        return '';
      })
      .join('\n');
  }

  // Fallback for legacy content (string or array)
  const content: any = (message as any).content;

  if (typeof content === 'string') {
    return content;
  }

  if (Array.isArray(content)) {
    return content
      .map((part: any) => {
        if (part.type === 'text') {
          return part.text || '';
        }

        return '';
      })
      .join('\n');
  }

  return '';
}

/**
 * Estimate the total token footprint of the conversation messages.
 * This is an approximation (~3-4 chars/token heuristic from countTokens).
 *
 * NOTE: this does NOT include the system prompt — that's reserved separately
 * via SYSTEM_PROMPT_RESERVE.
 */
export function estimateConversationTokens(messages: UIMessage[]): number {
  let total = 0;

  for (const message of messages) {
    const text = extractText(message);
    total += countTokens(text).tokens;

    // Per-message overhead (role tags, separators) — ~4 tokens each
    total += 4;
  }

  return total;
}

export interface ModelContextInfo {
  /** The model name (e.g. 'glm-4.5') */
  model: string;

  /** The provider name (e.g. 'Z.ai') */
  provider: string;

  /** Max context window (input tokens) from ModelInfo.maxTokenAllowed */
  maxTokenAllowed: number;

  /** Max output tokens from ModelInfo.maxCompletionTokens (or default) */
  maxCompletionTokens: number;

  /** Usable budget = maxTokenAllowed − maxCompletionTokens − systemPromptReserve */
  usableBudget: number;

  /** Token count at which we should trigger summarization (70% of usable) */
  summarizationTrigger: number;
}

/**
 * Resolve the context-window info for the model/provider used in the current
 * conversation. Reads the model + provider from the LAST user message (which
 * carries `[Model: ...] [Provider: ...]` tags injected by the client).
 *
 * If the model isn't found in the provider's static + dynamic list, falls back
 * to safe defaults.
 */
export async function getModelContextInfo(
  messages: UIMessage[],
  opts?: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Env;
  },
): Promise<ModelContextInfo> {
  // Extract model + provider from the last user message
  let modelName = DEFAULT_MODEL;
  let providerName = DEFAULT_PROVIDER.name;

  const lastUserMessage = messages.filter((x) => x.role === 'user').slice(-1)[0];

  if (lastUserMessage) {
    const extracted = extractPropertiesFromMessage(lastUserMessage);
    modelName = extracted.model;
    providerName = extracted.provider;
  }

  const provider = PROVIDER_LIST.find((p) => p.name === providerName) || DEFAULT_PROVIDER;
  const llmManager = LLMManager.getInstance();

  /*
   * Prefer the MERGED model list (dynamic-first, static-fallback) so that
   * API-fetched real context windows win over the static list's hardcoded
   * values. The static list is a curated fallback that can go stale (e.g.
   * Gemma 4 was initially hardcoded to 128k but is actually 256k); the
   * dynamic list reflects the provider's current API response.
   *
   * getModelListFromProvider returns dynamic-merged-over-static: if a model
   * appears in both, the dynamic (API-fetched) entry wins. If the dynamic
   * fetch fails (no API key / network), it returns the static list alone,
   * so this is still safe. Results are cached after the first call.
   */
  let modelDetails: ModelInfo | undefined;

  try {
    const mergedModels = await llmManager.getModelListFromProvider(provider, {
      apiKeys: opts?.apiKeys,
      providerSettings: opts?.providerSettings,
      serverEnv: opts?.serverEnv as any,
    });
    modelDetails = mergedModels.find((m) => m.name === modelName);
  } catch (e) {
    logger.warn(`Failed to fetch merged model list for ${provider.name}, using static:`, e);
    modelDetails = llmManager.getStaticModelListFromProvider(provider).find((m) => m.name === modelName);
  }

  // Fallback defaults if we still can't find the model
  const maxTokenAllowed = modelDetails?.maxTokenAllowed || DEFAULT_CONTEXT_WINDOW;
  const maxCompletionTokens = modelDetails?.maxCompletionTokens || DEFAULT_MAX_COMPLETION_TOKENS;

  const usableBudget = Math.max(0, maxTokenAllowed - maxCompletionTokens - SYSTEM_PROMPT_RESERVE);

  return {
    model: modelName,
    provider: providerName,
    maxTokenAllowed,
    maxCompletionTokens,
    usableBudget,
    summarizationTrigger: Math.floor(usableBudget * SUMMARIZATION_THRESHOLD),
  };
}

/**
 * Decide whether summarization should run, based on the current conversation's
 * estimated token footprint vs. the model's usable context budget.
 *
 * Returns true only when:
 *   1. Context optimization is enabled, AND
 *   2. There are workspace files (summarization is only useful in build mode), AND
 *   3. The estimated conversation tokens exceed the summarization trigger.
 *
 * Also returns the recommended messageSliceId — how many of the EARLIEST
 * messages to slice off (they'll be replaced by the summary in the system
 * prompt). The last 3 messages are always kept verbatim.
 */
export function shouldSummarize(
  messages: UIMessage[],
  contextInfo: ModelContextInfo,
  contextOptimization: boolean,
  hasWorkspaceFiles: boolean,
): { shouldRun: boolean; estimatedTokens: number; messageSliceId: number } {
  const estimatedTokens = estimateConversationTokens(messages);

  const shouldRun = contextOptimization && hasWorkspaceFiles && estimatedTokens > contextInfo.summarizationTrigger;

  /*
   * messageSliceId: keep the last 3 messages verbatim, slice the rest.
   * (This is the existing behavior; we keep it regardless of summarization
   * because stream-text.ts only applies the slice WHEN a summary exists.)
   */
  let messageSliceId = 0;

  if (messages.length > 3) {
    messageSliceId = messages.length - 3;
  }

  return { shouldRun, estimatedTokens, messageSliceId };
}
