import React, { useEffect } from 'react';
import { Icon as IconifyIcon } from '@iconify/react';

interface ChatModeToggleProps {
  isAgentMode: boolean;
  onToggle: (isAgentMode: boolean) => void;
  disabled?: boolean;
  className?: string;
}

export function ChatModeToggle({ isAgentMode, onToggle, disabled = false, className = '' }: ChatModeToggleProps) {
  useEffect(() => {
    // Inject Iconify Web Component CDN script dynamically if not present
    const scriptId = 'iconify-cdn-script';
    if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = 'https://cdn.jsdelivr.net/npm/iconify-icon@2.1.0/dist/iconify-icon.min.js';
      script.async = true;
      document.head.appendChild(script);
    }
  }, []);

  return (
    <button
      onClick={() => !disabled && onToggle(!isAgentMode)}
      className={`flex items-center justify-center h-8 w-8 rounded-lg border transition-all outline-none ${
        disabled
          ? 'bg-accent-500/15 text-accent-500 border-accent-500/40 cursor-default'
          : isAgentMode
            ? 'bg-accent-500/15 text-accent-500 border-accent-500/40 hover:bg-accent-500/25'
            : 'bg-amplify-elements-background-depth-3 text-amplify-elements-textSecondary border-transparent hover:bg-amplify-elements-item-backgroundActive hover:text-amplify-elements-textPrimary'
      } ${className}`}
      title={disabled ? 'Agent mode (fixed for project chats)' : isAgentMode ? 'Switch to Chat Mode' : 'Switch to Agent Mode'}
      aria-label={isAgentMode ? 'Agent mode enabled - click for chat mode' : 'Chat mode enabled - click for agent mode'}
      role="switch"
      aria-checked={isAgentMode}
    >
      {isAgentMode ? (
        <iconify-icon
          icon="fluent:agents-16-filled"
          style={{ fontSize: '16px' }}
        />
      ) : (
        <iconify-icon
          icon="lucide:message-circle"
          style={{ fontSize: '16px' }}
        />
      )}
    </button>
  );
}

export default ChatModeToggle;
