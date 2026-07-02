import { useStore } from '@nanostores/react';
import { memo, useMemo, useCallback, useState, useEffect } from 'react';
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels';
import * as Tabs from '@radix-ui/react-tabs';
import { saveAs } from 'file-saver';
import { Brain, History as HistoryIcon } from 'lucide-react';
import {
  CodeMirrorEditor,
  type EditorDocument,
  type EditorSettings,
  type OnChangeCallback as OnEditorChange,
  type OnSaveCallback as OnEditorSave,
  type OnScrollCallback as OnEditorScroll,
} from '~/components/editor/codemirror/CodeMirrorEditor';
import { PanelHeader } from '~/components/ui/PanelHeader';
import { PanelHeaderButton } from '~/components/ui/PanelHeaderButton';
import { Dialog, DialogRoot } from '~/components/ui/Dialog';
import type { FileMap } from '~/lib/stores/files';
import type { FileHistory } from '~/types/actions';
import { themeStore } from '~/lib/stores/theme';
import { WORK_DIR } from '~/utils/constants';
import { renderLogger } from '~/utils/logger';
import { isMobile } from '~/utils/mobile';
import { FileBreadcrumb } from './FileBreadcrumb';
import { FileTree } from './FileTree';
import { DEFAULT_TERMINAL_SIZE, TerminalTabs } from './terminal/TerminalTabs';
import { workbenchStore } from '~/lib/stores/workbench';
import { toast } from 'react-toastify';
import { Search } from './Search'; // <-- Ensure Search is imported
import { classNames } from '~/utils/classNames'; // <-- Import classNames if not already present
import { LockManager } from './LockManager'; // <-- Import LockManager
import { chatId } from '~/lib/persistence/useChatHistory';
import { projectStore } from '~/lib/persistence/project-store';
import { ProjectMemoryPanel } from '~/components/project/ProjectMemoryPanel';
import { ProjectHistoryPanel } from '~/components/project/ProjectHistoryPanel';

interface EditorPanelProps {
  files?: FileMap;
  unsavedFiles?: Set<string>;
  editorDocument?: EditorDocument;
  selectedFile?: string | undefined;
  isStreaming?: boolean;
  fileHistory?: Record<string, FileHistory>;
  onEditorChange?: OnEditorChange;
  onEditorScroll?: OnEditorScroll;
  onFileSelect?: (value?: string) => void;
  onFileSave?: OnEditorSave;
  onFileReset?: () => void;
  onVersionSelect?: (content: any) => void;
}

const DEFAULT_EDITOR_SIZE = 100 - DEFAULT_TERMINAL_SIZE;

const editorSettings: EditorSettings = { tabSize: 2 };

export const EditorPanel = memo(
  ({
    files,
    unsavedFiles,
    editorDocument,
    selectedFile,
    isStreaming,
    fileHistory,
    onFileSelect,
    onEditorChange,
    onEditorScroll,
    onFileSave,
    onFileReset,
  }: EditorPanelProps) => {
    renderLogger.trace('EditorPanel');

    const theme = useStore(themeStore);
    const showTerminal = useStore(workbenchStore.showTerminal);
    const currentView = useStore(workbenchStore.currentView);

    // Resolve the current project (if any) from the active chat so we can
    // offer Memory / History panels in the workbench.
    const currentChatId = useStore(chatId);
    const projectId = currentChatId ? projectStore.getProjectByChat(currentChatId)?.id : undefined;
    // Subscribe to project changes so the buttons stay enabled/disabled correctly.
    const project = projectStore.useProject(projectId);

    const [memoryOpen, setMemoryOpen] = useState(false);
    const [historyOpen, setHistoryOpen] = useState(false);

    /*
     * Listen for sidebar dispatches that ask the workbench to open the
     * Project Memory / History dialogs. The sidebar's SelectedProjectPanel
     * fires `amplify:open-project-memory` / `amplify:open-project-history`
     * with `{ detail: { projectId } }` so the workbench opens the dialog
     * for the correct project even if the user hasn't clicked into a chat
     * yet.
     */
    useEffect(() => {
      const openMemory = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail?.projectId) return;
        setMemoryOpen(true);
      };
      const openHistory = (e: Event) => {
        const detail = (e as CustomEvent).detail;
        if (!detail?.projectId) return;
        setHistoryOpen(true);
      };

      window.addEventListener('amplify:open-project-memory', openMemory);
      window.addEventListener('amplify:open-project-history', openHistory);

      return () => {
        window.removeEventListener('amplify:open-project-memory', openMemory);
        window.removeEventListener('amplify:open-project-history', openHistory);
      };
    }, []);

    const handleCopy = useCallback(async () => {
      if (!editorDocument) return;
      await navigator.clipboard.writeText(editorDocument.value);
      toast.success('Content copied to clipboard');
    }, [editorDocument]);

    const handleDownload = useCallback(() => {
      if (!editorDocument) return;
      const blob = new Blob([editorDocument.value], { type: 'text/plain' });
      saveAs(blob, editorDocument.filePath.split('/').pop() || 'file.txt');
    }, [editorDocument]);

    const handleViewToggle = useCallback(() => {
      const nextView = currentView === 'code' ? 'render' : 'code';
      workbenchStore.currentView.set(nextView);
    }, [currentView]);

    const handleVersionSelect = useCallback(
      (versionIndex: number) => {
        if (!editorDocument || !fileHistory) return;
        const history = fileHistory[editorDocument.filePath];
        if (!history || !history.versions[versionIndex]) return;

        const content = history.versions[versionIndex].content;
        workbenchStore.setCurrentDocumentContent(content);
        toast.info(`Reverted to version ${versionIndex + 1}`);
      },
      [editorDocument, fileHistory],
    );

    const activeFileSegments = useMemo(() => {
      if (!editorDocument) {
        return undefined;
      }

      return editorDocument.filePath.split('/');
    }, [editorDocument]);

    const activeFileUnsaved = useMemo(() => {
      if (!editorDocument || !unsavedFiles) {
        return false;
      }

      // Make sure unsavedFiles is a Set before calling has()
      return unsavedFiles instanceof Set && unsavedFiles.has(editorDocument.filePath);
    }, [editorDocument, unsavedFiles]);

    return (
      <>
      <PanelGroup direction="vertical">
        <Panel defaultSize={showTerminal ? DEFAULT_EDITOR_SIZE : 100} minSize={20}>
          <PanelGroup direction="horizontal">
            <Panel defaultSize={20} minSize={15} collapsible className="border-r border-amplify-elements-borderColor">
              <div className="h-full">
                <Tabs.Root defaultValue="files" className="flex flex-col h-full">
                  <PanelHeader className="w-full text-sm font-medium text-amplify-elements-textSecondary px-1">
                    <div className="h-full flex-shrink-0 flex items-center justify-between w-full">
                      <Tabs.List className="h-full flex-shrink-0 flex items-center">
                        <Tabs.Trigger
                          value="files"
                          className={classNames(
                            'h-full bg-transparent hover:bg-amplify-elements-background-depth-3 py-0.5 px-2 rounded-lg text-sm font-medium text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary data-[state=active]:text-amplify-elements-textPrimary',
                          )}
                        >
                          Files
                        </Tabs.Trigger>
                        <Tabs.Trigger
                          value="search"
                          className={classNames(
                            'h-full bg-transparent hover:bg-amplify-elements-background-depth-3 py-0.5 px-2 rounded-lg text-sm font-medium text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary data-[state=active]:text-amplify-elements-textPrimary',
                          )}
                        >
                          Search
                        </Tabs.Trigger>
                        <Tabs.Trigger
                          value="locks"
                          className={classNames(
                            'h-full bg-transparent hover:bg-amplify-elements-background-depth-3 py-0.5 px-2 rounded-lg text-sm font-medium text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary data-[state=active]:text-amplify-elements-textPrimary',
                          )}
                        >
                          Locks
                        </Tabs.Trigger>
                      </Tabs.List>

                      {/* Project Memory + History shortcuts (only for project chats) */}
                      {project && (
                        <div className="flex items-center gap-0.5">
                          <PanelHeaderButton
                            onClick={() => setMemoryOpen(true)}
                            disabled={false}
                            aria-label="Open Project Memory"
                            title="Project Memory"
                          >
                            <Brain size={14} className="text-purple-500" />
                          </PanelHeaderButton>
                          <PanelHeaderButton
                            onClick={() => setHistoryOpen(true)}
                            disabled={false}
                            aria-label="Open Project History"
                            title="Project History"
                          >
                            <HistoryIcon size={14} className="text-purple-500" />
                          </PanelHeaderButton>
                        </div>
                      )}
                    </div>
                  </PanelHeader>

                  <Tabs.Content value="files" className="flex-grow overflow-auto focus-visible:outline-none">
                    <FileTree
                      className="h-full"
                      files={files}
                      hideRoot
                      collapsed
                      unsavedFiles={unsavedFiles}
                      fileHistory={fileHistory}
                      rootFolder={WORK_DIR}
                      selectedFile={selectedFile}
                      onFileSelect={onFileSelect}
                    />
                  </Tabs.Content>

                  <Tabs.Content value="search" className="flex-grow overflow-auto focus-visible:outline-none">
                    <Search />
                  </Tabs.Content>

                  <Tabs.Content value="locks" className="flex-grow overflow-auto focus-visible:outline-none">
                    <LockManager />
                  </Tabs.Content>
                </Tabs.Root>
              </div>
            </Panel>

            <PanelResizeHandle />
            <Panel className="flex flex-col" defaultSize={80} minSize={20}>
              <PanelHeader className="overflow-x-auto">
                {activeFileSegments?.length && (
                  <div className="flex items-center flex-1 text-sm">
                    <FileBreadcrumb pathSegments={activeFileSegments} files={files} onFileSelect={onFileSelect} />

                    <div className="flex gap-1 ml-auto -mr-1.5">
                      {/* Version Selector */}
                      {fileHistory && editorDocument && fileHistory[editorDocument.filePath] && (
                        <select
                          className="bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor text-xs rounded px-1 py-1 outline-none"
                          onChange={(e) => handleVersionSelect(parseInt(e.target.value))}
                          value={0} // Default to latest or current
                        >
                          {fileHistory[editorDocument.filePath].versions.map((_, i) => (
                            <option key={i} value={i}>
                              v{fileHistory[editorDocument.filePath].versions.length - i}
                            </option>
                          ))}
                        </select>
                      )}

                      {/* View Toggle */}
                      {editorDocument &&
                        ['.md', '.mermaid', '.svg'].some((ext) => editorDocument.filePath.endsWith(ext)) && (
                          <PanelHeaderButton onClick={handleViewToggle}>
                            <div className={classNames('i-ph', currentView === 'code' ? 'i-ph:eye' : 'i-ph:code')} />
                            {currentView === 'code' ? 'Render' : 'Code'}
                          </PanelHeaderButton>
                        )}

                      <PanelHeaderButton onClick={handleCopy}>
                        <div className="i-ph:copy" />
                        Copy
                      </PanelHeaderButton>

                      <PanelHeaderButton
                        onClick={() => workbenchStore.toggleTerminal(!workbenchStore.showTerminal.get())}
                      >
                        <div className="i-ph:terminal" />
                        Terminal
                      </PanelHeaderButton>

                      <PanelHeaderButton onClick={handleDownload}>
                        <div className="i-ph:download-simple" />
                        Download
                      </PanelHeaderButton>

                      {activeFileUnsaved && (
                        <>
                          <PanelHeaderButton onClick={onFileSave}>
                            <div className="i-ph:floppy-disk-duotone" />
                            Save
                          </PanelHeaderButton>
                          <PanelHeaderButton onClick={onFileReset}>
                            <div className="i-ph:clock-counter-clockwise-duotone" />
                            Reset
                          </PanelHeaderButton>
                        </>
                      )}
                    </div>
                  </div>
                )}
              </PanelHeader>
              <div className="h-full flex-1 overflow-hidden modern-scrollbar">
                <CodeMirrorEditor
                  theme={theme}
                  editable={!isStreaming && editorDocument !== undefined}
                  settings={editorSettings}
                  doc={editorDocument}
                  autoFocusOnDocumentChange={!isMobile()}
                  onScroll={onEditorScroll}
                  onChange={onEditorChange}
                  onSave={onFileSave}
                />
              </div>
            </Panel>
          </PanelGroup>
        </Panel>
        <PanelResizeHandle />
        <TerminalTabs />
      </PanelGroup>

      {/* Project Memory dialog */}
      <DialogRoot open={memoryOpen} onOpenChange={setMemoryOpen}>
        <Dialog onClose={() => setMemoryOpen(false)} onBackdrop={() => setMemoryOpen(false)} className="w-[640px] max-w-[92vw] max-h-[85vh]">
          <div className="flex flex-col max-h-[85vh] overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {projectId ? (
                <ProjectMemoryPanel projectId={projectId} embedded />
              ) : (
                <div className="p-6 text-sm text-amplify-elements-textSecondary">
                  No project linked to this chat.
                </div>
              )}
            </div>
          </div>
        </Dialog>
      </DialogRoot>

      {/* Project History dialog */}
      <DialogRoot open={historyOpen} onOpenChange={setHistoryOpen}>
        <Dialog onClose={() => setHistoryOpen(false)} onBackdrop={() => setHistoryOpen(false)} className="w-[560px] max-w-[92vw] max-h-[85vh]">
          <div className="flex flex-col max-h-[85vh] overflow-hidden">
            <div className="flex-1 overflow-y-auto custom-scrollbar">
              {projectId ? (
                <ProjectHistoryPanel projectId={projectId} embedded />
              ) : (
                <div className="p-6 text-sm text-amplify-elements-textSecondary">
                  No project linked to this chat.
                </div>
              )}
            </div>
          </div>
        </Dialog>
      </DialogRoot>
    </>
    );
  },
);
