import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs'; // Import logStore
import {
  getMessages,
  getAll,
  getNextId,
  getUrlId,
  openDatabase,
  setMessages,
  duplicateChat,
  createChatFromMessages,
  getSnapshot,
  setSnapshot,
  type IChatMetadata,
} from './db';
import type { FileMap } from '~/lib/stores/files';
import type { Snapshot } from './types';
import { webcontainer } from '~/lib/webcontainer';
import { detectProjectCommands, createCommandActionsString } from '~/utils/projectCommands';
import type { ContextAnnotation } from '~/types/context';
import { projectStore } from './project-store';
import { getProjectFiles, createProjectCommit } from './project-files';
import { runProjectAutoSetup } from './project-auto-run';

export interface ChatHistoryItem {
  id: string;
  urlId?: string;
  description?: string;
  messages: Message[];
  timestamp: string;
  metadata?: IChatMetadata;
}

const persistenceEnabled = !import.meta.env.VITE_DISABLE_PERSISTENCE;

export const db = persistenceEnabled ? await openDatabase() : undefined;

export const chatId = atom<string | undefined>(undefined);
export const description = atom<string | undefined>(undefined);
export const chatMetadata = atom<IChatMetadata | undefined>(undefined);

/**
 * Bumped every time a chat is saved (in `storeMessageHistory`).
 * The sidebar `Menu.client.tsx` subscribes to this atom and re-runs
 * `loadEntries()` whenever it changes — so newly-created chats show up
 * in the Recent Chats list immediately, without the user having to
 * close and reopen the sidebar.
 */
export const chatListVersion = atom(0);

/**
 * Tracks whether we've already kicked off the LLM title-generation
 * call for the current chat. This is a module-level Set (not a store)
 * because we only want to fire the title API once per chat ID, even
 * though `storeMessageHistory` runs many times as the assistant
 * response streams in.
 */
const _titleGenerationStarted = new Set<string>();

/**
 * Calls the `/api/chat-title` route to generate a short 4-8 word title
 * for a chat based on the first user message. Falls back gracefully if
 * the route is unavailable or returns an error.
 *
 * Uses the currently-selected model + provider from cookies so the
 * title is generated with the same provider the user is chatting with.
 */
async function generateChatTitle(_chatId: string, firstMessage: string): Promise<string | null> {
  try {
    /*
     * Read the current model + provider from the API keys cookie
     * (set by the ChatBox model selector).
     */
    let model = 'glm-4.7-flash';
    let provider = { name: 'Z.ai' } as any;

    try {
      const cookieMatch = document.cookie.split('; ').find((c) => c.startsWith('selectedModel='));

      if (cookieMatch) {
        const decoded = decodeURIComponent(cookieMatch.split('=')[1]);

        try {
          const parsed = JSON.parse(decoded);

          if (parsed.model) {
            model = parsed.model;
          }

          if (parsed.provider) {
            provider = parsed.provider;
          }
        } catch {
          // Not JSON — ignore
        }
      }
    } catch {
      // cookie read failed — use defaults
    }

    const response = await fetch('/api/chat-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: firstMessage, model, provider }),
    });

    if (!response.ok) {
      return null;
    }

    const data: any = await response.json();

    return data.title || null;
  } catch (e) {
    console.warn('[ChatHistory] generateChatTitle error:', e);
    return null;
  }
}

export function useChatHistory() {
  const navigate = useNavigate();
  const { id: mixedId } = useLoaderData<{ id?: string }>();
  const [searchParams] = useSearchParams();

  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

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

    if (mixedId) {
      /*
       * Reset `ready` + `initialMessages` so ChatImpl UNMOUNTS during the
       * async IndexedDB load. Without this, client-side navigation between
       * chats keeps ChatImpl mounted with stale state — `chatStarted` and
       * the `useChat` hook's internal `messages` only initialize from
       * `initialMessages` on FIRST mount, so the new chat's messages and
       * workspace files never render until a full page refresh.
       *
       * When the load completes, `setReady(true)` remounts ChatImpl fresh
       * — it picks up the new `initialMessages` AND the workspace files
       * that were restored into the WebContainer / workbenchStore during
       * the same async callback.
       */
      setReady(false);
      setInitialMessages([]);

      Promise.all([
        getMessages(db, mixedId),
        getSnapshot(db, mixedId), // Fetch snapshot from DB
      ])
        .then(async ([storedMessages, snapshot]) => {
          if (storedMessages && storedMessages.messages.length > 0) {
            /*
             * const snapshotStr = localStorage.getItem(`snapshot:${mixedId}`); // Remove localStorage usage
             * const snapshot: Snapshot = snapshotStr ? JSON.parse(snapshotStr) : { chatIndex: 0, files: {} }; // Use snapshot from DB
             */
            const validSnapshot = snapshot || { chatIndex: '', files: {} }; // Ensure snapshot is not undefined
            const summary = validSnapshot.summary;

            const rewindId = searchParams.get('rewindTo');
            const endingIdx = rewindId
              ? storedMessages.messages.findIndex((m) => m.id === rewindId) + 1
              : storedMessages.messages.length;
            const snapshotIndex = storedMessages.messages.findIndex((m) => m.id === validSnapshot.chatIndex);

            const filteredMessages = storedMessages.messages.slice(0, endingIdx);
            const archivedMessages: Message[] = [];

            setArchivedMessages(archivedMessages);

            /*
             * ── Project = source of truth ──────────────────────────────
             * If this chat is linked to a Project, restore the project's
             * GLOBAL file state (shared by all chats) instead of the stale
             * per-chat snapshot. This is what makes switching chats inside a
             * project never change the file version.
             *
             * IMPORTANT: skip the restore entirely when the project's files
             * are ALREADY loaded in the WebContainer (same project, different
             * chat). This prevents the workspace from visually "reloading" on
             * every chat switch inside a project — only the chat messages
             * change.
             */
            const linkedProject =
              projectStore.getProjectByChat(storedMessages.id) ??
              (storedMessages.metadata?.projectId
                ? projectStore.getProject(storedMessages.metadata.projectId)
                : undefined);

            const currentlyLoadedProjectId = workbenchStore.loadedProjectId.get();

            if (linkedProject) {
              const projectFiles = await getProjectFiles(db, linkedProject.id);

              if (
                currentlyLoadedProjectId === linkedProject.id &&
                projectFiles?.files &&
                Object.keys(projectFiles.files).length > 0
              ) {
                /*
                 * Same project, different chat — just bump the workbench
                 * file store reference so the editor / file tree pick up
                 * any in-memory edits, but DON'T re-write to WebContainer.
                 */
                workbenchStore.files.set(projectFiles.files);
              } else if (projectFiles?.files && Object.keys(projectFiles.files).length > 0) {
                await restoreFileMap(projectFiles.files);
                workbenchStore.files.set(projectFiles.files);

                /*
                 * Switching to a different project — reset the auto-start
                 * flag so the new project's setup + start command can fire.
                 */
                if (currentlyLoadedProjectId !== linkedProject.id) {
                  workbenchStore.projectAutoStarted.set(false);
                }

                workbenchStore.loadedProjectId.set(linkedProject.id);

                /*
                 * Auto-detect + persist project commands (setupCommand /
                 * startCommand / projectType) so the sidebar can show them
                 * and the auto-run helper can fire them.
                 */
                try {
                  const fileList = Object.entries(projectFiles.files)
                    .filter(([, v]) => v?.type === 'file')
                    .map(([path, v]) => ({ path, content: (v as any)?.content ?? '' }));

                  if (fileList.length > 0) {
                    const detected = await detectProjectCommands(fileList);

                    if (detected && (detected.setupCommand || detected.startCommand)) {
                      projectStore.setProjectCommands(linkedProject.id, {
                        type: detected.type,
                        setupCommand: detected.setupCommand,
                        startCommand: detected.startCommand,
                        followupMessage: detected.followupMessage,
                      });
                    }
                  }
                } catch (e) {
                  console.warn('[ChatHistory] detectProjectCommands failed:', e);
                }

                /*
                 * Open the workbench + trigger auto setup & start command
                 * (npm install / npm run dev) once per session per project.
                 * The helper checks `projectAutoStarted` so it won't fire
                 * again on subsequent chat switches inside the same project.
                 */
                workbenchStore.showWorkbench.set(true);

                if (!workbenchStore.projectAutoStarted.get()) {
                  runProjectAutoSetup(linkedProject).catch((e) => console.warn('[ChatHistory] Auto setup failed:', e));
                }
              } else if (storedMessages.metadata?.projectInitiated && snapshotIndex >= 0) {
                /*
                 * Fallback for chats promoted before the project-files store
                 * existed: seed the project from the legacy chat snapshot.
                 */
                restoreSnapshot(mixedId);
                workbenchStore.loadedProjectId.set(linkedProject.id);
              }
            } else {
              /*
               * Personal chat — mark the loaded project as "<none>" so a
               * subsequent switch back into a project re-restores its files.
               */
              if (currentlyLoadedProjectId !== '<none>') {
                workbenchStore.loadedProjectId.set('<none>');
                workbenchStore.projectAutoStarted.set(false);
              }

              if (storedMessages.metadata?.projectInitiated && snapshotIndex >= 0) {
                restoreSnapshot(mixedId);
              }
            }

            setInitialMessages(filteredMessages);

            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
          } else if (storedMessages && storedMessages.metadata?.projectId) {
            /*
             * Empty chat linked to a project — e.g. a fresh "New chat in
             * project" created via the sidebar.
             *
             * We do NOT blindly restore project files here. If the project
             * is already loaded in the WebContainer (the common case — the
             * user is already in the project and just wants a new chat),
             * we keep the workspace exactly as-is and only reset the chat
             * state to an empty conversation. No file re-injection, no
             * dependency reinstall, no terminal flicker — switching chats
             * inside a project is instant.
             *
             * If the project is NOT yet loaded (rare — e.g. a direct URL
             * load of an empty project chat, or the first project chat
             * opened this session), we restore the project's files once so
             * the workspace is usable.
             */
            const linkedProject = projectStore.getProject(storedMessages.metadata.projectId!);
            const currentlyLoadedProjectId = workbenchStore.loadedProjectId.get();

            if (linkedProject && currentlyLoadedProjectId === linkedProject.id) {
              /*
               * Fast path — same project already loaded. Keep the workspace
               * (files, running dev server, terminal) untouched and just
               * reset the chat to an empty conversation. This is the
               * "new chat in project" experience: instant, no reload.
               *
               * Re-assert showWorkbench in case it was reset (e.g. by HMR
               * or a prior navigation to a non-project route).
               */
              workbenchStore.showWorkbench.set(true);
              setInitialMessages([]);
              setUrlId(storedMessages.urlId);
              description.set(storedMessages.description || '');
              chatId.set(storedMessages.id);
              chatMetadata.set(storedMessages.metadata);
            } else if (linkedProject) {
              /*
               * Project not yet loaded this session — restore its global
               * file state into the WebContainer so the workspace is
               * usable, then reset the chat to an empty conversation.
               */
              const projectFiles = await getProjectFiles(db, linkedProject.id);

              if (projectFiles?.files && Object.keys(projectFiles.files).length > 0) {
                await restoreFileMap(projectFiles.files);
                workbenchStore.files.set(projectFiles.files);
                workbenchStore.loadedProjectId.set(linkedProject.id);

                if (!workbenchStore.projectAutoStarted.get()) {
                  runProjectAutoSetup(linkedProject).catch((e) =>
                    console.warn('[ChatHistory] Auto setup failed for empty project chat:', e),
                  );
                }
              } else {
                /*
                 * Project has no committed files yet (e.g. a brand-new
                 * project created from the gallery). Mark the project as
                 * loaded so subsequent chats in this project take the fast
                 * path. The workspace still opens (below) so the user sees
                 * the empty editor + terminal.
                 */
                workbenchStore.loadedProjectId.set(linkedProject.id);
              }

              /*
               * Always open the workspace for a project chat — even if the
               * project has no files yet. This ensures the workspace
               * survives a page refresh (showWorkbench is an in-memory atom
               * that resets to false on reload, so we must re-assert it
               * here).
               */
              workbenchStore.showWorkbench.set(true);

              setInitialMessages([]);
              setUrlId(storedMessages.urlId);
              description.set(storedMessages.description || '');
              chatId.set(storedMessages.id);
              chatMetadata.set(storedMessages.metadata);
            } else {
              /*
               * Metadata points to a project that no longer exists — treat
               * as a plain empty chat and stay on the route so the user can
               * still type a message.
               */
              setInitialMessages([]);
              setUrlId(storedMessages.urlId);
              description.set(storedMessages.description || '');
              chatId.set(storedMessages.id);
              chatMetadata.set(storedMessages.metadata);
            }
          } else {
            navigate('/', { replace: true });
          }

          setReady(true);
        })
        .catch((error) => {
          console.error(error);

          logStore.logError('Failed to load chat messages or snapshot', error); // Updated error message
          toast.error('Failed to load chat: ' + error.message); // More specific error
        });
    } else {
      // Handle case where there is no mixedId (e.g., new chat)
      setReady(true);
    }
  }, [mixedId, db, navigate, searchParams]); // Added db, navigate, searchParams dependencies

  /*
   * One-time migration: fix legacy chats that were saved without a
   * `urlId` or with a `[Model: ...]` prefix in their description.
   *
   * Before the chat-title fix, text-only chats were saved with
   * `urlId: undefined` and `description` containing the raw
   * `[Model: ...]\n\n[Provider: ...]\n\n<user message>` prefix. This
   * migration runs once on app load and repairs those entries so they
   * show up in the sidebar with clean titles.
   *
   * Note: the `urlId` index has a uniqueness constraint, so we collect
   * all existing urlIds first and generate unique ones for chats that
   * are missing them (by appending a suffix if the chatId is already
   * taken as a urlId by another chat).
   */
  useEffect(() => {
    if (!db) {
      return;
    }

    (async () => {
      try {
        const allChats = await getAll(db);
        let fixed = 0;

        /*
         * Collect all existing urlIds so we can avoid collisions when
         * assigning new ones.
         */
        const existingUrlIds = new Set<string>();

        for (const chat of allChats) {
          if (chat.urlId) {
            existingUrlIds.add(chat.urlId);
          }
        }

        for (const chat of allChats) {
          let needsUpdate = false;
          const updates: Partial<typeof chat> = {};

          // Fix missing urlId — generate a unique one
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

          // Fix description with [Model: ...] prefix
          if (chat.description && chat.description.startsWith('[Model:')) {
            const cleaned = chat.description
              .replace(/^\[Model:[^\]]*\]\s*\n*\s*\[Provider:[^\]]*\]\s*\n*\s*/i, '')
              .trim();
            updates.description = cleaned.slice(0, 60) || 'New chat';
            needsUpdate = true;
          }

          // Fix missing description
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
              /*
               * Skip this chat if it still fails (e.g. collision we
               * couldn't resolve) — don't abort the whole migration.
               */
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
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [db]);

  const takeSnapshot = useCallback(
    async (chatIdx: string, files: FileMap, _chatId?: string | undefined, chatSummary?: string) => {
      const id = chatId.get();

      if (!id || !db) {
        return;
      }

      /*
       * ── Project = source of truth ──────────────────────────────────
       * If this chat is linked to a Project, persist the file state to the
       * PROJECT (a versioned commit + the current pointer), NOT a per-chat
       * snapshot. Every chat in the project shares this same state.
       */
      const project = projectStore.getProjectByChat(id);

      if (project) {
        try {
          const message = chatSummary?.slice(0, 80) || `Update via chat ${id}`;

          await createProjectCommit(db, project.id, message, files, id);
          projectStore.updateProject(project.id, {
            currentCommitId: (await getProjectFiles(db, project.id))?.currentCommitId,
          });

          /*
           * Refresh structured project memory from the new file state.
           * Missing fields are filled in; user-edited fields are preserved.
           */
          try {
            const { detectProjectMemory, mergeDetectedMemory } = await import(
              '~/lib/persistence/project-memory-detect'
            );
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

      // Legacy per-chat snapshot for personal (non-project) chats.
      const snapshot: Snapshot = {
        chatIndex: chatIdx,
        files,
        summary: chatSummary,
      };

      // localStorage.setItem(`snapshot:${id}`, JSON.stringify(snapshot)); // Remove localStorage usage
      try {
        await setSnapshot(db, id, snapshot);
      } catch (error) {
        console.error('Failed to save snapshot:', error);
        toast.error('Failed to save chat snapshot.');
      }
    },
    [db],
  );

  const restoreSnapshot = useCallback(async (id: string, snapshot?: Snapshot) => {
    // const snapshotStr = localStorage.getItem(`snapshot:${id}`); // Remove localStorage usage
    const container = await webcontainer;

    const validSnapshot = snapshot || { chatIndex: '', files: {} };

    if (!validSnapshot?.files) {
      return;
    }

    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (key.startsWith(container.workdir)) {
        key = key.replace(container.workdir, '');
      }

      if (value?.type === 'folder') {
        await container.fs.mkdir(key, { recursive: true });
      }
    });
    Object.entries(validSnapshot.files).forEach(async ([key, value]) => {
      if (value?.type === 'file') {
        if (key.startsWith(container.workdir)) {
          key = key.replace(container.workdir, '');
        }

        await container.fs.writeFile(key, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
      } else {
      }
    });

    // workbenchStore.files.setKey(snapshot?.files)
  }, []);

  /**
   * Restore an arbitrary FileMap (the project's global file state) into the
   * WebContainer. This is the project-source-of-truth variant of
   * `restoreSnapshot` — it does not depend on a chatId.
   */
  const restoreFileMap = useCallback(async (files: FileMap) => {
    const container = await webcontainer;

    // Create folders first, then write files.
    const entries = Object.entries(files);

    for (const [rawKey, value] of entries) {
      if (value?.type !== 'folder') {
        continue;
      }

      let key = rawKey;

      if (key.startsWith(container.workdir)) {
        key = key.replace(container.workdir, '');
      }

      try {
        await container.fs.mkdir(key, { recursive: true });
      } catch {
        /* ignore */
      }
    }

    for (const [rawKey, value] of entries) {
      if (value?.type !== 'file') {
        continue;
      }

      let key = rawKey;

      if (key.startsWith(container.workdir)) {
        key = key.replace(container.workdir, '');
      }

      try {
        await container.fs.writeFile(key, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
      } catch {
        /* ignore */
      }
    }
  }, []);

  return {
    ready: !mixedId || ready,
    initialMessages,
    /*
     * The route-scoped chat key (urlId for chat pages, undefined for home).
     * Used as a React `key` on <ChatImpl> so the component FULLY remounts
     * whenever the route changes — resetting `chatStarted`, the `useChat`
     * hook's internal message state, and all derived UI state. Without
     * this, client-side navigation between chats (or chat → home) keeps
     * ChatImpl mounted with stale state.
     */
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
    storeMessageHistory: async (messages: Message[]) => {
      if (!db || messages.length === 0) {
        return;
      }

      const { firstArtifact } = workbenchStore;
      messages = messages.filter((m) => !m.annotations?.includes('no-store'));

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
        const annotations = lastMessage.annotations as JSONValue[];
        const filteredAnnotations = (annotations?.filter(
          (annotation: JSONValue) =>
            annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
        ) || []) as { type: string; value: any } & { [key: string]: any }[];

        if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
          chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
        }
      }

      takeSnapshot(messages[messages.length - 1].id, workbenchStore.files.get(), _urlId, chatSummary);

      if (!description.get() && firstArtifact?.title) {
        description.set(firstArtifact?.title);
      }

      if (firstArtifact) {
        const currentMetadata = chatMetadata.get() || {};
        chatMetadata.set({ ...currentMetadata, projectInitiated: true });
      }

      /*
       * Auto-promote chat to project when workspace is first invoked.
       * This is the "Open Workspace" moment: a normal chat becomes a
       * project-linked chat, and the current file state is seeded as the
       * project's first commit (the global source of truth from here on).
       */
      if (firstArtifact) {
        const currentId = chatId.get();

        if (currentId && !projectStore.getProjectByChat(currentId)) {
          try {
            const project = await projectStore.promoteChatToProject(
              currentId,
              firstArtifact.title || 'Untitled Project',
            );

            // Seed the project's global file state + first commit.
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

              /*
               * Detect setup/start commands from the freshly seeded files so
               * subsequent project loads can auto-run them without the AI.
               */
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

              // Mark this project as the loaded one + kick off auto-setup.
              workbenchStore.loadedProjectId.set(project.id);

              if (!workbenchStore.projectAutoStarted.get()) {
                runProjectAutoSetup(project).catch((e) =>
                  console.warn('[ChatHistory] Auto setup failed on promote:', e),
                );
              }
            }

            /*
             * Persist projectId on the chat metadata so the link survives
             * reloads even if the localStorage project index is reset.
             */
            const currentMetadata = chatMetadata.get() || {};
            chatMetadata.set({ ...currentMetadata, projectId: project.id });
          } catch (e) {
            console.warn('[ChatHistory] Failed to auto-promote chat to project:', e);
          }
        }
      }

      // Ensure chatId.get() is used here as well
      if (initialMessages.length === 0 && !chatId.get()) {
        const nextId = await getNextId(db);

        chatId.set(nextId);

        if (!urlId) {
          navigateChat(nextId);
        }
      }

      /*
       * For text-only chats (no artifact), urlId is never set by the
       * artifact block above. We need a urlId so the sidebar filter
       * (`item.urlId`) doesn't hide the chat, and so the chat is
       * addressable via `/chat/<urlId>`. We use the chatId itself as
       * the urlId for text-only chats — this mirrors how the artifact
       * flow derives urlId from the artifact id.
       */
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
        finalChatId, // Use the potentially updated chatId
        [...archivedMessages, ...messages],
        _finalUrlId,
        description.get(),
        undefined,
        chatMetadata.get(),
      );

      /*
       * Chat title generation — runs for EVERY chat (text-only AND
       * artifact / project chats).
       *
       * Previously the LLM title call was gated behind `if (!firstArtifact)`,
       * which meant artifact chats (including `inject_template` / project
       * chats) were stuck with the artifact's title — almost always
       * "Create initial files" — and never got a descriptive name. That
       * made the sidebar unreadable: every project chat read "Create
       * initial files".
       *
       * Now:
       *   1. For text-only chats: set a provisional truncated title from
       *      the first user message immediately (so the chat is never
       *      untitled), then fire a one-shot LLM call to `/api/chat-title`
       *      for a clean 4-8 word title.
       *   2. For artifact / project chats: skip the provisional title
       *      (the artifact title is already set), but STILL fire the LLM
       *      call. When it returns, we override the description ONLY if
       *      the current title is a default placeholder ("Create initial
       *      files", "Untitled Project", "New project chat", etc.) — so
       *      we never clobber a meaningful AI-provided title, but we do
       *      fix the common default case. We also rename the linked
       *      project if it still has a default name.
       */
      const firstUserMessage = messages.find((m) => m.role === 'user');
      const firstAssistantMessage = messages.find((m) => m.role === 'assistant');

      if (firstUserMessage) {
        const rawContent: any = firstUserMessage.content;
        let userText: string =
          typeof rawContent === 'string'
            ? rawContent
            : Array.isArray(rawContent)
              ? rawContent
                  .filter((p: any) => p.type === 'text')
                  .map((p: any) => p.text)
                  .join(' ')
              : '';

        /*
         * Strip the [Model: ...]\n\n[Provider: ...]\n\n prefix that
         * extractPropertiesFromMessage injects into user messages.
         */
        userText = userText.replace(/^\[Model:[^\]]*\]\s*\n*\s*\[Provider:[^\]]*\]\s*\n*\s*/i, '').trim();

        /*
         * 1. Provisional fallback title (instant) — only for text-only
         *    chats (artifact chats already have firstArtifact.title set).
         *    Set immediately so the chat shows up in the sidebar.
         */
        if (!firstArtifact && !description.get()) {
          const provisionalTitle =
            userText.slice(0, 60).trim() + (userText.length > 60 ? '…' : '') || 'New Conversation';
          description.set(provisionalTitle);

          /*
           * Re-save immediately so the chat shows up in the sidebar
           * with the provisional title right away.
           */
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

        /*
         * 2. One-shot LLM title generation — fires once per chat when
         *    the first assistant response is available. Runs for ALL
         *    chats (text-only AND artifact/project). For artifact chats
         *    we only override the default placeholder title, so a
         *    meaningful AI-provided title is preserved.
         */
        if (firstAssistantMessage && !_titleGenerationStarted.has(finalChatId)) {
          _titleGenerationStarted.add(finalChatId);

          generateChatTitle(finalChatId, userText)
            .then((title) => {
              if (!title || chatId.get() !== finalChatId) {
                return;
              }

              const currentDesc = description.get() || '';
              const isDefaultPlaceholder =
                !currentDesc ||
                currentDesc === 'Create initial files' ||
                currentDesc === 'Untitled Project' ||
                currentDesc === 'New project chat' ||
                currentDesc === 'New Conversation';

              /*
               * For text-only chats: always apply the LLM title.
               * For artifact/project chats: only override a default
               * placeholder, never clobber a meaningful title.
               */
              const shouldApply = !firstArtifact || isDefaultPlaceholder;

              if (!shouldApply) {
                return;
              }

              description.set(title);

              setMessages(
                db,
                finalChatId,
                [...archivedMessages, ...messages],
                _finalUrlId,
                title,
                undefined,
                chatMetadata.get(),
              ).then(() => {
                chatListVersion.set(chatListVersion.get() + 1);

                /*
                 * If this is a project chat whose project still has a
                 * default name, rename the project to match the new
                 * title too — so the sidebar project card shows a
                 * descriptive name instead of "Create initial files".
                 */
                try {
                  const linkedProject = projectStore.getProjectByChat(finalChatId);

                  if (linkedProject) {
                    const isDefaultProjectName =
                      linkedProject.name === 'Create initial files' ||
                      linkedProject.name === 'Untitled Project' ||
                      linkedProject.name === 'New project chat' ||
                      /^Project \d+$/.test(linkedProject.name);

                    if (isDefaultProjectName) {
                      projectStore.updateProject(linkedProject.id, { name: title });
                    }
                  }
                } catch (e) {
                  console.warn('[ChatHistory] Failed to rename project after title gen:', e);
                }
              });
            })
            .catch((e) => {
              console.warn('[ChatHistory] Title generation failed:', e);
              _titleGenerationStarted.delete(finalChatId); // allow retry
            });
        }
      }

      /*
       * Notify the sidebar that the chat list has changed so it can
       * re-fetch from IndexedDB and show the new/updated chat.
       */
      chatListVersion.set(chatListVersion.get() + 1);
    },
    duplicateCurrentChat: async (listItemId: string) => {
      if (!db || (!mixedId && !listItemId)) {
        return;
      }

      try {
        const newId = await duplicateChat(db, mixedId || listItemId);
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (description: string, messages: Message[], metadata?: IChatMetadata) => {
      if (!db) {
        return;
      }

      try {
        const newId = await createChatFromMessages(db, description, messages, metadata);
        window.location.href = `/chat/${newId}`;
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

function navigateChat(nextId: string) {
  /**
   * FIXME: Using the intended navigate function causes a rerender for <Chat /> that breaks the app.
   *
   * `navigate(`/chat/${nextId}`, { replace: true });`
   */
  const url = new URL(window.location.href);
  url.pathname = `/chat/${nextId}`;

  window.history.replaceState({}, '', url);
}
