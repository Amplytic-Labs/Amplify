import type { IProviderSetting } from '~/types/model';

/**
 * Model capability flags — populated at model-fetch time (static + dynamic)
 * and cached with the model list. This eliminates per-request regex matching
 * and makes reasoning/thinking detection work for any new model variant
 * without code changes (as long as the provider sets the flag correctly).
 *
 * For static models, capabilities are hardcoded (these are known models).
 * For dynamic models, providers detect capabilities from API metadata
 * when available, falling back to name-based heuristics.
 */
export interface ModelCapabilities {
  /**
   * Does this model support thinking/reasoning? And what kind?
   *   - 'budget'   → token budget control (Claude 3.7/4, Gemini 2.5)
   *   - 'effort'   → effort level only (OpenAI o-series, xAI Grok, Mistral)
   *   - 'adaptive'  → adaptive thinking, no budget (Claude 4.6+)
   *   - 'automatic' → always reasons, no toggle (DeepSeek R1)
   */
  thinking?: 'budget' | 'effort' | 'adaptive' | 'automatic';

  /**
   * For OpenAI-compatible providers: does the model accept reasoning_effort?
   * Set automatically when thinking='effort', but also set for models
   * hosted through compatible providers (Groq, GitHub, etc.).
   */
  reasoningEffort?: boolean;
}

export interface ModelInfo {
  name: string;
  label: string;
  provider: string;

  /** Maximum context window size (input tokens) - how many tokens the model can process */
  maxTokenAllowed: number;

  /** Maximum completion/output tokens - how many tokens the model can generate. If not specified, falls back to provider defaults */
  maxCompletionTokens?: number;

  /** Tokens per minute limit */
  tpm?: number;

  /** Requests per minute limit */
  rpm?: number;

  /**
   * Model capability flags — thinking/reasoning support, etc.
   * Populated at model-fetch time and cached with the model list.
   * When undefined, capabilities are unknown (treated as no thinking).
   */
  capabilities?: ModelCapabilities;
}

export interface ProviderInfo {
  name: string;
  staticModels: ModelInfo[];
  getDynamicModels?: (
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ) => Promise<ModelInfo[]>;
  getModelInstance: (options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }) => any; // Provider SDKs return their own model types
  getApiKeyLink?: string;
  labelForGetApiKey?: string;
  icon?: string;
}
export interface ProviderConfig {
  baseUrlKey?: string;
  baseUrl?: string;
  apiTokenKey?: string;
}
