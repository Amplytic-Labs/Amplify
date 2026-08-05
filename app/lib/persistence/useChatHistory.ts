import { useSearchParams, useMatches } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type UIMessage } from 'ai';
import { toast } from '~/components/ui/toast';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs';
import {
  getMessages,
  getAll,
  getNextId,
  getUrlId,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  updateChatMetadata,
  getSnapshot,
  setSnapshot,
  type IChatMetadata,
} from './db';
import type { FileMap } from '~/lib/stores/files';
import type { Snapshot } from './types';
import { webcontainer } from '~/lib/webcontainer';
import { detectProjectCommands } from '~/utils/projectCommands';
import { projectStore } from './project-store';
import { getProjectFiles, createProjectCommit } from './project-files';
import { runProjectAutoSetup } from './project-auto-run';
import { extractChatName } from '~/lib/chat/chatname';
import { writeFilesParallel, fileMapToWriteTasks } from '~/lib/utils/parallel-file-writer';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: UIMessage[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);

export const chatListVersion = atom(0);

/*
 * Module-level guard that prevents the project-load IIFE (the
 * `clearWorkspace → restoreFileMap → runProjectAutoSetup` chain) from
 * running TWICE for the same project within a single page session.
 *
 * WHY THIS EXISTS:
 * After cloning a repo, `importChat` navigates to `/${projectId}/${chatId}`
 * which triggers a full page reload. On reload, the load effect fires and
 * starts the IIFE. The IIFE is ASYNC — between `clearWorkspace()` and
 * `loadedProjectId.set(project.id)` there is a window where the effect can
 * re-fire (e.g. when `Chat.client.tsx` strips a `prompt` query param via
 * `setSearchParams({})`). At that point `loadedProjectId` is still the old
 * value, so `projectChanged === true` and a SECOND IIFE starts.
 *
 * The second IIFE's `clearWorkspace()` sends Ctrl+C to the first `npm install`
 * (which is still running), then `runProjectAutoSetup()` re-injects `npm install`
 * — producing the "auto injected → stopped (^C) → injected again" redundancy.
 *
 * This guard makes the second IIFE a no-op for the same project. It is cleared
 * as soon as the first IIFE sets `loadedProjectId` (after which `projectChanged`
 * is false anyway), and in a `finally` block for safety. It does NOT block a
 * genuine project switch (different project id) — only same-project re-entries.
 */
let _projectLoadingInProgress: string | undefined;

export function useChatHistory() {
  const matches = useMatches();

  /*
   * ROUTE DATA RESOLUTION — why we use useMatches() instead of useLoaderData()
   * ========================================================================
   *
   * Remix v2 flat routes create an implicit PARENT-CHILD relationship between:
   *   - routes/$projectId.tsx        (matches /:projectId — PARENT LAYOUT)
   *   - routes/$projectId.$chatId.tsx (matches /:projectId/:chatId — CHILD)
   *
   * Both files `export default IndexRoute` (the same component from _index.tsx).
   * When the URL is /:projectId/:chatId, BOTH routes match. The parent's
   * component renders first. Since MainLayout does NOT render <Outlet/>, the
   * child's component never mounts — but useLoaderData() returns the PARENT's
   * loader data ({ projectId } with NO id field).
   *
   * This caused Bug 1: mixedId was always undefined for project chats, so the
   * load effect's `!mixedId && urlProjectId` branch fired and picked the LATEST
   * chat (project.chatIds[last]) instead of the chat from the URL.
   *
   * FIX: Scan useMatches() for the most specific route that has `id` in its
   * data. That's the $projectId.$chatId child route. If no child matches (URL
   * is /:projectId with no chatId), fall back to the $projectId parent's data.
   */
  const chatMatch = matches.find((m) => m.data && typeof (m.data as Record<string, unknown>).id !== 'undefined');
  const projectMatch = matches.find((m) => m.data && 'projectId' in (m.data as Record<string, unknown>));
  const resolvedData = (chatMatch?.data ?? projectMatch?.data ?? {}) as { id?: string; projectId?: string };
  const { id: mixedId, projectId: urlProjectId } = resolvedData;

  const [searchParams] = useSearchParams();

  const [archivedMessages, setArchivedMessages] = useState<UIMessage[]>([]);
  const [initialMessages, setInitialMessages] = useState<UIMessage[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  // Define restoreFileMap before it's used in the effect
  const restoreFileMap = useCallback(async (files: FileMap) => {
    const container = await webcontainer;

    /*
     * Parallel file restoration — replaces the previous two sequential
     * for-loops (one for mkdir, one for writeFile) that serialized every
     * write and made large template loads take ~200s for 400 files.
     *
     * writeFilesParallel:
     *   1. Dedupes parent dirs and mkdirs them in parallel (most templates
     *      share a small set of parent dirs, so ~400 mkdirs collapse to ~10).
     *   2. Writes files via a concurrency-limited worker pool (default 12
     *      concurrent writes). WebContainer FS handles concurrent writes to
     *      different paths via Comlink's non-queueing message dispatch.
     *
     * Errors are collected (not thrown) to match the previous behavior —
     * individual file failures don't abort the whole restore. Failed files
     * are logged so they're not silently lost.
     */
    const tasks = fileMapToWriteTasks(files, container.workdir);

    if (tasks.length === 0) {
      return;
    }

    const progress = await writeFilesParallel(tasks, {
      concurrency: 12,
      onProgress: ({ done, total, failed }) => {
        if (failed.length > 0 && done === total) {
          console.warn(
            `[restoreFileMap] ${failed.length}/${total} files failed to restore:`,
            failed.map((f) => f.path).join(', '),
          );
        }
      },
    });

    if (progress.failed.length > 0) {
      console.warn(`[restoreFileMap] ${progress.failed.length}/${progress.total} files failed:`, progress.failed);
    }
  }, []);

  // Define restoreSnapshot before it's used in the effect
  const restoreSnapshot = useCallback(async (id: string, snapshot?: Snapshot) => {
    const container = await webcontainer;

    const validSnapshot = snapshot || { chatIndex: '', files: {} };

    if (!validSnapshot?.files) {
      return;
    }

    const entries = Object.entries(validSnapshot.files);

    for (const [key, value] of entries) {
      let filePath = key;

      if (filePath.startsWith(container.workdir)) {
        filePath = filePath.replace(container.workdir, '');
      }

      if (value?.type === 'folder') {
        await container.fs.mkdir(filePath, { recursive: true });
      }
    }

    for (const [key, value] of entries) {
      let filePath = key;

      if (filePath.startsWith(container.workdir)) {
        filePath = filePath.replace(container.workdir, '');
      }

      if (value?.type === 'file') {
        await container.fs.writeFile(filePath, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
      }
    }
  }, []);

  // Define takeSnapshot before it's used in the effect
  const takeSnapshot = useCallback(
    async (
      chatIdx: string,
      files: FileMap,
      _chatId?: string | undefined,
      chatSummary?: string,
      lastUserText?: string,
    ) => {
      const id = chatId.get();

      if (!id || !db) {
        return;
      }

      const project = projectStore.getProjectByChat(id);

      if (project) {
        try {
          let commitMessage = chatSummary?.slice(0, 80);

          if (!commitMessage) {
            if (lastUserText) {
              commitMessage =
                lastUserText
                  .replace(/<[^>]*>/g, '')
                  .replace(/\s+/g, ' ')
                  .trim()
                  .slice(0, 80) || 'Update';
            } else {
              commitMessage = 'Update';
            }
          }

          await createProjectCommit(db, project.id, commitMessage!, files, id);
          projectStore.updateProject(project.id, {
            currentCommitId: (await getProjectFiles(db, project.id))?.currentCommitId,
          });

          try {
            const { detectProjectMemory, mergeDetectedMemory } =
              await import('~/lib/persistence/project-memory-detect');
            const { memory, technologies } = detectProjectMemory(files);
            const merged = mergeDetectedMemory(project.memory, memory);
            projectStore.updateProjectMemory(project.id, merged, true);

            if (technologies.length > 0) {
              projectStore.updateProject(project.id, {
                technologies: Array.from(new Set([...(project.technologies ?? []), ...technologies])),
              });
            }
          } catch (e) {
            console.warn('[ChatHistory] Project memory auto-detect failed:', e);
          }
        } catch (error) {
          console.error('Failed to save project files/commit:', error);
          toast.error('Failed to save project state.');
        }

        return;
      }

      const snapshot: Snapshot = {
        chatIndex: chatIdx,
        files,
        summary: chatSummary,
      };

      try {
        await setSnapshot(db, id, snapshot);
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        toast.error('Failed to save chat snapshot.');
      }
    },
    [db],
  );

  const navigateChat = useCallback((nextId: string) => {
    const url = new URL(window.location.href);

    /*
     * Preserve the projectId segment if the current chat belongs to a
     * project. Previously this hardcoded `/chat/${nextId}`, which DROPPED
     * the project context — the URL became `/chat/<id>` instead of
     * `/<projectId>/<id>`. On a subsequent reload, the load effect's
     * `!mixedId && urlProjectId` branch would then fail to find the
     * projectId, and in some cases fall through to loading the LATEST chat
     * in the project (project.chatIds[last]) instead of the correct one.
     */
    const currentLoadedProjectId = workbenchStore.loadedProjectId.get();

    if (currentLoadedProjectId && currentLoadedProjectId !== '<none>') {
      url.pathname = `/${currentLoadedProjectId}/${nextId}`;
    } else {
      url.pathname = `/chat/${nextId}`;
    }

    window.history.replaceState({}, '', url);
  }, []);

  useEffect(() => {
    if (!db) {
      setReady(true);

      if (persistenceEnabled) {
        const error = new Error('Chat persistence is unavailable');
        logStore.logError('Chat persistence initialization failed', error);
        toast.error('Chat persistence is unavailable');
      }

      return;
    }

    if (mixedId || urlProjectId) {
      setReady(false);
      setInitialMessages([]);

      const chatIdToLoad = mixedId ?? (urlProjectId ? generateId() : undefined);

      let finalChatIdToLoad = chatIdToLoad;

      if (!mixedId && urlProjectId) {
        const project = projectStore.getProject(urlProjectId);

        if (project && project.chatIds.length > 0) {
          finalChatIdToLoad = project.chatIds[project.chatIds.length - 1];
        }
      }

      if (!mixedId && urlProjectId && !finalChatIdToLoad) {
        finalChatIdToLoad = generateId();
      }

      /*
       * Immediately load project workspace if a project ID is in the URL.
       *
       * PROJECT-CHANGE GUARD: Only destroy + rebuild the workspace when
       * switching to a DIFFERENT project. When switching between chats in
       * the SAME project, the workspace (WebContainer, files, dev server)
       * is already correct — destroying it would:
       *   - Kill the running dev server (workspace "reset" the user sees)
       *   - Wipe node_modules (forces npm install to re-run unnecessarily)
       *   - Cause a visible sidebar flash (state re-hydration)
       *
       * The guard compares urlProjectId against workbenchStore.loadedProjectId.
       * On a full page reload, loadedProjectId starts as '<none>' so the
       * workspace IS rebuilt. On SPA navigation within the same project,
       * loadedProjectId already equals the target project, so we skip the
       * expensive teardown and just ensure the workbench is visible.
       */
      if (urlProjectId) {
        const project = projectStore.getProject(urlProjectId);

        if (project) {
          const currentLoadedProjectId = workbenchStore.loadedProjectId.get();
          const projectChanged = currentLoadedProjectId !== project.id;

          if (projectChanged) {
            /*
             * Same-project re-entry guard: if an IIFE for THIS project is
             * already in flight (between clearWorkspace and setting
             * loadedProjectId), skip — otherwise the second IIFE's
             * clearWorkspace would Ctrl+C the first npm install and
             * re-inject it (the "injected → stopped → injected again"
             * redundancy). See `_projectLoadingInProgress` docs above.
             */
            if (_projectLoadingInProgress === project.id) {
              console.log('[ChatHistory] Project load already in progress for', project.id, '— skipping duplicate');
            } else {
              _projectLoadingInProgress = project.id;

              console.log(
                '[ChatHistory] Project changed:',
                currentLoadedProjectId,
                '→',
                project.id,
                '(destroying + rebuilding workspace)',
              );

              (async () => {
                try {
                  /*
                   * DESTROY + REINITIALIZE the workspace — only when the
                   * project actually changed. This kills the previous
                   * project's dev server, clears its files from the
                   * WebContainer FS, and resets projectAutoStarted so the
                   * new project's npm install + start will fire.
                   */
                  await workbenchStore.clearWorkspace();

                  const projectFiles = await getProjectFiles(db, project.id);
                  console.log(
                    '[ChatHistory] Project files retrieved:',
                    projectFiles?.files ? Object.keys(projectFiles.files).length : 0,
                    'files',
                  );

                  if (projectFiles?.files && Object.keys(projectFiles.files).length > 0) {
                    await restoreFileMap(projectFiles.files);
                    workbenchStore.files.set(projectFiles.files);
                  } else {
                    /*
                     * DON'T clear files here. The Promise.all safety net
                     * below may have already populated `workbenchStore.files`
                     * from the chat snapshot. Clearing them would wipe the
                     * snapshot and leave the workspace showing
                     * "Loading workspace…" forever — the
                     * "workspace contents don't load on refresh" bug.
                     *
                     * Just log the warning; the safety net (or the
                     * no-snapshot fallback) is responsible for setting
                     * files in this case.
                     */
                    console.warn(
                      '[ChatHistory] No project files found for project:',
                      project.id,
                      '— falling back to snapshot',
                    );
                  }

                  workbenchStore.loadedProjectId.set(project.id);
                  workbenchStore.showWorkbench.set(true);

                  /*
                   * Loading is complete — clear the guard so a genuine
                   * future switch to a DIFFERENT project can proceed.
                   * (Same-project re-entries are now blocked by
                   * `projectChanged === false` anyway.)
                   */
                  _projectLoadingInProgress = undefined;

                  console.log('[ChatHistory] Running auto setup for project:', project.id);
                  runProjectAutoSetup(project).catch((e) => console.warn('[ChatHistory] Auto setup failed:', e));
                } catch (e) {
                  console.error('[ChatHistory] Immediate project load failed:', e);
                  _projectLoadingInProgress = undefined;
                }
              })();
            }
          } else {
            /*
             * Same project — workspace is already loaded. Just ensure the
             * workbench is visible. The dev server keeps running, files
             * stay in place, and only the chat messages + description are
             * swapped (handled by the Promise.all chain below).
             */
            console.log('[ChatHistory] Same project — skipping workspace rebuild');
            workbenchStore.showWorkbench.set(true);
          }
        } else {
          console.warn('[ChatHistory] Project not found in store for ID:', urlProjectId);
        }
      }

      Promise.all([getMessages(db, finalChatIdToLoad!), getSnapshot(db, finalChatIdToLoad!)])
        .then(async ([storedMessages, snapshot]) => {
          if (storedMessages && storedMessages.messages.length > 0) {
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const validSnapshot = snapshot || { chatIndex: '', files: {} };
            const rewindId = searchParams.get('rewindTo');
            const endingIdx = rewindId
              ? storedMessages.messages.findIndex((m) => m.id === rewindId) + 1
              : storedMessages.messages.length;

            const filteredMessages = storedMessages.messages.slice(0, endingIdx);
            const archivedMessages: UIMessage[] = [];

            setArchivedMessages(archivedMessages);

            /*
             * linkedProject resolution — fall back to urlProjectId.
             *
             * Previously this ONLY checked `chatToProject[chatId]` and
             * `metadata.projectId`. If both were missing (e.g. the chat
             * was loaded via a URL like /{projectId}/{chatId} but the
             * chat's metadata was never persisted with projectId, or the
             * projectStore's chatToProject map was reset), linkedProject
             * came back undefined and we fell into the "personal chat"
             * branch below. That branch then called `clearWorkspace()`
             * because `loadedProjectId !== '<none>'` — wiping files the
             * IIFE had JUST loaded. The workspace ended up empty on
             * refresh even though the URL clearly named a project.
             *
             * FIX: add `urlProjectId` as a final fallback so a project
             * chat loaded via URL is recognised even when metadata is
             * missing.
             */
            const linkedProject =
              projectStore.getProjectByChat(storedMessages.id) ??
              (storedMessages.metadata?.projectId
                ? projectStore.getProject(storedMessages.metadata.projectId)
                : undefined) ??
              (urlProjectId ? projectStore.getProject(urlProjectId) : undefined);

            /*
             * "Snapshot has files" — used in place of the
             * `metadata.projectInitiated` flag for deciding whether to
             * restore files. The flag is set when an artifact is first
             * created (see sendMessage flow), but it's unreliable on
             * older chats or after metadata migrations. The snapshot
             * itself is the source of truth: if it has files, restore
             * them.
             */
            const snapshotHasFiles = !!snapshot?.files && Object.keys(snapshot.files).length > 0;

            if (!linkedProject) {
              /*
               * Personal chat loaded via /chat/{chatId}. If a DIFFERENT
               * project is currently loaded, destroy the workspace (kill
               * processes, clear FS) so terminal processes from that
               * project don't leak into this personal chat.
               *
               * BUG FIX: previously this fired whenever
               * `loadedProjectId !== '<none>'`. But when the URL is
               * `/{projectId}/{chatId}` and the IIFE has already set
               * `loadedProjectId = project.id` (and loaded files), this
               * branch would clearWorkspace() — wiping the IIFE's work.
               * Now we only clear if loadedProjectId is set to something
               * OTHER than urlProjectId (i.e. a genuinely different
               * project is loaded).
               */
              const currentLoaded = workbenchStore.loadedProjectId.get();

              if (currentLoaded && currentLoaded !== '<none>' && currentLoaded !== urlProjectId) {
                await workbenchStore.clearWorkspace();
              }

              if (snapshotHasFiles) {
                /*
                 * Awaiting restoreSnapshot — previously this was
                 * fire-and-forget, so WebContainer boot failures or FS
                 * errors were silently swallowed and the workspace ended
                 * up empty.
                 */
                try {
                  await restoreSnapshot(mixedId || '', snapshot);
                } catch (e) {
                  console.warn('[ChatHistory] restoreSnapshot failed (personal chat):', e);
                }

                /*
                 * Safety net: restoreSnapshot writes to the WebContainer FS
                 * but does NOT update workbenchStore.files. Without this,
                 * hasFiles stays false and the workspace shows "Loading…"
                 * forever if the IIFE failed. Populate the file store from
                 * the snapshot.
                 */
                const currentFiles = workbenchStore.files.get();

                if (!currentFiles || Object.keys(currentFiles).length === 0) {
                  workbenchStore.files.set(snapshot!.files);
                }

                workbenchStore.showWorkbench.set(true);
              }
            } else if (snapshotHasFiles) {
              /*
               * Only restore the snapshot if the workspace is empty (initial
               * load) or the project changed. When switching between chats
               * in the same project that's already loaded, skip the snapshot
               * restore to avoid resetting the WebContainer FS — the dev
               * server keeps running and project-global files stay in place.
               */
              const currentFiles = workbenchStore.files.get();
              const hasFiles = currentFiles && Object.keys(currentFiles).length > 0;
              const sameProject = workbenchStore.loadedProjectId.get() === linkedProject?.id;

              if (!hasFiles || !sameProject) {
                /*
                 * Awaiting restoreSnapshot — previously fire-and-forget,
                 * which silently swallowed WebContainer boot / FS errors
                 * and left the workspace empty.
                 */
                try {
                  await restoreSnapshot(mixedId || '', snapshot);
                } catch (e) {
                  console.warn('[ChatHistory] restoreSnapshot failed (project chat):', e);
                }
              }

              workbenchStore.loadedProjectId.set(linkedProject?.id || '<none>');
              workbenchStore.showWorkbench.set(true);

              /*
               * Safety net: same as above — restoreSnapshot writes to the
               * WebContainer but not to the file store. If the IIFE failed,
               * populate the file store from the snapshot so hasFiles
               * becomes true and the workspace renders.
               *
               * Re-check currentFiles here because the awaited
               * restoreSnapshot may have completed AFTER the IIFE set
               * files — in which case we should NOT overwrite them.
               */
              if (snapshotHasFiles) {
                const currentFilesNow = workbenchStore.files.get();

                if (!currentFilesNow || Object.keys(currentFilesNow).length === 0) {
                  workbenchStore.files.set(snapshot!.files);
                }
              }
            } else {
              /*
               * Project chat with messages but no snapshot (e.g. project
               * chat created via handleNewChatInProject that has since
               * received messages but no snapshot was taken). Show the
               * workbench and load project-global files as a fallback.
               */
              workbenchStore.loadedProjectId.set(linkedProject.id);
              workbenchStore.showWorkbench.set(true);

              const currentFiles = workbenchStore.files.get();

              if (!currentFiles || Object.keys(currentFiles).length === 0) {
                try {
                  const projectFiles = await getProjectFiles(db, linkedProject.id);

                  if (projectFiles?.files && Object.keys(projectFiles.files).length > 0) {
                    await restoreFileMap(projectFiles.files);
                    workbenchStore.files.set(projectFiles.files);
                  }
                } catch (e) {
                  console.warn('[ChatHistory] Safety net failed for project chat without snapshot:', e);
                }
              }
            }

            setInitialMessages(filteredMessages);
            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else if (
            storedMessages &&
            (storedMessages.metadata?.projectId || urlProjectId || projectStore.getProjectByChat(storedMessages.id))
          ) {
            /*
             * Empty-messages project chat (e.g. git/template import). Load
             * it as long as ANY project signal exists: explicit
             * metadata.projectId, a projectId in the URL, or a project
             * linked in the store. Previously this ONLY checked
             * metadata.projectId, so if importChat failed to persist it
             * the chat fell through to `navigate('/')` and the URL became
             * `/` — the "template click redirects to root" bug.
             */
            const linkedProject =
              (storedMessages.metadata?.projectId
                ? projectStore.getProject(storedMessages.metadata.projectId)
                : undefined) ??
              (urlProjectId ? projectStore.getProject(urlProjectId) : undefined) ??
              projectStore.getProjectByChat(storedMessages.id);

            if (linkedProject) {
              workbenchStore.loadedProjectId.set(linkedProject.id);
              workbenchStore.showWorkbench.set(true);

              /*
               * ── File-loading safety net ──────────────────────────────
               *
               * The IIFE above (line ~342) is responsible for loading
               * project files into the WebContainer + file store. But it's
               * fire-and-forget — it runs in parallel with this Promise.all
               * chain, and if it fails (e.g. WebContainer slow to boot on a
               * full page reload, or clearWorkspace/restoreFileMap throws)
               * the catch block swallows the error and files are NEVER
               * loaded. The user sees showWorkbench=true but hasFiles=false
               * → "Loading workspace…" forever.
               *
               * This safety net checks if files are still empty and, if so,
               * loads them right here in the sequential .then() chain. If
               * the IIFE already succeeded, this is a no-op (files already
               * set). If the IIFE failed, this rescues the workspace.
               */
              const currentFiles = workbenchStore.files.get();

              if (!currentFiles || Object.keys(currentFiles).length === 0) {
                try {
                  const projectFiles = await getProjectFiles(db, linkedProject.id);

                  if (projectFiles?.files && Object.keys(projectFiles.files).length > 0) {
                    await restoreFileMap(projectFiles.files);
                    workbenchStore.files.set(projectFiles.files);
                    console.log(
                      `[ChatHistory] Safety net loaded ${Object.keys(projectFiles.files).length} files for project ${linkedProject.id}`,
                    );
                  }
                } catch (e) {
                  console.warn('[ChatHistory] Safety net failed to load project files:', e);
                }
              }
            }

            setInitialMessages([]);
            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description || '');
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else {
            window.location.replace('/');
          }

          setReady(true);
        })
        .catch((error) => {
          console.error(error);
          logStore.logError('Failed to load chat messages or snapshot', error);
          toast.error('Failed to load chat: ' + error.message);
        });
    } else {
      setReady(true);
    }
  }, [mixedId, urlProjectId, db, searchParams, restoreFileMap, restoreSnapshot]);

  useEffect(() => {
    if (!db) {
      return;
    }

    (async () => {
      try {
        const allChats = await getAll(db);
        let fixed = 0;
        const existingUrlIds = new Set<string>();

        for (const chat of allChats) {
          if (chat.urlId) {
            existingUrlIds.add(chat.urlId);
          }
        }

        for (const chat of allChats) {
          let needsUpdate = false;
          const updates: Partial<typeof chat> = {};

          if (!chat.urlId) {
            let candidate = chat.id;
            let suffix = 0;

            while (existingUrlIds.has(candidate)) {
              suffix++;
              candidate = `${chat.id}-${suffix}`;
            }

            updates.urlId = candidate;
            existingUrlIds.add(candidate);
            needsUpdate = true;
          }

          if (chat.description && chat.description.startsWith('[Model:')) {
            const cleaned = chat.description
              .replace(/^\[Model:[^\]]*\]\s*\n*\s*\[Provider:[^\]]*\]\s*\n*\s*/i, '')
              .trim();
            updates.description = cleaned.slice(0, 60) || 'New chat';
            needsUpdate = true;
          }

          if (!chat.description) {
            updates.description = 'New chat';
            needsUpdate = true;
          }

          if (needsUpdate) {
            try {
              await setMessages(
                db,
                chat.id,
                chat.messages,
                updates.urlId ?? chat.urlId,
                updates.description ?? chat.description,
                chat.timestamp,
                chat.metadata,
              );
              fixed++;
            } catch (e) {
              console.warn(`[ChatHistory] Migration: could not fix chat ${chat.id}:`, e);
            }
          }
        }

        if (fixed > 0) {
          console.log(`[ChatHistory] Migration: fixed ${fixed} legacy chat(s)`);
          chatListVersion.set(chatListVersion.get() + 1);
        }
      } catch (e) {
        console.warn('[ChatHistory] Migration failed:', e);
      }
    })();
  }, [db]);

  return {
    ready: !mixedId || ready,
    initialMessages,
    chatKey: mixedId,
    updateChatMestaData: async (metadata: IChatMetadata) => {
      const id = chatId.get();

      if (!db || !id) {
        return;
      }

      try {
        await setMessages(db, id, initialMessages, urlId, description.get(), undefined, metadata);
        chatMetadata.set(metadata);
      } catch (error) {
        toast.error('Failed to update chat metadata');
        console.error(error);
      }
    },
    storeMessageHistory: async (messages: UIMessage[]) => {
      if (!db || messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;

      // AI SDK v7: annotations may be stored as custom data, use type assertion
      messages = messages.filter((m) => !(m as any).annotations?.includes('no-store'));

      let _urlId = urlId;

      if (!urlId && firstArtifact?.id) {
        const urlId = await getUrlId(db, firstArtifact.id);
        _urlId = urlId;
        navigateChat(urlId);
        setUrlId(urlId);
      }

      let chatSummary: string | undefined = undefined;
      const lastMessage = messages[messages.length - 1];

      if (lastMessage.role === 'assistant') {
        // AI SDK v7: annotations accessed via type assertion
        const annotations = (lastMessage as any).annotations as JSONValue[] | undefined;
        const filteredAnnotations = (annotations?.filter(
          (annotation: JSONValue) =>
            annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
        ) || []) as { type: string; value: any } & { [key: string]: any }[];

        if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
          chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
        }
      }

      let lastUserText: string | undefined;

      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          // AI SDK v7: extract content from parts or fallback to legacy content
          const msg = messages[i];
          let c: any;

          if (Array.isArray(msg.parts)) {
            c = msg.parts
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join('');
          } else {
            c = (msg as any).content;
          }

          if (typeof c === 'string') {
            lastUserText = c;
          } else if (Array.isArray(c)) {
            lastUserText = c.map((part: any) => (typeof part === 'string' ? part : part?.text || '')).join(' ');
          }

          break;
        }
      }

      takeSnapshot(messages[messages.length - 1].id, workbenchStore.files.get(), _urlId, chatSummary, lastUserText);

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      if (firstArtifact) {
        const currentMetadata = chatMetadata.get() || {};
        chatMetadata.set({ ...currentMetadata, projectInitiated: true });
      }

      if (firstArtifact) {
        const currentId = chatId.get();

        if (currentId && !projectStore.getProjectByChat(currentId)) {
          try {
            const project = await projectStore.promoteChatToProject(
              currentId,
              firstArtifact.title || 'Untitled Project',
            );

            const currentFiles = workbenchStore.files.get();

            if (Object.keys(currentFiles).length > 0) {
              await createProjectCommit(
                db,
                project.id,
                `Project created — ${firstArtifact.title || 'Untitled'}`,
                currentFiles,
                currentId,
              );
              projectStore.updateProject(project.id, {
                currentCommitId: (await getProjectFiles(db, project.id))?.currentCommitId,
              });

              try {
                const fileList = Object.entries(currentFiles)
                  .filter(([, v]) => v?.type === 'file')
                  .map(([path, v]) => ({ path, content: (v as any)?.content ?? '' }));

                if (fileList.length > 0) {
                  const detected = await detectProjectCommands(fileList);

                  if (detected && (detected.setupCommand || detected.startCommand)) {
                    projectStore.setProjectCommands(project.id, {
                      type: detected.type,
                      setupCommand: detected.setupCommand,
                      startCommand: detected.startCommand,
                      followupMessage: detected.followupMessage,
                    });
                  }
                }
              } catch (e) {
                console.warn('[ChatHistory] detectProjectCommands on promote failed:', e);
              }

              workbenchStore.loadedProjectId.set(project.id);

              /*
               * IMPORTANT: Get the FRESH project from the store, not the
               * stale `project` variable from promoteChatToProject.
               * setProjectCommands() updates the project IN the store, but
               * the local `project` variable is a snapshot from BEFORE
               * commands were set. Passing the stale object to
               * runProjectAutoSetup causes it to exit early because
               * project.setupCommand / project.startCommand are undefined.
               */
              const freshProject = projectStore.getProject(project.id) || project;

              if (!workbenchStore.projectAutoStarted.get()) {
                runProjectAutoSetup(freshProject).catch((e) =>
                  console.warn('[ChatHistory] Auto setup failed on promote:', e),
                );
              }

              /*
               * ── Migrate pending DOCX artifacts ───────────────────────────
               *
               * If the AI generated a `<docxartifact>` document BEFORE the
               * workspace was initialized (i.e. before this promotion
               * happened), the document was parked in the pendingDocxStore
               * (localStorage) by AssistantMessage. Now that a workspace
               * exists for this chat, migrate the document: re-publish it
               * into the live docxArtifactStore so the DocxPreviewPanel
               * picks it up, and switch the workbench to the Document view
               * so the user sees their previously-generated docx living
               * alongside the new project files.
               *
               * takePendingDocx both reads AND removes the entry, so this
               * is a one-shot migration — subsequent docx generations go
               * straight to the workspace via the normal path.
               */
              try {
                const { takePendingDocx } = await import('~/lib/stores/pending-docx-artifacts');
                const { setDocxArtifact } = await import('~/lib/stores/docx-artifact');
                const pending = takePendingDocx(currentId);

                if (pending) {
                  setDocxArtifact(pending.markdown, pending.messageId, false, pending.theme);
                  workbenchStore.showWorkbench.set(true);
                  workbenchStore.currentView.set('document');
                  console.log('[ChatHistory] Migrated pending docx into workspace for chat', currentId);
                }
              } catch (e) {
                console.warn('[ChatHistory] Failed to migrate pending docx:', e);
              }
            }

            const currentMetadata = chatMetadata.get() || {};
            chatMetadata.set({ ...currentMetadata, projectId: project.id });

            /*
             * Update the browser URL from /chat/{urlId} to /{projectId}/{urlId}.
             * navigateChat reads loadedProjectId (which was just set above)
             * to construct the correct project-scoped URL. Without this,
             * the URL stays at /chat/{urlId} even though the chat is now
             * a project chat, causing a mismatch on page reload.
             *
             * Use _urlId (the local variable) instead of the urlId React
             * state, because setUrlId is async (React batches updates) and
             * the state may not have updated yet at this point.
             */
            const currentUrlId = _urlId || chatId.get();

            if (currentUrlId) {
              navigateChat(currentUrlId);
            }
          } catch (e) {
            console.warn('[ChatHistory] Failed to auto-promote chat to project:', e);
          }
        }
      }

      /*
       * ── Re-detect project commands if missing ────────────────────────
       *
       * For inject_template projects, the first call to detectProjectCommands
       * may run before all files are written to the file store (e.g. package.json
       * hasn't arrived yet). This block re-detects commands on every
       * storeMessageHistory call if the project still doesn't have them.
       * Once commands are set, setProjectCommands won't overwrite them
       * (unless overwrite=true), so this is a no-op after the first success.
       */
      if (firstArtifact) {
        const currentId = chatId.get();
        const existingProject = currentId ? projectStore.getProjectByChat(currentId) : undefined;

        if (existingProject && !existingProject.setupCommand && !existingProject.startCommand) {
          try {
            const currentFiles = workbenchStore.files.get();
            const fileList = Object.entries(currentFiles)
              .filter(([, v]) => v?.type === 'file')
              .map(([path, v]) => ({ path, content: (v as any)?.content ?? '' }));

            if (fileList.length > 0) {
              const detected = await detectProjectCommands(fileList);

              if (detected && (detected.setupCommand || detected.startCommand)) {
                projectStore.setProjectCommands(existingProject.id, {
                  type: detected.type,
                  setupCommand: detected.setupCommand,
                  startCommand: detected.startCommand,
                  followupMessage: detected.followupMessage,
                });

                console.log(
                  '[ChatHistory] Re-detected commands for project:',
                  existingProject.id,
                  'setup=',
                  detected.setupCommand,
                  'start=',
                  detected.startCommand,
                );

                /*
                 * Trigger auto-setup now that commands exist. Get the
                 * fresh project from the store (with commands set).
                 */
                const freshProject = projectStore.getProject(existingProject.id);

                if (freshProject && !workbenchStore.projectAutoStarted.get()) {
                  runProjectAutoSetup(freshProject).catch((e) =>
                    console.warn('[ChatHistory] Auto setup failed on re-detect:', e),
                  );
                }
              }
            }
          } catch (e) {
            console.warn('[ChatHistory] Re-detect project commands failed:', e);
          }
        }
      }

      /*
       * ── Ensure URL reflects project state ────────────────────────────
       *
       * If the chat belongs to a project but the URL is still /chat/{id}
       * (no project segment), update the URL silently. This handles the
       * case where the promotion block's navigateChat was called with a
       * stale urlId (undefined React state), or where the promotion
       * happened in a previous storeMessageHistory call but the URL
       * wasn't updated for some reason.
       *
       * Uses window.history.replaceState (not a navigation) so the AI
       * response is not interrupted.
       */
      if (firstArtifact) {
        const currentId = chatId.get();
        const projectForUrl = currentId ? projectStore.getProjectByChat(currentId) : undefined;

        if (projectForUrl) {
          const currentPathname = window.location.pathname;
          const expectedProjectId = workbenchStore.loadedProjectId.get();

          if (expectedProjectId && expectedProjectId !== '<none>' && !currentPathname.includes(expectedProjectId)) {
            const urlIdForUpdate = _urlId || currentId;

            if (urlIdForUpdate) {
              const newUrl = new URL(window.location.href);
              newUrl.pathname = `/${expectedProjectId}/${urlIdForUpdate}`;
              window.history.replaceState({}, '', newUrl);
            }
          }
        }
      }

      if (initialMessages.length === 0 && !chatId.get()) {
        const nextId = await getNextId(db);

        chatId.set(nextId);

        if (!urlId) {
          navigateChat(nextId);
        }
      }

      const finalChatId = chatId.get();

      if (!finalChatId) {
        console.error('Cannot save messages, chat ID is not set.');
        toast.error('Failed to save chat messages: Chat ID missing.');

        return;
      }

      let _finalUrlId = urlId;

      if (!_finalUrlId) {
        _finalUrlId = finalChatId;
        setUrlId(_finalUrlId);
      }

      await setMessages(
        db,
        finalChatId,
        [...archivedMessages, ...messages],
        _finalUrlId,
        description.get(),
        undefined,
        chatMetadata.get(),
      );

      const firstAssistantMessage = messages.find((m) => m.role === 'assistant');

      /*
       * NEW chat-naming method (token-efficient, no separate AI call).
       *
       * The system prompt asks the AI to prepend a `<chatname>…</chatname>`
       * tag to its FIRST response. Here we extract that tag from the first
       * assistant message and use it as the chat description (and rename
       * the linked project if its name is still a default/placeholder).
       *
       * `extractChatName` returns null while the tag is still streaming
       * (closing tag not yet seen), so this is safe to run on every tick
       * — it only commits a name once the tag is complete. Once committed,
       * the subsequent `setMessages` calls below re-save the (now-named)
       * chat, and later ticks find no new `<chatname>` (the tag is stripped
       * from stored messages by stream-text.ts) so they no-op.
       *
       * The old method (a separate POST to /api/chat-title that fired a
       * whole second LLM call) has been removed.
       */
      if (firstAssistantMessage) {
        /*
         * Build the assistant's text representation for chatname extraction.
         *
         * PRIMARY source: the message's `text` parts (the visible answer).
         * The system prompt explicitly asks the AI to emit <chatname> as
         * the FIRST token of its VISIBLE answer, so the text channel is
         * where the tag SHOULD live.
         *
         * FALLBACK: scan `reasoning` parts too. Some models (especially
         * reasoning models that ignore system-prompt directives) emit the
         * <chatname> tag INSIDE their reasoning / <thought> trace instead
         * of in the visible text. Without this fallback, the chat would
         * fall through to the provisional-title path and never pick up the
         * AI's intended chat name — which is exactly the "header shows
         * nothing, sidebar shows the user's first message" regression we
         * are fixing.
         *
         * The fallback looks at reasoning.textDelta / reasoning.text /
         * reasoning.details[].text, joins them in order, and runs the
         * same extractChatName on the combined string. If the text-channel
         * extraction already produced a name, the fallback is skipped.
         */
        const textPartsText = Array.isArray(firstAssistantMessage.parts)
          ? firstAssistantMessage.parts
              .filter((p: any) => p.type === 'text')
              .map((p: any) => p.text)
              .join('')
          : (firstAssistantMessage as any).content || '';

        let chatName = extractChatName(textPartsText);

        if (!chatName && Array.isArray(firstAssistantMessage.parts)) {
          const reasoningText = firstAssistantMessage.parts
            .filter((p: any) => p.type === 'reasoning')
            .map((p: any) => {
              if (p.details && Array.isArray(p.details)) {
                return p.details.map((d: any) => d?.text || '').join('');
              }

              return p.textDelta || p.text || '';
            })
            .join('\n');

          if (reasoningText) {
            chatName = extractChatName(reasoningText);
          }
        }

        if (chatName) {
          const currentDesc = description.get() || '';

          /*
           * Only apply the extracted name if the current description is
           * empty or a default/placeholder. This avoids clobbering a name
           * the user manually set, or a name set by an artifact title
           * (firstArtifact.title) for AI-injected templates.
           *
           * IMPORTANT — provisional-title detection:
           *   The `else if` branch below sets a PROVISIONAL title (the
           *   user's first message, truncated to 60 chars) so the sidebar
           *   isn't empty while the AI's first response is streaming.
           *   That provisional title is NOT one of the static placeholders
           *   in the list above, so without special handling the AI's
           *   `<chatname>` tag would be rejected ("shouldApply = false")
           *   and the chat would stay named after the user's first
           *   message forever — exactly the "chat naming is naming the
           *   chat as my first message" bug we are fixing.
           *
           *   We detect a provisional title by comparing the current
           *   description against the truncated first user message
           *   (with and without the trailing ellipsis). A match means
           *   the description is a provisional title that the AI's
           *   `<chatname>` tag is allowed to replace.
           */
          const firstUserMessage = messages.find((m) => m.role === 'user');
          const provisionalTitleCandidates: string[] = [];

          if (firstUserMessage) {
            let rawContent: any;

            if (Array.isArray(firstUserMessage.parts)) {
              rawContent = firstUserMessage.parts;
            } else {
              rawContent = (firstUserMessage as any).content;
            }

            let userText: string =
              typeof rawContent === 'string'
                ? rawContent
                : Array.isArray(rawContent)
                  ? rawContent
                      .filter((p: any) => p.type === 'text')
                      .map((p: any) => p.text)
                      .join(' ')
                  : '';

            userText = userText.replace(/^\[Model:[^\]]*\]\s*\n*\s*\[Provider:[^\]]*\]\s*\n*\s*/i, '').trim();

            if (userText) {
              const truncated = userText.slice(0, 60).trim();
              const withEllipsis = truncated + (userText.length > 60 ? '…' : '');

              // The provisional-title path produces both forms; check both.
              if (truncated) {
                provisionalTitleCandidates.push(truncated);
              }

              if (withEllipsis && withEllipsis !== truncated) {
                provisionalTitleCandidates.push(withEllipsis);
              }
            }
          }

          const isProvisionalTitle = provisionalTitleCandidates.includes(currentDesc);

          const isRenameableDesc =
            !currentDesc ||
            currentDesc === 'Create initial files' ||
            currentDesc === 'Untitled Project' ||
            currentDesc === 'New project chat' ||
            currentDesc === 'New Conversation' ||
            currentDesc === 'New chat' ||
            currentDesc === 'Imported Project' ||
            /^Start with .+ Template$/.test(currentDesc) ||
            /^Git Project:/i.test(currentDesc) ||
            isProvisionalTitle;

          const firstArtifactTitle = firstArtifact?.title;
          const descIsArtifactTitle = firstArtifactTitle && currentDesc === firstArtifactTitle;
          const shouldApply = isRenameableDesc || !!descIsArtifactTitle;

          if (shouldApply && chatName !== currentDesc) {
            description.set(chatName);

            await setMessages(
              db,
              finalChatId,
              [...archivedMessages, ...messages],
              _finalUrlId,
              chatName,
              undefined,
              chatMetadata.get(),
            );

            chatListVersion.set(chatListVersion.get() + 1);

            /*
             * Rename the linked project too, so the sidebar / project list
             * reflects the AI-provided name. Only rename if the project's
             * current name is itself a default/placeholder (produced by
             * chatNameForRepo or the promote path) — never clobber a name
             * the user explicitly set.
             */
            try {
              const linkedProject = projectStore.getProjectByChat(finalChatId);

              if (linkedProject) {
                const isDefaultProjectName =
                  linkedProject.name === 'Create initial files' ||
                  linkedProject.name === 'Untitled Project' ||
                  linkedProject.name === 'New project chat' ||
                  linkedProject.name === 'Imported Project' ||
                  /^Project \d+$/.test(linkedProject.name) ||
                  /^Start with .+ Template$/.test(linkedProject.name) ||
                  /^Git Project:/i.test(linkedProject.name);

                if (isDefaultProjectName) {
                  projectStore.updateProject(linkedProject.id, { name: chatName });
                }
              }
            } catch (e) {
              console.warn('[ChatHistory] Failed to rename project from chatname tag:', e);
            }
          }
        } else if (!description.get() && !firstArtifact) {
          /*
           * Brief provisional title so the chat appears in the sidebar
           * immediately while the AI's first response (containing the
           * `<chatname>` tag) is still streaming. This is replaced as
           * soon as the `<chatname>` tag arrives (above). If the model
           * never emits the tag, 'New chat' remains as a reasonable fallback name.
           */
          description.set('New chat');

          await setMessages(
            db,
            finalChatId,
            [...archivedMessages, ...messages],
            _finalUrlId,
            description.get(),
            undefined,
            chatMetadata.get(),
          );
        }
      }

      chatListVersion.set(chatListVersion.get() + 1);
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        window.location.href = `/chat/${newId}`;
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (
      description: string,
      messages: UIMessage[],
      metadata?: IChatMetadata,
      initialFileMap?: FileMap,
    ) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages, metadata);

        /*
         * createChatFromMessages returns the urlId, NOT the internal chat
         * id. We need the actual chat id for two reasons:
         *  1. projectStore.linkChatToProject must be keyed by the SAME id
         *     that getProjectByChat(storedMessages.id) looks up by later
         *     (storedMessages.id is the internal id, not urlId). Linking by
         *     urlId created a latent mismatch that broke project
         *     association after the first message.
         *  2. updateChatMetadata below needs the id to persist projectId
         *     on the chat record.
         */
        const chatRecord = await getMessages(db, newId);
        const actualChatId = chatRecord?.id ?? newId;

        let projectId: string | undefined;

        if (metadata?.projectId) {
          projectId = metadata.projectId;
        } else if (initialFileMap && Object.keys(initialFileMap).length > 0) {
          /*
           * Create a project whenever files are being imported (git clone
           * or starter template). The `description` is already a clean,
           * human-readable name (e.g. "Start with Expo Template") produced
           * by `chatNameForRepo` — it is used as the initial project name.
           *
           * This replaces the old `description.startsWith('Git Project:')`
           * check, which forced an ugly `Git Project:Expo-Starter-Template.git`
           * name into both the chat description and the project name.
           *
           * Backward compat: if an old chat has a description that still
           * starts with `Git Project:`, strip the prefix so the stored
           * project name is clean.
           */
          const projectName = description.replace(/^Git Project:/i, '').trim() || 'Imported Project';
          const project = projectStore.createProject({
            name: projectName,
            hasWorkspace: true,
          });
          projectId = project.id;
          projectStore.linkChatToProject(actualChatId, projectId);
        }

        /*
         * Persist projectId on the chat's metadata in IndexedDB. Without
         * this, after the window.location.href reload below, the load
         * effect's `else if (storedMessages.metadata?.projectId)` branch
         * is FALSE (metadata only had { gitUrl }) and the chat falls
         * through to `navigate('/', { replace: true })` — which is the
         * bug where the URL stays at `/` after clicking a template.
         */
        if (projectId && chatRecord) {
          try {
            await updateChatMetadata(db, actualChatId, {
              ...chatRecord.metadata,
              projectId,
            });
          } catch (e) {
            console.warn('[ChatHistory] Failed to persist projectId on chat metadata:', e);
          }
        }

        if (projectId) {
          const project = projectStore.getProject(projectId);

          if (project) {
            workbenchStore.loadedProjectId.set(projectId);
            workbenchStore.showWorkbench.set(true);
          }

          /*
           * ── Persist initial project files to IndexedDB ───────────────────
           *
           * This is the fix for: "new chats linked to a project can't access
           * the project files — only the chat that initialized the project
           * can".
           *
           * Root cause: for git/template imports ALL messages are pre-populated
           * as "initial" messages. After the page reload below, `Chat.client.tsx`
           * gates `storeMessageHistory()` behind `messages.length >
           * initialMessages.length`, which is FALSE for these imports — so
           * `storeMessageHistory()` (and therefore `createProjectCommit()`) is
           * NEVER called. The files only live in the ephemeral WebContainer
           * filesystem + the artifact messages, never in IndexedDB. When a NEW
           * chat is opened for this project, `getProjectFiles()` returns
           * undefined → empty workspace.
           *
           * Fix: persist the freshly-cloned FileMap to IndexedDB right here,
           * before the reload, so every subsequent chat for this project can
           * restore it via `getProjectFiles()`.
           */
          if (initialFileMap && Object.keys(initialFileMap).length > 0) {
            try {
              const commitId = await createProjectCommit(
                db,
                projectId,
                `Project files imported`,
                initialFileMap,
                newId,
              );
              projectStore.updateProject(projectId, { currentCommitId: commitId });
              console.log(
                `[ChatHistory] Saved ${Object.keys(initialFileMap).length} initial project files for ${projectId}`,
              );

              /*
               * Detect setup/start commands from the imported files (e.g.
               * `npm install` + `npm run dev` from package.json) and persist
               * them on the project. This is critical: after the page reload,
               * `runProjectAutoSetup` reads `project.setupCommand` /
               * `project.startCommand` to silently auto-inject npm install +
               * start. Without this, the project has no commands and nothing
               * auto-runs.
               *
               * Previously the commands were embedded in a chat message
               * (createCommandsMessage) which (a) cluttered the chat with
               * "Found 'start' script..." text, and (b) was suppressed by
               * the Round-5 replay suppression on reload anyway. Now the
               * commands are set directly on the project — no chat message,
               * no clutter, and the auto-run works on every load.
               */
              const fileList = Object.entries(initialFileMap)
                .filter(([, v]) => v?.type === 'file')
                .map(([path, v]) => ({
                  path: path.replace(/^\/home\/project\//, ''),
                  content: (v as any).content ?? '',
                }));

              if (fileList.length > 0) {
                const detected = await detectProjectCommands(fileList);

                if (detected.setupCommand || detected.startCommand) {
                  projectStore.setProjectCommands(projectId, detected, true);
                  console.log(
                    `[ChatHistory] Detected project commands: setup="${detected.setupCommand}" start="${detected.startCommand}"`,
                  );
                }
              }
            } catch (e) {
              console.error('[ChatHistory] Failed to save initial project files:', e);
            }
          }
        }

        if (projectId) {
          window.location.href = `/${projectId}/${newId}`;
        } else {
          window.location.href = `/chat/${newId}`;
        }

        toast.success('Chat imported successfully');
      } catch (error) {
        if (error instanceof Error) {
          toast.error('Failed to import chat: ' + error.message);
        } else {
          toast.error('Failed to import chat');
        }
      }
    },
    exportChat: async (id = urlId) => {
      if (!db || !id) {
        return;
      }

      const chat = await getMessages(db, id);
      const chatData = {
        messages: chat.messages,
        description: chat.description,
        exportDate: new Date().toISOString(),
      };

      const blob = new Blob([JSON.stringify(chatData, null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = `chat-${new Date().toISOString()}.json`;
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    },
  };
}
