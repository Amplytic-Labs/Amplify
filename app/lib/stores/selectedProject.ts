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
 * switches inside the same project. It is also persisted to localStorage so
 * the user returns to the same project after a refresh.
 */

import { atom } from 'nanostores';

const SELECTED_PROJECT_KEY = 'amplify_selected_project';

function loadInitial(): string | undefined {
  if (typeof window === 'undefined') {
    return undefined;
  }

  try {
    return localStorage.getItem(SELECTED_PROJECT_KEY) ?? undefined;
  } catch {
    return undefined;
  }
}

/**
 * The currently selected project ID (or undefined if no project is selected,
 * meaning the sidebar is showing personal chats).
 */
export const selectedProjectId = atom<string | undefined>(loadInitial());

export function setSelectedProject(projectId: string | undefined): void {
  selectedProjectId.set(projectId);

  if (typeof window === 'undefined') {
    return;
  }

  try {
    if (projectId) {
      localStorage.setItem(SELECTED_PROJECT_KEY, projectId);
    } else {
      localStorage.removeItem(SELECTED_PROJECT_KEY);
    }
  } catch {
    /* ignore quota / privacy errors */
  }
}

/**
 * Convenience: clear the current selection. Used by the "Back to all chats"
 * action in the sidebar.
 */
export function clearSelectedProject(): void {
  setSelectedProject(undefined);
}
