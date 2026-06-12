import type { Message } from 'ai';
import type { SubChat, PlanPoint, ContextBundle, TokenUsage } from './types';
import type { FileMap } from '../.server/llm/constants';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('SubChatRunner');

// ─── Types ────────────────────────────────────────────────

/** Configuration embedded in the /api/chat request body to identify sub-chat executions. */
export interface SubChatConfig {
  planId: string;
  pointIndex: number;
  projectId: string;
  vectorContext: ContextBundle;
}

/** Internal type for the request body sent to /api/chat. */
interface ChatRequestBody {
  messages: Message[];
  files: FileMap;
  contextOptimization: boolean;
  chatMode: 'build' | 'discuss';
  maxLLMSteps: number;
  apiKeys?: Record<string, string>;
  subChatConfig?: SubChatConfig;
}

/**
 * SubChatRunner — Executes an isolated AI conversation for a plan point.
 *
 * Makes a fetch request to /api/chat (the existing endpoint) with
 * special subChatConfig to indicate this is a sub-chat execution.
 * The SSE stream is consumed and parsed into a structured SubChat result.
 */
export class SubChatRunner {
  /** Maximum number of LLM steps for a sub-chat (fewer than a full chat). */
  private readonly maxSubChatSteps = 5;

  /**
   * Run a sub-chat for a plan point.
   *
   * @param params.point - The plan point to execute
   * @param params.context - The context bundle from ContextBuilder
   * @param params.files - Current file map of the project
   * @param params.planId - Parent plan ID
   * @param params.projectId - Project ID
   * @param params.chatId - Parent chat ID
   * @param params.apiKeys - API keys for the LLM providers
   * @param params.providerSettings - Provider-specific settings
   * @param params.chatMode - Build or discuss mode
   * @returns The sub-chat with all messages and results
   */
  async run(params: {
    point: PlanPoint;
    context: ContextBundle;
    files: FileMap;
    planId: string;
    projectId: string;
    chatId: string;
    apiKeys: Record<string, string>;
    providerSettings: Record<string, any>;
    chatMode: 'build' | 'discuss';
  }): Promise<SubChat> {
    const {
      point,
      context,
      files,
      planId,
      projectId,
      chatId,
      apiKeys,
      chatMode,
    } = params;

    // 1. Create sub-chat ID
    const subChatId = crypto.randomUUID();

    // 2. Build the user message (the task the AI needs to accomplish)
    const userMessageText = this.buildPointMessage(point, context);

    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content: userMessageText,
      createdAt: new Date(),
    };

    // 3. Build messages array
    const messages: Message[] = [userMessage];

    // 4. Build the sub-chat config
    const subChatConfig: SubChatConfig = {
      planId,
      pointIndex: point.index,
      projectId,
      vectorContext: context,
    };

    // 5. Build request body
    const body: ChatRequestBody = {
      messages,
      files,
      contextOptimization: true,
      chatMode,
      maxLLMSteps: this.maxSubChatSteps,
      apiKeys,
      subChatConfig,
    };

    logger.info(
      `Running sub-chat for point ${point.index}: "${point.title}" (subChatId: ${subChatId})`,
    );

    const startedAt = new Date().toISOString();

    try {
      // 6. Call fetch('/api/chat', ...)
      const response = await fetch('/api/chat', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      });

      if (!response.ok) {
        const errorText = await response.text().catch(() => 'Unknown error');
        throw new Error(
          `/api/chat returned ${response.status}: ${errorText}`,
        );
      }

      // 7. Parse the streaming response (SSE)
      const { messages: resultMessages, tokenUsage, artifacts } =
        await this.parseStreamResponse(response, subChatId);

      // 8. Build the complete messages list (user + assistant)
      const allMessages: Message[] = [userMessage, ...resultMessages];

      logger.info(
        `Sub-chat completed: ${allMessages.length} messages, ${tokenUsage.totalTokens} tokens used`,
      );

      // 9. Return SubChat object
      return {
        id: subChatId,
        planId,
        pointIndex: point.index,
        projectId,
        messages: allMessages,
        contextUsed: context.retrievedIds,
        tokenUsage,
        startedAt,
        completedAt: new Date().toISOString(),
        artifacts,
      };
    } catch (err) {
      logger.error(`Sub-chat failed for point ${point.index}:`, err);

      // Return a failed sub-chat with the error in a message
      return {
        id: subChatId,
        planId,
        pointIndex: point.index,
        projectId,
        messages: [
          userMessage,
          {
            id: crypto.randomUUID(),
            role: 'assistant',
            content: `Sub-chat execution failed: ${err instanceof Error ? err.message : String(err)}`,
            createdAt: new Date(),
          },
        ],
        contextUsed: context.retrievedIds,
        tokenUsage: { promptTokens: 0, completionTokens: 0, totalTokens: 0 },
        startedAt,
        completedAt: new Date().toISOString(),
        artifacts: [],
      };
    }
  }

  /**
   * Build the user message for a sub-chat.
   * This is the "task" the AI needs to accomplish.
   */
  private buildPointMessage(point: PlanPoint, context: ContextBundle): string {
    const sections: string[] = [];

    // ── Task header ──
    sections.push(`## Task: ${point.title}\n`);
    sections.push(point.description);
    sections.push('');

    // ── Context sections (from vector stores) ──
    if (context.donts) {
      sections.push(context.donts);
      sections.push('');
    }

    if (context.projectContext) {
      sections.push(context.projectContext);
      sections.push('');
    }

    if (context.userProfile) {
      sections.push(context.userProfile);
      sections.push('');
    }

    // ── Required files ──
    if (point.requiredFiles.length > 0) {
      sections.push('<required_files>');
      sections.push('You MUST modify/create the following files:');
      for (const file of point.requiredFiles) {
        sections.push(`- ${file}`);
      }
      sections.push('</required_files>');
      sections.push('');
    }

    // ── Verification requirements ──
    if (point.verificationTypes.length > 0 && !point.verificationTypes.includes('none')) {
      sections.push('<verification_requirements>');
      sections.push('Your code will be verified against the following checks:');
      for (const vType of point.verificationTypes) {
        const descriptions: Record<string, string> = {
          lint: 'ESLint (code style and common errors)',
          'type-check': 'TypeScript type checking',
          'flow-verify': 'Button handlers and screen connectivity',
          custom: 'Custom project-specific checks',
        };
        sections.push(`- ${descriptions[vType] ?? vType}`);
      }
      sections.push('Ensure your code passes all required checks.');
      sections.push('</verification_requirements>');
      sections.push('');
    }

    // ── Execution instructions ──
    sections.push('<execution_instructions>');
    sections.push(
      'You are executing a plan point as part of a larger plan. ' +
      'Focus ONLY on completing the task described above. ' +
      'Follow all project constraints and patterns. ' +
      'Produce clean, working code that passes the specified verification checks.',
    );
    sections.push('</execution_instructions>');

    return sections.join('\n');
  }

  /**
   * Parse SSE stream from /api/chat and collect messages.
   *
   * Reads the full response body as text, parses SSE data lines,
   * and extracts text parts and annotations to build the assistant message.
   */
  private async parseStreamResponse(
    response: Response,
    _subChatId: string,
  ): Promise<{ messages: Message[]; tokenUsage: TokenUsage; artifacts: string[] }> {
    const text = await response.text();

    let assistantText = '';
    let promptTokens = 0;
    let completionTokens = 0;
    const artifacts: string[] = [];

    // Parse SSE data: lines
    // The Vercel AI SDK SSE format uses:
    //   data: {"type":"text","text":"..."}  for text content
    //   data: {"type":"tool-call","..."}    for tool calls
    //   data: {"type":"step-finish","..."}  for step completion with usage
    //   data: [DONE]                        for stream end
    const lines = text.split('\n');

    for (const line of lines) {
      const trimmed = line.trim();

      if (!trimmed.startsWith('data:')) {
        continue;
      }

      const dataStr = trimmed.slice(5).trim();

      // Skip [DONE] marker
      if (dataStr === '[DONE]') {
        continue;
      }

      try {
        const data = JSON.parse(dataStr);

        switch (data.type) {
          case 'text': {
            if (typeof data.text === 'string') {
              assistantText += data.text;
            }
            break;
          }
          case 'tool-call': {
            // Include tool calls as part of the assistant's text output
            if (data.toolName) {
              const toolArgs =
                typeof data.args === 'string'
                  ? data.args
                  : JSON.stringify(data.args, null, 2);
              assistantText += `\n[Tool: ${data.toolName}(${toolArgs})]\n`;
            }
            break;
          }
          case 'tool-result': {
            // Tool results — we track these as artifacts
            if (data.toolName) {
              artifacts.push(data.toolName);
            }
            break;
          }
          case 'step-finish': {
            // Extract token usage from step finish
            if (data.usage) {
              promptTokens += data.usage.promptTokens ?? 0;
              completionTokens += data.usage.completionTokens ?? 0;
            }
            break;
          }
          case 'finish': {
            // Final finish message may contain usage
            if (data.usage) {
              promptTokens += data.usage.promptTokens ?? 0;
              completionTokens += data.usage.completionTokens ?? 0;
            }
            break;
          }
        }
      } catch {
        // Skip lines that can't be parsed as JSON
        // Some SSE implementations send comments or empty data lines
        continue;
      }
    }

    // Build the assistant message
    const messages: Message[] = [];

    if (assistantText.trim()) {
      messages.push({
        id: crypto.randomUUID(),
        role: 'assistant',
        content: assistantText.trim(),
        createdAt: new Date(),
      });
    }

    const tokenUsage: TokenUsage = {
      promptTokens,
      completionTokens,
      totalTokens: promptTokens + completionTokens,
    };

    return { messages, tokenUsage, artifacts };
  }
}

export const subChatRunner = new SubChatRunner();
