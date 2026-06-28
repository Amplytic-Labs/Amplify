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
} from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { toast } from 'react-toastify';
import { useParams } from '@remix-run/react';
import { useStore } from '@nanostores/react';
import { TemplatesModal } from './TemplatesModal';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';
import { db, deleteById, getAll, chatId, type ChatHistoryItem, useChatHistory } from '~/lib/persistence';
import { projectStore } from '~/lib/persistence/project-store';
import { useSearchFilter } from '~/lib/hooks/useSearchFilter';
import { useEditChatDescription } from '~/lib/hooks';
import { binDates } from './date-binning';
import { classNames } from '~/utils/classNames';
import { themeStore, setTheme } from '~/lib/stores/theme';
import ThemeToggle from './ThemeToggle';
import Amplify from './amplify';

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

export function ProjectSidebar({ user }: ProjectSidebarProps) {
  const { duplicateCurrentChat, exportChat } = useChatHistory();
  const { id: urlId } = useParams();

  const [isNewChatDropdownOpen, setIsNewChatDropdownOpen] = useState(false);
  const dropdownRef = useRef<HTMLDivElement>(null);

  const [isTemplatesModalOpen, setIsTemplatesModalOpen] = useState(false);

  const theme = useStore(themeStore);

  const [activeNav, setActiveNav] = useState('Chats');

  const [isRecentChatsExpanded, setIsRecentChatsExpanded] = useState(true);
  const [showAllChats, setShowAllChats] = useState(false);

  // Real chat history state
  const [list, setList] = useState<ChatHistoryItem[]>([]);
  const [dialogContent, setDialogContent] = useState<DialogContent>(null);

  const { filteredItems: filteredList, handleSearchChange } = useSearchFilter({
    items: list,
    searchFields: ['description'],
  });

  // Filter by active nav category
  const categoryFilteredList = useMemo(() => {
    if (activeNav === 'Projects') {
      return filteredList.filter((item) => projectStore.getChatCategory(item.id) === 'project');
    }
    // Default to chats (includes 'Chats' active or any other state)
    return filteredList.filter((item) => projectStore.getChatCategory(item.id) === 'chat');
  }, [filteredList, activeNav]);

  const loadEntries = useCallback(() => {
    if (db) {
      getAll(db)
        .then((list) => list.filter((item) => item.urlId && item.description))
        .then(setList)
        .catch((error) => toast.error(error.message));
    }
  }, []);

  useEffect(() => {
    loadEntries();
  }, [loadEntries]);

  // Delete single chat
  const deleteChat = useCallback(async (id: string): Promise<void> => {
    if (!db) throw new Error('Database not available');
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
          loadEntries();
          if (chatId.get() === item.id) {
            window.location.pathname = '/';
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
                className="peer/menu-button flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left ring-sidebar-ring outline-hidden transition-[width,height,padding] group-has-data-[sidebar=menu-action]/menu-item:pr-8 group-data-[collapsible=icon]:size-8! focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground data-[state=open]:hover:bg-sidebar-accent data-[state=open]:hover:text-sidebar-accent-foreground [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0 h-12 text-sm group-data-[collapsible=icon]:p-0!"
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
                <button className="w-full flex items-center gap-3 p-2 text-sm font-medium text-sidebar-foreground bg-white dark:bg-sidebar rounded-md hover:bg-sidebar-accent">
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
            placeholder="Search chats..."
            onChange={handleSearchChange}
            className="w-full bg-sidebar border border-sidebar-border rounded-[8px] pl-9 pr-3 py-[7px] text-[13px] text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-purple-500/50"
          />
        </div>

        {/* Navigation Links */}
        <div className="w-full flex flex-col gap-[2px]">
          {navItems.map(({ icon: Icon, label }) => {
            const isActive = activeNav === label;
            return (
              <button
                key={label}
                onClick={() => {
                  if (label === 'Templates') {
                    setIsTemplatesModalOpen(true);
                  } else {
                    setActiveNav(label);
                  }
                }}
                className={classNames(
                  'bg-sidebar w-full h-[32px] flex items-center gap-[11px] rounded-[8px] px-[9px]',
                  isActive && 'bg-sidebar-accent',
                )}
              >
                <Icon
                  size={18}
                  className={isActive ? 'text-sidebar-foreground shrink-0' : 'text-muted-foreground shrink-0'}
                />
                <span
                  className={classNames(
                    'text-[16px] font-almarai font-medium',
                    isActive ? 'text-sidebar-foreground' : 'text-sidebar-foreground/80',
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
                {activeNav === 'Projects' ? 'Recent Projects' : 'Recent Chats'}
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
              {categoryFilteredList.length === 0 && (
                <div className="px-[9px] py-[7px] text-[13px] text-muted-foreground">
                  {list.length === 0
                    ? 'No previous conversations'
                    : activeNav === 'Projects'
                      ? 'No project chats found'
                      : 'No chats found'}
                </div>
              )}

              <DialogRoot open={dialogContent !== null}>
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

                {/* Delete Dialog */}
                <Dialog onBackdrop={closeDialog} onClose={closeDialog}>
                  {dialogContent?.type === 'delete' && (
                    <>
                      <div className="p-6 bg-white dark:bg-gray-950">
                        <DialogTitle className="text-gray-900 dark:text-white">Delete Chat?</DialogTitle>
                        <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                          <p>
                            You are about to delete{' '}
                            <span className="font-medium text-gray-900 dark:text-white">
                              {dialogContent.item.description}
                            </span>
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
            </div>
          )}
        </div>

        {/* Footer */}
        <div className="w-full mt-auto pt-2 border-t border-sidebar-border shrink-0 flex items-center justify-between px-2 gap-2">
          <ThemeToggle
            key={theme}
            defaultTheme={theme}
            onChange={(newTheme) => setTheme(newTheme as 'light' | 'dark')}
          />
        </div>
      </div>

      <TemplatesModal isOpen={isTemplatesModalOpen} onClose={() => setIsTemplatesModalOpen(false)} />
    </>
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
    if (!isMenuOpen) return;
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
      <CircleDashed size={15} className="text-muted-foreground shrink-0" />

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
          <a
            href={`/chat/${item.urlId}`}
            className="flex-1 min-w-0 text-[13px] text-sidebar-foreground/90 truncate no-underline"
          >
            {currentDescription}
          </a>

          {/* More button - visible on hover */}
          <div className="relative shrink-0" ref={menuRef}>
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
