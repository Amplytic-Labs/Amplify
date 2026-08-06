import type { UIMessage } from 'ai';
import { Fragment, forwardRef, memo, useCallback } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { useLocation } from '@remix-run/react';
import { useMemo } from 'react';
import { db, chatId } from '~/lib/persistence/useChatHistory';
import { forkChat } from '~/lib/persistence/db';
import { toast } from '~/components/ui/toast';
import type { ForwardedRef } from 'react';
import type { ProviderInfo } from '~/types/model';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: UIMessage[];
  append?: (message: UIMessage) => void;

  /** Regenerate handler — only the last assistant message receives this. */
  onRegenerate?: () => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

export const Messages = memo(
  forwardRef<HTMLDivElement, MessagesProps>((props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
    const { id, isStreaming = false, messages = [] } = props;
    const location = useLocation();

    const handleRewind = useCallback(
      (messageId: string) => {
        const searchParams = new URLSearchParams(location.search);
        searchParams.set('rewindTo', messageId);

        /*
         * Full page navigation for rewind — ensures the workspace and
         * message list are rebuilt cleanly from IndexedDB with the rewind
         * point applied. Consistent with the project-wide policy that
         * every URL change triggers a full load.
         */
        window.location.href = `${location.pathname}?${searchParams.toString()}`;
      },
      [location],
    );

    const handleFork = useCallback(async (messageId: string) => {
      try {
        if (!db || !chatId.get()) {
          toast.error('Chat persistence is not available');
          return;
        }

        const urlId = await forkChat(db, chatId.get()!, messageId);

        /*
         * Full page navigation to the forked chat — ensures the
         * workspace, files, and auto-setup are all rebuilt for the
         * new chat from IndexedDB.
         */
        window.location.href = `/chat/${urlId}`;
      } catch (error) {
        toast.error('Failed to fork chat: ' + (error as Error).message);
      }
    }, []);

    const groupedMessages = useMemo(() => {
      const result: UIMessage[] = [];

      for (const msg of messages) {
        if (msg.role === 'assistant' && result.length > 0) {
          const last = result[result.length - 1];

          if (last.role === 'assistant') {
            // Merge parts, deduplicating identical text parts from retries
            const mergedParts = [...(last.parts || [])];

            for (const part of msg.parts || []) {
              if (part.type === 'text') {
                // Check if we already have this exact text part
                const isDuplicate = mergedParts.some((p) => p.type === 'text' && p.text.trim() === part.text.trim());

                if (isDuplicate && part.text.trim() !== '') {
                  continue;
                }
              }

              mergedParts.push(part);
            }

            // Merge annotations
            const lastAnnotations = (last as any).annotations || [];
            const msgAnnotations = (msg as any).annotations || [];
            const mergedAnnotations = [...lastAnnotations, ...msgAnnotations];

            result[result.length - 1] = {
              ...last,
              id: msg.id, // Use the latest ID for rewind/fork
              parts: mergedParts,
              annotations: mergedAnnotations,
            } as UIMessage;
            continue;
          }
        }

        // Deep copy parts to avoid mutating the original message array
        result.push({
          ...msg,
          parts: msg.parts ? [...msg.parts] : undefined,
        } as UIMessage);
      }

      return result;
    }, [messages]);

    return (
      <div id={id} className={props.className} ref={ref}>
        {groupedMessages.length > 0
          ? groupedMessages.map((message, index) => {
              const { role, id: messageId, parts } = message;

              // Extract text content from parts (UIMessage v7) or fallback to content (legacy)
              const content = Array.isArray(parts)
                ? parts
                    .filter((p): p is { type: 'text'; text: string } => p.type === 'text')
                    .map((p) => p.text)
                    .join('')
                : (message as any).content || '';

              // Get annotations - may be on the message directly or in parts
              const annotations = (message as any).annotations;
              const isUserMessage = role === 'user';
              const isFirst = index === 0;
              const isHidden = Array.isArray(annotations) && annotations.includes('hidden');

              if (isHidden) {
                return <Fragment key={index} />;
              }

              return (
                <div
                  key={index}
                  className={classNames('flex gap-4 py-3 w-full rounded-lg', {
                    'mt-4': !isFirst,
                  })}
                >
                  <div className="grid grid-col-1 w-full">
                    {isUserMessage ? (
                      <UserMessage content={content} parts={parts as any} />
                    ) : (
                      <AssistantMessage
                        content={content}
                        annotations={annotations}
                        messageId={messageId}
                        onRewind={handleRewind}
                        onFork={handleFork}
                        append={props.append}
                        onRegenerate={
                          !isUserMessage && index === groupedMessages.length - 1 ? props.onRegenerate : undefined
                        }
                        chatMode={props.chatMode}
                        setChatMode={props.setChatMode}
                        model={props.model}
                        provider={props.provider}
                        parts={parts as any}
                        addToolResult={props.addToolResult}
                        isStreaming={isStreaming && index === groupedMessages.length - 1}
                      />
                    )}
                  </div>
                </div>
              );
            })
          : null}
      </div>
    );
  }),
);
