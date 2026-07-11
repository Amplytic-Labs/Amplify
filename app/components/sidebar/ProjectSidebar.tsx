import React, { useState, useRef, useEffect, useCallback, useMemo } from 'react';
import {
  ChevronDown,
  Search,
  LayoutGrid,
  List,
  LayoutTemplate,
  CircleDashed,
  MoreHorizontal,
  Download,
  Copy,
  Pencil,
  Trash2,
  Check,
  Plus,
  Folder,
  ArrowLeft,
  MessageSquarePlus,
  Settings,
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { useParams, useNavigate } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { TemplatesModal } from './TemplatesModal';
import { ControlPanel } from '~/components/@settings/core/ControlPanel';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import {
  db,
  deleteById,
  getAll,
  chatId,
  chatListVersion,
  type ChatHistoryItem,
  useChatHistory,
  createChatFromMessages,
  getMessages,
} from '~/lib/persistence';
import { projectStore, type Project } from '~/lib/persistence/project-store';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';
import { useEditChatDescription } from '~/lib/hooks';
import { binDates } from './date-binning';
import { classNames } from '~/utils/classNames';
import { themeStore, setTheme } from '~/lib/stores/theme';
import ThemeToggle from './ThemeToggle';
import Amplify from './amplify';
import { selectedProjectId, setSelectedProject, clearSelectedProject } from '~/lib/stores/selectedProject';
import { workbenchStore } from '~/lib/stores/workbench';
import { insetView, showProjectsGallery, showChatView } from '~/lib/stores/insetView';
import { chatStore } from '~/lib/stores/chat';

const navItems = [
  { icon: LayoutGrid, label: 'Projects' },
  { icon: List, label: 'Chats' },
  { icon: LayoutTemplate, label: 'Templates' },
];

type DialogContent = { type: 'delete'; item: ChatHistoryItem } | null;

interface ProjectSidebarProps {
  user?: {
    name: string;
    email: string;
    avatar: string;
  };
}

export function ProjectSidebar({ user: _user }: ProjectSidebarProps) {
  const { duplicateCurrentChat, exportChat } = useChatHistory();

  /*
   * Active-chat detection: derive the current chat's urlId from the URL.
   *
   * Remix route param names come from the route filename:
   *   chat.$id.tsx          → /chat/<id>          → useParams() = { id }
   *   $projectId.$chatId.tsx → /<projectId>/<chatId> → useParams() = { projectId, chatId }
   *
   * Previously this used `const { id: urlId } = useParams()`, which returned
   * undefined on project-chat routes (the param is `chatId`, not `id`), so no
   * project chat was ever highlighted in the sidebar. Fall back to `chatId`
   * for the project-chat route.
   */
  const params = useParams();
  const urlId = params.id ?? params.chatId;
  const currentChatId = useStore(chatId);

  const [isNewChatDropdownOpen, setIsNewChatDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);

  /*
   * Settings / ControlPanel visibility. Previously the ONLY entry point to the
   * full Settings UI (providers, API keys, cloud connections, data export,
   * MCP, memory, etc.) lived inside the old Menu overlay, which is unreachable
   * in the new ProjectSidebar-based layout. Surfacing it here restores access
   * to the entire Settings surface.
   */
  const [isSettingsOpen, setIsSettingsOpen] = useState(false);

  const theme = useStore(themeStore);

  // Read the selected project reactively so the sidebar updates when it changes.
  const selectedProjectIdValue = useStore(selectedProjectId);

  /*
   * Whether the selected project's auto-setup (npm install + npm run dev) is
   * currently running. Drives the pulsing dot indicator in the
   * SelectedProjectPanel. Read reactively so the UI flips to "running" the
   * moment `runProjectAutoSetup` is invoked.
   */
  const projectAutoStarted = useStore(workbenchStore.projectAutoStarted);

  /*
   * Reactive read of the sidebar-inset view mode ('chat' | 'projects'). Drives
   * the active state of the Projects / Chats nav buttons.
   */
  const insetViewValue = useStore(insetView);

  /*
   * Live-refresh token: bumped every time a chat is saved in
   * `storeMessageHistory` (useChatHistory.ts). Subscribing here makes the
   * sidebar re-fetch its chat list from IndexedDB the instant a new chat is
   * created — no page refresh needed. Declared up top so both the
   * selected-project-chats effect and the main loadEntries effect can depend
   * on it.
   */
  const listVersion = useStore(chatListVersion);

  const [activeNav, setActiveNav] = useState('Chats');

  const [isRecentChatsExpanded, setIsRecentChatsExpanded] = useState(true);
  const [showAllChats, setShowAllChats] = useState(false);

  // Real chat history state
  const [list, setList] = useState<ChatHistoryItem[]>([]);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);

  /*
   * Search query for chats belonging to the currently-selected project
   * (used on the Chats nav when a project is selected). Filters
   * `selectedProjectChats` by description.
   */
  const [projectChatsSearch, setProjectChatsSearch] = useState('');

  /*
   * Project management dialog state (rename / delete from the gallery route
   * its dialogs through here too, but the gallery has its own dialogs; this
   * is kept for the sidebar's legacy wiring).
   */
  const [projectDialog, setProjectDialog] = useState<
    { type: 'delete'; project: Project } | { type: 'rename'; project: Project } | null
  >(null);

  /*
   * Reactive project list version — re-renders whenever any project changes
   * (create / rename / delete / memory update) because `_versionStore` is
   * bumped on every mutation. Used to keep the selected-project lookup fresh.
   */
  // @ts-expect-error — _versionStore is private but stable across releases.
  const projectsVersion = useStore(projectStore._versionStore);

  /*
   * The currently-selected project object (looked up fresh on every render
   * so we always have the latest memory / version / commands).
   */
  const selectedProject = useMemo(() => {
    if (!selectedProjectIdValue) {
      return undefined;
    }

    return projectStore.getProject(selectedProjectIdValue);
  }, [selectedProjectIdValue, projectsVersion]);

  const { filteredItems: filteredList, handleSearchChange } = useSearchFilter({
    items: list,
    searchFields: ['description'],
  });

  /*
   * Personal chats (no project linked) — shown when no project is selected
   * on the Chats nav.
   */
  const personalChats = useMemo(() => {
    return filteredList.filter((item) => projectStore.getChatCategory(item.id) === 'chat');
  }, [filteredList]);

  /*
   * Chats belonging to the currently-selected project — shown on the Chats
   * nav when a project is selected, and also in the Selected Project panel
   * under the Projects nav.
   */
  const [selectedProjectChats, setSelectedProjectChats] = useState<ChatHistoryItem[]>([]);
  const [loadingSelectedProjectChats, setLoadingSelectedProjectChats] = useState(false);

  useEffect(() => {
    if (!selectedProjectIdValue || !db) {
      setSelectedProjectChats([]);

      return;
    }

    const project = projectStore.getProject(selectedProjectIdValue);

    if (!project) {
      setSelectedProjectChats([]);

      return;
    }

    setLoadingSelectedProjectChats(true);
    Promise.all(project.chatIds.map((id) => getMessages(db!, id).catch(() => undefined)))
      .then((results) => {
        const valid = results.filter((c): c is ChatHistoryItem => !!c && !!c.urlId);
        valid.sort((a, b) => new Date(b.timestamp).getTime() - new Date(a.timestamp).getTime());
        setSelectedProjectChats(valid);
      })
      .finally(() => setLoadingSelectedProjectChats(false));
  }, [selectedProjectIdValue, projectsVersion, listVersion]);

  /*
   * Filter the selected project's chats by the project-chats search query.
   * Used both in the SelectedProjectPanel (Projects nav) and the
   * SelectedProjectChatsList (Chats nav) so the search bar behaves
   * consistently across both views.
   */
  const filteredProjectChats = useMemo(() => {
    const q = projectChatsSearch.trim().toLowerCase();

    if (!q) {
      return selectedProjectChats;
    }

    return selectedProjectChats.filter((c) => (c.description || '').toLowerCase().includes(q));
  }, [selectedProjectChats, projectChatsSearch]);

  // Backwards-compat alias used by the existing binned-chats render path.
  const categoryFilteredList = personalChats;

  /*
   * Sync the selected project with the current chat. When the user navigates
   * to a chat (via URL, sidebar click, or "new chat"), we look up the chat's
   * project and update the selection so the sidebar reflects the active
   * context. This is what makes "switch chat → don't reload workspace" work:
   * both chats are in the same project, so the selection (and loaded files)
   * stay the same.
   */
  useEffect(() => {
    if (!currentChatId) {
      /*
       * On the home page (no chat) — keep the current selection so the user
       * can browse the selected project's chats without losing context.
       */
      return;
    }

    const project = projectStore.getProjectByChat(currentChatId);

    if (project) {
      if (selectedProjectId.get() !== project.id) {
        setSelectedProject(project.id);
      }
    } else {
      // Personal chat — clear the selection so the sidebar shows personal chats.
      if (selectedProjectId.get() !== undefined) {
        clearSelectedProject();
      }
    }
  }, [currentChatId]);

  /**
   * Select a project from the Projects gallery (rendered in the sidebar inset)
   * or from the sidebar's old inline list. Sets the selection and creates a
   * new empty chat linked to the project so the user lands on a fresh
   * conversation with the project's files + memory loaded.
   *
   * The workspace auto-opens immediately (no AI interference, no user input
   * needed) — even on an empty chat — so the user sees the running preview
   * the moment they pick a project.
   *
   * If the current chat is already in the selected project, this is a no-op
   * for chat creation, but still ensures the workspace is visible.
   */
  const handleSelectProject = useCallback(async (project: Project) => {
    setSelectedProject(project.id);

    /*
     * Reset the project-chats search so the new project's chats aren't
     * accidentally filtered by the previous project's query.
     */
    setProjectChatsSearch('');

    /*
     * Make sure we're back in the chat view (the gallery may have been
     * showing in the inset).
     */
    showChatView();

    /*
     * Auto-open the workspace immediately so the user sees the project's
     * running preview without any AI / user input. The actual file restore
     * + `npm install` / `npm run dev` is handled by useChatHistory when the
     * new project chat loads (and skipped if the project is already loaded,
     * so switching chats inside a project never reloads the workspace).
     */
    workbenchStore.showWorkbench.set(true);

    /*
     * Already in this project? Just keep the current chat (no duplicate
     * empty chats) — but still make sure the workbench is open + auto-start
     * has fired.
     */
    const currentId = chatId.get();

    if (currentId) {
      const currentProject = projectStore.getProjectByChat(currentId);

      if (currentProject?.id === project.id) {
        if (!workbenchStore.projectAutoStarted.get()) {
          const { runProjectAutoSetup } = await import('~/lib/persistence/project-auto-run');
          runProjectAutoSetup(project).catch((e) => console.warn('[ProjectSidebar] Auto setup failed:', e));
        }

        return;
      }
    }

    // Create a new empty chat linked to the project.
    if (!db) {
      return;
    }

    try {
      const newUrlId = await createChatFromMessages(db, 'New project chat', [], {
        projectId: project.id,
        projectInitiated: true,
      });
      const newChat = await getMessages(db, newUrlId);

      if (newChat) {
        projectStore.linkChatToProject(newChat.id, project.id);
      }

      loadEntries();

      /*
       * Full page navigation — forces a complete reload so the workspace,
       * WebContainer, and file store are rebuilt from IndexedDB. This
       * guarantees the project's files + auto-setup (npm install + start)
       * run cleanly on every navigation, with no stale state from the
       * previous chat.
       */
      window.location.href = `/${project.id}/${newUrlId}`;
      toast.success(`Project "${project.name}" loaded`, { autoClose: 2000 });
    } catch (e) {
      console.error('[ProjectSidebar] Failed to load project:', e);
      toast.error('Failed to load project');
    }
  }, []);

  /**
   * Create a new chat in the currently-selected project and navigate to it.
   * The new chat inherits the project's global files + memory.
   */
  const handleNewChatInProject = useCallback(async (project: Project) => {
    if (!db) {
      return;
    }

    /*
     * Empty-chat guard — same pattern as handleNewChat below. If the
     * current chat hasn't started yet AND it belongs to this project,
     * don't create a duplicate empty chat.
     */
    if (!chatStore.get().started) {
      const currentChat = chatId.get();

      if (currentChat) {
        const currentProject = projectStore.getProjectByChat(currentChat);

        if (currentProject?.id === project.id) {
          // Already on an empty chat in this project — no-op.
          return;
        }
      }
    }

    try {
      /*
       * Before creating the new chat, reset the workbench and chat state.
       * This "destroys" the current workspace environment to prevent glitches
       * and ensure the new chat starts with a fresh, clean state.
       */
      workbenchStore.resetForNewChat();
      chatStore.setKey('started', false);

      const newUrlId = await createChatFromMessages(db, 'New project chat', [], {
        projectId: project.id,
        projectInitiated: true,
      });
      const newChat = await getMessages(db, newUrlId);

      if (newChat) {
        projectStore.linkChatToProject(newChat.id, project.id);
      }

      setSelectedProject(project.id);
      loadEntries();

      // Full page reload to the new chat — ensures clean workspace load.
      window.location.href = `/${project.id}/${newUrlId}`;
      toast.success('New chat created in project', { autoClose: 2000 });
    } catch (e) {
      console.error('[ProjectSidebar] Failed to create chat in project:', e);
      toast.error('Failed to create chat in project');
    }
  }, []);

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        /*
         * Only filter on urlId — previously this also required
         * `item.description`, which hid newly-created text-only chats
         * (their description is generated asynchronously by the
         * /api/chat-title route, and the provisional truncated title
         * is set in storeMessageHistory). Chats with no description
         * show up with a "New chat" placeholder label in the history
         * item.
         */
        .then((list) => list.filter((item) => item.urlId))
        .then((list) =>
          /*
           * Sort newest-first by timestamp so the most recent chat
           * appears at the top of the list immediately after creation.
           */
          list.sort((a, b) => {
            const ta = a.timestamp ? Date.parse(a.timestamp) : 0;
            const tb = b.timestamp ? Date.parse(b.timestamp) : 0;

            return tb - ta;
          }),
        )
        .then(setList)
        .catch((error) => toast.error(error.message));
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  /*
   * Live refresh: re-fetch the chat list from IndexedDB whenever a chat is
   * created or updated. `chatListVersion` is bumped at the end of
   * `storeMessageHistory` in useChatHistory.ts (and again after the async
   * LLM title update). The subscription is declared up top; this effect just
   * wires it to loadEntries.
   */
  useEffect(() => {
    if (db) {
      loadEntries();
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [listVersion]);

  // Delete single chat
  const deleteChat = useCallback(async (id: string): Promise<void> => {
    if (!db) {
      throw new Error('Database not available');
    }

    try {
      localStorage.removeItem(`snapshot:${id}`);
    } catch (e) {
      console.error(`Error deleting snapshot for chat ${id}:`, e);
    }
    await deleteById(db, id);
  }, []);

  const deleteItem = useCallback(
    (event: React.UIEvent, item: ChatHistoryItem) => {
      event.preventDefault();
      event.stopPropagation();
      deleteChat(item.id)
        .then(() => {
          toast.success('Chat deleted successfully', { position: 'bottom-right', autoClose: 3000 });

          /*
           * Unlink the deleted chat from any project it belonged to so the
           * project's chatIds array stays in sync (otherwise the
           * SelectedProjectChatsList would keep showing a stale entry until
           * the next full reload).
           */
          projectStore.unlinkChat(item.id);

          /*
           * Bump the chat-list version so every subscriber (including the
           * selected-project-chats effect above) re-fetches from IndexedDB
           * and the deleted chat disappears immediately.
           */
          chatListVersion.set(chatListVersion.get() + 1);

          loadEntries();

          if (chatId.get() === item.id) {
            window.location.href = '/';
          }
        })
        .catch((error) => {
          console.error('Failed to delete chat:', error);
          toast.error('Failed to delete conversation', { position: 'bottom-right', autoClose: 3000 });
          loadEntries();
        });
    },
    [loadEntries, deleteChat],
  );

  const handleDuplicate = async (id: string) => {
    await duplicateCurrentChat(id);
    loadEntries();
  };

  /*
   * Delete a project AND all of its chats. The chats are removed from
   * IndexedDB — they do not become personal chats.
   */
  const handleDeleteProject = useCallback(
    (project: Project) => {
      const projectChatIds = projectStore.getProjectChatIds(project.id);
      const currentChat = chatId.get();
      const currentChatBelongsToProject = currentChat && projectChatIds.includes(currentChat);

      projectStore.deleteProject(project.id);
      toast.success(`Project "${project.name}" deleted`, { autoClose: 2500 });

      /*
       * Clear the selected project + workbench state so the workspace
       * doesn't show stale files from the deleted project.
       */
      if (selectedProjectId.get() === project.id) {
        clearSelectedProject();
      }

      workbenchStore.showWorkbench.set(false);
      workbenchStore.loadedProjectId.set('<none>');
      workbenchStore.projectAutoStarted.set(false);

      /*
       * If we're currently viewing one of the project's chats, navigate
       * home — the chat was deleted along with the project.
       */
      if (currentChatBelongsToProject) {
        window.location.href = '/';
      }

      loadEntries();
    },
    [loadEntries, selectedProjectId],
  );

  // Rename a project.
  const handleRenameProject = useCallback((project: Project, newName: string) => {
    const trimmed = newName.trim();

    if (!trimmed) {
      toast.error('Project name cannot be empty');

      return;
    }

    projectStore.updateProject(project.id, { name: trimmed });
    toast.success('Project renamed', { autoClose: 2000 });
  }, []);

  const closeDialog = () => setDialogContent(null);

  // Click outside to close dropdown
  useEffect(() => {
    function handleClickOutside(event: MouseEvent) {
      if (dropdownRef.current && !dropdownRef.current.contains(event.target as Node)) {
        setIsNewChatDropdownOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  /*
   * Listen for project selections coming from the ProjectsGallery (which
   * renders in the sidebar inset, outside this component's React subtree).
   * The gallery dispatches `amplify:select-project-from-gallery` and we run
   * the full project-load flow here so all the workspace / IndexedDB /
   * navigation plumbing stays in one place.
   */
  useEffect(() => {
    function onGallerySelect(e: Event) {
      const detail = (e as CustomEvent<{ projectId: string }>).detail;

      if (!detail?.projectId) {
        return;
      }

      const project = projectStore.getProject(detail.projectId);

      if (project) {
        handleSelectProject(project);
      }
    }

    window.addEventListener('amplify:select-project-from-gallery', onGallerySelect);

    return () => window.removeEventListener('amplify:select-project-from-gallery', onGallerySelect);
  }, [handleSelectProject]);

  /**
   * "New Chat" guard — prevents creating / navigating to a new empty chat
   * when the user is ALREADY on a clean empty chat. Without this, repeatedly
   * clicking "New Chat" (or re-selecting a project) accumulates empty chats
   * in the sidebar.
   *
   * "Empty chat" = `chatStore.started` is false (no messages have been sent
   * in the current chat, or we're on the home `/` route with no chatId).
   */
  const handleNewChat = useCallback((e?: React.UIEvent) => {
    /*
     * If the projects gallery is showing in the inset, flip back to chat
     * first so the user sees their (empty) chat.
     */
    if (insetView.get() === 'projects') {
      showChatView();
    }

    if (!chatStore.get().started) {
      // Already on a clean empty chat — don't navigate / create a new one.
      e?.preventDefault();

      return;
    }

    /*
     * Starting a brand-new personal chat. We do NOT call preventDefault
     * here — the <a href="/"> anchor's default behavior performs a full
     * page reload to "/", which tears down the WebContainer + workspace
     * for a clean new chat. The store resets below are belt-and-suspenders
     * (the reload wipes everything anyway, but they prevent any flash of
     * stale UI in the brief moment before the reload fires).
     */
    clearSelectedProject();
    workbenchStore.resetForNewChat();
    chatStore.setKey('started', false);
    setIsNewChatDropdownOpen(false);
  }, []);

  // Chats to show in sidebar
  const binnedChats = binDates(categoryFilteredList);

  return (
    <>
      <div className="w-full h-full bg-sidebar flex flex-col px-[11px] pt-[6px] pb-[12px] font-geist">
        {/* Header - Brand */}
        <div data-slot="sidebar-header" data-sidebar="header" className="flex flex-col gap-2 mb-5">
          <ul data-slot="sidebar-menu" data-sidebar="menu" className="flex w-full min-w-0 flex-col gap-1">
            <li data-slot="sidebar-menu-item" data-sidebar="menu-item" className="group/menu-item relative">
              <a
                href="/"
                data-slot="sidebar-menu-button"
                data-sidebar="menu-button"
                data-size="lg"
                data-active="false"
                onClick={(e) => {
                  /*
                   * Brand click = go home (new personal chat). Use the guarded
                   * handler so we don't navigate away from an already-empty chat.
                   */
                  handleNewChat(e);
                }}
                className="peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 h-12 text-sm group-data-[collapsible=icon]:p-0! no-underline"
              >
                <div className="flex aspect-square size-10 items-center justify-center rounded-lg ">
                  <Amplify />
                </div>
                <div className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">Amplify</span>
                  <span className="truncate text-xs">AI agent platform</span>
                </div>
              </a>
            </li>
          </ul>
        </div>

        {/* New Chat Button */}
        <div className="relative w-full mb-[20px]" ref={dropdownRef}>
          <a
            href="/"
            onClick={(e) => {
              // Guarded: don't create a new empty chat if we're already on one.
              handleNewChat(e);
            }}
            className="w-full h-[33px] bg-sidebar-accent border border-sidebar-border rounded-[8px] flex items-center cursor-pointer shadow-sm overflow-hidden no-underline"
          >
            <div className="flex-1 flex items-center justify-center">
              <span className="font-semibold text-[13px] text-sidebar-foreground">New Chat</span>
            </div>
            <div
              className="w-[33px] h-[33px] border-l border-sidebar-border flex items-center justify-center shrink-0 rounded-r-[8px]"
              onClick={(e) => {
                e.stopPropagation();
                e.preventDefault();
                setIsNewChatDropdownOpen(!isNewChatDropdownOpen);
              }}
            >
              <ChevronDown size={14} className="text-sidebar-foreground" strokeWidth={2.5} />
            </div>
          </a>

          <AnimatePresence>
            {isNewChatDropdownOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.8, filter: 'blur(2px)', boxShadow: 'none' }}
                animate={{
                  opacity: 1,
                  scale: 1,
                  filter: 'blur(0px)',
                  boxShadow: '0px 4px 15px 5px rgba(0,0,0,0.1)',
                }}
                exit={{ opacity: 0, scale: 0.8, filter: 'blur(2px)', boxShadow: 'none' }}
                transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                className="absolute top-[calc(100%+4px)] left-0 font-geist w-[210px] bg-white dark:bg-sidebar border border-sidebar-border rounded-xl shadow-xl z-50 p-2 overflow-hidden ring-1 ring-black/5"
              >
                <a
                  href="/"
                  onClick={(e) => handleNewChat(e)}
                  className="w-full flex items-center gap-3 p-2 text-sm font-medium text-sidebar-foreground bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent no-underline"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="1.5em"
                    height="1.5em"
                    viewBox="0 0 16 16"
                    className="text-sidebar-foreground shrink-0"
                  >
                    <path d="M0 0h16v16H0z" fill="none" />
                    <path
                      fill="currentColor"
                      d="M7.5 4a.5.5 0 0 1 .5.5V7h2.5a.5.5 0 0 1 0 1H8v2.5a.5.5 0 0 1-1 0V8H4.5a.5.5 0 0 1 0-1H7V4.5a.5.5 0 0 1 .5-.5"
                    />
                    <path
                      fill="currentColor"
                      fillRule="evenodd"
                      d="M0 6.4c0-2.24 0-3.36.436-4.22A4.03 4.03 0 0 1 2.186.43c.856-.436 1.98-.436 4.22-.436h2.2c2.24 0 3.36 0 4.22.436c.753.383 1.36.995 1.75 1.75c.436.856.436 1.98.436 4.22v2.2c0 2.24 0 3.36-.436 4.22a4.03 4.03 0 0 1-1.75 1.75c-.856.436-1.98.436-4.22.436h-2.2c-2.24 0-3.36 0-4.22-.436a4.03 4.03 0 0 1-1.75-1.75C0 11.964 0 10.84 0 8.6zM6.4 1h2.2c1.14 0 1.93 0 2.55.051c.605.05.953.142 1.22.276a3.02 3.02 0 0 1 1.31 1.31c.134.263.226.611.276 1.22c.05.617.051 1.41.051 2.55v2.2c0 1.14 0 1.93-.051 2.55c-.05.605-.142.953-.276 1.22a3 3 0 0 1-1.31 1.31c-.263.134-.611.226-1.22.276c-.617.05-1.41.051-2.55.051H6.4c-1.14 0-1.93 0-2.55-.05c-.605-.05-.953-.143-1.22-.277a3 3 0 0 1-1.31-1.31c-.134-.263-.226-.61-.276-1.22c-.05-.617-.051-1.41-.051-2.55v-2.2c0-1.14 0-1.93.051-2.55c.05-.605.142-.953.276-1.22a3.02 3.02 0 0 1 1.31-1.31c.263-.134.611-.226 1.22-.276C4.467 1.001 5.26 1 6.4 1"
                      clipRule="evenodd"
                    />
                  </svg>
                  <span>Blank Chat</span>
                </a>
                <button
                  type="button"
                  onClick={() => {
                    setIsNewChatDropdownOpen(false);

                    /*
                     * Navigate to the /git route which renders the GitUrlImport
                     * flow (clone a repo by URL into a new chat). Previously
                     * this button had no onClick and did nothing. A full-page
                     * navigation is used here because the dropdown's
                     * AnimatePresence exit can race with Remix's client-side
                     * navigate() and swallow it.
                     */
                    window.location.assign('/git');
                  }}
                  className="w-full flex items-center gap-3 p-2 text-sm font-medium text-sidebar-foreground bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent"
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="1.5em"
                    height="1.5em"
                    viewBox="0 0 24 24"
                    className="text-sidebar-foreground shrink-0"
                  >
                    <path d="M0 0h24v24H0z" fill="none" />
                    <path
                      fill="currentColor"
                      d="M12 2A10 10 0 0 0 2 12c0 4.42 2.87 8.17 6.84 9.5c.5.08.66-.23.66-.5v-1.69c-2.77.6-3.36-1.34-3.36-1.34c-.46-1.16-1.11-1.47-1.11-1.47c-.91-.62.07-.6.07-.6c1 .07 1.53 1.03 1.53 1.03c.87 1.52 2.34 1.07 2.91.83c.09-.65.35-1.09.63-1.34c-2.22-.25-4.55-1.11-4.55-4.92c0-1.11.38-2 1.03-2.71c-.1-.25-.45-1.29.1-2.64c0 0 .84-.27 2.75 1.02c.79-.22 1.65-.33 2.5-.33s1.71.11 2.5.33c1.91-1.29 2.75-1.02 2.75-1.02c.55 1.35.2 2.39.1 2.64c.65.71 1.03 1.6 1.03 2.71c0 3.82-2.34 4.66-4.57 4.91c.36.31.69.92.69 1.85V21c0 .27.16.59.67.5C19.14 20.16 22 16.42 22 12A10 10 0 0 0 12 2"
                    />
                  </svg>
                  <span>Import from Github</span>
                </button>
                <button
                  className="w-full flex items-center gap-3 p-2 text-sm font-medium text-sidebar-foreground bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent"
                  onClick={() => {
                    setIsNewChatDropdownOpen(false);
                    setIsTemplatesModalOpen(true);
                  }}
                >
                  <svg
                    xmlns="http://www.w3.org/2000/svg"
                    width="1.5em"
                    height="1.5em"
                    viewBox="0 0 24 24"
                    className="text-sidebar-foreground shrink-0"
                  >
                    <path d="M0 0h24v24H0z" fill="none" />
                    <path
                      fill="currentColor"
                      d="M19 3a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2zM9 11a2 2 0 0 1 2 2v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-6a2 2 0 0 1 2-2zm11 0a1 1 0 0 1 0 2h-6a1 1 0 0 1 0-2zm0 4a1 1 0 0 1 0 2h-6a1 1 0 0 1 0-2zm0 4a1 1 0 0 1 0 2h-6a1 1 0 0 1 0-2z"
                    />
                  </svg>
                  <span>Start from Template</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Search Bar */}
        <div className="relative w-full mb-[8px]">
          <Search size={14} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder={selectedProject ? `Search chats in ${selectedProject.name}…` : 'Search chats...'}
            value={selectedProject ? projectChatsSearch : undefined}
            onChange={(e) => {
              if (selectedProject) {
                setProjectChatsSearch(e.target.value);
              } else {
                handleSearchChange(e);
              }
            }}
            className="w-full bg-sidebar border border-sidebar-border rounded-[8px] pl-9 pr-3 py-[7px] text-[13px] text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          />
        </div>

        {/* Navigation Links */}
        <div className="w-full flex flex-col gap-[2px]">
          {navItems.map(({ icon: Icon, label }) => {
            /*
             * Active-state logic for the three nav buttons:
             *
             *  • Projects — active while the projects gallery is showing in
             *    the sidebar inset (insetView === 'projects').
             *
             *  • Chats (normal) — active when we're in the chat view AND no
             *    project is selected. The sidebar shows personal/recent chats.
             *    Uses the standard `bg-sidebar-accent` highlight.
             *
             *  • Chats (project) — active when we're in the chat view AND a
             *    project IS selected. The sidebar shows the project's chats.
             *    Uses a purple-tinted highlight so the user can clearly tell
             *    they're looking at project-scoped chats, not their normal
             *    personal chats. (Previously this used the same highlight as
             *    normal chats, which was misleading.)
             *
             *  • Templates — never "active" (it opens a modal).
             */
            const isProjectsActive = label === 'Projects' && insetViewValue === 'projects';
            const isNormalChatsActive =
              label === 'Chats' && insetViewValue !== 'projects' && activeNav === 'Chats' && !selectedProject;
            const isProjectChatsActive =
              label === 'Chats' && insetViewValue !== 'projects' && activeNav === 'Chats' && !!selectedProject;

            return (
              <button
                key={label}
                onClick={() => {
                  if (label === 'Templates') {
                    setIsTemplatesModalOpen(true);
                  } else if (label === 'Projects') {
                    showProjectsGallery();
                  } else if (label === 'Chats') {
                    setActiveNav('Chats');
                    showChatView();
                  }
                }}
                className={classNames(
                  'bg-sidebar w-full h-[32px] flex items-center gap-[11px] rounded-[8px] px-[9px] transition-colors',
                  isProjectsActive && 'bg-sidebar-accent',
                  isNormalChatsActive && 'bg-sidebar-accent',
                  isProjectChatsActive && 'bg-purple-500/10 ring-1 ring-purple-500/30',
                )}
              >
                <Icon
                  size={18}
                  className={classNames(
                    'shrink-0',
                    isProjectsActive || isNormalChatsActive
                      ? 'text-sidebar-foreground'
                      : isProjectChatsActive
                        ? 'text-purple-500'
                        : 'text-muted-foreground',
                  )}
                />
                <span
                  className={classNames(
                    'text-[16px] font-almarai font-medium',
                    isProjectsActive || isNormalChatsActive
                      ? 'text-sidebar-foreground'
                      : isProjectChatsActive
                        ? 'text-purple-600 dark:text-purple-400'
                        : 'text-sidebar-foreground/80',
                  )}
                >
                  {label}
                </span>
              </button>
            );
          })}
        </div>

        {/* Recent Chats Section */}
        <div className="w-full mt-[8px] flex flex-col flex-1 min-h-0 overflow-hidden">
          <div className="flex items-center px-[9px] py-[4px] mb-[6px]">
            <button
              onClick={() => setIsRecentChatsExpanded(!isRecentChatsExpanded)}
              className="flex items-center gap-1 bg-sidebar rounded"
            >
              <span className="font-medium text-[13px] text-muted-foreground">
                {selectedProject ? `${selectedProject.name} · Chats` : 'Recent Chats'}
              </span>
              <ChevronDown
                size={14}
                className={classNames(
                  'text-muted-foreground transition-transform duration-200',
                  !isRecentChatsExpanded && '-rotate-90',
                )}
              />
            </button>
          </div>

          {isRecentChatsExpanded && (
            <div className="w-full flex-1 overflow-y-auto flex flex-col gap-[1px] custom-scrollbar">
              {/*
                Projects now live in the sidebar-inset gallery (click "Projects"
                nav to open it). The sidebar's chat-history area only ever shows
                chats — either the selected project's chats, or personal chats.
              */}
              {selectedProject ? (
                /*
                 * A project is selected → show the project's chats. Switching
                 * between these chats does NOT reload the workspace (handled in
                 * useChatHistory via the loadedProjectId check).
                 */
                <SelectedProjectChatsList
                  project={selectedProject}
                  chats={filteredProjectChats}
                  loadingChats={loadingSelectedProjectChats}
                  currentUrlId={urlId}
                  isAutoStarted={projectAutoStarted}
                  onNewChat={() => handleNewChatInProject(selectedProject)}
                  onBackToAllChats={() => {
                    /*
                     * Full page reload to root — clears the project
                     * selection so the user lands on a clean base chat
                     * with no project context. A full reload ensures the
                     * workspace is torn down and rebuilt cleanly.
                     */
                    clearSelectedProject();
                    window.location.href = '/';
                  }}
                  onDelete={(item) => setDialogContent({ type: 'delete', item })}
                  onDuplicate={handleDuplicate}
                  exportChat={exportChat}
                />
              ) : (
                /*
                 * No project selected → personal chats (binned by date).
                 */
                <>
                  {categoryFilteredList.length === 0 && (
                    <div className="px-[9px] py-[7px] text-[13px] text-muted-foreground">
                      {list.length === 0 ? 'No previous conversations' : 'No chats found'}
                    </div>
                  )}

                  {binnedChats.map(({ category, items }) => (
                    <div key={category} className="first:mt-0">
                      <div className="text-[10px] font-medium text-muted-foreground sticky top-0 z-1 bg-sidebar px-[9px] py-[3px]">
                        {category}
                      </div>
                      {items.map((item) => (
                        <SidebarHistoryItem
                          key={item.id}
                          item={item}
                          isActive={urlId === item.urlId}
                          exportChat={exportChat}
                          onDelete={(event) => {
                            event.preventDefault();
                            event.stopPropagation();
                            setDialogContent({ type: 'delete', item });
                          }}
                          onDuplicate={() => handleDuplicate(item.id)}
                        />
                      ))}
                    </div>
                  ))}

                  {/* More button */}
                  {categoryFilteredList.length > 5 && !showAllChats && (
                    <button
                      onClick={() => setShowAllChats(true)}
                      className="w-full flex items-center gap-[10px] px-[9px] py-[7px] rounded cursor-pointer text-muted-foreground hover:text-sidebar-foreground bg-sidebar hover:bg-sidebar-accent/50"
                    >
                      <MoreHorizontal size={15} className="shrink-0" />
                      <span className="text-[13px]">More</span>
                    </button>
                  )}
                </>
              )}
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="w-full mt-auto pt-2 border-t border-sidebar-border shrink-0 flex items-center justify-between px-2 gap-2">
          <ThemeToggle
            key={theme}
            defaultTheme={theme}
            onChange={(newTheme: string) => setTheme(newTheme as 'light' | 'dark')}
          />
          <button
            type="button"
            onClick={() => setIsSettingsOpen(true)}
            aria-label="Open settings"
            title="Settings"
            className="flex items-center justify-center w-[40px] h-[40px] rounded-lg text-muted-foreground hover:text-sidebar-foreground hover:bg-sidebar-accent transition-colors cursor-pointer"
          >
            <Settings size={18} className="shrink-0" />
          </button>
        </div>
      </div>

      {/*
        Delete-chat confirmation dialog.

        Rendered at the TOP LEVEL of the sidebar fragment (outside the
        selectedProject conditional and outside the isRecentChatsExpanded
        block) so it always renders regardless of which chat-list view is
        showing. Both the personal-chats SidebarHistoryItem and the
        project-chats SelectedProjectChatsList set `dialogContent` via their
        onDelete props — the dialog itself must live here to actually appear.
      */}
      <DialogRoot open={dialogContent !== null}>
        <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
          {dialogContent?.type === 'delete' && (
            <>
              <div className="p-6 bg-white dark:bg-gray-950">
                <DialogTitle className="text-gray-900 dark:text-white">Delete Chat?</DialogTitle>
                <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                  <p>
                    You are about to delete{' '}
                    <span className="font-medium text-gray-900 dark:text-white">{dialogContent.item.description}</span>
                  </p>
                  <p className="mt-2">Are you sure you want to delete this chat?</p>
                </DialogDescription>
              </div>
              <div className="flex justify-end gap-3 px-6 py-4 bg-gray-50 dark:bg-gray-900 border-t border-gray-100 dark:border-gray-800">
                <DialogButton type="secondary" onClick={closeDialog}>
                  Cancel
                </DialogButton>
                <DialogButton
                  type="danger"
                  onClick={(event) => {
                    deleteItem(event, dialogContent.item);
                    closeDialog();
                  }}
                >
                  Delete
                </DialogButton>
              </div>
            </>
          )}
        </Dialog>
      </DialogRoot>

      <TemplatesModal isOpen={isTemplatesModalOpen} onClose={() => setIsTemplatesModalOpen(false)} />

      {/*
        Full Settings / ControlPanel. The only entry point used to live inside
        the old Menu overlay (now unreachable in the new layout). Triggered by
        the footer Settings button above so every user can reach providers, API
        keys, cloud connections, data export/import, MCP, memory, etc.
      */}
      <ControlPanel open={isSettingsOpen} onClose={() => setIsSettingsOpen(false)} />

      {/* Project rename / delete dialogs */}
      <ProjectManagementDialogs
        state={projectDialog}
        onClose={() => setProjectDialog(null)}
        onConfirmRename={(project, newName) => {
          handleRenameProject(project, newName);
          setProjectDialog(null);
        }}
        onConfirmDelete={(project) => {
          handleDeleteProject(project);
          setProjectDialog(null);
        }}
      />
    </>
  );
}

/* ================================================================== */
/*  Selected Project Chats List — shown on the Chats nav               */
/*  when a project is selected. Same chat list, different framing.     */
/* ================================================================== */

interface SelectedProjectChatsListProps {
  project: Project;
  chats: ChatHistoryItem[];
  loadingChats: boolean;
  currentUrlId?: string;
  isAutoStarted?: boolean;
  onNewChat: () => void;
  onBackToAllChats: () => void;
  onDelete: (item: ChatHistoryItem) => void;
  onDuplicate: (id: string) => void;
  exportChat: (id?: string) => void;
}

function SelectedProjectChatsList({
  project,
  chats,
  loadingChats,
  currentUrlId,
  isAutoStarted = false,
  onNewChat,
  onBackToAllChats,
  onDelete,
  onDuplicate,
  exportChat,
}: SelectedProjectChatsListProps) {
  return (
    <>
      {/* Back button + project header */}
      <button
        type="button"
        onClick={onBackToAllChats}
        className="w-full flex items-center gap-2 px-[9px] py-[7px] mb-[4px] rounded-md text-[12px] text-muted-foreground bg-sidebar hover:text-sidebar-foreground hover:bg-sidebar-accent/50 transition-colors"
        title="Back to all chats"
      >
        <ArrowLeft size={13} className="shrink-0" />
        <span>All chats</span>
      </button>

      <div className="rounded-lg border border-purple-500/30 bg-gradient-to-br from-purple-500/[0.04] to-fuchsia-500/[0.02] overflow-hidden overflow-x-hidden mb-[6px]">
        <div className="flex items-center gap-2 px-[10px] py-[8px]">
          <div
            className="shrink-0 w-6 h-6 rounded-md flex items-center justify-center text-[12px] ring-1 ring-purple-500/20"
            style={{ background: 'linear-gradient(135deg, rgba(168, 85, 247, 0.15), rgba(217, 70, 239, 0.08))' }}
          >
            <span className="text-purple-500">{project.icon || <Folder size={13} />}</span>
          </div>
          <div className="flex-1 min-w-0">
            <div className="text-[13px] font-medium text-sidebar-foreground truncate">{project.name}</div>
            <div className="flex items-center gap-1.5 text-[10px] text-muted-foreground mt-0.5 min-w-0">
              <span className="shrink-0">
                {project.chatIds.length} chat{project.chatIds.length === 1 ? '' : 's'}
              </span>
              <span className="shrink-0">·</span>
              <span className="shrink-0">{formatRelativeShort(project.updatedAt)}</span>
              {project.startCommand && (
                <>
                  <span className="shrink-0">·</span>
                  <span className="text-purple-500/80 font-mono truncate min-w-0">{project.startCommand}</span>
                </>
              )}
              {isAutoStarted && (
                <>
                  <span className="shrink-0">·</span>
                  <span
                    className="shrink-0 inline-flex items-center gap-0.5 text-emerald-500/90 font-medium"
                    title="Start command is running"
                  >
                    <span className="relative flex h-1.5 w-1.5">
                      <span className="absolute inline-flex h-full w-full rounded-full bg-emerald-500 opacity-75 animate-ping" />
                      <span className="relative inline-flex h-1.5 w-1.5 rounded-full bg-emerald-500" />
                    </span>
                    running
                  </span>
                </>
              )}
            </div>
          </div>
        </div>
      </div>

      {/* New chat in project */}
      <button
        type="button"
        onClick={onNewChat}
        className="w-full flex items-center gap-2 px-[10px] py-[7px] mb-[4px] rounded-md text-[12px] font-medium text-purple-600 dark:text-purple-400 hover:bg-purple-500/10 transition-colors border border-purple-500/20 bg-purple-500/5"
        aria-label="New chat in this project"
        title="Start a new chat in this project"
      >
        <Plus size={13} className="shrink-0" />
        <span>New chat in project</span>
      </button>

      {/* Chat list — scrolls with the outer sidebar container */}
      {loadingChats ? (
        <div className="px-[10px] py-[7px] text-[12px] text-muted-foreground">Loading chats…</div>
      ) : chats.length === 0 ? (
        // Better empty state — icon + descriptive copy + CTA
        <div className="px-[8px] py-[16px] flex flex-col items-center justify-center gap-2 text-center">
          <div className="relative">
            <div className="absolute inset-0 bg-gradient-to-br from-purple-500/20 to-fuchsia-500/10 blur-md rounded-full" />
            <div className="relative w-10 h-10 rounded-lg bg-purple-500/10 ring-1 ring-purple-500/20 flex items-center justify-center">
              <MessageSquarePlus size={18} className="text-purple-500" />
            </div>
          </div>
          <div className="space-y-0.5">
            <p className="text-[12px] font-medium text-sidebar-foreground">No chats in this project yet</p>
            <p className="text-[10px] text-muted-foreground/80 leading-snug max-w-[210px]">
              Each chat is a separate reasoning thread that shares the project's files, memory, and version history.
            </p>
          </div>
          <button
            type="button"
            onClick={onNewChat}
            className="mt-1 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-[11px] font-medium text-purple-600 dark:text-purple-400 bg-purple-500/10 hover:bg-purple-500/15 border border-purple-500/20 transition-colors"
            title="Start your first chat in this project"
          >
            <Plus size={11} className="shrink-0" />
            <span>Start your first chat</span>
          </button>
        </div>
      ) : (
        chats.map((item) => (
          <SidebarHistoryItem
            key={item.id}
            item={item}
            isActive={currentUrlId === item.urlId}
            exportChat={exportChat}
            onDelete={(event) => {
              event.preventDefault();
              event.stopPropagation();
              onDelete(item);
            }}
            onDuplicate={() => onDuplicate(item.id)}
          />
        ))
      )}
    </>
  );
}

function formatRelativeShort(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) {
      return 'just now';
    }

    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }

    if (diffHr < 24) {
      return `${diffHr}h ago`;
    }

    if (diffDay < 7) {
      return `${diffDay}d ago`;
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}

/* ================================================================== */
/*  Project Management Dialogs (rename + delete)                       */
/* ================================================================== */

interface ProjectManagementDialogsProps {
  state: { type: 'delete'; project: Project } | { type: 'rename'; project: Project } | null;
  onClose: () => void;
  onConfirmRename: (project: Project, newName: string) => void;
  onConfirmDelete: (project: Project) => void;
}

function ProjectManagementDialogs({ state, onClose, onConfirmRename, onConfirmDelete }: ProjectManagementDialogsProps) {
  const [renameValue, setRenameValue] = useState('');

  // Seed the rename input whenever a rename dialog opens.
  useEffect(() => {
    if (state?.type === 'rename') {
      setRenameValue(state.project.name);
    }
  }, [state]);

  if (!state) {
    return null;
  }

  const { project } = state;

  return (
    <DialogRoot open={state !== null}>
      <Dialog onClose={onClose} onBackdrop={onClose} className="w-[420px] max-w-[92vw]">
        <div className="p-6 bg-white dark:bg-gray-950">
          {state.type === 'rename' ? (
            <>
              <DialogTitle className="text-gray-900 dark:text-white">Rename project</DialogTitle>
              <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                Choose a new name for this project. This doesn't affect any chats or files.
              </DialogDescription>
              <input
                type="text"
                value={renameValue}
                onChange={(e) => setRenameValue(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    onConfirmRename(project, renameValue);
                  }
                }}
                autoFocus
                className="mt-4 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-purple-500/50"
                placeholder="Project name"
              />
              <div className="flex justify-end gap-3 mt-6">
                <DialogButton type="secondary" onClick={onClose}>
                  Cancel
                </DialogButton>
                <DialogButton type="primary" onClick={() => onConfirmRename(project, renameValue)}>
                  Save
                </DialogButton>
              </div>
            </>
          ) : (
            <>
              <DialogTitle className="text-gray-900 dark:text-white">Delete project?</DialogTitle>
              <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                <span className="font-medium text-gray-900 dark:text-white">{project.name}</span> will be permanently
                deleted. Its {project.chatIds.length} chat{project.chatIds.length === 1 ? '' : 's'} will be kept as
                personal chats, but all project files, version history, and memory will be removed.
              </DialogDescription>
              <div className="flex justify-end gap-3 mt-6">
                <DialogButton type="secondary" onClick={onClose}>
                  Cancel
                </DialogButton>
                <DialogButton
                  type="primary"
                  onClick={() => onConfirmDelete(project)}
                  className="bg-red-500 hover:bg-red-600"
                >
                  Delete project
                </DialogButton>
              </div>
            </>
          )}
        </div>
      </Dialog>
    </DialogRoot>
  );
}

/* ================================================================== */
/*  Sidebar History Item                                               */
/* ================================================================== */

interface SidebarHistoryItemProps {
  item: ChatHistoryItem;
  isActive: boolean;
  onDelete?: (event: React.UIEvent) => void;
  onDuplicate?: (id: string) => void;
  exportChat: (id?: string) => void;
}

function SidebarHistoryItem({ item, isActive, onDelete, onDuplicate, exportChat }: SidebarHistoryItemProps) {
  const navigate = useNavigate();

  /*
   * Compute the correct navigation URL based on whether this chat belongs
   * to a project. Project chats use `/{projectId}/{chatId}`; personal chats
   * use `/chat/{chatId}`. Previously this was hardcoded to `/chat/${urlId}`
   * which broke project chats — the workspace + project files weren't loaded
   * because the route loader didn't receive the projectId param.
   */
  const href = item.metadata?.projectId ? `/${item.metadata.projectId}/${item.urlId}` : `/chat/${item.urlId}`;

  /*
   * SMART NAVIGATION: Use SPA navigation (no page reload) when switching
   * between chats in the SAME project. The workspace (WebContainer, files,
   * dev server) is already correct — a full reload would needlessly destroy
   * it, causing:
   *   - The workspace to "reset" (dev server killed + restarted)
   *   - A visible sidebar flash (state re-hydration after reload)
   *   - npm install to re-run unnecessarily
   *
   * For cross-project switches or personal chats, use a full page reload
   * so the workspace is cleanly torn down and rebuilt from IndexedDB.
   *
   * The project-change guard in useChatHistory's load effect
   * (workbenchStore.loadedProjectId check) ensures clearWorkspace() is
   * skipped on same-project SPA navigation.
   */
  const handleNavigate = useCallback(() => {
    const currentLoadedProjectId = workbenchStore.loadedProjectId.get();
    const targetProjectId = item.metadata?.projectId;
    const sameProject =
      targetProjectId && currentLoadedProjectId === targetProjectId && currentLoadedProjectId !== '<none>';

    if (sameProject) {
      // SPA navigation — workspace stays intact, no flash, no reset
      navigate(href);
    } else {
      // Cross-project or personal — full reload for clean workspace rebuild
      window.location.href = href;
    }
  }, [href, item.metadata?.projectId, navigate]);

  const [isMenuOpen, setIsMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  const { editing, handleChange, handleBlur, handleSubmit, handleKeyDown, currentDescription, toggleEditMode } =
    useEditChatDescription({
      initialDescription: item.description || '',
      customChatId: item.id,
      syncWithGlobalStore: isActive,
    });

  // Close menu on outside click
  useEffect(() => {
    if (!isMenuOpen) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setIsMenuOpen(false);
      }
    }
    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isMenuOpen]);

  return (
    <div
      className={classNames(
        'group relative w-full flex items-center gap-[10px] px-[9px] py-[7px] rounded cursor-pointer transition-colors',
        isActive ? 'bg-sidebar-accent' : 'hover:bg-sidebar-accent/50',
      )}
    >
      <CircleDashed
        size={15}
        className={classNames(
          'text-muted-foreground shrink-0',

          /*
           * When NOT editing, clicks on the icon should fall through to the
           * stretched link below — so disable pointer events on the icon.
           */
          !editing && 'pointer-events-none relative z-0',
        )}
      />

      {editing ? (
        <form onSubmit={handleSubmit} className="flex-1 flex items-center gap-1 min-w-0">
          <input
            type="text"
            className="flex-1 min-w-0 bg-sidebar border border-sidebar-border rounded px-2 py-0.5 text-[13px] text-sidebar-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50"
            autoFocus
            value={currentDescription}
            onChange={handleChange}
            onBlur={handleBlur}
            onKeyDown={handleKeyDown}
          />
          <button
            type="submit"
            className="p-1 rounded bg-sidebar-accent text-muted-foreground hover:text-purple-500 hover:bg-sidebar-accent transition-colors shrink-0"
          >
            <Check size={12} />
          </button>
        </form>
      ) : (
        <>
          {/*
            Stretched click target — absolutely positioned to cover the
            ENTIRE row (icon + text + padding) so a SINGLE click anywhere
            navigates. Previously the <a> only wrapped the text, so clicks
            on the icon or the row padding missed the link and did nothing
            — which felt like the user had to "double-click" to switch chats.
            The more-button container below is z-10 so it stays ABOVE this
            stretched target and remains independently clickable.

            Uses handleNavigate() instead of a plain <a href> so that
            same-project chat switches use SPA navigation (no page reload,
            no workspace reset, no sidebar flash). Cross-project switches
            still trigger a full page reload for a clean workspace rebuild.
          */}
          <div
            onClick={handleNavigate}
            aria-label={currentDescription}
            role="link"
            tabIndex={0}
            onKeyDown={(e) => {
              if (e.key === 'Enter' || e.key === ' ') {
                e.preventDefault();
                handleNavigate();
              }
            }}
            className="absolute inset-0 z-0 rounded cursor-pointer"
          />

          <span className="flex-1 min-w-0 text-[13px] text-sidebar-foreground/90 truncate pointer-events-none relative z-0">
            {currentDescription}
          </span>

          {/* More button - visible on hover. z-10 keeps it above the stretched link. */}
          <div className="relative z-10 shrink-0" ref={menuRef}>
            <button
              onClick={(e) => {
                e.preventDefault();
                e.stopPropagation();
                setIsMenuOpen(!isMenuOpen);
              }}
              className={classNames(
                'p-1 rounded transition-colors',
                isMenuOpen
                  ? 'bg-sidebar-accent text-sidebar-foreground'
                  : 'bg-transparent hover:bg-sidebar-accent text-muted-foreground',
              )}
            >
              <MoreHorizontal size={14} />
            </button>

            <AnimatePresence>
              {isMenuOpen && (
                <motion.div
                  initial={{ opacity: 0, scale: 0.8, filter: 'blur(2px)', boxShadow: 'none' }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    filter: 'blur(0px)',
                    boxShadow: '0px 4px 15px 5px rgba(0,0,0,0.1)',
                  }}
                  exit={{ opacity: 0, scale: 0.8, filter: 'blur(2px)', boxShadow: 'none' }}
                  transition={{ type: 'spring', bounce: 0.2, duration: 0.4 }}
                  className="absolute top-full right-0 mt-1 w-[170px] bg-white dark:bg-sidebar border border-sidebar-border rounded-xl z-50 p-2 overflow-hidden ring-1 ring-black/5"
                >
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsMenuOpen(false);
                      exportChat(item.id);
                    }}
                    className="w-full flex items-center gap-3 p-2 text-sm font-medium text-sidebar-foreground bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent"
                  >
                    <Download size={15} className="text-sidebar-foreground shrink-0" />
                    <span>Export</span>
                  </button>
                  {onDuplicate && (
                    <button
                      onClick={(e) => {
                        e.preventDefault();
                        e.stopPropagation();
                        setIsMenuOpen(false);
                        onDuplicate(item.id);
                      }}
                      className="w-full flex items-center gap-3 p-2 text-sm font-medium text-sidebar-foreground bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent"
                    >
                      <Copy size={15} className="text-sidebar-foreground shrink-0" />
                      <span>Duplicate</span>
                    </button>
                  )}
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsMenuOpen(false);
                      toggleEditMode();
                    }}
                    className="w-full flex items-center gap-3 p-2 text-sm font-medium text-sidebar-foreground bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent"
                  >
                    <Pencil size={15} className="text-sidebar-foreground shrink-0" />
                    <span>Rename</span>
                  </button>
                  <button
                    onClick={(e) => {
                      e.preventDefault();
                      e.stopPropagation();
                      setIsMenuOpen(false);
                      onDelete?.(e as unknown as React.UIEvent);
                    }}
                    className="w-full flex items-center gap-3 p-2 text-sm font-medium text-red-500 bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent"
                  >
                    <Trash2 size={15} className="shrink-0" />
                    <span>Delete</span>
                  </button>
                </motion.div>
              )}
            </AnimatePresence>
          </div>
        </>
      )}
    </div>
  );
}
