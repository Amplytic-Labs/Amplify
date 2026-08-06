import { atom } from 'nanostores';

/**
 * Custom OpenAI-compatible provider store.
 *
 * Users can add their own provider endpoints via the "Add Provider" popup
 * in the model picker. Each entry has a user-chosen name, a base URL, and
 * an API key — all persisted to localStorage.
 *
 * This is intentionally separate from the existing `providersStore` (which
 * holds the built-in Anthropic / OpenAI / etc. providers and their
 * settings). Custom providers are surfaced in the model picker as a
 * dedicated "Custom" group, and their models are fetched lazily (only
 * after the user picks one) because we cannot know which models a custom
 * endpoint exposes without calling /v1/models.
 *
 * SECURITY: the API key is stored in localStorage. This is acceptable for
 * a local-first, browser-only app — the key never leaves the browser
 * except when forwarded to the user's own provider endpoint via the
 * /api/test-provider and /api/llmcall routes. We do NOT write the key
 * into a cookie (unlike the built-in provider keys) because cookies are
 * sent on every request and these custom endpoints are user-specific.
 *
 * PERSISTENCE: nanostores does not export an `effect` helper, so we
 * persist explicitly inside each mutation function. The store is the
 * in-memory source of truth; localStorage is the persistence layer.
 */

export interface CustomProvider {
  /** Stable UUID generated client-side. */
  id: string;

  /** User-chosen display name, e.g. "My OpenRouter". */
  name: string;

  /**
   * Base URL of the OpenAI-compatible endpoint. May or may not include
   * /v1 — the consumer normalises it.
   */
  baseUrl: string;

  /** Bearer token for the Authorization header. */
  apiKey: string;

  /** ISO timestamp of creation, for sorting / display. */
  createdAt: string;
}

const STORAGE_KEY = 'amplify_custom_providers';

function readFromStorage(): CustomProvider[] {
  if (typeof window === 'undefined') {
    return [];
  }

  try {
    const raw = localStorage.getItem(STORAGE_KEY);

    if (!raw) {
      return [];
    }

    const parsed = JSON.parse(raw);

    if (!Array.isArray(parsed)) {
      return [];
    }

    return parsed.filter(
      (p) =>
        p &&
        typeof p.id === 'string' &&
        typeof p.name === 'string' &&
        typeof p.baseUrl === 'string' &&
        typeof p.apiKey === 'string',
    );
  } catch {
    return [];
  }
}

function writeToStorage(providers: CustomProvider[]): void {
  if (typeof window === 'undefined') {
    return;
  }

  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(providers));
  } catch (e) {
    console.error('[customProviders] Failed to persist:', e);
  }
}

export const customProvidersStore = atom<CustomProvider[]>(readFromStorage());

/** Add a new custom provider. Returns the created provider. */
export function addCustomProvider(input: Omit<CustomProvider, 'id' | 'createdAt'>): CustomProvider {
  const provider: CustomProvider = {
    ...input,
    id: typeof crypto !== 'undefined' && crypto.randomUUID ? crypto.randomUUID() : `cp_${Date.now()}_${Math.random()}`,
    createdAt: new Date().toISOString(),
  };

  const next = [...customProvidersStore.get(), provider];
  customProvidersStore.set(next);
  writeToStorage(next);

  return provider;
}

/** Remove a custom provider by id. */
export function removeCustomProvider(id: string): void {
  const next = customProvidersStore.get().filter((p) => p.id !== id);
  customProvidersStore.set(next);
  writeToStorage(next);
}

/** Update a custom provider's fields. */
export function updateCustomProvider(id: string, patch: Partial<Omit<CustomProvider, 'id' | 'createdAt'>>): void {
  const next = customProvidersStore.get().map((p) => (p.id === id ? { ...p, ...patch } : p));
  customProvidersStore.set(next);
  writeToStorage(next);
}

/**
 * Cross-tab sync: when another tab writes a new list to localStorage,
 * refresh the store so the model picker picks it up.
 */
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === STORAGE_KEY) {
      customProvidersStore.set(readFromStorage());
    }
  });
}
