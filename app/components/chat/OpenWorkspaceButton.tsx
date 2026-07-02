import React, { useState } from 'react';
import { useStore } from '@nanostores/react';
import { PanelsTopLeft, Loader2 } from 'lucide-react';
import { toast } from 'react-toastify';
import { Tooltip } from '~/components/ui/Tooltip';
import { classNames } from '~/utils/classNames';
import { chatId, description, chatMetadata, db } from '~/lib/persistence/useChatHistory';
import { updateChatMetadata, type IChatMetadata } from '~/lib/persistence/db';
import { projectStore } from '~/lib/persistence/project-store';
import { createProjectCommit, getProjectFiles } from '~/lib/persistence/project-files';
import { workbenchStore } from '~/lib/stores/workbench';

/**
 * "Open Workspace" button.
 *
 * Visible only when the current chat is NOT yet linked to a project. Promotes
 * the chat to a project, seeds the project's global FileMap from the current
 * workbench state as the first commit, sets chat metadata.projectId, and
 * opens the workbench.
 *
 * We update chat metadata directly via `updateChatMetadata` (db.ts) rather
 * than `useChatHistory().updateChatMestaData` because the latter closes over
 * the hook's local `initialMessages` state, which is empty here and would
 * overwrite the chat's stored messages with [].
 */
export function OpenWorkspaceButton() {
  const currentChatId = useStore(chatId);
  const meta = useStore(chatMetadata);
  const desc = useStore(description);
  const [busy, setBusy] = useState(false);

  // Already a project? Hide the button.
  const linkedProjectId =
    meta?.projectId ?? (currentChatId ? projectStore.getProjectByChat(currentChatId)?.id : undefined);
  const visible = !!currentChatId && !linkedProjectId;

  if (!visible) {
    return null;
  }

  const handleClick = async () => {
    if (!currentChatId || !db) {
      return;
    }

    setBusy(true);

    try {
      // 1. Promote chat → project
      const project = await projectStore.promoteChatToProject(currentChatId, desc || 'Untitled Project');

      // 2. Seed project files from the current workbench as the first commit.
      const currentFiles = workbenchStore.files.get();

      if (Object.keys(currentFiles).length > 0) {
        await createProjectCommit(
          db,
          project.id,
          `Project created — ${desc || 'Untitled'}`,
          currentFiles,
          currentChatId,
        );

        const updated = await getProjectFiles(db, project.id);
        projectStore.updateProject(project.id, { currentCommitId: updated?.currentCommitId });
      }

      // 3. Persist projectId on chat metadata so the link survives reloads.
      const nextMeta: IChatMetadata = {
        ...(meta ?? {}),
        projectId: project.id,
        projectInitiated: true,
      };
      await updateChatMetadata(db, currentChatId, nextMeta);
      chatMetadata.set(nextMeta);

      // 4. Open the workbench.
      workbenchStore.showWorkbench.set(true);

      toast.success('Project created — workspace opened', { autoClose: 2500 });
    } catch (err) {
      console.error('[OpenWorkspaceButton] Failed to create project:', err);
      toast.error('Failed to create project');
    } finally {
      setBusy(false);
    }
  };

  return (
    <Tooltip content="Open Workspace — promote this chat into a project" side="left">
      <button
        type="button"
        onClick={handleClick}
        disabled={busy}
        aria-label="Open Workspace"
        title="Open Workspace"
        className={classNames(
          'inline-flex items-center gap-1.5 h-8 px-2.5 rounded-md text-xs font-medium',
          'bg-purple-500/10 text-purple-600 dark:text-purple-400 hover:bg-purple-500/20',
          'border border-purple-500/30 transition-colors',
          'disabled:opacity-60 disabled:cursor-wait',
        )}
      >
        {busy ? <Loader2 size={13} className="animate-spin" /> : <PanelsTopLeft size={13} />}
        <span className="hidden sm:inline">Open Workspace</span>
      </button>
    </Tooltip>
  );
}

export default OpenWorkspaceButton;
