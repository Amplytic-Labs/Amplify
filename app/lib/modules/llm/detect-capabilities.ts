/**
 * Centralized model capability detection.
 *
 * This module provides a SINGLE place to determine if a model supports
 * thinking/reasoning, based on provider name + model ID. It's used:
 *
 *   1. By providers to populate ModelInfo.capabilities at fetch time
 *      (both staticModels and getDynamicModels)
 *   2. As a fallback when capabilities are not already set on ModelInfo
 *      (e.g., models from cached data or older clients)
 *
 * DESIGN PRINCIPLE:
 *   - Provider-specific detection is FIRST (exact knowledge)
 *   - Name-pattern heuristic is LAST RESORT (for unknown dynamic models)
 *   - The result is CACHED in ModelInfo.capabilities — no re-evaluation
 *     on every request
 *
 * FUTURE-PROOFING:
 *   - When a new model variant comes out (Gemini 4.x, Claude 5, etc.),
 *     it will be auto-detected IF the provider adds it to staticModels
 *     with the correct capabilities, OR if the dynamic API response
 *     includes enough metadata to detect it
 *   - For truly unknown models, the name-pattern heuristic provides a
 *     reasonable fallback that can be updated in ONE place
 */

import type { ModelCapabilities } from './types';

// ============================================================
// Provider-specific capability detection
// ============================================================

/**
 * Anthropic Claude thinking detection.
 *
 * Claude 3.7 Sonnet, Opus 4, Sonnet 4 → budget-based thinking
 * Claude Opus 4.6+ / Sonnet 4.6+     → adaptive thinking (no budget)
 * Claude 3.5 and below                → no thinking
 */
function detectAnthropicCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();

  // Claude 4.6+ — adaptive thinking (budget_tokens deprecated)
  if (/claude-opus-4-[6-9]/.test(id) || /claude-sonnet-4-[6-9]/.test(id)) {
    return { thinking: 'adaptive' };
  }

  // Claude 3.7 / Opus 4 / Sonnet 4 — budget-based thinking
  if (/claude-3-7/.test(id) || /claude-3\.7/.test(id) || /claude-opus-4-/.test(id) || /claude-sonnet-4-/.test(id)) {
    return { thinking: 'budget' };
  }

  // All other Claude models — no thinking support
  return {};
}

/**
 * Google Gemini thinking detection.
 *
 * Gemini 2.5.x → budget-based thinking (thinkingBudget)
 * Gemini 3.x   → effort-based thinking (thinkingLevel)
 * Gemini 4.x+  → effort-based thinking (assumed, will be verified at runtime)
 * Gemma, etc.  → no thinking
 */
function detectGoogleCapabilities(modelId: string): ModelCapabilities {
  const id = modelId.toLowerCase();

  // Gemini 3.x and above (including future 4.x, 5.x, etc.)
  if (/^gemini-[3-9]/.test(id)) {
    return { thinking: 'effort' };
  }

  // Gemini 2.5 — budget-based
  if (/^gemini-2\.5/.test(id)) {
    return { thinking: 'budget' };
  }

  return {};
}

/**
 * OpenAI reasoning detection.
 *
 * o1, o3, o4, gpt-5 → effort-based reasoning
 * All other models   → no reasoning
 */
function detectOpenAICapabilities(modelId: string): ModelCapabilities {
  if (/^(o1|o3|o4|gpt-5)/i.test(modelId)) {
    return { thinking: 'effort', reasoningEffort: true };
  }

  return {};
}

/**
 * xAI Grok reasoning detection.
 *
 * Grok 3 / 3 mini / 3 fast → effort-based
 * Grok 4.3+                → effort-based
 * Original Grok 4          → always reasons (no effort control)
 */
function detectXaiCapabilities(modelId: string): ModelCapabilities {
  if (/grok-3/i.test(modelId) || /grok-4\.[3-9]/i.test(modelId) || /grok-4\.20/i.test(modelId)) {
    return { thinking: 'effort', reasoningEffort: true };
  }

  // Original Grok 4 — always reasons, no toggle
  if (/grok-4/.test(modelId)) {
    return { thinking: 'automatic' };
  }

  return {};
}

/**
 * Mistral reasoning detection.
 *
 * Magistral       → effort-based (high/none only per SDK)
 * Small 4 / Medium 3.5 → effort-based
 */
function detectMistralCapabilities(modelId: string): ModelCapabilities {
  if (/magistral/i.test(modelId) || /mistral-small-4/i.test(modelId) || /mistral-medium-3/i.test(modelId)) {
    return { thinking: 'effort', reasoningEffort: true };
  }

  return {};
}

/**
 * DeepSeek reasoning detection.
 *
 * R1 / Reasoner → always reasons (automatic)
 * Chat (V3)     → no reasoning
 */
function detectDeepseekCapabilities(modelId: string): ModelCapabilities {
  if (/deepseek-r/i.test(modelId) || /deepseek-reasoner/i.test(modelId)) {
    return { thinking: 'automatic' };
  }

  return {};
}

// ============================================================
// Generic fallback for OpenAI-compatible providers
// ============================================================

/**
 * OpenAI-compatible providers that use createOpenAI() from @ai-sdk/openai.
 * These read providerOptions.openai.*, so reasoning_effort works if the
 * underlying model supports it.
 */
const OPENAI_COMPATIBLE_PROVIDERS = new Set([
  'Groq',
  'GitHub',
  'HuggingFace',
  'Hyperbolic',
  'OpenRouter',
  'OpenAILike',
  'LMStudio',
  'Ollama',
  'Moonshot',
  'ZAI',
  'Together',
  'Fireworks',
  'Cerebras',
  'Perplexity',
  'Cohere',
]);

/**
 * Generic reasoning model detection by name pattern.
 * Used as a LAST RESORT for models from OpenAI-compatible providers
 * where we don't have provider-specific knowledge.
 *
 * This covers the most common reasoning model naming conventions
 * across the ecosystem.
 */
function detectGenericReasoningCapabilities(modelId: string): ModelCapabilities {
  if (
    /^(o1|o3|o4|gpt-5|deepseek-r|deepseek-reasoner|qwq|kimi-thinking|grok-3|grok-4\.[3-9]|grok-4\.20|magistral|qwen.*think)/i.test(
      modelId,
    )
  ) {
    return { thinking: 'effort', reasoningEffort: true };
  }

  return {};
}

// ============================================================
// Public API
// ============================================================

/**
 * Detect model capabilities based on provider name and model ID.
 *
 * This is the SINGLE entry point for capability detection.
 * Provider-specific logic is tried first, then generic fallback.
 *
 * @param providerName  Provider name (e.g. 'Anthropic', 'Google')
 * @param modelId       Model ID (e.g. 'claude-opus-4-20250514')
 * @returns ModelCapabilities (may be empty {} if no capabilities detected)
 */
export function detectModelCapabilities(providerName: string, modelId: string): ModelCapabilities {
  // Provider-specific detection (highest priority)
  switch (providerName) {
    case 'Anthropic':
      return detectAnthropicCapabilities(modelId);
    case 'Google':
      return detectGoogleCapabilities(modelId);
    case 'OpenAI':
      return detectOpenAICapabilities(modelId);
    case 'xAI':
      return detectXaiCapabilities(modelId);
    case 'Mistral':
      return detectMistralCapabilities(modelId);
    case 'Deepseek':
      return detectDeepseekCapabilities(modelId);
  }

  // Generic fallback for OpenAI-compatible providers
  if (OPENAI_COMPATIBLE_PROVIDERS.has(providerName)) {
    return detectGenericReasoningCapabilities(modelId);
  }

  return {};
}

/**
 * Determine the thinking control state for the ChatBox UI.
 * This replaces the hardcoded getThinkingControlState in ChatBox.tsx.
 *
 * Returns the same union type for backwards compatibility.
 */
export function getThinkingControlState(
  capabilities?: ModelCapabilities,
): 'toggle+budget' | 'toggle+effort' | 'effort-only' | 'toggle-only' | 'on-and-locked' | 'off-and-locked' {
  if (!capabilities?.thinking) {
    return 'off-and-locked';
  }

  switch (capabilities.thinking) {
    case 'budget':
      return 'toggle+budget';
    case 'effort':
      return 'effort-only';
    case 'adaptive':
      return 'toggle-only';
    case 'automatic':
      return 'on-and-locked';
    default:
      return 'off-and-locked';
  }
}
