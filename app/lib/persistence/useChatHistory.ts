import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type Message } from 'ai';
import { toast } from 'react-toastify';
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
import { DEFAULT_MODEL, DEFAULT_PROVIDER, PROVIDER_LIST } from '~/utils/constants';

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

export const chatListVersion = atom(0);

const _titleGenerationStarted = new Set<string>();

async function generateChatTitle(_chatId: string, firstMessage: string): Promise<string | null> {
  try {
    let model = DEFAULT_MODEL;
    let provider: { name: string } = { name: DEFAULT_PROVIDER.name };

    const getCookie = (name: string): string | null => {
      const match = document.cookie.split('; ').find((c) => c.startsWith(`${name}=`));

      if (!match) {
        return null;
      }

      try {
        return decodeURIComponent(match.split('=').slice(1).join('='));
      } catch {
        return null;
      }
    };

    const modelCookie = getCookie('selectedModel');

    if (modelCookie) {
      model = modelCookie;
    }

    const providerCookie = getCookie('selectedProvider');

    if (providerCookie) {
      const found = PROVIDER_LIST.find((p) => p.name === providerCookie);

      if (found) {
        provider = found;
      } else {
        provider = { name: providerCookie };
      }
    }

    let apiKeys: Record<string, string> = {};

    try {
      const stored = localStorage.getItem('apiKeys');

      if (stored) {
        apiKeys = JSON.parse(stored);
      }
    } catch {
      // ignore
    }

    const response = await fetch('/api/chat-title', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ message: firstMessage, model, provider, apiKeys }),
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
  const { id: mixedId, projectId: urlProjectId } = useLoaderData<{ id?: string; projectId?: string }>();
  const [searchParams] = useSearchParams();

  const [archivedMessages, setArchivedMessages] = useState<Message[]>([]);
  const [initialMessages, setInitialMessages] = useState<Message[]>([]);
  const [ready, setReady] = useState<boolean>(false);
  const [urlId, setUrlId] = useState<string | undefined>();

  // Define restoreFileMap before it's used in the effect
  const restoreFileMap = useCallback(async (files: FileMap) => {
    const container = await webcontainer;

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
    url.pathname = `/chat/${nextId}`;

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
       * This avoids the "Loading workspace..." hang by ensuring files are restored
       * in parallel with chat messages, rather than waiting for them.
       */
      if (urlProjectId) {
        console.log('[ChatHistory] urlProjectId detected:', urlProjectId);

        const project = projectStore.getProject(urlProjectId);

        if (project) {
          console.log('[ChatHistory] Project found in store:', project.name);

          (async () => {
            try {
              /*
               * DESTROY + REINITIALIZE the workspace on every chat switch.
               *
               * This is critical: without it, terminal processes (dev server)
               * from the previous chat leak into the new one, and orphan files
               * from a previous project persist in the WebContainer FS.
               *
               * clearWorkspace() kills running processes, clears the FS, and
               * resets projectAutoStarted so runProjectAutoSetup will fire.
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
                console.warn('[ChatHistory] No files found for project:', project.id);
                workbenchStore.files.set({});
              }

              workbenchStore.loadedProjectId.set(project.id);
              workbenchStore.showWorkbench.set(true);

              /*
               * Always run auto-setup (npm install + start) on every chat
               * load. clearWorkspace() already reset projectAutoStarted to
               * false, so runProjectAutoSetup will fire. This ensures the
               * dev server is always running for the current project.
               */
              console.log('[ChatHistory] Running auto setup for project:', project.id);
              runProjectAutoSetup(project).catch((e) => console.warn('[ChatHistory] Auto setup failed:', e));
            } catch (e) {
              console.error('[ChatHistory] Immediate project load failed:', e);
            }
          })();
        } else {
          console.warn('[ChatHistory] Project not found in store for ID:', urlProjectId);
        }
      }

      Promise.all([getMessages(db, finalChatIdToLoad!), getSnapshot(db, finalChatIdToLoad!)])
        .then(async ([storedMessages, snapshot]) => {
          if (storedMessages && storedMessages.messages.length > 0) {
            const validSnapshot = snapshot || { chatIndex: '', files: {} };
            const rewindId = searchParams.get('rewindTo');
            const endingIdx = rewindId
              ? storedMessages.messages.findIndex((m) => m.id === rewindId) + 1
              : storedMessages.messages.length;

            const filteredMessages = storedMessages.messages.slice(0, endingIdx);
            const archivedMessages: Message[] = [];

            setArchivedMessages(archivedMessages);

            const linkedProject =
              projectStore.getProjectByChat(storedMessages.id) ??
              (storedMessages.metadata?.projectId
                ? projectStore.getProject(storedMessages.metadata.projectId)
                : undefined);

            if (!linkedProject) {
              /*
               * Personal chat loaded via /chat/{chatId}. If a project was
               * previously loaded, destroy the workspace (kill processes,
               * clear FS) so terminal processes from the project don't leak
               * into this personal chat.
               */
              if (workbenchStore.loadedProjectId.get() !== '<none>') {
                await workbenchStore.clearWorkspace();
              }

              if (storedMessages.metadata?.projectInitiated && snapshot) {
                restoreSnapshot(mixedId || '', snapshot);

                /*
                 * Safety net: restoreSnapshot writes to the WebContainer FS
                 * but does NOT update workbenchStore.files. Without this,
                 * hasFiles stays false and the workspace shows "Loading…"
                 * forever if the IIFE failed. Populate the file store from
                 * the snapshot.
                 */
                if (snapshot?.files && Object.keys(snapshot.files).length > 0) {
                  const currentFiles = workbenchStore.files.get();

                  if (!currentFiles || Object.keys(currentFiles).length === 0) {
                    workbenchStore.files.set(snapshot.files);
                  }
                }

                workbenchStore.showWorkbench.set(true);
              }
            } else if (storedMessages.metadata?.projectInitiated && snapshot) {
              restoreSnapshot(mixedId || '', snapshot);
              workbenchStore.loadedProjectId.set(linkedProject?.id || '<none>');
              workbenchStore.showWorkbench.set(true);

              /*
               * Safety net: same as above — restoreSnapshot writes to the
               * WebContainer but not to the file store. If the IIFE failed,
               * populate the file store from the snapshot so hasFiles
               * becomes true and the workspace renders.
               */
              if (snapshot?.files && Object.keys(snapshot.files).length > 0) {
                const currentFiles = workbenchStore.files.get();

                if (!currentFiles || Object.keys(currentFiles).length === 0) {
                  workbenchStore.files.set(snapshot.files);
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
            navigate('/', { replace: true });
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
  }, [mixedId, urlProjectId, db, navigate, searchParams, restoreFileMap, restoreSnapshot]);

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

      let lastUserText: string | undefined;

      for (let i = messages.length - 1; i >= 0; i--) {
        if (messages[i].role === 'user') {
          const c: any = messages[i].content;

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

              if (!workbenchStore.projectAutoStarted.get()) {
                runProjectAutoSetup(project).catch((e) =>
                  console.warn('[ChatHistory] Auto setup failed on promote:', e),
                );
              }
            }

            const currentMetadata = chatMetadata.get() || {};
            chatMetadata.set({ ...currentMetadata, projectId: project.id });
          } catch (e) {
            console.warn('[ChatHistory] Failed to auto-promote chat to project:', e);
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

        userText = userText.replace(/^\[Model:[^\]]*\]\s*\n*\s*\[Provider:[^\]]*\]\s*\n*\s*/i, '').trim();

        if (!firstArtifact && !description.get()) {
          const provisionalTitle =
            userText.slice(0, 60).trim() + (userText.length > 60 ? '…' : '') || 'New Conversation';
          description.set(provisionalTitle);

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
              _titleGenerationStarted.delete(finalChatId);
            });
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
        navigate(`/chat/${newId}`);
        toast.success('Chat duplicated successfully');
      } catch (error) {
        toast.error('Failed to duplicate chat');
        console.log(error);
      }
    },
    importChat: async (
      description: string,
      messages: Message[],
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
        } else if (description.startsWith('Git Project:')) {
          const projectName = description.replace('Git Project:', '').trim();
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
