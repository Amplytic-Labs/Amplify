import { useLoaderData, useNavigate, useSearchParams } from '@remix-run/react';
import { useState, useEffect, useCallback } from 'react';
import { atom } from 'nanostores';
import { generateId, type JSONValue, type Message } from 'ai';
import { toast } from 'react-toastify';
import { workbenchStore } from '~/lib/stores/workbench';
import { logStore } from '~/lib/stores/logs'; // Import logStore
import {
  getMessages,
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
      Promise.all([
        getMessages(db, mixedId),
        getSnapshot(db, mixedId), // Fetch snapshot from DB
      ])
        .then(async ([storedMessages, snapshot]) => {
          if (storedMessages && storedMessages.messages.length > 0) {
            /*
             * BUG #1 + #2 FIX:
             * Reset ALL workbench singleton state before loading the new chat
             * so artifacts/files/view from the previous chat cannot leak in.
             */
            workbenchStore.reset();

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

            if (storedMessages.metadata?.projectInitiated && snapshotIndex >= 0) {
              /*
               * BUG #1 FIX: pass the ACTUAL fetched snapshot (previously this
               * was called with only the id, so restoreSnapshot defaulted to
               * `{ files: {} }` and wrote zero files → empty workspace).
               */
              await restoreSnapshot(mixedId, validSnapshot);
            }

            // Even for non-project chats, clear any leftover WebContainer
            // files from the previous chat so they don't bleed across.
            if (!(storedMessages.metadata?.projectInitiated && snapshotIndex >= 0)) {
              await clearWebContainerWorkdir();
            }

            setInitialMessages(filteredMessages);

            setUrlId(storedMessages.urlId);
            description.set(storedMessages.description);
            chatId.set(storedMessages.id);
            chatMetadata.set(storedMessages.metadata);
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
      /*
       * BUG #2 FIX: New chat (no mixedId). Reset ALL singleton state so the
       * previous chat's messages/files/chatId cannot leak into this new chat.
       * Previously `chatId` was left holding the previous chat's id, so
       * `storeMessageHistory` would save the new chat's messages into the OLD
       * chat's row — corrupting it.
       */
      workbenchStore.reset();
      chatId.set(undefined);
      description.set(undefined);
      chatMetadata.set(undefined);
      setInitialMessages([]);
      setArchivedMessages([]);
      setUrlId(undefined);
      void clearWebContainerWorkdir();
      setReady(true);
    }
  }, [mixedId, db, navigate, searchParams]); // Added db, navigate, searchParams dependencies

  const takeSnapshot = useCallback(
    async (chatIdx: string, files: FileMap, _chatId?: string | undefined, chatSummary?: string) => {
      const id = chatId.get();

      if (!id || !db) {
        return;
      }

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
    const container = await webcontainer;

    const validSnapshot = snapshot || { chatIndex: '', files: {} };

    if (!validSnapshot?.files || Object.keys(validSnapshot.files).length === 0) {
      return;
    }

    /*
     * Clear the previous chat's files from the WebContainer workdir first so
     * orphaned files from chat A cannot bleed into chat B.
     */
    await clearWebContainerWorkdir(container);

    // 1. Create folders first (depth-first, recursive).
    await Promise.all(
      Object.entries(validSnapshot.files).map(async ([key, value]) => {
        if (value?.type !== 'folder') {
          return;
        }

        let p = key;

        if (p.startsWith(container.workdir)) {
          p = p.replace(container.workdir, '');
        }

        try {
          await container.fs.mkdir(p, { recursive: true });
        } catch (e) {
          // ignore — folder may already exist
        }
      }),
    );

    // 2. Write files.
    await Promise.all(
      Object.entries(validSnapshot.files).map(async ([key, value]) => {
        if (value?.type !== 'file') {
          return;
        }

        let p = key;

        if (p.startsWith(container.workdir)) {
          p = p.replace(container.workdir, '');
        }

        try {
          await container.fs.writeFile(p, value.content, { encoding: value.isBinary ? undefined : 'utf8' });
        } catch (e) {
          console.warn('[restoreSnapshot] Failed to write file', p, e);
        }
      }),
    );

    /*
     * BUG #1 FIX: Directly populate `workbenchStore.files` from the snapshot
     * so the editor renders files immediately — instead of relying solely on
     * the WebContainer file watcher (which can miss events or race with
     * initialization, leaving the workspace IDE empty).
     */
    workbenchStore.loadFilesFromSnapshot(validSnapshot.files);
    workbenchStore.showWorkbench.set(true);

    console.log(
      `[restoreSnapshot] Restored ${Object.keys(validSnapshot.files).length} entries for chat ${id}`,
    );
  }, []);

  return {
    ready: !mixedId || ready,
    initialMessages,
    mixedId,
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

      // Auto-promote chat to project when workspace is first invoked
      if (firstArtifact) {
        const currentId = chatId.get();
        if (currentId && !projectStore.getProjectByChat(currentId)) {
          try {
            projectStore.promoteChatToProject(currentId, firstArtifact.title || 'Untitled Project');
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

      // Ensure chatId.get() is used for the final setMessages call
      const finalChatId = chatId.get();

      if (!finalChatId) {
        console.error('Cannot save messages, chat ID is not set.');
        toast.error('Failed to save chat messages: Chat ID missing.');

        return;
      }

      await setMessages(
        db,
        finalChatId, // Use the potentially updated chatId
        [...archivedMessages, ...messages],
        urlId,
        description.get(),
        undefined,
        chatMetadata.get(),
      );
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

/**
 * Clears the WebContainer workdir of all top-level entries so files from a
 * previous chat cannot bleed into the next one. Safe to call before the
 * WebContainer has booted (it awaits the boot promise). Errors are swallowed
 * because a missing entry or a busy fs is non-fatal during a chat switch.
 */
export async function clearWebContainerWorkdir(container?: Awaited<typeof webcontainer>) {
  try {
    const wc = container ?? (await webcontainer);
    const entries = await wc.fs.readdir(wc.workdir, { withFileTypes: true });

    await Promise.all(
      entries.map(async (entry) => {
        try {
          await wc.fs.rm(`${wc.workdir}/${entry.name}`, { recursive: true, force: true });
        } catch {
          /* ignore individual entry failures */
        }
      }),
    );
  } catch (e) {
    console.warn('[clearWebContainerWorkdir] failed', e);
  }
}

