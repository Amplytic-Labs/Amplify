import { useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { DeployButton } from '~/components/deploy/DeployButton';
import { MotionDropdownItem, MotionDropdownSeparator } from '~/components/ui/MotionDropdown';
import { useChatHistory } from '~/lib/persistence';

interface HeaderActionButtonsProps {
  chatStarted: boolean;
}

export function HeaderActionButtonsContent() {
  const [activePreviewIndex] = useState(0);
  const previews = useStore(workbenchStore.previews);
  const activePreview = previews[activePreviewIndex];
  const files = useStore(workbenchStore.files);
  const { exportChat } = useChatHistory();

  if (!activePreview && Object.keys(files).length === 0) {
    return null;
  }

  return (
    <div className="flex flex-col gap-1">
      <MotionDropdownItem onSelect={() => workbenchStore.downloadZip()} className="gap-2">
        <div className="i-ph:code" />
        <span>Download Code</span>
      </MotionDropdownItem>
      <MotionDropdownItem onSelect={() => exportChat()} className="gap-2">
        <div className="i-ph:chat" />
        <span>Export Chat</span>
      </MotionDropdownItem>
      <MotionDropdownSeparator />
      <MotionDropdownItem
        onSelect={() => window.open('https://github.com/imtia33/Open_Claude/issues/new', '_blank')}
        className="gap-2"
      >
        <div className="i-ph:bug" />
        <span>Report Bug</span>
      </MotionDropdownItem>
      <MotionDropdownItem
        onSelect={async () => {
          try {
            const { downloadDebugLog } = await import('~/utils/debugLogger');
            await downloadDebugLog();
          } catch (error) {
            console.error('Failed to download debug log:', error);
          }
        }}
        className="gap-2"
      >
        <div className="i-ph:download" />
        <span>Debug Log</span>
      </MotionDropdownItem>
    </div>
  );
}

export function HeaderActionButtons({ chatStarted: _chatStarted }: HeaderActionButtonsProps) {
  return <HeaderActionButtonsContent />;
}
