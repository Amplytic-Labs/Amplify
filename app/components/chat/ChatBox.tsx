import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Paperclip, X, FileText } from 'lucide-react';
import { ClientOnly } from 'remix-utils/client-only';
import { classNames } from '~/utils/classNames';
import { APIKeyPopup } from './APIKeyPopup';
import { LOCAL_PROVIDERS, providersStore } from '~/lib/stores/settings';
import FilePreview from './FilePreview';
import { ScreenshotStateManager } from './ScreenshotStateManager';
import { IconButton } from '~/components/ui/IconButton';
import { SupabaseConnection } from './SupabaseConnection';
import { ExpoQrModal } from '~/components/workbench/ExpoQrModal';
import styles from './BaseChat.module.scss';
import type { ProviderInfo } from '~/types/model';
import { ColorSchemeDialog } from '~/components/ui/ColorSchemeDialog';
import type { DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import { McpTools } from './MCPTools';
import { WebSearch } from './WebSearch.client';
import { ContextBudgetIndicator } from './ContextBudgetIndicator';
import { SummarizationToast } from './SummarizationToast';
import { ProviderPicker } from './ProviderPicker';
import { customProvidersStore } from '~/lib/stores/custom-providers';
import { useStore } from '@nanostores/react';
import type { ModelInfo } from '~/lib/modules/llm/types';

/**
 * Strip a trailing parenthesised context suffix from a model label.
 *
 * Dynamic model lists from providers like OpenRouter / HuggingFace often
 * come back as `"Gemma 4 31B IT (262k context)"`. The parenthesised part
 * is metadata that clutters the trigger. Stripped from the TRIGGER only —
 * the full label is still shown in the dropdown list.
 */
function stripContextSuffix(label: string | undefined): string {
  if (!label) return '';
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
  isListening: boolean;
  startListening: () => void;
  stopListening: () => void;
  chatStarted: boolean;
  exportChat?: () => void;
  qrModalOpen: boolean;
  setQrModalOpen: (open: boolean) => void;
  handleFileUpload: () => void;
  setProvider?: ((provider: ProviderInfo) => void) | undefined;
  model?: string | undefined;
  setModel?: ((model: string) => void) | undefined;
  setUploadedFiles?: ((files: File[]) => void) | undefined;
  setImageDataList?: ((dataList: string[]) => void) | undefined;
  handleInputChange?: ((event: React.ChangeEvent<HTMLTextAreaElement>) => void) | undefined;
  handleStop?: (() => void) | undefined;
  enhancingPrompt?: boolean | undefined;
  enhancePrompt?: () => void;
  onWebSearchResult?: (result: string) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: ((element: ElementInfo | null) => void) | undefined;
  messages?: any[];
}

/**
 * ChatBox — the chat input bar with integrated model picker, provider picker,
 * and parameter configure panel.
 *
 * The visual design faithfully matches the curated model_environment_console
 * prototype: a borderless dark input bar, a dual-column popup above it
 * (model list + parameter panel), a compact-mode tab switch on narrow
 * viewports, an integrated provider picker, and a rotated send button with
 * a slide-out animation on send.
 *
 * The actual chat area / message list / header are NOT part of this
 * component — those stay in BaseChat.
 */
export const ChatBox: React.FC<ChatBoxProps> = (props) => {
  const [isOpen, setIsOpen] = useState(false);
  const [isProviderPickerOpen, setIsProviderPickerOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [mobileActiveTab, setMobileActiveTab] = useState<'list' | 'config'>('list');

  // Model-specific configurations
  const [thinkingEnabled, setThinkingEnabled] = useState(true);
  const [thinkingOverride, setThinkingOverride] = useState<'low' | 'medium' | 'high' | 'auto' | 'off'>('auto');
  const [budgetTokens, setBudgetTokens] = useState(4096);
  const [maxOutputTokens, setMaxOutputTokens] = useState(4096);

  // API key popup state (for the small inline "key" button next to the trigger)
  const [isApiKeyPopupOpen, setIsApiKeyPopupOpen] = useState(false);

  const containerRef = useRef<HTMLDivElement>(null);
  const chatInputContainerRef = useRef<HTMLDivElement>(null);
  const sendIconRef = useRef<HTMLDivElement>(null);
  const workspaceRef = useRef<HTMLDivElement>(null);

  const [workspaceWidth, setWorkspaceWidth] = useState(600);
  const [chatInputWidth, setChatInputWidth] = useState(500);

  const customProviders = useStore(customProvidersStore);
  const providerSettings = useStore(providersStore);

  // Inject Iconify + slider styles once (mirrors the curated design)
  useEffect(() => {
    if (typeof window === 'undefined') return;

    if (!document.getElementById('iconify-script')) {
      const s = document.createElement('script');
      s.id = 'iconify-script';
      s.src = 'https://code.iconify.design/iconify-icon/2.1.0/iconify-icon.min.js';
      s.async = true;
      document.head.appendChild(s);
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

        input[type="range"].chatbox-range::-webkit-slider-thumb {
          -webkit-appearance: none; appearance: none;
          width: 14px; height: 14px; border-radius: 50%;
          background: #818cf8; cursor: pointer; border: 2px solid #ffffff;
          transition: transform 0.1s ease, background-color 0.1s ease;
        }
        input[type="range"].chatbox-range::-webkit-slider-thumb:hover {
          transform: scale(1.2); background: #a5b4fc;
        }
        input[type="range"].chatbox-range { -webkit-appearance: none; appearance: none; }
      `;
      document.head.appendChild(style);
    }
  }, []);

  // Observe workspace + chat input widths to drive compact-mode logic.
  // We climb up the DOM to find the nearest ancestor that has a non-trivial
  // width — this gives us the "workspace" container width.
  useEffect(() => {
    if (!chatInputContainerRef.current) return;

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
    if (!wsParent) wsParent = chatInputContainerRef.current;
    (workspaceRef as React.MutableRefObject<HTMLElement | null>).current = wsParent;

    const wsObserver = new ResizeObserver((entries) => {
      for (const entry of entries) setWorkspaceWidth(entry.contentRect.width);
    });
    wsObserver.observe(wsParent);

    const inputObserver = new ResizeObserver((entries) => {
      for (const entry of entries) setChatInputWidth(entry.contentRect.width);
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

  // Reset config when model changes (mirror curated design's behaviour)
  useEffect(() => {
    if (!activeModel || !activeProvider) return;
    const ctrl = getThinkingControlState(activeProvider.name, activeModel);

    if (ctrl === 'toggle+budget') {
      setThinkingEnabled(true);
      setBudgetTokens(4096);
      setThinkingOverride('auto');
    } else if (ctrl === 'effort-only') {
      setThinkingOverride('medium');
    } else if (ctrl === 'toggle-only') {
      setThinkingEnabled(true);
    }

    if (activeModel.maxCompletionTokens) {
      setMaxOutputTokens(Math.min(activeModel.maxCompletionTokens, 16384));
    }
  }, [activeModel, activeProvider]);

  // Close popup on outside click / Escape
  useEffect(() => {
    if (!isOpen) return;
    const handleClick = (e: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(e.target as Node)) {
        setIsOpen(false);
        setMobileActiveTab('list');
      }
    };
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        setIsOpen(false);
        setMobileActiveTab('list');
      }
    };
    document.addEventListener('mousedown', handleClick);
    document.addEventListener('keydown', handleKey);
    return () => {
      document.removeEventListener('mousedown', handleClick);
      document.removeEventListener('keydown', handleKey);
    };
  }, [isOpen]);

  // Filtered + grouped models (only enabled providers)
  const filteredProviders = useMemo(() => {
    const q = searchQuery.toLowerCase().trim();

    // Map of provider name -> enabled state (from the settings store).
    const enabledMap: Record<string, boolean> = {};
    Object.keys(providerSettings).forEach((name) => {
      enabledMap[name] = providerSettings[name]?.settings?.enabled ?? !LOCAL_PROVIDERS.includes(name);
    });

    // Group models by provider, filtering to enabled providers only.
    const groups: Record<string, ModelInfo[]> = {};
    props.modelList.forEach((m) => {
      // Skip models from disabled providers.
      if (enabledMap[m.provider] === false) return;

      // Search filter — match on label, name, or provider name.
      if (q) {
        const haystack = `${m.label} ${m.name} ${m.provider}`.toLowerCase();
        if (!haystack.includes(q)) return;
      }

      if (!groups[m.provider]) groups[m.provider] = [];
      groups[m.provider].push(m);
    });

    // Also include empty-but-enabled providers so the user can see them
    // (e.g. local providers with no models loaded yet).
    props.providerList.forEach((p) => {
      if (enabledMap[p.name] === false) return;
      if (!groups[p.name]) groups[p.name] = [];
    });

    // Convert to an array of { provider, models } pairs, preserving
    // providerList order.
    return props.providerList
      .filter((p) => groups[p.name] !== undefined)
      .map((p) => ({
        provider: p,
        models: groups[p.name],
      }));
  }, [props.modelList, props.providerList, providerSettings, searchQuery]);

  const isKeyMissing = useMemo(() => {
    if (!props.provider?.name || LOCAL_PROVIDERS.includes(props.provider.name)) return false;
    return !props.apiKeys[props.provider.name];
  }, [props.provider, props.apiKeys]);

  const showKeyButton = useMemo(
    () => props.provider?.name && !LOCAL_PROVIDERS.includes(props.provider.name),
    [props.provider],
  );

  const thinkingControlState = useMemo<'toggle+budget' | 'effort-only' | 'toggle-only' | 'on-and-locked' | 'off-and-locked'>(() => {
    if (!activeModel || !activeProvider) return 'off-and-locked';
    return getThinkingControlState(activeProvider.name, activeModel);
  }, [activeModel, activeProvider]);

  // Handle send: trigger the slide-out animation, then send.
  const handleSend = () => {
    if (!props.input.trim() || props.isStreaming || isKeyMissing) return;

    if (sendIconRef.current) {
      sendIconRef.current.classList.add('chatbox-slide-out');
      setTimeout(() => {
        if (sendIconRef.current) {
          sendIconRef.current.classList.remove('chatbox-slide-out');
          sendIconRef.current.classList.add('chatbox-slide-in');
        }
        setTimeout(() => {
          if (sendIconRef.current) sendIconRef.current.classList.remove('chatbox-slide-in');
        }, 300);
      }, 300);
    }

    props.handleSendMessage?.({} as any);
  };

  return (
    <div className="relative w-full max-w-chat mx-auto z-prompt">
      {props.selectedElement && (
        <div className="flex mx-1.5 gap-2 items-center justify-between rounded-lg rounded-b-none border border-b-none border-amplify-elements-borderColor text-amplify-elements-textPrimary flex py-1 px-2.5 font-medium text-xs">
          <div className="flex gap-2 items-center lowercase">
            <code className="bg-accent-500 rounded-4px px-1.5 py-1 mr-0.5 text-white">
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
              <div className="flex flex-wrap gap-2.5 p-3.5 border border-b-0 border-zinc-800/80 bg-[#1c1c1e] rounded-t-[20px]">
                {props.uploadedFiles.map((file, index) => (
                  <motion.div
                    key={index}
                    layout
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className="group relative flex items-center gap-2 p-1.5 bg-zinc-900/80 border border-zinc-800/80 rounded-xl text-xs shadow-sm pr-7 transition-all hover:border-zinc-700"
                  >
                    {file.type.startsWith('image/') ? (
                      <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-zinc-800">
                        <img src={props.imageDataList[index]} alt="preview" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="p-2 bg-zinc-800 text-zinc-200 rounded-lg">
                        <FileText className="w-4 h-4" />
                      </div>
                    )}
                    <div className="truncate">
                      <p className="font-medium text-zinc-100 truncate max-w-[120px]">{file.name}</p>
                      <p className="text-[10px] text-zinc-500">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        props.setUploadedFiles?.(props.uploadedFiles.filter((_, i) => i !== index));
                        props.setImageDataList?.(props.imageDataList.filter((_, i) => i !== index));
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-zinc-500 hover:text-rose-400 hover:bg-rose-500/10 cursor-pointer"
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
                className={`pointer-events-auto flex bg-[#1c1c1e] border border-zinc-800/80 rounded-2xl shadow-[0_24px_50px_-12px_rgba(0,0,0,0.8)] overflow-hidden h-[380px] transition-all duration-300 ${
                  isCompact ? 'w-[280px]' : 'w-[540px]'
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
                    className="w-full flex-grow flex flex-col justify-between h-full bg-black/10 relative"
                    style={{ minWidth: isCompact ? '280px' : '260px', maxWidth: isCompact ? '280px' : '260px' }}
                  >
                    {/* Search + Add Provider */}
                    <div className="p-3 border-b border-zinc-800/60 flex items-center gap-1.5 relative">
                      <div className="relative flex-grow">
                        <Icon icon="lucide:search" className="absolute left-2.5 top-2.5 text-zinc-500 text-xs" />
                        <input
                          type="text"
                          placeholder="Search models..."
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
                            <Icon icon="lucide:x" className="text-xs" />
                          </button>
                        )}
                      </div>

                      <button
                        onClick={() => {
                          setIsOpen(false);
                          setIsProviderPickerOpen(true);
                        }}
                        className="flex items-center justify-center w-8 h-8 rounded-lg border transition-all flex-shrink-0 bg-[#2c2c2e]/60 text-zinc-200 border-transparent hover:bg-zinc-800/80"
                        title="Manage providers"
                      >
                        <Icon icon="lucide:plus" className="text-sm font-semibold" />
                      </button>
                    </div>

                    {/* Scrollable model list grouped by provider */}
                    <div className="flex-grow overflow-y-auto p-2 space-y-3 no-scrollbar">
                      {props.isModelLoading === 'all' ? (
                        <div className="flex flex-col items-center justify-center py-8 text-zinc-600">
                          <Icon icon="lucide:loader-circle" className="text-lg mb-1 animate-spin" />
                          <span className="text-[10px]">Loading models...</span>
                        </div>
                      ) : filteredProviders.length === 0 ? (
                        <div className="flex flex-col items-center justify-center py-8 text-center text-zinc-600">
                          <Icon icon="lucide:alert-circle" className="text-lg mb-1" />
                          <span className="text-[10px]">No matching models</span>
                        </div>
                      ) : (
                        filteredProviders.map(({ provider: prov, models }) => (
                          <div key={prov.name} className="space-y-1">
                            <div className="text-[9px] text-zinc-500 font-bold uppercase tracking-wider px-2 flex items-center gap-1.5 py-0.5">
                              <Icon icon={providerIcon(prov.name)} className="text-xs" />
                              <span>{prov.name}</span>
                            </div>
                            <div className="space-y-0.5">
                              {models.length === 0 && (
                                <div className="px-2.5 py-1.5 text-[10px] text-zinc-600 italic">
                                  No models loaded
                                </div>
                              )}
                              {models.map((model) => {
                                const isSelected = props.model === model.name;
                                return (
                                  <div
                                    key={model.name}
                                    className={`w-full flex items-center justify-between px-2.5 py-1.5 rounded-lg transition-colors group ${
                                      isSelected ? 'bg-zinc-800' : 'hover:bg-zinc-800/40'
                                    }`}
                                  >
                                    <button
                                      onClick={() => {
                                        props.setProvider?.(prov);
                                        props.setModel?.(model.name);
                                        setIsOpen(false);
                                      }}
                                      className="flex-grow flex items-center gap-2 text-left min-w-0"
                                    >
                                      <div
                                        className={`w-1.5 h-1.5 rounded-full flex-shrink-0 ${
                                          isSelected ? 'bg-indigo-400' : 'bg-transparent group-hover:bg-zinc-600'
                                        }`}
                                      />
                                      <div className="min-w-0">
                                        <div className="text-xs font-semibold text-zinc-200 truncate leading-snug">
                                          {stripContextSuffix(model.label) || model.name}
                                        </div>
                                        <div className="text-[9px] text-zinc-500 flex gap-1.5 items-center leading-normal">
                                          <span className="truncate">
                                            {(model.maxTokenAllowed || 0).toLocaleString()} context
                                          </span>
                                          {isModelReasoning(prov.name, model) && (
                                            <>
                                              <span>·</span>
                                              <span className="text-indigo-400 font-semibold flex items-center gap-0.5">
                                                Reasoning
                                              </span>
                                            </>
                                          )}
                                        </div>
                                      </div>
                                    </button>

                                    {/* Configure parameters trigger — opens PANEL 2 */}
                                    <button
                                      onClick={() => {
                                        props.setProvider?.(prov);
                                        props.setModel?.(model.name);
                                        if (isCompact) setMobileActiveTab('config');
                                      }}
                                      className="p-1 rounded-md hover:bg-zinc-700/80 text-zinc-400 hover:text-indigo-400 transition ml-1 flex-shrink-0"
                                      title="Configure parameters"
                                    >
                                      <Icon icon="ci:slider-03" className="text-sm" />
                                    </button>
                                  </div>
                                );
                              })}
                            </div>
                          </div>
                        ))
                      )}
                    </div>
                  </motion.div>
                )}

                {/* PANEL 2: Parameters */}
                {(!isCompact || mobileActiveTab === 'config') && (
                  <motion.div
                    key="panel-config"
                    initial={isCompact ? { x: 50, opacity: 0 } : undefined}
                    animate={{ x: 0, opacity: 1 }}
                    exit={isCompact ? { x: 50, opacity: 0 } : undefined}
                    transition={{ duration: 0.2 }}
                    className="w-full p-4 flex flex-col justify-between h-full bg-[#1c1c1e]"
                    style={{ minWidth: isCompact ? '280px' : '280px', maxWidth: isCompact ? '280px' : '280px' }}
                  >
                    {/* Back nav for compact mode */}
                    <div className="space-y-1 flex-shrink-0">
                      {isCompact && (
                        <button
                          onClick={() => setMobileActiveTab('list')}
                          className="flex items-center gap-1 text-[10px] text-indigo-400 hover:text-indigo-300 font-bold uppercase tracking-wider mb-2"
                        >
                          <Icon icon="lucide:arrow-left" className="text-xs" />
                          <span>Back to Models</span>
                        </button>
                      )}
                    </div>

                    {/* Parameter controls — faithfully match the curated design's 5 states */}
                    <div className="flex-grow flex flex-col justify-center space-y-4 py-3 overflow-y-auto no-scrollbar">
                      {/* 1. EFFORT-BASED REASONING (OpenAI o1, Grok 4) */}
                      {thinkingControlState === 'effort-only' && (
                        <div className="space-y-4">
                          <span className="text-[10px] text-zinc-400 uppercase tracking-wider block font-bold">
                            Reasoning Effort
                          </span>
                          <div className="bg-black/40 border border-zinc-800 p-0.5 rounded-lg flex items-stretch justify-between h-[34px] relative">
                            {(['low', 'medium', 'high'] as const).map((effort) => (
                              <button
                                key={effort}
                                onClick={() => setThinkingOverride(effort)}
                                className={`flex-1 flex items-center justify-center text-[10px] capitalize font-semibold rounded-md transition-all ${
                                  thinkingOverride === effort
                                    ? 'bg-zinc-800 text-white shadow-sm'
                                    : 'text-zinc-400 hover:text-zinc-200'
                                }`}
                              >
                                {effort}
                              </button>
                            ))}
                          </div>
                          <div className="bg-black/10 p-2.5 rounded-xl border border-zinc-800/60 text-[10px] flex gap-2">
                            <Icon icon="lucide:info" className="text-indigo-400 text-sm flex-shrink-0 mt-0.5" />
                            <div className="text-zinc-400 leading-normal">
                              Reasoning effort is required for this model. Higher effort = more thorough thinking but
                              slower responses.
                            </div>
                          </div>
                        </div>
                      )}

                      {/* 2. BUDGET TOKEN SLIDERS (Gemini, Claude) */}
                      {thinkingControlState === 'toggle+budget' && (
                        <div className="space-y-3.5">
                          <div className="flex items-center justify-between border-b border-zinc-800/60 pb-2">
                            <span className="text-[10px] text-zinc-400 uppercase tracking-wider font-bold">
                              Enable Thinking
                            </span>
                            <button
                              onClick={() => setThinkingEnabled(!thinkingEnabled)}
                              className={`w-9 h-5 rounded-full p-0.5 transition-colors ${
                                thinkingEnabled ? 'bg-indigo-600' : 'bg-zinc-800'
                              }`}
                            >
                              <div
                                className={`w-4 h-4 rounded-full bg-white transition-transform ${
                                  thinkingEnabled ? 'translate-x-4' : 'translate-x-0'
                                }`}
                              />
                            </button>
                          </div>

                          {thinkingEnabled ? (
                            <div className="space-y-3">
                              <div className="flex justify-between items-center text-[10px]">
                                <span className="text-zinc-400">Thinking Budget:</span>
                                <span className="font-mono text-indigo-400 font-bold">
                                  {budgetTokens.toLocaleString()} tokens
                                </span>
                              </div>
                              <input
                                type="range"
                                className="chatbox-range w-full bg-zinc-800 h-1 rounded-lg cursor-pointer"
                                min={1024}
                                max={32768}
                                step={1024}
                                value={budgetTokens}
                                onChange={(e) => setBudgetTokens(Number(e.target.value))}
                              />
                              <div className="flex justify-between text-[8px] text-zinc-500 font-mono">
                                <span>1,024</span>
                                <span>32,768 max</span>
                              </div>
                            </div>
                          ) : (
                            <div className="bg-black/10 p-2 text-zinc-500 text-[10px] border border-dashed border-zinc-800/80 rounded-lg text-center">
                              Thinking disabled. Falling back to simple response path.
                            </div>
                          )}
                        </div>
                      )}

                      {/* 3. ALWAYS-ON LOCKED REASONING (DeepSeek Reasoner) */}
                      {thinkingControlState === 'on-and-locked' && (
                        <div className="space-y-3 text-center py-3 bg-indigo-500/5 border border-indigo-500/10 rounded-xl">
                          <Icon icon="lucide:shield-alert" className="text-xl text-indigo-400" />
                          <span className="text-xs font-bold text-zinc-200 block">Thinking Enforced</span>
                          <p className="text-[10px] text-zinc-400 px-4 leading-normal">
                            This model enforces internal thought pathways. No budget token caps can be configured on
                            this endpoint.
                          </p>
                        </div>
                      )}

                      {/* 4. NON-REASONING CHANNELS (GPT-4o, Claude 3.5 Sonnet) */}
                      {thinkingControlState === 'off-and-locked' && (
                        <div className="py-6 flex flex-col items-center justify-center text-center bg-black/10 border border-dashed border-zinc-800 rounded-xl">
                          <Icon icon="lucide:alert-circle" className="text-zinc-500 text-xl mb-1" />
                          <span className="text-zinc-400 text-xs font-semibold">Standard Pipeline</span>
                          <p className="text-zinc-600 text-[10px] px-4 mt-0.5 leading-normal">
                            This model accepts standard parameters and does not route inquiries through reasoning token
                            engines.
                          </p>
                        </div>
                      )}

                      {/* 5. DYNAMIC OUTPUT TOKEN CONFIGURATION */}
                      {activeModel?.maxCompletionTokens && (
                        <div className="space-y-2 pt-2 border-t border-zinc-800/60">
                          <div className="flex justify-between items-center text-[10px]">
                            <span className="text-zinc-400">Max Output Cap:</span>
                            <span className="font-mono text-zinc-300">
                              {maxOutputTokens.toLocaleString()} tokens
                            </span>
                          </div>
                          <input
                            type="range"
                            className="chatbox-range w-full bg-zinc-800 h-1 rounded-lg cursor-pointer"
                            min={1024}
                            max={activeModel.maxCompletionTokens}
                            step={1024}
                            value={maxOutputTokens}
                            onChange={(e) => setMaxOutputTokens(Number(e.target.value))}
                          />
                          <div className="flex justify-between text-[8px] text-zinc-500 font-mono">
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

        {/* Unified, borderless chat input bar */}
        <div
          ref={chatInputContainerRef}
          className="w-full bg-[#1c1c1e] border border-zinc-800/80 rounded-2xl shadow-xl p-3 flex flex-col gap-2 transition-all duration-200"
        >
          {/* Textarea */}
          <textarea
            ref={props.textareaRef}
            placeholder={props.chatMode === 'build' ? 'How can Amplify help you today?' : 'What would you like to discuss?'}
            value={props.input}
            onChange={props.handleInputChange}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                if (props.isStreaming) {
                  props.handleStop?.();
                  return;
                }
                if (e.nativeEvent.isComposing) return;
                handleSend();
              }
            }}
            onPaste={props.handlePaste}
            style={{ minHeight: props.TEXTAREA_MIN_HEIGHT, maxHeight: props.TEXTAREA_MAX_HEIGHT }}
            className="w-full bg-transparent text-sm text-white placeholder-zinc-500 outline-none border-none py-1 resize-none overflow-y-auto no-scrollbar"
          />

          {/* Bottom action row */}
          <div className="flex items-center justify-between pt-1">
            {/* Left side: attach + model picker trigger + (optional) key button */}
            <div className="flex items-center gap-2">
              {/* File attachment */}
              <button
                onClick={() => props.handleFileUpload()}
                className="w-8 h-8 rounded-lg bg-[#2c2c2e]/60 hover:bg-zinc-800/80 text-zinc-400 hover:text-white transition-colors flex items-center justify-center outline-none"
                title="Attach files"
              >
                <Icon icon="lucide:plus" className="text-base font-semibold" />
              </button>

              {/* Model picker trigger */}
              <button
                onClick={() => setIsOpen(!isOpen)}
                className="flex items-center gap-2 h-8 px-2.5 bg-[#2c2c2e]/60 hover:bg-zinc-800/80 border border-zinc-800/60 rounded-lg shadow-sm transition-all active:scale-[0.98] outline-none select-none text-zinc-100"
              >
                <Icon
                  icon={activeProvider ? providerIcon(activeProvider.name) : 'lucide:cpu'}
                  className="text-base flex-shrink-0"
                />
                {!isTriggerCompact && (
                  <>
                    <span className="text-xs font-semibold tracking-tight text-zinc-200 truncate max-w-[160px]">
                      {stripContextSuffix(activeModel?.label) || activeModel?.name || props.model || 'Select model'}
                    </span>
                    <Icon
                      icon="lucide:chevron-down"
                      className={`text-zinc-500 text-[10px] ml-0.5 transition-transform duration-200 ${
                        isOpen ? 'rotate-180' : ''
                      }`}
                    />
                  </>
                )}
              </button>

              {/* API key button (when key missing) */}
              {showKeyButton && (
                <div className="relative">
                  <IconButton
                    onClick={() => setIsApiKeyPopupOpen(true)}
                    title="API Key"
                    className={classNames(
                      'transition-all',
                      isKeyMissing
                        ? 'p-1.5 h-7 w-7 text-rose-400 hover:text-rose-300 bg-rose-500/10 rounded-md'
                        : 'p-1.5 h-7 w-7 text-zinc-400 hover:text-zinc-100 bg-[#2c2c2e]/60 rounded-md',
                    )}
                  >
                    <div className="i-ph:key text-sm" />
                  </IconButton>
                  <AnimatePresence>
                    {isApiKeyPopupOpen && (
                      <APIKeyPopup
                        provider={props.provider}
                        apiKey={props.apiKeys[props.provider.name] || ''}
                        setApiKey={(key) => props.onApiKeysChange(props.provider.name, key)}
                        onClose={() => setIsApiKeyPopupOpen(false)}
                      />
                    )}
                  </AnimatePresence>
                </div>
              )}
            </div>

            {/* Right side: context indicator + send button */}
            <div className="flex items-center gap-2">
              <ContextBudgetIndicator maxTokenAllowed={activeModel?.maxTokenAllowed} messages={props.messages} />
              <SummarizationToast messages={props.messages} />

              <button
                onClick={handleSend}
                disabled={!props.input.trim() || props.isStreaming || isKeyMissing}
                className="flex justify-center items-center w-8 h-8 rounded-full transition-colors duration-200 cursor-pointer disabled:cursor-not-allowed overflow-hidden bg-white/10 hover:bg-white/15 text-white disabled:opacity-50"
                title="Send Prompt (Enter)"
              >
                {props.isStreaming ? (
                  <Icon icon="lucide:loader-circle" className="text-lg animate-spin" />
                ) : (
                  <div
                    ref={sendIconRef}
                    className="flex items-center justify-center"
                    style={{ transform: 'rotate(-90deg)' }}
                  >
                    <Icon icon="iconoir:send-solid" className="text-lg" style={{ fontSize: '18px' }} />
                  </div>
                )}
              </button>
            </div>
          </div>
        </div>

        {/* Subtle accent line under the input */}
        <div className="absolute bottom-0 left-10 right-10 h-[1px] bg-gradient-to-r from-transparent via-indigo-500/10 to-transparent blur-[1px]" />
      </div>

      {/* Provider picker modal — lists ALL providers with enable/disable */}
      <ProviderPicker
        open={isProviderPickerOpen}
        onClose={() => setIsProviderPickerOpen(false)}
        providerList={props.providerList}
        provider={props.provider}
        setProvider={props.setProvider}
        apiKeys={props.apiKeys}
        onApiKeySaved={(name, key) => props.onApiKeysChange(name, key)}
      />
    </div>
  );
};

/* -------------------------------------------------------------------------- */
/* Helpers                                                                     */
/* -------------------------------------------------------------------------- */

const Icon: React.FC<{ icon: string; className?: string; style?: React.CSSProperties }> = ({
  icon,
  className = '',
  style,
}) => {
  // @ts-expect-error — custom element
  return <iconify-icon icon={icon} class={`inline-block align-middle ${className}`} style={style} />;
};

/**
 * Map provider name -> Iconify icon. Mirrors the curated design's icon set
 * but extended for every built-in provider in this repo.
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
 * Determine the reasoning/thinking control state for a (provider, model) pair.
 *
 * This is a heuristic since the actual provider configs don't expose thinking
 * capability in the static model list — we infer it from provider + model
 * name patterns. Matches the 5 states from the curated design.
 */
function getThinkingControlState(
  providerName: string,
  model: ModelInfo,
): 'toggle+budget' | 'effort-only' | 'toggle-only' | 'on-and-locked' | 'off-and-locked' {
  const name = (model.name || '').toLowerCase();
  const label = (model.label || '').toLowerCase();

  // DeepSeek Reasoner — always reasons, no toggle, no budget.
  if (providerName === 'DeepSeek' && (name.includes('reasoner') || label.includes('reasoner'))) {
    return 'on-and-locked';
  }

  // OpenAI o-series — effort-only (low/medium/high).
  if (providerName === 'OpenAI' && (name.startsWith('o1') || name.startsWith('o3') || name.startsWith('o4'))) {
    return 'effort-only';
  }

  // xAI Grok — effort-only.
  if (providerName === 'xAI' && (name.includes('grok-3') || name.includes('grok-4'))) {
    return 'effort-only';
  }

  // Google Gemini 2.5+/3 — toggle + token budget.
  if (providerName === 'Google' && (name.includes('gemini-2.5') || name.includes('gemini-3'))) {
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
  if (providerName === 'DeepSeek' && name.includes('chat')) {
    return 'off-and-locked';
  }

  // Default — no reasoning.
  return 'off-and-locked';
}

function isModelReasoning(providerName: string, model: ModelInfo): boolean {
  const state = getThinkingControlState(providerName, model);
  return state !== 'off-and-locked';
}
