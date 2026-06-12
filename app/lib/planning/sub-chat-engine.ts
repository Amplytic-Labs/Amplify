/**
 * Sub-Chat Execution Engine
 *
 * Executes each PlanPoint as an independent sub-chat.
 * Sub-chats are treated as normal chats — they receive the full system prompt,
 * optional app builder capabilities prompt, and contextual injections.
 * No custom "step" prompts are used; the plan point description is the user message.
 *
 * After each sub-chat completes:
 * 1. Extracts key information and stores it in the ProjectContextVectorStore
 * 2. Runs verification (lint, type-check, flow check)
 * 3. If verification fails, sends the errors back to the sub-chat for fixing
 * 4. Marks the point as completed or failed
 * 5. Moves to the next point
 *
 * The user sees only a progress indicator in the main chat.
 * When all points complete, a summary is returned to the main chat.
 */

import type {
  Plan,
  PlanPoint,
  SubChat,
  SubChatMessage,
  ToolInvocationRecord,
  VerificationResult,
} from './types';
import { planStore } from './plan-store';
import { projectContextStore } from '~/lib/vector-store/project-context-store';
import { userProfileStore } from '~/lib/vector-store/user-profile-store';
import { runVerification } from '~/lib/verification/runner';
import type { Message } from 'ai';

export interface SubChatExecutionOptions {
  /**
   * The function to call the LLM (streaming).
   * This should be the same function used for the main chat.
   */
  callLLM: (messages: SubChatMessage[], systemPrompt: string) => Promise<SubChatMessage>;

  /**
   * Function to run shell commands in WebContainer.
   */
  runShellCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /**
   * Function to read a file from the workbench.
   */
  readFile: (path: string) => Promise<string | null>;

  /**
   * Function to write a file to the workbench.
   */
  writeFile: (path: string, content: string) => Promise<void>;

  /**
   * Function to get the current list of files in the workbench.
   */
  listFiles: () => Promise<string[]>;

  /**
   * Abort signal for cancellation.
   */
  signal?: AbortSignal;

  /**
   * Callback for progress updates (sent to the main chat UI).
   */
  onProgress?: (update: PlanProgressUpdate) => void;

  /**
   * The FULL system prompt from getSystemPrompt() — the same one used in the main chat.
   */
  systemPrompt: string;

  /**
   * The full app builder capabilities prompt (from getAppBuilderCapabilities()).
   * Optional because not all sub-chats need file creation capabilities.
   */
  appBuilderPrompt?: string;

  /**
   * String containing tool execution results from the main chat that are
   * relevant to the plan points.
   */
  toolExecutionResults: string;

  /**
   * The current chat ID.
   */
  chatId: string;

  /**
   * The current project ID.
   */
  projectId: string;
}

export interface PlanProgressUpdate {
  type: 'point_start' | 'point_complete' | 'point_failed' | 'verification_start' | 'verification_result' | 'plan_complete' | 'context_extracted' | 'error';
  planId: string;
  pointId?: string;
  pointTitle?: string;
  message: string;
  details?: any;
}

/**
 * Executes an entire plan by running each point as a sub-chat.
 */
export async function executePlan(
  plan: Plan,
  options: SubChatExecutionOptions,
): Promise<{ success: boolean; summary: string; failedPoints: string[] }> {
  planStore.updatePlanStatus(plan.id, 'executing');
  planStore.setAbortController(new AbortController());

  const failedPoints: string[] = [];
  let planSummary = '';

  for (const point of plan.points) {
    // Check for cancellation
    if (options.signal?.aborted) {
      planStore.updatePlanStatus(plan.id, 'cancelled');
      return { success: false, summary: 'Plan cancelled by user.', failedPoints };
    }

    // Check dependencies
    if (point.status === 'skipped') continue;

    const depFailed = point.dependencies.some((depId) => {
      const dep = plan.points.find((p) => p.id === depId);
      return dep && (dep.status === 'failed' || dep.status === 'skipped');
    });
    if (depFailed) {
      planStore.updatePlanPoint(plan.id, point.id, { status: 'skipped', completedAt: new Date().toISOString() });
      options.onProgress?.({
        type: 'point_failed',
        planId: plan.id,
        pointId: point.id,
        pointTitle: point.title,
        message: `Skipped "${point.title}" due to failed dependency.`,
      });
      failedPoints.push(point.title);
      continue;
    }

    // Execute this point
    try {
      options.onProgress?.({
        type: 'point_start',
        planId: plan.id,
        pointId: point.id,
        pointTitle: point.title,
        message: `Starting: ${point.title}`,
      });

      planStore.updatePlanPoint(plan.id, point.id, {
        status: 'in_progress',
        startedAt: new Date().toISOString(),
      });

      const result = await executePlanPoint(plan, point, options);

      // Run verification
      if (result.modifiedFiles.length > 0) {
        options.onProgress?.({
          type: 'verification_start',
          planId: plan.id,
          pointId: point.id,
          message: `Running verification for "${point.title}"...`,
        });

        planStore.updatePlanPoint(plan.id, point.id, { status: 'verifying' });

        const verificationResults = await runVerification({
          modifiedFiles: result.modifiedFiles,
          checks: point.verificationChecks,
          runShellCommand: options.runShellCommand,
          readFile: options.readFile,
          listFiles: options.listFiles,
          projectId: plan.projectId,
          planPointId: point.id,
        });

        planStore.setVerificationResults(plan.id, point.id, verificationResults);

        options.onProgress?.({
          type: 'verification_result',
          planId: plan.id,
          pointId: point.id,
          message: `Verification complete for "${point.title}"`,
          details: verificationResults,
        });

        const hasErrors = verificationResults.some((r) => !r.passed && r.issues?.some((i) => i.severity === 'error'));

        if (hasErrors) {
          // Send verification errors back to the sub-chat for fixing
          const fixResult = await fixVerificationErrors(plan, point, verificationResults, options);
          if (!fixResult.success) {
            planStore.updatePlanPoint(plan.id, point.id, {
              status: 'failed',
              completedAt: new Date().toISOString(),
              error: 'Failed to fix verification errors.',
            });
            failedPoints.push(point.title);
            options.onProgress?.({
              type: 'point_failed',
              planId: plan.id,
              pointId: point.id,
              pointTitle: point.title,
              message: `Failed to fix errors in "${point.title}"`,
            });
            continue;
          }
        }
      }

      // Extract context from the sub-chat and store in vector DB
      await extractContextFromSubChat(plan.projectId, result);

      options.onProgress?.({
        type: 'context_extracted',
        planId: plan.id,
        pointId: point.id,
        message: `Context extracted for "${point.title}"`,
      });

      // Mark point as completed
      planStore.updatePlanPoint(plan.id, point.id, {
        status: 'completed',
        completedAt: new Date().toISOString(),
        summary: result.summary,
      });

      planSummary += `- ${point.title}: ${result.summary || 'Completed'}\n`;

      options.onProgress?.({
        type: 'point_complete',
        planId: plan.id,
        pointId: point.id,
        pointTitle: point.title,
        message: `Completed: ${point.title}`,
      });
    } catch (error: any) {
      const errorMessage = error?.message || 'Unknown error';
      planStore.updatePlanPoint(plan.id, point.id, {
        status: 'failed',
        completedAt: new Date().toISOString(),
        error: errorMessage,
      });

      failedPoints.push(point.title);
      options.onProgress?.({
        type: 'point_failed',
        planId: plan.id,
        pointId: point.id,
        pointTitle: point.title,
        message: `Failed: ${point.title} — ${errorMessage}`,
      });

      // Don't break - try to continue with remaining points
      // unless they depend on this one
    }
  }

  const allCompleted = plan.points.every((p) => p.status === 'completed' || p.status === 'skipped');
  planStore.updatePlanStatus(plan.id, allCompleted ? 'completed' : 'failed');

  options.onProgress?.({
    type: 'plan_complete',
    planId: plan.id,
    message: allCompleted ? 'Plan completed successfully!' : `Plan completed with ${failedPoints.length} failures.`,
    details: { failedPoints, summary: planSummary },
  });

  return {
    success: allCompleted,
    summary: planSummary,
    failedPoints,
  };
}

/**
 * Executes a single plan point as a sub-chat.
 *
 * The sub-chat is treated as a NORMAL chat. The user message is simply
 * the plan point's description — no custom wrapper. Context is injected
 * into the system prompt via buildSubChatSystemPrompt.
 */
async function executePlanPoint(
  plan: Plan,
  point: PlanPoint,
  options: SubChatExecutionOptions,
): Promise<{ summary: string; modifiedFiles: string[]; toolCalls: ToolInvocationRecord[] }> {
  // 1. Query project context from vector store
  const projectContext = await projectContextStore.formatContextForPrompt(
    plan.projectId,
    `${point.title} ${point.description}`,
    1500,
  );

  // 2. Get previous points' summaries
  const previousPointsSummary = plan.points
    .filter((p) => p.status === 'completed' && p.order < point.order)
    .map((p) => `[Previously completed: ${p.title}] ${p.summary || 'Done'}`)
    .join('\n');

  // 3. Build the system prompt — full main prompt + context injection
  const systemPrompt = buildSubChatSystemPrompt({
    systemPrompt: options.systemPrompt,
    appBuilderPrompt: options.appBuilderPrompt,
    projectContext,
    previousPointsSummary,
    toolExecutionResults: options.toolExecutionResults,
    projectId: plan.projectId,
    userRequest: plan.userRequest,
  });

  // Initialize the sub-chat in the store
  planStore.addSubChat(plan.id, point.id, {
    planPointId: point.id,
    projectId: plan.projectId,
    messages: [],
    toolInvocations: [],
    modifiedFiles: [],
  });

  // 4. The user message is just the plan point's description — no custom wrapper
  const userMessage: SubChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: point.description,
  };

  // 5. Call the LLM with the constructed system prompt and the user message
  const assistantMessage = await options.callLLM([userMessage], systemPrompt);

  // Track the sub-chat messages
  const subChat = planStore.getPlan(plan.id)?.points.find((p) => p.id === point.id)?.subChat;
  if (subChat) {
    subChat.messages.push(userMessage, assistantMessage);
  }

  // Extract tool calls from the assistant message
  const toolCalls: ToolInvocationRecord[] = extractToolCalls(assistantMessage);
  for (const tc of toolCalls) {
    planStore.addToolInvocation(plan.id, point.id, tc);
  }

  // Detect modified files from tool calls
  const modifiedFiles = toolCalls
    .filter((tc) => tc.toolName === 'write_file' || tc.toolName === 'update_file')
    .map((tc) => (tc.args as any).filePath || (tc.args as any).path)
    .filter(Boolean);

  return {
    summary: assistantMessage.content.slice(0, 500),
    modifiedFiles,
    toolCalls,
  };
}

/**
 * Sends verification errors back to the AI for fixing.
 */
async function fixVerificationErrors(
  plan: Plan,
  point: PlanPoint,
  errors: VerificationResult[],
  options: SubChatExecutionOptions,
): Promise<{ success: boolean }> {
  const errorSummary = errors
    .filter((r) => !r.passed)
    .map((r) => {
      const issues = (r.issues || [])
        .map((i) => `  - ${i.severity.toUpperCase()}: ${i.filePath}${i.line ? `:${i.line}` : ''} — ${i.message}${i.suggestion ? ` (Suggestion: ${i.suggestion})` : ''}`)
        .join('\n');
      return `[${r.type}] Failed:\n${issues}`;
    })
    .join('\n\n');

  // Use the same buildSubChatSystemPrompt for consistency
  const systemPrompt = buildSubChatSystemPrompt({
    systemPrompt: options.systemPrompt,
    appBuilderPrompt: options.appBuilderPrompt,
    projectContext: '',
    previousPointsSummary: '',
    toolExecutionResults: options.toolExecutionResults,
    projectId: plan.projectId,
    userRequest: plan.userRequest,
  });

  const fixMessage: SubChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: `The following verification errors were found after your implementation. Please fix them:\n\n${errorSummary}`,
  };

  try {
    const response = await options.callLLM([fixMessage], systemPrompt);
    return { success: true };
  } catch {
    return { success: false };
  }
}

/**
 * Extracts useful context from a completed sub-chat and stores it
 * in the ProjectContextVectorStore for future reference.
 */
async function extractContextFromSubChat(
  projectId: string,
  result: { summary: string; modifiedFiles: string[]; toolCalls: ToolInvocationRecord[] },
): Promise<void> {
  const entries: Array<{
    type: any;
    content: string;
    tags?: string[];
    files?: string[];
  }> = [];

  // Store summary as conversation context
  if (result.summary) {
    entries.push({
      type: 'conversation_summary',
      content: result.summary,
      tags: ['sub-chat', 'implementation'],
    });
  }

  // Store modified files as file context
  for (const filePath of result.modifiedFiles) {
    entries.push({
      type: 'file_context',
      content: `File ${filePath} was created or modified during implementation.`,
      tags: ['modified'],
      files: [filePath],
    });
  }

  // Store tool usage patterns
  const toolPatterns = result.toolCalls
    .filter((tc) => tc.success)
    .map((tc) => `${tc.toolName}: ${JSON.stringify(tc.args).slice(0, 200)}`)
    .join('\n');

  if (toolPatterns) {
    entries.push({
      type: 'tool_usage',
      content: toolPatterns,
      tags: ['tools', 'pattern'],
    });
  }

  // Batch insert into vector store
  for (const entry of entries) {
    await projectContextStore.add(projectId, {
      projectId,
      ...entry,
    });
  }
}

/**
 * Extracts tool invocations from an assistant message.
 */
function extractToolCalls(message: SubChatMessage): ToolInvocationRecord[] {
  if (!message.toolInvocations) return [];

  return message.toolInvocations
    .filter((ti: any) => ti.state === 'result')
    .map((ti: any) => ({
      toolName: ti.toolName,
      args: ti.args || {},
      result: ti.result,
      success: !ti.result?.error,
      timestamp: new Date().toISOString(),
    }));
}

/**
 * Builds the system prompt for a sub-chat execution.
 *
 * Starts with the full main chat system prompt, appends the optional
 * app builder capabilities prompt, then injects project-specific context
 * sections inside an <active_project> block. No custom step-specific
 * instructions are added — the sub-chat is a normal chat with context.
 */
function buildSubChatSystemPrompt(params: {
  systemPrompt: string;
  appBuilderPrompt?: string;
  projectContext: string;
  previousPointsSummary: string;
  toolExecutionResults: string;
  projectId: string;
  userRequest: string;
}): string {
  // 1. Start with the full system prompt from the main chat
  let prompt = params.systemPrompt;

  // 2. If app builder prompt is provided, append it
  if (params.appBuilderPrompt) {
    prompt += `\n\n${params.appBuilderPrompt}`;
  }

  // 3. Build the active project context section
  let activeProjectContent = `This chat is executing as part of an active project (ID: ${params.projectId}).
The overall user request is: ${params.userRequest}`;

  // 4. Append previously completed steps if any
  if (params.previousPointsSummary) {
    activeProjectContent += `\n\n## Previously Completed Steps (in this plan)
${params.previousPointsSummary}`;
  }

  // 5. Append relevant project context from vector store if any
  if (params.projectContext) {
    activeProjectContent += `\n\n## Relevant Project Context (from vector store)
${params.projectContext}`;
  }

  // 6. Append relevant tool execution results from main chat if any
  if (params.toolExecutionResults) {
    activeProjectContent += `\n\n## Relevant Tool Results from Main Chat
${params.toolExecutionResults}`;
  }

  prompt += `\n\n<active_project>
${activeProjectContent}
</active_project>`;

  return prompt;
}