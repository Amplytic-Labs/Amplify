import { memo, useMemo } from 'react';
import { classNames } from '~/utils/classNames';
import { ToolProgress, getToolIcon, classifyResult } from './ToolProgress';
import { ThinkingBox } from './ThinkingBox';
import { ReasoningMarkdown } from '~/components/chat/ReasoningMarkdown';
import type { TextUIPart, ReasoningUIPart, SourceUIPart, FileUIPart, StepStartUIPart } from '@ai-sdk/ui-utils';
import { isToolPart, getToolNameFromPart, getToolCallId, getToolState, getToolOutput } from '~/lib/chat/tool-parts';
import styles from './chat-copilot.module.scss';

/**
 * A single renderable step inside the thinking box. We flatten the message
 * parts (reasoning + tool-invocation) into an ordered list of steps so the
 * UI can interleave them like Copilot does.
 *
 * Each step renders as a NODE on the vertical chain-of-thought line —
 * exactly like VS Code Copilot's `.chat-thinking-collapsible`:
 *   .chat-thinking-item.markdown-content  (reasoning — book icon)
 *   .chat-thinking-tool-wrapper           (tool — tool-type icon)
 *   .chat-thinking-spinner-item           (working — spinner icon)
 */
type ThoughtStep = { kind: 'reasoning'; text: string; key: string } | { kind: 'tool'; item: any; key: string };

interface ThoughtsPanelProps {
  /** Native reasoning + tool-invocation parts from the AI SDK (this segment only). */
  parts: (TextUIPart | ReasoningUIPart | SourceUIPart | FileUIPart | StepStartUIPart | any)[] | undefined;

  /** True when this is the streaming message and we're still producing parts. */
  isStreaming?: boolean;

  /** Required so tool approval can call back into the chat runner. */
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;

  /**
   * Override for the streaming label. When provided AND the panel is
   * streaming, shows this string INSTEAD of "Thinking…".
   *
   * Computed by the caller via `getActiveChainLabel()`.
   */
  activeLabel?: string;

  /**
   * Message ID — used to scope the per-message dedup state (toolCallId +
   * reasoning text) so multiple chain panels in the same message don't
   * each accept the same reasoning text or the same toolCallId as "new".
   *
   * Without this, a `step-start` boundary (or any chain break) would
   * create a new panel with its own fresh dedup state, and the SDK
   * re-emitting the same reasoning text after the break would render
   * AGAIN inside the new panel — causing the visible duplication the
   * user reported ("same chain or reasoning block repeats multiple
   * times").
   */
  messageId?: string;
}

/*
 * ===========================================================================
 * PER-MESSAGE DEDUP STATE
 * ===========================================================================
 *
 * Module-level Map keyed by messageId. Each entry holds:
 *   - toolIndexById: toolCallId → step key. When the same toolCallId
 *     appears in a later segment (e.g. after a step-start re-emits the
 *     tool's output-available state), we walk back to the ORIGINAL step
 *     and replace its item in-place instead of pushing a duplicate.
 *   - seenReasoning: Set of reasoning text hashes. If the SDK re-emits
 *     the same reasoning text after a chain break, the new panel rejects
 *     it as a duplicate.
 *
 * This state is shared across ALL ThoughtsPanel instances rendered for
 * the same message — so a chain broken by `text` into [chain₁, text,
 * chain₂] still dedupes against the same Maps.
 *
 * The Map is unbounded in principle but in practice each chat has a
 * finite number of messages, and each message is GC'd when the chat
 * unmounts. We could add an LRU cap if memory becomes a concern.
 */
interface MessageDedupState {
  toolIndexByKey: Map<string, string>; // toolCallId → step key
}

const messageDedupState = new Map<string, MessageDedupState>();

function getDedupState(messageId: string | undefined): MessageDedupState {
  if (!messageId) {
    /*
     * No messageId available (legacy / ephemeral render). Use a transient
     * state that won't be shared — same behaviour as before the fix.
     */
    return { toolIndexByKey: new Map() };
  }

  let state = messageDedupState.get(messageId);

  if (!state) {
    state = { toolIndexByKey: new Map() };
    messageDedupState.set(messageId, state);
  }

  return state;
}

/**
 * Copilot-faithful collapsible "Thinking…" panel with the chain-of-thought
 * vertical line + step icons.
 *
 * Wraps `ThinkingBox` and renders each step as a NODE on the vertical
 * connector line — exactly like VS Code Copilot's `.chat-thinking-box`:
 *   - The `.chatThinkingBox::after` curved connector joins the header to the
 *     first step's icon.
 *   - Each step's `::before` draws a vertical line with a mask-image gap
 *     where the step's `.chatThinkingIcon` sits (so icons appear ON the line).
 *   - Reasoning text → `.chatThinkingItemMarkdown` with a book icon.
 *   - Tool invocations → `.chatThinkingToolWrapper` with a tool-type icon.
 *   - Live "Working…" → `.chatThinkingSpinnerItem` with a spinning icon.
 *
 * The `<thought>`-tag `thoughtText` / `thoughtStreaming` props have been
 * removed — the system now uses native AI-SDK `reasoning` parts exclusively.
 *
 * DEDUPLICATION:
 *   The incoming `parts` array can carry MULTIPLE entries for the same
 *   `toolCallId` (AI SDK state machine: input-streaming → input-available →
 *   output-available). Dedup is now PER-MESSAGE (via `messageId`), so a
 *   toolCallId that appears in chain segment #1 won't be rendered AGAIN
 *   if it re-appears in chain segment #2 after a text break.
 */
export const ThoughtsPanel = memo(
  ({ parts, isStreaming = false, addToolResult, activeLabel, messageId }: ThoughtsPanelProps) => {
    const isActive = isStreaming;

    const steps = useMemo<ThoughtStep[]>(() => {
      const out: ThoughtStep[] = [];
      let counter = 0;

      // Per-message dedup state — shared across all chain segments in this message.
      const dedup = getDedupState(messageId);

      /*
       * LOCAL reasoning dedup — scoped to THIS useMemo computation only.
       * Prevents the same reasoning text from appearing twice within a
       * single render pass (e.g. if the SDK emits duplicate parts).
       * Does NOT persist across re-renders — that was the bug that caused
       * reasoning to vanish when streaming ended (the module-level Set
       * accumulated all previous texts and filtered them out on the
       * final re-render).
       */
      const localSeenReasoning = new Set<string>();

      if (parts) {
        const toolStateRank = (state: string): number => {
          // Higher = more progressed. Output states beat input states.
          if (
            state === 'output-available' ||
            state === 'output-error' ||
            state === 'output-denied' ||
            state === 'result'
          ) {
            return 3;
          }

          if (state === 'input-available' || state === 'call') {
            return 2;
          }

          if (state === 'input-streaming' || state === 'partial' || state === 'partial-call') {
            return 1;
          }

          return 0;
        };

        for (const part of parts) {
          if (isToolPart(part)) {
            const id = getToolCallId(part);

            if (id) {
              const existingKey = dedup.toolIndexByKey.get(id);

              if (existingKey) {
                /*
                 * Already have a step for this toolCallId (either in THIS
                 * segment or in an EARLIER segment of the same message).
                 * Replace the existing step's item ONLY if this part is
                 * more progressed. This collapses the
                 * streaming → available → result chain into a single row
                 * AND prevents the same tool from rendering twice across
                 * chain boundaries.
                 */
                const existingIdx = out.findIndex((s) => s.key === existingKey);

                if (existingIdx >= 0 && out[existingIdx].kind === 'tool') {
                  const existingRank = toolStateRank(getToolState(out[existingIdx].item));
                  const newRank = toolStateRank(getToolState(part));

                  if (newRank > existingRank) {
                    out[existingIdx] = {
                      kind: 'tool',
                      item: part,
                      key: existingKey,
                    };
                  }
                }

                continue;
              }

              const key = `tool-${id}`;
              dedup.toolIndexByKey.set(id, key);
              out.push({ kind: 'tool', item: part, key });
              continue;
            }

            out.push({ kind: 'tool', item: part, key: `tool-${counter++}` });
            continue;
          }

          if (part.type === 'reasoning') {
            const r = part as ReasoningUIPart;
            const text = r.details
              ? r.details.map((d: any) => d.text || '').join('')
              : (r as any).textDelta || (r as any).text || '';

            if (text && text.trim() && !localSeenReasoning.has(text)) {
              localSeenReasoning.add(text);
              out.push({ kind: 'reasoning', text, key: `reasoning-${counter++}` });
            }
          }
        }
      }

      return out;
    }, [parts, messageId]);

    const stepCount = steps.length;
    const hasReasoning = steps.some((s) => s.kind === 'reasoning');

    /*
     * Hide the panel ONLY when there are no steps AND we're not streaming.
     * With the dedup fix, steps should always contain the reasoning text
     * even after streaming ends — so the panel stays visible for the user
     * to review. If steps is truly empty (no reasoning, no tools) and
     * we're not streaming, there's nothing to show.
     */
    if (steps.length === 0 && !isActive) {
      return null;
    }

    return (
      <ThinkingBox
        isActive={isActive}
        thoughtStreaming={false}
        stepCount={stepCount}
        hasReasoning={hasReasoning}
        activeLabel={activeLabel}
      >
        {steps.map((step) => {
          if (step.kind === 'reasoning') {
            return (
              <div key={step.key} className={styles.chatThinkingItemMarkdown}>
                {/* Reasoning node — book icon on the chain line (Copilot uses codicon-book) */}
                <span className={classNames(styles.chatThinkingIcon, 'i-ph:book-open')} aria-hidden />
                <ReasoningMarkdown html>{step.text}</ReasoningMarkdown>
              </div>
            );
          }

          // Tool node — tool-type icon on the chain line.
          const state = getToolState(step.item);
          const toolName = getToolNameFromPart(step.item);
          const result = getToolOutput(step.item);

          const isError =
            state === 'output-error' || (state === 'output-available' && classifyResult(result) === 'error');
          const toolIcon = getToolIcon(toolName);

          return (
            <div key={step.key} className={styles.chatThinkingToolWrapper}>
              <span className={classNames(styles.chatThinkingIcon, toolIcon, isError && styles.error)} aria-hidden />
              <ToolProgress part={step.item} addToolResult={addToolResult} inThinkingList />
            </div>
          );
        })}

        {/*
         * Live "Working…" node — spinning icon on the chain line. This is the
         * last node in the chain while streaming (Copilot's .chat-thinking-spinner-item).
         */}
        {isActive && (
          <div className={styles.chatThinkingSpinnerItem}>
            <span className={classNames(styles.chatThinkingIcon, styles.spinning, 'i-ph:spinner-gap')} aria-hidden />
            <span className={styles.spinnerLabel}>Working…</span>
          </div>
        )}
      </ThinkingBox>
    );
  },
);

ThoughtsPanel.displayName = 'ThoughtsPanel';
