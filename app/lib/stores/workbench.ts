import { atom, map, type MapStore, type ReadableAtom, type WritableAtom } from 'nanostores';
import type { EditorDocument, ScrollPosition } from '~/components/editor/codemirror/CodeMirrorEditor';
import { ActionRunner } from '~/lib/runtime/action-runner';
import type { ActionCallbackData, ArtifactCallbackData } from '~/lib/runtime/message-parser';
import { webcontainer } from '~/lib/webcontainer';
import type { ITerminal } from '~/types/terminal';
import { unreachable } from '~/utils/unreachable';
import { WORK_DIR } from '~/utils/constants';
import { EditorStore } from './editor';
import { FilesStore, type FileMap } from './files';
import { PreviewsStore } from './previews';
import { TerminalStore } from './terminal';
import JSZip from 'jszip';
import fileSaver from 'file-saver';
import { Octokit, type RestEndpointMethodTypes } from '@octokit/rest';
import { path } from '~/utils/path';
import { extractRelativePath } from '~/utils/diff';
import { description } from '~/lib/persistence';
import Cookies from 'js-cookie';
import { createSampler } from '~/utils/sampler';
import type { ActionAlert, DeployAlert, SupabaseAlert } from '~/types/actions';
import type { FileHistory } from '~/types/actions';
import { isRenderableFile } from '~/lib/renderable/registry';

const { saveAs } = fileSaver;

export interface ArtifactState {
  id: string;
  title: string;
  type?: string;
  closed: boolean;
  runner: ActionRunner;
}

export type ArtifactUpdateState = Pick<ArtifactState, 'title' | 'closed'>;

type Artifacts = MapStore<Record<string, ArtifactState>>;

export type WorkbenchViewType = 'code' | 'diff' | 'preview' | 'render';

export class WorkbenchStore {
  #previewsStore = new PreviewsStore(webcontainer);
  #filesStore = new FilesStore(webcontainer);
  #editorStore = new EditorStore(this.#filesStore);
  #terminalStore = new TerminalStore(webcontainer);

  fileHistory: MapStore<Record<string, FileHistory>> = import.meta.hot?.data.fileHistory ?? map({});

  #reloadedMessages = new Set<string>();

  /*
   * BUG #3 FIX — workspace-ready gate.
   *
   * When the AI invokes `inject_template`, the template's file actions +
   * `npm install` run asynchronously on the client. If the AI's *next*
   * response tries to modify files before the template files are written,
   * it can crash (modifying a non-existent file) or race with `npm install`.
   *
   * `#workspaceReadyPromise` starts RESOLVED (no-op for normal chats). When a
   * `template` artifact is opened we replace it with a pending promise
   * (`setWorkspaceLoading`). When that template's ActionRunner goes idle
   * (all file writes + npm install complete) we resolve it
   * (`setWorkspaceReady`). Non-template action executions `await` this
   * promise, so the AI's follow-up modifications are paused until the
   * workspace has actually loaded every template file.
   */
  #workspaceReadyPromise: Promise<void> = Promise.resolve();
  #resolveWorkspaceReady: () => void = () => {};
  #workspaceLoadingTimeout: ReturnType<typeof setTimeout> | undefined;

  artifacts: Artifacts = import.meta.hot?.data.artifacts ?? map({});

  showWorkbench: WritableAtom<boolean> = import.meta.hot?.data.showWorkbench ?? atom(false);
  currentView: WritableAtom<WorkbenchViewType> = import.meta.hot?.data.currentView ?? atom('code');
  unsavedFiles: WritableAtom<Set<string>> = import.meta.hot?.data.unsavedFiles ?? atom(new Set<string>());
  actionAlert: WritableAtom<ActionAlert | undefined> =
    import.meta.hot?.data.actionAlert ?? atom<ActionAlert | undefined>(undefined);
  supabaseAlert: WritableAtom<SupabaseAlert | undefined> =
    import.meta.hot?.data.supabaseAlert ?? atom<SupabaseAlert | undefined>(undefined);
  deployAlert: WritableAtom<DeployAlert | undefined> =
    import.meta.hot?.data.deployAlert ?? atom<DeployAlert | undefined>(undefined);
  workbenchLeftPosition: WritableAtom<number | null> =
    import.meta.hot?.data.workbenchLeftPosition ?? atom<number | null>(null);
  modifiedFiles = new Set<string>();
  artifactIdList: string[] = [];
  #globalExecutionQueue = Promise.resolve();
  constructor() {
    if (import.meta.hot) {
      import.meta.hot.data.artifacts = this.artifacts;
      import.meta.hot.data.unsavedFiles = this.unsavedFiles;
      import.meta.hot.data.showWorkbench = this.showWorkbench;
      import.meta.hot.data.currentView = this.currentView;
      import.meta.hot.data.actionAlert = this.actionAlert;
      import.meta.hot.data.supabaseAlert = this.supabaseAlert;
      import.meta.hot.data.deployAlert = this.deployAlert;
      import.meta.hot.data.fileHistory = this.fileHistory;
      import.meta.hot.data.workbenchLeftPosition = this.workbenchLeftPosition;

      // Ensure binary files are properly preserved across hot reloads
      const filesMap = this.files.get();

      for (const [path, dirent] of Object.entries(filesMap)) {
        if (dirent?.type === 'file' && dirent.isBinary && dirent.content) {
          // Make sure binary content is preserved
          this.files.setKey(path, { ...dirent });
        }
      }
    }
  }

  addToExecutionQueue(callback: () => Promise<void>) {
    this.#globalExecutionQueue = this.#globalExecutionQueue.then(() => callback());
  }

  get previews() {
    return this.#previewsStore.previews;
  }

  get files() {
    return this.#filesStore.files;
  }

  get currentDocument(): ReadableAtom<EditorDocument | undefined> {
    return this.#editorStore.currentDocument;
  }

  get selectedFile(): ReadableAtom<string | undefined> {
    return this.#editorStore.selectedFile;
  }

  get firstArtifact(): ArtifactState | undefined {
    return this.#getArtifact(this.artifactIdList[0]);
  }

  get filesCount(): number {
    return this.#filesStore.filesCount;
  }

  get showTerminal() {
    return this.#terminalStore.showTerminal;
  }
  get boltTerminal() {
    return this.#terminalStore.boltTerminal;
  }
  get alert() {
    return this.actionAlert;
  }
  clearAlert() {
    this.actionAlert.set(undefined);
  }

  get SupabaseAlert() {
    return this.supabaseAlert;
  }

  clearSupabaseAlert() {
    this.supabaseAlert.set(undefined);
  }

  get DeployAlert() {
    return this.deployAlert;
  }

  clearDeployAlert() {
    this.deployAlert.set(undefined);
  }

  toggleTerminal(value?: boolean) {
    this.#terminalStore.toggleTerminal(value);
  }

  attachTerminal(terminal: ITerminal) {
    this.#terminalStore.attachTerminal(terminal);
  }
  attachBoltTerminal(terminal: ITerminal) {
    this.#terminalStore.attachBoltTerminal(terminal);
  }

  detachTerminal(terminal: ITerminal) {
    this.#terminalStore.detachTerminal(terminal);
  }

  onTerminalResize(cols: number, rows: number) {
    this.#terminalStore.onTerminalResize(cols, rows);
  }

  setDocuments(files: FileMap) {
    this.#editorStore.setDocuments(files);

    if (this.#filesStore.filesCount > 0 && this.currentDocument.get() === undefined) {
      // we find the first file and select it
      for (const [filePath, dirent] of Object.entries(files)) {
        if (dirent?.type === 'file') {
          this.setSelectedFile(filePath);
          break;
        }
      }
    }
  }

  setShowWorkbench(show: boolean) {
    this.showWorkbench.set(show);
  }

  /**
   * BUG #3: Marks the workspace as "loading" (template files being written).
   * Subsequent non-template action executions will `await workspaceReady()`
   * until `setWorkspaceReady()` is called.
   */
  setWorkspaceLoading() {
    this.#workspaceReadyPromise = new Promise<void>((resolve) => {
      this.#resolveWorkspaceReady = resolve;
    });

    // Safety net: never let the gate block forever. If the template runner
    // never reports idle (e.g. an error swallowed the status change), resolve
    // after 90s so the AI's follow-up actions can proceed.
    if (this.#workspaceLoadingTimeout) {
      clearTimeout(this.#workspaceLoadingTimeout);
    }

    this.#workspaceLoadingTimeout = setTimeout(() => {
      console.warn('[WorkbenchStore] workspace-ready gate timed out after 90s — releasing');
      this.setWorkspaceReady();
    }, 90_000);
  }

  /**
   * BUG #3: Marks the workspace as ready — releases any non-template action
   * that is awaiting `workspaceReady()`.
   */
  setWorkspaceReady() {
    if (this.#workspaceLoadingTimeout) {
      clearTimeout(this.#workspaceLoadingTimeout);
      this.#workspaceLoadingTimeout = undefined;
    }

    // Only resolve if currently loading (promise is pending).
    this.#resolveWorkspaceReady();
    // Re-arm with an immediately-resolved promise so future awaits are no-ops.
    this.#workspaceReadyPromise = Promise.resolve();
    this.#resolveWorkspaceReady = () => {};
  }

  /** BUG #3: await this before running non-template actions. */
  workspaceReady(): Promise<void> {
    return this.#workspaceReadyPromise;
  }

  /**
   * Resets all workbench singleton state.
   *
   * Called when switching chats so that artifacts, files, view state, and
   * execution queues from the previous chat do not leak into the next one.
   * This is the cornerstone fix for:
   *   - Bug #1 (empty workspace on project open)
   *   - Bug #2 (old chat content leaking into new chat)
   */
  reset() {
    // Discard any in-flight execution so pending actions from the previous
    // chat never run against the new chat's WebContainer state.
    this.#globalExecutionQueue = Promise.resolve();

    // Clear artifact runners and their action maps.
    for (const artifact of Object.values(this.artifacts.get())) {
      try {
        artifact.runner.abortAllActions?.();
      } catch {
        /* ignore */
      }
    }
    this.artifacts.set({});
    this.artifactIdList = [];

    // Clear file state.
    this.#filesStore.files.set({});
    this.fileHistory.set({});
    this.unsavedFiles.set(new Set<string>());
    this.modifiedFiles.clear();

    // Clear view / alert state.
    this.showWorkbench.set(false);
    this.currentView.set('code');
    this.actionAlert.set(undefined);
    this.supabaseAlert.set(undefined);
    this.deployAlert.set(undefined);
    this.workbenchLeftPosition.set(null);

    // Clear reloaded-message tracking.
    this.#reloadedMessages.clear();

    // Release any pending workspace-ready gate so a stale loading state from
    // the previous chat cannot block the next chat's actions.
    this.setWorkspaceReady();

    // Reset editor selection so the next chat starts clean.
    this.#editorStore.selectedFile.set(undefined);

    console.log('[WorkbenchStore] reset() — all workspace state cleared');
  }

  /**
   * Directly populates `files` from a saved snapshot (in addition to writing
   * them to the WebContainer). This guarantees the editor renders the files
   * immediately on chat load without depending solely on the WebContainer
   * file watcher (which can miss events or race with initialization).
   */
  loadFilesFromSnapshot(files: FileMap) {
    if (!files || Object.keys(files).length === 0) {
      return;
    }

    const next: FileMap = {};

    for (const [rawPath, dirent] of Object.entries(files)) {
      if (!dirent) {
        continue;
      }

      // Normalize the path to be absolute under WORK_DIR.
      let p = rawPath;

      if (p.startsWith(WORK_DIR)) {
        // already absolute
      } else if (p.startsWith('/')) {
        p = `${WORK_DIR}${p}`;
      } else {
        p = `${WORK_DIR}/${p}`;
      }

      next[p] = dirent;
    }

    this.#filesStore.files.set(next);
    this.setDocuments(next);

    if (Object.keys(next).length > 0) {
      this.showWorkbench.set(true);
    }
  }

  setCurrentDocumentContent(newContent: string) {
    const filePath = this.currentDocument.get()?.filePath;

    if (!filePath) {
      return;
    }

    const originalContent = this.#filesStore.getFile(filePath)?.content;
    const unsavedChanges = originalContent !== undefined && originalContent !== newContent;

    this.#editorStore.updateFile(filePath, newContent);

    const currentDocument = this.currentDocument.get();

    if (currentDocument) {
      const previousUnsavedFiles = this.unsavedFiles.get();

      if (unsavedChanges && previousUnsavedFiles.has(currentDocument.filePath)) {
        return;
      }

      const newUnsavedFiles = new Set(previousUnsavedFiles);

      if (unsavedChanges) {
        newUnsavedFiles.add(currentDocument.filePath);
      } else {
        newUnsavedFiles.delete(currentDocument.filePath);
      }

      this.unsavedFiles.set(newUnsavedFiles);
    }
  }

  setCurrentDocumentScrollPosition(position: ScrollPosition) {
    const editorDocument = this.currentDocument.get();

    if (!editorDocument) {
      return;
    }

    const { filePath } = editorDocument;

    this.#editorStore.updateScrollPosition(filePath, position);
  }

  setSelectedFile(filePath: string | undefined) {
    this.#editorStore.setSelectedFile(filePath);
  }

  async saveFile(filePath: string) {
    const documents = this.#editorStore.documents.get();
    const document = documents[filePath];

    if (document === undefined) {
      return;
    }

    /*
     * For scoped locks, we would need to implement diff checking here
     * to determine if the user is modifying existing code or just adding new code
     * This is a more complex feature that would be implemented in a future update
     */

    await this.#filesStore.saveFile(filePath, document.value);

    const newUnsavedFiles = new Set(this.unsavedFiles.get());
    newUnsavedFiles.delete(filePath);

    this.unsavedFiles.set(newUnsavedFiles);
  }

  async saveCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    await this.saveFile(currentDocument.filePath);
  }

  resetCurrentDocument() {
    const currentDocument = this.currentDocument.get();

    if (currentDocument === undefined) {
      return;
    }

    const { filePath } = currentDocument;
    const file = this.#filesStore.getFile(filePath);

    if (!file) {
      return;
    }

    this.setCurrentDocumentContent(file.content);
  }

  async saveAllFiles() {
    for (const filePath of this.unsavedFiles.get()) {
      await this.saveFile(filePath);
    }
  }

  getFileModifcations() {
    return this.#filesStore.getFileModifications();
  }

  getModifiedFiles() {
    return this.#filesStore.getModifiedFiles();
  }

  resetAllFileModifications() {
    this.#filesStore.resetFileModifications();
  }

  /**
   * Lock a file to prevent edits
   * @param filePath Path to the file to lock
   * @returns True if the file was successfully locked
   */
  lockFile(filePath: string) {
    return this.#filesStore.lockFile(filePath);
  }

  /**
   * Lock a folder and all its contents to prevent edits
   * @param folderPath Path to the folder to lock
   * @returns True if the folder was successfully locked
   */
  lockFolder(folderPath: string) {
    return this.#filesStore.lockFolder(folderPath);
  }

  /**
   * Unlock a file to allow edits
   * @param filePath Path to the file to unlock
   * @returns True if the file was successfully unlocked
   */
  unlockFile(filePath: string) {
    return this.#filesStore.unlockFile(filePath);
  }

  /**
   * Unlock a folder and all its contents to allow edits
   * @param folderPath Path to the folder to unlock
   * @returns True if the folder was successfully unlocked
   */
  unlockFolder(folderPath: string) {
    return this.#filesStore.unlockFolder(folderPath);
  }

  /**
   * Check if a file is locked
   * @param filePath Path to the file to check
   * @returns Object with locked status, lock mode, and what caused the lock
   */
  isFileLocked(filePath: string) {
    return this.#filesStore.isFileLocked(filePath);
  }

  /**
   * Check if a folder is locked
   * @param folderPath Path to the folder to check
   * @returns Object with locked status, lock mode, and what caused the lock
   */
  isFolderLocked(folderPath: string) {
    return this.#filesStore.isFolderLocked(folderPath);
  }

  async createFile(filePath: string, content: string | Uint8Array = '') {
    try {
      const success = await this.#filesStore.createFile(filePath, content);

      if (success) {
        this.setSelectedFile(filePath);

        /*
         * For empty files, we need to ensure they're not marked as unsaved
         * Only check for empty string, not empty Uint8Array
         */
        if (typeof content === 'string' && content === '') {
          const newUnsavedFiles = new Set(this.unsavedFiles.get());
          newUnsavedFiles.delete(filePath);
          this.unsavedFiles.set(newUnsavedFiles);
        }
      }

      return success;
    } catch (error) {
      console.error('Failed to create file:', error);
      throw error;
    }
  }

  /**
   * Write content directly to a file (creates or overwrites).
   *
   * Used by the native Copilot-style tool mutation handler in Chat.client.tsx
   * to apply `replace_string_in_file`, `multi_replace_string_in_file`, and
   * `create_file` tool results to the workspace. This delegates to the
   * underlying FilesStore which writes to WebContainer and updates the
   * reactive file map atomically.
   */
  async writeFile(filePath: string, content: string): Promise<void> {
    try {
      await this.#filesStore.saveFile(filePath, content);
    } catch (error) {
      console.error('Failed to write file:', error);
      throw error;
    }
  }

  /**
   * Apply a single native-tool file mutation operation to the workspace.
   *
   * This is the browser-side counterpart to the `FileMutationOperation`
   * type defined in `app/lib/tools/nativeTools.ts`. The server-side tool
   * `execute` produces a mutation signal (a JSON string), and
   * `Chat.client.tsx` parses that signal and calls this method for each
   * operation in the signal.
   *
   * Returns a short human-readable summary that the UI can surface.
   */
  async applyFileMutation(
    op:
      | { op: 'create'; filePath: string; content: string }
      | { op: 'replace'; filePath: string; oldString: string; newString: string }
      | { op: 'multi_replace'; filePath: string; edits: Array<{ oldString: string; newString: string }> },
  ): Promise<string> {
    const fullPath = op.filePath.startsWith('/home/') ? op.filePath : `${WORK_DIR}/${op.filePath}`;

    try {
      if (op.op === 'create') {
        await this.createFile(fullPath, op.content);
        return `Created ${op.filePath}`;
      }

      // For replace / multi_replace: read current content, apply edits, write back
      const current = this.#filesStore.getFile(fullPath);

      if (!current) {
        return `Cannot edit — file not found: ${op.filePath}`;
      }

      let newContent = current.content;

      if (op.op === 'replace') {
        if (!newContent.includes(op.oldString)) {
          return `Edit failed — oldString not found in ${op.filePath}`;
        }

        newContent = newContent.replace(op.oldString, op.newString);
      } else {
        for (const [i, edit] of op.edits.entries()) {
          if (!newContent.includes(edit.oldString)) {
            return `Edit #${i + 1} failed — oldString not found in ${op.filePath}`;
          }

          newContent = newContent.replace(edit.oldString, edit.newString);
        }
      }

      await this.#filesStore.saveFile(fullPath, newContent);

      return op.op === 'replace' ? `Edited ${op.filePath}` : `Applied ${op.edits.length} edit(s) to ${op.filePath}`;
    } catch (error: any) {
      return `Mutation failed for ${op.filePath}: ${error?.message || String(error)}`;
    }
  }

  async createFolder(folderPath: string) {
    try {
      return await this.#filesStore.createFolder(folderPath);
    } catch (error) {
      console.error('Failed to create folder:', error);
      throw error;
    }
  }

  async deleteFile(filePath: string) {
    try {
      const currentDocument = this.currentDocument.get();
      const isCurrentFile = currentDocument?.filePath === filePath;

      const success = await this.#filesStore.deleteFile(filePath);

      if (success) {
        const newUnsavedFiles = new Set(this.unsavedFiles.get());

        if (newUnsavedFiles.has(filePath)) {
          newUnsavedFiles.delete(filePath);
          this.unsavedFiles.set(newUnsavedFiles);
        }

        if (isCurrentFile) {
          const files = this.files.get();
          let nextFile: string | undefined = undefined;

          for (const [path, dirent] of Object.entries(files)) {
            if (dirent?.type === 'file') {
              nextFile = path;
              break;
            }
          }

          this.setSelectedFile(nextFile);
        }
      }

      return success;
    } catch (error) {
      console.error('Failed to delete file:', error);
      throw error;
    }
  }

  async deleteFolder(folderPath: string) {
    try {
      const currentDocument = this.currentDocument.get();
      const isInCurrentFolder = currentDocument?.filePath?.startsWith(folderPath + '/');

      const success = await this.#filesStore.deleteFolder(folderPath);

      if (success) {
        const unsavedFiles = this.unsavedFiles.get();
        const newUnsavedFiles = new Set<string>();

        for (const file of unsavedFiles) {
          if (!file.startsWith(folderPath + '/')) {
            newUnsavedFiles.add(file);
          }
        }

        if (newUnsavedFiles.size !== unsavedFiles.size) {
          this.unsavedFiles.set(newUnsavedFiles);
        }

        if (isInCurrentFolder) {
          const files = this.files.get();
          let nextFile: string | undefined = undefined;

          for (const [path, dirent] of Object.entries(files)) {
            if (dirent?.type === 'file') {
              nextFile = path;
              break;
            }
          }

          this.setSelectedFile(nextFile);
        }
      }

      return success;
    } catch (error) {
      console.error('Failed to delete folder:', error);
      throw error;
    }
  }

  abortAllActions() {
    // TODO: what do we wanna do and how do we wanna recover from this?
  }

  setReloadedMessages(messages: string[]) {
    this.#reloadedMessages = new Set(messages);
  }

  addArtifact({ messageId, title, id, type }: ArtifactCallbackData) {
    const artifact = this.#getArtifact(id);

    if (artifact) {
      return;
    }

    if (!this.artifactIdList.includes(id)) {
      this.artifactIdList.push(id);
    }

    const isTemplate = type === 'template';

    /*
     * BUG #3: For template artifacts (inject_template), arm the workspace-
     * ready gate so the AI's follow-up file modifications pause until every
     * template file + `npm install` has finished. The `onStatusChange`
     * callback resolves the gate the first time the runner goes idle after
     * having been busy.
     */
    let templateRunnerBusy = false;

    const onStatusChange = isTemplate
      ? (isRunning: boolean) => {
          if (isRunning) {
            templateRunnerBusy = true;
          } else if (templateRunnerBusy) {
            templateRunnerBusy = false;
            this.setWorkspaceReady();
          }
        }
      : undefined;

    if (isTemplate) {
      this.setWorkspaceLoading();
    }

    this.artifacts.setKey(id, {
      id,
      title,
      closed: false,
      type,
      runner: new ActionRunner(
        webcontainer,
        () => this.boltTerminal,
        (alert) => {
          if (this.#reloadedMessages.has(messageId)) {
            return;
          }

          this.actionAlert.set(alert);
        },
        (alert) => {
          if (this.#reloadedMessages.has(messageId)) {
            return;
          }

          this.supabaseAlert.set(alert);
        },
        (alert) => {
          if (this.#reloadedMessages.has(messageId)) {
            return;
          }

          this.deployAlert.set(alert);
        },
        onStatusChange,
      ),
    });
  }

  updateArtifact({ artifactId }: ArtifactCallbackData, state: Partial<ArtifactUpdateState>) {
    if (!artifactId) {
      return;
    }

    const artifact = this.#getArtifact(artifactId);

    if (!artifact) {
      return;
    }

    this.artifacts.setKey(artifactId, { ...artifact, ...state });
  }
  addAction(data: ActionCallbackData) {
    // this._addAction(data);

    this.addToExecutionQueue(() => this._addAction(data));
  }
  async _addAction(data: ActionCallbackData) {
    const { artifactId } = data;

    const artifact = this.#getArtifact(artifactId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    return artifact.runner.addAction(data);
  }

  runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    if (isStreaming) {
      this.actionStreamSampler(data, isStreaming);
    } else {
      this.addToExecutionQueue(() => this._runAction(data, isStreaming));
    }
  }
  async _runAction(data: ActionCallbackData, isStreaming: boolean = false) {
    const { artifactId } = data;

    const artifact = this.#getArtifact(artifactId);

    if (!artifact) {
      unreachable('Artifact not found');
    }

    const action = artifact.runner.actions.get()[data.actionId];

    if (!action || action.executed) {
      return;
    }

    /*
     * Reloading a chat from history: the message parser re-fires callbacks so
     * the artifact/action UI is rebuilt, but we must NOT re-execute shell,
     * file, build, or start commands (they would e.g. re-run `npm install` or
     * overwrite files). The actual file contents are restored from the saved
     * snapshot by `restoreSnapshot` + `loadFilesFromSnapshot`. We simply mark
     * the action as complete so the UI shows it as done.
     */
    if (this.#reloadedMessages.has(data.messageId)) {
      artifact.runner.markActionComplete(data.actionId);
      return;
    }

    /*
     * BUG #3: Non-template actions pause until any in-progress template
     * injection (inject_template) has finished writing all its files and
     * running `npm install`. Template artifacts themselves do NOT await (they
     * are the loading actions). This prevents the AI's follow-up modifications
     * from racing against — or modifying — not-yet-existing files.
     */
    if (artifact.type !== 'template') {
      try {
        await this.workspaceReady();
      } catch {
        /* ignore — gate should never reject */
      }
    }

    const isBundled = artifact.type === 'bundled';

    if (data.action.type === 'file') {
      const wc = await webcontainer;
      const fullPath = path.join(wc.workdir, data.action.filePath);

      /*
       * For scoped locks, we would need to implement diff checking here
       * to determine if the AI is modifying existing code or just adding new code
       * This is a more complex feature that would be implemented in a future update
       */

      // Always show the workbench when files are being written, but only on desktop
      if (typeof window === 'undefined' || window.innerWidth >= 1024) {
        this.showWorkbench.set(true);
      }

      /*
       * Skip per-file focus/view switching for bundled artifacts (e.g. git clone imports)
       * to avoid rapidly cycling through every imported file in the editor.
       */
      if (!isBundled) {
        if (this.selectedFile.value !== fullPath) {
          this.setSelectedFile(fullPath);
        }

        if (isRenderableFile(data.action.filePath)) {
          this.currentView.set('render');
        } else if (this.currentView.value !== 'code') {
          this.currentView.set('code');
        }
      }

      if (isBundled) {
        /*
         * For bundled artifacts (git clone / template imports):
         * - Always run the action to write the file to WebContainer
         * - Skip all editor-level updates (focus, save, document sync)
         *   to avoid the distracting per-file editor re-renders.
         *   The file watcher picks up changes from WebContainer naturally.
         */
        await artifact.runner.runAction(data);
      } else {
        const doc = this.#editorStore.documents.get()[fullPath];

        if (!doc) {
          await artifact.runner.runAction(data, isStreaming);
        }

        this.#editorStore.updateFile(fullPath, data.action.content);

        if (!isStreaming && data.action.content) {
          await this.saveFile(fullPath);
        }

        if (!isStreaming) {
          await artifact.runner.runAction(data);
          this.resetAllFileModifications();
        }
      }
    } else {
      await artifact.runner.runAction(data);
    }
  }

  actionStreamSampler = createSampler(async (data: ActionCallbackData, isStreaming: boolean = false) => {
    return await this._runAction(data, isStreaming);
  }, 100); // TODO: remove this magic number to have it configurable

  #getArtifact(id: string) {
    const artifacts = this.artifacts.get();
    return artifacts[id];
  }

  async downloadZip() {
    const zip = new JSZip();
    const files = this.files.get();

    // Get the project name from the description input, or use a default name
    const projectName = (description.value ?? 'project').toLocaleLowerCase().split(' ').join('_');

    // Generate a simple 6-character hash based on the current timestamp
    const timestampHash = Date.now().toString(36).slice(-6);
    const uniqueProjectName = `${projectName}_${timestampHash}`;

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);

        // split the path into segments
        const pathSegments = relativePath.split('/');

        // if there's more than one segment, we need to create folders
        if (pathSegments.length > 1) {
          let currentFolder = zip;

          for (let i = 0; i < pathSegments.length - 1; i++) {
            currentFolder = currentFolder.folder(pathSegments[i])!;
          }
          currentFolder.file(pathSegments[pathSegments.length - 1], dirent.content);
        } else {
          // if there's only one segment, it's a file in the root
          zip.file(relativePath, dirent.content);
        }
      }
    }

    // Generate the zip file and save it
    const content = await zip.generateAsync({ type: 'blob' });
    saveAs(content, `${uniqueProjectName}.zip`);
  }

  async syncFiles(targetHandle: FileSystemDirectoryHandle) {
    const files = this.files.get();
    const syncedFiles = [];

    for (const [filePath, dirent] of Object.entries(files)) {
      if (dirent?.type === 'file' && !dirent.isBinary) {
        const relativePath = extractRelativePath(filePath);
        const pathSegments = relativePath.split('/');
        let currentHandle = targetHandle;

        for (let i = 0; i < pathSegments.length - 1; i++) {
          currentHandle = await currentHandle.getDirectoryHandle(pathSegments[i], { create: true });
        }

        // create or get the file
        const fileHandle = await currentHandle.getFileHandle(pathSegments[pathSegments.length - 1], {
          create: true,
        });

        // write the file content
        const writable = await fileHandle.createWritable();
        await writable.write(dirent.content);
        await writable.close();

        syncedFiles.push(relativePath);
      }
    }

    return syncedFiles;
  }

  async pushToRepository(
    provider: 'github' | 'gitlab',
    repoName: string,
    commitMessage?: string,
    username?: string,
    token?: string,
    isPrivate: boolean = false,
    branchName: string = 'main',
  ) {
    try {
      const isGitHub = provider === 'github';
      const isGitLab = provider === 'gitlab';

      const authToken = token || Cookies.get(isGitHub ? 'githubToken' : 'gitlabToken');
      const owner = username || Cookies.get(isGitHub ? 'githubUsername' : 'gitlabUsername');

      if (!authToken || !owner) {
        throw new Error(`${provider} token or username is not set in cookies or provided.`);
      }

      const files = this.files.get();

      if (!files || Object.keys(files).length === 0) {
        throw new Error('No files found to push');
      }

      if (isGitHub) {
        // Initialize Octokit with the auth token
        const octokit = new Octokit({ auth: authToken });

        // Check if the repository already exists before creating it
        let repo: RestEndpointMethodTypes['repos']['get']['response']['data'];
        let visibilityJustChanged = false;

        try {
          const resp = await octokit.repos.get({ owner, repo: repoName });
          repo = resp.data;
          console.log('Repository already exists, using existing repo');

          // Check if we need to update visibility of existing repo
          if (repo.private !== isPrivate) {
            console.log(
              `Updating repository visibility from ${repo.private ? 'private' : 'public'} to ${isPrivate ? 'private' : 'public'}`,
            );

            try {
              // Update repository visibility using the update method
              const { data: updatedRepo } = await octokit.repos.update({
                owner,
                repo: repoName,
                private: isPrivate,
              });

              console.log('Repository visibility updated successfully');
              repo = updatedRepo;
              visibilityJustChanged = true;

              // Add a delay after changing visibility to allow GitHub to fully process the change
              console.log('Waiting for visibility change to propagate...');
              await new Promise((resolve) => setTimeout(resolve, 3000)); // 3 second delay
            } catch (visibilityError) {
              console.error('Failed to update repository visibility:', visibilityError);

              // Continue with push even if visibility update fails
            }
          }
        } catch (error) {
          if (error instanceof Error && 'status' in error && error.status === 404) {
            // Repository doesn't exist, so create a new one
            console.log(`Creating new repository with private=${isPrivate}`);

            // Create new repository with specified privacy setting
            const createRepoOptions = {
              name: repoName,
              private: isPrivate,
              auto_init: true,
            };

            console.log('Create repo options:', createRepoOptions);

            const { data: newRepo } = await octokit.repos.createForAuthenticatedUser(createRepoOptions);

            console.log('Repository created:', newRepo.html_url, 'Private:', newRepo.private);
            repo = newRepo;

            // Add a small delay after creating a repository to allow GitHub to fully initialize it
            console.log('Waiting for repository to initialize...');
            await new Promise((resolve) => setTimeout(resolve, 2000)); // 2 second delay
          } else {
            console.error('Cannot create repo:', error);
            throw error; // Some other error occurred
          }
        }

        // Get all files
        const files = this.files.get();

        if (!files || Object.keys(files).length === 0) {
          throw new Error('No files found to push');
        }

        // Function to push files with retry logic
        const pushFilesToRepo = async (attempt = 1): Promise<string> => {
          const maxAttempts = 3;

          try {
            console.log(`Pushing files to repository (attempt ${attempt}/${maxAttempts})...`);

            // Create blobs for each file
            const blobs = await Promise.all(
              Object.entries(files).map(async ([filePath, dirent]) => {
                if (dirent?.type === 'file' && dirent.content) {
                  const { data: blob } = await octokit.git.createBlob({
                    owner: repo.owner.login,
                    repo: repo.name,
                    content: Buffer.from(dirent.content).toString('base64'),
                    encoding: 'base64',
                  });
                  return { path: extractRelativePath(filePath), sha: blob.sha };
                }

                return null;
              }),
            );

            const validBlobs = blobs.filter(Boolean); // Filter out any undefined blobs

            if (validBlobs.length === 0) {
              throw new Error('No valid files to push');
            }

            // Refresh repository reference to ensure we have the latest data
            const repoRefresh = await octokit.repos.get({ owner, repo: repoName });
            repo = repoRefresh.data;

            // Get the latest commit SHA (assuming main branch, update dynamically if needed)
            const { data: ref } = await octokit.git.getRef({
              owner: repo.owner.login,
              repo: repo.name,
              ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
            });
            const latestCommitSha = ref.object.sha;

            // Create a new tree
            const { data: newTree } = await octokit.git.createTree({
              owner: repo.owner.login,
              repo: repo.name,
              base_tree: latestCommitSha,
              tree: validBlobs.map((blob) => ({
                path: blob!.path,
                mode: '100644',
                type: 'blob',
                sha: blob!.sha,
              })),
            });

            // Create a new commit
            const { data: newCommit } = await octokit.git.createCommit({
              owner: repo.owner.login,
              repo: repo.name,
              message: commitMessage || 'Initial commit from your app',
              tree: newTree.sha,
              parents: [latestCommitSha],
            });

            // Update the reference
            await octokit.git.updateRef({
              owner: repo.owner.login,
              repo: repo.name,
              ref: `heads/${repo.default_branch || 'main'}`, // Handle dynamic branch
              sha: newCommit.sha,
            });

            console.log('Files successfully pushed to repository');

            return repo.html_url;
          } catch (error) {
            console.error(`Error during push attempt ${attempt}:`, error);

            // If we've just changed visibility and this is not our last attempt, wait and retry
            if ((visibilityJustChanged || attempt === 1) && attempt < maxAttempts) {
              const delayMs = attempt * 2000; // Increasing delay with each attempt
              console.log(`Waiting ${delayMs}ms before retry...`);
              await new Promise((resolve) => setTimeout(resolve, delayMs));

              return pushFilesToRepo(attempt + 1);
            }

            throw error; // Rethrow if we're out of attempts
          }
        };

        // Execute the push function with retry logic
        const repoUrl = await pushFilesToRepo();

        // Return the repository URL
        return repoUrl;
      }

      if (isGitLab) {
        const { GitLabApiService: gitLabApiServiceClass } = await import('~/lib/services/gitlabApiService');
        const gitLabApiService = new gitLabApiServiceClass(authToken, 'https://gitlab.com');

        // Check or create repo
        let repo = await gitLabApiService.getProject(owner, repoName);

        if (!repo) {
          repo = await gitLabApiService.createProject(repoName, isPrivate);
          await new Promise((r) => setTimeout(r, 2000)); // Wait for repo initialization
        }

        // Check if branch exists, create if not
        const branchRes = await gitLabApiService.getFile(repo.id, 'README.md', branchName).catch(() => null);

        if (!branchRes || !branchRes.ok) {
          // Create branch from default
          await gitLabApiService.createBranch(repo.id, branchName, repo.default_branch);
          await new Promise((r) => setTimeout(r, 1000));
        }

        const actions = Object.entries(files).reduce(
          (acc, [filePath, dirent]) => {
            if (dirent?.type === 'file' && dirent.content) {
              acc.push({
                action: 'create',
                file_path: extractRelativePath(filePath),
                content: dirent.content,
              });
            }

            return acc;
          },
          [] as { action: 'create' | 'update'; file_path: string; content: string }[],
        );

        // Check which files exist and update action accordingly
        for (const action of actions) {
          const fileCheck = await gitLabApiService.getFile(repo.id, action.file_path, branchName);

          if (fileCheck.ok) {
            action.action = 'update';
          }
        }

        // Commit all files
        await gitLabApiService.commitFiles(repo.id, {
          branch: branchName,
          commit_message: commitMessage || 'Commit multiple files',
          actions,
        });

        return repo.web_url;
      }

      // Should not reach here since we only handle GitHub and GitLab
      throw new Error(`Unsupported provider: ${provider}`);
    } catch (error) {
      console.error('Error pushing to repository:', error);
      throw error; // Rethrow the error for further handling
    }
  }
}

export const workbenchStore = new WorkbenchStore();
