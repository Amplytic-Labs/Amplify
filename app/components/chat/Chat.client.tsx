import { useStore } from '@nanostores/react';
import { modelConfigStore, getWireConfig } from '~/lib/stores/model-config';
import { rateLimitStore, getRateLimitWire } from '~/lib/stores/rate-limit';
import type { UIMessage } from 'ai';
import { DefaultChatTransport, lastAssistantMessageIsCompleteWithToolCalls } from 'ai';
import { useChat } from '@ai-sdk/react';
import {
  isToolPart,
  getToolNameFromPart,
  getToolCallId,
  getToolState,
  getToolOutput,
  ToolState,
} from '~/lib/chat/tool-parts';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react';
import { createDebugFetch } from '~/lib/debug/debug-broadcast';
import { toast } from 'react-toastify';
import { useMessageParser, usePromptEnhancer, useShortcuts } from '~/lib/hooks';
import { description, useChatHistory } from '~/lib/persistence';
import { chatStore } from '~/lib/stores/chat';
import { workbenchStore } from '~/lib/stores/workbench';
import { isReadOnlyNativeTool } from '~/lib/tools/nativeTools';
import {
  DEFAULT_MODEL,
  DEFAULT_PROVIDER,
  PROMPT_COOKIE_KEY,
  PROVIDER_LIST,
  TOOL_EXECUTION_APPROVAL,
} from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { createScopedLogger, renderLogger } from '~/utils/logger';
import { BaseChat } from './BaseChat';
import { PlanApprovalDialog } from './PlanApprovalDialog';
import Cookies from 'js-cookie';
import { debounce } from '~/utils/debounce';
import { useSettings } from '~/lib/hooks/useSettings';
import type { ProviderInfo } from '~/types/model';
import { useSearchParams } from '@remix-run/react';
import { createSampler } from '~/utils/sampler';
import { logStore } from '~/lib/stores/logs';
import { streamingState } from '~/lib/stores/streaming';
import { filesToArtifacts } from '~/utils/fileUtils';
import { supabaseConnection } from '~/lib/stores/supabase';
import { defaultDesignScheme, type DesignScheme } from '~/types/design-scheme';
import type { ElementInfo } from '~/components/workbench/Inspector';
import type { TextUIPart, FileUIPart, Attachment } from '@ai-sdk/ui-utils';
import { useMCPStore } from '~/lib/stores/mcp';
import type { LlmErrorAlertType } from '~/types/actions';
import { projectStore } from '~/lib/persistence/project-store';
import { planStore } from '~/lib/planning/plan-store';
import type { PlanProgressUpdate } from '~/lib/planning/sub-chat-engine';
import { useProjectContextString } from '~/lib/persistence/useProjectContext';
import { useScreenshotCapture } from '~/lib/services/screenshotCapture';
import type { IChatMetadata } from '~/lib/persistence/db';
import type { FileMap } from '~/lib/stores/files';

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat, chatKey } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  /*
   * Background screenshot capture: watches for the preview becoming available
   * (after `npm start`) and captures a one-shot thumbnail per project session,
   * stored in IndexedDB and shown in the sidebar ExpandableCard.
   */
  useScreenshotCapture();

  return (
    <>
      {ready && (
        <ChatImpl
          key={chatKey ?? 'home'}
          description={title}
          initialMessages={initialMessages}
          exportChat={exportChat}
          storeMessageHistory={storeMessageHistory}
          importChat={importChat}
        />
      )}
    </>
  );
}

const processSampledMessages = createSampler(
  (options: {
    messages: UIMessage[];
    initialMessages: UIMessage[];
    isLoading: boolean;
    parseMessages: (messages: UIMessage[], isLoading: boolean) => void;
    storeMessageHistory: (messages: UIMessage[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if ((messages?.length ?? 0) > (initialMessages?.length ?? 0)) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: UIMessage[];
  storeMessageHistory: (messages: UIMessage[]) => Promise<void>;
  importChat: (
    description: string,
    messages: UIMessage[],
    metadata?: IChatMetadata,
    initialFileMap?: FileMap,
  ) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const files = useStore(workbenchStore.files);
    const loadedProjectId = useStore(workbenchStore.loadedProjectId);

    /*
     * chatStarted must be true when either:
     *   1. There are initialMessages (restoring an existing chat), OR
     *   2. The workbench is open (project workspace is visible).
     *
     * Previously this also required loadedProjectId !== '<none>', which
     * created a race condition: showWorkbench could be true (set by
     * useChatHistory) before loadedProjectId was updated from '<none>'
     * to the actual project ID, leaving the Workbench returning null.
     * showWorkbench alone is sufficient because it is only set to true
     * when a workspace should be visible (project selected, template
     * injected, repo cloned).
     *
     * We use an internal state + a derived value to eliminate the
     * one-render gap that existed when showWorkbench became true after
     * mount. The derived `chatStarted` is true as soon as either
     * the internal flag OR showWorkbench is true, so the Workbench
     * never sees a stale false during the effect-to-render cycle.
     */
    const [chatStartedInternal, setChatStartedInternal] = useState((initialMessages?.length ?? 0) > 0 || showWorkbench);

    // Use ref for synchronous access to avoid race condition with async state updates
    const chatStartedRef = useRef((initialMessages?.length ?? 0) > 0 || showWorkbench);
    const chatStarted =
      chatStartedInternal || showWorkbench || (initialMessages?.length ?? 0) > 0 || chatStartedRef.current;
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const [designScheme, setDesignScheme] = useState<DesignScheme>(defaultDesignScheme);
    const actionAlert = useStore(workbenchStore.alert);
    const deployAlert = useStore(workbenchStore.deployAlert);
    const supabaseConn = useStore(supabaseConnection);
    const selectedProject = supabaseConn.stats?.projects?.find(
      (project) => project.id === supabaseConn.selectedProjectId,
    );
    const supabaseAlert = useStore(workbenchStore.supabaseAlert);
    const { activeProviders, promptId, autoSelectTemplate, contextOptimizationEnabled } = useSettings();
    const [llmErrorAlert, setLlmErrorAlert] = useState<LlmErrorAlertType | undefined>(undefined);
    const [model, setModel] = useState(() => {
      const savedModel = Cookies.get('selectedModel');
      return savedModel || DEFAULT_MODEL;
    });
    const [provider, setProvider] = useState(() => {
      const savedProvider = Cookies.get('selectedProvider');
      return (PROVIDER_LIST.find((p) => p.name === savedProvider) || DEFAULT_PROVIDER) as ProviderInfo;
    });
    const { showChat } = useStore(chatStore);
    const [animationScope, animate] = useAnimate();
    const [apiKeys, setApiKeys] = useState<Record<string, string>>({});

    const onApiKeysChange = useCallback(
      async (providerName: string, apiKey: string) => {
        const newApiKeys = { ...apiKeys, [providerName]: apiKey };
        setApiKeys(newApiKeys);
        localStorage.setItem('apiKeys', JSON.stringify(newApiKeys));
      },
      [apiKeys],
    );

    const [chatMode, setChatMode] = useState<'discuss' | 'build'>('build');
    const [selectedElement, setSelectedElement] = useState<ElementInfo | null>(null);
    const mcpSettings = useMCPStore((state) => state.settings);

    // Vector context state
    const [vectorUserContext, setVectorUserContext] = useState('');
    const [vectorProjectContext, setVectorProjectContext] = useState('');

    /*
     * Structured project memory + file tree + vector recall, combined for the
     * system prompt `projectContext` slot. Reactive to chat/files/memory edits.
     */
    const projectContextForPrompt = useProjectContextString(vectorProjectContext);

    // Plan execution state
    const [planExecuting, setPlanExecuting] = useState(false);
    const [planProgress, setPlanProgress] = useState<PlanProgressUpdate | null>(null);

    // True while the planner LLM enriches the draft signal into full Task Contracts.
    const [planLoading, setPlanLoading] = useState(false);

    // Guards against the enrichment effect firing twice (strict-mode / dep re-runs).
    const enrichPlanSignalRef = useRef(false);
    const activePlanIdRef = useRef<string | null>(null);
    const [planSignal, setPlanSignal] = useState<any>(null);

    // Stable debug fetch instance – intercepts /api/chat requests for the debug page
    const debugFetch = useMemo(() => createDebugFetch(), []);

    /*
     * projectContinuation: true when the chat is running inside an
     * already-loaded project workspace (files present + a project is
     * loaded in the WebContainer). Sent to the server so the model gets
     * a dedicated continuation prompt that tells it to work WITH the
     * existing workspace instead of reinitializing or re-injecting a
     * template.
     */
    const projectContinuation = !!loadedProjectId && loadedProjectId !== '<none>' && Object.keys(files).length > 0;

    /*
     * @ai-sdk/react v4 migration: useChat no longer manages input state.
     * Missing from old API: input, setInput, handleInputChange, isLoading,
     * append, reload, data, setData.
     *
     * We manage input locally and map old API calls to the new ones:
     *   isLoading → status === 'streaming' || status === 'submitted'
     *   append(msg) → sdkSendMessage(msg)   (user messages)
     *   append(assistantMsg) → setMessages([...messages, assistantMsg])
     *   reload() → regenerate()
     *   data/setData → removed (not used in new API)
     */
    const [input, setInput] = useState(Cookies.get(PROMPT_COOKIE_KEY) || '');

    const handleInputChange = useCallback((e: React.ChangeEvent<HTMLTextAreaElement | HTMLInputElement>) => {
      setInput(e.target.value);
    }, []);

    /*
     * Subscribe to modelConfig + rateLimit stores so the transport body
     * recomputes when the user changes thinking settings or rate limits
     * in the ChatBox settings popup. The subscription itself is a no-op
     * render-wise — we only read the latest value inside the body getter.
     */
    const modelConfig = useStore(modelConfigStore);
    const rateLimits = useStore(rateLimitStore);

    /*
     * AI SDK v7 Native Transport Configuration
     *
     * Using DefaultChatTransport with NATIVE `body` option - NO CUSTOM FETCH!
     * The SDK handles merging body data with messages automatically.
     * This is identical to how bolt.diy v4 used `useChat({ body: {...} })`
     * but adapted for v7's transport-based architecture.
     *
     * The `body` here can be either a static object OR a function. We use
     * a FUNCTION so the latest `modelConfig` / `rateLimits` values are
     * read at REQUEST time (not at memo creation time) — this avoids
     * stale-closure bugs where the user changes a slider but the next
     * request still uses the old value.
     */
    const chatTransport = useMemo(
      () =>
        new DefaultChatTransport({
          api: '/api/chat',
          body: () => ({
            apiKeys,
            files,
            promptId,
            contextOptimization: contextOptimizationEnabled,
            chatMode,
            designScheme,
            supabase: {
              isConnected: supabaseConn.isConnected,
              hasSelectedProject: !!selectedProject,
              credentials: {
                supabaseUrl: supabaseConn?.credentials?.supabaseUrl,
                anonKey: supabaseConn?.credentials?.anonKey,
              },
            },
            maxLLMSteps: mcpSettings.maxLLMSteps,
            userContext: vectorUserContext || undefined,
            projectContext: projectContextForPrompt,
            projectContinuation,

            /*
             * Unified thinking/reasoning config (ChatBox settings popup).
             * Server translates this into per-provider providerOptions.
             */
            modelConfig: getWireConfig(),

            /*
             * Per-provider rate-limit config for the CURRENT provider.
             * Server uses this for pre-flight TPM checks and RPM throttling.
             */
            rateLimit: getRateLimitWire(provider.name),
          }),

          // Use debugFetch ONLY for debug page interception (optional)
          fetch: debugFetch,
        }),
      [
        apiKeys,
        files,
        promptId,
        contextOptimizationEnabled,
        chatMode,
        designScheme,
        supabaseConn,
        selectedProject,
        mcpSettings.maxLLMSteps,
        vectorUserContext,
        projectContextForPrompt,
        projectContinuation,
        debugFetch,
        modelConfig,
        rateLimits,
        provider.name,
      ],
    );

    const {
      messages,
      status,
      stop,
      setMessages,
      sendMessage: sdkSendMessage,
      regenerate,
      error,
      addToolResult,
      addToolOutput,
    } = useChat({
      /*
       * AI SDK v7: Use transport with NATIVE body option (no custom fetch needed)
       * The SDK automatically merges body data with messages on each request
       */
      transport: chatTransport,

      // Pass initial messages if available (for chat history restoration)
      ...(initialMessages && (initialMessages?.length ?? 0) > 0 ? { messages: initialMessages } : {}),

      /*
       * CRITICAL (Task 3b): Native tools are sent to streamText WITHOUT an
       * `execute` function (see api.chat.ts:301 `toolsWithoutExecute`). The
       * SDK therefore cannot auto-run them and the stream for that step ends
       * naturally after the tool-call part is emitted.
       *
       * The client-side auto-approve effect (below) calls `addToolResult`
       * to populate the part's `output` field with a placeholder, but the
       * SDK ONLY auto-sends a follow-up `/api/chat` request to actually
       * execute the tool server-side if this predicate returns true.
       *
       * `lastAssistantMessageIsCompleteWithToolCalls` is the canonical
       * helper exported from `ai@7` — it returns true when the last
       * assistant message has tool-call parts ALL in the `output-available`
       * / `output-error` state (i.e. every tool call has a result).
       *
       * Without this, the chat stream silently stops after the first tool
       * call — no error, no log, no follow-up request, no rendered chip.
       */
      sendAutomaticallyWhen: lastAssistantMessageIsCompleteWithToolCalls,

      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
      },
      onFinish: ({ message }) => {
        console.log('[DEBUG Chat] onFinish called:', {
          messageId: message?.id,
          role: message?.role,
          hasParts: Array.isArray(message?.parts),
          partsCount: message?.parts?.length,
          totalMessagesBefore: messages?.length,
        });

        logger.debug('[Chat] Finished streaming - message received:', {
          messageId: message?.id,
          role: message?.role,
          hasParts: Array.isArray(message?.parts),
          partsCount: message?.parts?.length,
          contentPreview: Array.isArray(message?.parts)
            ? (
                message.parts
                  .filter((p: any) => p.type === 'text')
                  .map((p: any) => p.text)
                  .join('') || ''
              ).slice(0, 100)
            : '(no parts)',
          totalMessages: messages?.length,
          allMessageIds: messages?.map((m) => ({ id: m.id, role: m.role })),
        });

        // M-1 fix: Auto-extract user facts and project context after each AI response
        const lastUserMsg = (messages || []).filter((m) => m.role === 'user').pop();

        // Helper to extract text content from UIMessage parts (v7 uses parts, not content)
        const getMessageContent = (msg: any): string => {
          if (!msg) {
            return '';
          }

          if (typeof msg.content === 'string') {
            return msg.content;
          }

          if (Array.isArray(msg.parts)) {
            return msg.parts
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join('');
          }

          return '';
        };

        const lastUserContent = getMessageContent(lastUserMsg);
        const assistantContent = getMessageContent(message);

        if (lastUserContent) {
          import('~/lib/hooks/useVectorContext')
            .then(({ extractAndStoreUserFacts, extractAndStoreProjectContext }) => {
              extractAndStoreUserFacts(lastUserContent, assistantContent).catch(() => {});

              import('~/lib/persistence/useChatHistory').then(({ chatId }) => {
                const cid = chatId.get();

                if (cid) {
                  const project = projectStore.getProjectByChat(cid);

                  if (project) {
                    extractAndStoreProjectContext(
                      project.id,
                      `Implemented: ${assistantContent.slice(0, 200)}`,
                      'conversation_summary',
                    ).catch(() => {});
                  }
                }
              });
            })
            .catch(() => {});
        }
      },
    });

    // Derived: isLoading equivalent from new status API
    const isLoading = status === 'streaming' || status === 'submitted';

    // Adapter: append user message → sdkSendMessage; append assistant message → setMessages
    const append = useCallback(
      (message: { role: string; content?: string; parts?: any }, options?: any) => {
        if (message.role === 'user') {
          sdkSendMessage(
            {
              role: 'user' as const,

              // AI SDK v7: use parts array instead of content
              parts: message.parts || [{ type: 'text' as const, text: message.content || '' }],
            } as any,
            options,
          );
        } else {
          // Assistant messages are appended locally (not sent to API)
          setMessages((prev: any[]) => [...prev, { ...message, id: `local-${Date.now()}` } as any]);
        }
      },
      [sdkSendMessage, setMessages],
    );

    // Adapter: reload → regenerate
    const reload = useCallback(
      (options?: any) => {
        regenerate(options);
      },
      [regenerate],
    );

    useEffect(() => {
      const prompt = searchParams.get('prompt');

      // console.log(prompt, searchParams, model, provider);

      if (prompt) {
        setSearchParams({});
        runAnimation();
        append({
          role: 'user',
          content: `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${prompt}`,
        });
      }
    }, [model, provider, searchParams]);

    const { enhancingPrompt, promptEnhanced, enhancePrompt, resetEnhancer } = usePromptEnhancer();
    const { parsedMessages, parseMessages } = useMessageParser();

    const TEXTAREA_MAX_HEIGHT = chatStarted ? 400 : 200;

    /*
     * Keep chatStartedInternal and chatStore.started in sync with the
     * workspace state. When the workbench opens (e.g. project loaded
     * after initial render), we must flip chatStartedInternal to true so
     * the Workbench component renders even if showWorkbench later becomes
     * false. Only showWorkbench is needed — loadedProjectId may lag
     * behind during async loading, causing a window where the panel is
     * open but the Workbench returns null.
     *
     * This single effect replaces two separate effects: the old mount-only
     * effect (with empty deps) and the sync effect. The mount-only effect
     * was misleading because it never re-ran when showWorkbench changed
     * after mount, and the two effects could race.
     */
    useEffect(() => {
      /*
       * Include `chatStartedRef.current` so the user-driven start signal
       * (set synchronously by `runAnimation()` on first message send) is
       * never overridden back to false. Without this, the effect re-fires
       * when `chatStartedInternal` flips true, computes shouldStart=false
       * (because initialMessages is empty and showWorkbench is still
       * false at that instant), and clobbers `chatStore.started` back to
       * false — which reverts the Background to opaque right after the
       * user sends their first message.
       */
      const shouldStart = chatStartedRef.current || (initialMessages?.length ?? 0) > 0 || showWorkbench;

      if (shouldStart !== chatStartedInternal) {
        setChatStartedInternal(shouldStart);
      }

      chatStore.setKey('started', shouldStart);
    }, [initialMessages?.length, showWorkbench, chatStartedInternal]);

    /*
     * Abort streaming and workbench actions when ChatImpl unmounts
     * (e.g. when switching to a different chat). Without this, the old
     * streaming HTTP connection may continue running, and stale responses
     * could arrive after the user has switched to a different chat.
     */
    useEffect(() => {
      return () => {
        stop();
        workbenchStore.abortAllActions();
      };
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, []);

    useEffect(() => {
      /*
       * Only process if we have messages — skip empty calls that may
       * occur during chat switches when the sampler fires with stale state.
       */
      if ((messages?.length ?? 0) > 0) {
        processSampledMessages({
          messages,
          initialMessages,
          isLoading,
          parseMessages,
          storeMessageHistory,
        });
      }
    }, [messages, isLoading, parseMessages, initialMessages, storeMessageHistory]);

    // Debug: Log messages state changes to trace AI message flow
    useEffect(() => {
      if ((messages?.length ?? 0) > 0) {
        console.log('[DEBUG Chat] Messages state updated:', {
          count: messages?.length,
          lastMessage: {
            id: messages[messages.length - 1]?.id,
            role: messages[messages.length - 1]?.role,
            hasParts: Array.isArray(messages[messages.length - 1]?.parts),
          },
          chatStarted: {
            ref: chatStartedRef.current,
            state: chatStartedInternal,
            derived:
              chatStartedInternal || showWorkbench || (initialMessages?.length ?? 0) > 0 || chatStartedRef.current,
          },
        });

        logger.debug('[Chat] Messages state updated:', {
          count: messages?.length,
          lastMessage: {
            id: messages[messages.length - 1]?.id,
            role: messages[messages.length - 1]?.role,
            hasParts: Array.isArray(messages[messages.length - 1]?.parts),
          },
          chatStarted: {
            ref: chatStartedRef.current,
            state: chatStartedInternal,
            derived:
              chatStartedInternal || showWorkbench || (initialMessages?.length ?? 0) > 0 || chatStartedRef.current,
          },
        });
      }
    }, [messages?.length, messages?.[messages?.length - 1]?.id]);

    // Query vector stores for RAG context when user messages change
    useEffect(() => {
      let cancelled = false;

      async function updateVectorContext() {
        try {
          const { userProfileStore } = await import('~/lib/vector-store/user-profile-store');
          const { projectContextStore } = await import('~/lib/vector-store/project-context-store');
          const { chatId } = await import('~/lib/persistence/useChatHistory');

          await userProfileStore.initialize();

          // Get last user message for context query
          const userMessages = (messages || []).filter((m) => m.role === 'user');

          // Extract content from UIMessage v7 (uses parts array)
          const lastUserMsg = userMessages[(userMessages?.length ?? 1) - 1];
          let lastMsg = '';

          if (lastUserMsg) {
            if (typeof (lastUserMsg as any).content === 'string') {
              lastMsg = (lastUserMsg as any).content;
            } else if (Array.isArray((lastUserMsg as any).parts)) {
              lastMsg = (lastUserMsg as any).parts
                .filter((p: any) => p.type === 'text')
                .map((p: any) => p.text)
                .join('');
            }
          }

          if (!lastMsg) {
            setVectorUserContext('');
            setVectorProjectContext('');

            return;
          }

          // Query user profile
          const userCtx = await userProfileStore.formatContextForPrompt(lastMsg, 500);

          if (!cancelled) {
            setVectorUserContext(userCtx);
          }

          // Check if this is a project chat and query project context
          const currentChatId = chatId.get();
          const project = currentChatId ? projectStore.getProjectByChat(currentChatId) : null;

          if (project) {
            const projCtx = await projectContextStore.formatContextForPrompt(project.id, lastMsg, 1000);

            if (!cancelled) {
              setVectorProjectContext(projCtx);
            }
          } else {
            if (!cancelled) {
              setVectorProjectContext('');
            }
          }
        } catch (error) {
          // Vector context is optional — don't block chat on errors
          console.warn('[Chat] Vector context query failed:', error);
        }
      }

      updateVectorContext();

      return () => {
        cancelled = true;
      };
    }, [messages?.length]);

    // Detect execute_plan signal, enrich via the planner LLM, then show the approval dialog.
    useEffect(() => {
      const lastAssistantMessage = (messages || []).filter((m) => m.role === 'assistant').pop();

      // Extract content from UIMessage v7 (uses parts array)
      let content = '';

      if (lastAssistantMessage) {
        if (typeof (lastAssistantMessage as any).content === 'string') {
          content = (lastAssistantMessage as any).content.trim();
        } else if (Array.isArray((lastAssistantMessage as any).parts)) {
          content = (lastAssistantMessage as any).parts
            .filter((p: any) => p.type === 'text')
            .map((p: any) => p.text)
            .join('')
            .trim();
        }
      }

      if (!content) {
        return;
      }

      /*
       * M-4 fix: Check for the signal marker before attempting JSON.parse
       * to avoid wasting cycles parsing normal conversational text.
       */
      if (!content.startsWith('{') || !content.includes('execute_plan_signal')) {
        return;
      }

      let signal: any;

      try {
        signal = JSON.parse(content);
      } catch {
        // Starts with { but isn't valid JSON — ignore
        return;
      }

      if (signal.type !== 'execute_plan_signal') {
        return;
      }

      if (planExecuting || planSignal || planLoading) {
        return;
      }

      if (enrichPlanSignalRef.current) {
        return;
      }

      enrichPlanSignalRef.current = true;

      /*
       * Open the dialog immediately with the AI's draft plan + a loading
       * overlay, then run the planner LLM to enrich each point into a
       * full Task Contract (goal, requirements, successCriteria,
       * requiredSkills, requiredToolOutputs, constraints). On failure
       * the draft is kept so the user can still approve.
       */
      setPlanSignal(signal);
      setPlanLoading(true);

      (async () => {
        try {
          const { enrichSignalWithPlan } = await import('~/lib/planning/planner');
          const enriched = await enrichSignalWithPlan(signal, projectContextForPrompt);
          setPlanSignal(enriched);
        } catch (e) {
          logger.error('[Plan] planner enrichment failed, falling back to draft', e);
        } finally {
          setPlanLoading(false);
        }
      })();
    }, [messages, planExecuting, planSignal, planLoading, projectContextForPrompt]);

    /*
     * ───────────────────────────────────────────────────────────────────
     * Native Copilot-style tool mutation handler
     *
     * When the AI calls one of the native tools (replace_string_in_file,
     * multi_replace_string_in_file, create_file), the server-side execute
     * function returns a JSON "mutation signal" rather than mutating the
     * file system directly. This effect scans the latest assistant message
     * for tool-call results that contain such a signal and applies each
     * operation to the workbench file store, which writes through to the
     * WebContainer.
     *
     * We track processed toolCallIds in a ref so we never apply the same
     * mutation twice (the effect re-runs on every `messages` change).
     * ───────────────────────────────────────────────────────────────────
     */
    const processedMutationToolCallIdsRef = useRef<Set<string>>(new Set());

    useEffect(() => {
      const lastAssistant = (messages || []).filter((m) => m.role === 'assistant').pop();

      if (!lastAssistant) {
        return;
      }

      /*
       * Tool invocations can live either on `toolInvocations` (legacy v4) or
       * inside `parts` (AI SDK v7 flat shape: `tool-<name>` / `dynamic-tool`).
       * We normalise both into a flat `{ toolName, toolCallId, state, result }`
       * shape via the helpers in `~/lib/chat/tool-parts` so the rest of this
       * effect can use one consistent access pattern.
       */
      const allInvocations: any[] = [];

      if (Array.isArray((lastAssistant as any).parts)) {
        for (const p of (lastAssistant as any).parts) {
          if (isToolPart(p)) {
            allInvocations.push({
              toolName: getToolNameFromPart(p),
              toolCallId: getToolCallId(p),
              state: getToolState(p),
              result: getToolOutput(p),
            });
          }
        }
      }

      /*
       * Note: toolInvocations is deprecated in AI SDK v7, but kept for backward compatibility
       * In v7, tool invocations live inline on the part (flat). This branch only
       * catches old persisted v4 messages.
       */
      if (Array.isArray((lastAssistant as any).toolInvocations)) {
        allInvocations.push(...(lastAssistant as any).toolInvocations);
      }

      for (const inv of allInvocations) {
        // Accept both v7 'output-available'/'output-error' and legacy v4 'result'.
        if (!ToolState.isResult(inv.state)) {
          continue;
        }

        const toolCallId: string = inv.toolCallId;

        if (processedMutationToolCallIdsRef.current.has(toolCallId)) {
          continue;
        }

        const result = inv.result;

        if (typeof result !== 'string') {
          continue;
        }

        if (!result.includes('amplify_file_mutation')) {
          continue;
        }

        let parsed: any = null;

        try {
          parsed = JSON.parse(result);
        } catch {
          continue;
        }

        if (!parsed || parsed.type !== 'amplify_file_mutation' || !Array.isArray(parsed.operations)) {
          continue;
        }

        processedMutationToolCallIdsRef.current.add(toolCallId);

        /*
         * If the workspace is still loading files (e.g. after inject_template),
         * delay the mutation until the workspace is ready. Mutating a file that
         * hasn't been written to the WebContainer yet would fail or create an
         * inconsistent state. We wait for workspaceReadyRef to become true,
         * which happens when the files atom has file entries.
         */
        (async () => {
          if (!workspaceReadyRef.current) {
            logger.debug(`[native-tool] delaying mutation ${toolCallId} — workspace not ready`);

            // Wait for the workspace to become ready (poll every 200ms)
            await new Promise<void>((resolve) => {
              const check = () => {
                if (workspaceReadyRef.current) {
                  resolve();
                } else {
                  setTimeout(check, 200);
                }
              };
              check();
            });

            logger.debug(`[native-tool] workspace ready, applying mutation ${toolCallId}`);
          }

          for (const op of parsed.operations) {
            try {
              const summary = await workbenchStore.applyFileMutation(op);
              logger.info(`[native-tool] ${summary}`);
            } catch (e: any) {
              logger.error('[native-tool] mutation failed', e);
            }
          }
        })();
      }
    }, [messages]);

    /*
     * ───────────────────────────────────────────────────────────────────
     * Auto-approve read-only native tools (Copilot-style frictionless reads)
     *
     * Copilot in VS Code does NOT prompt the user every time the AI wants
     * to read a file, list a directory, or run a grep — it just does it.
     * Only mutating operations (edits, creates, terminal commands) prompt
     * the user for consent. We mirror that behaviour here.
     *
     * When the AI emits a tool call with state='call' for any of the
     * read-only native tools below, we immediately call `addToolResult`
     * with `TOOL_EXECUTION_APPROVAL.APPROVE`. The next /api/chat request
     * then runs the server-side execute function and the actual result
     * (file contents, grep matches, web results, …) is streamed back.
     *
     * Mutating tools (replace_string_in_file, multi_replace_string_in_file,
     * create_file) are intentionally NOT in this list — they still show
     * the Approve/Reject UI so the user stays in control of file edits.
     *
     * IMPORTANT: If the workspace is still loading files (e.g. after an
     * inject_template), we delay auto-approval until the workspace has
     * finished loading. This prevents the AI from reading/modifying files
     * that don't exist in the WebContainer yet.
     * ───────────────────────────────────────────────────────────────────
     */
    const autoApprovedToolCallIdsRef = useRef<Set<string>>(new Set());

    /*
     * Track whether the workspace has finished processing an inject_template
     * or file-loading operation. When a project is loaded, we wait for the
     * files to be present in the workbench store before allowing tool
     * results to be sent.
     */
    const workspaceReadyRef = useRef(true);
    const pendingAutoApprovalsRef = useRef<Array<{ toolCallId: string; toolName?: string }>>([]);

    /*
     * Workspace file-stabilization tracking (Bug 3 robustness).
     *
     * When inject_template streams an <amplifyArtifact>, files are written
     * to the WebContainer asynchronously by the message parser. The tool
     * result is returned to the AI BEFORE all files are committed, so the
     * AI may immediately try to read/modify files that don't exist yet.
     *
     * `workspaceFileCountRef` records the last-seen file count; the
     * readiness effect only opens the gate once the count has STABILIZED
     * (unchanged for WORKSPACE_STABILIZE_MS). This prevents the gate from
     * opening the moment the first file appears while the rest are still
     * streaming in.
     */
    const WORKSPACE_STABILIZE_MS = 600;
    const workspaceFileCountRef = useRef(0);
    const workspaceStabilizeTimerRef = useRef(0);

    /*
     * Reset tool call tracking refs on mount. When switching chats,
     * ChatImpl remounts (due to chatKey change), but refs may retain
     * stale IDs from the previous chat if React reuses the fiber.
     * Clearing them ensures no cross-chat state bleeding.
     */
    useEffect(() => {
      processedMutationToolCallIdsRef.current = new Set();
      autoApprovedToolCallIdsRef.current = new Set();
      pendingAutoApprovalsRef.current = [];
      workspaceReadyRef.current = true;
      workspaceFileCountRef.current = 0;
      workspaceStabilizeTimerRef.current = 0;
    }, []);

    useEffect(() => {
      /*
       * Mark workspace as NOT ready when a project is being loaded or
       * an inject_template is being processed (files map is empty but
       * showWorkbench just turned on). Mark as ready once files are present
       * AND have stabilized (no new files appearing for a brief window).
       *
       * Previously this required loadedProjectId !== '<none>', which missed
       * the inject_template case where files are being created by the
       * message parser but loadedProjectId hasn't been set to a real ID yet.
       * Now we simply check: if the workbench is open and there are no files,
       * the workspace isn't ready.
       *
       * We also check for inject_template tool calls in the messages — when
       * the AI calls inject_template, the workspace will soon have files but
       * they may not be loaded yet. We mark the workspace as not ready until
       * the files actually appear AND stop growing.
       */
      const currentFiles = workbenchStore.files.get();
      const fileCount = Object.keys(currentFiles).filter((k) => currentFiles[k]?.type === 'file').length;
      const hasFiles = fileCount > 0;

      /*
       * Detect inject_template in progress: scan messages for an inject_template
       * tool call that is in the call/partial/result lifecycle. We include the
       * `result` state because the tool result is returned to the AI BEFORE the
       * streamed <amplifyArtifact> XML has finished parsing and writing files
       * to the WebContainer — so files may still be arriving after `result`.
       */
      let injectTemplateInProgress = false;

      for (const msg of messages) {
        if (msg.role !== 'assistant') {
          continue;
        }

        const parts = (msg as any).parts as any[] | undefined;

        if (!Array.isArray(parts)) {
          continue;
        }

        for (const p of parts) {
          if (
            isToolPart(p) &&
            getToolNameFromPart(p) === 'inject_template' &&
            (ToolState.isCall(getToolState(p)) ||
              ToolState.isPartial(getToolState(p)) ||
              ToolState.isResult(getToolState(p)))
          ) {
            injectTemplateInProgress = true;
            break;
          }
        }

        if (injectTemplateInProgress) {
          break;
        }
      }

      if ((showWorkbench && !hasFiles) || injectTemplateInProgress) {
        workspaceReadyRef.current = false;

        /*
         * Track the current file count so we can detect when files stop
         * growing (stabilization) before declaring the workspace ready.
         * This prevents the gate from opening the moment the FIRST file
         * appears while the rest of the template is still streaming in.
         */
        workspaceFileCountRef.current = fileCount;
      } else if (hasFiles && !injectTemplateInProgress) {
        /*
         * Files exist and no inject_template is in progress. Before opening
         * the gate, require the file count to STABILIZE — i.e. remain the
         * same across two consecutive renders within a short time window.
         * This handles the race where files are still being written by the
         * message parser after the inject_template tool result arrived.
         */
        if (fileCount !== workspaceFileCountRef.current) {
          // Files are still growing — keep gate closed, record new count.
          workspaceFileCountRef.current = fileCount;
          workspaceStabilizeTimerRef.current = Date.now();

          return;
        }

        const elapsed = Date.now() - (workspaceStabilizeTimerRef.current || 0);

        if (elapsed < WORKSPACE_STABILIZE_MS) {
          /*
           * Not yet stable — keep gate closed; this effect will re-run on
           * the next files change or can be re-checked via the timer below.
           */
          return;
        }

        if (!workspaceReadyRef.current) {
          workspaceReadyRef.current = true;
          workspaceFileCountRef.current = 0;
          workspaceStabilizeTimerRef.current = 0;

          /*
           * Flush any pending auto-approvals that were queued while
           * the workspace was loading.
           */
          if (pendingAutoApprovalsRef.current.length > 0) {
            const pending = [...pendingAutoApprovalsRef.current];
            pendingAutoApprovalsRef.current = [];

            for (const { toolCallId, toolName } of pending) {
              logger.debug(`[auto-approve] flushing delayed ${toolCallId}`);

              /*
               * AI SDK v7 signature: { tool, toolCallId, output, state }
               * State must be 'output-available' (not 'result' from v4)
               */
              addToolResult({
                tool: toolName || 'unknown',
                toolCallId,
                output: TOOL_EXECUTION_APPROVAL.APPROVE,
                state: 'output-available',
              });
            }
          }
        }
      }
    }, [files, showWorkbench, loadedProjectId, addToolResult, messages]);

    /*
     * Stabilization timer: the files effect above only re-runs when `files`
     * changes. If files stop changing (stabilized) we still need to flip the
     * gate open after the stabilization window elapses. This standalone timer
     * polls the readiness condition while the workspace is in a "loading"
     * state, ensuring the gate eventually opens even without further file
     * changes.
     */
    useEffect(() => {
      if (workspaceReadyRef.current) {
        return undefined;
      }

      const interval = setInterval(() => {
        const currentFiles = workbenchStore.files.get();
        const fileCount = Object.keys(currentFiles).filter((k) => currentFiles[k]?.type === 'file').length;

        if (fileCount === 0) {
          return; // still no files
        }

        if (fileCount !== workspaceFileCountRef.current) {
          workspaceFileCountRef.current = fileCount;
          workspaceStabilizeTimerRef.current = Date.now();

          return;
        }

        const elapsed = Date.now() - (workspaceStabilizeTimerRef.current || 0);

        if (elapsed >= WORKSPACE_STABILIZE_MS && !workspaceReadyRef.current) {
          // Re-verify no inject_template is still in progress.
          let injectInProgress = false;

          for (const msg of messages) {
            if (msg.role !== 'assistant') {
              continue;
            }

            const parts = (msg as any).parts as any[] | undefined;

            if (!Array.isArray(parts)) {
              continue;
            }

            for (const p of parts) {
              if (
                isToolPart(p) &&
                getToolNameFromPart(p) === 'inject_template' &&
                (ToolState.isCall(getToolState(p)) ||
                  ToolState.isPartial(getToolState(p)) ||
                  ToolState.isResult(getToolState(p)))
              ) {
                /*
                 * Only block if the result hasn't arrived yet. Once state
                 * is `output-available` (v4 `'result'`) the file-writing is
                 * finishing up; combined with stabilization this is safe.
                 * Keep simple: if any inject_template call/partial (not yet
                 * result) exists, wait.
                 */
                if (!ToolState.isResult(getToolState(p))) {
                  injectInProgress = true;
                  break;
                }
              }
            }

            if (injectInProgress) {
              break;
            }
          }

          if (!injectInProgress) {
            workspaceReadyRef.current = true;
            workspaceFileCountRef.current = 0;
            workspaceStabilizeTimerRef.current = 0;

            if (pendingAutoApprovalsRef.current.length > 0) {
              const pending = [...pendingAutoApprovalsRef.current];
              pendingAutoApprovalsRef.current = [];

              for (const { toolCallId, toolName } of pending) {
                logger.debug(`[auto-approve] flushing delayed ${toolCallId} (stabilize timer)`);

                /*
                 * AI SDK v7 signature: { tool, toolCallId, output, state }
                 * State must be 'output-available' (not 'result' from v4)
                 */
                addToolResult({
                  tool: toolName || 'unknown',
                  toolCallId,
                  output: TOOL_EXECUTION_APPROVAL.APPROVE,
                  state: 'output-available',
                });
              }
            }
          }
        }
      }, 250);

      return () => clearInterval(interval);
    }, [messages, addToolResult]);

    useEffect(() => {
      for (const msg of messages) {
        if (msg.role !== 'assistant') {
          continue;
        }

        const parts = (msg as any).parts as any[] | undefined;

        if (!Array.isArray(parts)) {
          continue;
        }

        for (const p of parts) {
          if (!isToolPart(p)) {
            continue;
          }

          const inv = {
            toolName: getToolNameFromPart(p),
            toolCallId: getToolCallId(p),
            state: getToolState(p),
          };

          // v7 'input-available' (and 'input-streaming') == v4 'call'.
          if (!ToolState.isCall(inv.state)) {
            continue;
          }

          if (!isReadOnlyNativeTool(inv.toolName)) {
            continue;
          }

          if (autoApprovedToolCallIdsRef.current.has(inv.toolCallId)) {
            continue;
          }

          autoApprovedToolCallIdsRef.current.add(inv.toolCallId);

          /*
           * If the workspace is still loading files (e.g. after
           * inject_template), queue the auto-approval instead of
           * sending it immediately. This prevents the AI from
           * reading files that don't exist in the WebContainer yet.
           */
          if (!workspaceReadyRef.current) {
            logger.debug(`[auto-approve] delaying ${inv.toolName} (${inv.toolCallId}) — workspace not ready`);
            pendingAutoApprovalsRef.current.push({ toolCallId: inv.toolCallId, toolName: inv.toolName });
            continue;
          }

          logger.debug(`[auto-approve] ${inv.toolName} (${inv.toolCallId})`);

          /*
           * AI SDK v7 signature: { tool, toolCallId, output, state }
           * State must be 'output-available' (not 'result' from v4)
           */
          addToolResult({
            tool: inv.toolName,
            toolCallId: inv.toolCallId,
            output: TOOL_EXECUTION_APPROVAL.APPROVE,
            state: 'output-available',
          });
        }
      }
    }, [messages, addToolResult]);

    const handlePlanExecution = async (signal: any) => {
      setPlanExecuting(true);

      try {
        const { executePlan } = await import('~/lib/planning/sub-chat-engine');
        const { getSystemPrompt } = await import('~/lib/common/prompts/new-prompt');
        const { chatId: chatIdAtom } = await import('~/lib/persistence/useChatHistory');

        const currentChatId = chatIdAtom.get();
        const project = currentChatId ? projectStore.getProjectByChat(currentChatId) : null;

        if (!project) {
          setPlanExecuting(false);
          return;
        }

        // Create the plan with full Task Contracts (immutable spec + mutable ExecutionState per point).
        const DEFAULT_CHECKS = ['lint', 'type_check', 'flow_verification'] as any[];
        const plan = await planStore.createPlanWithContractsAsync({
          projectId: project.id,
          chatId: currentChatId || '',
          userRequest: signal.taskDescription,
          description: signal.taskDescription,
          plannerNotes: signal.plannerNotes,
          points: signal.planPoints.map((p: any) => ({
            title: p.title,
            goal: p.goal || '',
            description: p.description,
            requirements: p.requirements || [],
            successCriteria: p.successCriteria || [],
            requiredSkills: p.requiredSkills || [],
            requiredToolOutputs: p.requiredToolOutputs || [],
            expectedFiles: p.expectedFiles || [],
            verificationChecks: p.verificationChecks?.length ? (p.verificationChecks as any) : DEFAULT_CHECKS,
            constraints: p.constraints,
          })),
        });

        activePlanIdRef.current = plan.id;

        /*
         * M-2 fix: Get the full system prompt with ALL context injections
         * Sub-chats must receive the same rich prompt as the main chat.
         */
        const { SkillLoader } = await import('~/lib/services/skillLoader');
        const { memoryStore } = await import('~/lib/persistence/memoryStore');
        const skillLoader = SkillLoader.getInstance();
        const skills = skillLoader.getRelevantSkills();
        const memory = memoryStore.formatForPrompt();

        // Query vector stores for current context
        let currentUserContext = vectorUserContext || '';
        let currentProjectContext = vectorProjectContext || '';

        try {
          const { userProfileStore } = await import('~/lib/vector-store/user-profile-store');
          const { projectContextStore } = await import('~/lib/vector-store/project-context-store');
          await userProfileStore.initialize();
          currentUserContext = await userProfileStore.formatContextForPrompt(signal.taskDescription, 500);
          currentProjectContext = await projectContextStore.formatContextForPrompt(
            project.id,
            signal.taskDescription,
            1000,
          );
        } catch (e) {
          // Vector context is optional
        }

        /*
         * Prepend the structured project memory + file tree so sub-chats share
         * the same global context as the main chat.
         */
        let projectMemoryBlock = '';
        let fileTreeBlock = '';

        try {
          const { formatProjectMemoryForPrompt } = await import('~/lib/persistence/project-store');
          const { buildFileTreeSummary } = await import('~/lib/persistence/project-memory-detect');
          projectMemoryBlock = formatProjectMemoryForPrompt(project.memory);
          fileTreeBlock = buildFileTreeSummary(workbenchStore.files.get()) || '';

          const parts = [
            projectMemoryBlock,
            fileTreeBlock ? `File tree:\n${fileTreeBlock}` : '',
            currentProjectContext,
          ].filter(Boolean);
          currentProjectContext = parts.join('\n\n');
        } catch {
          /* keep vector-only context */
        }

        /*
         * Collect available skills as RawSkillInput for the SkillContextBuilder.
         * getRelevantSkills() returns a string, so we use getSkills() to get
         * the list, then fetch each skill's content individually.
         */
        const skillList = skillLoader.getSkills();
        const availableSkills = await Promise.all(
          skillList.map(async (s: any) => ({
            id: s.id,
            label: s.label,
            content: (await skillLoader.getSkillContent(s.id)) || '',
          })),
        );

        const fullSystemPrompt = getSystemPrompt({
          cwd: '/home/project',
          allowedHtmlElements: [] as any[],
          modificationTagName: 'amplifyArtifact',
          skills,
          memory,
          userContext: currentUserContext,
          projectContext: currentProjectContext,
        });

        // Get tool execution results from recent messages (extract from parts for v7)
        const getToolInvocations = (msg: any): any[] => {
          if (!msg || !Array.isArray(msg.parts)) {
            return [];
          }

          const out: any[] = [];

          for (const p of msg.parts) {
            if (!isToolPart(p)) {
              continue;
            }

            out.push({
              toolName: getToolNameFromPart(p),
              result: getToolOutput(p),
            });
          }

          return out;
        };
        const toolResults = messages
          .filter((m) => m.role === 'assistant')
          .flatMap((m) => {
            // Try v7 parts first, fallback to legacy toolInvocations
            const invocations = getToolInvocations(m);

            if (invocations.length > 0) {
              return invocations.map((ti: any) => `${ti.toolName}: ${JSON.stringify(ti.result || {}).slice(0, 300)}`);
            }

            // Fallback for backward compatibility
            return ((m as any).toolInvocations || []).map(
              (ti: any) => `${ti.toolName}: ${JSON.stringify(ti.result || {}).slice(0, 300)}`,
            );
          })
          .join('\n');

        // Execute the plan
        const result = await executePlan(plan, {
          callLLM: async (subMessages, systemPrompt) => {
            // Make a real fetch to /api/chat and collect the streamed response
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: subMessages,
                chatMode: 'build',
                contextOptimization: false,
                maxLLMSteps: 5,
                userContext: currentUserContext || '',
                projectContext: currentProjectContext || '',
                apiKeys,
                files: workbenchStore.files.get(),
              }),
            });

            if (!response.ok) {
              const errorText = await response.text().catch(() => 'Unknown error');
              throw new Error(`Sub-chat LLM call failed (${response.status}): ${errorText}`);
            }

            if (!response.body) {
              throw new Error('Sub-chat response body is null — streaming not supported');
            }

            // Read the data stream and extract text parts
            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            const toolInvocations: any[] = [];
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('0:')) {
                  continue;
                }

                try {
                  const jsonStr = line.slice(2);
                  const parsed = JSON.parse(jsonStr);

                  if (parsed.type === 'text') {
                    fullContent += parsed.text || '';
                  }
                } catch {
                  // Skip malformed lines
                }
              }
            }

            return {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: fullContent || 'No response generated.',
              toolInvocations: toolInvocations.length > 0 ? toolInvocations : undefined,
            };
          },
          runShellCommand: async (cmd) => {
            /*
             * M-3 fix: Execute shell commands through the WebContainer API.
             * We spawn a new process for each verification command rather than
             * going through the terminal UI, which could interfere with the
             * user's interactive session.
             */
            try {
              const { webcontainer } = await import('~/lib/webcontainer');
              const wc = await webcontainer;
              const process = await wc.spawn('sh', ['-c', cmd]);
              let stdout = '';
              const stderr = '';
              process.output.pipeTo(
                new WritableStream({
                  write(data) {
                    stdout += data;
                  },
                }),
              );

              const exitCode = await process.exit;

              return { stdout, stderr, exitCode: exitCode ?? 0 };
            } catch (e: any) {
              return { stdout: '', stderr: e.message || 'Shell command failed', exitCode: 1 };
            }
          },
          readFile: async (path) => {
            const currentFiles = workbenchStore.files.get();
            const file = currentFiles[path];

            if (file && file.type === 'file') {
              return file.content;
            }

            return null;
          },
          writeFile: async (path, content) => {
            /*
             * M-3 fix: Write file through the workbench store which syncs
             * to both the editor state and WebContainer filesystem.
             */
            try {
              await workbenchStore.createFile(path, content);
            } catch (e: any) {
              logger.error(`[Plan] writeFile failed for ${path}:`, e);
            }
          },
          listFiles: async () => {
            return Object.keys(workbenchStore.files.get());
          },
          signal: planStore.getAbortSignal(),
          systemPrompt: fullSystemPrompt,
          toolExecutionResults: toolResults,
          chatId: currentChatId || '',
          projectId: project.id,
          availableSkills,
          projectMemoryBlock,
          fileTreeBlock,
          plannerNotes: signal.plannerNotes,
          onProgress: (update) => {
            setPlanProgress(update);
          },
        });

        // Append the plan result to the chat
        if (result.summary) {
          append({
            role: 'assistant',
            content: `Plan execution complete.\n\n**Summary:**\n${result.summary}${result.failedPoints.length > 0 ? `\n\n**Failed points:** ${result.failedPoints.join(', ')}` : ''}`,
          });
        }
      } catch (error) {
        console.error('[Chat] Plan execution failed:', error);
      } finally {
        setPlanExecuting(false);
        setPlanProgress(null);
        activePlanIdRef.current = null;
      }
    };

    /**
     * Resumes a paused / interrupted plan from where it left off.
     *
     * The ExecutionManager finds the first non-complete task, checks
     * if it has a checkpoint, and reconstructs the worker's context.
     * The user just says "continue" — no need to specify which task.
     */
    const handleResumePlan = async () => {
      const planId = activePlanIdRef.current;

      if (!planId) {
        return;
      }

      setPlanExecuting(true);

      try {
        const { resumePlan } = await import('~/lib/planning/sub-chat-engine');
        const { ExecutionManager } = await import('~/lib/planning/execution-manager');

        const state = ExecutionManager.getExecutionState(planId);

        if (!state?.canResume) {
          return;
        }

        // Reload the plan from the store
        const plan = await planStore.getPlanAsync(planId);

        if (!plan) {
          return;
        }

        /*
         * Reuse the same execution options as the original plan execution.
         * We rebuild the system prompt and context the same way.
         */
        const { getSystemPrompt } = await import('~/lib/common/prompts/new-prompt');
        const { chatId: chatIdAtom } = await import('~/lib/persistence/useChatHistory');
        const currentChatId = chatIdAtom.get();
        const project = currentChatId ? projectStore.getProjectByChat(currentChatId) : null;

        if (!project) {
          return;
        }

        const { SkillLoader } = await import('~/lib/services/skillLoader');
        const { memoryStore } = await import('~/lib/persistence/memoryStore');
        const skillLoader = SkillLoader.getInstance();
        const skills = skillLoader.getRelevantSkills();
        const memory = memoryStore.formatForPrompt();

        let currentUserContext = '';
        let currentProjectContext = '';

        try {
          const { userProfileStore } = await import('~/lib/vector-store/user-profile-store');
          const { projectContextStore } = await import('~/lib/vector-store/project-context-store');
          await userProfileStore.initialize();
          currentUserContext = await userProfileStore.formatContextForPrompt(plan.userRequest, 500);
          currentProjectContext = await projectContextStore.formatContextForPrompt(project.id, plan.userRequest, 1000);
        } catch {
          // Vector context is optional
        }

        let projectMemoryBlock = '';
        let fileTreeBlock = '';

        try {
          const { formatProjectMemoryForPrompt } = await import('~/lib/persistence/project-store');
          const { buildFileTreeSummary } = await import('~/lib/persistence/project-memory-detect');
          projectMemoryBlock = formatProjectMemoryForPrompt(project.memory);
          fileTreeBlock = buildFileTreeSummary(workbenchStore.files.get()) || '';

          const parts = [
            projectMemoryBlock,
            fileTreeBlock ? `File tree:\n${fileTreeBlock}` : '',
            currentProjectContext,
          ].filter(Boolean);
          currentProjectContext = parts.join('\n\n');
        } catch {
          /* keep vector-only context */
        }

        const fullSystemPrompt = getSystemPrompt({
          cwd: '/home/project',
          allowedHtmlElements: [] as any[],
          modificationTagName: 'amplifyArtifact',
          skills,
          memory,
          userContext: currentUserContext,
          projectContext: currentProjectContext,
        });

        // Collect available skills as RawSkillInput for the SkillContextBuilder
        const skillList = skillLoader.getSkills();
        const availableSkills = await Promise.all(
          skillList.map(async (s: any) => ({
            id: s.id,
            label: s.label,
            content: (await skillLoader.getSkillContent(s.id)) || '',
          })),
        );

        // Get tool execution results from recent messages (extract from parts for v7)
        const getToolInvocationsForResume = (msg: any): any[] => {
          if (!msg || !Array.isArray(msg.parts)) {
            return [];
          }

          const out: any[] = [];

          for (const p of msg.parts) {
            if (!isToolPart(p)) {
              continue;
            }

            out.push({
              toolName: getToolNameFromPart(p),
              result: getToolOutput(p),
            });
          }

          return out;
        };
        const toolResults = messages
          .filter((m) => m.role === 'assistant')
          .flatMap((m) => {
            // Try v7 parts first, fallback to legacy toolInvocations
            const invocations = getToolInvocationsForResume(m);

            if (invocations.length > 0) {
              return invocations.map((ti: any) => `${ti.toolName}: ${JSON.stringify(ti.result || {}).slice(0, 300)}`);
            }

            // Fallback for backward compatibility
            return ((m as any).toolInvocations || []).map(
              (ti: any) => `${ti.toolName}: ${JSON.stringify(ti.result || {}).slice(0, 300)}`,
            );
          })
          .join('\n');

        await resumePlan(plan, {
          callLLM: async (subMessages, systemPrompt) => {
            const response = await fetch('/api/chat', {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                messages: subMessages,
                chatMode: 'build',
                contextOptimization: false,
                maxLLMSteps: 5,
                userContext: currentUserContext || '',
                projectContext: currentProjectContext || '',
                apiKeys,
                files: workbenchStore.files.get(),
              }),
            });

            if (!response.ok) {
              const errorText = await response.text().catch(() => 'Unknown error');
              throw new Error(`Sub-chat LLM call failed (${response.status}): ${errorText}`);
            }

            if (!response.body) {
              throw new Error('Sub-chat response body is null');
            }

            const reader = response.body.getReader();
            const decoder = new TextDecoder();
            let fullContent = '';
            let buffer = '';

            while (true) {
              const { done, value } = await reader.read();

              if (done) {
                break;
              }

              buffer += decoder.decode(value, { stream: true });

              const lines = buffer.split('\n');
              buffer = lines.pop() || '';

              for (const line of lines) {
                if (!line.startsWith('0:')) {
                  continue;
                }

                try {
                  const parsed = JSON.parse(line.slice(2));

                  if (parsed.type === 'text') {
                    fullContent += parsed.text || '';
                  }
                } catch {
                  // Skip malformed lines
                }
              }
            }

            return {
              id: crypto.randomUUID(),
              role: 'assistant' as const,
              content: fullContent || 'No response generated.',
            };
          },
          runShellCommand: async (cmd) => {
            try {
              const { webcontainer } = await import('~/lib/webcontainer');
              const wc = await webcontainer;
              const process = await wc.spawn('sh', ['-c', cmd]);
              let stdout = '';
              process.output.pipeTo(
                new WritableStream({
                  write(data) {
                    stdout += data;
                  },
                }),
              );

              const exitCode = await process.exit;

              return { stdout, stderr: '', exitCode: exitCode ?? 0 };
            } catch (e: any) {
              return { stdout: '', stderr: e.message || 'Shell command failed', exitCode: 1 };
            }
          },
          readFile: async (path) => {
            const currentFiles = workbenchStore.files.get();
            const file = currentFiles[path];

            return file && file.type === 'file' ? file.content : null;
          },
          writeFile: async (path, content) => {
            try {
              await workbenchStore.createFile(path, content);
            } catch (e: any) {
              logger.error(`[Plan] writeFile failed for ${path}:`, e);
            }
          },
          listFiles: async () => Object.keys(workbenchStore.files.get()),
          signal: planStore.getAbortSignal(),
          systemPrompt: fullSystemPrompt,
          toolExecutionResults: toolResults,
          chatId: currentChatId || '',
          projectId: project.id,
          availableSkills,
          projectMemoryBlock,
          fileTreeBlock,
          onProgress: (update) => {
            setPlanProgress(update);
          },
        });

        append({
          role: 'assistant',
          content: `Plan resumed and continued. Check the plan view for progress.`,
        });
      } catch (error) {
        console.error('[Chat] Plan resume failed:', error);
      } finally {
        setPlanExecuting(false);
        setPlanProgress(null);
      }
    };

    const scrollTextArea = () => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.scrollTop = textarea.scrollHeight;
      }
    };

    const abort = () => {
      stop();
      chatStore.setKey('aborted', true);
      workbenchStore.abortAllActions();

      logStore.logProvider('Chat response aborted', {
        component: 'Chat',
        action: 'abort',
        model,
        provider: provider.name,
      });
    };

    const handleError = useCallback(
      (error: any, context: 'chat' | 'template' | 'llmcall' = 'chat') => {
        logger.error(`${context} request failed`, error);

        stop();
        setFakeLoading(false);

        let errorInfo = {
          message: 'An unexpected error occurred',
          isRetryable: true,
          statusCode: 500,
          provider: provider.name,
          type: 'unknown' as const,
          retryDelay: 0,
        };

        if (error.message) {
          try {
            const parsed = JSON.parse(error.message);

            if (parsed.error || parsed.message) {
              errorInfo = { ...errorInfo, ...parsed };
            } else {
              errorInfo.message = error.message;
            }
          } catch {
            errorInfo.message = error.message;
          }
        }

        let errorType: LlmErrorAlertType['errorType'] = 'unknown';
        let title = 'Request Failed';

        if (errorInfo.statusCode === 401 || errorInfo.message.toLowerCase().includes('api key')) {
          errorType = 'authentication';
          title = 'Authentication Error';
        } else if (errorInfo.statusCode === 429 || errorInfo.message.toLowerCase().includes('rate limit')) {
          errorType = 'rate_limit';
          title = 'Rate Limit Exceeded';
        } else if (errorInfo.message.toLowerCase().includes('quota')) {
          errorType = 'quota';
          title = 'Quota Exceeded';
        } else if (errorInfo.statusCode >= 500) {
          errorType = 'network';
          title = 'Server Error';
        }

        logStore.logError(`${context} request failed`, error, {
          component: 'Chat',
          action: 'request',
          error: errorInfo.message,
          context,
          retryable: errorInfo.isRetryable,
          errorType,
          provider: provider.name,
        });

        // Create API error alert
        setLlmErrorAlert({
          type: 'error',
          title,
          description: errorInfo.message,
          provider: provider.name,
          errorType,
        });

        // Note: setData removed in @ai-sdk/react v4 — data is no longer managed by useChat
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    /*
     * Auto-resize the textarea to fit its content. This MUST run as a
     * layout effect (before paint) — not a regular effect — because the
     * resize sets `height='auto'` (shrink) then measures `scrollHeight`
     * then sets the final height. With useEffect the intermediate 'auto'
     * state is painted for one frame, causing a visible shrink-then-grow
     * flicker. That layout shift propagates through the flex container
     * and triggers the StickToBottom scroll recalculation, making the
     * chat messages jump on every keystroke. useLayoutEffect applies
     * all three height changes synchronously before the browser paints,
     * so only the final height is ever visible.
     */
    useLayoutEffect(() => {
      const textarea = textareaRef.current;

      if (textarea) {
        textarea.style.height = 'auto';

        const scrollHeight = textarea.scrollHeight;

        textarea.style.height = `${Math.min(scrollHeight, TEXTAREA_MAX_HEIGHT)}px`;
        textarea.style.overflowY = scrollHeight > TEXTAREA_MAX_HEIGHT ? 'auto' : 'hidden';
      }
    }, [input, textareaRef]);

    useEffect(() => {
      const handleQuoteText = (e: Event) => {
        const customEvent = e as CustomEvent<string>;
        const quotedText = `"${customEvent.detail}"`;
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${currentInput}\n\n${quotedText}` : quotedText;

        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);

        setTimeout(() => {
          textareaRef.current?.focus();
        }, 10);
      };

      window.addEventListener('amplify:quote-text', handleQuoteText);

      return () => window.removeEventListener('amplify:quote-text', handleQuoteText);
    }, [input, handleInputChange]);

    /*
     * runAnimation - toggles chatStarted and runs exit animations.
     *
     * CRITICAL: chatStartedRef.current is set SYNCHRONOUSLY before any async
     * operations. This ensures:
     * 1. Messages component renders immediately (not after await)
     * 2. UI shows chat area before AI response arrives
     * 3. Background transitions to transparent state
     *
     * Matches bolt.diy pattern but with synchronous state update for reliability.
     */
    const runAnimation = async () => {
      // Only run if not already started
      if (chatStartedRef.current) {
        return;
      }

      // SYNCHRONOUS: Set chatStarted immediately - takes effect on next render
      chatStartedRef.current = true;
      setChatStartedInternal(true);
      chatStore.setKey('started', true);

      // Run animations asynchronously (cosmetic only, doesn't affect rendering)
      try {
        await Promise.all([
          animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
          animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
        ]);
      } catch (e) {
        // Animation errors shouldn't block chat functionality
        logger.warn('[Chat] Animation failed:', e);
      }
    };

    /*
     * Helper function to create message parts array from text and images
     * AI SDK v7: FileUIPart requires mediaType and url (not mimeType and data)
     */
    const createMessageParts = (text: string, images: string[] = []): any[] => {
      // Create an array of properly typed message parts
      const parts: any[] = [
        {
          type: 'text' as const,
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mediaType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';
        const base64Data = imageData.replace(/^data:image\/[^;]+;base64/, '');

        // Create file part according to AI SDK v7 format
        parts.push({
          type: 'file' as const,
          mediaType,

          // In v7, FileUIPart uses url (data URL) instead of data
          url: `data:${mediaType};base64,${base64Data}`,
        });
      });

      return parts;
    };

    // Helper function to convert File[] to Attachment[] for AI SDK
    const filesToAttachments = async (files: File[]): Promise<Attachment[] | undefined> => {
      if (files.length === 0) {
        return undefined;
      }

      const attachments = await Promise.all(
        files.map(
          (file) =>
            new Promise<Attachment>((resolve) => {
              const reader = new FileReader();

              reader.onloadend = () => {
                resolve({
                  name: file.name,
                  contentType: file.type,
                  url: reader.result as string,
                });
              };
              reader.readAsDataURL(file);
            }),
        ),
      );

      return attachments;
    };

    const sendMessage = async (_event: React.UIEvent, messageInput?: string) => {
      const messageContent = messageInput || input;

      if (!messageContent?.trim()) {
        return;
      }

      if (isLoading) {
        abort();
        return;
      }

      let finalMessageContent = messageContent;

      if (selectedElement) {
        console.log('Selected Element:', selectedElement);

        const elementInfo = `<div class=\"__amplifySelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      // Debug: Verify chatStarted is set before sending
      logger.debug('[Chat] sendMessage called, chatStarted:', {
        ref: chatStartedRef.current,
        state: chatStartedInternal,
        derived: chatStartedInternal || showWorkbench || (initialMessages?.length ?? 0) > 0 || chatStartedRef.current,
      });

      // Use ref for synchronous check (not stale state)
      if (!chatStartedRef.current && !showWorkbench && (initialMessages?.length ?? 0) === 0) {
        setFakeLoading(true);

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        const attachmentOptions = attachments ? { experimental_attachments: attachments } : undefined;

        /*
         * FIX: Use sendMessage instead of setMessages + reload()
         * Previously: setMessages([userMessage]) + reload() which called regenerate()
         * Problem: regenerate() tries to re-generate last ASSISTANT message - but there isn't one yet!
         * Solution: Use sdkSendMessage() which properly sends user message AND streams AI response
         */
        sdkSendMessage(
          {
            role: 'user' as const,
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
          } as any,
          attachmentOptions as any,
        );

        setFakeLoading(false);
        setInput('');
        Cookies.remove(PROMPT_COOKIE_KEY);

        setUploadedFiles([]);
        setImageDataList([]);

        resetEnhancer();

        textareaRef.current?.blur();

        return;
      }

      if (error != null) {
        setMessages(messages.slice(0, -1));
      }

      const modifiedFiles = workbenchStore.getModifiedFiles();

      chatStore.setKey('aborted', false);

      if (modifiedFiles !== undefined) {
        const userUpdateArtifact = filesToArtifacts(modifiedFiles, `${Date.now()}`);
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${userUpdateArtifact}${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );

        workbenchStore.resetAllFileModifications();
      } else {
        const messageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;

        const attachmentOptions =
          uploadedFiles.length > 0 ? { experimental_attachments: await filesToAttachments(uploadedFiles) } : undefined;

        append(
          {
            role: 'user',
            content: messageText,
            parts: createMessageParts(messageText, imageDataList),
          },
          attachmentOptions,
        );
      }

      setInput('');
      Cookies.remove(PROMPT_COOKIE_KEY);

      setUploadedFiles([]);
      setImageDataList([]);

      resetEnhancer();

      textareaRef.current?.blur();
    };

    /**
     * Handles the change event for the textarea and updates the input state.
     * @param event - The change event from the textarea.
     */
    const onTextareaChange = (event: React.ChangeEvent<HTMLTextAreaElement>) => {
      handleInputChange(event);
    };

    /**
     * Debounced function to cache the prompt in cookies.
     * Caches the trimmed value of the textarea input after a delay to optimize performance.
     */
    const debouncedCachePrompt = useCallback(
      debounce((event: React.ChangeEvent<HTMLTextAreaElement>) => {
        const trimmedValue = event.target.value.trim();
        Cookies.set(PROMPT_COOKIE_KEY, trimmedValue, { expires: 30 });
      }, 1000),
      [],
    );

    useEffect(() => {
      const storedApiKeys = localStorage.getItem('apiKeys');

      if (storedApiKeys) {
        setApiKeys(JSON.parse(storedApiKeys));
      }
    }, []);

    const handleModelChange = (newModel: string) => {
      setModel(newModel);
      Cookies.set('selectedModel', newModel, { expires: 30 });
    };

    const handleProviderChange = (newProvider: ProviderInfo) => {
      setProvider(newProvider);
      Cookies.set('selectedProvider', newProvider.name, { expires: 30 });
    };

    const handleWebSearchResult = useCallback(
      (result: string) => {
        const currentInput = input || '';
        const newInput = currentInput.length > 0 ? `${result}\n\n${currentInput}` : result;

        // Update the input via the same mechanism as handleInputChange
        const syntheticEvent = {
          target: { value: newInput },
        } as React.ChangeEvent<HTMLTextAreaElement>;
        handleInputChange(syntheticEvent);
      },
      [input, handleInputChange],
    );

    const handleApprovePlan = useCallback(() => {
      if (!planSignal) {
        return;
      }

      enrichPlanSignalRef.current = false;

      const signalToExecute = { ...planSignal };
      setPlanSignal(null);
      handlePlanExecution(signalToExecute);
    }, [planSignal]);

    const handleRejectPlan = useCallback(() => {
      enrichPlanSignalRef.current = false;
      setPlanSignal(null);
      append({
        role: 'assistant',
        content: 'Plan execution was cancelled by the user.',
      });
    }, [append]);

    const handleModifyPlan = useCallback(
      (modifiedPoints: Array<{ title: string; description: string }>) => {
        if (!planSignal) {
          return;
        }

        enrichPlanSignalRef.current = false;

        const modifiedSignal = {
          ...planSignal,
          planPoints: modifiedPoints,
        };
        setPlanSignal(null);
        handlePlanExecution(modifiedSignal);
      },
      [planSignal],
    );

    return (
      <>
        <PlanApprovalDialog
          open={!!planSignal}
          signal={planSignal}
          planning={planLoading}
          onApprove={handleApprovePlan}
          onReject={handleRejectPlan}
          onModify={handleModifyPlan}
        />
        <BaseChat
          ref={animationScope}
          textareaRef={textareaRef}
          input={input}
          showChat={showChat}
          chatStarted={chatStarted}
          isStreaming={isLoading || fakeLoading}
          onStreamingChange={(streaming) => {
            streamingState.set(streaming);
          }}
          enhancingPrompt={enhancingPrompt}
          promptEnhanced={promptEnhanced}
          apiKeys={apiKeys}
          onApiKeysChange={onApiKeysChange}
          sendMessage={sendMessage}
          model={model}
          setModel={handleModelChange}
          provider={provider}
          setProvider={handleProviderChange}
          providerList={activeProviders}
          handleInputChange={(e) => {
            onTextareaChange(e);
            debouncedCachePrompt(e);
          }}
          handleStop={abort}
          description={description}
          importChat={importChat}
          exportChat={exportChat}
          messages={(messages || []).map((message, i) => {
            if (message.role === 'user') {
              return message;
            }

            // For assistant messages with parsed content, update the text part
            const parsedContent = parsedMessages[i] || '';

            if (parsedContent && Array.isArray(message.parts)) {
              return {
                ...message,
                parts: message.parts.map((part) => (part.type === 'text' ? { ...part, text: parsedContent } : part)),
              };
            }

            return message;
          })}
          enhancePrompt={() => {
            enhancePrompt(
              input,
              (input) => {
                setInput(input);
                scrollTextArea();
              },
              model,
              provider,
              apiKeys,
            );
          }}
          uploadedFiles={uploadedFiles}
          setUploadedFiles={setUploadedFiles}
          imageDataList={imageDataList}
          setImageDataList={setImageDataList}
          actionAlert={actionAlert}
          clearAlert={() => workbenchStore.clearAlert()}
          supabaseAlert={supabaseAlert}
          clearSupabaseAlert={() => workbenchStore.clearSupabaseAlert()}
          deployAlert={deployAlert}
          clearDeployAlert={() => workbenchStore.clearDeployAlert()}
          llmErrorAlert={llmErrorAlert}
          clearLlmErrorAlert={clearApiErrorAlert}
          data={undefined}
          chatMode={chatMode}
          setChatMode={setChatMode}
          isProjectChat={projectContinuation}
          append={append}
          reload={reload}
          designScheme={designScheme}
          setDesignScheme={setDesignScheme}
          selectedElement={selectedElement}
          setSelectedElement={setSelectedElement}
          addToolResult={

            // Adapt AI SDK v7 addToolResult signature to BaseChat's expected interface
            /*
             * BaseChat expects: ({ toolCallId, result }) => void
             * v7 provides: ({ tool, toolCallId, state, output }) => void
             */
            ({ toolCallId, result }: { toolCallId: string; result: any }) => {
              addToolResult({
                tool: 'unknown', // BaseChat doesn't track tool name
                toolCallId,
                output: result,
                state: 'output-available',
              });
            }
          }
          onWebSearchResult={handleWebSearchResult}
          planExecuting={planExecuting}
          planProgress={planProgress}
          planId={activePlanIdRef.current || undefined}
          onCancelPlan={() => {
            if (activePlanIdRef.current) {
              planStore.cancelPlan(activePlanIdRef.current);
            }
          }}
          onResumePlan={handleResumePlan}
        />
      </>
    );
  },
);
