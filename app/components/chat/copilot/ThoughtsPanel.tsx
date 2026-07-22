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
 * parts (reasoning + tool-invocation) plus any `<thought>`-tag text into an
 * ordered list of steps so the UI can interleave them like Copilot does.
 *
 * Each step renders as a NODE on the vertical chain-of-thought line —
 * exactly like VS Code Copilot's `.chat-thinking-collapsible`:
 *   .chat-thinking-item.markdown-content  (reasoning — book icon)
 *   .chat-thinking-tool-wrapper           (tool — tool-type icon)
 *   .chat-thinking-spinner-item           (working — spinner icon)
 */
type ThoughtStep = { kind: 'reasoning'; text: string; key: string } | { kind: 'tool'; item: any; key: string };

interface ThoughtsPanelProps {
  /** Text extracted from `<thought>…</thought>` tags in the answer body. */
  thoughtText: string;

  /** True while the `<thought>` block is still streaming (no close tag yet). */
  thoughtStreaming: boolean;

  /**
   * True when thinking is complete (`</thought>` received) and the AI has moved
   * on to its final answer (no tool calls pending). Triggers the "Done" node
   * at the end of the chain-of-thought.
   */
  thinkingDone?: boolean;

  /** Native reasoning + tool-invocation parts from the AI SDK. */
  parts: (TextUIPart | ReasoningUIPart | SourceUIPart | FileUIPart | StepStartUIPart | any)[] | undefined;

  /** True when this is the streaming message and we're still producing parts. */
  isStreaming?: boolean;

  /** Required so tool approval can call back into the chat runner. */
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

/**
 * Copilot-exact collapsible "Thought for Ns" panel with the chain-of-thought
 * vertical line + step icons.
 *
 * Wraps `ThinkingBox` and renders each step as a NODE on the vertical
 * connector line — exactly like VS Code Copilot's `.chat-thinking-box`:
 *   - The `.chatThinkingBox::after` curved connector joins the header to the
 *     first step's icon.
 *   - Each step's `::before` draws a vertical line with a mask-image gap
 *     where the step's `.chatThinkingIcon` sits (so icons appear ON the line).
 *   - Reasoning text → `.chatThinkingItemMarkdown` with a book icon.
 *   - Tool invocations → `.chatThinkingToolWrapper` with a tool-type icon
 *     (search/book/pencil/terminal/wrench — mirrors VS Code's
 *     `getToolInvocationIcon`). The inner progress-container hides its own
 *     status icon; the chain icon represents the step.
 *   - Live "Working…" → `.chatThinkingSpinnerItem` with a spinning icon.
 *
 * The whole panel collapses to a single shimmering "Thinking…" label while
 * streaming, and to "Thought for Ns" when done.
 */
export const ThoughtsPanel = memo(
  ({
    thoughtText,
    thoughtStreaming,
    thinkingDone = false,
    parts,
    isStreaming = false,
    addToolResult,
  }: ThoughtsPanelProps) => {
    const isActive = isStreaming || thoughtStreaming;

    /**
     * Flatten parts + thought text into ordered steps. Tools stay as
     * individual steps (Copilot shows each tool call as its own node on the
     * chain, not grouped into a card).
     */
    const steps = useMemo<ThoughtStep[]>(() => {
      const out: ThoughtStep[] = [];
      let counter = 0;

      // Lead with the <thought>-tag text (if any) as the first reasoning step.
      if (thoughtText && thoughtText.trim()) {
        out.push({ kind: 'reasoning', text: thoughtText, key: `thought-${counter++}` });
      }

      if (parts) {
        for (const part of parts) {
          if (isToolPart(part)) {
            out.push({
              kind: 'tool',
              item: part,
              key: `tool-${getToolCallId(part) ?? counter++}`,
            });
            continue;
          }

          if (part.type === 'reasoning') {
            const r = part as ReasoningUIPart;
            const text = r.details
              ? r.details.map((d: any) => d.text || '').join('')
              : (r as any).textDelta || (r as any).text || '';

            if (text && text.trim()) {
              out.push({ kind: 'reasoning', text, key: `reasoning-${counter++}` });
            }
          }
        }
      }

      return out;
    }, [thoughtText, parts]);

    if (steps.length === 0 && !isActive && !thinkingDone) {
      return null;
    }

    return (
      <ThinkingBox isActive={isActive} thoughtStreaming={thoughtStreaming}>
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
          // v7 'output-error' is itself an error; v7 'output-available' (v4 'result')
          // is an error only when the result string starts with a known error prefix.
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
        {isActive && !thinkingDone && (
          <div className={styles.chatThinkingSpinnerItem}>
            <span className={classNames(styles.chatThinkingIcon, styles.spinning, 'i-ph:spinner-gap')} aria-hidden />
            <span className={styles.spinnerLabel}>Working…</span>
          </div>
        )}

        {/*
         * "Done" node — static check icon on the chain line. Appears when
         * `</thought>` has been received and the AI has moved on to its
         * final answer (no pending tool calls). Signals to the user that
         * the thinking phase is complete.
         */}
        {!isActive && thinkingDone && (
          <div className={styles.chatThinkingDoneItem}>
            <span className={classNames(styles.chatThinkingIcon, styles.doneIcon, 'i-ph:check-circle')} aria-hidden />
            <span className={styles.doneLabel}>Done</span>
          </div>
        )}
      </ThinkingBox>
    );
  },
);

ThoughtsPanel.displayName = 'ThoughtsPanel';
