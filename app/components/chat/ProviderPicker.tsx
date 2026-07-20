import React, { useState, useMemo, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Search, Plus, Loader2, CheckCircle2, AlertCircle, ExternalLink, Eye, EyeOff } from 'lucide-react';
import Cookies from 'js-cookie';
import type { ProviderInfo } from '~/types/model';
import { LOCAL_PROVIDERS, providersStore, updateProviderSettings } from '~/lib/stores/settings';
import { useStore } from '@nanostores/react';
import { getApiKeysFromCookies } from './APIKeyManager';
import { customProvidersStore, addCustomProvider, type CustomProvider } from '~/lib/stores/custom-providers';

interface ProviderPickerProps {
  open: boolean;
  onClose: () => void;
  /**
   * Full list of built-in providers (from PROVIDER_LIST / LLMManager).
   * The picker lists EVERY one, regardless of enabled state —
   * the user can toggle each on/off.
   */
  providerList: ProviderInfo[];
  /** Currently selected provider. */
  provider?: ProviderInfo;
  /** Set the active provider (when the user picks one). */
  setProvider?: (provider: ProviderInfo) => void;
  /** API keys map (from parent). */
  apiKeys: Record<string, string>;
  /** Notify parent when an API key is saved (so it can refresh model lists). */
  onApiKeySaved?: (providerName: string, apiKey: string) => void;
}

/**
 * Provider picker — replaces the old "Add Provider" overlay.
 *
 * Lists EVERY available built-in provider with an enable/disable toggle.
 * When the user enables a non-local provider that doesn't yet have an API
 * key, the picker immediately opens an inline "Enter API key" popup that
 * validates the key against the provider's /models endpoint (via
 * /api/test-provider) BEFORE saving it to localStorage + cookies.
 *
 * Custom OpenAI-compatible providers can also be added from this picker.
 *
 * The visual design faithfully matches the curated model_environment_console
 * prototype: dark #1c1c1e panel, indigo accents, Iconify icons, and a
 * clean toggle row.
 */
export const ProviderPicker: React.FC<ProviderPickerProps> = ({
  open,
  onClose,
  providerList,
  provider,
  setProvider,
  apiKeys,
  onApiKeySaved,
}) => {
  const providerSettings = useStore(providersStore);
  const customProviders = useStore(customProvidersStore);

  const [searchQuery, setSearchQuery] = useState('');
  const [addMode, setAddMode] = useState(false);

  // Inline API-key entry for the provider currently being enabled.
  // null = no key entry in progress.
  const [keyEntryFor, setKeyEntryFor] = useState<ProviderInfo | null>(null);

  // Custom provider form state
  const [customName, setCustomName] = useState('');
  const [customBaseUrl, setCustomBaseUrl] = useState('');
  const [customApiKey, setCustomApiKey] = useState('');
  const [customTest, setCustomTest] = useState<
    | { kind: 'idle' }
    | { kind: 'testing' }
    | { kind: 'success'; sample: string[] }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  // Reset transient state every time the picker opens.
  useEffect(() => {
    if (open) {
      setSearchQuery('');
      setAddMode(false);
      setKeyEntryFor(null);
      setCustomName('');
      setCustomBaseUrl('');
      setCustomApiKey('');
      setCustomTest({ kind: 'idle' });
    }
  }, [open]);

  // Close on Escape
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') onClose();
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Filter providers by search query
  const filteredProviders = useMemo(() => {
    if (!searchQuery.trim()) return providerList;
    const q = searchQuery.toLowerCase();
    return providerList.filter((p) => p.name.toLowerCase().includes(q));
  }, [providerList, searchQuery]);

  // Is a given provider enabled?
  const isEnabled = (name: string): boolean => {
    return providerSettings[name]?.settings?.enabled ?? !LOCAL_PROVIDERS.includes(name);
  };

  // Does this provider have an API key set (locally or via env)?
  const hasKey = (name: string): boolean => {
    if (LOCAL_PROVIDERS.includes(name)) return true;
    return !!apiKeys[name];
  };

  // Toggle a provider on/off.
  // When enabling a non-local provider with no key, open the key entry popup.
  const handleToggle = (p: ProviderInfo) => {
    const currentlyEnabled = isEnabled(p.name);
    const nextEnabled = !currentlyEnabled;

    updateProviderSettings(p.name, { enabled: nextEnabled } as any);

    if (nextEnabled && !LOCAL_PROVIDERS.includes(p.name) && !hasKey(p.name)) {
      // Need a key — open the inline key entry popup.
      setKeyEntryFor(p);
    } else if (nextEnabled) {
      // Just became enabled and has a key (or is local) — pick it as active.
      setProvider?.(p);
    }
  };

  // Activate a provider (when its row is clicked) without toggling its
  // enabled state. Only activates if already enabled.
  const handleActivate = (p: ProviderInfo) => {
    if (!isEnabled(p.name)) return;
    if (LOCAL_PROVIDERS.includes(p.name) || hasKey(p.name)) {
      setProvider?.(p);
    } else {
      setKeyEntryFor(p);
    }
  };

  // Save an API key for the keyEntryFor provider.
  // Always validates via /api/test-provider before saving.
  const handleSaveKey = async (key: string): Promise<{ ok: boolean; error?: string }> => {
    if (!keyEntryFor) return { ok: false, error: 'No provider selected' };
    if (!key.trim()) return { ok: false, error: 'API key is required' };

    // For built-in providers, we don't have a known base URL on the client
    // (it lives in the server-side provider config). Use the provider's
    // getApiKeyLink host as a hint, falling back to a generic /v1/models
    // probe against the well-known endpoint for major providers.
    const baseUrl = guessProviderBaseUrl(keyEntryFor.name);

    try {
      const res = await fetch('/api/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl, apiKey: key }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; sample?: string[] };

      if (!data.ok) {
        return { ok: false, error: data.error || 'Validation failed' };
      }

      // Persist to localStorage + cookies (mirrors APIKeyPopup behaviour).
      const storedApiKeys = localStorage.getItem('apiKeys');
      const currentKeys: Record<string, string> = storedApiKeys ? JSON.parse(storedApiKeys) : {};
      const newKeys = { ...currentKeys, [keyEntryFor.name]: key };
      localStorage.setItem('apiKeys', JSON.stringify(newKeys));
      Cookies.set('apiKeys', JSON.stringify(newKeys), { expires: 365, sameSite: 'lax' });

      // Notify parent so it can refresh model lists.
      onApiKeySaved?.(keyEntryFor.name, key);

      // Activate this provider now that it has a key.
      setProvider?.(keyEntryFor);

      // Close the popup.
      setKeyEntryFor(null);
      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Network error during validation' };
    }
  };

  // Test + save a custom OpenAI-compatible provider.
  const handleAddCustom = async () => {
    if (!customName.trim() || !customBaseUrl.trim() || !customApiKey.trim()) {
      setCustomTest({ kind: 'error', message: 'All fields are required' });
      return;
    }

    setCustomTest({ kind: 'testing' });

    try {
      const res = await fetch('/api/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: customBaseUrl, apiKey: customApiKey }),
      });
      const data = (await res.json()) as { ok: boolean; error?: string; sample?: string[] };

      if (!data.ok) {
        setCustomTest({ kind: 'error', message: data.error || 'Validation failed' });
        return;
      }

      const created: CustomProvider = addCustomProvider({
        name: customName,
        baseUrl: customBaseUrl,
        apiKey: customApiKey,
      });

      // Reset form
      setCustomName('');
      setCustomBaseUrl('');
      setCustomApiKey('');
      setCustomTest({ kind: 'idle' });
      setAddMode(false);

      void created;
    } catch (err: any) {
      setCustomTest({ kind: 'error', message: err?.message || 'Failed to add provider' });
    }
  };

  if (!open) return null;

  return (
    <div className="fixed inset-0 z-[100] flex items-center justify-center p-4">
      {/* Backdrop */}
      <motion.div
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        className="absolute inset-0 bg-black/60 backdrop-blur-sm"
        onClick={onClose}
      />

      {/* Picker panel */}
      <motion.div
        initial={{ opacity: 0, scale: 0.96, y: 12 }}
        animate={{ opacity: 1, scale: 1, y: 0 }}
        exit={{ opacity: 0, scale: 0.96, y: 12 }}
        transition={{ type: 'spring', bounce: 0.1, duration: 0.3 }}
        className="relative w-full max-w-md bg-[#1c1c1e] border border-zinc-800/80 rounded-2xl shadow-[0_24px_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden flex flex-col"
        style={{ maxHeight: '85vh' }}
      >
        {/* Header */}
        <div className="p-4 border-b border-zinc-800/60 flex items-center justify-between flex-shrink-0">
          <div>
            <span className="text-[10px] text-zinc-500 font-bold uppercase tracking-wider block">
              {addMode ? 'Add Custom Provider' : 'Active Core Providers'}
            </span>
            <span className="text-white text-sm font-semibold">
              {addMode ? 'OpenAI-compatible endpoint' : 'Manage providers'}
            </span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition p-1 rounded-md hover:bg-zinc-800/60"
          >
            <X className="w-4 h-4" />
          </button>
        </div>

        {!addMode ? (
          <>
            {/* Search bar */}
            <div className="p-3 border-b border-zinc-800/60 flex-shrink-0">
              <div className="relative">
                <Search className="absolute left-2.5 top-2.5 text-zinc-500" size={14} />
                <input
                  type="text"
                  placeholder="Search providers..."
                  value={searchQuery}
                  onChange={(e) => setSearchQuery(e.target.value)}
                  className="w-full bg-[#2c2c2e]/60 text-white text-xs pl-8 pr-7 py-1.5 h-8 rounded-lg outline-none border border-transparent focus:border-zinc-700 transition"
                  autoFocus
                />
                {searchQuery && (
                  <button
                    onClick={() => setSearchQuery('')}
                    className="absolute right-2 top-2 text-zinc-500 hover:text-zinc-300"
                  >
                    <X size={12} />
                  </button>
                )}
              </div>
            </div>

            {/* Provider list */}
            <div className="flex-grow overflow-y-auto p-3 space-y-2 no-scrollbar">
              {filteredProviders.length === 0 ? (
                <div className="flex flex-col items-center justify-center py-8 text-center text-zinc-600">
                  <AlertCircle className="mb-1" size={18} />
                  <span className="text-[10px]">No matching providers</span>
                </div>
              ) : (
                filteredProviders.map((p) => {
                  const enabled = isEnabled(p.name);
                  const keyed = hasKey(p.name);
                  const isActive = provider?.name === p.name;
                  const isLocal = LOCAL_PROVIDERS.includes(p.name);

                  return (
                    <div
                      key={p.name}
                      className={`p-2.5 rounded-xl border transition flex items-center justify-between cursor-pointer ${
                        isActive
                          ? 'border-indigo-500/40 bg-indigo-500/5'
                          : 'border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-900/80'
                      }`}
                      onClick={() => handleActivate(p)}
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800/80 flex items-center justify-center flex-shrink-0">
                          <Icon icon={providerIcon(p.name)} className="text-base text-zinc-200" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[11px] font-bold text-zinc-200 block leading-tight truncate">
                            {p.name}
                          </span>
                          <span className="text-[9px] text-zinc-500 flex items-center gap-1.5">
                            {isLocal ? (
                              <span className="text-amber-400">local</span>
                            ) : keyed ? (
                              <span className="text-green-400 flex items-center gap-0.5">
                                <CheckCircle2 size={9} /> key set
                              </span>
                            ) : (
                              <span className="text-rose-400 flex items-center gap-0.5">
                                <AlertCircle size={9} /> no key
                              </span>
                            )}
                            {enabled && !isLocal && keyed && (
                              <>
                                <span>·</span>
                                <span>{p.staticModels?.length || 0} static</span>
                              </>
                            )}
                          </span>
                        </div>
                      </div>

                      <div className="flex items-center gap-2 flex-shrink-0">
                        {p.getApiKeyLink && !keyed && !isLocal && (
                          <a
                            href={p.getApiKeyLink}
                            target="_blank"
                            rel="noopener noreferrer"
                            onClick={(e) => e.stopPropagation()}
                            className="text-zinc-500 hover:text-indigo-400 transition"
                            title={p.labelForGetApiKey || 'Get API key'}
                          >
                            <ExternalLink size={12} />
                          </a>
                        )}

                        {/* Enable/disable toggle */}
                        <button
                          onClick={(e) => {
                            e.stopPropagation();
                            handleToggle(p);
                          }}
                          className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                            enabled ? 'bg-indigo-600' : 'bg-zinc-800'
                          }`}
                          title={enabled ? 'Disable' : 'Enable'}
                        >
                          <div
                            className={`w-4 h-4 rounded-full bg-white transition-transform ${
                              enabled ? 'translate-x-4' : 'translate-x-0'
                            }`}
                          />
                        </button>
                      </div>
                    </div>
                  );
                })
              )}

              {/* Custom providers section */}
              {customProviders.length > 0 && (
                <div className="pt-2 mt-2 border-t border-zinc-800/60">
                  <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider px-1 mb-2">
                    Custom Providers
                  </div>
                  {customProviders.map((cp) => (
                    <div
                      key={cp.id}
                      className="p-2.5 rounded-xl border border-zinc-800/80 bg-zinc-900/60 hover:bg-zinc-900/80 transition flex items-center justify-between mb-2"
                    >
                      <div className="flex items-center gap-2.5 min-w-0">
                        <div className="w-8 h-8 rounded-lg bg-zinc-800/80 flex items-center justify-center">
                          <Icon icon="lucide:plug" className="text-base text-zinc-200" />
                        </div>
                        <div className="min-w-0">
                          <span className="text-[11px] font-bold text-zinc-200 block leading-tight truncate">
                            {cp.name}
                          </span>
                          <span className="text-[9px] text-zinc-500 truncate block">{cp.baseUrl}</span>
                        </div>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>

            {/* Footer — Add Provider */}
            <div className="border-t border-zinc-800/60 p-2 flex-shrink-0">
              <button
                onClick={() => setAddMode(true)}
                className="w-full flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-xs font-medium bg-[#2c2c2e]/60 text-zinc-200 hover:bg-zinc-800/80 hover:text-white transition"
              >
                <Plus className="w-3.5 h-3.5" />
                Add custom provider
              </button>
            </div>
          </>
        ) : (
          /* Add Custom Provider form */
          <div className="p-4 space-y-3 overflow-y-auto no-scrollbar flex-grow">
            <div>
              <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold block mb-1">
                Display name
              </label>
              <input
                type="text"
                value={customName}
                onChange={(e) => setCustomName(e.target.value)}
                placeholder="My OpenRouter"
                className="w-full bg-[#2c2c2e]/60 text-white text-xs px-3 py-2 h-9 rounded-lg outline-none border border-transparent focus:border-zinc-700 transition"
                autoFocus
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold block mb-1">
                Base URL
              </label>
              <input
                type="text"
                value={customBaseUrl}
                onChange={(e) => setCustomBaseUrl(e.target.value)}
                placeholder="https://openrouter.ai/api/v1"
                className="w-full bg-[#2c2c2e]/60 text-white text-xs px-3 py-2 h-9 rounded-lg outline-none border border-transparent focus:border-zinc-700 transition font-mono"
              />
            </div>
            <div>
              <label className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold block mb-1">
                API key
              </label>
              <input
                type="password"
                value={customApiKey}
                onChange={(e) => setCustomApiKey(e.target.value)}
                placeholder="sk-..."
                className="w-full bg-[#2c2c2e]/60 text-white text-xs px-3 py-2 h-9 rounded-lg outline-none border border-transparent focus:border-zinc-700 transition font-mono"
              />
            </div>

            {customTest.kind === 'error' && (
              <div className="bg-rose-500/10 border border-rose-500/20 rounded-lg p-2 text-[10px] text-rose-300 flex items-start gap-2">
                <AlertCircle size={12} className="flex-shrink-0 mt-0.5" />
                <span>{customTest.message}</span>
              </div>
            )}
            {customTest.kind === 'success' && (
              <div className="bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2 text-[10px] text-emerald-300 flex items-center gap-2">
                <CheckCircle2 size={12} />
                <span>Provider added successfully</span>
              </div>
            )}

            <div className="flex gap-2 pt-2">
              <button
                onClick={() => setAddMode(false)}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition"
              >
                Cancel
              </button>
              <button
                onClick={handleAddCustom}
                disabled={customTest.kind === 'testing'}
                className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
              >
                {customTest.kind === 'testing' ? (
                  <>
                    <Loader2 size={12} className="animate-spin" />
                    Testing...
                  </>
                ) : (
                  'Test & Save'
                )}
              </button>
            </div>
          </div>
        )}
      </motion.div>

      {/* Inline API Key Entry Popup (overlay) */}
      <AnimatePresence>
        {keyEntryFor && (
          <ApiKeyInlinePopup
            provider={keyEntryFor}
            onClose={() => setKeyEntryFor(null)}
            onSave={handleSaveKey}
          />
        )}
      </AnimatePresence>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Inline API key popup with validation                                        */
/* -------------------------------------------------------------------------- */

interface ApiKeyInlinePopupProps {
  provider: ProviderInfo;
  onClose: () => void;
  onSave: (key: string) => Promise<{ ok: boolean; error?: string }>;
}

const ApiKeyInlinePopup: React.FC<ApiKeyInlinePopupProps> = ({ provider, onClose, onSave }) => {
  const [tempKey, setTempKey] = useState('');
  const [showKey, setShowKey] = useState(false);
  const [status, setStatus] = useState<
    | { kind: 'idle' }
    | { kind: 'testing' }
    | { kind: 'success' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' });

  const handleSave = async () => {
    if (!tempKey.trim()) {
      setStatus({ kind: 'error', message: 'API key is required' });
      return;
    }
    setStatus({ kind: 'testing' });
    const result = await onSave(tempKey.trim());
    if (result.ok) {
      setStatus({ kind: 'success' });
    } else {
      setStatus({ kind: 'error', message: result.error || 'Validation failed' });
    }
  };

  return (
    <motion.div
      initial={{ opacity: 0, scale: 0.96 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.96 }}
      transition={{ type: 'spring', bounce: 0.1, duration: 0.25 }}
      className="absolute inset-0 z-[110] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm bg-[#1c1c1e] border border-zinc-800/80 rounded-2xl shadow-2xl p-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <Icon icon={providerIcon(provider.name)} className="text-base text-zinc-200" />
            <span className="text-sm font-bold text-zinc-100">{provider.name} API Key</span>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 transition p-1 rounded-md hover:bg-zinc-800/60"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-[10px] text-zinc-400 mb-3 leading-relaxed">
          Enabling <span className="text-zinc-200 font-semibold">{provider.name}</span> requires a valid API key.
          We'll verify the key against the provider's models endpoint before saving it locally.
        </p>

        {/* Key input */}
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={tempKey}
            onChange={(e) => {
              setTempKey(e.target.value);
              if (status.kind !== 'idle') setStatus({ kind: 'idle' });
            }}
            placeholder="sk-..."
            autoFocus
            className="w-full bg-[#2c2c2e]/60 text-white text-xs px-3 py-2.5 h-9 rounded-lg outline-none border border-transparent focus:border-indigo-500 transition font-mono pr-9"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 text-zinc-500 hover:text-zinc-300"
            title={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>

        {/* Status feedback */}
        {status.kind === 'testing' && (
          <div className="mt-2.5 text-[10px] text-indigo-300 flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" />
            Validating key against {provider.name}...
          </div>
        )}
        {status.kind === 'success' && (
          <div className="mt-2.5 text-[10px] text-emerald-300 flex items-center gap-1.5 bg-emerald-500/10 border border-emerald-500/20 rounded-lg p-2">
            <CheckCircle2 size={11} />
            Key verified and saved to local storage.
          </div>
        )}
        {status.kind === 'error' && (
          <div className="mt-2.5 text-[10px] text-rose-300 flex items-start gap-1.5 bg-rose-500/10 border border-rose-500/20 rounded-lg p-2">
            <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
            <span>{status.message}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-transparent text-zinc-400 hover:text-zinc-200 hover:bg-zinc-800/60 transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={status.kind === 'testing' || status.kind === 'success' || !tempKey.trim()}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-indigo-600 text-white hover:bg-indigo-500 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
          >
            {status.kind === 'testing' ? (
              <>
                <Loader2 size={11} className="animate-spin" />
                Validating...
              </>
            ) : status.kind === 'success' ? (
              <>
                <CheckCircle2 size={11} />
                Saved
              </>
            ) : (
              'Validate & Save'
            )}
          </button>
        </div>

        {/* Get key link */}
        {provider.getApiKeyLink && (
          <div className="mt-3 pt-3 border-t border-zinc-800/60">
            <a
              href={provider.getApiKeyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="text-[10px] text-indigo-400 hover:text-indigo-300 transition flex items-center gap-1"
            >
              <span>{provider.labelForGetApiKey || 'Get your API key here'}</span>
              <ExternalLink size={10} />
            </a>
          </div>
        )}
      </motion.div>
    </motion.div>
  );
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

/**
 * Map provider name -> Iconify icon. Mirrors the curated design which
 * uses Iconify logos for built-in providers.
 */
function providerIcon(name: string): string {
  const map: Record<string, string> = {
    Anthropic: 'logos:anthropic-icon',
    OpenAI: 'logos:openai-icon',
    Google: 'logos:google-gemini',
    DeepSeek: 'selfhst:deepseek',
    xAI: 'selfhst:grok-light',
    Cohere: 'logos:cohere-icon',
    Mistral: 'logos:mistral-icon',
    Groq: 'logos:groq-icon',
    Together: 'logos:together-ai-icon',
    OpenRouter: 'simple-icons:openrouter',
    Hyperbolic: 'simple-icons:h',
    Perplexity: 'simple-icons:perplexity',
    HuggingFace: 'logos:hugging-face-icon',
    Moonshot: 'simple-icons:moon',
    Fireworks: 'simple-icons:fireworks',
    Cerebras: 'simple-icons:cerebras',
    AmazonBedrock: 'logos:aws',
    GitHub: 'logos:github-icon',
    Ollama: 'simple-icons:ollama',
    LMStudio: 'simple-icons:lmms',
    OpenAILike: 'lucide:plug',
    'Z.AI': 'simple-icons:zincsearch',
  };
  return map[name] || 'lucide:cpu';
}

/**
 * Inline <iconify-icon> renderer. We inject the Iconify script lazily —
 * if it isn't already on the page, we add it once. This matches the curated
 * design's resource injection pattern.
 */
let iconifyInjected = false;
function ensureIconify() {
  if (iconifyInjected || typeof window === 'undefined') return;
  if (document.getElementById('iconify-script')) {
    iconifyInjected = true;
    return;
  }
  const s = document.createElement('script');
  s.id = 'iconify-script';
  s.src = 'https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js';
  s.async = true;
  document.head.appendChild(s);
  iconifyInjected = true;
}

const Icon: React.FC<{ icon: string; className?: string; style?: React.CSSProperties }> = ({
  icon,
  className = '',
  style,
}) => {
  React.useEffect(() => {
    ensureIconify();
  }, []);
  // @ts-expect-error — custom element
  return <iconify-icon icon={icon} class={`inline-block align-middle ${className}`} style={style} />;
};

/**
 * Guess the base URL for a built-in provider so we can validate the API key
 * client-side via /api/test-provider.
 *
 * The /api/test-provider endpoint expects a base URL it can append /v1/models
 * to. For most built-in providers the URL is well-known. If we can't guess,
 * we just use the getApiKeyLink host as a fallback (the test endpoint will
 * likely fail, but at least the user can still save the key).
 *
 * NOTE: this is a best-effort client-side hint. The server-side provider
 * config has the authoritative base URL.
 */
function guessProviderBaseUrl(name: string): string {
  const map: Record<string, string> = {
    OpenAI: 'https://api.openai.com/v1',
    Anthropic: 'https://api.anthropic.com/v1',
    Google: 'https://generativelanguage.googleapis.com/v1beta',
    DeepSeek: 'https://api.deepseek.com/v1',
    xAI: 'https://api.x.ai/v1',
    Cohere: 'https://api.cohere.ai/v1',
    Mistral: 'https://api.mistral.ai/v1',
    Groq: 'https://api.groq.com/openai/v1',
    Together: 'https://api.together.xyz/v1',
    OpenRouter: 'https://openrouter.ai/api/v1',
    Hyperbolic: 'https://api.hyperbolic.xyz/v1',
    Perplexity: 'https://api.perplexity.ai',
    HuggingFace: 'https://api-inference.huggingface.co',
    Moonshot: 'https://api.moonshot.cn/v1',
    Fireworks: 'https://api.fireworks.ai/inference/v1',
    Cerebras: 'https://api.cerebras.ai/v1',
    GitHub: 'https://models.inference.ai.azure.com',
    'Z.AI': 'https://api.z.ai/api/paas/v4',
  };
  return map[name] || 'https://api.example.com/v1';
}
