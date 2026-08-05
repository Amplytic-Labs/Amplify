/**
 * Verification System Type Definitions
 *
 * The verification system enforces three core rules after each
 * plan point implementation:
 *
 * 1. Lint Check: Runs ESLint (or equivalent) on modified files
 * 2. Type Check: Runs TypeScript compiler (or equivalent) on modified files
 * 3. Flow Verification:
 *    a. "Every button does something" — scans for onClick/onChange/onSubmit handlers
 *       that are empty, call undefined functions, or are no-ops.
 *    b. "Every screen is connected" — scans route definitions and navigation
 *       to ensure newly created screens are reachable.
 */

export interface VerificationRunnerOptions {
  /** Files that were modified in this plan point */
  modifiedFiles: string[];

  /** Which verification checks to run */
  checks: Array<'lint' | 'type_check' | 'flow_verification' | 'build_check'>;

  /** Function to run shell commands in WebContainer */
  runShellCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>;

  /** Function to read file content */
  readFile: (path: string) => Promise<string | null>;

  /** Function to list all files */
  listFiles: () => Promise<string[]>;

  /** Project ID (for storing results in vector DB) */
  projectId: string;

  /** Plan point ID (for storing results) */
  planPointId: string;
}

export interface VerificationIssue {
  filePath: string;
  line?: number;
  column?: number;
  severity: 'error' | 'warning' | 'info';
  message: string;
  suggestion?: string;
}

export type VerificationCheckType = 'lint' | 'type_check' | 'flow_verification' | 'build_check';

export interface VerificationResult {
  type: VerificationCheckType;
  passed: boolean;
  message: string;
  issues?: VerificationIssue[];
  timestamp: string;
}
