/**
 * Verification System Types
 *
 * Base types are defined here and will be re-exported from ../planning/types
 * once that module is created. For now, they live here as the source of truth.
 */

// ─── Base types (will move to ../planning/types) ─────────────────────────────

export type CheckSeverity = 'error' | 'warning' | 'info';

export interface VerificationError {
  /** Human-readable error message */
  message: string;
  /** File path where the issue was found */
  filePath: string;
  /** 1-based line number */
  line?: number;
  /** 1-based column number */
  column?: number;
  /** Severity level */
  severity: CheckSeverity;
  /** The category of check that produced this error */
  category: 'lint' | 'type-check' | 'flow-button' | 'flow-screen' | 'custom';
  /** Raw context around the error for display */
  context?: string;
}

export interface FlowIssue {
  /** Human-readable description of the issue */
  message: string;
  /** The specific check that found this issue */
  check: 'button-no-handler' | 'button-stub-handler' | 'screen-unreachable' | 'link-target-missing' | 'dead-route';
  /** File path where the issue was found */
  filePath: string;
  /** 1-based line number */
  line?: number;
  /** Severity level */
  severity: CheckSeverity;
  /** Suggested fix, if auto-detectable */
  suggestion?: string;
}

export interface CustomCheck {
  /** Unique identifier for this check */
  id: string;
  /** Human-readable name shown in UI */
  name: string;
  /** Description of what this check validates */
  description: string;
  /** The check function — returns an array of issues (empty = pass) */
  fn: (files: Record<string, { content: string }>) => Promise<FlowIssue[]>;
}

export interface PointVerification {
  /** Overall pass/fail */
  passed: boolean;
  /** Lint results, if run */
  lint?: LintResult;
  /** Type-check results, if run */
  typeCheck?: TypeCheckResult;
  /** Flow verification results, if run */
  flow?: FlowVerificationResult;
  /** Results from custom checks */
  customChecks?: { checkId: string; issues: FlowIssue[] }[];
  /** Timestamp of when this verification ran */
  timestamp: number;
}

// ─── Result types ────────────────────────────────────────────────────────────

export interface LintResult {
  passed: boolean;
  errors: VerificationError[];
  warnings: VerificationError[];
  rawOutput?: string;
}

export interface TypeCheckResult {
  passed: boolean;
  errors: VerificationError[];
  rawOutput?: string;
}

export interface FlowVerificationResult {
  passed: boolean;
  issues: FlowIssue[];
  /** Total number of buttons/interactive elements scanned */
  buttonsChecked: number;
  /** Number of buttons that have real (non-stub) handlers */
  buttonsWithActions: number;
  /** Total number of screens/routes found */
  screensChecked: number;
  /** Number of screens reachable from at least one other screen */
  screensReachable: number;
}