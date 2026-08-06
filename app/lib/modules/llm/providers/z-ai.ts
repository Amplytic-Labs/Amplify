import { BaseProvider } from '~/lib/modules/llm/base-provider';
import type { IProviderSetting } from '~/types/model';
import type { ModelInfo } from '~/lib/modules/llm/types';
import { createOpenAI } from '@ai-sdk/openai';
import crypto from 'node:crypto';
import { detectModelCapabilities } from '~/lib/modules/llm/detect-capabilities';

/**
 * Custom fetch wrapper for z.ai that transparently retries transient
 * upstream errors (502 / 503 / 504 / network-level "fetch failed").
 *
 * Why this exists:
 *   z.ai is fronted by an ALB that intermittently returns HTML 502
 *   "Bad Gateway" pages — especially on the streaming chat endpoint
 *   under load. Without retry, the AI SDK surfaces the raw HTML page
 *   to the user as the error message. With this wrapper, the vast
 *   majority of those transient blips are retried silently and the
 *   user never sees them.
 *
 * Behaviour:
 *   - Retries up to `maxRetries` times with exponential backoff (0.5s, 1s, 2s, 4s).
 *   - Retries on: 500, 502, 503, 504, 429, and network errors (TypeError).
 *   - Supports `fallbackBaseUrls`: a list of alternate base URLs. On each
 *     retry, the URL's origin+path-prefix is swapped to the next fallback
 *     in the list. This lets us fall back from `/api/coding/paas/v4`
 *     (Coding Plan endpoint) to `/api/paas/v4` (standard endpoint) if
 *     the Coding Plan tier is down.
 *   - For the final attempt, the last response/error is returned so the
 *     AI SDK can surface it (after the HTML-sanitization layer in
 *     api.chat.ts cleans it up for the user).
 */
function makeZaiFetch(options: { maxRetries?: number; fallbackBaseUrls?: string[] } = {}): typeof fetch {
  const { maxRetries = 4, fallbackBaseUrls = [] } = options;
  const baseDelay = 500;

  // Normalize fallback base URLs (strip trailing slash) for prefix matching.
  const fallbacks = fallbackBaseUrls.map((u) => u.replace(/\/+$/, ''));

  return async (input: any, init?: any) => {
    let lastError: any = null;
    let lastResponse: Response | null = null;
    const originalUrl = typeof input === 'string' ? input : input?.url || '';

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        /*
         * Pick the base URL for this attempt. On attempt 0 we use the
         * original URL as-is. On retries, we cycle through the fallback
         * base URLs (if any) so that persistent failures on one endpoint
         * get routed to another.
         */
        let urlForThisAttempt = originalUrl;

        if (attempt > 0 && fallbacks.length > 0) {
          /*
           * Try to swap the base URL prefix. We look for any known
           * fallback prefix in the current URL and replace it with the
           * next fallback in the list (round-robin based on attempt).
           */
          for (const fb of fallbacks) {
            if (originalUrl.includes(fb)) {
              const nextFb = fallbacks[attempt % fallbacks.length];
              urlForThisAttempt = originalUrl.replace(fb, nextFb);
              break;
            }
          }
        }

        const finalInput = urlForThisAttempt === originalUrl ? input : urlForThisAttempt;
        const sendInit: RequestInit = { ...init };

        /*
         * Snapshot the request body so we can re-send on retry.
         * (Request bodies can only be consumed once.)
         */
        if (init?.body) {
          if (typeof init.body === 'string') {
            sendInit.body = init.body;
          } else if (init.body instanceof ArrayBuffer) {
            sendInit.body = init.body.slice(0);
          } else if (typeof Blob !== 'undefined' && init.body instanceof Blob) {
            sendInit.body = init.body;
          } else {
            // Unknown body type — can't safely snapshot, single attempt.
            return fetch(finalInput, sendInit);
          }
        }

        const response = await fetch(finalInput, sendInit);
        lastResponse = response;

        const status = response.status;

        // Retryable upstream errors
        const isRetryable = status === 500 || status === 502 || status === 503 || status === 504 || status === 429;

        if (!isRetryable || attempt === maxRetries) {
          return response;
        }

        // Log a snippet of the error body for debugging
        try {
          const errText = await response.clone().text();
          console.warn(
            `[z.ai] transient ${status} on attempt ${attempt + 1}/${maxRetries + 1} ` +
              `(url=${urlForThisAttempt.slice(0, 80)}). ` +
              `Body snippet: ${errText.slice(0, 200).replace(/\s+/g, ' ')}`,
          );
        } catch {
          // ignore body read errors
        }

        const delay = baseDelay * Math.pow(2, attempt);
        await new Promise((r) => setTimeout(r, delay));
        continue;
      } catch (err: any) {
        lastError = err;

        // Network-level errors (TypeError: fetch failed) are retryable
        const isNetworkError = err instanceof TypeError;

        if (isNetworkError) {
          if (attempt === maxRetries) {
            throw err;
          }

          console.warn(
            `[z.ai] network error on attempt ${attempt + 1}/${maxRetries + 1}: ${err?.message}. Retrying...`,
          );

          const delay = baseDelay * Math.pow(2, attempt);
          await new Promise((r) => setTimeout(r, delay));
          continue;
        }

        // Non-network errors are not retryable
        throw err;
      }
    }

    // Should be unreachable, but return last response as a safety net
    if (lastResponse) {
      return lastResponse;
    }

    throw lastError || new Error('z.ai fetch exhausted retries with no response');
  };
}

export default class ZaiProvider extends BaseProvider {
  name = 'Z.ai';
  getApiKeyLink = 'https://open.bigmodel.cn/usercenter/apikeys';

  config = {
    baseUrlKey: 'ZAI_BASE_URL',
    apiTokenKey: 'ZAI_API_KEY',
    baseUrl: 'https://api.z.ai/api/coding/paas/v4', //Dedicated endpoint for Coding Plan
  };

  staticModels: ModelInfo[] = [
    {
      name: 'glm-4.6',
      label: 'GLM-4.6 (200K)',
      provider: 'Z.ai',
      maxTokenAllowed: 200000,
      maxCompletionTokens: 65536,
    },
    {
      name: 'glm-4.7-flash',
      label: 'GLM-4.7 Flash (128K)',
      provider: 'Z.ai',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 65536,
    },
    { name: 'glm-4.5', label: 'GLM-4.5 (128K)', provider: 'Z.ai', maxTokenAllowed: 128000, maxCompletionTokens: 65536 },
    {
      name: 'glm-4.5-flash',
      label: 'GLM-4.5 Flash (128K)',
      provider: 'Z.ai',
      maxTokenAllowed: 128000,
      maxCompletionTokens: 65536,
    },
  ];

  async getDynamicModels(
    apiKeys?: Record<string, string>,
    settings?: IProviderSetting,
    serverEnv?: Record<string, string>,
  ): Promise<ModelInfo[]> {
    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: settings,
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'ZAI_BASE_URL',
      defaultApiTokenKey: 'ZAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing Api Key configuration for ${this.name} provider`);
    }

    /*
     * Authentication mode selection.
     *
     * The current z.ai API (api.z.ai) uses plain OpenAI-compatible Bearer
     * tokens for ALL keys — including keys that contain a "." (the newer
     * z.ai keys look like "id.secret" but are actually plain Bearer
     * tokens, NOT BigModel JWT pairs).
     *
     * The legacy BigModel.cn JWT signing path is kept available via the
     * `ZAI_AUTH_MODE=jwt` env var for users who still hold genuine
     * `id.secret` BigModel keys. Everything else uses the key as-is.
     */
    const authMode = (serverEnv as any)?.ZAI_AUTH_MODE || (apiKeys as any)?.ZAI_AUTH_MODE || 'bearer';
    const token = authMode === 'jwt' && apiKey.includes('.') ? this._generateToken(apiKey) : apiKey;

    try {
      const response = await fetch(`${baseUrl}/models`, {
        headers: {
          Authorization: `Bearer ${token}`,
          'Content-Type': 'application/json',
        },
      });

      if (!response.ok) {
        throw new Error(`Failed to fetch models: ${response.status} ${response.statusText}`);
      }

      const res = (await response.json()) as any;
      const staticModelIds = this.staticModels.map((m) => m.name);

      // Filter out static models and only include GLM models
      const data =
        res.data?.filter(
          (model: any) =>
            model.object === 'model' && model.id?.startsWith('glm-') && !staticModelIds.includes(model.id),
        ) || [];

      return data.map((m: any) => {
        let contextWindow = 128000;
        let maxCompletionTokens = 65536;

        if (m.id?.includes('glm-4.6')) {
          contextWindow = 200000;
          maxCompletionTokens = 65536;
        } else if (m.id?.includes('glm-4.5')) {
          contextWindow = 128000;
          maxCompletionTokens = 65536;
        } else if (m.id?.includes('glm-4')) {
          contextWindow = 128000;
          maxCompletionTokens = 8192;
        } else if (m.id?.includes('glm-3')) {
          contextWindow = 32000;
          maxCompletionTokens = 4096;
        }

        return {
          name: m.id,
          label: `${m.id} (${Math.floor(contextWindow / 1000)}k context)`,
          provider: this.name,
          maxTokenAllowed: contextWindow,
          maxCompletionTokens,
          capabilities: detectModelCapabilities(this.name, m.id),
        };
      });
    } catch (error) {
      console.error(`Failed to fetch dynamic models for ${this.name}:`, error);
      return [];
    }
  }

  private _generateToken(apiKey: string): string {
    try {
      const [id, secret] = apiKey.split('.');

      if (!id || !secret) {
        throw new Error(`Invalid API key format for ${this.name}. Expected: id.secret`);
      }

      const now = Date.now();
      const payload = {
        apiKey: id,
        exp: now + 3600 * 1000,
        timestamp: now,
      };

      const header = { alg: 'HS256', sign_type: 'SIGN' };

      const base64Url = (obj: any) =>
        Buffer.from(JSON.stringify(obj)).toString('base64').replace(/=/g, '').replace(/\+/g, '-').replace(/\//g, '_');
      const signature = crypto
        .createHmac('sha256', secret)
        .update(base64Url(header) + '.' + base64Url(payload))
        .digest('base64')
        .replace(/=/g, '')
        .replace(/\+/g, '-')
        .replace(/\//g, '_');

      return `${base64Url(header)}.${base64Url(payload)}.${signature}`;
    } catch (error) {
      console.error(`Failed to generate JWT token for ${this.name}:`, error);
      throw new Error(`Failed to generate JWT token: ${error instanceof Error ? error.message : 'Unknown error'}`);
    }
  }

  /**
   * Validates JWT token format
   */
  private _isValidToken(token: string): boolean {
    try {
      const parts = token.split('.');
      return parts.length === 3 && parts.every((part) => part.length > 0);
    } catch {
      return false;
    }
  }

  getModelInstance(options: {
    model: string;
    serverEnv: Env;
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
  }): any {
    const { model, serverEnv, apiKeys, providerSettings } = options;

    const { baseUrl, apiKey } = this.getProviderBaseUrlAndKey({
      apiKeys,
      providerSettings: providerSettings?.[this.name],
      serverEnv: serverEnv as any,
      defaultBaseUrlKey: 'ZAI_BASE_URL',
      defaultApiTokenKey: 'ZAI_API_KEY',
    });

    if (!apiKey) {
      throw new Error(`Missing API key for ${this.name} provider`);
    }

    /*
     * Authentication mode selection (see getDynamicModels for full notes).
     * Default: plain Bearer token (z.ai API). JWT signing only when
     * `ZAI_AUTH_MODE=jwt` is set AND the key contains a ".".
     */
    const authMode = (serverEnv as any)?.ZAI_AUTH_MODE || (providerSettings as any)?.ZAI_AUTH_MODE || 'bearer';
    const token = authMode === 'jwt' && apiKey.includes('.') ? this._generateToken(apiKey) : apiKey;
    const zaiClient = createOpenAI({
      baseURL: baseUrl,
      apiKey: token,

      /*
       * Inject the retry-aware fetch so transient 502/503/504 from z.ai's
       * ALB are transparently retried instead of surfacing raw HTML error
       * pages to the user. Also falls back from the Coding Plan endpoint
       * (/api/coding/paas/v4) to the standard endpoint (/api/paas/v4)
       * if the Coding Plan tier is persistently unavailable.
       */
      fetch: makeZaiFetch({
        maxRetries: 4,
        fallbackBaseUrls: ['https://api.z.ai/api/coding/paas/v4', 'https://api.z.ai/api/paas/v4'],
      }),
    });

    return zaiClient(model);
  }
}
