/**
 * Verification System
 *
 * Provides post-generation verification for AI-generated code:
 * - **Lint** — ESLint via WebContainer
 * - **Type Check** — TypeScript compiler via WebContainer
 * - **Flow Verification** — "Every Button Does Something" + "Every Screen is Connected"
 * - **Auto-Fix** — iterative AI-driven repair loop
 */

// Types
export type {
  CheckSeverity,
  VerificationError,
  FlowIssue,
  CustomCheck,
  PointVerification,
  LintResult,
  TypeCheckResult,
  FlowVerificationResult,
} from './types';

// Lint runner
export { runLint } from './lint-runner';

// Type-check runner
export { runTypeCheck } from './type-check-runner';

// Flow verifier
export { FlowVerifier } from './flow-verifier';

// Auto-fixer
export { autoFixer, AutoFixer } from './auto-fixer';
export type { AutoFixResult } from './auto-fixer';