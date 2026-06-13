import { useStore } from '@nanostores/react';
import { computed } from 'nanostores';
import { memo, useMemo } from 'react';
import type { ActionState } from '~/lib/runtime/action-runner';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import { TraceTree, type TraceItem, type TreeItemStatus, type TreeItemType, type TreeItemIcon } from './TraceTree';

interface ArtifactProps {
  messageId: string;
  artifactId: string;
}

export const Artifact = memo(({ artifactId }: ArtifactProps) => {
  const artifacts = useStore(workbenchStore.artifacts);
  const artifact = artifacts[artifactId];

  const actions = useStore(
    computed(artifact.runner.actions, (actions) => {
      return Object.values(actions).filter((action) => {
        return action.type !== 'supabase' && !(action.type === 'shell' && action.content?.includes('supabase'));
      });
    }),
  );

  /* ---- Build TraceTree items for files and commands ---- */
  const { fileItems, commandItems, fileSummary, commandSummary } = useMemo(() => {
    const fileActions = actions.filter((a) => a.type === 'file');
    const shellActions = actions.filter((a) => a.type === 'shell');

    const mapStatus = (s: ActionState['status']): TreeItemStatus => {
      switch (s) {
        case 'pending':
          return 'pending';
        case 'running':
          return 'running';
        case 'complete':
          return 'done';
        case 'failed':
          return 'failed';
        case 'aborted':
          return 'done';
      }
    };

    const files: TraceItem[] = fileActions.map((a, i) => ({
      id: `file-${i}`,
      text: a.filePath!,
      status: mapStatus(a.status),
      type: 'bullet' as TreeItemType,
      icon: 'plus' as TreeItemIcon,
    }));

    const commands: TraceItem[] = shellActions.map((a, i) => ({
      id: `cmd-${i}`,
      text: a.content,
      status: mapStatus(a.status),
      type: 'bullet' as TreeItemType,
      icon: 'terminal' as TreeItemIcon,
    }));

    const isRunning = fileActions.some((a) => a.status === 'running' || a.status === 'pending');

    let fileText = '';
    if (fileActions.length > 0) {
      fileText = isRunning
        ? `Working on ${fileActions.length} file${fileActions.length > 1 ? 's' : ''}`
        : `Updated ${fileActions.length} file${fileActions.length > 1 ? 's' : ''}`;
    }

    const cmdRunning = shellActions.some((a) => a.status === 'running' || a.status === 'pending');
    const cmdText =
      shellActions.length > 0
        ? cmdRunning
          ? `Running ${shellActions.length} command${shellActions.length > 1 ? 's' : ''}`
          : `Ran ${shellActions.length} command${shellActions.length > 1 ? 's' : ''}`
        : '';

    return { fileItems: files, commandItems: commands, fileSummary: fileText, commandSummary: cmdText };
  }, [actions]);

  return (
    <div className="flex flex-col mb-4">
      {fileItems.length > 0 && (
        <TraceTree
          headerIcon="file"
          headerText={fileSummary}
          items={fileItems}
          onHeaderClick={() => {
            workbenchStore.showWorkbench.set(true);
          }}
        />
      )}
      {commandItems.length > 0 && (
        <TraceTree
          headerIcon="command"
          headerText={commandSummary}
          items={commandItems}
          onHeaderClick={() => {
            workbenchStore.showWorkbench.set(true);
          }}
        />
      )}
    </div>
  );
});

export function openArtifactInWorkbench(filePath: any) {
  workbenchStore.showWorkbench.set(true);
  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
}
