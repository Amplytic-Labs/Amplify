/**
 * Inset View Store
 *
 * Controls what is rendered inside the SidebarInset (the main content area that
 * normally holds the chat). The sidebar "Projects" nav button switches this to
 * `'projects'`, which renders a full projects gallery in place of the chat.
 *
 * Selecting a project (or pressing back) switches it back to `'chat'`, which
 * restores the base chat view.
 *
 * Keeping this as a tiny nanostore (rather than React state in _index.tsx) lets
 * the sidebar trigger the view swap without prop drilling, and lets the gallery
 * call `setInsetView('chat')` when a project is chosen.
 */

import { atom } from 'nanostores';

export type InsetView = 'chat' | 'projects';

export const insetView = atom<InsetView>('chat');

export function setInsetView(view: InsetView): void {
  insetView.set(view);
}

export function showProjectsGallery(): void {
  insetView.set('projects');
}

export function showChatView(): void {
  insetView.set('chat');
}
