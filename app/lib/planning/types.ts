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

// ============================================================
// Plan Point Status
// ============================================================

export type PlanPointStatus =
  | 'pending'       // Not yet started
  | 'in_progress'   // Currently executing
  | 'verifying'     // Running lint/type-check/flow verification
  | 'completed'     // Successfully completed
  | 'failed'        // Failed with error
  | 'skipped';      // Skipped (dependency failed or not needed)

// ============================================================
// Plan Point
// ============================================================

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
}

// ============================================================
// Verification Types
// ============================================================

export type VerificationCheckType =
  | 'lint'              // ESLint / style checking
  | 'type_check'        // TypeScript type checking
  | 'flow_verification' // "Every button does something" + "Every screen is connected"
  | 'build_check';      // Does the project build successfully?

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

// ============================================================
// Sub-Chat
// ============================================================

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

// ============================================================
// Plan
// ============================================================

export type PlanStatus =
  | 'draft'       // AI is still generating the plan
  | 'approved'    // User approved (or auto-approved), execution can begin
  | 'executing'   // Currently executing plan points
  | 'paused'      // Execution paused (user intervention, error, etc.)
  | 'completed'   // All points completed successfully
  | 'failed'      // One or more points failed
  | 'cancelled';  // User cancelled the plan

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

// ============================================================
// Plan Store (IndexedDB Persistence)
// ============================================================

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