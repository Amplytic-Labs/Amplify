/**
 * Selected Project Store
 *
 * Tracks which project is currently "selected" in the sidebar. The selection
 * controls two things:
 *
 *  1. Sidebar layout — when a project is selected, the chat-history area below
 *     the Projects nav shows the chats of THAT project (instead of personal
 *     chats). A "Selected Project" section is also rendered so the user can
 *     see / rename / clear the active selection.
 *
 *  2. Workspace auto-load — selecting a project (without opening a specific
 *     chat) opens an empty chat linked to the project so the user can keep
 *     working on the project's global file state + memory.
 *
 * The selection is intentionally separate from `chatId` so it survives chat
 * switches inside the same project.
 *
 * PERSISTENCE: NONE. The selection is NOT persisted across sessions. On a
 * fresh site visit (no project/chat in the URL), the sidebar shows personal
 * chats with no project selected. To reopen a previously-created app, the
 * user visits the Projects page (Projects nav → gallery) and opens the
 * wanted project from there. The URL (/<projectId>/<chatId>) remains the
 * only source of truth for restoring a selection on reload.
 */

import { atom } from 'nanostores';

/**
 * Legacy localStorage key from when the selection was persisted across
 * sessions. Kept only to perform a one-time cleanup of stale values left
 * behind by older builds, so existing users don't carry dead data.
 */
const LEGACY_STORAGE_KEY = 'amplify:selectedProjectId';

/**
 * Determine the initial selected project synchronously:
 *   1. If the URL contains a projectId segment (/<projectId>/<chatId>), use it.
 *   2. Otherwise, undefined (personal chats view — no auto-restore).
 *
 * This runs once at module-load time. On the server (SSR) it returns undefined.
 */
function getInitialValue(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  /*
   * Derive from the current URL — this is the only authoritative signal,
   * because it reflects the chat the user actually navigated to. There is
   * intentionally NO localStorage fallback: a fresh site visit always lands
   * on the personal-chats view unless the user opens a specific project.
   */
  try {
    const pathname = window.location.pathname;

    /* Match /<projectId>/<chatId> (but NOT /chat/<id> which is a personal chat) */
    if (pathname.length > 1) {
      const segments = pathname.split('/').filter(Boolean);

      if (segments.length >= 2 && segments[0] !== 'chat' && segments[0] !== 'git') {
        return segments[0];
      }
    }
  } catch {
    /* ignore — URL parsing is best-effort */
  }

  return undefined;
}

export const selectedProjectId = atom<string | undefined>(getInitialValue());

/*
 * One-time cleanup of the legacy persisted value. Older builds wrote
 * `amplify:selectedProjectId` on every selection change; that value is no
 * longer read anywhere, so we wipe it once on module load to avoid leaving
 * dead data in the user's browser. Safe to remove entirely after a release
 * or two.
 */
if (typeof window !== 'undefined') {
  try {
    localStorage.removeItem(LEGACY_STORAGE_KEY);
  } catch {
    /* ignore — localStorage may be unavailable (private mode, etc.) */
  }
}

export function setSelectedProject(projectId: string | undefined): void {
  selectedProjectId.set(projectId);
}

/**
 * Convenience: clear the current selection. Used by the "Back to all chats"
 * action in the sidebar.
 */
export function clearSelectedProject(): void {
  setSelectedProject(undefined);
}
