import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Icon as IconifyIcon } from '@iconify/react';
import { X, FileText, Eye, EyeOff, Loader2, CheckCircle2, AlertCircle, ExternalLink } from 'lucide-react';
import { classNames } from '~/utils/classNames';
import { LOCAL_PROVIDERS, providersStore, updateProviderSettings } from '~/lib/stores/settings';
import { Switch } from '~/components/ui/Switch';
import styles from './BaseChat.module.scss';
import type { ProviderInfo } from '~/types/model';
import type { ElementInfo } from '~/components/workbench/Inspector';
import { ContextBudgetIndicator } from './ContextBudgetIndicator';
import { SummarizationToast } from './SummarizationToast';
import { customProvidersStore } from '~/lib/stores/custom-providers';
import { useStore } from '@nanostores/react';
import type { ModelInfo } from '~/lib/modules/llm/types';
import Cookies from 'js-cookie';
import { PROVIDER_LIST } from '~/utils/constants';
import {
  modelConfigStore,
  updateModelConfig,
  saveForModel,
  restoreForModel,
  type ReasoningEffort,
} from '~/lib/stores/model-config';
import {
  rateLimitStore,
  updateRateLimit,
  resetRateLimit,
  SUGGESTED_DEFAULTS,
  type RateLimitConfig,
} from '~/lib/stores/rate-limit';

/**
 * Strip a trailing parenthesised context suffix from a model label.
 *
 * Dynamic model lists from providers like OpenRouter / HuggingFace often
 * come back as `"Gemma 4 31B IT (262k context)"`. The parenthesised part
 * is metadata that clutters the trigger. Stripped from the TRIGGER only —
 * the full label is still shown in the dropdown list.
 */
function stripContextSuffix(label: string | undefined): string {
  if (!label) {
    return '';
  }

  return label.replace(/\s*\([^()]*\)\s*$/, '').trim();
}

interface ChatBoxProps {
  provider: any;
  providerList: any[];
  modelList: ModelInfo[];
  apiKeys: Record<string, string>;
  isModelLoading: string | undefined;
  onApiKeysChange: (providerName: string, apiKey: string) => void;
  uploadedFiles: File[];
  imageDataList: string[];
  textareaRef: React.RefObject<HTMLTextAreaElement> | undefined;
  input: string;
  handlePaste: (e: React.ClipboardEvent) => void;
  TEXTAREA_MIN_HEIGHT: number;
  TEXTAREA_MAX_HEIGHT: number;
  isStreaming: boolean;
  handleSendMessage: (event: React.UIEvent, messageInput?: string) => void;
  chatStarted: boolean;
  handleFileUpload: () => void;
  setProvider?: ((provider: ProviderInfo) => void) | undefined;
  model?: string | undefined;
  setModel?: ((model: string) => void) | undefined;
  setUploadedFiles?: ((files: File[]) => void) | undefined;
  setImageDataList?: ((dataList: string[]) => void) | undefined;
  handleInputChange?: ((event: React.ChangeEvent<HTMLTextAreaElement>) => void) | undefined;
  handleStop?: (() => void) | undefined;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: ((element: ElementInfo | null) => void) | undefined;
  messages?: any[];
}

/**
 * ChatBox — the chat input bar with integrated model picker, provider picker
 * overlay, and parameter configure panel.
 *
 * The visual design faithfully matches the curated model_environment_console
 * prototype: a borderless input bar, a dual-column popup above it (model
 * list + parameter panel), a compact-mode tab switch on narrow viewports,
 * an inline provider overlay (NOT a separate modal) that lists every
 * provider with an enable/disable toggle, and a rotated send button with
 * a slide-out animation on send.
 *
 * The actual chat area / message list / header are NOT part of this
 * component — those stay in BaseChat.
 */
export const ChatBox: React.FC<ChatBoxProps> = (props) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isProviderOverlayOpen, setIsProviderOverlayOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileActiveTab, setMobileActiveTab] = useState<'list' | 'config'>('list');

  /*
   * ----- Model configuration (thinking + output cap) -----
   * Backed by `modelConfigStore` (nanostores) so the same values are
   * available to Chat.client.tsx's request body without prop drilling.
   * The store also persists to localStorage and remembers per-model
   * settings, so switching back to a model restores the user's tweaks.
   */
  const modelConfig = useStore(modelConfigStore);
  const thinkingEnabled = modelConfig.thinkingEnabled;
  const budgetTokens = modelConfig.budgetTokens;
  const thinkingOverride: ReasoningEffort = modelConfig.effort;
  const maxOutputTokens = modelConfig.maxOutputTokens;

  const setThinkingEnabled = (v: boolean) => updateModelConfig({ thinkingEnabled: v });
  const setBudgetTokens = (v: number) => updateModelConfig({ budgetTokens: v });
  const setThinkingOverride = (v: ReasoningEffort) => updateModelConfig({ effort: v });
  const setMaxOutputTokens = (v: number) => updateModelConfig({ maxOutputTokens: v });

  /*
   * Rate-limit store — PER PROVIDER, edited in the same settings popup.
   * The store persists to localStorage. Only the CURRENT provider's
   * config is sent to the server on each request (see Chat.client.tsx).
   *
   * NOTE: `currentRateLimit` is computed from `props.provider` (not the
   * later `activeProvider` const) so it can be defined before that const
   * is in scope — they point to the same object.
   */
  const rateLimits = useStore(rateLimitStore);
  const rateLimitProviderName = props.provider?.name ?? '';
  const currentRateLimit: RateLimitConfig = rateLimits[rateLimitProviderName] ??
    SUGGESTED_DEFAULTS[rateLimitProviderName] ?? {
      rpm: 0,
      tpm: 0,
      autoShrinkToTpm: true,
    };

  /*
   * Settings popup state (the new slider button beside the model picker
   * trigger). Combines the old standalone API-key button + the model parameter
   * config (formerly PANEL 2 of the model picker) into one accessible popup.
   */
  const [isSettingsPopupOpen, setIsSettingsPopupOpen] = useState(false);
  const [settingsTempKey, setSettingsTempKey] = useState('');
  const [showSettingsKey, setShowSettingsKey] = useState(false);
  const [isSavingSettingsKey, setIsSavingSettingsKey] = useState(false);

  // Stores the last non-zero value for each field so toggling a rate-limit
  // field back ON restores the previously entered number.
  const [rateLimitLastValues, setRateLimitLastValues] = useState<{
    rpm: number;
    tpm: number;
  }>({ rpm: 60, tpm: 250000 });

  /*
   * Provider currently being keyed (inside the overlay) — when set, an inline
   * API-key entry popup is shown on top of the overlay.
   */
  const [keyEntryFor, setKeyEntryFor] = useState<ProviderInfo | null>(null);

  const containerRef = useRef<HTMLDivElement>(null);
  const chatInputContainerRef = useRef<HTMLDivElement>(null);
  const sendIconRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLElement | null>(null);

  const [workspaceWidth, setWorkspaceWidth] = useState(600);
  const [chatInputWidth, setChatInputWidth] = useState(500);

  const providerSettings = useStore(providersStore);

  // Inject scoped slider + animation styles once
  useEffect(() => {
    if (typeof window === 'undefined') {
      return;
    }

    if (!document.getElementById('chatbox-ui-styles')) {
      const style = document.createElement('style');
      style.id = 'chatbox-ui-styles';
      style.innerHTML = `
        .no-scrollbar::-webkit-scrollbar { display: none !important; }
        .no-scrollbar { -ms-overflow-style: none !important; scrollbar-width: none !important; }

        @keyframes chatbox-slide-up-out {
          from { transform: translateY(0) rotate(-90deg); opacity: 1; }
          to   { transform: translateY(-24px) rotate(-90deg); opacity: 0; }
        }
        @keyframes chatbox-slide-up-in {
          from { transform: translateY(24px) rotate(-90deg); opacity: 0; }
          to   { transform: translateY(0) rotate(-90deg); opacity: 1; }
        }
        .chatbox-slide-out { animation: chatbox-slide-up-out 0.3s forwards !important; }
        .chatbox-slide-in  { animation: chatbox-slide-up-in  0.3s forwards !important; }

        /* Range slider with filled indicator on the left side of the thumb.
           Uses --chatbox-range-pct (0-100) set inline by the component to
           drive a hard colour stop at the thumb position. */
        input[type="range"].chatbox-range {
          -webkit-appearance: none;
          appearance: none;
          width: 100%;
          height: 6px;
          border-radius: 9999px;
          outline: none;
          background: linear-gradient(
            to right,
            var(--chatbox-range-fill, var(--accent-500, #FF2056)) 0%,
            var(--chatbox-range-fill, var(--accent-500, #FF2056)) var(--chatbox-range-pct, 0%),
            var(--chatbox-range-track, color-mix(in srgb, var(--amplify-elements-textTertiary, #888), transparent 70%)) var(--chatbox-range-pct, 0%),
            var(--chatbox-range-track, color-mix(in srgb, var(--amplify-elements-textTertiary, #888), transparent 70%)) 100%
          );
        }
        input[type="range"].chatbox-range::-webkit-slider-thumb {
          -webkit-appearance: none;
          appearance: none;
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent-500, #FF2056);
          cursor: pointer;
          border: 2px solid var(--background, #ffffff);
          box-shadow: 0 0 0 1px color-mix(in srgb, var(--accent-500, #FF2056), transparent 60%);
          transition: transform 0.1s ease, background-color 0.1s ease;
        }
        input[type="range"].chatbox-range::-webkit-slider-thumb:hover {
          transform: scale(1.2);
          background: var(--accent-400, #FF5A7E);
        }
        input[type="range"].chatbox-range::-moz-range-thumb {
          width: 14px;
          height: 14px;
          border-radius: 50%;
          background: var(--accent-500, #FF2056);
          cursor: pointer;
          border: 2px solid var(--background, #ffffff);
        }
        input[type="range"].chatbox-range::-moz-range-progress {
          background-color: var(--accent-500, #FF2056);
          height: 6px;
          border-radius: 9999px;
        }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Observe workspace + chat input widths to drive compact-mode logic.
  useEffect(() => {
    if (!chatInputContainerRef.current) {
      return;
    }

    // Walk up to find a sizable ancestor (the chat panel).
    let node: HTMLElement | null = chatInputContainerRef.current;
    let wsParent: HTMLElement | null = null;

    for (let i = 0; i < 6 && node; i++) {
      node = node.parentElement;

      if (node && node.clientWidth > 100) {
        wsParent = node;
        break;
      }
    }

    if (!wsParent) {
      wsParent = chatInputContainerRef.current;
    }

    (workspaceRef as React.MutableRefObject<HTMLElement | null>).current = wsParent;

    const wsObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setWorkspaceWidth(entry.contentRect.width);
      }
    });
    wsObserver.observe(wsParent);

    const inputObserver = new ResizeObserver((entries) => {
      for (const entry of entries) {
        setChatInputWidth(entry.contentRect.width);
      }
    });
    inputObserver.observe(chatInputContainerRef.current);

    return () => {
      wsObserver.disconnect();
      inputObserver.disconnect();
    };
  }, []);

  const isCompact = useMemo(() => workspaceWidth < 580, [workspaceWidth]);
  const isTriggerCompact = useMemo(() => chatInputWidth < 460, [chatInputWidth]);

  const activeModel: ModelInfo | undefined = useMemo(
    () => props.modelList.find((m) => m.name === props.model),
    [props.modelList, props.model],
  );

  const activeProvider: ProviderInfo | undefined = props.provider;

  /*
   * Per-model config restore / save.
   *
   * When the user switches models:
   *   1. The PREVIOUS model's current settings are snapshotted into the
   *      perModel map (so switching back restores them).
   *   2. If the NEW model has saved settings, they're restored.
   *   3. Otherwise, sensible defaults are applied based on the new model's
   *      `thinkingControlState`.
   *
   * This effect runs on `activeModel` / `activeProvider` change. We track
   * the previous (provider, model) in a ref so we know which entry to
   * snapshot into perModel before switching.
   */
  const previousModelKey = useRef<string | null>(null);

  useEffect(() => {
    if (!activeModel || !activeProvider) {
      return;
    }

    const newKey = `${activeProvider.name}:${activeModel.name}`;
    const prevKey = previousModelKey.current;

    // 1. Snapshot the previous model's settings (if any).
    if (prevKey && prevKey !== newKey) {
      const [prevProvider, prevModel] = prevKey.split(':');
      saveForModel(prevProvider, prevModel);
    }

    // 2. Restore saved settings for the new model, or apply defaults.
    const restored = restoreForModel(activeProvider.name, activeModel.name);

    if (!restored) {
      const ctrl = getThinkingControlState(activeProvider.name, activeModel);

      if (ctrl === 'toggle+budget') {
        updateModelConfig({ thinkingEnabled: true, budgetTokens: 4096, effort: 'medium' });
      } else if (ctrl === 'effort-only') {
        updateModelConfig({ effort: 'medium' });
      } else if (ctrl === 'toggle-only') {
        updateModelConfig({ thinkingEnabled: true });
      }

      if (activeModel.maxCompletionTokens) {
        updateModelConfig({ maxOutputTokens: Math.min(activeModel.maxCompletionTokens, 16384) });
      }
    }

    previousModelKey.current = newKey;
  }, [activeModel, activeProvider]);

  // Close popups on outside click / Escape
  useEffect(() => {
    if (!isOpen && !isSettingsPopupOpen) {
      return;
    }

    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setIsProviderOverlayOpen(false);
        setMobileActiveTab('list');
        setIsSettingsPopupOpen(false);
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setIsProviderOverlayOpen(false);
        setMobileActiveTab('list');
        setIsSettingsPopupOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);

    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen, isSettingsPopupOpen]);

  // Is a given provider enabled? (local providers default to enabled)
  const isEnabled = (name: string): boolean => {
    return providerSettings[name]?.settings?.enabled ?? !LOCAL_PROVIDERS.includes(name);
  };

  // Does this provider have an API key set?
  const hasKey = (name: string): boolean => {
    if (LOCAL_PROVIDERS.includes(name)) {
      return true;
    }

    return !!props.apiKeys[name];
  };

  /*
   * Full list of every provider the project supports — used for the provider
   * overlay (which lists ALL providers so users can toggle each on/off).
   * We deliberately don't rely on `props.providerList` here because the
   * parent (BaseChat ← useSettings) filters that list to ENABLED providers
   * only, which would mean disabled providers disappear from the overlay
   * and the user could never re-enable them.
   */
  const allProviders: ProviderInfo[] = useMemo(() => PROVIDER_LIST as ProviderInfo[], []);

  /*
   * Filtered + grouped models — models from ENABLED providers only.
   * Disabling a provider hides its models from the model list (PANEL 1),
   * but the provider itself stays visible in the provider overlay so the
   * user can re-enable it.
   */
  const filteredProviders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    // Group models by provider, filtering to ENABLED providers only.
    const groups: Record<string, ModelInfo[]> = {};
    props.modelList.forEach((m) => {
      // Skip models from disabled providers.
      if (isEnabled(m.provider) === false) {
        return;
      }

      // Search filter — match on label, name, or provider name.
      if (q) {
        const haystack = `${m.label} ${m.name} ${m.provider}`.toLowerCase();

        if (!haystack.includes(q)) {
          return;
        }
      }

      if (!groups[m.provider]) {
        groups[m.provider] = [];
      }

      groups[m.provider].push(m);
    });

    // Also include empty-but-enabled providers so the user can see them.
    allProviders.forEach((p) => {
      if (isEnabled(p.name) === false) {
        return;
      }

      if (!groups[p.name]) {
        groups[p.name] = [];
      }
    });

    /*
     * Convert to an array of { provider, models } pairs, preserving
     * allProviders order. When searching, only include providers that
     * either match the query directly or have at least one matching model.
     */
    return allProviders
      .filter((p) => {
        if (isEnabled(p.name) === false) {
          return false;
        }

        if (!q) {
          return true;
        }

        const nameMatches = p.name.toLowerCase().includes(q);
        const hasMatchingModels = (groups[p.name]?.length ?? 0) > 0;

        return nameMatches || hasMatchingModels;
      })
      .map((p) => ({
        provider: p,
        models: groups[p.name] ?? [],
      }));
  }, [props.modelList, allProviders, providerSettings, searchQuery]);

  const isKeyMissing = useMemo(() => {
    if (!props.provider?.name || LOCAL_PROVIDERS.includes(props.provider.name)) {
      return false;
    }

    return !props.apiKeys[props.provider.name];
  }, [props.provider, props.apiKeys]);

  const showKeyButton = useMemo(
    () => props.provider?.name && !LOCAL_PROVIDERS.includes(props.provider.name),
    [props.provider],
  );

  // Show the attachment button only for multimodal (image-capable) models.
  const showAttachmentButton = useMemo(() => {
    return isMultimodalModel(activeProvider?.name, activeModel);
  }, [activeProvider, activeModel]);

  /*
   * Sync the temporary API-key field whenever the settings popup opens or the
   * active provider changes, so it always reflects the currently stored key.
   */
  useEffect(() => {
    if (isSettingsPopupOpen && props.provider?.name) {
      setSettingsTempKey(props.apiKeys[props.provider.name] || '');
      setShowSettingsKey(false);
    }
  }, [isSettingsPopupOpen, props.provider, props.apiKeys]);

  /*
   * Save the API key entered in the settings popup. Persists to localStorage
   * AND the apiKeys cookie (server endpoints read the cookie, not localStorage).
   */
  const handleSaveSettingsKey = async () => {
    if (!props.provider?.name) {
      return;
    }

    const key = settingsTempKey.trim();

    if (!key) {
      return;
    }

    setIsSavingSettingsKey(true);

    try {
      props.onApiKeysChange(props.provider.name, key);

      const stored = localStorage.getItem('apiKeys');
      const current: Record<string, string> = stored ? JSON.parse(stored) : {};
      const updated = { ...current, [props.provider.name]: key };
      localStorage.setItem('apiKeys', JSON.stringify(updated));
      Cookies.set('apiKeys', JSON.stringify(updated), { expires: 365, sameSite: 'lax' });
    } catch (e) {
      console.error('Failed to save API key from settings popup:', e);
    } finally {
      setIsSavingSettingsKey(false);
    }
  };

  const thinkingControlState = useMemo<
    'toggle+budget' | 'toggle+effort' | 'effort-only' | 'toggle-only' | 'on-and-locked' | 'off-and-locked'
  >(() => {
    if (!activeModel || !activeProvider) {
      return 'off-and-locked';
    }

    return getThinkingControlState(activeProvider.name, activeModel);
  }, [activeModel, activeProvider]);

  /*
   * Slider max + help text for the budget-token control. Different models
   * support very different budget ranges:
   *   - Gemini 2.5 Flash: max 24576 thinking tokens
   *   - Gemini 2.5 Pro:   max 32768 thinking tokens
   *   - Claude 3.7 Sonnet: max 64000 (but < maxTokens)
   *   - Claude Opus 4 / Sonnet 4: up to 64000
   */
  const budgetSliderMax = useMemo(() => {
    if (!activeModel || !activeProvider) {
      return 32768;
    }

    const name = (activeModel.name || '').toLowerCase();

    if (activeProvider.name === 'Google' && name.includes('pro')) {
      return 32768;
    }

    if (activeProvider.name === 'Google' && name.includes('flash')) {
      return 24576;
    }

    if (activeProvider.name === 'Anthropic') {
      // Claude allows up to 64k thinking tokens, but must be < maxTokens.
      const cap = activeModel.maxCompletionTokens || 64000;

      return Math.min(64000, cap - 1024);
    }

    return 32768;
  }, [activeModel, activeProvider]);

  const budgetHelpText = useMemo(() => {
    if (!activeModel || !activeProvider) {
      return '';
    }

    const name = (activeModel.name || '').toLowerCase();

    if (activeProvider.name === 'Google') {
      return 'Gemini 2.5 — thinkingBudget sets the max thinking tokens. includeThoughts is auto-enabled so thought summaries are streamed back.';
    }

    if (activeProvider.name === 'Anthropic' && /claude-opus-4-[6-9]|claude-sonnet-4-[6-9]/.test(name)) {
      // Should not appear (4.6+ uses adaptive) — but kept as a safety net.
      return 'Claude 4.6+ uses adaptive thinking — budget_tokens is deprecated and ignored.';
    }

    if (activeProvider.name === 'Anthropic') {
      return 'Claude — budgetTokens must be ≥ 1024 and < maxTokens. The model dynamically decides how much to actually use.';
    }

    return '';
  }, [activeModel, activeProvider]);

  // Handle send: trigger the slide-out animation, then send.
  const handleSend = () => {
    if (!props.input.trim() || props.isStreaming || isKeyMissing) {
      return;
    }

    if (sendIconRef.current) {
      sendIconRef.current.classList.add('chatbox-slide-out');
      setTimeout(() => {
        if (sendIconRef.current) {
          sendIconRef.current.classList.remove('chatbox-slide-out');
          sendIconRef.current.classList.add('chatbox-slide-in');
        }

        setTimeout(() => {
          if (sendIconRef.current) {
            sendIconRef.current.classList.remove('chatbox-slide-in');
          }
        }, 300);
      }, 300);
    }

    props.handleSendMessage?.({} as any);
  };

  /*
   * Toggle a provider on/off (called from the overlay's toggle).
   * Does NOT remove the provider from the list — just flips its enabled state.
   * When enabling a non-local provider with no key, opens the inline key popup.
   */
  const handleProviderToggle = (p: ProviderInfo) => {
    const currentlyEnabled = isEnabled(p.name);
    const nextEnabled = !currentlyEnabled;

    updateProviderSettings(p.name, { enabled: nextEnabled } as any);

    if (nextEnabled && !LOCAL_PROVIDERS.includes(p.name) && !hasKey(p.name)) {
      // Need a key — open the inline key entry popup on top of the overlay.
      setKeyEntryFor(p);
    } else if (nextEnabled && (LOCAL_PROVIDERS.includes(p.name) || hasKey(p.name))) {
      // Just became enabled and has a key (or is local) — pick it as active.
      props.setProvider?.(p);
    }
  };

  /*
   * Save an API key for the keyEntryFor provider.
   * Validates via /api/test-provider before persisting.
   */
  const handleSaveKey = async (key: string): Promise<{ ok: boolean; error?: string }> => {
    if (!keyEntryFor) {
      return { ok: false, error: 'No provider selected' };
    }

    if (!key.trim()) {
      return { ok: false, error: 'API key is required' };
    }

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
      props.onApiKeysChange(keyEntryFor.name, key);

      // Activate this provider now that it has a key.
      props.setProvider?.(keyEntryFor);

      // Close the popup.
      setKeyEntryFor(null);

      return { ok: true };
    } catch (err: any) {
      return { ok: false, error: err?.message || 'Network error during validation' };
    }
  };

  return (
    <div className="relative w-full max-w-chat mx-auto z-prompt">
      {props.selectedElement && (
        <div className="flex mx-1.5 gap-2 items-center justify-between rounded-lg rounded-b-none border border-b-none border-amplify-elements-borderColor text-amplify-elements-textPrimary flex py-1 px-2.5 font-medium text-xs">
          <div className="flex gap-2 items-center lowercase">
            <code className="bg-accent-500 rounded-4px px-1.5 py-1 mr-0.5 text-accent-foreground">
              {props?.selectedElement?.tagName}
            </code>
            selected for inspection
          </div>
          <button
            className="bg-transparent text-accent-500 pointer-auto"
            onClick={() => props.setSelectedElement?.(null)}
          >
            Clear
          </button>
        </div>
      )}

      <div className="relative" ref={containerRef}>
        {/* Attachment Previews */}
        <AnimatePresence initial={false}>
          {props.uploadedFiles.length > 0 && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              transition={{ duration: 0.25, ease: [0.16, 1, 0.3, 1] }}
              className="overflow-hidden"
            >
              <div className="flex flex-wrap gap-2.5 p-3.5 border border-b-0 border-amplify-elements-borderColor bg-amplify-elements-background-depth-2 rounded-t-[20px]">
                {props.uploadedFiles.map((file, index) => (
                  <motion.div
                    key={index}
                    layout
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className="group relative flex items-center gap-2 p-1.5 bg-amplify-elements-background-depth-3 border border-amplify-elements-borderColor rounded-xl text-xs shadow-sm pr-7 transition-all hover:border-amplify-elements-borderColorActive"
                  >
                    {file.type.startsWith('image/') ? (
                      <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-amplify-elements-background-depth-3">
                        <img src={props.imageDataList[index]} alt="preview" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="p-2 bg-amplify-elements-background-depth-3 text-amplify-elements-textPrimary rounded-lg">
                        <FileText className="w-4 h-4" />
                      </div>
                    )}
                    <div className="truncate">
                      <p className="font-medium text-amplify-elements-textPrimary truncate max-w-[120px]">
                        {file.name}
                      </p>
                      <p className="text-[10px] text-amplify-elements-textSecondary">
                        {(file.size / 1024).toFixed(1)} KB
                      </p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        props.setUploadedFiles?.(props.uploadedFiles.filter((_, i) => i !== index));
                        props.setImageDataList?.(props.imageDataList.filter((_, i) => i !== index));
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-amplify-elements-textSecondary hover:text-destructive hover:bg-destructive/10 cursor-pointer bg-transparent"
                    >
                      <X className="w-3.5 h-3.5" />
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Dual popup — anchored above the input bar */}
        <div className="absolute bottom-full mb-3 left-1/2 -translate-x-1/2 z-30 flex items-end gap-3 pointer-events-none w-full justify-center">
          <AnimatePresence>
            {isOpen && (
              <motion.div
                key="popup-main-selector"
                initial={{ opacity: 0, scale: 0.95, y: 8, filter: 'blur(2px)' }}
                animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
                exit={{ opacity: 0, scale: 0.95, y: 8, filter: 'blur(2px)' }}
                transition={{ type: 'spring', bounce: 0.1, duration: 0.3 }}
                className={`pointer-events-auto flex bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor rounded-2xl shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)] overflow-hidden h-[380px] transition-all duration-300 ${
                  isCompact ? 'w-[280px]' : 'w-[320px]'
                }`}
              >
                {/* PANEL 1: Model list */}
                {(!isCompact || mobileActiveTab === 'list') && (
                  <motion.div
                    key="panel-model-list"
                    initial={isCompact ? { x: -50, opacity: 0 } : undefined}
                    animate={{ x: 0, opacity: 1 }}
                    exit={isCompact ? { x: -50, opacity: 0 } : undefined}
                    transition={{ duration: 0.2 }}
                    className="w-full flex-grow flex flex-col justify-between h-full bg-amplify-elements-background-depth-1 relative"
                    style={{ minWidth: isCompact ? '280px' : '320px', maxWidth: isCompact ? '280px' : '320px' }}
                  >
                    {/* Search + Add Provider */}
                    <div className="p-3 border-b border-amplify-elements-borderColor flex items-center gap-1.5 relative">
                      <div className="relative flex-grow">
                        <IconifyIcon
                          icon="lucide:search"
                          className="absolute left-2.5 top-2.5 text-amplify-elements-textSecondary"
                          width="12"
                          height="12"
                        />
                        <input
                          type="text"
                          placeholder="Search models..."
                          value={searchQuery}
                          onChange={(e) => setSearchQuery(e.target.value)}
                          className="w-full bg-amplify-elements-background-depth-3 text-amplify-elements-textPrimary text-xs pl-8 pr-7 py-1.5 h-8 rounded-lg outline-none border border-transparent focus:border-amplify-elements-borderColorActive transition placeholder:text-amplify-elements-textSecondary"
                          autoFocus
                        />
                        {searchQuery && (
                          <button
                            onClick={() => setSearchQuery('')}
                            className="absolute right-2 top-2 bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary"
                          >
                            <IconifyIcon icon="lucide:x" width="12" height="12" />
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => setIsProviderOverlayOpen(!isProviderOverlayOpen)}
                        className={`flex items-center justify-center w-8 h-8 rounded-lg border transition-all flex-shrink-0 ${
                          isProviderOverlayOpen
                            ? 'bg-accent-500/20 text-accent-500 border-accent-500/40'
                            : 'bg-amplify-elements-background-depth-3 text-amplify-elements-textPrimary border-transparent hover:bg-amplify-elements-item-backgroundActive'
                        }`}
                        title="Manage providers"
                      >
                        <IconifyIcon icon="lucide:plus" width="14" height="14" />
                      </button>
                    </div>

                    {/* Scrollable model list grouped by provider */}
                    <div className="flex-grow overflow-y-auto p-2 space-y-3 no-scrollbar">
                      {props.isModelLoading === 'all' ? (
                        <div className="flex flex-col items-center justify-center py-8 text-amplify-elements-textTertiary">
                          <IconifyIcon icon="lucide:loader-circle" className="text-lg mb-1 animate-spin" />
                          <span className="text-[10px]">Loading models...</span>
                        </div>
                      ) : filteredProviders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center text-amplify-elements-textTertiary">
                          <IconifyIcon icon="lucide:alert-circle" className="text-lg mb-1" />
                          <span className="text-[10px]">No matching models</span>
                        </div>
                      ) : (
                        filteredProviders.map(({ provider: prov, models }) => (
                          <div key={prov.name} className="space-y-1">
                            <div className="text-[9px] text-amplify-elements-textSecondary font-bold uppercase tracking-wider px-2 flex items-center gap-1.5 py-0.5">
                              <ProviderIcon name={prov.name} className="text-[15px]" />
                              <span>{prov.name}</span>
                            </div>
                            <div className="space-y-0.5">
                              {models.length === 0 && (
                                <div className="px-2.5 py-1.5 text-[10px] text-amplify-elements-textTertiary italic">
                                  No models loaded
                                </div>
                              )}
                              {models.map((model) => {
                                const isSelected = props.model === model.name;
                                return (
                                  <div
                                    key={model.name}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors group ${
                                      isSelected
                                        ? 'bg-amplify-elements-item-backgroundActive'
                                        : 'hover:bg-amplify-elements-item-backgroundActive'
                                    }`}
                                  >
                                    <button
                                      onClick={() => {
                                        props.setProvider?.(prov);
                                        props.setModel?.(model.name);
                                        setIsOpen(false);
                                      }}
                                      className="flex-grow flex items-center gap-2 text-left min-w-0 bg-transparent"
                                    >
                                      <div
                                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                          isSelected
                                            ? 'bg-accent-500'
                                            : 'bg-transparent group-hover:bg-amplify-elements-textTertiary'
                                        }`}
                                      />
                                      <div className="min-w-0">
                                        <div className="text-xs font-semibold text-amplify-elements-textPrimary truncate leading-snug">
                                          {stripContextSuffix(model.label) || model.name}
                                        </div>
                                        <div className="text-[9px] text-amplify-elements-textSecondary flex gap-1.5 items-center leading-normal">
                                          <span className="truncate">
                                            {(model.maxTokenAllowed || 0).toLocaleString()} context
                                          </span>
                                          {isModelReasoning(prov.name, model) && (
                                            <>
                                              <span>·</span>
                                              <span className="text-accent-500 font-semibold flex items-center gap-0.5">
                                                Reasoning
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>

                    {/* PROVIDER OVERLAY — Overlays the list under search/plus header.
                        Lists EVERY provider with an enable/disable toggle. The toggle
                        does NOT remove the provider — it just flips its enabled state
                        so the user can re-enable it later. */}
                    <AnimatePresence>
                      {isProviderOverlayOpen && (
                        <motion.div
                          initial={{ opacity: 0, y: -8 }}
                          animate={{ opacity: 1, y: 0 }}
                          exit={{ opacity: 0, y: -8 }}
                          transition={{ duration: 0.15, ease: 'easeOut' }}
                          className="absolute top-[53px] inset-x-0 bottom-0 bg-amplify-elements-background-depth-2 z-20 flex flex-col p-3 border-t border-amplify-elements-borderColor"
                        >
                          <div className="flex items-center justify-between mb-3 border-b border-amplify-elements-borderColor pb-2">
                            <span className="text-[10px] text-amplify-elements-textSecondary font-bold uppercase tracking-wider">
                              All Providers
                            </span>
                            <button
                              onClick={() => setIsProviderOverlayOpen(false)}
                              className="bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition p-1 rounded-md hover:bg-amplify-elements-item-backgroundActive"
                            >
                              <IconifyIcon icon="lucide:x" width="12" height="12" />
                            </button>
                          </div>

                          <div className="flex-grow overflow-y-auto space-y-2 no-scrollbar">
                            {allProviders.map((prov) => {
                              const enabled = isEnabled(prov.name);
                              const keyed = hasKey(prov.name);
                              const isActive = props.provider?.name === prov.name;
                              const isLocal = LOCAL_PROVIDERS.includes(prov.name);

                              return (
                                <div
                                  key={prov.name}
                                  className={`p-2.5 rounded-xl border transition flex items-center justify-between ${
                                    isActive
                                      ? 'border-accent-500/40 bg-accent-500/5'
                                      : 'border-amplify-elements-borderColor bg-amplify-elements-background-depth-3 hover:bg-amplify-elements-item-backgroundActive'
                                  }`}
                                >
                                  <div className="flex items-center gap-2.5 min-w-0">
                                    <div className="w-10 h-10 rounded-lg bg-amplify-elements-background-depth-3 flex items-center justify-center flex-shrink-0">
                                      <ProviderIcon
                                        name={prov.name}
                                        className="text-xl text-amplify-elements-textPrimary"
                                      />
                                    </div>
                                    <div className="min-w-0">
                                      <span className="text-[11px] font-bold text-amplify-elements-textPrimary block leading-tight truncate">
                                        {prov.name}
                                      </span>
                                      <span className="text-[9px] text-amplify-elements-textSecondary flex items-center gap-1">
                                        {isLocal ? (
                                          <span className="text-amplify-elements-icon-success">local</span>
                                        ) : keyed ? (
                                          <span className="text-amplify-elements-icon-success flex items-center gap-0.5">
                                            <CheckCircle2 size={9} /> key set
                                          </span>
                                        ) : enabled ? (
                                          <span className="text-destructive flex items-center gap-0.5">
                                            <AlertCircle size={9} /> no key
                                          </span>
                                        ) : (
                                          <span>disabled</span>
                                        )}
                                      </span>
                                    </div>
                                  </div>

                                  <div className="flex items-center gap-2 flex-shrink-0">
                                    {/* Get-key link for non-local unkeyed providers */}
                                    {prov.getApiKeyLink && !keyed && !isLocal && (
                                      <a
                                        href={prov.getApiKeyLink}
                                        target="_blank"
                                        rel="noopener noreferrer"
                                        onClick={(e) => e.stopPropagation()}
                                        className="bg-transparent text-amplify-elements-textSecondary hover:text-accent-500 transition p-1"
                                        title={prov.labelForGetApiKey || 'Get API key'}
                                      >
                                        <ExternalLink size={12} />
                                      </a>
                                    )}

                                    {/* Enable/disable toggle.
                                        When enabling a non-local provider without a key,
                                        the inline key popup opens automatically. */}
                                    <div title={enabled ? 'Disable' : 'Enable'}>
                                      <Switch
                                        checked={enabled}
                                        onCheckedChange={(v) => {
                                          if (v !== enabled) {
                                            handleProviderToggle(prov);
                                          }
                                        }}
                                      />
                                    </div>
                                  </div>
                                </div>
                              );
                            })}
                          </div>

                          {/* Inline API key popup (overlay on top of the overlay) */}
                          <AnimatePresence>
                            {keyEntryFor && (
                              <ApiKeyInlinePopup
                                provider={keyEntryFor}
                                onClose={() => setKeyEntryFor(null)}
                                onSave={handleSaveKey}
                              />
                            )}
                          </AnimatePresence>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </motion.div>
                )}

                {/* PANEL 2: Parameters — moved to the settings popup beside the
                    model picker trigger. The condition below is now always false
                    (mobileActiveTab is never 'config' since the per-model slider
                    trigger was removed), so this panel no longer renders. */}
                {isCompact && mobileActiveTab === 'config' && (
                  <motion.div
                    key="panel-config"
                    initial={isCompact ? { x: 50, opacity: 0 } : undefined}
                    animate={{ x: 0, opacity: 1 }}
                    exit={isCompact ? { x: 50, opacity: 0 } : undefined}
                    transition={{ duration: 0.2 }}
                    className="w-full p-4 flex flex-col justify-between h-full bg-amplify-elements-background-depth-2"
                    style={{ minWidth: isCompact ? '280px' : '280px', maxWidth: isCompact ? '280px' : '280px' }}
                  >
                    {/* Back nav for compact mode */}
                    <div className="space-y-1 flex-shrink-0">
                      {isCompact && (
                        <button
                          onClick={() => setMobileActiveTab('list')}
                          className="flex items-center gap-1 text-[10px] text-accent-500 hover:text-accent-400 font-bold uppercase tracking-wider mb-2"
                        >
                          <IconifyIcon icon="lucide:arrow-left" width="12" height="12" />
                          <span>Back to Models</span>
                        </button>
                      )}
                    </div>

                    {/* Parameter controls — faithfully match the curated design's 5 states */}
                    <div className="flex-grow flex flex-col justify-center space-y-4 py-3 overflow-y-auto no-scrollbar">
                      {/* 1. EFFORT-BASED REASONING (OpenAI o1, Grok 4) */}
                      {thinkingControlState === 'effort-only' && (
                        <div className="space-y-4">
                          <span className="text-[10px] text-amplify-elements-textSecondary uppercase tracking-wider block font-bold">
                            Reasoning Effort
                          </span>
                          <div className="bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor p-0.5 rounded-lg flex items-stretch justify-between h-[34px] relative">
                            {(['low', 'medium', 'high'] as const).map((effort) => (
                              <button
                                key={effort}
                                onClick={() => setThinkingOverride(effort)}
                                className={`flex-1 flex items-center justify-center text-[10px] capitalize font-semibold rounded-md transition-all ${
                                  thinkingOverride === effort
                                    ? 'bg-amplify-elements-item-backgroundActive text-amplify-elements-textPrimary shadow-sm'
                                    : 'bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary'
                                }`}
                              >
                                {effort}
                              </button>
                            ))}
                          </div>
                          <div className="bg-amplify-elements-background-depth-1 p-2.5 rounded-xl border border-amplify-elements-borderColor text-[10px] flex gap-2">
                            <IconifyIcon
                              icon="lucide:info"
                              className="text-accent-500 flex-shrink-0 mt-0.5"
                              width="14"
                              height="14"
                            />
                            <div className="text-amplify-elements-textSecondary leading-normal">
                              Reasoning effort is required for this model. Higher effort = more thorough thinking but
                              slower responses.
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 2. BUDGET TOKEN SLIDERS (Gemini, Claude) */}
                      {thinkingControlState === 'toggle+budget' && (
                        <div className="space-y-3.5">
                          <div className="flex items-center justify-between border-b border-amplify-elements-borderColor pb-2">
                            <span className="text-[10px] text-amplify-elements-textSecondary uppercase tracking-wider font-bold">
                              Enable Thinking
                            </span>
                            <button
                              onClick={() => setThinkingEnabled(!thinkingEnabled)}
                              className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                                thinkingEnabled ? 'bg-accent-500' : 'bg-amplify-elements-background-depth-3'
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded-full bg-accent-foreground transition-transform ${
                                  thinkingEnabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>

                          {thinkingEnabled ? (
                            <div className="space-y-3">
                              <div className="flex justify-between items-center text-[10px]">
                                <span className="text-amplify-elements-textSecondary">Thinking Budget:</span>
                                <span className="font-mono text-accent-500 font-bold">
                                  {budgetTokens.toLocaleString()} tokens
                                </span>
                              </div>
                              <input
                                type="range"
                                className="chatbox-range w-full cursor-pointer"
                                min={1024}
                                max={32768}
                                step={1024}
                                value={budgetTokens}
                                onChange={(e) => setBudgetTokens(Number(e.target.value))}
                                style={{
                                  ['--chatbox-range-pct' as any]: `${((budgetTokens - 1024) / (32768 - 1024)) * 100}%`,
                                }}
                              />
                              <div className="flex justify-between text-[8px] text-amplify-elements-textSecondary font-mono">
                                <span>1,024</span>
                                <span>32,768 max</span>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-amplify-elements-background-depth-1 p-2 text-amplify-elements-textSecondary text-[10px] border border-dashed border-amplify-elements-borderColor rounded-lg text-center">
                              Thinking disabled. Falling back to simple response path.
                            </div>
                          )}
                        </div>
                      )}

                      {/* 3. ALWAYS-ON LOCKED REASONING (DeepSeek Reasoner) */}
                      {thinkingControlState === 'on-and-locked' && (
                        <div className="space-y-3 text-center py-3 bg-accent-500/5 border border-accent-500/10 rounded-xl">
                          <IconifyIcon icon="lucide:shield-alert" className="text-xl text-accent-500" />
                          <span className="text-xs font-bold text-amplify-elements-textPrimary block">
                            Thinking Enforced
                          </span>
                          <p className="text-[10px] text-amplify-elements-textSecondary px-4 leading-normal">
                            This model enforces internal thought pathways. No budget token caps can be configured on
                            this endpoint.
                          </p>
                        </div>
                      )}

                      {/* 4. NON-REASONING CHANNELS (GPT-4o, Claude 3.5 Sonnet) */}
                      {thinkingControlState === 'off-and-locked' && (
                        <div className="py-6 flex flex-col items-center justify-center text-center bg-amplify-elements-background-depth-1 border border-dashed border-amplify-elements-borderColor rounded-xl">
                          <IconifyIcon
                            icon="lucide:alert-circle"
                            className="text-amplify-elements-textSecondary text-xl mb-1"
                          />
                          <span className="text-amplify-elements-textSecondary text-xs font-semibold">
                            Standard Pipeline
                          </span>
                          <p className="text-amplify-elements-textTertiary text-[10px] px-4 mt-0.5 leading-normal">
                            This model accepts standard parameters and does not route inquiries through reasoning token
                            engines.
                          </p>
                        </div>
                      )}

                      {/* 5. DYNAMIC OUTPUT TOKEN CONFIGURATION */}
                      {activeModel?.maxCompletionTokens && (
                        <div className="space-y-2 pt-2 border-t border-amplify-elements-borderColor">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-amplify-elements-textSecondary">Max Output Cap:</span>
                            <span className="font-mono text-amplify-elements-textPrimary">
                              {maxOutputTokens.toLocaleString()} tokens
                            </span>
                          </div>
                          <input
                            type="range"
                            className="chatbox-range w-full cursor-pointer"
                            min={1024}
                            max={activeModel.maxCompletionTokens}
                            step={1024}
                            value={maxOutputTokens}
                            onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
                            style={{
                              ['--chatbox-range-pct' as any]: `${((maxOutputTokens - 1024) / Math.max(1, activeModel.maxCompletionTokens - 1024)) * 100}%`,
                            }}
                          />
                          <div className="flex justify-between text-[8px] text-amplify-elements-textSecondary font-mono">
                            <span>1,024</span>
                            <span>{activeModel.maxCompletionTokens.toLocaleString()} max</span>
                          </div>
                        </div>
                      )}
                    </div>
                  </motion.div>
                )}
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Settings popup — opened by the slider button beside the model picker.
            Combines the API-key entry (formerly the standalone key button) and
            the model parameter config (formerly PANEL 2 of the model picker). */}
        <AnimatePresence>
          {isSettingsPopupOpen && (
            <motion.div
              initial={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(2px)' }}
              animate={{ opacity: 1, scale: 1, y: 0, filter: 'blur(0px)' }}
              exit={{ opacity: 0, scale: 0.96, y: 8, filter: 'blur(2px)' }}
              transition={{ type: 'spring', bounce: 0.1, duration: 0.25 }}
              className="absolute bottom-full mb-3 left-0 z-40 w-[340px] max-w-[calc(100vw-2rem)] bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor rounded-2xl shadow-[0_24px_50px_-12px_rgba(0,0,0,0.4)] flex flex-col h-[380px] overflow-hidden"
            >
              {/* Header */}
              <div className="flex items-center justify-between mb-3 px-4 pt-4 pb-1 flex-shrink-0">
                <div className="flex items-center gap-2 min-w-0">
                  <div className="w-8 h-8 rounded-lg bg-amplify-elements-background-depth-3 flex items-center justify-center flex-shrink-0">
                    <ProviderIcon
                      name={activeProvider ? activeProvider.name : 'Default'}
                      className="text-lg text-amplify-elements-textPrimary"
                    />
                  </div>
                  <div className="min-w-0">
                    <div className="text-xs font-bold text-amplify-elements-textPrimary truncate">
                      {activeProvider?.name || 'Provider'} Settings
                    </div>
                    <div className="text-[9px] text-amplify-elements-textSecondary truncate">
                      {stripContextSuffix(activeModel?.label) || activeModel?.name || 'No model selected'}
                    </div>
                  </div>
                </div>
                <button
                  onClick={() => setIsSettingsPopupOpen(false)}
                  className="bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition p-1 rounded-md hover:bg-amplify-elements-item-backgroundActive flex-shrink-0"
                  title="Close"
                >
                  <IconifyIcon icon="lucide:x" width="14" height="14" />
                </button>
              </div>

              {/* Scrollable container */}
              <div className="flex-grow overflow-y-auto px-4 pb-4 no-scrollbar space-y-3">
                {/* API Key section — only for non-local providers */}
                {showKeyButton && (
                  <div className="mb-3 pb-3 border-b border-amplify-elements-borderColor">
                    <div className="flex items-center justify-between mb-1.5">
                      <span className="text-[10px] uppercase tracking-wider font-bold text-amplify-elements-textSecondary">
                        API Key
                      </span>
                      {isKeyMissing ? (
                        <span className="text-[9px] text-destructive flex items-center gap-0.5">
                          <AlertCircle size={10} /> required
                        </span>
                      ) : (
                        <span className="text-[9px] text-emerald-500 flex items-center gap-0.5">
                          <CheckCircle2 size={10} /> set
                        </span>
                      )}
                    </div>
                    <div className="relative">
                      <input
                        type={showSettingsKey ? 'text' : 'password'}
                        value={settingsTempKey}
                        onChange={(e) => setSettingsTempKey(e.target.value)}
                        placeholder="sk-..."
                        className="w-full pr-9 pl-3 py-2 text-xs rounded-md border border-amplify-elements-borderColor bg-amplify-elements-background-depth-3 text-amplify-elements-textPrimary focus:outline-none focus:ring-2 focus:ring-accent-500/40 transition-all"
                      />
                      <button
                        onClick={() => setShowSettingsKey(!showSettingsKey)}
                        className="absolute right-2 top-1/2 -translate-y-1/2 text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary bg-transparent"
                        title={showSettingsKey ? 'Hide' : 'Show'}
                      >
                        {showSettingsKey ? <EyeOff size={14} /> : <Eye size={14} />}
                      </button>
                    </div>
                    <div className="flex items-center gap-2 mt-2">
                      <button
                        onClick={handleSaveSettingsKey}
                        disabled={!settingsTempKey.trim() || isSavingSettingsKey}
                        className={classNames(
                          'px-3 py-1.5 text-[11px] font-semibold rounded-md transition-all',
                          !settingsTempKey.trim() || isSavingSettingsKey
                            ? 'bg-amplify-elements-borderColor text-amplify-elements-textTertiary cursor-not-allowed'
                            : 'bg-accent-500 text-white hover:bg-accent-600',
                        )}
                      >
                        {isSavingSettingsKey ? 'Saving...' : 'Save Key'}
                      </button>
                      {activeProvider?.getApiKeyLink && (
                        <a
                          href={activeProvider.getApiKeyLink}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-[11px] text-amplify-elements-textSecondary hover:text-accent-500 transition-colors flex items-center gap-1"
                        >
                          Get key <ExternalLink size={11} />
                        </a>
                      )}
                    </div>
                  </div>
                )}

                {/* Model Configuration section — moved here from the model picker's PANEL 2 */}
                <div className="space-y-3">
                  <span className="text-[10px] uppercase tracking-wider font-bold text-amplify-elements-textSecondary block">
                    Model Configuration
                  </span>

                  {/* 1. EFFORT-BASED REASONING (OpenAI o-series, Grok 3/4) */}
                  {thinkingControlState === 'effort-only' && (
                    <div className="space-y-2.5">
                      <span className="text-[10px] text-amplify-elements-textSecondary uppercase tracking-wider block font-bold">
                        Reasoning Effort
                      </span>
                      <div className="bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor p-0.5 rounded-lg flex items-stretch justify-between h-[32px] relative">
                        {(['low', 'medium', 'high'] as const).map((effort) => (
                          <button
                            key={effort}
                            onClick={() => setThinkingOverride(effort)}
                            className={classNames(
                              'flex-1 flex items-center justify-center text-[10px] capitalize font-semibold rounded-md transition-all',
                              thinkingOverride === effort
                                ? 'bg-amplify-elements-item-backgroundActive text-amplify-elements-textPrimary shadow-sm'
                                : 'bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary',
                            )}
                          >
                            {effort}
                          </button>
                        ))}
                      </div>
                    </div>
                  )}

                  {/* 1b. TOGGLE + EFFORT PICKER (Gemini 3.x — uses thinkingLevel) */}
                  {thinkingControlState === 'toggle+effort' && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-amplify-elements-textSecondary uppercase tracking-wider font-bold">
                          Enable Thinking
                        </span>
                        <Switch checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} />
                      </div>
                      {thinkingEnabled ? (
                        <div className="space-y-2">
                          <span className="text-[10px] text-amplify-elements-textSecondary uppercase tracking-wider block font-bold">
                            Thinking Level
                          </span>
                          <div className="bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor p-0.5 rounded-lg flex items-stretch justify-between h-[32px] relative">
                            {(['low', 'medium', 'high'] as const).map((effort) => (
                              <button
                                key={effort}
                                onClick={() => setThinkingOverride(effort)}
                                className={classNames(
                                  'flex-1 flex items-center justify-center text-[10px] capitalize font-semibold rounded-md transition-all',
                                  thinkingOverride === effort
                                    ? 'bg-amplify-elements-item-backgroundActive text-amplify-elements-textPrimary shadow-sm'
                                    : 'bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary',
                                )}
                              >
                                {effort}
                              </button>
                            ))}
                          </div>
                          <div className="bg-amplify-elements-background-depth-1 p-2 rounded-lg border border-amplify-elements-borderColor text-[10px] text-amplify-elements-textSecondary leading-normal">
                            Gemini 3 uses <span className="font-mono">thinkingLevel</span> (minimal/low/medium/high).{' '}
                            <span className="text-accent-500">includeThoughts</span> is auto-enabled so thought summaries
                            are streamed back.
                          </div>
                        </div>
                      ) : (
                        <div className="bg-amplify-elements-background-depth-1 p-2 text-amplify-elements-textSecondary text-[10px] border border-dashed border-amplify-elements-borderColor rounded-lg text-center">
                          Thinking set to MINIMAL (Gemini 3 has no hard off switch — minimal produces ~zero thought
                          tokens).
                        </div>
                      )}
                    </div>
                  )}

                  {/* 2. BUDGET TOKEN TOGGLE + SLIDER (Gemini 2.5+, Claude 3.7/Opus 4/Sonnet 4) */}
                  {thinkingControlState === 'toggle+budget' && (
                    <div className="space-y-2.5">
                      <div className="flex items-center justify-between">
                        <span className="text-[10px] text-amplify-elements-textSecondary uppercase tracking-wider font-bold">
                          Enable Thinking
                        </span>
                        <Switch checked={thinkingEnabled} onCheckedChange={setThinkingEnabled} />
                      </div>
                      {thinkingEnabled ? (
                        <div className="space-y-2">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-amplify-elements-textSecondary">Thinking Budget:</span>
                            <span className="font-mono text-accent-500 font-bold">
                              {budgetTokens.toLocaleString()} tokens
                            </span>
                          </div>
                          <input
                            type="range"
                            className="chatbox-range w-full cursor-pointer"
                            min={1024}
                            max={budgetSliderMax}
                            step={1024}
                            value={budgetTokens}
                            onChange={(e) => setBudgetTokens(Number(e.target.value))}
                            style={{
                              ['--chatbox-range-pct' as any]: `${((budgetTokens - 1024) / Math.max(1, budgetSliderMax - 1024)) * 100}%`,
                            }}
                          />
                          <div className="flex justify-between text-[8px] text-amplify-elements-textSecondary font-mono">
                            <span>1,024</span>
                            <span>{budgetSliderMax.toLocaleString()} max</span>
                          </div>
                          <div className="bg-amplify-elements-background-depth-1 p-2 rounded-lg border border-amplify-elements-borderColor text-[10px] text-amplify-elements-textSecondary leading-normal">
                            {budgetHelpText}
                          </div>
                        </div>
                      ) : (
                        <div className="bg-amplify-elements-background-depth-1 p-2 text-amplify-elements-textSecondary text-[10px] border border-dashed border-amplify-elements-borderColor rounded-lg text-center">
                          Thinking disabled. Model will respond without extended reasoning.
                        </div>
                      )}
                    </div>
                  )}

                  {/* 3. ALWAYS-ON LOCKED REASONING (DeepSeek Reasoner) */}
                  {thinkingControlState === 'on-and-locked' && (
                    <div className="space-y-2 text-center py-2 bg-accent-500/5 border border-accent-500/10 rounded-xl">
                      <IconifyIcon icon="lucide:shield-alert" className="text-lg text-accent-500" />
                      <span className="text-xs font-bold text-amplify-elements-textPrimary block">Thinking Enforced</span>
                      <p className="text-[10px] text-amplify-elements-textSecondary px-3 leading-normal">
                        This model enforces internal thought pathways. No budget token caps can be configured.
                      </p>
                    </div>
                  )}

                  {/* 4. NON-REASONING CHANNELS */}
                  {thinkingControlState === 'off-and-locked' && (
                    <div className="py-4 flex flex-col items-center justify-center text-center bg-amplify-elements-background-depth-1 border border-dashed border-amplify-elements-borderColor rounded-xl">
                      <IconifyIcon
                        icon="lucide:alert-circle"
                        className="text-amplify-elements-textSecondary text-lg mb-1"
                      />
                      <span className="text-amplify-elements-textSecondary text-xs font-semibold">Standard Pipeline</span>
                      <p className="text-amplify-elements-textTertiary text-[10px] px-3 mt-0.5 leading-normal">
                        This model accepts standard parameters and does not route through reasoning token engines.
                      </p>
                    </div>
                  )}

                  {/* 5. DYNAMIC OUTPUT TOKEN CAP */}
                  {activeModel?.maxCompletionTokens && (
                    <div className="space-y-2 pt-2 border-t border-amplify-elements-borderColor">
                      <div className="flex justify-between items-center text-[10px]">
                        <span className="text-amplify-elements-textSecondary">Max Output Cap:</span>
                        <span className="font-mono text-amplify-elements-textPrimary">
                          {maxOutputTokens.toLocaleString()} tokens
                        </span>
                      </div>
                      <input
                        type="range"
                        className="chatbox-range w-full cursor-pointer"
                        min={1024}
                        max={activeModel.maxCompletionTokens}
                        step={1024}
                        value={maxOutputTokens}
                        onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
                        style={{
                          ['--chatbox-range-pct' as any]: `${((maxOutputTokens - 1024) / Math.max(1, activeModel.maxCompletionTokens - 1024)) * 100}%`,
                        }}
                      />
                      <div className="flex justify-between text-[8px] text-amplify-elements-textSecondary font-mono">
                        <span>1,024</span>
                        <span>{activeModel.maxCompletionTokens.toLocaleString()} max</span>
                      </div>
                    </div>
                  )}

                  {/* 6. PROVIDER RATE LIMITS (RPM / TPM) — user-configurable */}
                  <div className="space-y-3 pt-2 border-t border-amplify-elements-borderColor">
                    <div className="flex items-center justify-between">
                      <span className="text-[10px] text-amplify-elements-textSecondary uppercase tracking-wider font-bold">
                        Rate Limits — {rateLimitProviderName || 'Provider'}
                      </span>
                      {SUGGESTED_DEFAULTS[rateLimitProviderName] && (
                        <button
                          onClick={() => resetRateLimit(rateLimitProviderName)}
                          className="text-[9px] text-amplify-elements-textTertiary hover:text-accent-500 transition-colors uppercase tracking-wider font-semibold"
                          title="Reset to suggested defaults for this provider"
                        >
                          Reset
                        </button>
                      )}
                    </div>

                    <div className="bg-amplify-elements-background-depth-1 p-2.5 rounded-lg border border-amplify-elements-borderColor text-[11px] text-amplify-elements-textSecondary leading-relaxed">
                      Enter your provider's actual limits (varies by tier/account — see their docs). The server
                      throttles, auto-shrinks context, or refuses requests to avoid being blocked.
                      <br />
                      <span className="text-amplify-elements-textTertiary">
                        Only enable the limits your provider actually enforces — leave others off.
                      </span>
                    </div>

                    {/* RPM */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          {/* Toggle */}
                          <button
                            role="switch"
                            aria-checked={currentRateLimit.rpm > 0}
                            onClick={() => {
                              if (currentRateLimit.rpm > 0) {
                                setRateLimitLastValues((prev) => ({ ...prev, rpm: currentRateLimit.rpm }));
                                updateRateLimit(rateLimitProviderName, { rpm: 0 });
                              } else {
                                updateRateLimit(rateLimitProviderName, {
                                  rpm: rateLimitLastValues.rpm || (SUGGESTED_DEFAULTS[rateLimitProviderName]?.rpm ?? 60),
                                });
                              }
                            }}
                            className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                              currentRateLimit.rpm > 0 ? 'bg-accent-500' : 'bg-amplify-elements-borderColor'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                currentRateLimit.rpm > 0 ? 'translate-x-3' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <span className="text-[11px] font-medium text-amplify-elements-textPrimary">
                            Requests / min
                          </span>
                          <span className="text-[10px] text-amplify-elements-textTertiary font-mono">(RPM)</span>
                        </div>
                        <span className="font-mono text-[11px] text-amplify-elements-textPrimary">
                          {currentRateLimit.rpm === 0 ? '∞ unlimited' : currentRateLimit.rpm.toLocaleString()}
                        </span>
                      </div>
                      {currentRateLimit.rpm > 0 && (
                        <input
                          type="number"
                          min={1}
                          max={100000}
                          step={1}
                          value={currentRateLimit.rpm}
                          onChange={(e) =>
                            updateRateLimit(rateLimitProviderName, {
                              rpm: Math.max(1, Number(e.target.value) || 1),
                            })
                          }
                          className="w-full bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor rounded-md px-2 py-1.5 text-[11px] font-mono text-amplify-elements-textPrimary outline-none focus:border-accent-500 transition-colors"
                          placeholder="e.g. 60"
                        />
                      )}
                    </div>

                    {/* TPM */}
                    <div className="space-y-1.5">
                      <div className="flex items-center justify-between">
                        <div className="flex items-center gap-2">
                          <button
                            role="switch"
                            aria-checked={currentRateLimit.tpm > 0}
                            onClick={() => {
                              if (currentRateLimit.tpm > 0) {
                                setRateLimitLastValues((prev) => ({ ...prev, tpm: currentRateLimit.tpm }));
                                updateRateLimit(rateLimitProviderName, { tpm: 0 });
                              } else {
                                updateRateLimit(rateLimitProviderName, {
                                  tpm: rateLimitLastValues.tpm || (SUGGESTED_DEFAULTS[rateLimitProviderName]?.tpm ?? 250000),
                                });
                              }
                            }}
                            className={`relative inline-flex h-4 w-7 flex-shrink-0 cursor-pointer rounded-full border-2 border-transparent transition-colors duration-200 focus:outline-none ${
                              currentRateLimit.tpm > 0 ? 'bg-accent-500' : 'bg-amplify-elements-borderColor'
                            }`}
                          >
                            <span
                              className={`pointer-events-none inline-block h-3 w-3 transform rounded-full bg-white shadow ring-0 transition duration-200 ease-in-out ${
                                currentRateLimit.tpm > 0 ? 'translate-x-3' : 'translate-x-0'
                              }`}
                            />
                          </button>
                          <span className="text-[11px] font-medium text-amplify-elements-textPrimary">
                            Tokens / min
                          </span>
                          <span className="text-[10px] text-amplify-elements-textTertiary font-mono">(TPM)</span>
                        </div>
                        <span className="font-mono text-[11px] text-amplify-elements-textPrimary">
                          {currentRateLimit.tpm === 0 ? '∞ unlimited' : currentRateLimit.tpm.toLocaleString()}
                        </span>
                      </div>
                      {currentRateLimit.tpm > 0 && (
                        <>
                          <input
                            type="number"
                            min={1}
                            max={100000000}
                            step={1000}
                            value={currentRateLimit.tpm}
                            onChange={(e) =>
                              updateRateLimit(rateLimitProviderName, {
                                tpm: Math.max(1, Number(e.target.value) || 1),
                              })
                            }
                            className="w-full bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor rounded-md px-2 py-1.5 text-[11px] font-mono text-amplify-elements-textPrimary outline-none focus:border-accent-500 transition-colors"
                            placeholder="e.g. 250000"
                          />
                          <div className="text-[11px] text-amplify-elements-textSecondary leading-relaxed bg-amplify-elements-background-depth-1 px-2.5 py-2 rounded-md border border-amplify-elements-borderColor">
                            <span className="font-semibold text-amplify-elements-textPrimary">⚡ Acts as your effective context window.</span>{' '}
                            Even if the model supports 1M tokens, a provider TPM cap of 250k means any request over 250k tokens will be rejected (429).
                            Setting TPM here tells the server to treat this as the real context limit — auto-shrinking older messages to fit, rather than getting blocked.
                          </div>
                        </>
                      )}
                    </div>
                  </div>
                </div>
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Unified, borderless chat input bar */}
        <div
          ref={chatInputContainerRef}
          className="w-full bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor rounded-2xl shadow-xl p-3 flex flex-col gap-2 transition-all duration-200"
        >
          {/* Textarea */}
          <textarea
            ref={props.textareaRef}
            placeholder="How can Amplify help you today?"
            value={props.input}
            onChange={props.handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();

                if (props.isStreaming) {
                  props.handleStop?.();
                  return;
                }

                if (e.nativeEvent.isComposing) {
                  return;
                }

                handleSend();
              }
            }}
            onPaste={props.handlePaste}
            style={{ minHeight: props.TEXTAREA_MIN_HEIGHT, maxHeight: props.TEXTAREA_MAX_HEIGHT }}
            className="w-full bg-transparent text-sm text-amplify-elements-textPrimary placeholder:text-amplify-elements-textSecondary outline-none border-none py-1 resize-none overflow-y-auto no-scrollbar"
          />

          {/* Bottom action row */}
          <div className="flex items-center justify-between pt-1">
            {/* Left side: attach + model picker trigger + (optional) key button */}
            <div className="flex items-center gap-2">
              {/* File attachment — only shown for multimodal (image-capable) models */}
              {showAttachmentButton && (
                <button
                  onClick={() => props.handleFileUpload()}
                  className="w-8 h-8 rounded-lg bg-amplify-elements-background-depth-3 hover:bg-amplify-elements-item-backgroundActive text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors flex items-center justify-center outline-none"
                  title="Attach files"
                >
                  <IconifyIcon icon="lucide:plus" width="16" height="16" />
                </button>
              )}

              {/* Model picker trigger */}
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 h-8 px-2.5 bg-amplify-elements-background-depth-3 hover:bg-amplify-elements-item-backgroundActive border border-amplify-elements-borderColor rounded-lg shadow-sm transition-all active:scale-[0.98] outline-none select-none text-amplify-elements-textPrimary"
              >
                <ProviderIcon
                  name={activeProvider ? activeProvider.name : 'Default'}
                  className="text-lg flex-shrink-0"
                />
                {!isTriggerCompact && (
                  <>
                    <span className="text-xs font-semibold tracking-tight text-amplify-elements-textPrimary truncate max-w-[160px]">
                      {stripContextSuffix(activeModel?.label) || activeModel?.name || props.model || 'Select model'}
                    </span>
                    <IconifyIcon
                      icon="lucide:chevron-down"
                      className={`text-amplify-elements-textSecondary text-[10px] ml-0.5 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </>
                )}
              </button>

              {/* Settings button — opens the provider/model settings popup
                  (API key + model configuration). Replaces the old standalone
                  API-key button; the key input now lives inside this popup. */}
              <div className="relative">
                <button
                  onClick={() => {
                    setIsOpen(false);
                    setIsProviderOverlayOpen(false);
                    setIsSettingsPopupOpen(!isSettingsPopupOpen);
                  }}
                  className={classNames(
                    'flex items-center justify-center h-8 w-8 rounded-lg border transition-all active:scale-[0.98] outline-none',
                    isSettingsPopupOpen
                      ? 'bg-accent-500/15 text-accent-500 border-accent-500/40'
                      : isKeyMissing && showKeyButton
                        ? 'bg-destructive/10 text-destructive border-transparent hover:bg-destructive/20'
                        : 'bg-amplify-elements-background-depth-3 text-amplify-elements-textSecondary border-transparent hover:bg-amplify-elements-item-backgroundActive hover:text-amplify-elements-textPrimary',
                  )}
                  title="Provider & model settings"
                >
                  <IconifyIcon icon="lucide:sliders-horizontal" width="16" height="16" />
                </button>
              </div>
            </div>

            {/* Right side: context indicator + send button */}
            <div className="flex items-center gap-2">
              <ContextBudgetIndicator maxTokenAllowed={activeModel?.maxTokenAllowed} messages={props.messages} />
              <SummarizationToast messages={props.messages} />

              <button
                onClick={handleSend}
                disabled={!props.input.trim() || props.isStreaming || isKeyMissing}
                className={`flex justify-center items-center w-10 h-10 rounded-full transition-all duration-200 cursor-pointer disabled:cursor-not-allowed overflow-hidden bg-transparent ${
                  !props.input.trim() || props.isStreaming || isKeyMissing
                    ? 'text-amplify-elements-textTertiary hover:bg-transparent'
                    : 'text-accent-500 hover:bg-accent-500/10 hover:text-accent-600'
                }`}
                title="Send Prompt (Enter)"
              >
                {props.isStreaming ? (
                  <IconifyIcon icon="lucide:loader-circle" width="22" height="22" className="animate-spin" />
                ) : (
                  <div
                    ref={sendIconRef}
                    className="flex items-center justify-center"
                    style={{ transform: 'rotate(-90deg)' }}
                  >
                    <IconifyIcon icon="iconoir:send-solid" style={{ fontSize: '22px' }} />
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Subtle accent line under the input */}
        <div className="absolute bottom-0 left-10 right-10 h-[1px] bg-gradient-to-r from-transparent via-accent-500/10 to-transparent blur-[1px]" />
      </div>
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Inline API key popup (used inside the provider overlay)                    */
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
    { kind: 'idle' } | { kind: 'testing' } | { kind: 'success' } | { kind: 'error'; message: string }
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
      className="absolute inset-0 z-[110] flex items-center justify-center p-4 bg-black/60 backdrop-blur-sm"
      onClick={onClose}
    >
      <motion.div
        onClick={(e) => e.stopPropagation()}
        className="relative w-full max-w-sm bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor rounded-2xl shadow-2xl p-5"
      >
        {/* Header */}
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <ProviderIcon name={provider.name} className="text-base text-amplify-elements-textPrimary" />
            <span className="text-sm font-bold text-amplify-elements-textPrimary">{provider.name} API Key</span>
          </div>
          <button
            onClick={onClose}
            className="bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition p-1 rounded-md hover:bg-amplify-elements-item-backgroundActive"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>

        <p className="text-[10px] text-amplify-elements-textSecondary mb-3 leading-relaxed">
          Enabling <span className="text-amplify-elements-textPrimary font-semibold">{provider.name}</span> requires a
          valid API key. We'll verify the key against the provider's models endpoint before saving it locally.
        </p>

        {/* Key input */}
        <div className="relative">
          <input
            type={showKey ? 'text' : 'password'}
            value={tempKey}
            onChange={(e) => {
              setTempKey(e.target.value);

              if (status.kind !== 'idle') {
                setStatus({ kind: 'idle' });
              }
            }}
            placeholder="sk-..."
            autoFocus
            className="w-full bg-amplify-elements-background-depth-3 text-amplify-elements-textPrimary text-xs px-3 py-2.5 h-9 rounded-lg outline-none border border-transparent focus:border-accent-500 transition font-mono pr-9 placeholder:text-amplify-elements-textSecondary"
          />
          <button
            onClick={() => setShowKey(!showKey)}
            className="absolute right-2.5 top-1/2 -translate-y-1/2 bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary"
            title={showKey ? 'Hide' : 'Show'}
          >
            {showKey ? <EyeOff size={12} /> : <Eye size={12} />}
          </button>
        </div>

        {/* Status feedback */}
        {status.kind === 'testing' && (
          <div className="mt-2.5 text-[10px] text-accent-500 flex items-center gap-1.5">
            <Loader2 size={11} className="animate-spin" />
            Validating key against {provider.name}...
          </div>
        )}
        {status.kind === 'success' && (
          <div className="mt-2.5 text-[10px] text-amplify-elements-icon-success flex items-center gap-1.5 bg-amplify-elements-icon-success/10 border border-amplify-elements-icon-success/20 rounded-lg p-2">
            <CheckCircle2 size={11} />
            Key verified and saved to local storage.
          </div>
        )}
        {status.kind === 'error' && (
          <div className="mt-2.5 text-[10px] text-destructive flex items-start gap-1.5 bg-destructive/10 border border-destructive/20 rounded-lg p-2">
            <AlertCircle size={11} className="flex-shrink-0 mt-0.5" />
            <span>{status.message}</span>
          </div>
        )}

        {/* Actions */}
        <div className="flex gap-2 mt-4">
          <button
            onClick={onClose}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-transparent text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary hover:bg-amplify-elements-item-backgroundActive transition"
          >
            Cancel
          </button>
          <button
            onClick={handleSave}
            disabled={status.kind === 'testing' || status.kind === 'success' || !tempKey.trim()}
            className="flex-1 px-3 py-2 rounded-lg text-xs font-medium bg-accent-500 text-accent-foreground hover:bg-accent-400 disabled:opacity-50 disabled:cursor-not-allowed transition flex items-center justify-center gap-1.5"
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
          <div className="mt-3 pt-3 border-t border-amplify-elements-borderColor">
            <a
              href={provider.getApiKeyLink}
              target="_blank"
              rel="noopener noreferrer"
              className="bg-transparent text-[10px] text-accent-500 hover:text-accent-400 transition flex items-center gap-1"
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
 * ProviderIcon — renders a provider's brand logo.
 *
 * ICON SOURCE STRATEGY (VERIFIED):
 * --------------------------------
 * All provider icons are bundled as local SVGs in `/icons/*.svg` and
 * wired into UnoCSS as `i-amplify:<Name>` classes. The SVGs come from
 * three sources, but at runtime there is ONE unified code path —
 * UnoCSS reads the small per-icon SVG files at build time, so there's
 * no CDN dependency, no multi-MB JSON collection to load, and no
 * chance of an icon silently failing to render.
 *
 * 1. Iconify `logos` collection — extracted to local SVGs via
 *    `scripts/extract-iconify-icons.py`. These retain the official
 *    brand colors (multi-color where applicable):
 *      Anthropic, OpenAI, Google (Gemini), DeepSeek, xAI, Mistral,
 *      Perplexity, HuggingFace, Moonshot, GitHub, AWS (for Bedrock)
 *
 * 2. Iconify `simpleIcons` collection — extracted to local SVGs:
 *      Ollama, OpenRouter, LMStudio, Z.ai
 *
 * 3. Direct fetches from provider websites (cropped to icon-only):
 *      Cohere (cohere.com/logo.svg)
 *      Groq (groq.com homepage — lightning bolt extracted)
 *      Together (together.ai homepage nav-logo)
 *      Hyperbolic (hyperbolic.xyz homepage svg-logo)
 *      Cerebras (cerebras.ai homepage)
 *      Fireworks (docs.fireworks.ai/favicon.svg)
 *
 * Files suffixed `-iconify.svg` are from source (1) or (2).
 * Files without the suffix are from source (3) or pre-existing local assets.
 */
const PROVIDER_ICON_CLASS: Record<string, string> = {
  // === From Iconify `logos` collection (extracted to local SVGs) ===
  Anthropic: 'i-amplify:anthropic-iconify',
  OpenAI: 'i-amplify:openai-iconify',
  Google: 'i-vscode-icons:file-type-gemini',
  Deepseek: 'i-amplify:deepseek-iconify',
  xAI: 'i-amplify:xai-iconify',
  Mistral: 'i-amplify:mistral-iconify',
  Perplexity: 'i-amplify:perplexity-iconify',
  HuggingFace: 'i-amplify:huggingface-iconify',
  Moonshot: 'i-amplify:moonshot-iconify',
  Github: 'i-amplify:github-iconify',
  GitHub: 'i-amplify:github-iconify',
  AmazonBedrock: 'i-amplify:amazonbedrock-iconify',

  // === From Iconify `simpleIcons` collection (extracted to local SVGs) ===
  Ollama: 'i-amplify:ollama-iconify',
  OpenRouter: 'i-amplify:openrouter-iconify',
  LMStudio: 'i-amplify:lmstudio-iconify',
  'Z.ai': 'i-amplify:zai-iconify',

  // === Direct fetches from provider websites (cropped to icon-only) ===
  Cohere: 'i-amplify:cohere',
  Groq: 'i-amplify:groq',
  Together: 'i-amplify:together',
  Hyperbolic: 'i-amplify:hyperbolic',
  Cerebras: 'i-amplify:cerebras',
  Fireworks: 'i-amplify:fireworks',

  // === Generic local SVGs ===
  OpenAILike: 'i-amplify:openailike',
};

function providerIconClass(name: string): string {
  return PROVIDER_ICON_CLASS[name] || 'i-amplify:default';
}

/**
 * ProviderIcon — renders the provider logo as a UnoCSS icon (`<i>`-like div).
 *
 * Pass `size` as a Tailwind text-size class (e.g. `text-base`, `text-lg`,
 * `text-xl`) — UnoCSS icon classes use `1em` units, so the SVG scales with
 * the surrounding font-size. This matches how `framework-meta.ts` renders
 * its icons (e.g. `<div className="i-amplify:react text-xl" />`).
 */
const PROVIDER_ASPECT_RATIOS: Record<string, string> = {
  Cohere: '22 / 20',
  Groq: '370 / 562.5',
  Together: '30 / 26',
};

const ProviderIcon = ({ name, className = '' }: { name: string; className?: string }) => {
  const aspectRatio = PROVIDER_ASPECT_RATIOS[name] || '1 / 1';
  return (
    <div
      className={classNames(providerIconClass(name), 'inline-block align-middle', className)}
      style={{
        height: '0.75em',
        width: 'auto',
        aspectRatio,
        maxWidth: '2.5em',
      }}
      role="img"
      aria-label={name}
    />
  );
};

/**
 * Determine the reasoning/thinking control state for a (provider, model) pair.
 *
 * This is a heuristic since the actual provider configs don't expose thinking
 * capability in the static model list — we infer it from provider + model
 * name patterns. Matches the curated design's 6 states:
 *
 *   - 'toggle+budget' : On/off + token budget slider (Gemini 2.5, Claude 3.7/4)
 *   - 'toggle+effort' : On/off + effort picker (Gemini 3.x — uses thinkingLevel)
 *   - 'effort-only'   : Effort picker only (OpenAI o-series, xAI Grok, Mistral Magistral)
 *   - 'toggle-only'   : On/off only (reserved — currently unused)
 *   - 'on-and-locked' : Always reasons, no config (DeepSeek Reasoner)
 *   - 'off-and-locked': No reasoning (default)
 *
 * The state MUST stay in sync with the server-side translator at
 * `app/lib/.server/llm/thinking.ts` (`buildThinkingProviderOptions`) —
 * each state here corresponds to a `providerOptions` shape there.
 */
function getThinkingControlState(
  providerName: string,
  model: ModelInfo,
): 'toggle+budget' | 'toggle+effort' | 'effort-only' | 'toggle-only' | 'on-and-locked' | 'off-and-locked' {
  const name = (model.name || '').toLowerCase();
  const label = (model.label || '').toLowerCase();

  // DeepSeek Reasoner — always reasons, no toggle, no budget.
  if (providerName === 'Deepseek' && (name.includes('reasoner') || label.includes('reasoner'))) {
    return 'on-and-locked';
  }

  // OpenAI o-series + GPT-5 — effort-only (low/medium/high).
  if (
    providerName === 'OpenAI' &&
    (name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4') || name.startsWith('gpt-5'))
  ) {
    return 'effort-only';
  }

  // xAI Grok 3/4 — effort-only.
  if (providerName === 'xAI' && (name.includes('grok-3') || name.includes('grok-4'))) {
    return 'effort-only';
  }

  /*
   * Mistral Magistral — effort-only (high/none per SDK, but we expose low/medium/high
   * and the translator maps low/medium → none/high appropriately).
   */
  if (providerName === 'Mistral' && name.includes('magistral')) {
    return 'effort-only';
  }

  // Google Gemini 3.x — toggle + EFFORT (uses thinkingLevel, not budget).
  if (providerName === 'Google' && /gemini-3[.-]/.test(name)) {
    return 'toggle+effort';
  }

  // Google Gemini 2.5 — toggle + token budget.
  if (providerName === 'Google' && name.includes('gemini-2.5')) {
    return 'toggle+budget';
  }

  // Anthropic Claude 3.7 / Opus 4 / Sonnet 4 — toggle + token budget.
  if (
    providerName === 'Anthropic' &&
    (name.includes('claude-3-7') ||
      name.includes('claude-opus-4') ||
      name.includes('claude-sonnet-4') ||
      name.includes('claude-3.7'))
  ) {
    return 'toggle+budget';
  }

  // DeepSeek Chat (V3) — no thinking.
  if (providerName === 'Deepseek' && name.includes('chat')) {
    return 'off-and-locked';
  }

  // Default — no reasoning.
  return 'off-and-locked';
}

function isModelReasoning(providerName: string, model: ModelInfo): boolean {
  const state = getThinkingControlState(providerName, model);
  return state !== 'off-and-locked';
}

/**
 * Determine whether a (provider, model) pair supports image/multimodal input.
 * Used to decide whether to show the attachment button. Heuristic based on the
 * research in RESEARCH-1: providers whose flagship chat models accept images,
 * with a few text-only refinements.
 */
function isMultimodalModel(providerName: string | undefined, model: ModelInfo | undefined | null): boolean {
  if (!providerName || !model) {
    return false;
  }

  const name = (model.name || '').toLowerCase();

  // Known text-only providers (per RESEARCH-1).
  const textOnlyProviders = ['DeepSeek', 'Cerebras', 'Perplexity', 'Cohere'];

  if (textOnlyProviders.includes(providerName)) {
    return false;
  }

  // Z.ai — only the glm-4v family accepts images.
  if (providerName === 'Z.ai') {
    return /glm-4v/.test(name);
  }

  // Local / custom OpenAI-compatible providers — assume multimodal (user's own model).
  if (['Ollama', 'LMStudio', 'OpenAILike'].includes(providerName)) {
    return true;
  }

  // Providers whose chat models are generally multimodal.
  const multimodalProviders = [
    'Anthropic',
    'OpenAI',
    'Google',
    'Mistral',
    'xAI',
    'Moonshot',
    'Hyperbolic',
    'HuggingFace',
    'OpenRouter',
    'AmazonBedrock',
    'GitHub',
  ];

  if (multimodalProviders.includes(providerName)) {
    // Refined exclusions within multimodal providers.
    if (providerName === 'OpenAI' && /(gpt-3\.5|instruct|whisper|tts|dall-e|embedding|moderation)/.test(name)) {
      return false;
    }

    if (providerName === 'xAI' && !/(grok-2-vision|grok-3|grok-4|grok-beta)/.test(name)) {
      return false;
    }

    if (providerName === 'Mistral' && /(embed|ocr)/.test(name)) {
      return false;
    }

    return true;
  }

  // Providers with specific vision model variants.
  if (providerName === 'Groq' && /vision/.test(name)) {
    return true;
  }

  if (providerName === 'Together' && /vision/.test(name)) {
    return true;
  }

  if (providerName === 'Fireworks' && /vision/.test(name)) {
    return true;
  }

  return false;
}

/**
 * Guess the base URL for a built-in provider so we can validate the API key
 * client-side via /api/test-provider.
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
