/**
 * Checkpoint Manager
 *
 * Takes structured snapshots of a task's progress at regular intervals.
 * Unlike an AI-generated summary, a checkpoint is pure structured data:
 *  - which files changed
 *  - which tools were used
 *  - what steps were completed
 *  - what remains
 *
 * This makes resume deterministic. When the user says "continue" after
 * an interruption (network drop, app restart, tab switch), the runtime
 * reads the latest checkpoint + current file state and reconstructs
 * the worker's context — no AI needed to "figure out" where it was.
 *
 * Checkpoints are taken:
 *  - Every N tool calls (default: 3)
 *  - Before verification
 *  - On explicit request
 */

import type { Checkpoint, PlanPoint, TaskExecutionState, ToolInvocationRecord } from './types';

/*
 * ============================================================
 * CheckpointManager
 * ============================================================
 */

export interface CheckpointContext {
  /**
   * The plan point being executed.
   */
  point: PlanPoint;

  /**
   * All tool invocations made so far in this sub-chat.
   */
  toolInvocations: ToolInvocationRecord[];

  /**
   * The current message index in the sub-chat.
   */
  messageIndex: number;

  /**
   * Steps completed so far (human-readable, accumulated).
   */
  completedSteps: string[];
}

export class CheckpointManager {
  /**
   * The number of tool calls between automatic checkpoints.
   */
  static readonly CHECKPOINT_INTERVAL = 3;

  /**
   * Determines whether a checkpoint should be taken given the current
   * number of tool calls and the last checkpoint index.
   */
  static shouldCheckpoint(toolCallCount: number, lastCheckpointIndex: number): boolean {
    const callsSinceLastCheckpoint = toolCallCount - (lastCheckpointIndex + 1) * this.CHECKPOINT_INTERVAL;
    return callsSinceLastCheckpoint >= this.CHECKPOINT_INTERVAL;
  }

  /**
   * Creates a checkpoint from the current execution context.
   *
   * This is pure structured data — NO AI summary is generated.
   * The runtime derives everything from observed state.
   */
  static createCheckpoint(ctx: CheckpointContext): Checkpoint {
    const { point, toolInvocations, messageIndex, completedSteps } = ctx;

    // Determine the previous checkpoint to compute deltas
    const previousCheckpoints = point.checkpoints ?? [];
    const index = previousCheckpoints.length;

    const previousCheckpoint = index > 0 ? previousCheckpoints[index - 1] : null;

    // Files changed since the previous checkpoint
    const previousFiles = new Set(previousCheckpoint?.filesChanged ?? []);
    const allModifiedFiles = point.subChat?.modifiedFiles ?? [];
    const filesChanged = allModifiedFiles.filter((f) => !previousFiles.has(f));

    // Tools used since the previous checkpoint
    const previousToolCount = previousCheckpoint ? previousCheckpoint.progressSummary.toolsCalled : 0;
    const recentTools = toolInvocations.slice(previousToolCount);
    const toolsUsed = recentTools.map((t) => t.toolName);

    /*
     * Remaining work: derived from the task contract's requirements
     * vs. what's been completed. Each requirement that doesn't appear
     * in any completed step is considered remaining.
     */
    const requirements = point.requirements ?? [];
    const completedText = completedSteps.join(' ').toLowerCase();
    const remainingWork = requirements.filter((req) => {
      /*
       * Simple heuristic: if keywords from the requirement appear in
       * completed steps, consider it done.
       */
      const keywords = req
        .toLowerCase()
        .split(/\s+/)
        .filter((w) => w.length > 4);
      return keywords.length > 0 && !keywords.some((kw) => completedText.includes(kw));
    });

    return {
      index,
      timestamp: new Date().toISOString(),
      filesChanged,
      toolsUsed,
      progressSummary: {
        stepsCompleted: [...completedSteps],
        filesModified: [...allModifiedFiles],
        toolsCalled: toolInvocations.length,
      },
      remainingWork,
      messageIndex,
    };
  }

  /**
   * Adds a checkpoint to a plan point and updates the execution state's
   * checkpointIndex.
   *
   * Returns the updated execution state.
   */
  static saveCheckpoint(
    point: PlanPoint,
    checkpoint: Checkpoint,
    executionState: TaskExecutionState,
  ): TaskExecutionState {
    if (!point.checkpoints) {
      point.checkpoints = [];
    }

    point.checkpoints.push(checkpoint);

    return {
      ...executionState,
      checkpointIndex: checkpoint.index,
      lastActivity: checkpoint.timestamp,
      filesModified: checkpoint.progressSummary.filesModified,
    };
  }

  /**
   * Gets the latest checkpoint for a plan point, or null if none exist.
   */
  static getLatestCheckpoint(point: PlanPoint): Checkpoint | null {
    if (!point.checkpoints || point.checkpoints.length === 0) {
      return null;
    }

    return point.checkpoints[point.checkpoints.length - 1];
  }

  /**
   * Builds a resume context from the latest checkpoint.
   *
   * This is what the runtime uses to reconstruct the worker's context
   * when resuming after an interruption. The worker receives:
   *  - The task contract (immutable — what to do)
   *  - The checkpoint (how far we got)
   *  - Current file state (from the project)
   *  - A "continue from here" instruction
   */
  static buildResumeContext(point: PlanPoint): {
    checkpoint: Checkpoint | null;
    resumeInstruction: string;
  } {
    const checkpoint = this.getLatestCheckpoint(point);

    if (!checkpoint) {
      return {
        checkpoint: null,
        resumeInstruction: '',
      };
    }

    const lines: string[] = [
      'You are resuming a task that was interrupted. Here is your progress so far:',
      '',
      `Checkpoint #${checkpoint.index + 1} (taken ${checkpoint.timestamp})`,
      '',
      'Steps completed:',
    ];

    for (const step of checkpoint.progressSummary.stepsCompleted) {
      lines.push(`  ✓ ${step}`);
    }

    if (checkpoint.progressSummary.filesModified.length > 0) {
      lines.push('', 'Files modified so far:');

      for (const file of checkpoint.progressSummary.filesModified) {
        lines.push(`  - ${file}`);
      }
    }

    if (checkpoint.remainingWork.length > 0) {
      lines.push('', 'Remaining work:');

      for (const item of checkpoint.remainingWork) {
        lines.push(`  ○ ${item}`);
      }
    }

    lines.push('', 'Continue from where you left off. Do NOT redo completed steps.');

    return {
      checkpoint,
      resumeInstruction: lines.join('\n'),
    };
  }
}
