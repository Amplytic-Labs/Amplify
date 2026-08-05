import { memo, useState, useEffect, useRef, type ReactNode } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import styles from './chat-copilot.module.scss';
import ShinyText from '~/components/ui/Shimmer';

interface ThinkingBoxProps {
  /** True while the panel is actively streaming (drives shimmer). */
  isActive: boolean;

  /** True if the panel's reasoning is still streaming in. */
  thoughtStreaming?: boolean;

  /**
   * Number of steps (reasoning + tool invocations) the panel is rendering.
   * Reserved for future use; currently not displayed in the label.
   */
  stepCount?: number;

  /**
   * True if the panel contains any actual reasoning text. Reserved for
   * future use; currently not displayed in the label.
   */
  hasReasoning?: boolean;

  /**
   * True when the thinking phase is complete (streaming ended, all tools
   * finished). When true AND not active, the panel collapses silently —
   * no "Thought for Ns" label is shown (removed per user request).
   */
  thinkingDone?: boolean;

  /**
   * OVERRIDE for the streaming label. When provided AND the panel is
   * active (streaming), this string is shown INSTEAD of the default
   * "Thinking…".
   *
   * Use case: when a specific tool is currently running, the caller passes
   * that tool's pending label (e.g. "Searching the web", "Editing file")
   * so the user sees WHAT is happening. When null/undefined, falls back
   * to "Thinking…".
   *
   * Only consulted while streaming — when streaming ends, the label is
   * empty (the panel collapses silently).
   */
  activeLabel?: string;

  /** The panel content (reasoning text + tool invocations). */
  children: ReactNode;
}

/**
 * Copilot-faithful `.chat-thinking-box`.
 *
 * A single collapsible panel that holds reasoning + tool invocations. The
 * header is a flat button with a brain icon + a label that shimmers while
 * the panel is active. When expanded, a curved connector line joins the
 * header to the first item — exactly like VS Code Copilot.
 *
 * LABEL RULES (per user request — "Thought for Ns" removed):
 *
 *   1. While streaming (isActive OR thoughtStreaming):
 *        → `activeLabel` if provided (e.g. "Searching the web" when a
 *          specific tool is running), ELSE "Thinking…" (shimmer-animated
 *          by ShinyText).
 *   2. When streaming has ended:
 *        → empty string. The panel still renders so tools (if any) are
 *          visible, but no header text is shown. The user can expand/
 *          collapse manually via the chevron.
 *
 * The previous "Completed with N steps" / "Thought for Ns" labels have
 * been removed — the user explicitly asked for the time-based label to go,
 * and the step-count label was redundant (the user can see the steps by
 * expanding the panel).
 *
 * Behaviour:
 *   - Collapsed by default (user opts in to see reasoning by clicking).
 *   - While streaming: label reads "Thinking…" (or activeLabel) with
 *     shimmer, even when collapsed.
 *   - When streaming ends: label is empty.
 *   - For non-streaming models that produced no reasoning AND no tool
 *     calls, the parent (ThoughtsPanel) hides the panel entirely.
 */
export const ThinkingBox = memo(
  ({ isActive, thoughtStreaming, stepCount = 0, hasReasoning = false, activeLabel, children }: ThinkingBoxProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const hasAutoCollapsedRef = useRef(false);

    /*
     * Mark unused props as referenced — they're part of the public props
     * contract for future label refinement, even though the current label
     * logic doesn't branch on them.
     */
    void stepCount;
    void hasReasoning;

    /*
     * Auto-collapse is now a no-op because the box starts collapsed and the
     * user is in full control. Kept as a hook so the existing effect deps
     * don't change unexpectedly — could be removed in a follow-up cleanup.
     */
    useEffect(() => {
      if (hasAutoCollapsedRef.current) {
        return;
      }

      if (!isActive) {
        /*
         * Box is collapsed by default now; if the user manually expanded
         * it while streaming, leave it expanded after streaming ends —
         * don't snap it shut on them. They chose to see the reasoning.
         */
        hasAutoCollapsedRef.current = true;
      }
    }, [isActive]);

    /*
     * Label logic — Copilot-faithful, no "Thought for Ns".
     *
     *   - Streaming (active or thought-streaming):
     *       → activeLabel if provided, else "Thinking…"
     *   - Done:
     *       → empty string (panel collapses silently, just shows the
     *         chevron + brain icon; user can expand to review steps).
     */
    const label = isActive || thoughtStreaming ? (activeLabel ?? 'Thinking…') : '';

    /*
     * When there's no label AND no children to show, hide the panel entirely.
     */
    if (!label && !children) {
      return null;
    }

    return (
      <div
        className={classNames(
          styles.chatThinkingBox,
          isActive && styles.thinkingActive,
          !isOpen && styles.thinkingCollapsed,
        )}
      >
        {/* Header button — brain icon on the LEFT, chevron on the RIGHT. */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={styles.headerButton}
          aria-expanded={isOpen}
        >
          <span className={classNames(styles.brainIcon, 'i-ph:brain')} aria-hidden />

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
  },
);

ThinkingBox.displayName = 'ThinkingBox';
