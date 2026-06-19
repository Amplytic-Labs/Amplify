import { memo, useMemo } from 'react';
import { classNames } from '~/utils/classNames';
import { ToolProgress } from './ToolProgress';
import { ThinkingBox } from './ThinkingBox';
import { ReasoningMarkdown } from '~/components/chat/ReasoningMarkdown';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';
import styles from './chat-copilot.module.scss';

/**
 * A single renderable step inside the thinking box. We flatten the message
 * parts (reasoning + tool-invocation) plus any `<thought>`-tag text into an
 * ordered list of steps so the UI can interleave them like Copilot does.
 *
 * Each step renders INLINE inside the .chat-thinking-box — no cards.
 */
type ThoughtStep =
  | { kind: 'reasoning'; text: string; key: string }
  | { kind: 'tool'; item: ToolInvocationUIPart; key: string };

interface ThoughtsPanelProps {
  /** Text extracted from `<thought>…</thought>` tags in the answer body. */
  thoughtText: string;

  /** True while the `<thought>` block is still streaming (no close tag yet). */
  thoughtStreaming: boolean;

  /** Native reasoning + tool-invocation parts from the AI SDK. */
  parts:
    | (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[]
    | undefined;

  /** True when this is the streaming message and we're still producing parts. */
  isStreaming?: boolean;

  /** Required so tool approval can call back into the chat runner. */
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

/**
 * Copilot-exact collapsible "Thought for Ns" panel.
 *
 * Wraps `ThinkingBox` and renders each step INLINE — exactly like VS Code
 * Copilot's `.chat-thinking-box`:
 *   - Reasoning text → `.chat-thinking-item.markdown-content` (muted text)
 *   - Tool invocations → `.chat-tool-invocation-part` containing a flat
 *     `.progress-container` row (NO CARD)
 *
 * The whole panel collapses to a single shimmering "Thinking…" label while
 * streaming, and to "Thought for Ns" when done.
 */
export const ThoughtsPanel = memo(
  ({ thoughtText, thoughtStreaming, parts, isStreaming = false, addToolResult }: ThoughtsPanelProps) => {
    const isActive = isStreaming || thoughtStreaming;

    /**
     * Flatten parts + thought text into ordered steps. Tools stay as
     * individual steps (Copilot shows each tool call as its own row inside
     * the thinking list, not grouped into a card).
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
          if (part.type === 'tool-invocation') {
            out.push({
              kind: 'tool',
              item: part as ToolInvocationUIPart,
              key: `tool-${(part as any).toolInvocation?.toolCallId ?? counter++}`,
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

    if (steps.length === 0) {
      return null;
    }

    return (
      <ThinkingBox isActive={isActive} thoughtStreaming={thoughtStreaming}>
        {steps.map((step) => {
          if (step.kind === 'reasoning') {
            return (
              <div key={step.key} className={classNames(styles.thinkingItem, styles.markdownContent)}>
                <ReasoningMarkdown html>{step.text}</ReasoningMarkdown>
              </div>
            );
          }

          // Tool step — flat inline progress row, NO CARD
          return (
            <div key={step.key} className={styles.toolInvocationPart}>
              <ToolProgress part={step.item} addToolResult={addToolResult} />
            </div>
          );
        })}

        {/* Live "Working…" pulse while streaming — Copilot's .chat-working-progress-step */}
        {isActive && (
          <div className={styles.workingProgress}>
            <span className={classNames(styles.icon, 'i-ph:spinner-gap')} aria-label="loading" />
            <span className={styles.label}>Working…</span>
          </div>
        )}
      </ThinkingBox>
    );
  },
);

ThoughtsPanel.displayName = 'ThoughtsPanel';
