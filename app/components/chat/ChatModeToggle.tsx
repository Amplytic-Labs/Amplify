import React, { useState, useEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

// Vertical slide transition variants
const iconVariants = {
  initial: { y: 20, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -20, opacity: 0 },
};

interface ChatModeToggleProps {
  isAgentMode: boolean;
  onToggle: (isAgentMode: boolean) => void;
  className?: string;
}

export function ChatModeToggle({ isAgentMode, onToggle, className = '' }: ChatModeToggleProps) {
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
    <motion.button
      onClick={() => onToggle(!isAgentMode)}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className={`relative flex items-center justify-center w-10 h-10 rounded-lg border border-amplify-elements-borderColor bg-amplify-elements-background-depth-2 text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary hover:bg-amplify-elements-background-depth-3 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sidebar-primary/50 ${className}`}
      title={isAgentMode ? 'Switch to Chat Mode' : 'Switch to Agent Mode'}
      aria-label={isAgentMode ? 'Agent mode enabled - click for chat mode' : 'Chat mode enabled - click for agent mode'}
      role="switch"
      aria-checked={isAgentMode}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isAgentMode ? (
          <motion.div
            key="agent-mode"
            variants={iconVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: 'spring', stiffness: 450, damping: 28 }}
            className="absolute flex items-center justify-center"
          >
            {/* Iconify Web Component CDN icon - Agent/Robot icon */}
            <iconify-icon
              icon="fluent:agents-16-filled"
              style={{ fontSize: '20px' }}
            ></iconify-icon>
          </motion.div>
        ) : (
          <motion.div
            key="chat-mode"
            variants={iconVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: 'spring', stiffness: 450, damping: 28 }}
            className="absolute flex items-center justify-center"
          >
            {/* Iconify Web Component CDN icon - Chat icon */}
            <iconify-icon
              icon="lucide:message-circle"
              style={{ fontSize: '20px' }}
            ></iconify-icon>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}

export default ChatModeToggle;
