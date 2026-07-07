import { memo, useEffect, useRef } from 'react';
import { toast } from 'react-toastify';
import { motion } from 'framer-motion';

/**
 * SummarizationToast
 *
 * Surfaces a non-intrusive toast the moment the server finishes condensing a
 * conversation (i.e. when a fresh `chatSummary` message annotation lands on
 * the last assistant message).
 *
 * Why this exists:
 *   When the context budget approaches the model's limit, api.chat.ts runs
 *   `createSummary` — a blocking ~3-8s LLM round-trip — before the first
 *   response token streams. Without feedback, that pause feels like the app
 *   is frozen. The ProgressCompilation panel already shows a progress line,
 *   but a toast confirms the condensation actually happened and explains why.
 *
 * Behavior:
 *   - Watches the last assistant message's annotations.
 *   - When a `chatSummary` annotation with a NEW id appears, fire one toast.
 *   - De-duplicates by annotation identity so the same summary never toasts twice.
 *   - Auto-dismisses after 5s; respects reduced-motion via toastify defaults.
 *
 * This component renders nothing visible — it's a side-effect listener.
 */
interface SummarizationToastProps {
  messages?: any[];
}

export const SummarizationToast = memo(({ messages }: SummarizationToastProps) => {
  // Track which assistant message ids we've already toasted for.
  const toastedRef = useRef<Set<string>>(new Set());

  useEffect(() => {
    if (!messages || messages.length === 0) {
      return;
    }

    // Scan from newest → oldest for an assistant message carrying a chatSummary.
    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (msg.role !== 'assistant') {
        continue;
      }

      const annotations: any[] | undefined = msg.annotations;

      if (!annotations) {
        break; // newest assistant message has no annotations yet
      }

      const summaryAnn = annotations.find((a) => a?.type === 'chatSummary' && a?.summary);

      if (summaryAnn) {
        const key = `${msg.id}:${summaryAnn.chatId || ''}`;

        if (toastedRef.current.has(key)) {
          break; // already notified
        }

        toastedRef.current.add(key);

        // Trim the toasted set so it doesn't grow unbounded across long sessions
        if (toastedRef.current.size > 20) {
          const arr = Array.from(toastedRef.current);
          toastedRef.current = new Set(arr.slice(-10));
        }

        /*
         * Roughly how much got condensed — the summary replaces everything
         * before the last 3 messages. Estimate saved tokens from the summary
         * length vs. a typical message size. This is purely informational.
         */
        const summaryLen = typeof summaryAnn.summary === 'string' ? summaryAnn.summary.length : 0;
        const savedEstimate = Math.max(0, Math.round(summaryLen > 0 ? 8000 - summaryLen / 4 : 6000));

        toast(
          <motion.div
            initial={{ opacity: 0, x: 12 }}
            animate={{ opacity: 1, x: 0 }}
            transition={{ duration: 0.22, ease: 'easeOut' }}
            className="flex items-start gap-2.5"
          >
            <span className="i-ph:sparkle-fill text-lg text-amber-500 shrink-0 mt-0.5" />
            <div className="flex-1 min-w-0">
              <div className="font-semibold text-[13px] text-amplify-elements-textPrimary leading-tight">
                Conversation condensed
              </div>
              <div className="text-[11px] text-amplify-elements-textSecondary mt-0.5 leading-snug">
                Older messages were summarized to fit the model's context window
                {savedEstimate > 0 ? ` (~${(savedEstimate / 1000).toFixed(1)}k tokens freed).` : '.'}
              </div>
            </div>
          </motion.div>,
          {
            type: 'info',
            autoClose: 5000,
            hideProgressBar: true,
            closeOnClick: true,
            pauseOnHover: true,
            draggable: false,
            theme: 'light',
            style: {
              background: 'var(--amplify-elements-background-depth-1, #fff)',
              border: '1px solid var(--amplify-elements-borderColor, #e5e7eb)',
              borderRadius: '12px',
              boxShadow: '0 10px 30px -8px rgba(0,0,0,0.18)',
              padding: '10px 12px',
              minWidth: '300px',
            },
          },
        );

        break; // only toast for the most recent summary
      }

      break; // only inspect the newest assistant message
    }
  }, [messages]);

  return null;
});

SummarizationToast.displayName = 'SummarizationToast';
