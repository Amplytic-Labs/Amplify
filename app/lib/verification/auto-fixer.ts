import type { PointVerification, VerificationError, FlowIssue } from './types';

/**
 * Result of an auto-fix attempt.
 */
export interface AutoFixResult {
  /** Whether all issues were resolved */
  fixed: boolean;
  /** Number of fix iterations attempted */
  attempts: number;
  /** The final verification result after all attempts */
  finalVerification: PointVerification;
  /** Human-readable messages describing what was attempted/fixed */
  fixMessages: string[];
}

/**
 * AutoFixer — feeds verification errors back to the AI for auto-repair.
 *
 * When verification fails, this builds a diagnostic prompt that gets sent
 * back to the AI as a follow-up in the sub-chat. The AI then produces
 * corrected code, which is re-verified.
 *
 * Usage:
 * ```ts
 * const result = await autoFixer.attemptFix(
 *   verificationResult,
 *   3, // max attempts
 *   (prompt) => sendToAI(prompt), // AI call
 *   () => runFullVerification(),   // re-verify
 * );
 * if (!result.fixed) {
 *   // Show remaining issues to user
 * }
 * ```
 */
export class AutoFixer {
  /**
   * Attempt to auto-fix verification issues.
   *
   * @param issues - The current verification result
   * @param maxAttempts - Maximum fix iterations (default 3)
   * @param callAI - Function to send a fix prompt to the AI and get the response
   * @param reVerify - Function to re-run verification after the fix
   */
  async attemptFix(
    issues: PointVerification,
    maxAttempts: number = 3,
    callAI: (fixPrompt: string) => Promise<string>,
    reVerify: () => Promise<PointVerification>,
  ): Promise<AutoFixResult> {
    const fixMessages: string[] = [];
    let currentVerification = issues;
    let attempt = 0;

    for (attempt = 1; attempt <= maxAttempts; attempt++) {
      if (currentVerification.passed) {
        break;
      }

      const fixPrompt = this.buildFixPrompt(currentVerification);
      fixMessages.push(`Attempt ${attempt}: Sending fix request with ${this.countIssues(currentVerification)} issue(s)`);

      try {
        const aiResponse = await callAI(fixPrompt);
        fixMessages.push(`Attempt ${attempt}: AI responded (${aiResponse.length} chars)`);

        // The caller is expected to have applied the AI's code changes
        // before reVerify is called. This is typically handled by the
        // action runner that processes the AI response.
        currentVerification = await reVerify();
        fixMessages.push(
          `Attempt ${attempt}: Re-verification ${currentVerification.passed ? 'PASSED' : `FAILED (${this.countIssues(currentVerification)} issue(s) remain)`}`,
        );
      } catch (err) {
        fixMessages.push(
          `Attempt ${attempt}: Error during fix — ${err instanceof Error ? err.message : String(err)}`,
        );
        break;
      }
    }

    return {
      fixed: currentVerification.passed,
      attempts: attempt,
      finalVerification: currentVerification,
      fixMessages,
    };
  }

  /**
   * Build a fix prompt from verification results.
   *
   * This produces a structured message that the AI can use to understand
   * and fix the issues.
   */
  buildFixPrompt(issues: PointVerification): string {
    const sections: string[] = [];

    sections.push(
      '## Verification Failed — Auto-Fix Required\n\n' +
        'The following issues were detected after code generation. ' +
        'Please fix all of the listed issues by outputting the corrected files.\n',
    );

    // Lint issues
    if (issues.lint && (issues.lint.errors.length > 0 || issues.lint.warnings.length > 0)) {
      sections.push('### ESLint Issues\n');

      if (issues.lint.errors.length > 0) {
        sections.push('**Errors:**\n');
        for (const err of issues.lint.errors) {
          sections.push(this.formatVerificationError(err));
        }
      }

      if (issues.lint.warnings.length > 0) {
        sections.push('**Warnings:**\n');
        for (const warn of issues.lint.warnings) {
          sections.push(this.formatVerificationError(warn));
        }
      }
    }

    // Type check issues
    if (issues.typeCheck && issues.typeCheck.errors.length > 0) {
      sections.push('### TypeScript Type Errors\n');
      for (const err of issues.typeCheck.errors) {
        sections.push(this.formatVerificationError(err));
      }
    }

    // Flow issues
    if (issues.flow && issues.flow.issues.length > 0) {
      sections.push('### Flow Issues\n');
      for (const issue of issues.flow.issues) {
        sections.push(this.formatFlowIssue(issue));
      }
    }

    // Custom check issues
    if (issues.customChecks) {
      for (const checkResult of issues.customChecks) {
        if (checkResult.issues.length > 0) {
          sections.push(`### Custom Check: ${checkResult.checkId}\n`);
          for (const issue of checkResult.issues) {
            sections.push(this.formatFlowIssue(issue));
          }
        }
      }
    }

    // Closing instruction
    sections.push(
      '\n---\n\n' +
        '**Instructions:**\n' +
        '1. Fix ALL the issues listed above\n' +
        '2. Output the complete corrected file(s)\n' +
        '3. Do not introduce new issues\n' +
        '4. Preserve all existing functionality\n',
    );

    return sections.join('\n');
  }

  /**
   * Format a VerificationError into a readable string.
   */
  private formatVerificationError(err: VerificationError): string {
    const loc = err.line ? `${err.filePath}:${err.line}${err.column ? `:${err.column}` : ''}` : err.filePath;
    const context = err.context ? `\n   Context: ${err.context}` : '';
    return `- [${err.severity.toUpperCase()}] ${loc}: ${err.message}${context}`;
  }

  /**
   * Format a FlowIssue into a readable string.
   */
  private formatFlowIssue(issue: FlowIssue): string {
    const loc = issue.line ? `${issue.filePath}:${issue.line}` : issue.filePath;
    const suggestion = issue.suggestion ? `\n   Suggestion: ${issue.suggestion}` : '';
    return `- [${issue.severity.toUpperCase()}] [${issue.check}] ${loc}: ${issue.message}${suggestion}`;
  }

  /**
   * Count total issues in a PointVerification.
   */
  private countIssues(v: PointVerification): number {
    let count = 0;
    if (v.lint) {
      count += v.lint.errors.length + v.lint.warnings.length;
    }
    if (v.typeCheck) {
      count += v.typeCheck.errors.length;
    }
    if (v.flow) {
      count += v.flow.issues.length;
    }
    if (v.customChecks) {
      for (const check of v.customChecks) {
        count += check.issues.length;
      }
    }
    return count;
  }
}

/** Singleton instance for convenience. */
export const autoFixer = new AutoFixer();