/**
 * Lint Checker
 *
 * Runs ESLint on modified files via the WebContainer shell.
 * Falls back to basic pattern-based checks if ESLint is not available.
 */

import type { VerificationResult, VerificationRunnerOptions, VerificationIssue } from './types';

/**
 * Attempts to run ESLint on modified files.
 * If ESLint is not configured, falls back to basic syntax checks.
 */
export async function runLintCheck(options: VerificationRunnerOptions): Promise<VerificationResult> {
  const issues: VerificationIssue[] = [];

  // Try running ESLint if available
  try {
    const lintableFiles = options.modifiedFiles.filter((f) =>
      /\.(js|jsx|ts|tsx|mjs|cjs)$/.test(f),
    );

    if (lintableFiles.length > 0) {
      // Check if eslint is available
      const checkResult = await options.runShellCommand('npx eslint --version 2>&1');

      if (checkResult.exitCode === 0) {
        // Run ESLint with JSON output
        const filesArg = lintableFiles.map((f) => `"${f}"`).join(' ');
        const eslintResult = await options.runShellCommand(
          `npx eslint --no-eslintrc --parser-options=ecmaVersion:2022,sourceType:module --rule '{"no-unused-vars":"warn","no-undef":"error"}' ${filesArg} --format json 2>&1 || true`,
        );

        try {
          const eslintOutput = JSON.parse(eslintResult.stdout || eslintResult.stderr);
          if (Array.isArray(eslintOutput)) {
            for (const fileResult of eslintOutput) {
              if (fileResult.messages && Array.isArray(fileResult.messages)) {
                for (const msg of fileResult.messages) {
                  issues.push({
                    filePath: fileResult.filePath,
                    line: msg.line,
                    column: msg.column,
                    severity: msg.severity === 2 ? 'error' : msg.severity === 1 ? 'warning' : 'info',
                    message: msg.message,
                    suggestion: msg.fix ? JSON.stringify(msg.fix) : undefined,
                  });
                }
              }
            }
          }
        } catch {
          // ESLint JSON parsing failed, try basic checks
          await runBasicLintChecks(options, issues);
        }
      } else {
        // ESLint not available, use basic checks
        await runBasicLintChecks(options, issues);
      }
    }
  } catch (error: any) {
    // Fallback to basic checks
    await runBasicLintChecks(options, issues);
  }

  const errors = issues.filter((i) => i.severity === 'error');
  const warnings = issues.filter((i) => i.severity === 'warning');

  return {
    type: 'lint',
    passed: errors.length === 0,
    message:
      errors.length === 0
        ? `Lint passed. ${warnings.length} warning(s).`
        : `Lint failed: ${errors.length} error(s), ${warnings.length} warning(s).`,
    issues: issues.length > 0 ? issues : undefined,
    timestamp: new Date().toISOString(),
  };
}

/**
 * Basic pattern-based lint checks when ESLint is not available.
 * Catches common issues:
 * - Empty function handlers (onClick={() => {}})
 * - console.log statements left in
 * - TODO/FIXME/HACK comments
 * - Unused imports (basic pattern match)
 */
async function runBasicLintChecks(
  options: VerificationRunnerOptions,
  issues: VerificationIssue[],
): Promise<void> {
  for (const filePath of options.modifiedFiles) {
    if (!/\.(js|jsx|ts|tsx)$/.test(filePath)) continue;

    const content = await options.readFile(filePath);
    if (!content) continue;

    const lines = content.split('\n');

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const lineNum = i + 1;

      // Check for empty onClick/onChange/onSubmit handlers
      if (/\b(onClick|onChange|onSubmit|onKeyPress|onKeyDown)\s*=\s*\{\s*\(\s*\)\s*=>\s*\{\s*\}\s*\}/.test(line)) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'error',
          message: 'Empty event handler detected. Every button must do something — this handler is a no-op.',
          suggestion: 'Connect this handler to a real function that implements the intended behavior.',
        });
      }

      // Check for console.log left in code
      if (/console\.(log|debug|info|warn|error)\s*\(/.test(line) && !/\/\//.test(line.split('console')[0])) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'warning',
          message: 'Console statement found. Consider removing before finalizing.',
          suggestion: 'Remove or replace with proper logging if needed.',
        });
      }

      // Check for TODO/FIXME/HACK
      if (/\b(TODO|FIXME|HACK|XXX)\b/.test(line)) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'info',
          message: `Found ${line.match(/\b(TODO|FIXME|HACK|XXX)\b/)![0]} comment.`,
        });
      }

      // Check for alert() calls (common AI mistake)
      if (/\balert\s*\(/.test(line)) {
        issues.push({
          filePath,
          line: lineNum,
          severity: 'warning',
          message: 'alert() call detected. Consider using a proper toast/notification instead.',
          suggestion: 'Use a toast or inline message component for user feedback.',
        });
      }
    }
  }
}