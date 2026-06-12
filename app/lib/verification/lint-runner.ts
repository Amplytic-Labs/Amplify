import type { LintResult, VerificationError } from './types';

/**
 * Run ESLint on specified files in the WebContainer.
 *
 * Strategy:
 * 1. Check if ESLint is configured (look for .eslintrc*, eslint.config.*)
 * 2. If no config, return a clean pass — we don't want to fail on unconfigured projects
 * 3. Run `npx eslint <files> --format json 2>&1`
 * 4. Parse the JSON output and categorize errors (severity 2) vs warnings (severity 1)
 *
 * @param filePaths - Array of file paths to lint (relative to the project root inside WebContainer)
 * @param executeCommand - Function that runs a shell command in the WebContainer
 */
export async function runLint(
  filePaths: string[],
  executeCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
): Promise<LintResult> {
  if (filePaths.length === 0) {
    return { passed: true, errors: [], warnings: [] };
  }

  // 1. Check for ESLint configuration files
  const configCheckResult = await executeCommand(
    'ls -1 .eslintrc* .eslintrc.* eslint.config.* 2>/dev/null || true',
  );

  const hasConfig = configCheckResult.stdout.trim().length > 0;

  if (!hasConfig) {
    // No ESLint config — skip gracefully
    return { passed: true, errors: [], warnings: [] };
  }

  // 2. Build the ESLint command
  const escapedFiles = filePaths.map((f) => `"${f}"`).join(' ');
  const command = `npx eslint ${escapedFiles} --format json 2>&1`;

  // 3. Execute
  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await executeCommand(command);
  } catch (err) {
    return {
      passed: false,
      errors: [
        {
          message: `ESLint execution failed: ${err instanceof Error ? err.message : String(err)}`,
          filePath: '',
          severity: 'error',
          category: 'lint',
        },
      ],
      warnings: [],
      rawOutput: String(err),
    };
  }

  const rawOutput = result.stdout || result.stderr;

  // 4. Parse JSON output
  // ESLint --format json outputs an array of file results (possibly wrapped in npm noise)
  let lintResults: Array<{
    filePath: string;
    messages: Array<{
      ruleId: string | null;
      severity: number; // 1 = warning, 2 = error
      message: string;
      line: number;
      column: number;
    }>;
  }>;

  try {
    // ESLint JSON output may be preceded/followed by npm noise (e.g., "Need to install..." warnings)
    // Try to extract the JSON array from the raw output
    const jsonMatch = rawOutput.match(/\[[\s\S]*\]/);
    if (!jsonMatch) {
      // No JSON array found — could mean no lint issues or eslint wasn't ready
      // If exit code is 0, it's a clean pass
      if (result.exitCode === 0) {
        return { passed: true, errors: [], warnings: [], rawOutput };
      }

      return {
        passed: false,
        errors: [
          {
            message: 'ESLint output could not be parsed as JSON',
            filePath: '',
            severity: 'error',
            category: 'lint',
          },
        ],
        warnings: [],
        rawOutput,
      };
    }

    lintResults = JSON.parse(jsonMatch[0]);
  } catch {
    // JSON parse failed — if exit code is 0, likely clean
    if (result.exitCode === 0) {
      return { passed: true, errors: [], warnings: [], rawOutput };
    }

    return {
      passed: false,
      errors: [
        {
          message: `Failed to parse ESLint JSON output`,
          filePath: '',
          severity: 'error',
          category: 'lint',
        },
      ],
      warnings: [],
      rawOutput,
    };
  }

  // 5. Categorize messages into errors and warnings
  const errors: VerificationError[] = [];
  const warnings: VerificationError[] = [];

  for (const fileResult of lintResults) {
    for (const msg of fileResult.messages) {
      const error: VerificationError = {
        message: msg.ruleId ? `${msg.ruleId}: ${msg.message}` : msg.message,
        filePath: fileResult.filePath,
        line: msg.line,
        column: msg.column,
        severity: msg.severity === 2 ? 'error' : 'warning',
        category: 'lint',
      };

      if (msg.severity === 2) {
        errors.push(error);
      } else {
        warnings.push(error);
      }
    }
  }

  return {
    passed: errors.length === 0,
    errors,
    warnings,
    rawOutput,
  };
}