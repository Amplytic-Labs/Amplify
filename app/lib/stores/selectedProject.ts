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
 */

import { atom } from 'nanostores';

export const selectedProjectId = atom<string | undefined>(undefined);

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
