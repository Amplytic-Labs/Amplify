/**
 * Sub-Chat Execution Engine
 *
 * Executes each PlanPoint as an independent sub-chat.
 * Instead of sending the entire conversation to the AI, each sub-chat
 * gets only the relevant context from the vector store plus the
 * specific instruction for that plan point.
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
 */
async function executePlanPoint(
  plan: Plan,
  point: PlanPoint,
  options: SubChatExecutionOptions,
): Promise<{ summary: string; modifiedFiles: string[]; toolCalls: ToolInvocationRecord[] }> {
  // Build the sub-chat context from vector store
  const projectContext = await projectContextStore.formatContextForPrompt(
    plan.projectId,
    `${point.title} ${point.description}`,
    1500,
  );

  // Also get previous points' summaries
  const previousPointsSummary = plan.points
    .filter((p) => p.status === 'completed' && p.order < point.order)
    .map((p) => `[Previously completed: ${p.title}] ${p.summary || 'Done'}`)
    .join('\n');

  // Build the system prompt for this sub-chat
  const systemPrompt = buildSubChatSystemPrompt({
    point,
    projectContext,
    previousPointsSummary,
    userRequest: plan.userRequest,
    planDescription: plan.description,
  });

  // Initialize the sub-chat in the store
  planStore.addSubChat(plan.id, point.id, {
    planPointId: point.id,
    projectId: plan.projectId,
    messages: [],
    toolInvocations: [],
    modifiedFiles: [],
  });

  // Execute the LLM call
  const userMessage: SubChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: point.description,
  };

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

  const systemPrompt = buildSubChatSystemPrompt({
    point,
    projectContext: '',
    previousPointsSummary: '',
    userRequest: plan.userRequest,
    planDescription: plan.description,
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
 */
function buildSubChatSystemPrompt(params: {
  point: PlanPoint;
  projectContext: string;
  previousPointsSummary: string;
  userRequest: string;
  planDescription: string;
}): string {
  let prompt = `You are executing a specific step of a larger plan.

## Overall Task
${params.userRequest}

## Plan Description
${params.planDescription}

## Your Current Step (Step ${params.point.order + 1})
**Title:** ${params.point.title}
**Description:** ${params.point.description}`;

  if (params.point.expectedFiles.length > 0) {
    prompt += `\n**Expected Files:** ${params.point.expectedFiles.join(', ')}`;
  }

  if (params.previousPointsSummary) {
    prompt += `\n\n## Previously Completed Steps\n${params.previousPointsSummary}`;
  }

  if (params.projectContext) {
    prompt += `\n\n## Project Context (from vector store)\n${params.projectContext}`;
  }

  prompt += `

## Rules
- Focus ONLY on completing your assigned step. Do not work on other steps.
- Create or modify the files listed in "Expected Files".
- After making changes, provide a brief summary of what you did.
- Follow existing patterns and conventions found in the project context.
- If you encounter an error, describe it clearly so it can be stored for future reference.

CRITICAL RULES:
1. "Every button does something" — Any interactive element (button, link, form) MUST call a real function or navigate to a real route. Never leave placeholder onClick handlers.
2. "Every screen is connected" — Any screen you create MUST be reachable from some other screen through navigation (direct link, button, conditional redirect). Check existing routes and add navigation links where needed.
3. Do NOT duplicate code. Reuse existing components, utilities, and patterns from the project context.
4. After modifying files, run the appropriate build/check command to verify no errors were introduced.`;

  return prompt;
}