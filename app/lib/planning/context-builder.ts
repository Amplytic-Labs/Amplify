/**
 * Context Builder
 *
 * Assembles the worker's full context from four independent sources,
 * each as a clearly-labeled section. Models handle structured sections
 * much better than one long blob of text.
 *
 *   Planner   →  TASK          (the immutable contract: what to do)
 *   Project   →  PROJECT       (framework, architecture, file tree, vector context)
 *   Skills    →  SKILLS        (structured expert guidance)
 *   Runtime   →  TOOL RESULTS  (resolved tool output references)
 *             →  WORKSPACE     (changed files, pending changes, branch)
 *             →  CONSTRAINTS   (explicit boundaries)
 *             →  USER REQUEST  (the original ask that triggered the plan)
 *
 * If resuming, a RESUME section is prepended with the checkpoint info.
 */

import type {
  Checkpoint,
  Plan,
  PlanPoint,
  SkillContext,
  TaskConstraints,
  ToolOutputReference,
} from './types';
import type { CachedToolOutput } from './tool-output-cache';
import { SkillContextBuilder } from './skill-context';

// ============================================================
// Types
// ============================================================

export interface ProjectContextInfo {
  /**
   * The project's structured memory (framework, state mgmt, etc.).
   */
  memoryBlock: string;

  /**
   * The current file tree summary.
   */
  fileTreeBlock: string;

  /**
   * Vector-store-retrieved context relevant to the task.
   */
  vectorContext: string;
}

export interface WorkspaceSnapshot {
  /**
   * Files that have changed since the plan started.
   */
  changedFiles: string[];

  /**
   * Number of files modified (for the "N files modified" summary).
   */
  pendingChangeCount: number;

  /**
   * The current git branch (if available).
   */
  branch?: string;
}

export interface ContextBuildOptions {
  /**
   * The overall plan (provides userRequest + plan-level context).
   */
  plan: Plan;

  /**
   * The specific plan point / task being executed.
   */
  point: PlanPoint;

  /**
   * Structured project context (memory + file tree + vector).
   */
  projectInfo: ProjectContextInfo;

  /**
   * Skills invoked for this task (already built into SkillContexts).
   */
  skills: SkillContext[];

  /**
   * Resolved tool outputs (reference ID → cached output).
   */
  resolvedToolOutputs: Map<string, CachedToolOutput>;

  /**
   * The tool output references from the task contract.
   */
  toolOutputReferences: ToolOutputReference[];

  /**
   * Current workspace snapshot.
   */
  workspace: WorkspaceSnapshot;

  /**
   * Whether this is a resume after interruption. If true, the
   * checkpoint info is included.
   */
  isResume?: boolean;

  /**
   * The checkpoint to resume from (if isResume).
   */
  resumeCheckpoint?: Checkpoint | null;

  /**
   * Summaries of previously completed plan points (plan context).
   */
  previousPointsSummary?: string;

  /**
   * Notes from the parent planner that the worker should inherit.
   * Example: "Use Expo Router because later tasks depend on it."
   */
  plannerNotes?: string;
}

// ============================================================
// ContextBuilder
// ============================================================

export class ContextBuilder {
  /**
   * Builds the complete worker context as a single labeled string,
   * ready to be injected into the system prompt.
   */
  static build(options: ContextBuildOptions): string {
    const sections: string[] = [];

    // 1. RESUME (if applicable)
    if (options.isResume && options.resumeCheckpoint) {
      sections.push(this.buildResumeSection(options.resumeCheckpoint, options.point));
    }

    // 2. TASK (the immutable contract from the planner)
    sections.push(this.buildTaskSection(options.point));

    // 3. PROJECT (where the worker is working)
    sections.push(this.buildProjectSection(options.projectInfo));

    // 4. SKILLS (expert guidance — structured outputs)
    if (options.skills.length > 0) {
      sections.push(this.buildSkillsSection(options.skills));
    }

    // 5. TOOL RESULTS (resolved references)
    if (options.toolOutputReferences.length > 0) {
      sections.push(this.buildToolResultsSection(options.toolOutputReferences, options.resolvedToolOutputs));
    }

    // 6. WORKSPACE SNAPSHOT (what has changed)
    sections.push(this.buildWorkspaceSection(options.workspace));

    // 7. PLAN CONTEXT (where the worker is in the overall plan)
    if (options.previousPointsSummary || options.plannerNotes) {
      sections.push(this.buildPlanContextSection(options.plan, options.point, options.previousPointsSummary, options.plannerNotes));
    }

    // 8. CONSTRAINTS (explicit boundaries)
    if (options.point.constraints) {
      sections.push(this.buildConstraintsSection(options.point.constraints));
    }

    // 9. USER REQUEST (the original ask)
    sections.push(this.buildUserRequestSection(options.plan.userRequest));

    return sections.filter((s) => s.trim().length > 0).join('\n\n');
  }

  // ============================================================
  // Section builders
  // ============================================================

  private static buildResumeSection(checkpoint: Checkpoint, point: PlanPoint): string {
    const lines: string[] = ['===== RESUME ====='];
    lines.push(`You are resuming task "${point.title}" after an interruption.`);
    lines.push(`Last checkpoint: #${checkpoint.index + 1} (${checkpoint.timestamp})`);
    lines.push('');

    if (checkpoint.progressSummary.stepsCompleted.length > 0) {
      lines.push('Steps already completed (do NOT redo these):');
      for (const step of checkpoint.progressSummary.stepsCompleted) {
        lines.push(`  ✓ ${step}`);
      }
      lines.push('');
    }

    if (checkpoint.progressSummary.filesModified.length > 0) {
      lines.push('Files already modified:');
      for (const file of checkpoint.progressSummary.filesModified) {
        lines.push(`  - ${file}`);
      }
      lines.push('');
    }

    if (checkpoint.remainingWork.length > 0) {
      lines.push('Remaining work:');
      for (const item of checkpoint.remainingWork) {
        lines.push(`  ○ ${item}`);
      }
      lines.push('');
    }

    lines.push('Continue from where you left off.');

    return lines.join('\n');
  }

  private static buildTaskSection(point: PlanPoint): string {
    const lines: string[] = ['===== TASK ====='];

    lines.push(`Task: ${point.title}`);

    if (point.goal) {
      lines.push(``, `Goal:`, point.goal);
    }

    lines.push(``, `Description:`, point.description);

    if (point.requirements && point.requirements.length > 0) {
      lines.push(``, `Requirements:`);
      for (const req of point.requirements) {
        lines.push(`  - ${req}`);
      }
    }

    if (point.successCriteria && point.successCriteria.length > 0) {
      lines.push(``, `Success Criteria:`);
      for (const crit of point.successCriteria) {
        lines.push(`  - ${crit}`);
      }
    }

    if (point.expectedFiles && point.expectedFiles.length > 0) {
      lines.push(``, `Expected files to create/modify:`);
      for (const file of point.expectedFiles) {
        lines.push(`  - ${file}`);
      }
    }

    return lines.join('\n');
  }

  private static buildProjectSection(info: ProjectContextInfo): string {
    const lines: string[] = ['===== PROJECT ====='];

    if (info.memoryBlock) {
      lines.push(info.memoryBlock);
    }

    if (info.fileTreeBlock) {
      lines.push(``, `File tree:`, info.fileTreeBlock);
    }

    if (info.vectorContext) {
      lines.push(``, `Relevant project context (from vector store):`, info.vectorContext);
    }

    return lines.join('\n');
  }

  private static buildSkillsSection(skills: SkillContext[]): string {
    const blocks = skills.map((s) => SkillContextBuilder.formatForPrompt(s));
    return `===== SKILLS =====\n${blocks.join('\n\n')}`;
  }

  private static buildToolResultsSection(
    references: ToolOutputReference[],
    resolved: Map<string, CachedToolOutput>,
  ): string {
    const lines: string[] = ['===== TOOL RESULTS ====='];

    for (const ref of references) {
      const output = resolved.get(ref.id);

      if (!output) {
        lines.push(`[${ref.tool}] ${ref.label || ref.id}: (not available)`);
        continue;
      }

      const label = ref.label || ref.id;
      lines.push(`[${ref.tool}] ${label} (${output.source}):`);

      // Truncate very long outputs to keep context lean
      const maxLen = 4000;
      const text =
        output.output.length > maxLen
          ? output.output.slice(0, maxLen) + '\n... (truncated)'
          : output.output;
      lines.push(text);
      lines.push('');
    }

    return lines.join('\n').trimEnd();
  }

  private static buildWorkspaceSection(ws: WorkspaceSnapshot): string {
    const lines: string[] = ['===== WORKSPACE SNAPSHOT ====='];

    if (ws.branch) {
      lines.push(`Branch: ${ws.branch}`);
    }

    if (ws.changedFiles.length > 0) {
      lines.push(``, `Changed files (${ws.pendingChangeCount} pending changes):`);
      for (const file of ws.changedFiles.slice(0, 20)) {
        lines.push(`  - ${file}`);
      }
      if (ws.changedFiles.length > 20) {
        lines.push(`  ... and ${ws.changedFiles.length - 20} more`);
      }
    } else {
      lines.push('No files changed yet.');
    }

    return lines.join('\n');
  }

  private static buildPlanContextSection(
    plan: Plan,
    point: PlanPoint,
    previousSummary?: string,
    plannerNotes?: string,
  ): string {
    const lines: string[] = ['===== PLAN CONTEXT ====='];

    // Show where the worker is in the overall plan
    lines.push('Overall plan progress:');
    for (const p of plan.points) {
      const marker =
        p.status === 'completed' ? '✓' :
        p.id === point.id ? '▶' :
        p.status === 'failed' ? '✗' :
        '○';
      lines.push(`  ${marker} ${p.title}`);
    }

    if (previousSummary) {
      lines.push(``, `Previously completed steps:`, previousSummary);
    }

    if (plannerNotes) {
      lines.push(``, `Planner notes:`, plannerNotes);
    }

    return lines.join('\n');
  }

  private static buildConstraintsSection(constraints: TaskConstraints): string {
    const lines: string[] = ['===== CONSTRAINTS ====='];

    if (constraints.doNotModify && constraints.doNotModify.length > 0) {
      lines.push('Do NOT modify:');
      for (const f of constraints.doNotModify) {
        lines.push(`  - ${f}`);
      }
    }

    if (constraints.doNotInstall && constraints.doNotInstall.length > 0) {
      lines.push('Do NOT install:');
      for (const p of constraints.doNotInstall) {
        lines.push(`  - ${p}`);
      }
    }

    if (constraints.additional && constraints.additional.length > 0) {
      lines.push('Additional constraints:');
      for (const c of constraints.additional) {
        lines.push(`  - ${c}`);
      }
    }

    return lines.join('\n');
  }

  private static buildUserRequestSection(userRequest: string): string {
    return `===== USER REQUEST =====\n${userRequest}`;
  }
}
