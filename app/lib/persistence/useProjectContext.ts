/**
 * React hook: build the `projectContext` string injected into the system
 * prompt for the current chat.
 *
 * For a project-linked chat this is:
 *   <structured project memory>   (framework/state/backend/architecture/theme/…)
 *   <current file tree summary>   (so the model knows the layout)
 *   <vector project context>      (semantic recall, optional)
 *
 * For a personal chat (no project) it returns the vector project context as-is
 * (which is usually empty).
 */

import { useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { chatId } from '~/lib/persistence/useChatHistory';
import { projectStore, formatProjectMemoryForPrompt } from '~/lib/persistence/project-store';
import { buildFileTreeSummary } from '~/lib/persistence/project-memory-detect';
import { workbenchStore } from '~/lib/stores/workbench';

export function useProjectContextString(vectorProjectContext: string): string | undefined {
  const currentChatId = useStore(chatId);
  const files = useStore(workbenchStore.files);

  // Subscribe to project version bumps so memory edits re-render.
  const _version = useStore((projectStore as any)._versionStore);

  return useMemo(() => {
    void _version;

    const project = currentChatId ? projectStore.getProjectByChat(currentChatId) : undefined;

    if (!project) {
      return vectorProjectContext || undefined;
    }

    const memoryBlock = formatProjectMemoryForPrompt(project.memory);

    const parts: string[] = [];

    if (memoryBlock) {
      parts.push(`<project_memory>\n${memoryBlock}\n</project_memory>`);
    }

    const tree = buildFileTreeSummary(files);

    if (tree) {
      parts.push(`<project_file_tree>\n${tree}\n</project_file_tree>`);
    }

    if (vectorProjectContext) {
      parts.push(`<project_recall>\n${vectorProjectContext}\n</project_recall>`);
    }

    return parts.join('\n\n') || undefined;
  }, [currentChatId, files, vectorProjectContext, _version]);
}
