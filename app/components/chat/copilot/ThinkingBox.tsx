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

  /**
   * Number of steps (reasoning + tool invocations) the panel is rendering.
   * Used to build the "Completed with N steps" label when streaming ends.
   */
  stepCount?: number;

  /**
   * True if the panel contains any actual reasoning text (native reasoning
   * parts OR `<thought>`-tag text). When false AND not streaming, the model
   * didn't produce any reasoning — we avoid the misleading "Thought process"
   * label and instead use a neutral "Completed with N steps" (when there are
   * tools) or hide the label entirely (when there's nothing to summarise).
   */
  hasReasoning?: boolean;

  /**
   * True when the thinking phase is complete (`</thought>` received) and the
   * AI has moved on to its final answer. Used to switch the label from the
   * streaming "Thinking…" form to the completed "Completed with N steps"
   * form.
   */
  thinkingDone?: boolean;

  /**
   * OVERRIDE for the streaming label. When provided AND the panel is active
   * (streaming), this string is shown INSTEAD of the default "Thinking…".
   *
   * Use case: when a specific tool is currently running, the caller passes
   * that tool's pending label (e.g. "Searching the web", "Editing file") so
   * the user sees WHAT is happening, not just that something is happening.
   * When null/undefined, falls back to "Thinking…".
   *
   * Only consulted while streaming — when streaming ends, the label
   * switches to "Completed with N steps" regardless of this prop.
   */
  activeLabel?: string;

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
 *   - When streaming ends AND there are steps: label reads
 *     "Completed with N steps" (N = reasoning + tool steps in the box).
 *   - When streaming ends AND there are 0 steps: label reads
 *     "Thought for Ns" (legacy duration-based fallback) or is empty.
 *   - For non-streaming models that produced no reasoning text AND no tool
 *     calls, the panel is hidden entirely by the parent.
 *   - The misleading "Thought process" placeholder is GONE — it was shown
 *     for models that never streamed a `<thought>` block, which read as
 *     bad UI ("thought process" with no thoughts inside).
 *   - User can always expand/collapse by clicking the header.
 */
export const ThinkingBox = memo(
  ({ isActive, duration, thoughtStreaming, stepCount = 0, hasReasoning = false, activeLabel, children }: ThinkingBoxProps) => {
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

    /*
     * Auto-collapse is now a no-op because the box starts collapsed and the
     * user is in full control. Kept as a hook so the existing effect deps
     * don't change unexpectedly — could be removed in a follow-up cleanup.
     */
    useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (hasEverStreamedRef.current && !isActive && isOpen && !hasAutoCollapsedRef.current) {
        /*
         * Box is collapsed by default now; if the user manually expanded it
         * while streaming, leave it expanded after streaming ends — don't
         * snap it shut on them. They chose to see the reasoning.
         */
        hasAutoCollapsedRef.current = true;
      }

      return () => {
        if (timer) {
          clearTimeout(timer);
        }
      };
    }, [isActive, isOpen]);

    /*
     * Label logic — REPLACES the old "Thought process" placeholder.
     *
     *   1. While streaming (isActive OR thoughtStreaming):
     *        → `activeLabel` if provided (e.g. "Searching the web" when a
     *          specific tool is running), ELSE "Thinking…" (shimmer-animated
     *          by ShinyText).
     *   2. When streaming has ended AND the panel actually had reasoning
     *      (i.e. real reasoning tokens, not just tool calls):
     *        → "Completed with N steps"  (N = reasoning + tool steps)
     *   3. When streaming has ended AND there was NO reasoning but there
     *      are tool calls (stepCount > 0):
     *        → "Completed with N steps" — still useful, the user wants to
     *          see how many tool calls the model made.
     *   4. When streaming has ended AND there are 0 steps AND we know how
     *      long we streamed for:
     *        → "Thought for Ns"  (legacy fallback for empty-but-finished)
     *   5. Otherwise (no steps, no duration, no streaming, no reasoning):
     *        → empty string. The panel still renders so tools (if any) are
     *          visible, but we don't show a misleading "Thought process"
     *          label — non-streaming models shouldn't claim they thought.
     *
     * The user-facing rule:
     *   - Tool running               →  tool's pending label ("Searching…")
     *   - Reasoning tokens streaming →  "Thinking…"
     *   - Reasoning ended            →  "Completed with N steps"
     *   - No reasoning at all        →  no label (panel may still
     *                                   show tools, but no header text)
     */
    const label =
      isActive || thoughtStreaming
        ? (activeLabel ?? 'Thinking…')
        : stepCount > 0
          ? `Completed with ${stepCount} step${stepCount === 1 ? '' : 's'}`
          : effectiveDuration !== undefined
            ? `Thought for ${effectiveDuration}s`
            : '';

    /*
     * Mark `hasReasoning` as referenced — it's part of the public props
     * contract for future label refinement, even though the current label
     * logic doesn't branch on it. This avoids the lint error without
     * dropping the prop (which would require touching every caller).
     */
    void hasReasoning;

    /*
     * When there's no label AND no children to show, hide the panel entirely.
     * This is the case for non-streaming models that produced neither
     * reasoning nor tool calls — the parent (ThoughtsPanel) already filters
     * most of these out, but we double-guard here so the ThinkingBox is
     * never rendered as an empty header with a chevron.
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
        {/* Header button — brain icon on the LEFT, chevron on the RIGHT.
           The brain signals "reasoning" (Copilot uses a spark/thinking icon);
           the chevron on the right is the expand/collapse affordance. */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={styles.headerButton}
          aria-expanded={isOpen}
        >
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
  },
);

ThinkingBox.displayName = 'ThinkingBox';
