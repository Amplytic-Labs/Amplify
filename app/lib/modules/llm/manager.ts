import type { IProviderSetting } from '~/types/model';
import { BaseProvider } from './base-provider';
import type { ModelInfo, ProviderInfo } from './types';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('LLMManager');

/**
 * Provider registry — lazy-loaded to reduce the main Worker bundle.
 *
 * Instead of eagerly importing all 22+ provider packages (which adds
 * ~500KB-1MB to the bundle), providers are loaded on-demand when first
 * accessed. This is a significant bundle-size win for Cloudflare Workers
 * where every byte counts toward the size limit.
 *
 * Provider modules are dynamically imported only when:
 * 1. The provider is first accessed via getProvider()
 * 2. The full model list is requested via updateModelList()
 * 3. Static model names are needed for the UI
 */

type ProviderConstructor = new () => BaseProvider;

/** Lazy provider entry — stores the module loader and cached instance */
interface LazyProviderEntry {
  name: string;
  loader: () => Promise<ProviderConstructor>;
  instance?: BaseProvider; // cached after first load
}

const providerRegistry: LazyProviderEntry[] = [
  {
    name: 'Anthropic',
    loader: () => import('./providers/anthropic').then((m) => m.default),
  },
  {
    name: 'AmazonBedrock',
    loader: () => import('./providers/amazon-bedrock').then((m) => m.default),
  },
  {
    name: 'Cerebras',
    loader: () => import('./providers/cerebras').then((m) => m.default),
  },
  {
    name: 'Cohere',
    loader: () => import('./providers/cohere').then((m) => m.default),
  },
  {
    name: 'Deepseek',
    loader: () => import('./providers/deepseek').then((m) => m.default),
  },
  {
    name: 'Fireworks',
    loader: () => import('./providers/fireworks').then((m) => m.default),
  },
  {
    name: 'Github',
    loader: () => import('./providers/github').then((m) => m.default),
  },
  {
    name: 'Google',
    loader: () => import('./providers/google').then((m) => m.default),
  },
  {
    name: 'Groq',
    loader: () => import('./providers/groq').then((m) => m.default),
  },
  {
    name: 'HuggingFace',
    loader: () => import('./providers/huggingface').then((m) => m.default),
  },
  {
    name: 'Hyperbolic',
    loader: () => import('./providers/hyperbolic').then((m) => m.default),
  },
  {
    name: 'LMStudio',
    loader: () => import('./providers/lmstudio').then((m) => m.default),
  },
  {
    name: 'Mistral',
    loader: () => import('./providers/mistral').then((m) => m.default),
  },
  {
    name: 'Moonshot',
    loader: () => import('./providers/moonshot').then((m) => m.default),
  },
  {
    name: 'Ollama',
    loader: () => import('./providers/ollama').then((m) => m.default),
  },
  {
    name: 'OpenAI',
    loader: () => import('./providers/openai').then((m) => m.default),
  },
  {
    name: 'OpenAILike',
    loader: () => import('./providers/openai-like').then((m) => m.default),
  },
  {
    name: 'OpenRouter',
    loader: () => import('./providers/open-router').then((m) => m.default),
  },
  {
    name: 'Perplexity',
    loader: () => import('./providers/perplexity').then((m) => m.default),
  },
  {
    name: 'Together',
    loader: () => import('./providers/together').then((m) => m.default),
  },
  {
    name: 'XAI',
    loader: () => import('./providers/xai').then((m) => m.default),
  },
  {
    name: 'Zai',
    loader: () => import('./providers/z-ai').then((m) => m.default),
  },
];

export class LLMManager {
  private static _instance: LLMManager;
  private _providers: Map<string, BaseProvider> = new Map();
  private _modelList: ModelInfo[] = [];
  private _env: Record<string, string> = {};
  private _initialized = false;

  private constructor(_env: Record<string, string>) {
    this._env = _env;
  }

  static getInstance(env: Record<string, string> = {}): LLMManager {
    if (!LLMManager._instance) {
      LLMManager._instance = new LLMManager(env);
    } else if (Object.keys(env).length > 0) {
      // Update env on subsequent calls so Cloudflare Workers get fresh bindings
      LLMManager._instance._env = env;
    }

    return LLMManager._instance;
  }

  get env() {
    return this._env;
  }

  /**
   * Initialize all providers — loads them lazily.
   * This is called once and cached for subsequent requests.
   */
  private async _registerProvidersFromDirectory() {
    if (this._initialized) {
      return;
    }

    try {
      // Load all providers in parallel for speed
      const loaded = await Promise.all(
        providerRegistry.map(async (entry) => {
          try {
            if (!entry.instance) {
              const ProviderClass = await entry.loader();
              entry.instance = new ProviderClass();
            }

            return entry.instance;
          } catch (error: any) {
            logger.warn('Failed To Load Provider: ', entry.name, 'error:', error.message);
            return null;
          }
        }),
      );

      for (const provider of loaded) {
        if (provider) {
          try {
            this.registerProvider(provider);
          } catch (error: any) {
            logger.warn('Failed To Register Provider: ', provider.name, 'error:', error.message);
          }
        }
      }

      this._initialized = true;
    } catch (error) {
      logger.error('Error registering providers:', error);
    }
  }

  /**
   * Ensure providers are loaded before any operation.
   * Call this at the start of any method that accesses _providers.
   */
  private async ensureInitialized() {
    if (!this._initialized) {
      await this._registerProvidersFromDirectory();
    }
  }

  registerProvider(provider: BaseProvider) {
    if (this._providers.has(provider.name)) {
      logger.warn(`Provider ${provider.name} is already registered. Skipping.`);
      return;
    }

    logger.info('Registering Provider: ', provider.name);
    this._providers.set(provider.name, provider);
    this._modelList = [...this._modelList, ...provider.staticModels];
  }

  async getProvider(name: string): Promise<BaseProvider | undefined> {
    await this.ensureInitialized();
    return this._providers.get(name);
  }

  async getAllProviders(): Promise<BaseProvider[]> {
    await this.ensureInitialized();
    return Array.from(this._providers.values());
  }

  async getModelList(): Promise<ModelInfo[]> {
    await this.ensureInitialized();
    return this._modelList;
  }

  async updateModelList(options: {
    apiKeys?: Record<string, string>;
    providerSettings?: Record<string, IProviderSetting>;
    serverEnv?: Record<string, string>;
  }): Promise<ModelInfo[]> {
    await this.ensureInitialized();

    const { apiKeys, providerSettings, serverEnv } = options;

    let enabledProviders = Array.from(this._providers.values()).map((p) => p.name);

    if (providerSettings && Object.keys(providerSettings).length > 0) {
      enabledProviders = enabledProviders.filter((p) => providerSettings[p].enabled);
    }

    // Get dynamic models from all providers that support them
    const dynamicModels = await Promise.all(
      Array.from(this._providers.values())
        .filter((provider) => enabledProviders.includes(provider.name))
        .filter(
          (provider): provider is BaseProvider & Required<Pick<ProviderInfo, 'getDynamicModels'>> =>
            !!provider.getDynamicModels,
        )
        .map(async (provider) => {
          const cachedModels = provider.getModelsFromCache(options);

          if (cachedModels) {
            return cachedModels;
          }

          const dynamicModels = await provider
            .getDynamicModels(apiKeys, providerSettings?.[provider.name], serverEnv)
            .then((models) => {
              logger.info(`Caching ${models.length} dynamic models for ${provider.name}`);
              provider.storeDynamicModels(options, models);

              return models;
            })
            .catch((err) => {
              logger.error(`Error getting dynamic models ${provider.name} :`, err);
              return [];
            });

          return dynamicModels;
        }),
    );
    const staticModels = Array.from(this._providers.values()).flatMap((p) => p.staticModels || []);
    const dynamicModelsFlat = dynamicModels.flat();
    const dynamicModelKeys = dynamicModelsFlat.map((d) => `${d.name}-${d.provider}`);
    const filteredStaticModels = staticModels.filter((m) => !dynamicModelKeys.includes(`${m.name}-${m.provider}`));

    // Combine static and dynamic models
    const modelList = [...dynamicModelsFlat, ...filteredStaticModels];
    modelList.sort((a, b) => a.name.localeCompare(b.name));
    this._modelList = modelList;

    return modelList;
  }

  async getStaticModelList() {
    await this.ensureInitialized();
    return [...this._providers.values()].flatMap((p) => p.staticModels || []);
  }

  async getModelListFromProvider(
    providerArg: BaseProvider,
    options: {
      apiKeys?: Record<string, string>;
      providerSettings?: Record<string, IProviderSetting>;
      serverEnv?: Record<string, string>;
    },
  ): Promise<ModelInfo[]> {
    await this.ensureInitialized();

    const provider = this._providers.get(providerArg.name);

    if (!provider) {
      throw new Error(`Provider ${providerArg.name} not found`);
    }

    const staticModels = provider.staticModels || [];

    if (!provider.getDynamicModels) {
      return staticModels;
    }

    const { apiKeys, providerSettings, serverEnv } = options;

    const cachedModels = provider.getModelsFromCache({
      apiKeys,
      providerSettings,
      serverEnv,
    });

    if (cachedModels) {
      logger.info(`Found ${cachedModels.length} cached models for ${provider.name}`);
      return [...cachedModels, ...staticModels];
    }

    logger.info(`Getting dynamic models for ${provider.name}`);

    const dynamicModels = await provider
      .getDynamicModels?.(apiKeys, providerSettings?.[provider.name], serverEnv)
      .then((models) => {
        logger.info(`Got ${models.length} dynamic models for ${provider.name}`);
        provider.storeDynamicModels(options, models);

        return models;
      })
      .catch((err) => {
        logger.error(`Error getting dynamic models ${provider.name} :`, err);
        return [];
      });
    const dynamicModelsName = dynamicModels.map((d) => d.name);
    const filteredStaticList = staticModels.filter((m) => !dynamicModelsName.includes(m.name));
    const modelList = [...dynamicModels, ...filteredStaticList];
    modelList.sort((a, b) => a.name.localeCompare(b.name));

    return modelList;
  }

  async getStaticModelListFromProvider(providerArg: BaseProvider) {
    await this.ensureInitialized();

    const provider = this._providers.get(providerArg.name);

    if (!provider) {
      throw new Error(`Provider ${providerArg.name} not found`);
    }

    return [...(provider.staticModels || [])];
  }

  async getDefaultProvider(): Promise<BaseProvider> {
    await this.ensureInitialized();

    const firstProvider = this._providers.values().next().value;

    if (!firstProvider) {
      throw new Error('No providers registered');
    }

    return firstProvider;
  }
}
