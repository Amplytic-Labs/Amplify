/**
 * Project Auto-Run
 *
 * When a project is loaded (either by opening a project chat or by selecting
 * a project in the sidebar), this module is responsible for:
 *
 *   1. Running the project's `setupCommand` (e.g. `npm install`) — once per
 *      project lifetime (controlled by `Project.isSetupComplete`).
 *   2. Running the project's `startCommand` (e.g. `npm run dev`) — once per
 *      browser session (controlled by `workbenchStore.projectAutoStarted`).
 *
 * Both commands are persisted on the project (detected from `package.json`
 * via `detectProjectCommands`) so the AI never has to manually run them.
 *
 * The helper is idempotent: it short-circuits if `projectAutoStarted` is
 * already true, and it only runs setup when `isSetupComplete` is false.
 */

import { toast } from 'react-toastify';
import type { Project } from './project-store';
import { projectStore } from './project-store';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * Session-scoped memo: which projects have we already attempted to auto-run
 * in this session? Prevents re-running setup even if `isSetupComplete` gets
 * cleared mid-session.
 */
const attemptedThisSession = new Set<string>();

/**
 * Run the project's setup + start commands in the Amplify shell.
 *
 * Safe to call multiple times — it short-circuits when the session flag is
 * already set, and only runs setup when `project.isSetupComplete` is false.
 */
export async function runProjectAutoSetup(project: Project): Promise<void> {
  if (!project) {
    return;
  }

  // Session-level guard: never auto-run twice in the same browser session.
  if (workbenchStore.projectAutoStarted.get()) {
    return;
  }

  // Per-attempt guard: even if the session flag was reset (e.g. by HMR),
  // don't re-attempt the same project twice.
  if (attemptedThisSession.has(project.id)) {
    return;
  }

  attemptedThisSession.add(project.id);
  workbenchStore.projectAutoStarted.set(true);

  // No commands detected? Nothing to do.
  if (!project.setupCommand && !project.startCommand) {
    return;
  }

  // Wait for the Amplify shell to be ready (terminal is attached on first
  // render of the workbench terminal panel).
  const shell = workbenchStore.amplifyTerminal;

  try {
    await shell.ready();
  } catch {
    /*
     * If the shell isn't initialized yet (e.g. workbench never opened), we
     * still mark `projectAutoStarted` so a later project-switch can re-trigger
     * by clearing the flag. The user can also click "Run setup" in the UI.
     */
    console.warn('[auto-run] Amplify shell not ready — deferring auto-setup.');
    workbenchStore.projectAutoStarted.set(false);
    return;
  }

  // Make sure the terminal is visible so the user sees what's happening.
  workbenchStore.toggleTerminal(true);

  const sessionId = `auto-${project.id}-${Date.now()}`;

  try {
    /*
     * Step 1 — setup (npm install). Skip if already complete.
     */
    if (project.setupCommand && !project.isSetupComplete) {
      toast.info(`Installing dependencies for "${project.name}"…`, { autoClose: 2500 });

      const result = await shell.executeCommand(sessionId, project.setupCommand);

      if (result && result.exitCode === 0) {
        projectStore.updateProject(project.id, { isSetupComplete: true });
        toast.success('Dependencies installed — project ready', { autoClose: 2500 });
      } else if (result) {
        console.warn('[auto-run] Setup exited with non-zero code:', result.exitCode);
        toast.warning('Setup completed with warnings — see terminal', { autoClose: 3500 });
      }
    }

    /*
     * Step 2 — start command (npm run dev). Runs in the background so the
     * dev server / preview keeps running. We don't `await` the full
     * execution result because long-running commands never exit.
     */
    if (project.startCommand) {
      toast.info(`Starting project (${project.startCommand})…`, { autoClose: 2000 });

      // Fire and forget — the start command is long-running.
      shell
        .executeCommand(`${sessionId}-start`, project.startCommand)
        .catch((e) => console.warn('[auto-run] Start command error:', e));
    }
  } catch (e) {
    console.error('[auto-run] Failed:', e);
    toast.error('Failed to auto-setup project — see terminal');
    workbenchStore.projectAutoStarted.set(false);
  }
}

/**
 * Manually re-trigger setup + start for a project (used by the "Re-run setup"
 * button in the sidebar). Bypasses the session guard.
 */
export async function rerunProjectSetup(project: Project): Promise<void> {
  if (!project) {
    return;
  }

  const shell = workbenchStore.amplifyTerminal;

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
      shell
        .executeCommand(`${sessionId}-start`, project.startCommand)
        .catch((e) => console.warn('[rerun] Start command error:', e));
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
