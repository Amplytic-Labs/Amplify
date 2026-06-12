import type { TypeCheckResult, VerificationError } from './types';

/**
 * Pattern for TypeScript error lines:
 *   src/file.ts(12,5): error TS2322: Type 'string' is not assignable to type 'number'
 *   src/file.ts:12:5 - error TS2322: ...
 *   src/file.ts(12,5): error TS7006: Parameter 'x' implicitly has an 'any' type.
 */
const TSC_ERROR_LINE_RE =
  /^(.+?)[\s(](\d+)[,;:](\d+)?[)]?\s*[:\-]\s*error\s+(TS\d+):\s*(.+)$/gm;

/**
 * Pattern for "error TSxxxx" without file location (e.g., in some tsc output formats)
 */
const TSC_BARE_ERROR_RE = /error (TS\d+): (.+)$/gm;

/**
 * Run TypeScript type checking in the WebContainer.
 *
 * Strategy:
 * 1. Check if tsconfig.json exists
 * 2. If no tsconfig, return a clean pass
 * 3. Run `npx tsc --noEmit 2>&1`
 * 4. Parse tsc output line-by-line using regex
 * 5. Return categorized results
 *
 * @param executeCommand - Function to execute shell commands in the WebContainer
 */
export async function runTypeCheck(
  executeCommand: (command: string) => Promise<{ stdout: string; stderr: string; exitCode: number }>,
): Promise<TypeCheckResult> {
  // 1. Check if tsconfig.json exists
  const configCheck = await executeCommand('test -f tsconfig.json && echo "found" || echo "missing"');

  if (configCheck.stdout.trim() !== 'found') {
    // No tsconfig — skip gracefully
    return { passed: true, errors: [] };
  }

  // 2. Run tsc --noEmit
  let result: { stdout: string; stderr: string; exitCode: number };
  try {
    result = await executeCommand('npx tsc --noEmit 2>&1');
  } catch (err) {
    return {
      passed: false,
      errors: [
        {
          message: `TypeScript check failed to execute: ${err instanceof Error ? err.message : String(err)}`,
          filePath: '',
          severity: 'error',
          category: 'type-check',
        },
      ],
      rawOutput: String(err),
    };
  }

  const rawOutput = result.stdout || result.stderr || '';

  // Exit code 0 means no type errors
  if (result.exitCode === 0 && !rawOutput.trim()) {
    return { passed: true, errors: [] };
  }

  // 3. Parse tsc output
  const errors: VerificationError[] = [];

  // Reset lastIndex since we reuse the regex
  TSC_ERROR_LINE_RE.lastIndex = 0;
  let match: RegExpExecArray | null;

  while ((match = TSC_ERROR_LINE_RE.exec(rawOutput)) !== null) {
    const [, filePath, lineStr, colStr, code, message] = match;
    errors.push({
      message: `${code}: ${message}`,
      filePath: filePath.trim(),
      line: lineStr ? parseInt(lineStr, 10) : undefined,
      column: colStr ? parseInt(colStr, 10) : undefined,
      severity: 'error',
      category: 'type-check',
    });
  }

  // If no structured errors were found but we have output and a non-zero exit code,
  // try the bare error format
  if (errors.length === 0 && result.exitCode !== 0) {
    TSC_BARE_ERROR_RE.lastIndex = 0;
    while ((match = TSC_BARE_ERROR_RE.exec(rawOutput)) !== null) {
      const [, code, message] = match;
      errors.push({
        message: `${code}: ${message}`,
        filePath: '',
        severity: 'error',
        category: 'type-check',
      });
    }
  }

  // Final fallback: if we still have nothing but exit code is non-zero, add a generic error
  if (errors.length === 0 && result.exitCode !== 0) {
    errors.push({
      message: 'TypeScript type check failed (see raw output for details)',
      filePath: '',
      severity: 'error',
      category: 'type-check',
      context: rawOutput.slice(0, 500),
    });
  }

  return {
    passed: errors.length === 0,
    errors,
    rawOutput,
  };
}