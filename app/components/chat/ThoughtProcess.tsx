import { memo, useMemo, Fragment } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '~/components/ai-elements/reasoning';
import { ReasoningMarkdown } from './ReasoningMarkdown';
import { ToolInvocationChip } from './ToolInvocationChip';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';

/**
 * The union of message-part types we may need to render inside the
 * single "Thought process" panel. Anything that is NOT plain text
 * (the final answer) lives here so the final answer can render
 * separately below the panel.
 */
export type ThoughtPart =
  | ReasoningUIPart
  | ToolInvocationUIPart
  | SourceUIPart
  | FileUIPart
  | StepStartUIPart
  | TextUIPart;

interface ThoughtProcessProps {
  /**
   * All non-final-answer parts from the assistant message, in their
   * original streaming order. The component groups consecutive tool
   * invocations into compact "tool group" sub-panels so multiple
   * parallel tool calls read as a single step.
   */
  parts: ThoughtPart[];
  /** True only when this is the streaming message AND we are still producing parts. */
  isStreaming?: boolean;
  /** Required so tool approval chips can call back into the chat runner. */
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

/**
 * Copilot-style "Thought for Ns" panel.
 *
 * Renders ONE single collapsible at the top of an assistant message
 * containing ALL reasoning segments and ALL tool invocations as
 * interleaved "steps" — exactly like VSCode Copilot's reasoning UI.
 * The final answer markdown renders BELOW this panel (handled by
 * AssistantMessage, not here).
 *
 * Visual hierarchy inside the panel (matches Copilot):
 *   - Reasoning text: dimmed secondary color, 13px, italic-feeling
 *   - Tool chip: compact icon + label + summary + state badge
 *   - Each tool chip is collapsible for its args/result
 */
export const ThoughtProcess = memo(({ parts, isStreaming = false, addToolResult }: ThoughtProcessProps) => {
  /**
   * Group consecutive tool invocations together so they render as a
   * single visual step (Copilot shows parallel tool calls as one row
   * of chips). Reasoning parts and other part types are kept as
   * individual steps. The output is an ordered list of "steps":
   *   - { kind: 'reasoning', text }
   *   - { kind: 'tools', items: ToolInvocationUIPart[] }
   *   - { kind: 'text', text }   (rare inside the thought panel)
   */
  const steps = useMemo(() => {
    const out: Array<
      | { kind: 'reasoning'; text: string; key: string }
      | { kind: 'tools'; items: ToolInvocationUIPart[]; key: string }
      | { kind: 'text'; text: string; key: string }
    > = [];

    let pendingTools: ToolInvocationUIPart[] = [];
    let stepCounter = 0;

    const flushTools = () => {
      if (pendingTools.length > 0) {
        out.push({ kind: 'tools', items: pendingTools, key: `tools-${stepCounter++}` });
        pendingTools = [];
      }
    };

    for (const part of parts) {
      if (part.type === 'tool-invocation') {
        pendingTools.push(part as ToolInvocationUIPart);
        continue;
      }

      // Any non-tool part flushes the pending tool group first so
      // ordering stays correct: [reasoning] [tools] [reasoning] [tools]
      flushTools();

      if (part.type === 'reasoning') {
        const r = part as ReasoningUIPart;
        const text = r.details
          ? r.details.map((d: any) => d.text || '').join('')
          : (r as any).textDelta || (r as any).text || '';

        if (text && text.trim()) {
          out.push({ kind: 'reasoning', text, key: `reasoning-${stepCounter++}` });
        }

        continue;
      }

      if (part.type === 'text') {
        const t = part as TextUIPart;

        // Inside the thought panel we only show text parts that look
        // like reasoning scaffolding (e.g. "Plan:"). The final answer
        // text is rendered separately by AssistantMessage via the
        // smoothContent stream, so we skip empty / trivial text here.
        if (t.text && t.text.trim() && t.text.trim().length < 600) {
          out.push({ kind: 'text', text: t.text, key: `text-${stepCounter++}` });
        }
      }
    }

    flushTools();

    return out;
  }, [parts]);

  const hasContent = steps.length > 0;

  if (!hasContent) {
    return null;
  }

  return (
    <Reasoning isStreaming={isStreaming} defaultOpen={isStreaming} className="mb-3">
      <ReasoningTrigger />
      <ReasoningContent>
        <div className="flex flex-col gap-3">
          {steps.map((step) => {
            if (step.kind === 'reasoning') {
              return (
                <div key={step.key} className="text-[13px] leading-relaxed text-bolt-elements-textSecondary">
                  <ReasoningMarkdown html>{step.text}</ReasoningMarkdown>
                </div>
              );
            }

            if (step.kind === 'text') {
              return (
                <div key={step.key} className="text-[13px] leading-relaxed text-bolt-elements-textSecondary">
                  <ReasoningMarkdown html>{step.text}</ReasoningMarkdown>
                </div>
              );
            }

            // Tool group step — render as a vertical stack of compact chips.
            // Adjacent tool calls (parallel) share a single rounded container
            // so they read as "this step called these tools".
            return (
              <div
                key={step.key}
                className="flex flex-col rounded-md border border-bolt-elements-borderColor/60 bg-bolt-elements-background-depth-2/40 overflow-hidden"
              >
                {step.items.map((item, idx) => (
                  <ToolInvocationChip
                    key={(item as any).toolInvocation?.toolCallId ?? idx}
                    part={item}
                    addToolResult={addToolResult}
                    isFirst={idx === 0}
                    isLast={idx === step.items.length - 1}
                  />
                ))}
              </div>
            );
          })}

          {/*
           * Live "thinking" pulse — only visible while we are still
           * streaming and the user has the panel open. Disappears once
           * isStreaming flips to false (the Reasoning component itself
           * swaps "Thinking..." → "Thought for Ns" in the trigger).
           */}
          {isStreaming && (
            <AnimatePresence>
              <motion.div
                initial={{ opacity: 0 }}
                animate={{ opacity: 1 }}
                exit={{ opacity: 0 }}
                className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary pt-1"
              >
                <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                <span>working…</span>
              </motion.div>
            </AnimatePresence>
          )}
        </div>
      </ReasoningContent>
    </Reasoning>
  );
});
