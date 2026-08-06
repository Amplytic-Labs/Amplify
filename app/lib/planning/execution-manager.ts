/**
 * Execution Manager
 *
 * The central orchestrator for plan execution. Separates *conversation*
 * (the main chat) from *execution management* (task queue, resume,
 * checkpoint reconstruction).
 *
 * Key responsibilities:
 *  1. Task Queue: tracks which tasks are pending/running/complete.
 *  2. Continue: when the user says "continue", picks the first
 *     non-complete task — no AI needed to decide.
 *  3. Resume: after an interruption, reconstructs the worker's context
 *     from the latest checkpoint + current file state.
 *  4. State Queries: answers "what is the current execution state?"
 *     so the main chat doesn't have to infer it from history.
 *
 * The worker is effectively stateless — the ExecutionManager
 * reconstructs everything on resume:
 *
 *   Project → Current files → Task spec → Checkpoint →
 *   Relevant tool outputs → Skills → Worker
 */

import type { Plan, PlanPoint } from './types';
import { planStore } from './plan-store';
import { ExecutionStateManager } from './execution-state';
import { CheckpointManager } from './checkpoint';
import { createScopedLogger } from '~/utils/logger';
import {
  isToolPart,
  getToolNameFromPart,
  getToolCallId,
  getToolState,
  getToolInput,
  getToolOutput,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  ToolState,
} from '~/lib/chat/tool-parts';

const logger = createScopedLogger('ExecutionManager');

/*
 * ============================================================
 * Types
 * ============================================================
 */

export interface ExecutionStateSummary {
  /**
   * The plan's overall status.
   */
  planStatus: Plan['status'];

  /**
   * The currently active task (if any).
   */
  activeTask?: {
    pointId: string;
    title: string;
    status: string;
    checkpointIndex: number;
  };

  /**
   * Whether the plan can be resumed (has incomplete tasks).
   */
  canResume: boolean;

  /**
   * Human-readable reason explaining the resume status.
   */
  resumeReason: string;

  /**
   * Per-task status breakdown.
   */
  tasks: Array<{
    pointId: string;
    title: string;
    status: string;
    executionStatus?: string;
    canResume: boolean;
    checkpointCount: number;
    completedSteps: number;
    filesModified: number;
  }>;

  /**
   * The next task that would be picked on "continue".
   */
  nextTask?: {
    pointId: string;
    title: string;
    isResume: boolean;
  };
}

export interface ResumeOptions {
  /**
   * The plan to resume.
   */
  planId: string;

  /**
   * Optional specific point ID to resume. If omitted, the manager
   * picks the first non-complete task.
   */
  pointId?: string;
}

export interface ResumeResult {
  /**
   * The point that was resumed (or null if nothing to resume).
   */
  point: PlanPoint | null;

  /**
   * Whether this is a fresh start or a checkpoint resume.
   */
  isResume: boolean;

  /**
   * The checkpoint to resume from (if isResume).
   */
  checkpoint: import('./types').Checkpoint | null;

  /**
   * The resume instruction to inject into the worker's context.
   */
  resumeInstruction: string;
}

/*
 * ============================================================
 * ExecutionManager
 * ============================================================
 */

export class ExecutionManager {
  /**
   * Gets a structured summary of a plan's execution state.
   *
   * This is what the main chat asks when the user says "continue" —
   * instead of inferring state from chat history, it gets a
   * deterministic structured answer.
   */
  static getExecutionState(planId: string): ExecutionStateSummary | null {
    const plan = planStore.getPlan(planId);

    if (!plan) {
      return null;
    }

    const tasks = plan.points.map((point) => {
      const state = point.executionState;
      return {
        pointId: point.id,
        title: point.title,
        status: point.status,
        executionStatus: state?.status,
        canResume: ExecutionStateManager.canResume(point),
        checkpointCount: point.checkpoints?.length ?? 0,
        completedSteps: state?.completedSteps.length ?? 0,
        filesModified: state?.filesModified.length ?? 0,
      };
    });

    // Find the active task (in_progress / verifying / preparing / waiting)
    const activePoint = plan.points.find((p) =>
      ['in_progress', 'verifying', 'preparing', 'waiting_for_tool', 'waiting_for_user'].includes(p.status),
    );

    // Find the next task to execute
    const nextTask = this.findNextTask(plan);

    // Can resume if there's a next task or an active interrupted task
    const hasIncomplete = plan.points.some(
      (p) => p.status !== 'completed' && p.status !== 'skipped' && p.status !== 'cancelled',
    );

    const canResume = hasIncomplete && plan.status !== 'cancelled';

    let resumeReason = 'All tasks completed.';

    if (activePoint) {
      const state = activePoint.executionState;
      resumeReason = state?.resumeReason || `Task "${activePoint.title}" is ${state?.status || activePoint.status}.`;
    } else if (nextTask) {
      resumeReason = nextTask.isResume ? `Resume "${nextTask.title}" from checkpoint.` : `Start "${nextTask.title}".`;
    } else if (hasIncomplete) {
      resumeReason = 'Some tasks remain but have failed dependencies.';
    }

    return {
      planStatus: plan.status,
      activeTask: activePoint
        ? {
            pointId: activePoint.id,
            title: activePoint.title,
            status: activePoint.status,
            checkpointIndex: activePoint.executionState?.checkpointIndex ?? -1,
          }
        : undefined,
      canResume,
      resumeReason,
      tasks,
      nextTask: nextTask
        ? {
            pointId: nextTask.pointId,
            title: nextTask.title,
            isResume: nextTask.isResume,
          }
        : undefined,
    };
  }

  /**
   * Finds the next task to execute — the first non-complete task
   * whose dependencies are all met.
   *
   * Returns whether it's a resume (has checkpoints) or a fresh start.
   */
  static findNextTask(plan: Plan): {
    pointId: string;
    title: string;
    isResume: boolean;
  } | null {
    const completedIds = new Set(
      plan.points.filter((p) => p.status === 'completed' || p.status === 'skipped').map((p) => p.id),
    );

    for (const point of plan.points) {
      // Skip terminal tasks
      if (['completed', 'skipped', 'cancelled'].includes(point.status)) {
        continue;
      }

      // Check dependencies
      const depsMet = point.dependencies.every((depId) => completedIds.has(depId));

      if (!depsMet) {
        continue;
      }

      // Check if this is a resume (has checkpoints) or fresh
      const hasCheckpoints = (point.checkpoints?.length ?? 0) > 0;
      const isInterrupted = point.executionState?.canResume === true && hasCheckpoints;

      return {
        pointId: point.id,
        title: point.title,
        isResume: isInterrupted,
      };
    }

    return null;
  }

  /**
   * Prepares a task for execution (or resume).
   *
   * This is called by the sub-chat engine before invoking the worker.
   * It:
   *  1. Finds the next task (or uses the specified one).
   *  2. Determines if this is a fresh start or a checkpoint resume.
   *  3. Returns the resume context (checkpoint + instruction).
   *
   * The worker itself is stateless — it receives the reconstructed
   * context and works from there.
   */
  static prepareExecution(options: ResumeOptions): ResumeResult {
    const plan = planStore.getPlan(options.planId);

    if (!plan) {
      return { point: null, isResume: false, checkpoint: null, resumeInstruction: '' };
    }

    let point: PlanPoint | undefined;

    if (options.pointId) {
      point = plan.points.find((p) => p.id === options.pointId);
    } else {
      const next = this.findNextTask(plan);

      if (next) {
        point = plan.points.find((p) => p.id === next.pointId);
      }
    }

    if (!point) {
      return { point: null, isResume: false, checkpoint: null, resumeInstruction: '' };
    }

    // Determine if this is a resume
    const checkpoint = CheckpointManager.getLatestCheckpoint(point);
    const isResume = checkpoint !== null && point.executionState?.canResume === true;

    let resumeInstruction = '';

    if (isResume && checkpoint) {
      const resumeCtx = CheckpointManager.buildResumeContext(point);
      resumeInstruction = resumeCtx.resumeInstruction;

      // Update the execution state to reflect the resume
      if (point.executionState) {
        point.executionState = ExecutionStateManager.updateStatus(point.executionState, 'running');
        point.executionState.resumeReason = 'Resumed from checkpoint ' + (checkpoint.index + 1);
        planStore.updatePlanPoint(plan.id, point.id, {
          executionState: point.executionState,
          status: 'in_progress',
        });
      }
    } else {
      // Fresh start — initialize execution state
      const newState = ExecutionStateManager.createState();
      point.executionState = newState;
      planStore.updatePlanPoint(plan.id, point.id, {
        executionState: newState,
        status: 'in_progress',
        startedAt: new Date().toISOString(),
      });
    }

    return { point, isResume, checkpoint, resumeInstruction };
  }

  /**
   * Marks a task as interrupted (e.g. when the user closes the tab
   * or the network drops). The task remains resumable.
   *
   * On the next "continue", prepareExecution will detect the
   * checkpoint and resume from it.
   */
  static markInterrupted(planId: string, pointId: string, reason: string): void {
    const plan = planStore.getPlan(planId);

    if (!plan) {
      return;
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point?.executionState) {
      return;
    }

    /*
     * Take a final checkpoint before marking interrupted
     * V7 MIGRATION: Extract tool invocations from parts (v7) or toolInvocations (legacy)
     */
    const toolInvocations = extractToolInvocationsFromSubChat(point.subChat);
    const completedSteps = point.executionState.completedSteps ?? [];

    const checkpoint = CheckpointManager.createCheckpoint({
      point,
      toolInvocations,
      messageIndex: point.subChat?.messages.length ?? 0,
      completedSteps,
    });

    point.executionState = CheckpointManager.saveCheckpoint(point, checkpoint, point.executionState);
    point.executionState = ExecutionStateManager.markInterrupted(point.executionState, reason);

    planStore.updatePlanPoint(planId, pointId, {
      executionState: point.executionState,
      checkpoints: point.checkpoints,
      status: 'pending',
    });

    logger.info(`Task ${pointId} marked interrupted: ${reason}`);
  }

  /**
   * Marks a task as completed successfully.
   */
  static markCompleted(planId: string, pointId: string, summary: string): void {
    const plan = planStore.getPlan(planId);

    if (!plan) {
      return;
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point) {
      return;
    }

    if (point.executionState) {
      point.executionState = ExecutionStateManager.updateStatus(point.executionState, 'completed');
    }

    planStore.updatePlanPoint(planId, pointId, {
      executionState: point.executionState,
      status: 'completed',
      completedAt: new Date().toISOString(),
      summary,
    });

    // Check if the entire plan is now complete
    this.checkPlanCompletion(planId);
  }

  /**
   * Marks a task as failed.
   */
  static markFailed(planId: string, pointId: string, error: string): void {
    const plan = planStore.getPlan(planId);

    if (!plan) {
      return;
    }

    const point = plan.points.find((p) => p.id === pointId);

    if (!point) {
      return;
    }

    if (point.executionState) {
      point.executionState = ExecutionStateManager.updateStatus(point.executionState, 'failed');
    }

    planStore.updatePlanPoint(planId, pointId, {
      executionState: point.executionState,
      status: 'failed',
      completedAt: new Date().toISOString(),
      error,
    });

    this.checkPlanCompletion(planId);
  }

  /**
   * Checks if all tasks in a plan are complete and updates the plan
   * status accordingly.
   */
  static checkPlanCompletion(planId: string): void {
    const plan = planStore.getPlan(planId);

    if (!plan) {
      return;
    }

    const allDone = plan.points.every(
      (p) => p.status === 'completed' || p.status === 'skipped' || p.status === 'cancelled',
    );

    if (allDone) {
      const anyFailed = plan.points.some((p) => p.status === 'failed' || (p.status === 'skipped' && p.error));
      planStore.updatePlanStatus(planId, anyFailed ? 'failed' : 'completed');
    }
  }

  /**
   * Gets all plans for a project that have incomplete tasks
   * (i.e. are resumable).
   */
  static getResumablePlans(projectId: string): Plan[] {
    return planStore
      .getPlansByProject(projectId)
      .filter(
        (plan) =>
          plan.status !== 'completed' &&
          plan.status !== 'cancelled' &&
          plan.points.some((p) => p.status !== 'completed' && p.status !== 'skipped' && p.status !== 'cancelled'),
      );
  }
}

/**
 * Extracts tool invocations from a SubChat object.
 *
 * V7 MIGRATION (Task 3b): In AI SDK v7, tool invocations are stored as
 * FLAT parts in message.parts with `type: 'tool-<name>'` or `'dynamic-tool'`
 * (NOT the v4 literal `'tool-invocation'` with nested `toolInvocation`).
 * This helper extracts them from either the v7 parts-based format or the
 * legacy toolInvocations array (v4) via the shared helpers in
 * `~/lib/chat/tool-parts`.
 */
function extractToolInvocationsFromSubChat(subChat: any): any[] {
  if (!subChat) {
    return [];
  }

  /*
   * V7 (Task 3b): tool invocations live inline on each message part with
   * type `tool-<name>` / `dynamic-tool` (flat shape — NOT nested under
   * `toolInvocation`). We use the shared helpers to extract the fields.
   */
  if (Array.isArray(subChat.messages)) {
    const fromParts: any[] = [];

    for (const msg of subChat.messages) {
      if (Array.isArray(msg.parts)) {
        for (const p of msg.parts) {
          if (!isToolPart(p)) {
            continue;
          }

          fromParts.push({
            toolName: getToolNameFromPart(p),
            toolCallId: getToolCallId(p),
            state: getToolState(p),
            args: getToolInput(p),
            result: getToolOutput(p),
          });
        }
      }
    }

    if (fromParts.length > 0) {
      return fromParts;
    }
  }

  // Legacy fallback: use toolInvocations array on subChat
  return subChat.toolInvocations ?? [];
}

export const executionManager = ExecutionManager;
