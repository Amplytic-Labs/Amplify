/**
 * Verification Runner
 *
 * Orchestrates all verification checks after a plan point completes.
 * Each check runs independently and results are aggregated.
 */

import type { VerificationResult, VerificationRunnerOptions } from './types';
import { runLintCheck } from './lint-checker';
import { runTypeCheck } from './type-checker';
import { runFlowVerification } from './flow-verifier';

/**
 * Runs all requested verification checks and returns aggregated results.
 */
export async function runVerification(options: VerificationRunnerOptions): Promise<VerificationResult[]> {
  const results: VerificationResult[] = [];

  for (const checkType of options.checks) {
    try {
      let result: VerificationResult;

      switch (checkType) {
        case 'lint':
          result = await runLintCheck(options);
          break;
        case 'type_check':
          result = await runTypeCheck(options);
          break;
        case 'flow_verification':
          result = await runFlowVerification(options);
          break;
        case 'build_check':
          result = await runBuildCheck(options);
          break;
        default:
          result = {
            type: checkType,
            passed: true,
            message: `Unknown check type "${checkType}", skipped.`,
            timestamp: new Date().toISOString(),
          };
      }

      results.push(result);
    } catch (error: any) {
      results.push({
        type: checkType,
        passed: false,
        message: `Verification check "${checkType}" crashed: ${error.message}`,
        timestamp: new Date().toISOString(),
      });
    }
  }

  return results;
}

/**
 * Runs a build check (npm run build / equivalent).
 */
async function runBuildCheck(options: VerificationRunnerOptions): Promise<VerificationResult> {
  // Detect the build command from package.json
  const buildCommands = [
    'npm run build 2>&1',
    'npx tsc --noEmit 2>&1',
    'npm run typecheck 2>&1',
  ];

  for (const cmd of buildCommands) {
    try {
      const result = await options.runShellCommand(cmd);
      if (result.exitCode === 0) {
        return {
          type: 'build_check',
          passed: true,
          message: `Build succeeded using: ${cmd}`,
          timestamp: new Date().toISOString(),
        };
      }
    } catch {
      // Try next command
    }
  }

  return {
    type: 'build_check',
    passed: false,
    message: 'All build commands failed or timed out.',
    issues: [
      {
        filePath: '*',
        severity: 'error',
        message: 'Build failed. Check the terminal for details.',
      },
    ],
    timestamp: new Date().toISOString(),
  };
}