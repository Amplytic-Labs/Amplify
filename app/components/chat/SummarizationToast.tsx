import { memo, useEffect, useRef } from 'react';
import { toast } from '~/components/ui/toast';

/**
 * SummarizationToast
 *
 * Surfaces a non-intrusive toast the moment the server finishes condensing a
 * conversation (i.e. when a fresh `chatSummary` message annotation lands on
 * the last assistant message).
 *
 * Now uses the premium iPhone-style toast stack instead of react-toastify.
 */
interface SummarizationToastProps {
  messages?: any[];
}

export const SummarizationToast = memo(({ messages }: SummarizationToastProps) => {
  const toastedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!messages || messages.length === 0) {
      return;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (msg.role !== 'assistant') {
        continue;
      }

      const annotations: any[] | undefined = msg.annotations;

      if (!annotations) {
        break;
      }

      const summaryAnn = annotations.find((a: any) => a?.type === 'chatSummary' && a?.summary);

      if (summaryAnn) {
        const key = `${msg.id}:${summaryAnn.chatId || ''}`;

        if (toastedRef.current.has(key)) {
          break;
        }

        toastedRef.current.add(key);

        if (toastedRef.current.size > 20) {
          const arr = Array.from(toastedRef.current);
          toastedRef.current = new Set(arr.slice(-10));
        }

        const summaryLen = typeof summaryAnn.summary === 'string' ? summaryAnn.summary.length : 0;
        const savedEstimate = Math.max(0, Math.round(summaryLen > 0 ? 8000 - summaryLen / 4 : 6000));

        toast.info('Conversation condensed', {
          description: `Older messages were summarized to fit the model's context window${savedEstimate > 0 ? ` (~${(savedEstimate / 1000).toFixed(1)}k tokens freed)` : ''}`,
          autoClose: 5000,
          icon: 'shield',
        });

        break;
      }

      break;
    }
  }, [messages]);

  return null;
});

SummarizationToast.displayName = 'SummarizationToast';
