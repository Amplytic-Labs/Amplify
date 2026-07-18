/**
 * Sub-Chat Execution Engine
 *
 * Executes each PlanPoint as an independent sub-chat (worker).
 *
 * Architecture (from the GPT design conversation):
 *
 *   Planner → Task Context   (immutable contract: what to do)
 *   Project → Project Context (framework, architecture, file tree, vector)
 *   Skills  → Expert Context  (structured outputs, only required skills)
 *   Tools   → Runtime Context (resolved tool output references)
 *
 * The worker receives the combination of all four, assembled by the
 * ContextBuilder into labeled sections (TASK / PROJECT / SKILLS /
 * TOOL RESULTS / WORKSPACE / CONSTRAINTS / USER REQUEST).
 *
 * Key features:
 *  - Checkpoints: structured progress snapshots every N tool calls.
 *  - ExecutionState: mutable runtime-owned state (separate from the
 *    immutable task contract).
 *  - Resume: after interruption, the worker's context is reconstructed
 *    from the latest checkpoint — no AI needed to decide where it was.
 *  - ExecutionManager: orchestrates the task queue and resume logic.
 *
 * After each sub-chat completes:
 *  1. Takes a final checkpoint.
 *  2. Runs verification (lint, type-check, flow check).
 *  3. If verification fails, sends errors back to the sub-chat.
 *  4. Marks the point as completed or failed (via ExecutionManager).
 *  5. Extracts context into the ProjectContextVectorStore.
 *  6. Moves to the next point.
 */

import type {
  Checkpoint,
  Plan,
  PlanPoint,
  SkillContext,
  SubChat,
  SubChatMessage,
  ToolInvocationRecord,
  VerificationResult,
} from './types';
import { planStore } from './plan-store';
import { projectContextStore } from '~/lib/vector-store/project-context-store';
import { userProfileStore } from '~/lib/vector-store/user-profile-store';
import { runVerification } from '~/lib/verification/runner';
import type { UIMessage } from 'ai';
import { ExecutionManager } from './execution-manager';
import { ExecutionStateManager } from './execution-state';
import { CheckpointManager } from './checkpoint';
import { ContextBuilder, type ProjectContextInfo, type WorkspaceSnapshot } from './context-builder';
import { SkillContextBuilder, type RawSkillInput } from './skill-context';
import { toolOutputCache, type ToolExecutor } from './tool-output-cache';

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

  /**
   * Available skills (raw markdown content) that can be invoked.
   * The SkillContextBuilder will only load the ones the planner
   * marked as required for each task.
   */
  availableSkills?: RawSkillInput[];

  /**
   * Structured project memory block (framework, state mgmt, etc.)
   * injected into every worker's PROJECT section.
   */
  projectMemoryBlock?: string;

  /**
   * File tree summary of the current workspace.
   */
  fileTreeBlock?: string;

  /**
   * Optional tool executor for resolving tool output references
   * that aren't cached. If not provided, only cached outputs are used.
   */
  toolExecutor?: ToolExecutor;

  /**
   * Notes from the parent planner that all workers should inherit.
   * Example: "Use Expo Router because later tasks depend on it."
   */
  plannerNotes?: string;
}

export interface PlanProgressUpdate {
  type: 'point_start' | 'point_complete' | 'point_failed' | 'verification_start' | 'verification_result' | 'plan_complete' | 'context_extracted' | 'checkpoint' | 'skill_invoked' | 'tool_output_resolved' | 'resume' | 'error';
  planId: string;
  pointId?: string;
  pointTitle?: string;
  message: string;
  details?: any;
}

/**
 * Executes an entire plan by running each point as a sub-chat.
 *
 * Uses the ExecutionManager to pick the next task (which handles
 * resume from checkpoint automatically if a task was interrupted).
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

    // Skip terminal tasks
    if (['completed', 'skipped', 'cancelled'].includes(point.status)) continue;

    // Check dependencies
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
            ExecutionManager.markFailed(plan.id, point.id, 'Failed to fix verification errors.');
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

      // Mark point as completed (via ExecutionManager so it updates
      // the execution state + checks plan completion).
      ExecutionManager.markCompleted(plan.id, point.id, result.summary);

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
      ExecutionManager.markFailed(plan.id, point.id, errorMessage);

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
 * Resumes a plan from where it was interrupted.
 *
 * The ExecutionManager finds the first non-complete task, checks if
 * it has a checkpoint, and reconstructs the worker's context from:
 *   project → current files → task spec → checkpoint →
 *   relevant tool outputs → skills → worker
 *
 * The worker is effectively stateless — it receives the reconstructed
 * context and works from there.
 */
export async function resumePlan(
  plan: Plan,
  options: SubChatExecutionOptions,
): Promise<{ success: boolean; summary: string; failedPoints: string[] }> {
  const state = ExecutionManager.getExecutionState(plan.id);

  if (!state?.canResume) {
    return { success: false, summary: 'Plan cannot be resumed.', failedPoints: [] };
  }

  options.onProgress?.({
    type: 'resume',
    planId: plan.id,
    message: state.resumeReason,
  });

  // The ExecutionManager.prepareExecution inside executePlan will
  // handle the checkpoint reconstruction for each task.
  return executePlan(plan, options);
}

/**
 * Executes a single plan point as a sub-chat.
 *
 * The worker's context is assembled by the ContextBuilder from four
 * sources (Planner / Project / Skills / Runtime), each as a labeled
 * section. If the task was interrupted and has a checkpoint, a RESUME
 * section is prepended so the worker knows where it left off.
 */
async function executePlanPoint(
  plan: Plan,
  point: PlanPoint,
  options: SubChatExecutionOptions,
): Promise<{ summary: string; modifiedFiles: string[]; toolCalls: ToolInvocationRecord[] }> {
  // ── 0. Prepare execution (handles resume from checkpoint) ──────
  const prep = ExecutionManager.prepareExecution({ planId: plan.id });

  // Use the point passed in (prepareExecution may have updated its state)
  const activePoint = prep.point || point;

  if (prep.isResume) {
    options.onProgress?.({
      type: 'resume',
      planId: plan.id,
      pointId: activePoint.id,
      pointTitle: activePoint.title,
      message: `Resuming "${activePoint.title}" from checkpoint #${(prep.checkpoint?.index ?? 0) + 1}`,
    });
  }

  // ── 1. Preparing: fetch tool outputs + invoke skills ──────────
  if (activePoint.executionState) {
    activePoint.executionState = ExecutionStateManager.updateStatus(activePoint.executionState, 'preparing');
    planStore.updatePlanPoint(plan.id, activePoint.id, {
      executionState: activePoint.executionState,
      status: 'preparing',
    });
  }

  // 1a. Resolve tool output references (background fetch if not cached)
  const toolRefs = activePoint.requiredToolOutputs ?? [];
  let resolvedToolOutputs = new Map<string, import('./tool-output-cache').CachedToolOutput>();

  if (toolRefs.length > 0) {
    try {
      resolvedToolOutputs = await toolOutputCache.resolveMany(toolRefs, options.toolExecutor);

      // Also seed the cache with tool results from the main chat
      if (options.toolExecutionResults) {
        // The main chat's tool results are already available as a string;
        // we pass them through as a fallback tool output.
        await toolOutputCache.put(
          'main_chat_tool_results',
          'main_chat',
          {},
          options.toolExecutionResults,
        );
      }

      options.onProgress?.({
        type: 'tool_output_resolved',
        planId: plan.id,
        pointId: activePoint.id,
        message: `Resolved ${resolvedToolOutputs.size}/${toolRefs.length} tool outputs`,
      });
    } catch (e) {
      // Non-critical — the worker can still proceed
    }
  }

  // 1b. Invoke required skills (only the ones the planner marked)
  let skillContexts: SkillContext[] = [];

  if (options.availableSkills && activePoint.requiredSkills && activePoint.requiredSkills.length > 0) {
    skillContexts = SkillContextBuilder.buildMany(
      options.availableSkills,
      activePoint.requiredSkills,
    );

    options.onProgress?.({
      type: 'skill_invoked',
      planId: plan.id,
      pointId: activePoint.id,
      message: `Invoked ${skillContexts.length} skills: ${skillContexts.map((s) => s.label).join(', ')}`,
    });
  }

  // ── 2. Query project context from vector store ────────────────
  let vectorContext = '';
  try {
    vectorContext = await projectContextStore.formatContextForPrompt(
      plan.projectId,
      `${activePoint.title} ${activePoint.description}`,
      1500,
    );
  } catch {
    // Non-critical
  }

  // ── 3. Get previous points' summaries (plan context) ──────────
  const previousPointsSummary = plan.points
    .filter((p) => p.status === 'completed' && p.order < activePoint.order)
    .map((p) => `[${p.title}] ${p.summary || 'Done'}`)
    .join('\n');

  // ── 4. Build the workspace snapshot ───────────────────────────
  const changedFiles = activePoint.executionState?.filesModified ?? [];
  const workspace: WorkspaceSnapshot = {
    changedFiles,
    pendingChangeCount: changedFiles.length,
  };

  // ── 5. Assemble the full context via ContextBuilder ───────────
  const projectInfo: ProjectContextInfo = {
    memoryBlock: options.projectMemoryBlock || '',
    fileTreeBlock: options.fileTreeBlock || '',
    vectorContext,
  };

  const workerContext = ContextBuilder.build({
    plan,
    point: activePoint,
    projectInfo,
    skills: skillContexts,
    resolvedToolOutputs,
    toolOutputReferences: toolRefs,
    workspace,
    isResume: prep.isResume,
    resumeCheckpoint: prep.checkpoint,
    previousPointsSummary,
    plannerNotes: options.plannerNotes,
  });

  // ── 6. Build the system prompt ────────────────────────────────
  let systemPrompt = options.systemPrompt;
  if (options.appBuilderPrompt) {
    systemPrompt += `\n\n${options.appBuilderPrompt}`;
  }
  systemPrompt += `\n\n<active_project>\n${workerContext}\n</active_project>`;

  // ── 7. Initialize the sub-chat in the store ───────────────────
  planStore.addSubChat(plan.id, activePoint.id, {
    planPointId: activePoint.id,
    projectId: plan.projectId,
    messages: [],
    toolInvocations: [],
    modifiedFiles: [],
  });

  // ── 8. Update execution state to running ──────────────────────
  if (activePoint.executionState) {
    activePoint.executionState = ExecutionStateManager.updateStatus(activePoint.executionState, 'running');
    planStore.updatePlanPoint(plan.id, activePoint.id, {
      executionState: activePoint.executionState,
      status: 'in_progress',
    });
  }

  // ── 9. Build the user message ────────────────────────────────
  // On a fresh start: the task description is the user message.
  // On resume: the resume instruction is prepended so the worker
  // knows what was already done and what remains.
  const userContent = prep.isResume && prep.resumeInstruction
    ? `${prep.resumeInstruction}\n\n---\n\n${activePoint.description}`
    : activePoint.description;

  const userMessage: SubChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: userContent,
  };

  // ── 10. Call the LLM ──────────────────────────────────────────
  const assistantMessage = await options.callLLM([userMessage], systemPrompt);

  // Track the sub-chat messages
  const planData = await planStore.getPlanAsync(plan.id);
  const subChat = planData?.points.find((p) => p.id === activePoint.id)?.subChat;
  if (subChat) {
    subChat.messages.push(userMessage, assistantMessage);
  }

  // ── 11. Extract tool calls and update execution state ─────────
  const toolCalls: ToolInvocationRecord[] = extractToolCalls(assistantMessage);

  for (const tc of toolCalls) {
    planStore.addToolInvocation(plan.id, activePoint.id, tc);

    // Record in execution state
    if (activePoint.executionState) {
      activePoint.executionState = ExecutionStateManager.recordToolCall(
        activePoint.executionState,
        tc.timestamp,
      );

      // Track modified files
      const filePath = (tc.args as any).filePath || (tc.args as any).path;
      if (filePath && (tc.toolName === 'write_file' || tc.toolName === 'update_file' || tc.toolName === 'create_file')) {
        activePoint.executionState = ExecutionStateManager.recordFileModified(
          activePoint.executionState,
          filePath,
        );
        planStore.addModifiedFile(plan.id, activePoint.id, filePath);
      }
    }
  }

  // Detect modified files from tool calls
  const modifiedFiles = toolCalls
    .filter((tc) => tc.toolName === 'write_file' || tc.toolName === 'update_file' || tc.toolName === 'create_file')
    .map((tc) => (tc.args as any).filePath || (tc.args as any).path)
    .filter(Boolean);

  // ── 12. Take a checkpoint ─────────────────────────────────────
  if (activePoint.executionState && toolCalls.length > 0) {
    const completedSteps = [`${activePoint.title} executed`];

    const checkpoint = CheckpointManager.createCheckpoint({
      point: activePoint,
      toolInvocations: toolCalls,
      messageIndex: subChat?.messages.length ?? 1,
      completedSteps,
    });

    activePoint.executionState = CheckpointManager.saveCheckpoint(
      activePoint,
      checkpoint,
      activePoint.executionState,
    );

    planStore.updatePlanPoint(plan.id, activePoint.id, {
      executionState: activePoint.executionState,
      checkpoints: activePoint.checkpoints,
    });

    options.onProgress?.({
      type: 'checkpoint',
      planId: plan.id,
      pointId: activePoint.id,
      message: `Checkpoint #${checkpoint.index + 1} saved (${modifiedFiles.length} files, ${toolCalls.length} tool calls)`,
    });
  }

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

  // Build a simplified context for the fix attempt
  const systemPrompt = options.systemPrompt + `\n\n<active_project>\n===== TASK =====\nTask: ${point.title}\nDescription: ${point.description}\n\n===== FIX REQUEST =====\nThe following verification errors were found. Fix them.\n</active_project>`;

  const fixMessage: SubChatMessage = {
    id: crypto.randomUUID(),
    role: 'user',
    content: `The following verification errors were found after your implementation. Please fix them:\n\n${errorSummary}`,
  };

  try {
    await options.callLLM([fixMessage], systemPrompt);
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
    try {
      await projectContextStore.add(projectId, {
        projectId,
        ...entry,
      });
    } catch {
      // Non-critical
    }
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

// Re-export for backwards compatibility
export { ExecutionManager, ExecutionStateManager, CheckpointManager, ContextBuilder, SkillContextBuilder, toolOutputCache };
