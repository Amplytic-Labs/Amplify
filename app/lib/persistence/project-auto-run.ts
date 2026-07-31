/**
 * Project Auto-Run
 *
 * When a project is loaded (either by opening a project chat or by selecting
 * a project in the sidebar), this module is responsible for:
 *
 *   1. Running the project's `setupCommand` (e.g. `npm install`) — on every
 *      project load (controlled by `workbenchStore.projectAutoStarted`).
 *   2. Running the project's `startCommand` (e.g. `npm run dev`) — on every
 *      project load, after setup completes.
 *
 * Both commands are persisted on the project (detected from `package.json`
 * via `detectProjectCommands`) so the AI never has to manually run them.
 *
 * ── Silent + Isolated ──
 * The commands run on the DEDICATED `initTerminal` (a separate AmplifyShell
 * from the AI's `amplifyTerminal`). This means:
 *  - The AI's shell commands don't interfere with the running dev server.
 *  - The dev server's output doesn't pollute the AI's terminal.
 *  - Ctrl+C in the AI terminal doesn't kill the dev server.
 *
 * The commands are SILENT — no toast notifications, no chat messages. The
 * user sees the output in the init terminal's scrollback (visible if they
 * switch to the init terminal tab, but not in the chat).
 */

import { toast } from '~/components/ui/toast';
import type { Project } from './project-store';
import { projectStore } from './project-store';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Run the project's setup + start commands in the INIT shell (separate from
 * the AI's terminal).
 *
 * On every project load this runs `npm install` (waits for completion) then
 * fires the start command (detached/backgrounded). The session guard
 * (`projectAutoStarted`) prevents double-running within the same load cycle,
 * but is reset on every chat switch so each new chat load re-runs setup.
 */
export async function runProjectAutoSetup(project: Project): Promise<void> {
  if (!project) {
    return;
  }

  /*
   * Session-level guard: prevents double-running within the same load cycle.
   * This is reset to false on every chat switch (by useChatHistory setting
   * projectAutoStarted.set(false) when loadedProjectId changes), so each
   * new chat load re-triggers setup + start.
   */
  if (workbenchStore.projectAutoStarted.get()) {
    return;
  }

  workbenchStore.projectAutoStarted.set(true);

  // No commands detected? Nothing to do.
  if (!project.setupCommand && !project.startCommand) {
    return;
  }

  /*
   * Use the INIT terminal (separate from the AI's amplifyTerminal) so the
   * dev server isn't killed when the AI runs a shell command later.
   */
  const shell = workbenchStore.initTerminal;

  try {
    await shell.ready();
  } catch {
    console.warn('[auto-run] Init shell not ready — deferring auto-setup.');
    workbenchStore.projectAutoStarted.set(false);

    return;
  }

  const sessionId = `auto-${project.id}-${Date.now()}`;

  try {
    /*
     * Step 1 — setup (npm install). Wait for completion before starting
     * the dev server. Silent — no toast, the output goes to the init
     * terminal.
     */
    if (project.setupCommand) {
      console.log(`[auto-run] Running setup: ${project.setupCommand}`);

      const result = await shell.executeCommand(sessionId, project.setupCommand);

      if (result && result.exitCode === 0) {
        projectStore.updateProject(project.id, { isSetupComplete: true });
        console.log('[auto-run] Setup complete');
      } else if (result) {
        console.warn('[auto-run] Setup exited with non-zero code:', result.exitCode);
      }
    }

    /*
     * Step 2 — start command (npm run dev). Runs DETACHED (backgrounded)
     * on the init terminal so the dev server keeps running. Because this
     * is a SEPARATE shell from the AI's terminal, the AI's shell commands
     * won't Ctrl+C the dev server.
     */
    if (project.startCommand) {
      console.log(`[auto-run] Starting: ${project.startCommand}`);

      /*
       * Spawn the dev server DIRECTLY via webcontainer.spawn() (not through
       * jsh). This avoids the visible ` &` backgrounding operator that jsh
       * would echo to the terminal — the user just sees the dev server
       * output, not `npm run dev &`.
       */
      shell.spawnDetached(project.startCommand).catch((e) => console.warn('[auto-run] Start command error:', e));
    }
  } catch (e) {
    console.error('[auto-run] Failed:', e);
    workbenchStore.projectAutoStarted.set(false);
  }
}

/**
 * Manually re-trigger setup + start for a project (used by the "Re-run setup"
 * button in the sidebar). Bypasses the session guard. Runs on the init terminal.
 */
export async function rerunProjectSetup(project: Project): Promise<void> {
  if (!project) {
    return;
  }

  const shell = workbenchStore.initTerminal;

  try {
    await shell.ready();
  } catch {
    toast.error('Terminal not ready — open the workspace first');
    return;
  }

  workbenchStore.toggleTerminal(true);

  const sessionId = `rerun-${project.id}-${Date.now()}`;

  try {
    if (project.setupCommand) {
      toast.info(`Re-running setup for "${project.name}"…`, { autoClose: 2500 });

      const result = await shell.executeCommand(sessionId, project.setupCommand);

      if (result && result.exitCode === 0) {
        projectStore.updateProject(project.id, { isSetupComplete: true });
        toast.success('Setup complete', { autoClose: 2000 });
      }
    }

    if (project.startCommand) {
      /*
       * Spawn directly (see runProjectAutoSetup) — avoids the visible ` &`
       * backgrounding operator that jsh would echo.
       */
      shell.spawnDetached(project.startCommand).catch((e) => console.warn('[rerun] Start command error:', e));
    }
  } catch (e) {
    console.error('[rerun] Failed:', e);
    toast.error('Re-run failed — see terminal');
  }
}

/**
 * Reset the session-level auto-start flag — called when switching to a
 * different project or to a personal chat. Allows the next project load to
 * trigger its own auto-start.
 */
export function resetAutoStartState(): void {
  workbenchStore.projectAutoStarted.set(false);
}
