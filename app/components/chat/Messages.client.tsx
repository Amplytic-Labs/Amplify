import type { Message } from 'ai';
import { Fragment, forwardRef, memo, useCallback } from 'react';
import { classNames } from '~/utils/classNames';
import { AssistantMessage } from './AssistantMessage';
import { UserMessage } from './UserMessage';
import { useLocation, useNavigate } from '@remix-run/react';
import { db, chatId } from '~/lib/persistence/useChatHistory';
import { forkChat } from '~/lib/persistence/db';
import { toast } from 'react-toastify';
import type { ForwardedRef } from 'react';
import type { ProviderInfo } from '~/types/model';

interface MessagesProps {
  id?: string;
  className?: string;
  isStreaming?: boolean;
  messages?: Message[];
  append?: (message: Message) => void;
  /** Regenerate handler — only the last assistant message receives this. */
  onRegenerate?: () => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

export const Messages = memo(
  forwardRef<HTMLDivElement, MessagesProps>(
    (props: MessagesProps, ref: ForwardedRef<HTMLDivElement> | undefined) => {
      const { id, isStreaming = false, messages = [] } = props;
      const location = useLocation();
      const navigate = useNavigate();

      const handleRewind = useCallback(
        (messageId: string) => {
          const searchParams = new URLSearchParams(location.search);
          searchParams.set('rewindTo', messageId);

          /*
           * Client-side navigation for rewind — preserves the WebContainer +
           * workspace state (no full page refresh, no file re-inject / dev-server
           * restart). useChatHistory re-runs for the new search params and slices
           * the message list to the rewind point without reloading files when the
           * same project is already loaded.
           */
          navigate(`${location.pathname}?${searchParams.toString()}`);
        },
        [location, navigate],
      );

      const handleFork = useCallback(
        async (messageId: string) => {
          try {
            if (!db || !chatId.get()) {
              toast.error('Chat persistence is not available');
              return;
            }

            const urlId = await forkChat(db, chatId.get()!, messageId);

            /*
             * Client-side navigation to the forked chat — preserves the
             * WebContainer + workspace state (no full page refresh) so the dev
             * server keeps running and files aren't re-injected.
             */
            navigate(`/chat/${urlId}`);
          } catch (error) {
            toast.error('Failed to fork chat: ' + (error as Error).message);
          }
        },
        [navigate],
      );

    return (
      <div id={id} className={props.className} ref={ref}>
        {messages.length > 0
          ? messages.map((message, index) => {
              const { role, content, id: messageId, annotations, parts } = message;
              const isUserMessage = role === 'user';
              const isFirst = index === 0;
              const isHidden = annotations?.includes('hidden');

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
                      <UserMessage content={content} parts={parts} />
                    ) : (
                      <AssistantMessage
                        content={content}
                        annotations={message.annotations}
                        messageId={messageId}
                        onRewind={handleRewind}
                        onFork={handleFork}
                        append={props.append}
                        onRegenerate={
                          !isUserMessage && index === messages.length - 1
                            ? props.onRegenerate
                            : undefined
                        }
                        chatMode={props.chatMode}
                        setChatMode={props.setChatMode}
                        model={props.model}
                        provider={props.provider}
                        parts={parts}
                        addToolResult={props.addToolResult}
                        isStreaming={isStreaming && index === messages.length - 1}
                      />
                    )}
                  </div>
                </div>
              );
            })
          : null}
      </div>
    );
    },
  ),
);
