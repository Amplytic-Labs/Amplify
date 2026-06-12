import { planExecutor } from './plan-executor';
import { webcontainer } from '~/lib/webcontainer';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('ExecutorBridge');

/**
 * Initialize the PlanExecutor with a command executor that runs
 * commands inside the WebContainer shell.
 *
 * Call this once when the workbench is opened.
 */
export async function initPlanExecutor(): Promise<void> {
  try {
    const instance = await webcontainer;
    if (!instance) {
      logger.warn('WebContainer not available — verification commands will be skipped');
      return;
    }

    planExecutor.setCommandExecutor(async (cmd: string) => {
      const process = await instance.spawn('sh', ['-c', cmd]);
      const output: string[] = [];
      const errors: string[] = [];

      process.output.pipeTo(
        new WritableStream({
          write(data) {
            output.push(data);
          },
        }),
      );

      process.stderr.pipeTo(
        new WritableStream({
          write(data) {
            errors.push(data);
          },
        }),
      );

      const exitCode = await process.exit;

      return {
        stdout: output.join(''),
        stderr: errors.join(''),
        exitCode: exitCode ?? 1,
      };
    });

    logger.info('PlanExecutor command executor initialized');
  } catch (error) {
    logger.warn('Failed to initialize PlanExecutor command executor:', error);
  }
}