import { memo, useState, useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import styles from './chat-copilot.module.scss';
import ShinyText from '~/components/ui/Shimmer';

interface ThinkingBoxProps {
  /** True while the panel is actively streaming (drives shimmer + auto-collapse). */
  isActive: boolean;

  /** Optional duration in seconds — when set, the collapsed label reads "Thought for Ns". */
  duration?: number;

  /** True if a `<thought>` block is still streaming (no close tag yet). */
  thoughtStreaming?: boolean;

  /** The panel content (reasoning text + tool invocations). */
  children: ReactNode;
}

/**
 * Copilot-exact `.chat-thinking-box`.
 *
 * A single collapsible panel that holds reasoning + tool invocations. The
 * header is a flat button with a chevron + a label that shimmers while the
 * panel is active. When expanded, a curved connector line joins the header
 * to the first item — exactly like VS Code Copilot.
 *
 * Behaviour:
 *   - Collapsed by default (the user explicitly opts in to see reasoning by
 *     clicking the header). This was changed from "open while streaming"
 *     because users reported the reasoning block dominating the chat.
 *   - While streaming: label reads "Thinking…" with shimmer (even when
 *     collapsed) so the user knows work is happening.
 *   - When streaming ends: label reads "Thought for Ns".
 *   - User can always expand/collapse by clicking the header.
 */
export const ThinkingBox = memo(({ isActive, duration, thoughtStreaming, children }: ThinkingBoxProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const startTimeRef = useRef<number | null>(null);
  const hasEverStreamedRef = useRef(false);
  const hasAutoCollapsedRef = useRef(false);
  const [effectiveDuration, setEffectiveDuration] = useState<number | undefined>(duration);

  // Track when streaming starts/ends so we can compute the "Thought for Ns" duration.
  useEffect(() => {
    if (isActive) {
      hasEverStreamedRef.current = true;

      if (startTimeRef.current === null) {
        startTimeRef.current = Date.now();
      }
    } else if (startTimeRef.current !== null) {
      setEffectiveDuration(Math.max(1, Math.ceil((Date.now() - startTimeRef.current) / 1000)));
      startTimeRef.current = null;
    }
  }, [isActive]);

  // Auto-collapse is now a no-op because the box starts collapsed and the
  // user is in full control. Kept as a hook so the existing effect deps
  // don't change unexpectedly — could be removed in a follow-up cleanup.
  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | undefined;

    if (hasEverStreamedRef.current && !isActive && isOpen && !hasAutoCollapsedRef.current) {
      // Box is collapsed by default now; if the user manually expanded it
      // while streaming, leave it expanded after streaming ends — don't
      // snap it shut on them. They chose to see the reasoning.
      hasAutoCollapsedRef.current = true;
    }

    return () => {
      if (timer) {
        clearTimeout(timer);
      }
    };
  }, [isActive, isOpen]);

  const label =
    isActive || thoughtStreaming
      ? 'Thinking…'
      : effectiveDuration !== undefined
        ? `Thought for ${effectiveDuration}s`
        : 'Thought process';

  return (
    <div
      className={classNames(
        styles.chatThinkingBox,
        isActive && styles.thinkingActive,
        !isOpen && styles.thinkingCollapsed,
      )}
    >
      {/* Header button — brain icon on the LEFT, chevron on the RIGHT.
           The brain signals "reasoning" (Copilot uses a spark/thinking icon);
           the chevron on the right is the expand/collapse affordance. */}
      <button type="button" onClick={() => setIsOpen((v) => !v)} className={styles.headerButton} aria-expanded={isOpen}>
        <span className={classNames(styles.brainIcon, 'i-ph:brain')} aria-hidden />

        {/* <span className={styles.label}>{label}</span> */}
        <ShinyText text={label} loading={isActive || thoughtStreaming} />
        <span className={classNames(styles.chevron, isOpen ? styles.open : styles.closed, 'i-ph:caret-down-bold')} />
      </button>

      {/* Collapsible list (with curved connector drawn by ::after) */}
      <AnimatePresence initial={false}>
        {isOpen && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 32 } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeInOut' } }}
            style={{ overflow: 'hidden' }}
            className="mt-1"
          >
            <div className={styles.collapsibleList}>{children}</div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

ThinkingBox.displayName = 'ThinkingBox';
