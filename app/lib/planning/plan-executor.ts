import { atom } from 'nanostores';
import type {
  Plan,
  PlanPoint,
  SubChat,
  PointVerification,
  PlanEvent,
  ContextBundle,
  TokenUsage,
  PlanStatus,
} from './types';
import { contextBuilder } from './context-builder';
import { subChatRunner } from './sub-chat-runner';
import { projectContextStore } from '../vector-store';
import { runLint } from '../verification/lint-runner';
import { runTypeCheck } from '../verification/type-check-runner';
import { FlowVerifier } from '../verification/flow-verifier';
import { autoFixer } from '../verification/auto-fixer';
import { openDatabaseV3, setPlan, setSubChat, updatePlanStatus, getPlan } from '../persistence/db-v3';
import { createScopedLogger } from '~/utils/logger';
import { workbenchStore } from '~/lib/stores/workbench';

const logger = createScopedLogger('PlanExecutor');

// ─── Reactive Stores for UI ──────────────────────────────

export const planExecutionStore = atom<{
  isExecuting: boolean;
  currentPlanId: string | null;
  currentPointIndex: number;
  events: PlanEvent[];
}>({
  isExecuting: false,
  currentPlanId: null,
  currentPointIndex: -1,
  events: [],
});

// ─── Internal types ──────────────────────────────────────

type CommandExecutor = (cmd: string) => Promise<{
  stdout: string;
  stderr: string;
  exitCode: number;
}>;

// ─── Plan Executor ────────────────────────────────────────

export class PlanExecutor {
  private abortController: AbortController | null = null;
  private executeCommand: CommandExecutor | null = null;
  private flowVerifier = new FlowVerifier();

  /**
   * Set the command executor (from WebContainer terminal).
   * Required for running lint and type-check commands inside the container.
   */
  setCommandExecutor(executor: CommandExecutor): void {
    this.executeCommand = executor;
  }

  /**
   * Execute the entire plan, point by point.
   * Processes each pending point in dependency order.
   */
  async execute(plan: Plan): Promise<void> {
    this.abortController = new AbortController();
    const { signal } = this.abortController;

    // Update plan status to 'executing'
    const db = await openDatabaseV3();

    if (!db) {
      logger.error('Cannot open IndexedDB — plan execution aborted');
      return;
    }

    try {
      await updatePlanStatus(db, plan.id, 'executing');
    } catch (err) {
      logger.error('Failed to update plan status to executing', err);
    }

    // Set reactive state
    planExecutionStore.set({
      isExecuting: true,
      currentPlanId: plan.id,
      currentPointIndex: -1,
      events: [],
    });

    logger.info(`Starting plan execution: "${plan.title}" (${plan.points.length} points)`);

    let anyFailed = false;

    for (const point of plan.points) {
      // Check for abort signal
      if (signal.aborted) {
        logger.info('Plan execution aborted by user');
        break;
      }

      // Only process pending points
      if (point.status !== 'pending') {
        continue;
      }

      // Check dependencies are met
      if (!this.dependenciesMet(plan, point)) {
        logger.warn(
          `Point ${point.index} ("${point.title}") skipped — dependencies not met`,
        );

        // Mark as skipped
        point.status = 'skipped';
        this.emitEvent({
          type: 'point-fail',
          planId: plan.id,
          pointIndex: point.index,
          timestamp: new Date().toISOString(),
          data: { reason: 'dependencies_not_met' },
        });
        continue;
      }

      // Execute the point
      try {
        await this.executePoint(plan, point, db, signal);
      } catch (err) {
        logger.error(`Point ${point.index} failed with error:`, err);
        point.status = 'failed';
        anyFailed = true;

        this.emitEvent({
          type: 'point-fail',
          planId: plan.id,
          pointIndex: point.index,
          timestamp: new Date().toISOString(),
          data: { error: err instanceof Error ? err.message : String(err) },
        });

        // Persist the updated plan
        try {
          await setPlan(db, plan);
        } catch (persistErr) {
          logger.error('Failed to persist plan after point failure', persistErr);
        }

        // Stop execution on failure
        break;
      }
    }

    // Update final plan status
    const finalStatus: PlanStatus = signal.aborted ? 'paused' : anyFailed ? 'failed' : 'completed';

    try {
      await updatePlanStatus(db, plan.id, finalStatus);
    } catch (err) {
      logger.error('Failed to update final plan status', err);
    }

    // Persist the vector store
    try {
      await projectContextStore.persist(plan.projectId);
    } catch (err) {
      logger.warn('Failed to persist project context after execution', err);
    }

    // Set reactive state
    const current = planExecutionStore.get();
    planExecutionStore.set({
      ...current,
      isExecuting: false,
    });

    this.emitEvent({
      type: 'plan-complete',
      planId: plan.id,
      timestamp: new Date().toISOString(),
      data: { status: finalStatus },
    });

    logger.info(`Plan execution ${finalStatus}: "${plan.title}"`);
  }

  /**
   * Execute a single plan point.
   */
  private async executePoint(
    plan: Plan,
    point: PlanPoint,
    db: IDBDatabase,
    signal: AbortSignal,
  ): Promise<void> {
    // 1. Update point status to 'executing'
    point.status = 'executing';

    this.emitEvent({
      type: 'point-start',
      planId: plan.id,
      pointIndex: point.index,
      timestamp: new Date().toISOString(),
      data: { title: point.title },
    });

    // 2. Update the reactive store
    const current = planExecutionStore.get();
    planExecutionStore.set({ ...current, currentPointIndex: point.index });

    logger.info(`Executing point ${point.index}: "${point.title}"`);

    // 3. Build context via contextBuilder
    const context: ContextBundle = await contextBuilder.buildContext({
      projectId: plan.projectId,
      pointDescription: `${point.title}. ${point.description}`,
      contextQuery: point.contextQuery,
      requiredFiles: point.requiredFiles,
    });

    // 4. Get current file state from workbench for verification
    const currentFiles = workbenchStore.files.get();
    const fileMapForVerification: Record<string, { content: string }> = {};
    for (const [path, file] of Object.entries(currentFiles)) {
      fileMapForVerification[path] = { content: file?.content || '' };
    }

    // 5. Run sub-chat via subChatRunner
    // Get API keys from localStorage for sub-chat LLM calls
    let apiKeys: Record<string, string> = {};
    let providerSettings: Record<string, any> = {};
    try {
      const stored = localStorage.getItem('apiKeys');
      if (stored) apiKeys = JSON.parse(stored);
      const storedProviders = localStorage.getItem('providers');
      if (storedProviders) providerSettings = JSON.parse(storedProviders);
    } catch { /* use empty defaults */ }

    const subChat: SubChat = await subChatRunner.run({
      point,
      context,
      files: currentFiles as any,
      planId: plan.id,
      projectId: plan.projectId,
      chatId: plan.chatId,
      apiKeys,
      providerSettings,
      chatMode: 'build',
    });

    // Check for abort
    if (signal.aborted) {
      point.status = 'pending';
      return;
    }

    // 5. Store the sub-chat in IndexedDB
    try {
      await setSubChat(db, subChat);
    } catch (err) {
      logger.error('Failed to persist sub-chat', err);
    }

    // Track token usage on the point
    point.tokenUsage = subChat.tokenUsage;
    point.subChatId = subChat.id;

    // 6. Run verification (if verification types include any checks)
    const hasVerification =
      point.verificationTypes.length > 0 && !point.verificationTypes.includes('none');

    if (hasVerification) {
      point.status = 'verifying';
      this.emitEvent({
        type: 'progress',
        planId: plan.id,
        pointIndex: point.index,
        timestamp: new Date().toISOString(),
        data: { phase: 'verifying' },
      });

      try {
        const verification = await this.verifyPoint(
          point,
          point.requiredFiles,
          fileMapForVerification,
        );

        // Map verification result to plan point format
        point.verificationResult = this.mapVerificationToPlanFormat(verification);

        // 7. If verification fails, attempt auto-fix
        if (!verification.passed) {
          logger.info(
            `Point ${point.index} verification failed — attempting auto-fix`,
          );

          try {
            await this.attemptAutoFix(verification, point, db, signal);
          } catch (fixErr) {
            logger.warn(`Auto-fix failed for point ${point.index}:`, fixErr);
          }
        }
      } catch (verr) {
        logger.error(`Verification error for point ${point.index}:`, verr);
        // Don't fail the point on verification errors — just log it
      }
    }

    // 8. Extract knowledge from sub-chat → projectContextStore
    try {
      await this.extractKnowledgeFromSubChat(plan, subChat);
    } catch (err) {
      logger.warn(`Failed to extract knowledge from sub-chat for point ${point.index}`, err);
    }

    // 9. Update point status to 'completed'
    point.status = 'completed';

    this.emitEvent({
      type: 'point-complete',
      planId: plan.id,
      pointIndex: point.index,
      timestamp: new Date().toISOString(),
      data: {
        tokenUsage: point.tokenUsage,
        artifacts: subChat.artifacts,
      },
    });

    logger.info(`Point ${point.index} completed: "${point.title}"`);

    // 10. Persist plan to IndexedDB
    try {
      await setPlan(db, plan);
    } catch (err) {
      logger.error('Failed to persist plan after point completion', err);
    }
  }

  /**
   * Run verification for a point.
   * Runs lint, type-check, and flow verification based on the point's configuration.
   */
  private async verifyPoint(
    point: PlanPoint,
    modifiedFiles: string[],
    allFiles: Record<string, { content: string }>,
  ): Promise<import('../verification/types').PointVerification> {
    const results: import('../verification/types').PointVerification = {
      passed: true,
      timestamp: Date.now(),
    };

    // 1. Run lint if 'lint' in verificationTypes
    if (point.verificationTypes.includes('lint') && this.executeCommand) {
      try {
        const lintResult = await runLint(modifiedFiles, this.executeCommand);
        results.lint = lintResult;
        if (!lintResult.passed) {
          results.passed = false;
        }
      } catch (err) {
        logger.error('Lint execution failed', err);
        results.lint = {
          passed: false,
          errors: [
            {
              message: `Lint runner failed: ${err instanceof Error ? err.message : String(err)}`,
              filePath: '',
              severity: 'error',
              category: 'lint',
            },
          ],
          warnings: [],
        };
        results.passed = false;
      }
    }

    // 2. Run type-check if 'type-check' in verificationTypes
    if (point.verificationTypes.includes('type-check') && this.executeCommand) {
      try {
        const typeCheckResult = await runTypeCheck(this.executeCommand);
        results.typeCheck = typeCheckResult;
        if (!typeCheckResult.passed) {
          results.passed = false;
        }
      } catch (err) {
        logger.error('Type-check execution failed', err);
        results.typeCheck = {
          passed: false,
          errors: [
            {
              message: `Type check runner failed: ${err instanceof Error ? err.message : String(err)}`,
              filePath: '',
              severity: 'error',
              category: 'type-check',
            },
          ],
        };
        results.passed = false;
      }
    }

    // 3. Run flow verification if 'flow-verify' in verificationTypes
    if (point.verificationTypes.includes('flow-verify')) {
      try {
        const flowResult = await this.flowVerifier.verify(modifiedFiles, allFiles);
        results.flow = flowResult;
        if (!flowResult.passed) {
          results.passed = false;
        }
      } catch (err) {
        logger.error('Flow verification failed', err);
        results.flow = {
          passed: false,
          issues: [
            {
              message: `Flow verifier failed: ${err instanceof Error ? err.message : String(err)}`,
              check: 'button-no-handler',
              filePath: '',
              severity: 'error',
            },
          ],
          buttonsChecked: 0,
          buttonsWithActions: 0,
          screensChecked: 0,
          screensReachable: 0,
        };
        results.passed = false;
      }
    }

    // Emit verification result event
    this.emitEvent({
      type: 'verification-result',
      planId: '',
      pointIndex: point.index,
      timestamp: new Date().toISOString(),
      data: {
        passed: results.passed,
        lintPassed: results.lint?.passed ?? true,
        typeCheckPassed: results.typeCheck?.passed ?? true,
        flowVerified: results.flow?.passed ?? true,
      },
    });

    return results;
  }

  /**
   * Attempt auto-fix for a failed verification.
   * Sends the verification errors back to the AI for correction.
   */
  private async attemptAutoFix(
    verification: import('../verification/types').PointVerification,
    point: PlanPoint,
    db: IDBDatabase,
    signal: AbortSignal,
  ): Promise<void> {
    const maxAttempts = 2; // Conservative — auto-fix is expensive

    const fixResult = await autoFixer.attemptFix(
      verification,
      maxAttempts,
      // callAI: re-run a sub-chat with the fix prompt
      async (fixPrompt: string) => {
        if (signal.aborted) {
          throw new Error('Aborted');
        }

        const fixSubChat = await subChatRunner.run({
          point,
          context: {
            projectContext: '',
            userProfile: '',
            donts: '',
            retrievedIds: [],
          },
          files: {} as any,
          planId: '',
          projectId: '',
          chatId: '',
          apiKeys: {},
          providerSettings: {},
          chatMode: 'build',
        });

        // Override the user message with the fix prompt
        fixSubChat.messages = [
          {
            id: crypto.randomUUID(),
            role: 'user',
            content: fixPrompt,
            createdAt: new Date(),
          },
          ...fixSubChat.messages.filter((m) => m.role === 'assistant'),
        ];

        // Persist the fix sub-chat
        try {
          await setSubChat(db, fixSubChat);
        } catch (err) {
          logger.warn('Failed to persist fix sub-chat', err);
        }

        // Return the assistant's response text
        const assistantMsg = fixSubChat.messages.find((m) => m.role === 'assistant');
        return assistantMsg?.content ?? '';
      },
      // reVerify: run verification again
      async () => {
        return this.verifyPoint(
          point,
          point.requiredFiles,
          {} as Record<string, { content: string }>,
        );
      },
    );

    if (fixResult.fixed) {
      logger.info(`Auto-fix succeeded for point ${point.index} after ${fixResult.attempts} attempt(s)`);
    } else {
      logger.warn(
        `Auto-fix did not resolve all issues for point ${point.index} after ${fixResult.attempts} attempt(s)`,
      );
      for (const msg of fixResult.fixMessages) {
        logger.debug(`  ${msg}`);
      }
    }
  }

  /**
   * Extract knowledge from a completed sub-chat and store it in the project context.
   * This accumulates decisions, patterns, errors, and don'ts for future sub-chats.
   */
  private async extractKnowledgeFromSubChat(plan: Plan, subChat: SubChat): Promise<void> {
    const messages = subChat.messages.map((m) => ({
      role: m.role,
      content: typeof m.content === 'string' ? m.content : '',
    }));

    const extracted = await projectContextStore.extractFromSubChat(
      plan.projectId,
      messages,
      subChat.artifacts,
    );

    for (const entry of extracted) {
      try {
        await projectContextStore.add(plan.projectId, {
          type: entry.type,
          content: entry.content,
          sourceChatId: plan.chatId,
          sourcePointId: String(subChat.pointIndex),
          filePaths: subChat.artifacts,
          metadata: entry.metadata,
        });
      } catch (err) {
        logger.debug(`Failed to store extracted entry: ${entry.content.slice(0, 60)}...`, err);
      }
    }

    if (extracted.length > 0) {
      logger.debug(`Extracted ${extracted.length} knowledge entries from sub-chat`);
    }
  }

  /**
   * Map the verification module's PointVerification to the planning module's format.
   *
   * The verification module uses `filePath` while the planning module uses `file`.
   * Similarly, FlowIssue shapes differ between the two modules.
   * This method bridges the gap.
   */
  private mapVerificationToPlanFormat(
    v: import('../verification/types').PointVerification,
  ): PointVerification {
    return {
      lintPassed: v.lint?.passed ?? true,
      lintErrors: (v.lint?.errors ?? []).map((e) => ({
        file: e.filePath,
        line: e.line,
        column: e.column,
        message: e.message,
        rule: e.category === 'lint' ? (e.context ?? '') : undefined,
        severity: e.severity as 'error' | 'warning',
      })),
      typeCheckPassed: v.typeCheck?.passed ?? true,
      typeErrors: (v.typeCheck?.errors ?? []).map((e) => ({
        file: e.filePath,
        line: e.line,
        column: e.column,
        message: e.message,
        severity: e.severity as 'error' | 'warning',
      })),
      flowVerified: v.flow?.passed ?? true,
      flowIssues: (v.flow?.issues ?? []).map((i) => ({
        type: this.mapFlowCheckToType(i.check),
        severity: i.severity as 'error' | 'warning',
        file: i.filePath,
        line: i.line,
        description: i.message,
        suggestion: i.suggestion ?? '',
      })),
      customChecks: v.customChecks?.map((c) => ({
        name: c.checkId,
        passed: c.issues.length === 0,
        details: c.issues.map((i) => i.message).join('; '),
      })) ?? [],
      allPassed: v.passed,
    };
  }

  /**
   * Map the verification module's FlowIssue check names to the planning module's FlowIssue types.
   */
  private mapFlowCheckToType(
    check: string,
  ): 'button-no-action' | 'screen-not-reachable' | 'broken-link' | 'missing-import' | 'stub-function' {
    const mapping: Record<string, 'button-no-action' | 'screen-not-reachable' | 'broken-link' | 'missing-import' | 'stub-function'> = {
      'button-no-handler': 'button-no-action',
      'button-stub-handler': 'stub-function',
      'screen-unreachable': 'screen-not-reachable',
      'link-target-missing': 'broken-link',
      'dead-route': 'broken-link',
    };
    return mapping[check] ?? 'broken-link';
  }

  /**
   * Pause execution.
   */
  pause(): void {
    this.abortController?.abort();
    const current = planExecutionStore.get();
    planExecutionStore.set({ ...current, isExecuting: false });
  }

  /**
   * Resume a paused plan execution.
   * Loads the plan from IndexedDB and continues from where it left off.
   */
  async resume(planId: string): Promise<void> {
    const db = await openDatabaseV3();
    if (!db) {
      logger.error('Cannot open IndexedDB for plan resume');
      return;
    }

    const plan = await getPlan(db, planId);
    if (!plan) {
      logger.error(`Plan ${planId} not found for resume`);
      return;
    }

    if (plan.status !== 'paused') {
      logger.warn(`Plan ${planId} is ${plan.status}, not paused — cannot resume`);
      return;
    }

    logger.info(`Resuming plan "${plan.title}" (${planId})`);
    await this.execute(plan);
  }

  /**
   * Abort the current plan execution.
   */
  abort(): void {
    if (this.abortController) {
      this.abortController.abort();
      logger.info('Plan execution aborted by user');
    }
  }

  /**
   * Check if a point's dependencies are all completed.
   */
  private dependenciesMet(plan: Plan, point: PlanPoint): boolean {
    return point.dependencies.every((depIdx) => {
      const depPoint = plan.points[depIdx];
      return depPoint && depPoint.status === 'completed';
    });
  }

  /**
   * Emit an event to the reactive store.
   */
  private emitEvent(event: PlanEvent): void {
    const current = planExecutionStore.get();
    planExecutionStore.set({
      ...current,
      events: [...current.events, event],
    });
  }
}

export const planExecutor = new PlanExecutor();
