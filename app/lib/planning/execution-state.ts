/**
 * Execution State Manager
 *
 * Manages the mutable execution state for each task. The AI NEVER
 * creates or writes this — the runtime owns it and updates it as
 * the worker progresses.
 *
 * This is the key separation from the GPT architecture:
 *  - TaskContract (immutable) = what to do
 *  - ExecutionState (mutable) = how far we've gotten
 *
 * The ExecutionStateManager provides:
 *  - createState: initialize state for a new task
 *  - updateStatus: transition the task's status
 *  - recordStep: log a completed step
 *  - recordToolCall: log a tool invocation
 *  - recordFileModified: track a modified file
 *  - markResumable / markTerminal: control resume behavior
 *  - canResume: check if a task can be resumed
 */

import type {
  ExecutionStatus,
  PlanPoint,
  TaskExecutionState,
} from './types';

// ============================================================
// ExecutionStateManager
// ============================================================

export class ExecutionStateManager {
  /**
   * Creates the initial execution state for a task.
   */
  static createState(): TaskExecutionState {
    const now = new Date().toISOString();
    return {
      status: 'pending',
      startedAt: now,
      lastActivity: now,
      completedSteps: [],
      toolCallIds: [],
      filesModified: [],
      checkpointIndex: -1,
      canResume: true,
      retryCount: 0,
    };
  }

  /**
   * Updates the status of an execution state.
   * Automatically updates `lastActivity`.
   */
  static updateStatus(
    state: TaskExecutionState,
    status: ExecutionStatus,
  ): TaskExecutionState {
    const newState: TaskExecutionState = {
      ...state,
      status,
      lastActivity: new Date().toISOString(),
    };

    // Terminal states disable resume
    if (status === 'completed' || status === 'failed' || status === 'cancelled') {
      newState.canResume = false;
      newState.resumeReason = `Task reached terminal state: ${status}`;
    }

    return newState;
  }

  /**
   * Records a completed step.
   */
  static recordStep(
    state: TaskExecutionState,
    step: string,
  ): TaskExecutionState {
    return {
      ...state,
      completedSteps: [...state.completedSteps, step],
      lastActivity: new Date().toISOString(),
    };
  }

  /**
   * Records a tool call.
   */
  static recordToolCall(
    state: TaskExecutionState,
    toolCallId: string,
  ): TaskExecutionState {
    return {
      ...state,
      toolCallIds: [...state.toolCallIds, toolCallId],
      lastActivity: new Date().toISOString(),
    };
  }

  /**
   * Records a modified file (deduped).
   */
  static recordFileModified(
    state: TaskExecutionState,
    filePath: string,
  ): TaskExecutionState {
    if (state.filesModified.includes(filePath)) {
      return state;
    }

    return {
      ...state,
      filesModified: [...state.filesModified, filePath],
      lastActivity: new Date().toISOString(),
    };
  }

  /**
   * Marks a task as interrupted (e.g. network drop, tab close).
   * The task remains resumable.
   */
  static markInterrupted(
    state: TaskExecutionState,
    reason: string,
  ): TaskExecutionState {
    return {
      ...state,
      status: 'pending', // Reset to pending so the ExecutionManager picks it up
      canResume: true,
      resumeReason: `Interrupted: ${reason}. Resume from checkpoint ${state.checkpointIndex + 1}.`,
      lastActivity: new Date().toISOString(),
    };
  }

  /**
   * Increments the retry count (used when a task fails and is retried).
   */
  static incrementRetry(state: TaskExecutionState): TaskExecutionState {
    return {
      ...state,
      retryCount: state.retryCount + 1,
      canResume: true,
      status: 'pending',
      resumeReason: `Retry attempt ${state.retryCount + 1}`,
      lastActivity: new Date().toISOString(),
    };
  }

  /**
   * Checks if a task's execution state indicates it can be resumed.
   * A task can be resumed if:
   *  - canResume is true
   *  - status is not a terminal state (completed/failed/cancelled)
   *  - there is at least one checkpoint OR the task hasn't started yet
   */
  static canResume(point: PlanPoint): boolean {
    const state = point.executionState;

    if (!state) {
      // No state means the task hasn't started — it's "resumable" in
      // the sense that it can be started fresh.
      return point.status === 'pending';
    }

    if (!state.canResume) return false;

    const terminalStatuses: ExecutionStatus[] = ['completed', 'failed', 'cancelled'];
    if (terminalStatuses.includes(state.status)) return false;

    // Can resume if there's a checkpoint to resume from,
    // or if the task is still pending (hasn't started).
    const hasCheckpoint = (point.checkpoints?.length ?? 0) > 0;
    return hasCheckpoint || state.status === 'pending';
  }

  /**
   * Gets a human-readable description of the execution state for
   * display in the UI.
   */
  static describeState(point: PlanPoint): {
    label: string;
    detail: string;
    color: string;
  } {
    const state = point.executionState;

    if (!state) {
      return { label: 'Not started', detail: '', color: '#666' };
    }

    switch (state.status) {
      case 'pending':
        return {
          label: 'Pending',
          detail: state.resumeReason || 'Waiting to start',
          color: '#8e8e8e',
        };
      case 'preparing':
        return {
          label: 'Preparing',
          detail: 'Fetching tool outputs & invoking skills',
          color: '#3b82f6',
        };
      case 'running':
        return {
          label: 'Running',
          detail: `${state.completedSteps.length} steps done, ${state.filesModified.length} files modified`,
          color: '#22c55e',
        };
      case 'waiting_for_tool':
        return {
          label: 'Waiting for tool',
          detail: 'A tool call is in progress',
          color: '#f59e0b',
        };
      case 'waiting_for_user':
        return {
          label: 'Waiting for input',
          detail: 'Needs user response',
          color: '#f59e0b',
        };
      case 'verifying':
        return {
          label: 'Verifying',
          detail: 'Running lint / type-check / flow verification',
          color: '#8b5cf6',
        };
      case 'completed':
        return {
          label: 'Completed',
          detail: state.completedSteps.length + ' steps completed',
          color: '#22c55e',
        };
      case 'failed':
        return {
          label: 'Failed',
          detail: point.error || 'Execution failed',
          color: '#f43f5e',
        };
      case 'cancelled':
        return {
          label: 'Cancelled',
          detail: 'Task was cancelled',
          color: '#666',
        };
      default:
        return { label: 'Unknown', detail: '', color: '#666' };
    }
  }
}
