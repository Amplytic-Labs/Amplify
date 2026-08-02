import type { UIMessage } from 'ai';
import { useCallback, useRef, useState } from 'react';
import { EnhancedStreamingMessageParser } from '~/lib/runtime/enhanced-message-parser';
import { workbenchStore } from '~/lib/stores/workbench';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('useMessageParser');

const messageParser = new EnhancedStreamingMessageParser({
  callbacks: {
    onArtifactOpen: (data) => {
      logger.trace('onArtifactOpen', data);

      workbenchStore.showWorkbench.set(true);
      workbenchStore.addArtifact(data);
    },
    onArtifactClose: (data) => {
      logger.trace('onArtifactClose');

      workbenchStore.updateArtifact(data, { closed: true });
    },
    onActionOpen: (data) => {
      logger.trace('onActionOpen', data.action);

      /*
       * File actions are streamed, so we add them immediately to show progress
       * Shell actions are complete when created by enhanced parser, so we wait for close
       */
      if (data.action.type === 'file') {
        workbenchStore.addAction(data);
      }
    },
    onActionClose: (data) => {
      logger.trace('onActionClose', data.action);

      /*
       * Add non-file actions (shell, build, start, etc.) when they close
       * Enhanced parser creates complete shell actions, so they're ready to execute
       */
      if (data.action.type !== 'file') {
        workbenchStore.addAction(data);
      }

      workbenchStore.runAction(data);
    },
    onActionStream: (data) => {
      logger.trace('onActionStream', data.action);
      workbenchStore.runAction(data, true);
    },
  },
});
const extractTextContent = (message: UIMessage) => {
  // UIMessage v7 uses parts array
  if (Array.isArray(message.parts)) {
    const textPart = message.parts.find((part) => part.type === 'text');
    return (textPart && 'text' in textPart ? textPart.text : '') || '';
  }
  // Fallback for content (legacy)
  const content = (message as any).content;
  if (typeof content === 'string') {
    return content;
  }
  if (Array.isArray(content)) {
    return (content.find((item: any) => item.type === 'text')?.text as string) || '';
  }
  return '';
};

export function useMessageParser() {
  const [parsedMessages, setParsedMessages] = useState<{ [key: number]: string }>({});
  const lastChatModeRef = useRef<'discuss' | 'build' | undefined>(undefined);

  const parseMessages = useCallback((messages: UIMessage[], isLoading: boolean, chatMode?: 'discuss' | 'build') => {
    let reset = false;

    /*
     * RACE CONDITION FIX: When the chatMode changes, the parser must be
     * reset and all messages re-parsed from scratch. Without this, the
     * first message(s) get parsed with the default 'build' mode (which
     * auto-wraps bash code blocks as artifacts), and the mode switch
     * arrives too late — the parser is stateful and only processes NEW
     * content from its internal position cursor, so it never re-visits
     * the already-parsed content.
     */
    if (chatMode !== lastChatModeRef.current) {
      logger.debug(`[parser] Chat mode changed: ${lastChatModeRef.current} → ${chatMode}, resetting parser`);
      lastChatModeRef.current = chatMode;
      reset = true;
      messageParser.reset();
      setParsedMessages({}); // Clear all parsed content so it gets re-parsed
    }

    if (import.meta.env.DEV && !isLoading) {
      reset = true;
      messageParser.reset();
    }

    /*
     * Sync the chat mode to the parser so it knows whether to
     * auto-wrap code blocks as artifacts (build mode) or leave
     * them as plain markdown (discuss mode). Default to 'build'
     * for backward compatibility if no mode is passed.
     */
    messageParser.setChatMode(chatMode || 'build');

    for (const [index, message] of messages.entries()) {
      if (message.role === 'assistant' || message.role === 'user') {
        const newParsedContent = messageParser.parse(message.id, extractTextContent(message));
        setParsedMessages((prevParsed) => ({
          ...prevParsed,
          [index]: !reset ? (prevParsed[index] || '') + newParsedContent : newParsedContent,
        }));
      }
    }
  }, []);

  return { parsedMessages, parseMessages };
}
