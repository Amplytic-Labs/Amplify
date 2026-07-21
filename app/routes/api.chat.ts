import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import {
  createUIMessageStream,
  createUIMessageStreamResponse,
  generateId,
  isStepCount,
  type UIMessage,
  type UIMessageStreamWriter,
} from 'ai';
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
import { getModelContextInfo, shouldSummarize } from '~/lib/.server/llm/context-budget';
import { extractPropertiesFromMessage } from '~/lib/.server/llm/utils';
import type { DesignScheme } from '~/types/design-scheme';
import { MCPService } from '~/lib/services/mcpService';
import { StreamRecoveryManager } from '~/lib/.server/llm/stream-recovery';
import { SkillLoader } from '~/lib/services/skillLoader';
import { memoryStore } from '~/lib/persistence/memoryStore';

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
 * Helper to write a progress data chunk via the UIMessageStreamWriter.
 * Replaces the old dataStream.writeData({ type: 'progress', ... }) pattern.
 */
function writeProgress(writer: UIMessageStreamWriter, annotation: ProgressAnnotation) {
  writer.write({ type: 'data-progress' as const, data: annotation });
}

/**
 * Helper to write a message annotation data chunk via the UIMessageStreamWriter.
 * Replaces the old dataStream.writeMessageAnnotation({ ... }) pattern.
 */
function writeAnnotation(writer: UIMessageStreamWriter, annotation: Record<string, any>) {
  writer.write({ type: 'data-annotation' as const, data: annotation });
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
    modelConfig,
    rateLimit,
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

    /*
     * Unified thinking/reasoning config — translated into per-provider
     * providerOptions inside stream-text.ts (see buildThinkingProviderOptions).
     */
    modelConfig?: {
      thinkingEnabled: boolean;
      budgetTokens: number;
      effort: 'low' | 'medium' | 'high';
      maxOutputTokens: number;
    };

    /*
     * Per-provider rate-limit config — used for pre-flight TPM check
     * and RPM throttle inside stream-text.ts.
     */
    rateLimit?: {
      rpm: number;
      tpm: number;
      rpd: number;
      autoShrinkToTpm: boolean;
    };
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
    const totalMessageContent = messages.reduce((acc, message) => {
      // UIMessage uses parts array, not content string
      const textParts = message.parts?.filter((p: any) => p.type === 'text') || [];
      const text = textParts.map((p: any) => p.text || '').join('');

      return acc + text;
    }, '');
    logger.debug(`Total message length: ${totalMessageContent.split(' ').length}, words`);

    const lastChunk: string | undefined = undefined;

    const uiStream = createUIMessageStream({
      async execute({ writer }) {
        streamRecovery.startMonitoring();

        const filePaths = getFilePaths(files || {});
        let filteredFiles: FileMap | undefined = undefined;
        let summary: string | undefined = undefined;
        let messageSliceId = 0;

        const processedMessages = await mcpService.processToolInvocations(messages as UIMessage[], writer, files);

        /*
         * Context-length-based summarization gate.
         *
         * Previously this fired on EVERY turn (or with a fixed "> 8 messages"
         * threshold), which was both too aggressive (slow responses on short
         * conversations) and too lenient (a single huge pasted file could
         * overflow a 16k-context model on turn 2 without triggering).
         *
         * Now we estimate the conversation's token footprint and only run
         * createSummary when it approaches the CURRENT MODEL's actual context
         * window (maxTokenAllowed, from ModelInfo). The system prompt + file
         * paths survive summarization (they're rebuilt fresh each turn); only
         * earlier chat messages get collapsed into a CHAT SUMMARY block.
         */
        const contextInfo = await getModelContextInfo(processedMessages, {
          apiKeys,
          providerSettings,
          serverEnv: context.cloudflare?.env as any,
        });

        const summarizeDecision = shouldSummarize(
          processedMessages,
          contextInfo,
          contextOptimization,
          filePaths.length > 0,
        );

        messageSliceId = summarizeDecision.messageSliceId;

        logger.debug(
          `Context budget: ~${summarizeDecision.estimatedTokens} tokens / ${contextInfo.usableBudget} usable ` +
            `(model ${contextInfo.model}@${contextInfo.provider}, ctx ${contextInfo.maxTokenAllowed}, ` +
            `trigger at ${contextInfo.summarizationTrigger}) — summarize: ${summarizeDecision.shouldRun}`,
        );

        if (summarizeDecision.shouldRun) {
          logger.debug('Generating Chat Summary (context budget approaching limit)');
          writeProgress(writer, {
            type: 'progress',
            label: 'summary',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Condensing conversation to fit context window…',
          });

          // Create a summary of the chat
          console.log(`Messages count: ${processedMessages.length}, est tokens: ${summarizeDecision.estimatedTokens}`);

          summary = await createSummary({
            messages: [...processedMessages],
            env: context.cloudflare?.env,
            apiKeys,
            providerSettings,
            promptId,
            contextOptimization,

            // AI SDK v7: use onFinish instead of onEnd
            onFinish(resp: any) {
              if (resp.usage) {
                const u = resp.usage as any;
                logger.debug('createSummary token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += u.completionTokens || u.outputTokens || 0;
                cumulativeUsage.promptTokens += u.promptTokens || u.inputTokens || 0;
                cumulativeUsage.totalTokens +=
                  u.totalTokens || cumulativeUsage.completionTokens + cumulativeUsage.promptTokens;
              }
            },
          });
          writeProgress(writer, {
            type: 'progress',
            label: 'summary',
            status: 'complete',
            order: progressCounter++,
            message: 'Conversation condensed',
          });

          writeAnnotation(writer, {
            type: 'chatSummary',
            summary,
            chatId: processedMessages.slice(-1)?.[0]?.id,
          } as ContextAnnotation);

          // Update context buffer
          logger.debug('Updating Context Buffer');
          writeProgress(writer, {
            type: 'progress',
            label: 'context',
            status: 'in-progress',
            order: progressCounter++,
            message: 'Selecting relevant workspace files…',
          });

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

            // AI SDK v7: use onFinish instead of onEnd
            onFinish(resp: any) {
              if (resp.usage) {
                const u = resp.usage as any;
                logger.debug('selectContext token usage', JSON.stringify(resp.usage));
                cumulativeUsage.completionTokens += u.completionTokens || u.outputTokens || 0;
                cumulativeUsage.promptTokens += u.promptTokens || u.inputTokens || 0;
                cumulativeUsage.totalTokens +=
                  u.totalTokens || cumulativeUsage.completionTokens + cumulativeUsage.promptTokens;
              }
            },
          });

          if (filteredFiles) {
            logger.debug(`files in context : ${JSON.stringify(Object.keys(filteredFiles))}`);
          }

          writeAnnotation(writer, {
            type: 'codeContext',
            files: Object.keys(filteredFiles).map((key) => {
              let path = key;

              if (path.startsWith(WORK_DIR)) {
                path = path.replace(WORK_DIR, '');
              }

              return path;
            }),
          } as ContextAnnotation);

          writeProgress(writer, {
            type: 'progress',
            label: 'context',
            status: 'complete',
            order: progressCounter++,
            message: 'Code Files Selected',
          });

          // logger.debug('Code Files Selected');
        }

        const options: StreamingOptions = {
          supabaseConnection: supabase,
          toolChoice: 'auto',
          tools: mcpService.toolsWithoutExecute,
          stopWhen: isStepCount(maxLLMSteps),
          onStepEnd: ({ toolCalls }) => {
            // add tool call annotations for frontend processing
            toolCalls.forEach((toolCall: any) => {
              mcpService.processToolCall(toolCall, writer);
            });
          },
          onEnd: async ({ text: content, finishReason, usage }) => {
            logger.debug('usage', JSON.stringify(usage));

            if (usage) {
              const usageAny = usage as any;
              cumulativeUsage.completionTokens += usageAny.completionTokens || usageAny.outputTokens || 0;
              cumulativeUsage.promptTokens += usageAny.promptTokens || usageAny.inputTokens || 0;
              cumulativeUsage.totalTokens +=
                usageAny.totalTokens || cumulativeUsage.completionTokens + cumulativeUsage.promptTokens;
            }

            if (finishReason !== 'length') {
              writeAnnotation(writer, {
                type: 'usage',
                value: {
                  completionTokens: cumulativeUsage.completionTokens,
                  promptTokens: cumulativeUsage.promptTokens,
                  totalTokens: cumulativeUsage.totalTokens,
                },
              });
              writeProgress(writer, {
                type: 'progress',
                label: 'response',
                status: 'complete',
                order: progressCounter++,
                message: 'Response Generated',
              });
              await new Promise((resolve) => setTimeout(resolve, 0));

              // stream.close();
              return;
            }

            if (stream.switches >= MAX_RESPONSE_SEGMENTS) {
              throw Error('Cannot continue message: Maximum segments reached');
            }

            const switchesLeft = MAX_RESPONSE_SEGMENTS - stream.switches;

            logger.info(`Reached max token limit (${MAX_TOKENS}): Continuing message (${switchesLeft} switches left)`);

            const lastUserMessage = processedMessages.filter((x: any) => x.role == 'user').slice(-1)[0];
            const { model, provider } = extractPropertiesFromMessage(lastUserMessage);
            processedMessages.push({
              id: generateId(),
              role: 'assistant' as const,
              parts: [{ type: 'text' as const, text: content }],
            });
            processedMessages.push({
              id: generateId(),
              role: 'user' as const,
              parts: [
                { type: 'text' as const, text: `[Model: ${model}]\n\n[Provider: ${provider}]\n\n${CONTINUE_PROMPT}` },
              ],
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
              dataStream: writer,
              skills,
              memory,
              userContext,
              projectContext,
              projectContinuation,
              modelConfig,
              rateLimit,
            });

            writer.merge(result.toUIMessageStream({ sendReasoning: true }));

            (async () => {
              for await (const part of result.stream) {
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

        writeProgress(writer, {
          type: 'progress',
          label: 'response',
          status: 'in-progress',
          order: progressCounter++,
          message: 'Generating Response',
        });

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
          dataStream: writer,
          skills,
          memory,
          userContext,
          projectContext,
          projectContinuation,
          modelConfig,
          rateLimit,
        });

        (async () => {
          for await (const part of result.stream) {
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
        writer.merge(result.toUIMessageStream({ sendReasoning: true }));
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

    /*
     * AI SDK v7: createUIMessageStream() returns a ReadableStream<UIMessageChunk>
     * containing JavaScript objects. These MUST be serialized to SSE format
     * ("data: {...}\n\n") before sending to the client. The old code piped
     * the object stream directly through TextEncoderStream, which silently
     * failed because TextEncoderStream can only encode strings, not objects.
     *
     * createUIMessageStreamResponse() handles the correct pipeline:
     *   1. JsonToSseTransformStream  → objects → SSE text lines
     *   2. TextEncoderStream         → text → bytes
     *   3. Sets correct headers (including x-vercel-ai-ui-message-stream: v1)
     */
    return createUIMessageStreamResponse({ stream: uiStream });
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
