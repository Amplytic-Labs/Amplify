import { useStore } from '@nanostores/react';
import type { Message } from 'ai';
import { useChat } from '@ai-sdk/react';
import { useAnimate } from 'framer-motion';
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
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

const logger = createScopedLogger('Chat');

export function Chat() {
  renderLogger.trace('Chat');

  const { ready, initialMessages, storeMessageHistory, importChat, exportChat } = useChatHistory();
  const title = useStore(description);
  useEffect(() => {
    workbenchStore.setReloadedMessages(initialMessages.map((m) => m.id));
  }, [initialMessages]);

  return (
    <>
      {ready && (
        <ChatImpl
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
    messages: Message[];
    initialMessages: Message[];
    isLoading: boolean;
    parseMessages: (messages: Message[], isLoading: boolean) => void;
    storeMessageHistory: (messages: Message[]) => Promise<void>;
  }) => {
    const { messages, initialMessages, isLoading, parseMessages, storeMessageHistory } = options;
    parseMessages(messages, isLoading);

    if (messages.length > initialMessages.length) {
      storeMessageHistory(messages).catch((error) => toast.error(error.message));
    }
  },
  50,
);

interface ChatProps {
  initialMessages: Message[];
  storeMessageHistory: (messages: Message[]) => Promise<void>;
  importChat: (description: string, messages: Message[]) => Promise<void>;
  exportChat: () => void;
  description?: string;
}

export const ChatImpl = memo(
  ({ description, initialMessages, storeMessageHistory, importChat, exportChat }: ChatProps) => {
    useShortcuts();

    const textareaRef = useRef<HTMLTextAreaElement>(null);
    const [chatStarted, setChatStarted] = useState(initialMessages.length > 0);
    const [uploadedFiles, setUploadedFiles] = useState<File[]>([]);
    const [imageDataList, setImageDataList] = useState<string[]>([]);
    const [searchParams, setSearchParams] = useSearchParams();
    const [fakeLoading, setFakeLoading] = useState(false);
    const files = useStore(workbenchStore.files);
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

    // Plan execution state
    const [planExecuting, setPlanExecuting] = useState(false);
    const [planProgress, setPlanProgress] = useState<PlanProgressUpdate | null>(null);
    const activePlanIdRef = useRef<string | null>(null);
    const [planSignal, setPlanSignal] = useState<any>(null);

    // Stable debug fetch instance – intercepts /api/chat requests for the debug page
    const debugFetch = useMemo(() => createDebugFetch(), []);

    const {
      messages,
      isLoading,
      input,
      handleInputChange,
      setInput,
      stop,
      append,
      setMessages,
      reload,
      error,
      data: chatData,
      setData,
      addToolResult,
    } = useChat({
      api: '/api/chat',
      fetch: debugFetch,
      body: {
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
        projectContext: vectorProjectContext || undefined,
      },
      sendExtraMessageFields: true,
      /*
       * Enable client-side multi-step continuation. Without this, calling
       * `addToolResult` (used for native-tool auto-approve + mutating-tool
       * approval) would only update local state and NEVER send the result
       * back to the server — so the server-side `execute` would never run
       * and tools would appear to "do nothing". With maxSteps set, the AI
       * SDK automatically fires a follow-up /api/chat request carrying the
       * tool result, `processToolInvocations` runs the real execute, and
       * the actual result is streamed back. Mirrors the server's maxLLMSteps.
       */
      maxSteps: mcpSettings.maxLLMSteps,
      onError: (e) => {
        setFakeLoading(false);
        handleError(e, 'chat');
      },
      onFinish: (message, response) => {
        const usage = response.usage;
        setData(undefined);

        if (usage) {
          logStore.logProvider('Chat response completed', {
            component: 'Chat',
            action: 'response',
            model,
            provider: provider.name,
            usage,
            messageLength: message.content.length,
          });
        }

        logger.debug('Finished streaming');

        // M-1 fix: Auto-extract user facts and project context after each AI response
        const lastUserMsg = messages.filter((m) => m.role === 'user').pop();

        if (lastUserMsg?.content) {
          import('~/lib/hooks/useVectorContext')
            .then(({ extractAndStoreUserFacts, extractAndStoreProjectContext }) => {
              extractAndStoreUserFacts(lastUserMsg.content, message.content).catch(() => {});

              const currentChatId = import('~/lib/persistence/useChatHistory').then(({ chatId }) => {
                const cid = chatId.get();

                if (cid) {
                  const project = projectStore.getProjectByChat(cid);

                  if (project) {
                    extractAndStoreProjectContext(
                      project.id,
                      `Implemented: ${message.content.slice(0, 200)}`,
                      'conversation_summary',
                    ).catch(() => {});
                  }
                }
              });
            })
            .catch(() => {});
        }
      },
      initialMessages,
      initialInput: Cookies.get(PROMPT_COOKIE_KEY) || '',
    });
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

    useEffect(() => {
      chatStore.setKey('started', initialMessages.length > 0);
    }, []);

    useEffect(() => {
      processSampledMessages({
        messages,
        initialMessages,
        isLoading,
        parseMessages,
        storeMessageHistory,
      });
    }, [messages, isLoading, parseMessages]);

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
          const userMessages = messages.filter((m) => m.role === 'user');
          const lastMsg = userMessages[userMessages.length - 1]?.content || '';

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
    }, [messages.length]);

    // Detect execute_plan signal from AI responses and show approval dialog
    useEffect(() => {
      const lastAssistantMessage = messages.filter((m) => m.role === 'assistant').pop();

      if (!lastAssistantMessage?.content) {
        return;
      }

      const content = lastAssistantMessage.content.trim();

      /*
       * M-4 fix: Check for the signal marker before attempting JSON.parse
       * to avoid wasting cycles parsing normal conversational text.
       */
      if (!content.startsWith('{') || !content.includes('execute_plan_signal')) {
        return;
      }

      try {
        const signal = JSON.parse(content);

        if (signal.type === 'execute_plan_signal' && !planExecuting && !planSignal) {
          setPlanSignal(signal);
        }
      } catch {
        // Starts with { but isn't valid JSON — ignore
      }
    }, [messages, planExecuting, planSignal]);

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
      const lastAssistant = messages.filter((m) => m.role === 'assistant').pop();

      if (!lastAssistant) {
        return;
      }

      /*
       * Tool invocations can live either on `toolInvocations` (legacy) or
       * inside `parts` (current ai-sdk shape). Check both.
       */
      const allInvocations: any[] = [];

      if (Array.isArray((lastAssistant as any).parts)) {
        for (const p of (lastAssistant as any).parts) {
          if (p?.type === 'tool-invocation' && p?.toolInvocation) {
            allInvocations.push(p.toolInvocation);
          }
        }
      }

      if (Array.isArray((lastAssistant as any).toolInvocations)) {
        allInvocations.push(...(lastAssistant as any).toolInvocations);
      }

      for (const inv of allInvocations) {
        if (inv.state !== 'result') {
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

        if (!result.includes('open_claude_file_mutation')) {
          continue;
        }

        let parsed: any = null;

        try {
          parsed = JSON.parse(result);
        } catch {
          continue;
        }

        if (!parsed || parsed.type !== 'open_claude_file_mutation' || !Array.isArray(parsed.operations)) {
          continue;
        }

        processedMutationToolCallIdsRef.current.add(toolCallId);

        // Fire-and-forget — apply each operation in order
        (async () => {
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
     * ───────────────────────────────────────────────────────────────────
     */
    const autoApprovedToolCallIdsRef = useRef<Set<string>>(new Set());

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
          if (!p || p.type !== 'tool-invocation' || !p.toolInvocation) {
            continue;
          }

          const inv = p.toolInvocation as any;

          if (inv.state !== 'call') {
            continue;
          }

          if (!isReadOnlyNativeTool(inv.toolName)) {
            continue;
          }

          if (autoApprovedToolCallIdsRef.current.has(inv.toolCallId)) {
            continue;
          }

          autoApprovedToolCallIdsRef.current.add(inv.toolCallId);
          logger.debug(`[auto-approve] ${inv.toolName} (${inv.toolCallId})`);
          addToolResult({
            toolCallId: inv.toolCallId,
            result: TOOL_EXECUTION_APPROVAL.APPROVE,
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

        // Create the plan in the store (M-5 fix: use async version to ensure IDB is loaded)
        const plan = await planStore.createPlanAsync({
          projectId: project.id,
          chatId: currentChatId || '',
          userRequest: signal.taskDescription,
          description: signal.taskDescription,
          points: signal.planPoints.map((p: any, i: number) => ({
            title: p.title,
            description: p.description,
            order: i,
            expectedFiles: p.expectedFiles || [],
            verificationChecks: ['lint', 'type_check', 'flow_verification'] as any[],
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

        const fullSystemPrompt = getSystemPrompt({
          cwd: '/home/project',
          allowedHtmlElements: [] as any[],
          modificationTagName: 'boltArtifact',
          skills,
          memory,
          userContext: currentUserContext,
          projectContext: currentProjectContext,
        });

        // Get tool execution results from recent messages (simplified extraction)
        const toolResults = messages
          .filter((m) => m.role === 'assistant' && m.toolInvocations)
          .flatMap((m) =>
            (m.toolInvocations || []).map(
              (ti: any) => `${ti.toolName}: ${JSON.stringify(ti.result || {}).slice(0, 300)}`,
            ),
          )
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
                userContext: vectorUserContext || '',
                projectContext: vectorProjectContext || '',
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
        setData([]);
      },
      [provider.name, stop],
    );

    const clearApiErrorAlert = useCallback(() => {
      setLlmErrorAlert(undefined);
    }, []);

    useEffect(() => {
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

      window.addEventListener('bolt:quote-text', handleQuoteText);
      return () => window.removeEventListener('bolt:quote-text', handleQuoteText);
    }, [input, handleInputChange]);

    const runAnimation = async () => {
      if (chatStarted) {
        return;
      }

      setChatStarted(true);
      chatStore.setKey('started', true);

      await Promise.all([
        animate('#examples', { opacity: 0, display: 'none' }, { duration: 0.1 }),
        animate('#intro', { opacity: 0, flex: 1 }, { duration: 0.2, ease: cubicEasingFn }),
      ]);
    };

    // Helper function to create message parts array from text and images
    const createMessageParts = (text: string, images: string[] = []): Array<TextUIPart | FileUIPart> => {
      // Create an array of properly typed message parts
      const parts: Array<TextUIPart | FileUIPart> = [
        {
          type: 'text',
          text,
        },
      ];

      // Add image parts if any
      images.forEach((imageData) => {
        // Extract correct MIME type from the data URL
        const mimeType = imageData.split(';')[0].split(':')[1] || 'image/jpeg';

        // Create file part according to AI SDK format
        parts.push({
          type: 'file',
          mimeType,
          data: imageData.replace(/^data:image\/[^;]+;base64,/, ''),
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

        const elementInfo = `<div class=\"__boltSelectedElement__\" data-element='${JSON.stringify(selectedElement)}'>${JSON.stringify(`${selectedElement.displayText}`)}</div>`;
        finalMessageContent = messageContent + elementInfo;
      }

      runAnimation();

      if (!chatStarted) {
        setFakeLoading(true);

        // If autoSelectTemplate is disabled or template selection failed, proceed with normal message
        const userMessageText = `[Model: ${model}]\n\n[Provider: ${provider.name}]\n\n${finalMessageContent}`;
        const attachments = uploadedFiles.length > 0 ? await filesToAttachments(uploadedFiles) : undefined;

        setMessages([
          {
            id: `${new Date().getTime()}`,
            role: 'user',
            content: userMessageText,
            parts: createMessageParts(userMessageText, imageDataList),
            experimental_attachments: attachments,
          },
        ]);
        reload(attachments ? { experimental_attachments: attachments } : undefined);
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

      const signalToExecute = { ...planSignal };
      setPlanSignal(null);
      handlePlanExecution(signalToExecute);
    }, [planSignal]);

    const handleRejectPlan = useCallback(() => {
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
          messages={messages.map((message, i) => {
            if (message.role === 'user') {
              return message;
            }

            return {
              ...message,
              content: parsedMessages[i] || '',
            };
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
          data={chatData}
          chatMode={chatMode}
          setChatMode={setChatMode}
          append={append}
          designScheme={designScheme}
          setDesignScheme={setDesignScheme}
          selectedElement={selectedElement}
          setSelectedElement={setSelectedElement}
          addToolResult={addToolResult}
          onWebSearchResult={handleWebSearchResult}
          planExecuting={planExecuting}
          planProgress={planProgress}
          planId={activePlanIdRef.current || undefined}
          onCancelPlan={() => {
            if (activePlanIdRef.current) {
              planStore.cancelPlan(activePlanIdRef.current);
            }
          }}
        />
      </>
    );
  },
);
