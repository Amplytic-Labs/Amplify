import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { createDataStream, generateId } from 'ai';
import { MAX_RESPONSE_SEGMENTS, MAX_TOKENS, type FileMap } from '~/lib/.server/llm/constants';
import { CONTINUE_PROMPT } from '~/lib/common/prompts/new-prompt';
import { streamText, type Messages, type StreamingOptions } from '~/lib/.server/llm/stream-text';
import SwitchableStream from '~/lib/.server/llm/switchable-stream';
import type { IProviderSetting } from '~/types/model';
import { createScopedLogger } from '~/utils/logger';
import { getFilePaths, selectContext } from '~/lib/.server/llm/select-context';
import type { ContextAnnotation, ProgressAnnotation } from '~/types/context';
import { WORK_DIR } from '~/utils/constants';
import { createSummary } from '~/lib/.server/llm/create-summary';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { DesignScheme } from '~/types/design-scheme';
import { MCPService } from '~/lib/services/mcpService';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';
import { SkillLoader } from '~/lib/services/skillLoader';
import { memoryStore } from '~/lib/persistence/memoryStore';
import { stripAmplifyArtifactsWithSummary } from '~/lib/chat/artifact-stripper';

export async function action(args: ActionFunctionArgs) {
  return chatAction(args);
}

const logger = createScopedLogger('api.chat');

function parseCookies(cookieHeader: string): Record<string, string> {
  const cookies: Record<string, string> = {};

  const items = cookieHeader.split(';').map((cookie) => cookie.trim());

  items.forEach((item) => {
    const [name, ...rest] = item.split('=');

    if (name && rest) {
      const decodedName = decodeURIComponent(name.trim());
      const decodedValue = decodeURIComponent(rest.join('=').trim());
      cookies[decodedName] = decodedValue;
    }
  });

  return cookies;
}

/**
 * Strip `<amplifyArtifact>…</amplifyArtifact>` blocks from every message before
 * the messages are sent to the LLM (createSummary / selectContext / streamText).
 *
 * WHY: when a project is imported via git-clone / manual template picker, the
 * entire repo file contents are persisted as an assistant `message.content`
 * wrapped in `<amplifyArtifact>` (see GitUrlImport.client.tsx). The message
 * parser already consumed that artifact on first load and wrote the files into
 * the workbench — so the raw artifact text is dead weight from the model's
 * perspective. Re-sending it on every turn was bloating the prompt to ~273k
 * tokens and forcing `createSummary` to run every single message.
 *
 * This is SERVER-SIDE ONLY. Stored messages (IndexedDB) keep their full content
 * so the parser can re-hydrate the workbench on reload; only the copy that
 * crosses the wire to the model is stripped. The stripper is O(n) and a no-op
 * when no artifact markers are present, so it's cheap to run on every message
 * of every request.
 *
 * REPLACE, not delete: each artifact block is replaced with a concise one-line
 * summary (file paths + shell/start commands) so the model still knows the
 * workspace structure. This mirrors what the `inject_template` tool returns to
 * the model — a short summary, not the full file bodies. If the model needs
 * actual file contents it can use `list_dir` / `read_file` tools.
 */
function stripArtifactsFromMessages(messages: Messages): Messages {
  if (!Array.isArray(messages) || messages.length === 0) {
    return messages;
  }

  return messages.map((msg) => {
    if (!msg) {
      return msg;
    }

    const content = (msg as { content?: unknown }).content;

    // String content — the common case (git import, inject_template side-effect).
    if (typeof content === 'string') {
      const stripped = stripAmplifyArtifactsWithSummary(content);

      if (stripped === content) {
        return msg; // unchanged — avoid needless object copy
      }

      return { ...msg, content: stripped } as (typeof messages)[number];
    }

    // Array-of-parts content (AI SDK structured messages) — strip text parts only.
    if (Array.isArray(content)) {
      let changed = false;
      const newParts = content.map((part: unknown) => {
        if (
          part &&
          typeof part === 'object' &&
          (part as { type?: string }).type === 'text' &&
          typeof (part as { text?: string }).text === 'string'
        ) {
          const stripped = stripAmplifyArtifactsWithSummary((part as { text: string }).text);

          if (stripped !== (part as { text: string }).text) {
            changed = true;
            return { ...(part as object), text: stripped };
          }
        }

        return part;
      });

      if (!changed) {
        return msg;
      }

      return { ...msg, content: newParts } as unknown as (typeof messages)[number];
    }

    return msg;
  });
}

async function chatAction({ context, request }: ActionFunctionArgs) {
  const streamRecovery = new StreamRecoveryManager({
    timeout: 45000,
    maxRetries: 2,
    onTimeout: () => {
      logger.warn('Stream timeout - attempting recovery');
    },
  });

  const {
    messages,
    files,
    promptId,
    contextOptimization,
    supabase,
    chatMode,
    designScheme,
    maxLLMSteps,
    apiKeys: bodyApiKeys,
    userContext,
    projectContext,
    projectContinuation,
  } = await request.json<{
    messages: Messages;
    files: any;
    promptId?: string;
    contextOptimization: boolean;
    chatMode: 'discuss' | 'build';
    designScheme?: DesignScheme;
    supabase?: {
      isConnected: boolean;
      hasSelectedProject: boolean;
      credentials?: {
        anonKey?: string;
        supabaseUrl?: string;
      };
    };
    maxLLMSteps: number;
    apiKeys?: Record<string, string>;
    userContext?: string;
    projectContext?: string;
    projectContinuation?: boolean;
  }>();

  const cookieHeader = request.headers.get('Cookie');
  const apiKeys = bodyApiKeys || JSON.parse(parseCookies(cookieHeader || '').apiKeys || '{}');
  const providerSettings: Record<string, IProviderSetting> = JSON.parse(
    parseCookies(cookieHeader || '').providers || '{}',
  );

  const stream = new SwitchableStream();

  const cumulativeUsage = {
    completionTokens: 0,
    promptTokens: 0,
    totalTokens: 0,
  };
  const encoder: TextEncoder = new TextEncoder();
  let progressCounter: number = 1;

  try {
    const mcpService = MCPService.getInstance();
    const totalMessageContent = messages.reduce((acc, message) => acc + message.content, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    const lastChunk: string | undefined = undefined;

    const dataStream = createDataStream({
      async execute(dataStream) {
        streamRecovery.startMonitoring();

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        const processedMessages = stripArtifactsFromMessages(
          await mcpService.processToolInvocations(messages, dataStream, files),
        );

        if (processedMessages.length > 3) {
          messageSliceId = processedMessages.length - 3;
        }

        /*
         * Context optimization (createSummary + selectContext) is expensive —
         * each adds a blocking LLM round-trip before the first response token.
         * Running it on EVERY turn (even turn 1, with just 3 messages) made
         * responses feel sluggish. Now we only run it once the conversation
         * has enough history to actually benefit from a summary (8+ messages
         * ≈ 4 exchanges). Early turns get the full message history directly.
         */
        if (filePaths.length > 0 && contextOptimization && processedMessages.length > 8) {
          logger.debug('Generating Chat Summary');
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Analysing Request',
          } satisfies ProgressAnnotation);

          // Create a summary of the chat
          console.log(`Messages count: ${processedMessages.length}`);

          summary = await createSummary({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });
          dataStream.writeData({
            type: 'progress',
            label: 'summary',
            status: 'complete',
            order: progressCounter++,
            message: 'Analysis Complete',
          } satisfies ProgressAnnotation);

          dataStream.writeMessageAnnotation({
            type: 'chatSummary',
            summary,
            chatId: processedMessages.slice(-1)?.[0]?.id,
          } as ContextAnnotation);

          // Update context buffer
          logger.debug('Updating Context Buffer');
          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Determining Files to Read',
          } satisfies ProgressAnnotation);

          // Select context files
          console.log(`Messages count: ${processedMessages.length}`);
          filteredFiles = await selectContext({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            files,
            providerSettings,
            promptId,
            contextOptimization,
            summary,
            onFinish(resp) {
              if (resp.usage) {
                logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += resp.usage.completionTokens || 0;
                cumulativeUsage.promptTokens += resp.usage.promptTokens || 0;
                cumulativeUsage.totalTokens += resp.usage.totalTokens || 0;
              }
            },
          });

          if (filteredFiles) {
            logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
          }

          dataStream.writeMessageAnnotation({
            type: 'codeContext',
            files: Object.keys(filteredFiles).map((key) => {
              let path = key;

              if (path.startsWith(WORK_DIR)) {
                path = path.replace(WORK_DIR, '');
              }

              return path;
            }),
          } as ContextAnnotation);

          dataStream.writeData({
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: 'Code Files Selected',
          } satisfies ProgressAnnotation);

          // logger.debug('Code Files Selected');
        }

        const options: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: mcpService.toolsWithoutExecute,
          maxSteps: maxLLMSteps,
          onStepFinish: ({ toolCalls }) => {
            // add tool call annotations for frontend processing
            toolCalls.forEach((toolCall) => {
              mcpService.processToolCall(toolCall, dataStream);
            });
          },
          onFinish: async ({ text: content, finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              cumulativeUsage.completionTokens += usage.completionTokens || 0;
              cumulativeUsage.promptTokens += usage.promptTokens || 0;
              cumulativeUsage.totalTokens += usage.totalTokens || 0;
            }

            if (finishReason !== 'length') {
              dataStream.writeMessageAnnotation({
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              dataStream.writeData({
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              } satisfies ProgressAnnotation);
              await new Promise((resolve) => setTimeout(resolve, 0));

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            const lastUserMessage = processedMessages.filter((x) => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);
            processedMessages.push({ id: generateId(), role: 'assistant', content });
            processedMessages.push({
              id: generateId(),
              role: 'user',
              content: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}`,
            });

            const result = await streamText({
              messages: [...processedMessages],
              env: context.cloudflare?.env,
              options,
              apiKeys,
              files,
              providerSettings,
              promptId,
              contextOptimization,
              contextFiles: filteredFiles,
              chatMode,
              designScheme,
              summary,
              messageSliceId,
              dataStream,
              skills,
              memory,
              userContext,
              projectContext,
              projectContinuation,
            });

            result.mergeIntoDataStream(dataStream, { sendReasoning: true });

            (async () => {
              for await (const part of result.fullStream) {
                if (part.type === 'error') {
                  const error: any = part.error;
                  logger.error(`${error}`);

                  return;
                }
              }
            })();

            return;
          },
        };

        dataStream.writeData({
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        } satisfies ProgressAnnotation);

        // Load skills and memory for prompt injection
        const skillLoader = SkillLoader.getInstance();
        const skills = skillLoader.getRelevantSkills();
        const memory = memoryStore.formatForPrompt();

        const result = await streamText({
          messages: [...processedMessages],
          env: context.cloudflare?.env,
          options,
          apiKeys,
          files,
          providerSettings,
          promptId,
          contextOptimization,
          contextFiles: filteredFiles,
          chatMode,
          designScheme,
          summary,
          messageSliceId,
          dataStream,
          skills,
          memory,
          userContext,
          projectContext,
          projectContinuation,
        });

        (async () => {
          for await (const part of result.fullStream) {
            streamRecovery.updateActivity();

            if (part.type === 'error') {
              const error: any = part.error;
              logger.error('Streaming error:', error);
              streamRecovery.stop();

              // Enhanced error handling for common streaming issues
              if (error.message?.includes('Invalid JSON response')) {
                logger.error('Invalid JSON response detected - likely malformed API response');
              } else if (error.message?.includes('token')) {
                logger.error('Token-related error detected - possible token limit exceeded');
              }

              return;
            }
          }
          streamRecovery.stop();
        })();
        result.mergeIntoDataStream(dataStream, { sendReasoning: true });
      },
      onError: (error: any) => {
        // Provide more specific error messages for common issues
        const rawMessage = error?.message || 'Unknown error';

        /*
         * Detect HTML error pages (e.g. z.ai ALB 502/503/504 pages).
         * These surface as the raw HTML body and are useless/confusing
         * to show to the user. Replace with a clean, actionable message.
         */
        const looksLikeHtml =
          rawMessage.includes('<html') ||
          rawMessage.includes('<head>') ||
          rawMessage.includes('<title>') ||
          rawMessage.includes('<center>');

        const htmlStatusMatch = rawMessage.match(
          /(\d{3})\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error)/i,
        );

        if (looksLikeHtml) {
          const statusCode = htmlStatusMatch?.[1] || '5xx';
          return `Custom error: The AI service returned a ${statusCode} error (the provider's load balancer is temporarily unavailable). It was retried automatically but still failed. Please try again in a moment.`;
        }

        const errorMessage = rawMessage;

        if (errorMessage.includes('model') && errorMessage.includes('not found')) {
          return 'Custom error: Invalid model selected. Please check that the model name is correct and available.';
        }

        if (errorMessage.includes('Invalid JSON response')) {
          return 'Custom error: The AI service returned an invalid response. This may be due to an invalid model name, API rate limiting, or server issues. Try selecting a different model or check your API key.';
        }

        if (
          errorMessage.includes('API key') ||
          errorMessage.includes('unauthorized') ||
          errorMessage.includes('authentication')
        ) {
          return 'Custom error: Invalid or missing API key. Please check your API key configuration.';
        }

        if (errorMessage.includes('token') && errorMessage.includes('limit')) {
          return 'Custom error: Token limit exceeded. The conversation is too long for the selected model. Try using a model with larger context window or start a new conversation.';
        }

        if (errorMessage.includes('rate limit') || errorMessage.includes('429')) {
          return 'Custom error: API rate limit exceeded. Please wait a moment before trying again.';
        }

        if (errorMessage.includes('network') || errorMessage.includes('timeout')) {
          return 'Custom error: Network error. Please check your internet connection and try again.';
        }

        /*
         * Catch-all: if the error message is very long (likely a raw HTML
         * page or stack trace), truncate it so the UI doesn't break.
         */
        if (errorMessage.length > 300) {
          return `Custom error: ${errorMessage.slice(0, 300)}…`;
        }

        return `Custom error: ${errorMessage}`;
      },
    });

    return new Response(dataStream.pipeThrough(new TextEncoderStream()), {
      status: 200,
      headers: {
        'Content-Type': 'text/event-stream; charset=utf-8',
        Connection: 'keep-alive',
        'Cache-Control': 'no-cache',
        'Text-Encoding': 'chunked',
      },
    });
  } catch (error: any) {
    logger.error(error);

    /*
     * Sanitize HTML error pages (e.g. z.ai ALB 502/503/504) so the raw
     * HTML never reaches the client.
     */
    let message = error?.message || 'An unexpected error occurred';

    if (
      typeof message === 'string' &&
      (message.includes('<html') || message.includes('<head>') || message.includes('<title>'))
    ) {
      const statusMatch = message.match(
        /(\d{3})\s+(?:Bad Gateway|Service Unavailable|Gateway Timeout|Internal Server Error)/i,
      );
      message = `The AI service returned a ${statusMatch?.[1] || '5xx'} error (temporarily unavailable). Please try again in a moment.`;
    } else if (typeof message === 'string' && message.length > 300) {
      message = message.slice(0, 300) + '…';
    }

    const errorResponse = {
      error: true,
      message,
      statusCode: error.statusCode || 500,
      isRetryable: error.isRetryable !== false, // Default to retryable unless explicitly false
      provider: error.provider || 'unknown',
    };

    if (error.message?.includes('API key')) {
      return new Response(
        JSON.stringify({
          ...errorResponse,
          message: 'Invalid or missing API key',
          statusCode: 401,
          isRetryable: false,
        }),
        {
          status: 401,
          headers: { 'Content-Type': 'application/json' },
          statusText: 'Unauthorized',
        },
      );
    }

    return new Response(JSON.stringify(errorResponse), {
      status: errorResponse.statusCode,
      headers: { 'Content-Type': 'application/json' },
      statusText: 'Error',
    });
  }
}
