/**
 * Planning Architecture Type Definitions
 *
 * The planning system breaks down complex tasks into sequential points,
 * each executed as an independent sub-chat with its own context window.
 * This dramatically reduces token consumption while maintaining coherence
 * through vector-store-backed context sharing.
 *
 * Flow:
 * 1. User gives a task -> AI creates a Plan with N PlanPoints
 * 2. Each PlanPoint is executed as a separate sub-chat (background)
 * 3. Sub-chats access project context via vector store (no full context dump)
 * 4. After each sub-chat, results are extracted and stored in vector DB
 * 5. Verification runs (lint, type-check, flow verification)
 * 6. AI returns to main chat with summary of what was done
 */

/*
 * ============================================================
 * Plan Point Status
 * ============================================================
 */

export type PlanPointStatus =
  | 'pending' // Not yet started
  | 'preparing' // Fetching tool outputs + invoking skills
  | 'in_progress' // Worker is executing
  | 'verifying' // Running lint/type-check/flow verification
  | 'waiting_for_tool' // Blocked waiting for a tool result
  | 'waiting_for_user' // Blocked waiting for user input
  | 'completed' // Successfully completed
  | 'failed' // Failed with error
  | 'skipped' // Skipped (dependency failed or not needed)
  | 'cancelled'; // Cancelled by user

/*
 * ============================================================
 * Plan Point
 * ============================================================
 */

/*
 * ============================================================
 * Task Contract (Immutable — created by the Planner AI)
 * ============================================================
 */

/**
 * A reference to a tool output that should be fetched and injected
 * into the worker's context. The planner emits *references*, not the
 * raw output — the runtime resolves them at execution time so the
 * plan JSON stays small.
 */
export interface ToolOutputReference {
  /**
   * The tool that produced (or will produce) this output.
   * Examples: 'search_docs', 'read_file', 'list_files', 'grep'
   */
  tool: string;

  /**
   * A stable identifier for this output so it can be cached and
   * looked up by the ToolOutputCache.
   */
  id: string;

  /**
   * Tool-specific arguments needed to reproduce the output.
   * Example: { path: 'src/services/AuthService.ts' } for read_file.
   */
  args?: Record<string, unknown>;

  /**
   * Optional human-readable label shown in the UI.
   */
  label?: string;
}

/**
 * Constraints that the worker must respect. Explicit boundaries make
 * workers behave much better than open-ended instructions.
 */
export interface TaskConstraints {
  /**
   * Files / paths the worker must NOT modify.
   */
  doNotModify?: string[];

  /**
   * Packages / dependencies the worker must NOT install.
   */
  doNotInstall?: string[];

  /**
   * Free-form constraints (e.g. "Don't change navigation").
   */
  additional?: string[];
}

/**
 * The immutable contract produced by the Planner AI for each task.
 * Stored once at plan-creation time and never mutated afterwards.
 * The mutable execution state lives separately (TaskExecutionState).
 */
export interface TaskContract {
  /**
   * Short, human-readable title.
   */
  title: string;

  /**
   * The high-level goal — one or two sentences describing what
   * "done" looks like for this task.
   */
  goal: string;

  /**
   * Detailed description / implementation notes.
   * This becomes the worker's primary user message.
   */
  description: string;

  /**
   * Explicit requirements the implementation must satisfy.
   */
  requirements: string[];

  /**
   * Success criteria — used by verification to decide if the task
   * is truly complete (not just "the AI said it's done").
   */
  successCriteria: string[];

  /**
   * Skills that should be invoked before the worker starts.
   * The planner decides which skills are relevant — only those
   * are loaded, keeping worker context lean.
   */
  requiredSkills: string[];

  /**
   * References to tool outputs that should be fetched and injected.
   * References, not raw output — resolved at runtime.
   */
  requiredToolOutputs: ToolOutputReference[];

  /**
   * Files this task is expected to create or modify.
   */
  expectedFiles: string[];

  /**
   * Verification checks to run after completion.
   */
  verificationChecks: VerificationCheckType[];

  /**
   * Explicit constraints / boundaries for the worker.
   */
  constraints?: TaskConstraints;
}

/*
 * ============================================================
 * Plan Point (extends Task Contract with execution metadata)
 * ============================================================
 */

export interface PlanPoint {
  /**
   * Unique identifier for this plan point.
   */
  id: string;

  /**
   * Human-readable title for this point.
   * Example: "Create Login Screen Component"
   */
  title: string;

  /**
   * Detailed description of what this point should accomplish.
   * The AI sub-chat receives this as its primary instruction.
   */
  description: string;

  /**
   * Current execution status.
   */
  status: PlanPointStatus;

  /**
   * Sequential order (0-indexed).
   */
  order: number;

  /**
   * IDs of plan points that must complete before this one starts.
   */
  dependencies: string[];

  /**
   * Files that this plan point is expected to create or modify.
   * Populated by the AI when creating the plan.
   * Used for verification (did the expected files change?).
   */
  expectedFiles: string[];

  /**
   * Verification checks to run after this point completes.
   * Default: ['lint', 'type_check', 'flow_verification']
   */
  verificationChecks: VerificationCheckType[];

  /**
   * The sub-chat associated with this plan point.
   * Contains the messages exchanged during execution.
   */
  subChat?: SubChat;

  /**
   * ISO 8601 timestamp of when this point started.
   */
  startedAt?: string;

  /**
   * ISO 8601 timestamp of when this point completed/failed.
   */
  completedAt?: string;

  /**
   * Error message if the point failed.
   */
  error?: string;

  /**
   * Summary of what was done (populated after completion).
   */
  summary?: string;

  /**
   * Verification results from post-completion checks.
   */
  verificationResults?: VerificationResult[];

  /*
   * ───────────────────────────────────────────────────────────
   * Task Contract fields (immutable, set by the Planner AI)
   * ───────────────────────────────────────────────────────────
   */

  /**
   * The high-level goal for this task (one or two sentences).
   */
  goal?: string;

  /**
   * Explicit requirements.
   */
  requirements?: string[];

  /**
   * Success criteria — used by verification.
   */
  successCriteria?: string[];

  /**
   * Skills to invoke before the worker starts.
   */
  requiredSkills?: string[];

  /**
   * References to tool outputs to fetch and inject.
   */
  requiredToolOutputs?: ToolOutputReference[];

  /**
   * Explicit constraints / boundaries.
   */
  constraints?: TaskConstraints;

  /**
   * Mutable execution state — owned by the runtime, updated as the
   * worker progresses. Separated from the immutable contract so the
   * plan JSON stays the single source of truth for *what* to do,
   * while this tracks *how far* we've gotten.
   */
  executionState?: TaskExecutionState;

  /**
   * Ordered list of checkpoints taken during execution.
   * Enables deterministic resume after interruption.
   */
  checkpoints?: Checkpoint[];
}

/*
 * ============================================================
 * Verification Types
 * ============================================================
 */

export type VerificationCheckType =
  | 'lint' // ESLint / style checking
  | 'type_check' // TypeScript type checking
  | 'flow_verification' // "Every button does something" + "Every screen is connected"
  | 'build_check'; // Does the project build successfully?

export interface VerificationResult {
  /**
   * The type of verification check.
   */
  type: VerificationCheckType;

  /**
   * Whether the check passed.
   */
  passed: boolean;

  /**
   * Human-readable result message.
   */
  message: string;

  /**
   * Specific issues found (if any).
   */
  issues?: VerificationIssue[];

  /**
   * ISO 8601 timestamp.
   */
  timestamp: string;
}

export interface VerificationIssue {
  /**
   * File path where the issue was found.
   */
  filePath: string;

  /**
   * Line number (if applicable).
   */
  line?: number;

  /**
   * Column number (if applicable).
   */
  column?: number;

  /**
   * Severity: error, warning, or info.
   */
  severity: 'error' | 'warning' | 'info';

  /**
   * Description of the issue.
   */
  message: string;

  /**
   * Suggested fix (if available).
   */
  suggestion?: string;
}

/*
 * ============================================================
 * Task Execution State (Mutable — owned by the runtime)
 * ============================================================
 */

/**
 * The mutable execution state for a single task. The AI NEVER creates
 * or writes this — the runtime updates it as the worker progresses.
 *
 * This is separated from the immutable TaskContract so that:
 *  - The contract (what to do) never changes.
 *  - The state (how far we've gotten) can be updated freely.
 *
 * On resume after an interruption, the runtime reads this state +
 * the latest checkpoint to reconstruct the worker's context
 * deterministically — no AI needed to "figure out" where it was.
 */
export interface TaskExecutionState {
  /**
   * Current execution status (more granular than PlanPointStatus
   * because it's runtime-owned, not AI-owned).
   */
  status: ExecutionStatus;

  /**
   * ISO 8601 timestamp of when execution started.
   */
  startedAt: string;

  /**
   * ISO 8601 timestamp of the last activity (tool call, checkpoint,
   * status change). Used to detect stale / interrupted tasks.
   */
  lastActivity: string;

  /**
   * Steps the worker has completed so far (human-readable).
   * Example: ["Updated LoginScreen.tsx", "Added AuthService.ts"]
   */
  completedSteps: string[];

  /**
   * IDs of tool calls made during this execution.
   * References ToolInvocationRecords stored in the sub-chat.
   */
  toolCallIds: string[];

  /**
   * Files that have been modified so far.
   */
  filesModified: string[];

  /**
   * Index of the latest checkpoint (0-based).
   * -1 means no checkpoint has been taken yet.
   */
  checkpointIndex: number;

  /**
   * Whether this task can be resumed after an interruption.
   * Set to false once the task reaches a terminal state
   * (completed / failed / cancelled).
   */
  canResume: boolean;

  /**
   * Human-readable reason explaining why the task can (or cannot)
   * be resumed. Shown in the UI and used by the ExecutionManager.
   */
  resumeReason?: string;

  /**
   * Number of retry attempts after failure.
   */
  retryCount: number;
}

export type ExecutionStatus =
  | 'pending'
  | 'preparing'
  | 'running'
  | 'waiting_for_tool'
  | 'waiting_for_user'
  | 'verifying'
  | 'completed'
  | 'failed'
  | 'cancelled';

/*
 * ============================================================
 * Checkpoint
 * ============================================================
 */

/**
 * A structured snapshot of a task's progress at a point in time.
 *
 * Unlike an AI-generated summary, a checkpoint is *structured data*:
 * which files changed, which tools were used, what's left to do.
 * This makes resume deterministic — the runtime reconstructs the
 * worker's context from the checkpoint + current file state, no
 * AI reasoning required.
 *
 * Checkpoints are taken:
 *  - Every N tool calls (configurable, default 3)
 *  - Before verification
 *  - On explicit request
 */
export interface Checkpoint {
  /**
   * Sequential index (0-based).
   */
  index: number;

  /**
   * ISO 8601 timestamp.
   */
  timestamp: string;

  /**
   * Files that changed since the previous checkpoint.
   */
  filesChanged: string[];

  /**
   * Tool calls made since the previous checkpoint.
   */
  toolsUsed: string[];

  /**
   * Structured progress summary (NOT free text from the AI).
   * Built by the CheckpointManager from observed state.
   */
  progressSummary: {
    stepsCompleted: string[];
    filesModified: string[];
    toolsCalled: number;
  };

  /**
   * What remains to be done (derived from the task contract's
   * requirements vs. what's been completed).
   */
  remainingWork: string[];

  /**
   * The sub-chat message index at the time of the checkpoint.
   * On resume, the worker continues from this message.
   */
  messageIndex: number;
}

/*
 * ============================================================
 * Skill Context (Structured output from invoked skills)
 * ============================================================
 */

/**
 * Every skill returns the SAME structure, so the worker always knows
 * how to consume a skill's output regardless of which skill it is.
 *
 * Skills are invoked BEFORE the worker starts, and only the skills
 * the planner marked as required are loaded — keeping worker context
 * lean. The skill's output becomes part of the worker's context as
 * a labeled section.
 */
export interface SkillContext {
  /**
   * The skill's identifier / name.
   */
  skillId: string;

  /**
   * Human-readable label.
   */
  label: string;

  /**
   * What this skill provides guidance on.
   */
  purpose: string;

  /**
   * Architectural notes / recommendations.
   */
  architectureNotes: string[];

  /**
   * Hard implementation rules the worker should follow.
   */
  implementationRules: string[];

  /**
   * Common pitfalls to avoid.
   */
  commonPitfalls: string[];

  /**
   * Recommended APIs / libraries / patterns.
   */
  recommendedApis: string[];

  /**
   * Code standards (formatting, naming, structure).
   */
  codeStandards: string[];

  /**
   * References (docs links, file paths, etc.).
   */
  references: string[];

  /**
   * Suggested tools the worker should invoke next.
   * Example: ["read_file:src/services/AuthService.ts", "search_docs:expo-auth-session"]
   */
  suggestedTools: string[];
}

/*
 * ============================================================
 * Sub-Chat
 * ============================================================
 */

export interface SubChat {
  /**
   * Unique identifier for this sub-chat.
   */
  id: string;

  /**
   * The plan point this sub-chat belongs to.
   */
  planPointId: string;

  /**
   * The project ID this sub-chat is working on.
   */
  projectId: string;

  /**
   * Messages exchanged in this sub-chat.
   * Uses the same Message type as the main chat (Vercel AI SDK).
   */
  messages: SubChatMessage[];

  /**
   * Tool invocations made during this sub-chat.
   * Stored separately for context extraction.
   */
  toolInvocations: ToolInvocationRecord[];

  /**
   * Files that were modified during this sub-chat.
   */
  modifiedFiles: string[];

  /**
   * ISO 8601 timestamps.
   */
  createdAt: string;
  updatedAt: string;
}

export interface SubChatMessage {
  id: string;
  role: 'user' | 'assistant' | 'system';
  content: string;

  /**
   * For assistant messages, the annotations (tool calls, etc.)
   */
  annotations?: any[];

  /**
   * For assistant messages with tool calls
   */
  toolInvocations?: any[];
}

export interface ToolInvocationRecord {
  toolName: string;
  args: Record<string, unknown>;
  result?: unknown;
  timestamp: string;
  success: boolean;
}

/*
 * ============================================================
 * Plan
 * ============================================================
 */

export type PlanStatus =
  | 'draft' // AI is still generating the plan
  | 'approved' // User approved (or auto-approved), execution can begin
  | 'executing' // Currently executing plan points
  | 'paused' // Execution paused (user intervention, error, etc.)
  | 'completed' // All points completed successfully
  | 'failed' // One or more points failed
  | 'cancelled'; // User cancelled the plan

export interface Plan {
  /**
   * Unique identifier.
   */
  id: string;

  /**
   * The project this plan belongs to.
   */
  projectId: string;

  /**
   * The chat ID where this plan was created.
   */
  chatId: string;

  /**
   * The original user request that triggered this plan.
   */
  userRequest: string;

  /**
   * AI-generated description of what this plan accomplishes.
   */
  description: string;

  /**
   * Current plan status.
   */
  status: PlanStatus;

  /**
   * Ordered list of plan points.
   */
  points: PlanPoint[];

  /**
   * Verification checks to run for every point (defaults).
   * Individual points can override these.
   */
  defaultVerificationChecks: VerificationCheckType[];

  /**
   * ISO 8601 timestamps.
   */
  createdAt: string;
  updatedAt: string;
  startedAt?: string;
  completedAt?: string;
}

/*
 * ============================================================
 * Plan Store (IndexedDB Persistence)
 * ============================================================
 */

export interface PlanStoreData {
  plans: Plan[];

  /**
   * Maps chatId -> planId for quick lookup.
   */
  chatToPlan: Record<string, string>;

  /**
   * Maps projectId -> planId[] for project history.
   */
  projectPlans: Record<string, string[]>;
}
