import React, { useCallback, useEffect, useState } from 'react';
import { History, RotateCcw, GitCommit, Clock, MessageSquare } from 'lucide-react';
import { toast } from 'react-toastify';
import { Button } from '~/components/ui/Button';
import { Badge } from '~/components/ui/Badge';
import { Dialog, DialogButton, DialogDescription, DialogTitle } from '~/components/ui/Dialog';
import { DialogRoot } from '~/components/ui/Dialog';
import { classNames } from '~/utils/classNames';
import { db, getMessages } from '~/lib/persistence';
import { projectStore } from '~/lib/persistence/project-store';
import { listProjectCommits, restoreProjectCommit, type ProjectCommit } from '~/lib/persistence/project-files';
import { workbenchStore } from '~/lib/stores/workbench';
import { webcontainer } from '~/lib/webcontainer';
import type { FileMap } from '~/lib/stores/files';

interface ProjectHistoryPanelProps {
  projectId: string;
  embedded?: boolean;
}

function formatRelative(iso: string): string {
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

/**
 * Write a FileMap into the WebContainer: create folders first, then write
 * files. Strips the WebContainer workdir prefix from keys when present.
 */
async function writeFilesToWebContainer(files: FileMap): Promise<void> {
  const container = await webcontainer;
  const entries = Object.entries(files);

  // Folders first.
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

  // Then files.
  for (const [rawKey, value] of entries) {
    if (value?.type !== 'file') {
      continue;
    }

    let key = rawKey;

    if (key.startsWith(container.workdir)) {
      key = key.replace(container.workdir, '');
    }

    try {
      await container.fs.writeFile(key, value.content, {
        encoding: value.isBinary ? undefined : 'utf8',
      });
    } catch {
      /* ignore */
    }
  }
}

export function ProjectHistoryPanel({ projectId, embedded = false }: ProjectHistoryPanelProps) {
  // Subscribe reactively so the "current" badge updates after restore.
  const project = projectStore.useProject(projectId);

  const [commits, setCommits] = useState<ProjectCommit[]>([]);
  const [loading, setLoading] = useState(true);
  const [pendingRestore, setPendingRestore] = useState<ProjectCommit | null>(null);
  const [restoring, setRestoring] = useState(false);

  const reload = useCallback(async () => {
    if (!db) {
      return;
    }

    setLoading(true);

    try {
      const list = await listProjectCommits(db, projectId);
      setCommits(list);
    } catch (err) {
      console.error('[ProjectHistory] Failed to list commits:', err);
    } finally {
      setLoading(false);
    }
  }, [projectId]);

  useEffect(() => {
    reload();
  }, [reload]);

  // Also reload when the project's version counter bumps (e.g. new commit saved).
  useEffect(() => {
    // `project` reference is enough; bump `reload` whenever it changes.
    void project?.currentCommitId;
    reload();
  }, [project?.currentCommitId, reload]);

  const handleRestore = useCallback(
    async (commit: ProjectCommit) => {
      if (!db) {
        return;
      }

      setRestoring(true);

      try {
        const restoredFiles = await restoreProjectCommit(db, projectId, commit.id);

        if (!restoredFiles) {
          toast.error('Failed to restore: commit not found');
          return;
        }

        /*
         * Sync the restored FileMap into the live workbench + WebContainer
         * so the editor, preview, and terminal all pick up the new state.
         */
        try {
          await writeFilesToWebContainer(restoredFiles);
        } catch (e) {
          console.warn('[ProjectHistory] WebContainer sync failed (continuing):', e);
        }

        /*
         * Set the workbench file store directly. FilesStore's webcontainer
         * watcher will reconcile individual keys as changes propagate.
         */
        workbenchStore.files.set({ ...restoredFiles });

        // Point the project's currentCommitId at the restored commit.
        projectStore.updateProject(projectId, { currentCommitId: commit.id });

        // Notify any other listeners (e.g. chat) that we restored files.
        window.dispatchEvent(
          new CustomEvent('amplify:restore-project-files', {
            detail: { projectId, commitId: commit.id },
          }),
        );

        toast.success(`Restored to ${commit.label ?? 'previous version'}`);
        await reload();
      } catch (err) {
        console.error('[ProjectHistory] Restore failed:', err);
        toast.error('Failed to restore version');
      } finally {
        setRestoring(false);
        setPendingRestore(null);
      }
    },
    [projectId, reload],
  );

  if (!project) {
    return (
      <div className={classNames('p-4 text-sm text-amplify-elements-textSecondary', embedded ? '' : 'h-full')}>
        Project not found.
      </div>
    );
  }

  return (
    <div
      className={classNames(
        'flex flex-col bg-amplify-elements-background-depth-1 text-amplify-elements-textPrimary',
        embedded ? '' : 'rounded-lg border border-amplify-elements-borderColor h-full',
      )}
    >
      <div className="flex items-center gap-2 px-4 py-3 border-b border-amplify-elements-borderColor">
        <History size={16} className="text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{project.name}</span>
            <Badge variant="secondary" size="sm">
              History
            </Badge>
          </div>
          <div className="text-xs text-amplify-elements-textTertiary mt-0.5">
            {commits.length === 0 ? 'No versions yet' : `${commits.length} version${commits.length === 1 ? '' : 's'}`}
          </div>
        </div>
      </div>

      <div className="flex-1 overflow-y-auto custom-scrollbar">
        {loading ? (
          <div className="px-4 py-6 text-sm text-amplify-elements-textTertiary">Loading history…</div>
        ) : commits.length === 0 ? (
          <div className="px-4 py-8 flex flex-col items-center justify-center gap-2 text-center">
            <GitCommit size={24} className="text-amplify-elements-textTertiary" />
            <p className="text-sm text-amplify-elements-textSecondary">No versions yet</p>
            <p className="text-xs text-amplify-elements-textTertiary">
              Each AI edit saves a new version of your project files. Restore to roll back here.
            </p>
          </div>
        ) : (
          <ul className="divide-y divide-amplify-elements-borderColor/50">
            {commits.map((commit) => {
              const isCurrent = commit.id === project.currentCommitId;

              return (
                <CommitRow
                  key={commit.id}
                  commit={commit}
                  isCurrent={isCurrent}
                  onRestore={() => setPendingRestore(commit)}
                />
              );
            })}
          </ul>
        )}
      </div>

      {/* Restore confirmation dialog */}
      <DialogRoot open={pendingRestore !== null}>
        <Dialog
          onClose={() => !restoring && setPendingRestore(null)}
          onBackdrop={() => !restoring && setPendingRestore(null)}
        >
          <div className="p-6 bg-white dark:bg-gray-950">
            <DialogTitle>Restore version?</DialogTitle>
            <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
              {pendingRestore ? (
                <>
                  This will replace the current project files with the contents of{' '}
                  <span className="font-medium text-gray-900 dark:text-white">
                    {pendingRestore.label ?? 'this version'}
                  </span>{' '}
                  ({pendingRestore.message}). The current version is preserved in history — you can always come back to
                  it.
                </>
              ) : (
                ''
              )}
            </DialogDescription>
            <div className="flex justify-end gap-3 mt-6">
              <DialogButton type="secondary" onClick={() => !restoring && setPendingRestore(null)}>
                Cancel
              </DialogButton>
              <DialogButton
                type="primary"
                onClick={() => {
                  if (pendingRestore) {
                    handleRestore(pendingRestore);
                  }
                }}
              >
                {restoring ? 'Restoring…' : 'Restore'}
              </DialogButton>
            </div>
          </div>
        </Dialog>
      </DialogRoot>
    </div>
  );
}

interface CommitRowProps {
  commit: ProjectCommit;
  isCurrent: boolean;
  onRestore: () => void;
}

function CommitRow({ commit, isCurrent, onRestore }: CommitRowProps) {
  const [chatLabel, setChatLabel] = useState<string | undefined>(undefined);

  useEffect(() => {
    let cancelled = false;

    if (!commit.chatId || !db) {
      setChatLabel(undefined);

      return () => undefined;
    }

    getMessages(db, commit.chatId)
      .then((chat) => {
        if (cancelled) {
          return;
        }

        setChatLabel(chat?.description || `Chat ${commit.chatId!.slice(0, 6)}`);
      })
      .catch(() => {
        if (!cancelled) {
          setChatLabel(undefined);
        }
      });

    return () => {
      cancelled = true;
    };
  }, [commit.chatId]);

  return (
    <li className="px-4 py-3 hover:bg-amplify-elements-background-depth-2 transition-colors">
      <div className="flex items-start gap-3">
        <div
          className={classNames(
            'shrink-0 mt-0.5 w-7 h-7 rounded-full flex items-center justify-center text-[10px] font-semibold',
            isCurrent
              ? 'bg-blue-500/15 text-blue-600 dark:text-blue-400 ring-1 ring-blue-500/30'
              : 'bg-amplify-elements-background-depth-3 text-amplify-elements-textSecondary',
          )}
        >
          {commit.label ?? 'v?'}
        </div>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2 flex-wrap">
            <span className="text-sm font-medium text-amplify-elements-textPrimary truncate">{commit.message}</span>
            {isCurrent && (
              <Badge variant="primary" size="sm">
                Current
              </Badge>
            )}
          </div>
          <div className="flex items-center gap-3 mt-1 text-xs text-amplify-elements-textTertiary">
            <span className="flex items-center gap-1">
              <Clock size={10} />
              {formatRelative(commit.createdAt)}
            </span>
            {chatLabel && (
              <span className="flex items-center gap-1 truncate" title={`Created in chat: ${chatLabel}`}>
                <MessageSquare size={10} />
                <span className="truncate">{chatLabel}</span>
              </span>
            )}
          </div>
        </div>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          onClick={onRestore}
          disabled={isCurrent}
          className="shrink-0"
          aria-label={`Restore ${commit.label ?? 'this version'}`}
          title={isCurrent ? 'Already the current version' : `Restore to ${commit.label ?? 'this version'}`}
        >
          <RotateCcw size={13} />
          <span className="hidden sm:inline">Restore</span>
        </Button>
      </div>
    </li>
  );
}

export default ProjectHistoryPanel;
