import { atom } from 'nanostores';

/**
 * Unified MODEL CONFIGURATION store — edited by the ChatBox "settings"
 * popup and translated into per-provider `providerOptions` on the server
 * (see `app/lib/.server/llm/thinking.ts`).
 *
 * Why a shared atom?
 * --------------------
 * The settings popup lives in `ChatBox.tsx` (a child of `BaseChat`), while
 * the request body is constructed in `Chat.client.tsx` (the parent of
 * `BaseChat`). Lifting the state via props would require threading it
 * through `BaseChat` and dealing with stale closures inside `useChat`'s
 * `transport` memo. A nanostores atom lets both sides read/write the same
 * source of truth without prop drilling and without re-creating the
 * transport on every toggle.
 *
 * Persistence
 * -----------
 * Hydrated from `localStorage` on first load and re-persisted on every
 * set, so the user's per-model tuning survives reloads and chat re-opens.
 * The perModel map remembers the last-used settings for each model so
 * switching back to a model restores the user's previous tweaks.
 */

export type ReasoningEffort = 'low' | 'medium' | 'high';

/**
 * The "active" shape used by both the ChatBox UI and the server.
 */
export interface ModelConfig {
  /** Master on/off toggle for models that support toggling (Gemini, Claude). */
  thinkingEnabled: boolean;

  /** Token budget for Gemini 2.5+ and Claude 3.7 / Opus 4 / Sonnet 4. */
  budgetTokens: number;

  /** Effort level for OpenAI o-series, xAI Grok, Mistral Magistral, Gemini 3.x. */
  effort: ReasoningEffort;

  /**
   * Hard cap on the model's output tokens. Overrides the model's default
   * `maxCompletionTokens` / `maxTokens` when set. 0 = use model default.
   */
  maxOutputTokens: number;
}

export interface ModelConfigStore extends ModelConfig {
  /** Per-model last-known config — restored when the user re-selects that model. */
  perModel: Record<string, ModelConfig>;
}

const STORAGE_KEY = 'amplify:model-config';

const DEFAULT_CONFIG: ModelConfig = {
  thinkingEnabled: true,
  budgetTokens: 4096,
  effort: 'medium',
  maxOutputTokens: 0, // 0 = use model default
};

const DEFAULT_STORE: ModelConfigStore = {
  ...DEFAULT_CONFIG,
  perModel: {},
};

function readFromStorage(): ModelConfigStore {
  if (typeof window === 'undefined') {
    return DEFAULT_STORE;
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return DEFAULT_STORE;
    }

    const parsed = JSON.parse(raw) as Partial<ModelConfigStore>;

    return {
      ...DEFAULT_CONFIG,
      ...parsed,
      perModel: parsed.perModel ?? {},
    };
  } catch {
    return DEFAULT_STORE;
  }
}

function writeToStorage(value: ModelConfigStore) {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(value));
  } catch {
    /* ignore quota / privacy-mode errors */
  }
}

export const modelConfigStore = atom<ModelConfigStore>(readFromStorage());

// Keep storage in sync whenever the atom changes.
modelConfigStore.listen((value) => {
  writeToStorage(value);
});

/**
 * The "wire" format sent to the server in the /api/chat body. The server
 * doesn't need the perModel map — only the active settings to translate
 * into providerOptions.
 */
export type ModelConfigWire = ModelConfig;

export function getWireConfig(): ModelConfigWire {
  const v = modelConfigStore.get();

  return {
    thinkingEnabled: v.thinkingEnabled,
    budgetTokens: v.budgetTokens,
    effort: v.effort,
    maxOutputTokens: v.maxOutputTokens,
  };
}

/** Update the "active" fields of the store (perModel is preserved). */
export function updateModelConfig(patch: Partial<ModelConfig>) {
  const current = modelConfigStore.get();

  modelConfigStore.set({
    ...current,
    ...patch,
  });
}

/**
 * Snapshot the CURRENT active settings into the perModel map under the
 * given key, so switching back to this model later restores them.
 */
export function saveForModel(provider: string, modelName: string) {
  const current = modelConfigStore.get();
  const key = `${provider}:${modelName}`;

  modelConfigStore.set({
    ...current,
    perModel: {
      ...current.perModel,
      [key]: {
        thinkingEnabled: current.thinkingEnabled,
        budgetTokens: current.budgetTokens,
        effort: current.effort,
        maxOutputTokens: current.maxOutputTokens,
      },
    },
  });
}

/**
 * Restore the saved settings for the given model, if any. Returns true if
 * a restore happened (so the caller can skip defaulting).
 */
export function restoreForModel(provider: string, modelName: string): boolean {
  const current = modelConfigStore.get();
  const key = `${provider}:${modelName}`;
  const saved = current.perModel[key];

  if (!saved) {
    return false;
  }

  modelConfigStore.set({
    ...current,
    ...saved,
  });

  return true;
}
