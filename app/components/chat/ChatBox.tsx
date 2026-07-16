import React, { useState, useRef, useEffect, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Paperclip, Send, ChevronDown, Sparkles, X, FileText, Check } from 'lucide-react';
import { ClientOnly } from 'remix-utils/client-only';
import { classNames } from '~/utils/classNames';
import { PROVIDER_LIST } from '~/utils/constants';
import { ModelSelector } from '~/components/chat/ModelSelector';
import { APIKeyPopup } from './APIKeyPopup';
import { APIKeyManager } from './APIKeyManager';
import { LOCAL_PROVIDERS } from '~/lib/stores/settings';
import FilePreview from './FilePreview';
import { ScreenshotStateManager } from './ScreenshotStateManager';
import { IconButton } from '~/components/ui/IconButton';
import { toast } from 'react-toastify';
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

// Custom theme style injector to guarantee custom variables are active
// NOTE: @import removed — font loading belongs in root.tsx <head> links, not
// inline <style> in the body (blocks main thread on every re-render).
// NOTE: `* { transition }` removed — it caused severe input jank because
// every keystroke triggered style recalculation on ALL elements.
// NOTE: `.dark` changed to `[data-theme='dark']` to match the actual theme
// mechanism used by root.tsx and variables.scss.
const InjectThemeStyles = () => {
  return (
    <style
      dangerouslySetInnerHTML={{
        __html: `
      :root {
        --background: oklch(1 0 0);
        --foreground: oklch(0.145 0 0);
        --card: oklch(1 0 0);
        --card-foreground: oklch(0.145 0 0);
        --popover: oklch(1 0 0);
        --popover-foreground: oklch(0.145 0 0);
        --primary: oklch(0.205 0 0);
        --primary-foreground: oklch(0.985 0 0);
        --secondary: oklch(0.97 0 0);
        --secondary-foreground: oklch(0.205 0 0);
        --muted: oklch(0.97 0 0);
        --muted-foreground: oklch(0.556 0 0);
        --accent: oklch(0.97 0 0);
        --accent-foreground: oklch(0.205 0 0);
        --destructive: oklch(0.577 0.245 27.325);
        --destructive-foreground: oklch(0.577 0.245 27.325);
        --border: oklch(0.922 0 0);
        --input: oklch(0.922 0 0);
        --ring: oklch(0.708 0 0);
        
        --font-sans: Almarai, sans-serif;
        --font-serif: ui-serif, Georgia, Cambria, "Times New Roman", Times, serif;
        --font-mono: Geist Mono, ui-monospace, monospace;
        --radius: 0.625rem;
        
        --shadow-sm: 0 1px 3px 0px rgba(0,0,0,0.03), 0 1px 2px -1px rgba(0,0,0,0.03);
        --shadow-md: 0 4px 12px -2px rgba(0,0,0,0.05), 0 2px 6px -1px rgba(0,0,0,0.03);
        --shadow-lg: 0 10px 25px -5px rgba(0,0,0,0.08), 0 8px 16px -6px rgba(0,0,0,0.04);
        --shadow-xl: 0 20px 35px -10px rgba(0,0,0,0.12), 0 12px 20px -8px rgba(0,0,0,0.06);
      }

      [data-theme='dark'] {
        --background: oklch(0.145 0 0);
        --foreground: oklch(0.985 0 0);
        --card: oklch(0.145 0 0);
        --card-foreground: oklch(0.985 0 0);
        --popover: oklch(0.145 0 0);
        --popover-foreground: oklch(0.985 0 0);
        --primary: oklch(0.985 0 0);
        --primary-foreground: oklch(0.205 0 0);
        --secondary: oklch(0.269 0 0);
        --secondary-foreground: oklch(0.985 0 0);
        --muted: oklch(0.269 0 0);
        --muted-foreground: oklch(0.708 0 0);
        --accent: oklch(0.269 0 0);
        --accent-foreground: oklch(0.985 0 0);
        --destructive: oklch(0.396 0.141 25.723);
        --destructive-foreground: oklch(0.637 0.237 25.331);
        --border: oklch(0.269 0 0);
        --input: oklch(0.269 0 0);
        --ring: oklch(0.439 0 0);
        
        --shadow-sm: 0 1px 3px 0px rgba(0,0,0,0.3);
        --shadow-md: 0 4px 12px -2px rgba(0,0,0,0.4);
        --shadow-lg: 0 10px 25px -5px rgba(0,0,0,0.45);
        --shadow-xl: 0 20px 35px -10px rgba(0,0,0,0.5);
      }

      *, *::before, *::after {
        box-sizing: border-box;
      }

      ::-webkit-scrollbar {
        width: 6px;
        height: 6px;
      }
      ::-webkit-scrollbar-track {
        background: transparent;
      }
      ::-webkit-scrollbar-thumb {
        background: var(--border);
        border-radius: 9999px;
      }
      ::-webkit-scrollbar-thumb:hover {
        background: var(--muted-foreground);
      }
    `,
      }}
    />
  );
};

interface ChatBoxProps {
  provider: any;
  providerList: any[];
  modelList: any[];
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
  enhancePrompt?: (() => void) | undefined;
  onWebSearchResult?: (result: string) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  designScheme?: DesignScheme;
  setDesignScheme?: (scheme: DesignScheme) => void;
  selectedElement?: ElementInfo | null;
  setSelectedElement?: ((element: ElementInfo | null) => void) | undefined;

  /** Conversation messages — used by the context-budget indicator. */
  messages?: any[];
}

export const ChatBox: React.FC<ChatBoxProps> = (props) => {
  const [isModelDropdownOpen, setIsModelDropdownOpen] = useState(false);
  const [isApiKeyPopupOpen, setIsApiKeyPopupOpen] = useState(false);
  const [modelSearchQuery, setModelSearchQuery] = useState('');
  const dropdownContainerRef = React.useRef<HTMLDivElement>(null);
  const searchInputRef = React.useRef<HTMLInputElement>(null);

  const isKeyMissing = useMemo(() => {
    if (!props.provider?.name || LOCAL_PROVIDERS.includes(props.provider.name)) {
      return false;
    }

    return !props.apiKeys[props.provider.name];
  }, [props.provider, props.apiKeys]);

  const showKeyButton = useMemo(() => {
    return props.provider?.name && !LOCAL_PROVIDERS.includes(props.provider.name);
  }, [props.provider]);

  // Use model.name (not model.id) to match the ModelInfo type
  const activeModel = props.modelList.find((m) => m.name === props.model);

  // Close dropdown on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (dropdownContainerRef.current && !dropdownContainerRef.current.contains(event.target as Node)) {
        setIsModelDropdownOpen(false);
        setModelSearchQuery('');
      }
    };
    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  // Focus search input when dropdown opens
  useEffect(() => {
    if (isModelDropdownOpen && searchInputRef.current) {
      setTimeout(() => searchInputRef.current?.focus(), 50);
    }
  }, [isModelDropdownOpen]);

  const handleModelSelect = (modelItem: any) => {
    // Set the model by name
    props.setModel?.(modelItem.name);

    // Also update the provider so the system knows which provider to use
    const matchedProvider = (props.providerList || []).find((p) => p.name === modelItem.provider);

    if (matchedProvider) {
      props.setProvider?.(matchedProvider);
    }

    setIsModelDropdownOpen(false);
    setModelSearchQuery('');
  };

  // Build grouped models from static models only (hardcoded)
  const groupedModels = React.useMemo(() => {
    const query = modelSearchQuery.toLowerCase().trim();

    // Only use static models from the provider list — no dynamic/fetched models
    const allStaticModels: any[] = [];
    (props.providerList || []).forEach((provider) => {
      if (provider.staticModels && provider.staticModels.length > 0) {
        provider.staticModels.forEach((m: any) => {
          allStaticModels.push({ ...m, provider: provider.name });
        });
      }
    });

    // Also include models from modelList that match static providers if staticModels not exposed
    const modelListItems = props.modelList.filter((m) => {
      // Keep if from a known provider
      return (props.providerList || []).some((p) => p.name === m.provider);
    });

    // Prefer modelList (it may include dynamic), but dedupe by name
    const seenNames = new Set<string>();
    const combined: any[] = [];

    // First add from modelList
    modelListItems.forEach((m) => {
      if (!seenNames.has(m.name)) {
        seenNames.add(m.name);
        combined.push(m);
      }
    });

    // Then add any static models not already included
    allStaticModels.forEach((m) => {
      if (!seenNames.has(m.name)) {
        seenNames.add(m.name);
        combined.push(m);
      }
    });

    // Filter by search query
    const filtered = query
      ? combined.filter(
          (m) =>
            m.label?.toLowerCase().includes(query) ||
            m.name?.toLowerCase().includes(query) ||
            m.provider?.toLowerCase().includes(query),
        )
      : combined;

    // Group by provider
    const groups: Record<string, any[]> = {};
    filtered.forEach((m) => {
      const prov = m.provider || 'Other';

      if (!groups[prov]) {
        groups[prov] = [];
      }

      groups[prov].push(m);
    });

    return groups;
  }, [props.modelList, props.providerList, modelSearchQuery]);

  return (
    <div className="relative w-full max-w-chat mx-auto z-prompt">
      <InjectThemeStyles />

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

      <div className="relative">
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
              <div className="flex flex-wrap gap-2.5 p-3.5 border-b border-[var(--border)] bg-[var(--secondary)]/20 rounded-t-[20px]">
                {props.uploadedFiles.map((file, index) => (
                  <motion.div
                    key={index}
                    layout
                    initial={{ scale: 0.85, opacity: 0 }}
                    animate={{ scale: 1, opacity: 1 }}
                    exit={{ scale: 0.85, opacity: 0 }}
                    transition={{ type: 'spring', stiffness: 350, damping: 25 }}
                    className="group relative flex items-center gap-2 p-1.5 bg-[var(--card)] border border-[var(--border)] rounded-xl text-xs shadow-sm pr-7 transition-all hover:border-[var(--muted-foreground)]"
                  >
                    {file.type.startsWith('image/') ? (
                      <div className="relative w-8 h-8 rounded-lg overflow-hidden bg-[var(--muted)]">
                        <img src={props.imageDataList[index]} alt="preview" className="w-full h-full object-cover" />
                      </div>
                    ) : (
                      <div className="p-2 bg-[var(--secondary)] text-[var(--primary)] rounded-lg">
                        <FileText className="w-4 h-4" />
                      </div>
                    )}
                    <div className="truncate">
                      <p className="font-medium text-[var(--card-foreground)] truncate max-w-[120px]">{file.name}</p>
                      <p className="text-[10px] text-[var(--muted-foreground)]">{(file.size / 1024).toFixed(1)} KB</p>
                    </div>
                    <motion.button
                      whileHover={{ scale: 1.15 }}
                      whileTap={{ scale: 0.85 }}
                      onClick={() => {
                        props.setUploadedFiles?.(props.uploadedFiles.filter((_, i) => i !== index));
                        props.setImageDataList?.(props.imageDataList.filter((_, i) => i !== index));
                      }}
                      className="absolute right-1.5 top-1/2 -translate-y-1/2 p-1 rounded-md text-[var(--muted-foreground)] hover:text-rose-500 hover:bg-rose-500/10 cursor-pointer"
                    >
                      <X className="w-3.5 h-3.5" />
                    </motion.button>
                  </motion.div>
                ))}
              </div>
            </motion.div>
          )}
        </AnimatePresence>

        {/* Main Input Container */}
        <div className="w-full flex flex-col bg-[var(--card)] border border-[var(--border)] focus-within:border-[oklch(0.6171_0.1375_39.0427)] rounded-[20px] transition-all duration-300 shadow-md focus-within:shadow-lg focus-within:shadow-[oklch(0.6171_0.1375_39.0427)]/5">
          <div className="relative px-4 pt-4">
            <textarea
              ref={props.textareaRef}
              value={props.input}
              onChange={props.handleInputChange}
              onKeyDown={(event) => {
                if (event.key === 'Enter' && !event.shiftKey) {
                  event.preventDefault();

                  if (props.isStreaming) {
                    props.handleStop?.();
                    return;
                  }

                  if (event.nativeEvent.isComposing) {
                    return;
                  }

                  props.handleSendMessage?.(event);
                }
              }}
              onPaste={props.handlePaste}
              placeholder={
                props.chatMode === 'build' ? 'How can Amplify help you today?' : 'What would you like to discuss?'
              }
              rows={1}
              className="w-full bg-transparent border-0 outline-none resize-none overflow-y-auto text-[var(--card-foreground)] placeholder-[var(--muted-foreground)] text-sm leading-relaxed pr-12 focus:ring-0"
              style={{ minHeight: props.TEXTAREA_MIN_HEIGHT, maxHeight: props.TEXTAREA_MAX_HEIGHT }}
            />
          </div>

          <div className="flex items-center justify-between px-3.5 pb-3.5 pt-0 border-t border-transparent">
            <div className="flex items-center gap-1.5">
              <motion.button
                whileHover={{ scale: 1.05, opacity: 0.8 }}
                whileTap={{ scale: 0.95 }}
                onClick={() => props.handleFileUpload()}
                className="p-2.5 rounded-xl !bg-transparent text-[var(--muted-foreground)] hover:text-[var(--card-foreground)] transition-all cursor-pointer"
                title="Attach images or files"
              >
                <Paperclip className="w-4.5 h-4.5" />
              </motion.button>
              <div className="relative" ref={dropdownContainerRef}>
                <motion.button
                  whileHover={{ scale: 1.02, opacity: 0.8 }}
                  whileTap={{ scale: 0.98 }}
                  onClick={() => setIsModelDropdownOpen(!isModelDropdownOpen)}
                  className="flex items-center gap-1.5 px-3 py-1.5 rounded-xl bg-[var(--muted)] text-xs font-medium text-[var(--card-foreground)] transition-all cursor-pointer"
                >
                  <Sparkles className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  <span>{activeModel?.label || activeModel?.name || props.model || 'Select model'}</span>
                  {activeModel?.maxTokenAllowed && (
                    <span className="hidden sm:inline-flex items-center gap-0.5 ml-1 px-1.5 py-0.5 rounded-md bg-purple-500/10 text-purple-600 dark:text-purple-400 text-[9px] font-semibold font-mono leading-none">
                      {activeModel.maxTokenAllowed >= 1000000
                        ? `${(activeModel.maxTokenAllowed / 1000000).toFixed(1)}M`
                        : `${Math.floor(activeModel.maxTokenAllowed / 1000)}K`}
                    </span>
                  )}
                  <motion.div
                    animate={{ rotate: isModelDropdownOpen ? 180 : 0 }}
                    transition={{ duration: 0.2, ease: 'easeInOut' }}
                  >
                    <ChevronDown className="w-3.5 h-3.5 text-[var(--muted-foreground)]" />
                  </motion.div>
                </motion.button>

                <AnimatePresence>
                  {isModelDropdownOpen && (
                    <motion.div
                      initial={{ opacity: 0, y: 15, scale: 0.94 }}
                      animate={{ opacity: 1, y: 0, scale: 1 }}
                      exit={{ opacity: 0, y: 8, scale: 0.96 }}
                      transition={{ duration: 0.2, ease: [0.16, 1, 0.3, 1] }}
                      className="absolute left-0 bottom-full mb-2 w-80 bg-[var(--popover)] border border-[var(--border)] rounded-2xl shadow-xl z-50 origin-bottom-left overflow-hidden"
                    >
                      {/* Search input at the very top */}
                      <div className="p-2 border-b border-[var(--border)]">
                        <input
                          ref={searchInputRef}
                          type="text"
                          placeholder="Search models..."
                          value={modelSearchQuery}
                          onChange={(e) => setModelSearchQuery(e.target.value)}
                          onClick={(e) => e.stopPropagation()}
                          className="w-full bg-[var(--muted)] border border-[var(--border)] rounded-lg px-3 py-1.5 text-xs outline-none focus:ring-1 focus:ring-[var(--primary)] text-[var(--card-foreground)] placeholder-[var(--muted-foreground)]"
                        />
                      </div>

                      {/* Model list grouped by provider */}
                      <div className="max-h-64 overflow-y-auto py-1">
                        {Object.keys(groupedModels).length === 0 ? (
                          <div className="px-3 py-4 text-xs text-center text-[var(--muted-foreground)]">
                            No models found
                          </div>
                        ) : (
                          Object.entries(groupedModels).map(([providerName, models]) => (
                            <div key={providerName} className="mb-1">
                              {/* Provider header */}
                              <div className="px-3 pt-2 pb-1">
                                <span className="text-[10px] font-bold text-[var(--muted-foreground)] uppercase tracking-widest">
                                  {providerName}
                                </span>
                              </div>
                              {/* Models */}
                              <div className="space-y-0.5 px-1.5">
                                {models.map((modelItem: any) => {
                                  const isSelected = props.model === modelItem.name;
                                  return (
                                    <motion.button
                                      key={modelItem.name}
                                      whileHover={{ scale: 1.01 }}
                                      whileTap={{ scale: 0.99 }}
                                      onClick={(e) => {
                                        e.stopPropagation();
                                        handleModelSelect(modelItem);
                                      }}
                                      className="w-full flex items-center gap-2.5 p-2 rounded-xl text-left transition-colors cursor-pointer bg-transparent hover:bg-[var(--secondary)]/60 border border-transparent hover:border-[var(--border)]"
                                    >
                                      {/* Icon — only the icon bg changes to indicate selection */}
                                      <div className="flex-shrink-0">
                                        {isSelected ? (
                                          <motion.div
                                            layoutId="selectedModelIcon"
                                            className="p-1 rounded-lg bg-[oklch(0.6171_0.1375_39.0427)] text-white"
                                          >
                                            <Check className="w-3.5 h-3.5" />
                                          </motion.div>
                                        ) : (
                                          <div className="p-1 rounded-lg bg-[var(--muted)] text-[var(--muted-foreground)]">
                                            <Sparkles className="w-3.5 h-3.5" />
                                          </div>
                                        )}
                                      </div>
                                      {/* Model info */}
                                      <div className="flex-1 min-w-0">
                                        <p className="text-xs font-semibold text-[var(--card-foreground)] truncate">
                                          {modelItem.label || modelItem.name}
                                        </p>
                                        <p className="text-[10px] text-[var(--muted-foreground)] truncate">
                                          {modelItem.name}
                                        </p>
                                      </div>
                                      {modelItem.maxTokenAllowed && (
                                        <span className="flex-shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-md bg-[var(--muted)] text-[var(--muted-foreground)] text-[9px] font-semibold font-mono leading-none">
                                          {modelItem.maxTokenAllowed >= 1000000
                                            ? `${(modelItem.maxTokenAllowed / 1000000).toFixed(1)}M`
                                            : `${Math.floor(modelItem.maxTokenAllowed / 1000)}K`}
                                        </span>
                                      )}
                                    </motion.button>
                                  );
                                })}
                              </div>
                            </div>
                          ))
                        )}
                      </div>
                    </motion.div>
                  )}
                </AnimatePresence>
              </div>
              {showKeyButton && (
                <div className="relative">
                  <IconButton
                    onClick={() => setIsApiKeyPopupOpen(true)}
                    title="API Key"
                    className={classNames(
                      'transition-all',
                      isKeyMissing
                        ? 'p-1.5 h-7 w-7 text-red-500 hover:text-red-400 bg-red-500/10 rounded-md'
                        : 'p-1.5 h-7 w-7 text-[var(--muted-foreground)] hover:text-[var(--card-foreground)] bg-[var(--muted)] rounded-md',
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

            <div className="flex items-center gap-2">
              <ContextBudgetIndicator maxTokenAllowed={activeModel?.maxTokenAllowed} messages={props.messages} />
              <SummarizationToast messages={props.messages} />
              <AnimatePresence>
                {props.input.length > 0 && (
                  <motion.span
                    initial={{ opacity: 0, x: 5 }}
                    animate={{ opacity: 1, x: 0 }}
                    exit={{ opacity: 0, x: 5 }}
                    className="hidden sm:inline text-[10px] text-[var(--muted-foreground)] font-mono px-1"
                  >
                    {props.input.length} chars
                  </motion.span>
                )}
              </AnimatePresence>

              <motion.button
                whileHover={
                  (!props.input.trim() && props.uploadedFiles.length === 0) || props.isStreaming || isKeyMissing
                    ? {}
                    : { scale: 1.05 }
                }
                whileTap={
                  (!props.input.trim() && props.uploadedFiles.length === 0) || props.isStreaming || isKeyMissing
                    ? {}
                    : { scale: 0.95 }
                }
                onClick={(event) => props.handleSendMessage?.(event)}
                disabled={
                  props.isStreaming || (!props.input.trim() && props.uploadedFiles.length === 0) || isKeyMissing
                }
                className={`p-2.5 rounded-[14px] flex items-center justify-center transition-all duration-300 relative overflow-hidden group cursor-pointer ${
                  (!props.input.trim() && props.uploadedFiles.length === 0) || props.isStreaming || isKeyMissing
                    ? 'bg-[var(--muted)] text-[var(--muted-foreground)] cursor-not-allowed border border-[var(--border)] shadow-none'
                    : 'bg-[oklch(0.6171_0.1375_39.0427)] text-white hover:opacity-95 shadow-md shadow-[oklch(0.6171_0.1375_39.0427)]/20 hover:shadow-lg hover:shadow-[oklch(0.6171_0.1375_39.0427)]/35'
                }`}
                title="Send Prompt (Enter)"
              >
                <AnimatePresence mode="wait">
                  {props.isStreaming ? (
                    <motion.div
                      key="spinner"
                      initial={{ opacity: 0, rotate: -45 }}
                      animate={{ opacity: 1, rotate: 0 }}
                      exit={{ opacity: 0 }}
                      className="w-4.5 h-4.5 rounded-full border-2 border-white/30 border-t-white animate-spin"
                    />
                  ) : (
                    <motion.div
                      key="send-icon"
                      initial={{ opacity: 0, scale: 0.8 }}
                      animate={{ opacity: 1, scale: 1 }}
                      exit={{ opacity: 0, scale: 0.8 }}
                      transition={{ duration: 0.15 }}
                    >
                      <Send className="w-4 h-4 transition-transform group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                    </motion.div>
                  )}
                </AnimatePresence>
              </motion.button>
            </div>
          </div>
        </div>
        <div className="absolute bottom-0 left-10 right-10 h-[1px] bg-gradient-to-r from-transparent via-[oklch(0.6171_0.1375_39.0427)]/10 to-transparent blur-[1px]"></div>
      </div>
    </div>
  );
};
