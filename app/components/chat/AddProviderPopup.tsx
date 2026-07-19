import React, { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { X, Plus, Loader2, CheckCircle2, AlertCircle, ChevronRight } from 'lucide-react';
import { classNames } from '~/utils/classNames';
import { addCustomProvider } from '~/lib/stores/custom-providers';
import type { ProviderInfo } from '~/types/model';

interface AddProviderPopupProps {
  open: boolean;
  onClose: () => void;
  /** Built-in providers the user can pick instead of adding a custom one. */
  existingProviders: ProviderInfo[];
  /** Called when the user picks an existing provider. */
  onSelectExisting?: (provider: ProviderInfo) => void;
  /** Called after a custom provider is successfully added. */
  onCustomProviderAdded?: (providerId: string, providerName: string) => void;
}

type TestState =
  | { kind: 'idle' }
  | { kind: 'testing' }
  | { kind: 'success'; sample: string[]; testedUrl: string }
  | { kind: 'error'; message: string };

/**
 * "Add Provider" popup — opened from the model picker's "Add Provider"
 * affordance. Lets the user EITHER:
 *
 *   1. Pick an existing built-in provider (Anthropic, OpenAI, …) — useful
 *      when the user just wants to switch to a provider they haven't
 *      enabled yet.
 *
 *   2. Provide a custom OpenAI-compatible endpoint:
 *        - Display name (e.g. "My OpenRouter")
 *        - Base URL    (e.g. https://openrouter.ai/api/v1)
 *        - API key     (Bearer token)
 *
 *      Before saving, the user can click "Test" — we hit /api/test-provider
 *      which calls GET <baseUrl>/v1/models with the key and reports whether
 *      it worked. This avoids saving a broken provider.
 *
 * The popup is rendered as a fixed-position modal (centred, with backdrop)
 * so it doesn't get clipped by the parent dropdown's overflow.
 */
export const AddProviderPopup: React.FC<AddProviderPopupProps> = ({
  open,
  onClose,
  existingProviders,
  onSelectExisting,
  onCustomProviderAdded,
}) => {
  const [mode, setMode] = useState<'pick' | 'custom'>('pick');
  const [name, setName] = useState('');
  const [baseUrl, setBaseUrl] = useState('');
  const [apiKey, setApiKey] = useState('');
  const [test, setTest] = useState<TestState>({ kind: 'idle' });
  const [saving, setSaving] = useState(false);

  const firstInputRef = useRef<HTMLInputElement>(null);

  // Reset state every time the popup opens.
  useEffect(() => {
    if (open) {
      setMode('pick');
      setName('');
      setBaseUrl('');
      setApiKey('');
      setTest({ kind: 'idle' });
      setSaving(false);
    }
  }, [open]);

  // Close on Escape.
  useEffect(() => {
    if (!open) {
      return;
    }

    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        onClose();
      }
    };

    document.addEventListener('keydown', onKey);

    return () => document.removeEventListener('keydown', onKey);
  }, [open, onClose]);

  // Autofocus the first input when switching to custom mode.
  useEffect(() => {
    if (open && mode === 'custom') {
      setTimeout(() => firstInputRef.current?.focus(), 50);
    }
  }, [open, mode]);

  const handleTest = async () => {
    if (!baseUrl.trim() || !apiKey.trim()) {
      setTest({ kind: 'error', message: 'Base URL and API key are required.' });

      return;
    }

    setTest({ kind: 'testing' });

    try {
      const res = await fetch('/api/test-provider', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ baseUrl: baseUrl.trim(), apiKey: apiKey.trim() }),
      });

      const data = (await res.json()) as { ok?: boolean; error?: string; sample?: string[]; testedUrl?: string };

      if (data.ok) {
        setTest({ kind: 'success', sample: data.sample || [], testedUrl: data.testedUrl || '' });
      } else {
        setTest({ kind: 'error', message: data.error || 'Test failed' });
      }
    } catch (e: any) {
      setTest({ kind: 'error', message: e?.message || 'Network error' });
    }
  };

  const handleSave = async () => {
    if (!name.trim() || !baseUrl.trim() || !apiKey.trim()) {
      return;
    }

    setSaving(true);

    try {
      const provider = addCustomProvider({
        name: name.trim(),
        baseUrl: baseUrl.trim(),
        apiKey: apiKey.trim(),
      });

      onCustomProviderAdded?.(provider.id, provider.name);
      onClose();
    } finally {
      setSaving(false);
    }
  };

  return (
    <AnimatePresence>
      {open && (
        <motion.div
          initial={{ opacity: 0 }}
          animate={{ opacity: 1 }}
          exit={{ opacity: 0 }}
          transition={{ duration: 0.18 }}
          className="fixed inset-0 z-[100] flex items-center justify-center p-4 bg-black/40 backdrop-blur-sm"
          onClick={onClose}
        >
          <motion.div
            initial={{ opacity: 0, scale: 0.96, y: 8 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.96, y: 8 }}
            transition={{ duration: 0.18, ease: [0.16, 1, 0.3, 1] }}
            className="w-full max-w-lg max-h-[85vh] flex flex-col rounded-2xl border shadow-2xl overflow-hidden bg-[var(--popover)] border-[var(--border)] text-[var(--popover-foreground)]"
            onClick={(e) => e.stopPropagation()}
          >
            {/* Header */}
            <div className="flex items-center justify-between px-5 py-4 border-b border-[var(--border)] bg-[var(--card)]">
              <div className="flex items-center gap-2.5">
                <div className="p-1.5 rounded-lg bg-[var(--muted)] text-[var(--primary)]">
                  <Plus className="w-4 h-4" />
                </div>
                <div>
                  <h2 className="text-sm font-semibold">Add Provider</h2>
                  <p className="text-[11px] text-[var(--muted-foreground)]">
                    Pick a built-in one or add an OpenAI-compatible endpoint.
                  </p>
                </div>
              </div>
              <button
                onClick={onClose}
                className="p-1.5 rounded-md text-[var(--muted-foreground)] hover:text-[var(--foreground)] hover:bg-[var(--muted)] transition-colors"
                aria-label="Close"
              >
                <X className="w-4 h-4" />
              </button>
            </div>

            {/* Mode switcher */}
            <div className="flex gap-1 px-5 pt-3 pb-2">
              <button
                onClick={() => setMode('pick')}
                className={classNames(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  mode === 'pick'
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                )}
              >
                Existing
              </button>
              <button
                onClick={() => setMode('custom')}
                className={classNames(
                  'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                  mode === 'custom'
                    ? 'bg-[var(--primary)] text-[var(--primary-foreground)]'
                    : 'bg-[var(--muted)] text-[var(--muted-foreground)] hover:text-[var(--foreground)]',
                )}
              >
                Custom (OpenAI-compatible)
              </button>
            </div>

            {/* Body */}
            <div className="flex-1 overflow-y-auto px-5 py-3">
              {mode === 'pick' ? (
                <div className="space-y-1">
                  {existingProviders.length === 0 ? (
                    <p className="text-xs text-[var(--muted-foreground)] py-6 text-center">No providers available.</p>
                  ) : (
                    existingProviders.map((p) => (
                      <button
                        key={p.name}
                        onClick={() => {
                          onSelectExisting?.(p);
                          onClose();
                        }}
                        className="w-full flex items-center justify-between gap-3 px-3 py-2 rounded-lg text-left transition-colors bg-transparent hover:bg-[var(--muted)] border border-transparent hover:border-[var(--border)]"
                      >
                        <div className="flex items-center gap-2.5 min-w-0">
                          <span
                            className={classNames(
                              p.icon || 'i-ph:plug',
                              'w-4 h-4 flex-shrink-0 text-[var(--muted-foreground)]',
                            )}
                          />
                          <div className="min-w-0">
                            <p className="text-xs font-medium text-[var(--foreground)] truncate">{p.name}</p>
                            {p.getApiKeyLink && (
                              <p className="text-[10px] text-[var(--muted-foreground)] truncate">
                                {p.labelForGetApiKey || 'Get API key'}
                              </p>
                            )}
                          </div>
                        </div>
                        <ChevronRight className="w-3.5 h-3.5 text-[var(--muted-foreground)] flex-shrink-0" />
                      </button>
                    ))
                  )}
                </div>
              ) : (
                <div className="space-y-3">
                  {/* Name */}
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1">
                      Display name
                    </label>
                    <input
                      ref={firstInputRef}
                      type="text"
                      value={name}
                      onChange={(e) => setName(e.target.value)}
                      placeholder="e.g. My OpenRouter"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)]"
                    />
                  </div>

                  {/* Base URL */}
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1">
                      Base URL
                    </label>
                    <input
                      type="url"
                      value={baseUrl}
                      onChange={(e) => {
                        setBaseUrl(e.target.value);
                        setTest({ kind: 'idle' });
                      }}
                      placeholder="https://api.example.com/v1"
                      className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] font-mono"
                    />
                    <p className="text-[10px] text-[var(--muted-foreground)] mt-1">
                      We'll call <code className="font-mono">&lt;base&gt;/models</code> to verify.
                    </p>
                  </div>

                  {/* API Key */}
                  <div>
                    <label className="block text-[11px] font-medium text-[var(--muted-foreground)] mb-1">API Key</label>
                    <input
                      type="password"
                      value={apiKey}
                      onChange={(e) => {
                        setApiKey(e.target.value);
                        setTest({ kind: 'idle' });
                      }}
                      placeholder="sk-..."
                      className="w-full px-3 py-2 text-sm rounded-lg bg-[var(--muted)] border border-[var(--border)] text-[var(--foreground)] placeholder:text-[var(--muted-foreground)] focus:outline-none focus:ring-2 focus:ring-[var(--ring)] font-mono"
                    />
                  </div>

                  {/* Test row */}
                  <div className="flex items-center gap-2">
                    <button
                      onClick={handleTest}
                      disabled={test.kind === 'testing' || !baseUrl.trim() || !apiKey.trim()}
                      className={classNames(
                        'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors flex items-center gap-1.5',
                        test.kind === 'testing' || !baseUrl.trim() || !apiKey.trim()
                          ? 'bg-[var(--muted)] text-[var(--muted-foreground)] cursor-not-allowed'
                          : 'bg-[var(--secondary)] text-[var(--secondary-foreground)] hover:bg-[var(--accent)]',
                      )}
                    >
                      {test.kind === 'testing' ? (
                        <>
                          <Loader2 className="w-3.5 h-3.5 animate-spin" />
                          Testing…
                        </>
                      ) : (
                        'Test connection'
                      )}
                    </button>

                    <AnimatePresence mode="wait">
                      {test.kind === 'success' && (
                        <motion.div
                          key="success"
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -4 }}
                          className="flex items-center gap-1.5 text-[11px] text-green-600 dark:text-green-400"
                        >
                          <CheckCircle2 className="w-3.5 h-3.5" />
                          <span>
                            OK — {test.sample.length} model{test.sample.length === 1 ? '' : 's'} visible
                            {test.sample.length > 0 && (
                              <span className="text-[var(--muted-foreground)] ml-1">
                                ({test.sample.slice(0, 3).join(', ')}
                                {test.sample.length > 3 ? '…' : ''})
                              </span>
                            )}
                          </span>
                        </motion.div>
                      )}
                      {test.kind === 'error' && (
                        <motion.div
                          key="error"
                          initial={{ opacity: 0, x: -4 }}
                          animate={{ opacity: 1, x: 0 }}
                          exit={{ opacity: 0, x: -4 }}
                          className="flex items-center gap-1.5 text-[11px] text-red-600 dark:text-red-400"
                        >
                          <AlertCircle className="w-3.5 h-3.5 flex-shrink-0" />
                          <span className="truncate" title={test.message}>
                            {test.message}
                          </span>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                </div>
              )}
            </div>

            {/* Footer (custom mode only) */}
            {mode === 'custom' && (
              <div className="flex items-center justify-end gap-2 px-5 py-3 border-t border-[var(--border)] bg-[var(--card)]">
                <button
                  onClick={onClose}
                  className="px-3 py-1.5 text-xs font-medium text-[var(--muted-foreground)] hover:text-[var(--foreground)] transition-colors"
                >
                  Cancel
                </button>
                <button
                  onClick={handleSave}
                  disabled={saving || !name.trim() || !baseUrl.trim() || !apiKey.trim()}
                  className={classNames(
                    'px-3 py-1.5 text-xs font-medium rounded-lg transition-colors',
                    saving || !name.trim() || !baseUrl.trim() || !apiKey.trim()
                      ? 'bg-[var(--muted)] text-[var(--muted-foreground)] cursor-not-allowed'
                      : 'bg-[var(--primary)] text-[var(--primary-foreground)] hover:opacity-90',
                  )}
                >
                  {saving ? 'Saving…' : 'Save provider'}
                </button>
              </div>
            )}
          </motion.div>
        </motion.div>
      )}
    </AnimatePresence>
  );
};
