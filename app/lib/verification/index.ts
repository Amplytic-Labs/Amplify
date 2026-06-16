/**
 * Verification System - Barrel Export
 */

export { runVerification } from './runner';
export { runLintCheck } from './lint-checker';
export { runTypeCheck } from './type-checker';
export { runFlowVerification } from './flow-verifier';
export type { VerificationResult, VerificationIssue, VerificationRunnerOptions } from './types';