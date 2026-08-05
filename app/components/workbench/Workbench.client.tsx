import { useStore } from '@nanostores/react';
import { motion, type HTMLMotionProps, type Variants } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useCallback, useEffect, useState, useMemo } from 'react';
import { toast } from '~/components/ui/toast';
import { Popover, Transition } from '@headlessui/react';
import { diffLines, type Change } from 'diff';
import { getLanguageFromExtension } from '~/utils/getLanguageFromExtension';
import type { FileHistory } from '~/types/actions';
import { DiffView } from './DiffView';
import {
  type OnChangeCallback as OnEditorChange,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { IconButton } from '~/components/ui/IconButton';
import { workbenchStore, type WorkbenchViewType } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { renderLogger } from '~/utils/logger';
import { EditorPanel } from './EditorPanel';
import { Preview } from './Preview';
import { RenderPanel } from './RenderPanel';
import { DocxPreviewPanel } from './DocxPreviewPanel';
import { findRenderableFiles } from '~/lib/renderable/registry';
import useViewport from '~/lib/hooks';

import { usePreviewStore } from '~/lib/stores/previews';
import { chatStore } from '~/lib/stores/chat';
import { docxArtifactStore } from '~/lib/stores/docx-artifact';
import type { ElementInfo } from './Inspector';
import { streamingState } from '~/lib/stores/streaming';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

interface WorkspaceProps {
  chatStarted?: boolean;
  isStreaming?: boolean;
  metadata?: {
    gitUrl?: string;
  };
  updateChatMestaData?: (metadata: any) => void;
  setSelectedElement?: (element: ElementInfo | null) => void;
}

const viewTransition = { ease: cubicEasingFn };

const workbenchVariants = {
  closed: {
    width: 0,
    transition: {
      duration: 0.4,
      ease: cubicEasingFn,
    },
  },
  open: {
    width: 'var(--workbench-width)',
    transition: {
      duration: 0.5,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

const mobileWorkbenchVariants = {
  closed: {
    x: '100%',
    transition: {
      duration: 0.4,
      ease: cubicEasingFn,
    },
  },
  open: {
    x: 0,
    transition: {
      duration: 0.5,
      ease: cubicEasingFn,
    },
  },
} satisfies Variants;

const FileModifiedDropdown = memo(
  ({
    fileHistory,
    onSelectFile,
  }: {
    fileHistory: Record<string, FileHistory>;
    onSelectFile: (filePath: string) => void;
  }) => {
    const modifiedFiles = Object.entries(fileHistory);
    const hasChanges = modifiedFiles.length > 0;
    const [searchQuery, setSearchQuery] = useState('');

    const filteredFiles = useMemo(() => {
      return modifiedFiles.filter(([filePath]) => filePath.toLowerCase().includes(searchQuery.toLowerCase()));
    }, [modifiedFiles, searchQuery]);

    return (
      <div className="flex items-center gap-2">
        <Popover className="relative">
          {({ open }: { open: boolean }) => (
            <>
              <Popover.Button className="flex items-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-amplify-elements-background-depth-2 hover:bg-amplify-elements-background-depth-3 transition-colors text-amplify-elements-item-contentDefault">
                <span>File Changes</span>
                {hasChanges && (
                  <span className="w-5 h-5 rounded-full bg-accent-500/20 text-accent-500 text-xs flex items-center justify-center border border-accent-500/30">
                    {modifiedFiles.length}
                  </span>
                )}
              </Popover.Button>
              <Transition
                show={open}
                enter="transition duration-100 ease-out"
                enterFrom="transform scale-95 opacity-0"
                enterTo="transform scale-100 opacity-100"
                leave="transition duration-75 ease-out"
                leaveFrom="transform scale-100 opacity-100"
                leaveTo="transform scale-95 opacity-0"
              >
                <Popover.Panel className="absolute right-0 z-20 mt-2 w-80 origin-top-right rounded-xl bg-amplify-elements-background-depth-2 shadow-xl border border-amplify-elements-borderColor">
                  <div className="p-2">
                    <div className="relative mx-2 mb-2">
                      <input
                        type="text"
                        placeholder="Search files..."
                        value={searchQuery}
                        onChange={(e) => setSearchQuery(e.target.value)}
                        className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                      />
                      <div className="absolute left-2 top-1/2 -translate-y-1/2 text-amplify-elements-textTertiary">
                        <div className="i-ph:magnifying-glass" />
                      </div>
                    </div>

                    <div className="max-h-60 overflow-y-auto">
                      {filteredFiles.length > 0 ? (
                        filteredFiles.map(([filePath, history]) => {
                          const extension = filePath.split('.').pop() || '';
                          const language = getLanguageFromExtension(extension);

                          return (
                            <button
                              key={filePath}
                              onClick={() => onSelectFile(filePath)}
                              className="w-full px-3 py-2 text-left rounded-md hover:bg-amplify-elements-background-depth-1 transition-colors group bg-transparent"
                            >
                              <div className="flex items-center gap-2">
                                <div className="shrink-0 w-5 h-5 text-amplify-elements-textTertiary">
                                  {['typescript', 'javascript', 'jsx', 'tsx'].includes(language) && (
                                    <div className="i-ph:file-js" />
                                  )}
                                  {['css', 'scss', 'less'].includes(language) && <div className="i-ph:paint-brush" />}
                                  {language === 'html' && <div className="i-ph:code" />}
                                  {language === 'json' && <div className="i-ph:brackets-curly" />}
                                  {language === 'python' && <div className="i-ph:file-text" />}
                                  {language === 'markdown' && <div className="i-ph:article" />}
                                  {['yaml', 'yml'].includes(language) && <div className="i-ph:file-text" />}
                                  {language === 'sql' && <div className="i-ph:database" />}
                                  {language === 'dockerfile' && <div className="i-ph:cube" />}
                                  {language === 'shell' && <div className="i-ph:terminal" />}
                                  {![
                                    'typescript',
                                    'javascript',
                                    'css',
                                    'html',
                                    'json',
                                    'python',
                                    'markdown',
                                    'yaml',
                                    'yml',
                                    'sql',
                                    'dockerfile',
                                    'shell',
                                    'jsx',
                                    'tsx',
                                    'scss',
                                    'less',
                                  ].includes(language) && <div className="i-ph:file-text" />}
                                </div>
                                <div className="flex-1 min-w-0">
                                  <div className="flex items-center justify-between gap-2">
                                    <div className="flex flex-col min-w-0">
                                      <span className="truncate text-sm font-medium text-amplify-elements-textPrimary">
                                        {filePath.split('/').pop()}
                                      </span>
                                      <span className="truncate text-xs text-amplify-elements-textTertiary">
                                        {filePath}
                                      </span>
                                    </div>
                                    {(() => {
                                      // Calculate diff stats
                                      const { additions, deletions } = (() => {
                                        if (!history.originalContent) {
                                          return { additions: 0, deletions: 0 };
                                        }

                                        const normalizedOriginal = history.originalContent.replace(/\r\n/g, '\n');
                                        const normalizedCurrent =
                                          history.versions[history.versions.length - 1]?.content.replace(
                                            /\r\n/g,
                                            '\n',
                                          ) || '';

                                        if (normalizedOriginal === normalizedCurrent) {
                                          return { additions: 0, deletions: 0 };
                                        }

                                        const changes = diffLines(normalizedOriginal, normalizedCurrent, {
                                          newlineIsToken: false,
                                          ignoreWhitespace: true,
                                          ignoreCase: false,
                                        });

                                        return changes.reduce(
                                          (acc: { additions: number; deletions: number }, change: Change) => {
                                            if (change.added) {
                                              acc.additions += change.value.split('\n').length;
                                            }

                                            if (change.removed) {
                                              acc.deletions += change.value.split('\n').length;
                                            }

                                            return acc;
                                          },
                                          { additions: 0, deletions: 0 },
                                        );
                                      })();

                                      const showStats = additions > 0 || deletions > 0;

                                      return (
                                        showStats && (
                                          <div className="flex items-center gap-1 text-xs shrink-0">
                                            {additions > 0 && <span className="text-green-500">+{additions}</span>}
                                            {deletions > 0 && <span className="text-red-500">-{deletions}</span>}
                                          </div>
                                        )
                                      );
                                    })()}
                                  </div>
                                </div>
                              </div>
                            </button>
                          );
                        })
                      ) : (
                        <div className="flex flex-col items-center justify-center p-4 text-center">
                          <div className="w-12 h-12 mb-2 text-amplify-elements-textTertiary">
                            <div className="i-ph:file-dashed" />
                          </div>
                          <p className="text-sm font-medium text-amplify-elements-textPrimary">
                            {searchQuery ? 'No matching files' : 'No modified files'}
                          </p>
                          <p className="text-xs text-amplify-elements-textTertiary mt-1">
                            {searchQuery ? 'Try another search' : 'Changes will appear here as you edit'}
                          </p>
                        </div>
                      )}
                    </div>
                  </div>

                  {hasChanges && (
                    <div className="border-t border-amplify-elements-borderColor p-2">
                      <button
                        onClick={() => {
                          navigator.clipboard.writeText(filteredFiles.map(([filePath]) => filePath).join('\n'));
                          toast.success('File list copied to clipboard');
                        }}
                        className="w-full flex items-center justify-center gap-2 px-3 py-1.5 text-sm rounded-lg bg-amplify-elements-background-depth-1 hover:bg-amplify-elements-background-depth-3 transition-colors text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary"
                      >
                        Copy File List
                      </button>
                    </div>
                  )}
                </Popover.Panel>
              </Transition>
            </>
          )}
        </Popover>
      </div>
    );
  },
);

export const Workbench = memo(
  ({
    chatStarted,
    isStreaming,
    metadata: _metadata,
    updateChatMestaData: _updateChatMestaData,
    setSelectedElement,
  }: WorkspaceProps) => {
    renderLogger.trace('Workbench');

    const fileHistory = useStore(workbenchStore.fileHistory);
    const [comparisonContentState, setComparisonContentState] = useState<string | null>(null);

    // const modifiedFiles = Array.from(useStore(workbenchStore.unsavedFiles).keys());

    const hasPreview = useStore(computed(workbenchStore.previews, (previews) => previews.length > 0));
    const showWorkbench = useStore(workbenchStore.showWorkbench);
    const selectedFile = useStore(workbenchStore.selectedFile);
    const currentDocument = useStore(workbenchStore.currentDocument);
    const unsavedFiles = useStore(workbenchStore.unsavedFiles);
    const files = useStore(workbenchStore.files);
    const selectedView = useStore(workbenchStore.currentView);
    const { showChat } = useStore(chatStore);
    const canHideChat = showWorkbench || !showChat;

    const isSmallViewport = useViewport(1024);
    const streaming = useStore(streamingState);

    const [isSyncing, setIsSyncing] = useState(false);

    const hasFiles = useMemo(() => Object.values(files).some((f) => f?.type === 'file'), [files]);

    /*
     * A chat-generated `<docxartifact>` document. The Document view must be
     * reachable even when the workspace has NO files (a pure document chat
     * with no project), so this is tracked separately from `hasFiles`.
     */
    const docxArtifact = useStore(docxArtifactStore);
    const hasDocx = !!docxArtifact?.markdown;

    /*
     * Show the "Initializing project…" veil ONLY during the initial workspace
     * bootstrapping — i.e. while the AI is streaming AND no files have been
     * written to the WebContainer yet. Once files exist the project is
     * initialized and subsequent messages must NOT veil the workspace, even
     * if the AI is streaming or no preview port is open. The previous logic
     * (`streaming && !hasPreview`) re-veiled the workspace on every message
     * for projects that don't expose a preview port, hiding the editor the
     * user was trying to look at.
     */
    const showVeil = streaming && !hasFiles && !hasDocx;

    // Check if ANY file in the workspace is renderable (for tab visibility).
    const hasRenderableFiles = useMemo(() => findRenderableFiles(files).length > 0, [files]);

    const setSelectedView = (view: WorkbenchViewType) => {
      workbenchStore.currentView.set(view);
    };

    /*
     * Track workbench panel position for slider alignment (desktop only)
     * Uses ResizeObserver instead of requestAnimationFrame loop for efficiency
     */
    useEffect(() => {
      if (isSmallViewport || !showWorkbench) {
        workbenchStore.workbenchLeftPosition.set(null);
        return;
      }

      const updateWorkbenchPosition = () => {
        const workbenchElement = document.querySelector('[data-workbench-panel]') as HTMLElement;

        if (workbenchElement) {
          const rect = workbenchElement.getBoundingClientRect();
          workbenchStore.workbenchLeftPosition.set(rect.left);
        }
      };

      // Initial position update
      updateWorkbenchPosition();

      // Update on resize
      window.addEventListener('resize', updateWorkbenchPosition);

      /*
       * Use ResizeObserver for efficient position tracking instead of
       * a continuous requestAnimationFrame loop. The old RAF loop ran at
       * ~60fps indefinitely, causing unnecessary React re-renders.
       */
      let resizeObserver: ResizeObserver | undefined;
      const workbenchElement = document.querySelector('[data-workbench-panel]');

      if (workbenchElement) {
        resizeObserver = new ResizeObserver(() => {
          updateWorkbenchPosition();
        });
        resizeObserver.observe(workbenchElement);
      }

      return () => {
        window.removeEventListener('resize', updateWorkbenchPosition);
        resizeObserver?.disconnect();
      };
    }, [isSmallViewport, showWorkbench]);

    useEffect(() => {
      if (hasPreview) {
        setSelectedView('preview');
      }
    }, [hasPreview]);

    /*
     * Auto-switch to the Render tab when renderable files first appear
     * (only if no preview is active, so preview takes priority).
     */
    useEffect(() => {
      const currentView = workbenchStore.currentView.get();

      if (hasRenderableFiles && !hasPreview) {
        /*
         * Auto-switch to the Render tab when renderable files first appear
         * (only if no preview is active, so preview takes priority).
         */
        if (currentView === 'code') {
          setSelectedView('render');
        }
      }

      // If all renderable files are removed while on the render tab, fall back to code
      if (!hasRenderableFiles && currentView === 'render') {
        setSelectedView('code');
      }
    }, [hasRenderableFiles, hasPreview]);

    useEffect(() => {
      workbenchStore.setDocuments(files);
    }, [files]);

    const onEditorChange = useCallback<OnEditorChange>((update) => {
      workbenchStore.setCurrentDocumentContent(update.content);
    }, []);

    const onEditorScroll = useCallback<OnEditorScroll>((position) => {
      workbenchStore.setCurrentDocumentScrollPosition(position);
    }, []);

    const onFileSelect = useCallback((filePath: string | undefined) => {
      workbenchStore.setSelectedFile(filePath);
    }, []);

    const onFileSave = useCallback(() => {
      workbenchStore
        .saveCurrentDocument()
        .then(() => {
          // Explicitly refresh all previews after a file save
          const previewStore = usePreviewStore();
          previewStore.refreshAllPreviews();
        })
        .catch(() => {
          toast.error('Failed to update file content');
        });
    }, []);

    const onFileReset = useCallback(() => {
      workbenchStore.resetCurrentDocument();
    }, []);

    const handleSelectFile = useCallback((filePath: string) => {
      workbenchStore.setSelectedFile(filePath);
      workbenchStore.currentView.set('diff');
    }, []);

    const handleSyncFiles = useCallback(async () => {
      setIsSyncing(true);

      try {
        const directoryHandle = await window.showDirectoryPicker();
        await workbenchStore.syncFiles(directoryHandle);
        toast.success('Files synced successfully');
      } catch (error) {
        console.error('Error syncing files:', error);
        toast.error('Failed to sync files');
      } finally {
        setIsSyncing(false);
      }
    }, []);

    /*
     * Determine whether the workspace content should be rendered.
     * We use chatStarted OR showWorkbench (not just chatStarted) to
     * eliminate the one-render gap that occurs when showWorkbench
     * becomes true before the chatStarted state has caught up via
     * the sync effect. Without this, the panel opens but the
     * Workbench returns null for one frame, causing a flash.
     *
     * IMPORTANT: We always keep the Workbench mounted when a chat has
     * started, even if showWorkbench is false. Unmounting would destroy
     * the terminal, WebContainer, and running dev servers. On mobile,
     * the workbench is hidden from view via CSS/animation, but stays
     * alive in the DOM so processes keep running.
     */
    const shouldRender = chatStarted || showWorkbench;

    /*
     * Mobile hiding: When showWorkbench is false on mobile, the workbench
     * must be completely off-screen and non-interactive, but STILL MOUNTED
     * so terminal/WebContainer/dev server keep running.
     *
     * We use CSS-only hiding that cannot be disrupted by React re-renders
     * or stacking context changes (e.g. sidebar Dialog overlay):
     *   1) Inline style transform:translateX(100%) — synchronous, off-screen
     *   2) visibility:hidden + pointer-events:none — bulletproof fallback
     *
     * When showWorkbench is true on mobile, we remove CSS hiding and let
     * framer-motion animate the slide-in. On desktop (lg:), none applied.
     */
    const isMobileHidden = !showWorkbench && isSmallViewport;

    return (
      shouldRender && (
        <motion.div
          data-workbench-panel
          initial="closed"
          animate={showWorkbench ? 'open' : 'closed'}
          variants={isSmallViewport ? mobileWorkbenchVariants : undefined}
          style={isMobileHidden ? { transform: 'translateX(100%)' } : undefined}
          className={classNames('z-workbench lg:pb-4 lg:pr-4 absolute inset-0', {
            'invisible pointer-events-none lg:visible lg:pointer-events-auto': isMobileHidden,
          })}
        >
          {' '}
          {showVeil && (
            <motion.div
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              className="absolute inset-0 z-50 flex items-center justify-center bg-amplify-elements-background-depth-2/60 backdrop-blur-sm"
            >
              <div className="flex flex-col items-center gap-3 text-amplify-elements-textSecondary">
                <div className="i-ph:spinner animate-spin text-3xl text-accent-500" />
                <p className="text-sm font-medium animate-pulse">Initializing project…</p>
              </div>
            </motion.div>
          )}
          <div
            className={classNames(
              'z-0 h-full w-full lg:rounded-2xl border border-amplify-elements-borderColor overflow-hidden',
            )}
          >
            <div className="h-full ">
              <div className="h-full flex flex-col bg-amplify-elements-background-depth-2  overflow-hidden">
                {!hasFiles && !hasDocx && showWorkbench && (
                  <div className="flex-1 flex items-center justify-center">
                    <div className="flex flex-col items-center gap-3 text-amplify-elements-textTertiary">
                      <div className="i-ph:folder-open text-3xl" />
                      <p className="text-sm font-medium">Loading workspace…</p>
                    </div>
                  </div>
                )}
                {(hasFiles || hasDocx) && (
                  <div className="relative flex-1 overflow-hidden">
                    <View initial={{ x: '0%' }} animate={{ x: selectedView === 'code' ? '0%' : '-100%' }}>
                      <EditorPanel
                        editorDocument={currentDocument}
                        isStreaming={isStreaming}
                        selectedFile={selectedFile}
                        files={files}
                        unsavedFiles={unsavedFiles}
                        fileHistory={fileHistory}
                        onFileSelect={onFileSelect}
                        onEditorScroll={onEditorScroll}
                        onEditorChange={onEditorChange}
                        onFileSave={onFileSave}
                        onFileReset={onFileReset}
                        onVersionSelect={(content) => {
                          setComparisonContentState(content);
                          workbenchStore.currentView.set('diff');
                        }}
                      />
                    </View>
                    <View
                      initial={{ x: '100%' }}
                      animate={{ x: selectedView === 'diff' ? '0%' : selectedView === 'code' ? '100%' : '-100%' }}
                    >
                      <DiffView
                        fileHistory={fileHistory}
                        setFileHistory={(history) => workbenchStore.fileHistory.set(history)}
                        comparisonContent={comparisonContentState || undefined}
                        showWholeFile={Object.keys(fileHistory).length > 1}
                      />
                    </View>
                    <View initial={{ x: '100%' }} animate={{ x: selectedView === 'preview' ? '0%' : '100%' }}>
                      <Preview setSelectedElement={setSelectedElement} />
                    </View>
                    <View initial={{ x: '100%' }} animate={{ x: selectedView === 'render' ? '0%' : '100%' }}>
                      <RenderPanel />
                    </View>
                    <View initial={{ x: '100%' }} animate={{ x: selectedView === 'document' ? '0%' : '100%' }}>
                      <DocxPreviewPanel />
                    </View>
                  </div>
                )}
              </div>
            </div>
          </div>
        </motion.div>
      )
    );
  },
);

// View component for rendering content with motion transitions
interface ViewProps extends HTMLMotionProps<'div'> {
  children: JSX.Element;
}

const View = memo(({ children, ...props }: ViewProps) => {
  return (
    <motion.div className="absolute inset-0" transition={viewTransition} {...props}>
      {children}
    </motion.div>
  );
});
