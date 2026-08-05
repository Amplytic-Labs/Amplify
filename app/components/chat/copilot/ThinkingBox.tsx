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
 *        → "Reasoning" (simple, non-timing label). The panel header
 *          remains visible so the user can click to expand and review
 *          the reasoning. Previously this was an empty string, which
 *          made the header invisible and users thought the reasoning
 *          had "disappeared".
 *
 * EXPAND/COLLAPSE BEHAVIOUR:
 *   - Auto-EXPANDS when streaming starts (so the user sees reasoning
 *     + tool progress as it arrives).
 *   - Auto-COLLAPSES when streaming ends (clean UI, but header stays
 *     visible with "Reasoning" label for review).
 *   - If the user manually toggles during streaming, their choice is
 *     respected (no fighting the auto-expand/collapse).
 */
export const ThinkingBox = memo(
  ({ isActive, thoughtStreaming, stepCount = 0, hasReasoning = false, activeLabel, children }: ThinkingBoxProps) => {
    const [isOpen, setIsOpen] = useState(false);
    const wasStreamingRef = useRef(false);
    const userToggledRef = useRef(false);

    /*
     * Mark unused props as referenced — they're part of the public props
     * contract for future label refinement, even though the current label
     * logic doesn't branch on them.
     */
    void stepCount;
    void hasReasoning;

    /*
     * AUTO-EXPAND while streaming, AUTO-COLLAPSE when streaming ends.
     *
     * Behaviour:
     *   - When streaming starts (isActive becomes true): auto-EXPAND the
     *     panel so the user can see reasoning + tool progress as it
     *     arrives. (Previously the panel was collapsed by default and the
     *     user had to manually click to see anything — they perceived the
     *     hidden reasoning as "disappeared".)
     *   - When streaming ends (isActive becomes false): auto-COLLAPSE the
     *     panel. The header remains visible (brain icon + label) so the
     *     user can click to re-expand and review the reasoning.
     *   - If the user manually toggles the panel while streaming, we
     *     respect their choice and don't fight them (userToggledRef).
     */
    useEffect(() => {
      const isStreaming = isActive || thoughtStreaming;

      if (isStreaming && !wasStreamingRef.current) {
        // Streaming just started — auto-expand (unless user already toggled).
        if (!userToggledRef.current) {
          setIsOpen(true);
        }

        wasStreamingRef.current = true;
      } else if (!isStreaming && wasStreamingRef.current) {
        // Streaming just ended — auto-collapse (unless user toggled during streaming).
        if (!userToggledRef.current) {
          setIsOpen(false);
        }

        wasStreamingRef.current = false;
      }
    }, [isActive, thoughtStreaming]);

    const handleToggle = () => {
      userToggledRef.current = true;
      setIsOpen((v) => !v);
    };

    /*
     * Label logic — Copilot-faithful, no "Thought for Ns".
     *
     *   - Streaming (active or thought-streaming):
     *       → activeLabel if provided (e.g. "Searching the web"), else "Thinking…"
     *   - Done:
     *       → "Reasoning" (simple, non-timing label so the user knows the
     *         panel exists and can click to expand). Previously this was
     *         an empty string, which made the panel header invisible and
     *         the user thought the reasoning "disappeared".
     */
    const label = isActive || thoughtStreaming ? (activeLabel ?? 'Thinking…') : 'Reasoning';

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
        <button type="button" onClick={handleToggle} className={styles.headerButton} aria-expanded={isOpen}>
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
