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
 * PERSISTENCE: The selection is persisted to localStorage AND derived from
 * the URL on initial load. This eliminates the "sidebar flash" that occurred
 * on full page reloads — previously `selectedProjectId` reset to `undefined`
 * on every reload, causing the sidebar to briefly show personal chats before
 * the sync effect ran and swapped to the project chats view. Now the correct
 * project is known synchronously on first render.
 */

import { atom } from 'nanostores';

const STORAGE_KEY = 'amplify:selectedProjectId';

/**
 * Determine the initial selected project synchronously:
 *   1. If the URL contains a projectId segment (/<projectId>/<chatId>), use it.
 *   2. Otherwise, fall back to the last-persisted value from localStorage.
 *   3. Otherwise, undefined (personal chats view).
 *
 * This runs once at module-load time. On the server (SSR) it returns undefined.
 */
function getInitialValue(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  /*
   * Try to derive from the current URL first — this is the most authoritative
   * signal because it reflects the chat the user actually navigated to.
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

  /* Fall back to persisted value */
  try {
    return localStorage.getItem(STORAGE_KEY) || undefined;
  } catch {
    return undefined;
  }
}

export const selectedProjectId = atom<string | undefined>(getInitialValue());

/**
 * Persist selection to localStorage whenever it changes, so the next page
 * load can restore it immediately (before any effect runs).
 */
if (typeof window !== 'undefined') {
  selectedProjectId.listen((value) => {
    try {
      if (value) {
        localStorage.setItem(STORAGE_KEY, value);
      } else {
        localStorage.removeItem(STORAGE_KEY);
      }
    } catch {
      /* ignore — localStorage may be unavailable (private mode, etc.) */
    }
  });
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
