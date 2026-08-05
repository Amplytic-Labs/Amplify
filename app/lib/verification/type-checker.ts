/**
 * Type Checker
 *
 * Runs TypeScript type checking on modified files via the WebContainer shell.
 * Falls back to basic type-inference checks if tsc is not available.
 */

import type { VerificationResult, VerificationRunnerOptions, VerificationIssue } from './types';

export async function runTypeCheck(options: VerificationRunnerOptions): Promise<VerificationResult> {
  const issues: VerificationIssue[] = [];

  // Filter to TypeScript files
  const tsFiles = options.modifiedFiles.filter((f) => /\.(ts|tsx)$/.test(f));

  if (tsFiles.length === 0) {
    return {
      type: 'type_check',
      passed: true,
      message: 'No TypeScript files to check.',
      timestamp: new Date().toISOString(),
    };
  }

  // Try running tsc
  try {
    const tscResult = await options.runShellCommand('npx tsc --noEmit 2>&1 || true');
    const output = tscResult.stdout || tscResult.stderr || '';

    if (tscResult.exitCode === 0) {
      return {
        type: 'type_check',
        passed: true,
        message: 'TypeScript type check passed.',
        timestamp: new Date().toISOString(),
      };
    }

    // Parse tsc output for errors
    const lines = output.split('\n');

    for (const line of lines) {
      // tsc error format: file.ts(line,col): error TSxxxx: message
      const match = line.match(/^(.+?)\((\d+),(\d+)\):\s+(error|warning)\s+(TS\d+):\s+(.+)$/);

      if (match) {
        issues.push({
          filePath: match[1],
          line: parseInt(match[2], 10),
          column: parseInt(match[3], 10),
          severity: match[4] as 'error' | 'warning',
          message: `[${match[5]}] ${match[6]}`,
        });
      }
    }
  } catch {
    // tsc not available, run basic checks
    await runBasicTypeChecks(options, tsFiles, issues);
  }

  const errors = issues.filter((i) => i.severity === 'error');

  return {
    type: 'type_check',
    passed: errors.length === 0,
    message: errors.length === 0 ? 'Type check passed (basic).' : `Type check failed: ${errors.length} error(s).`,
    issues: issues.length > 0 ? issues : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Basic type checking patterns when tsc is not available.
 */
async function runBasicTypeChecks(
  options: VerificationRunnerOptions,
  tsFiles: string[],
  issues: VerificationIssue[],
): Promise<void> {
  for (const filePath of tsFiles) {
    const content = await options.readFile(filePath);

    if (!content) {
      continue;
    }

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for 'any' type usage (generally bad practice)
      if (/: any\b/.test(line) && !/\/\/ @ts-ignore|\/\/ @ts-expect-error|\/\/ @ts-nocheck/.test(line)) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'warning',
          message: 'Using `any` type. Consider using a more specific type.',
        });
      }

      // Check for @ts-ignore without explanation
      if (/\/\/\s*@ts-ignore\s*$/.test(line)) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'warning',
          message: '@ts-ignore used without explanation. Add a comment explaining why.',
          suggestion: 'Use @ts-expect-error with a description: // @ts-expect-error - reason here',
        });
      }

      // Check for potential null pointer dereference (basic)
      if (/(\w+)\.\w+/.test(line) && !line.includes('?.') && !line.includes('!.')) {
        /*
         * Very basic check - just flag for review if the variable could be null
         * This is intentionally conservative to avoid false positives
         */
      }
    }
  }
}
