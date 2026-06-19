import { memo, useMemo, useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { Shimmer } from '~/components/ai-elements/shimmer';
import { ToolCard } from './ToolCard';
import { ReasoningMarkdown } from '~/components/chat/ReasoningMarkdown';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';

/**
 * A single renderable step inside the thoughts panel. We flatten the message
 * parts (reasoning + tool-invocation) plus any `<thought>`-tag text into an
 * ordered list of steps so the UI can interleave them like Copilot does.
 */
type ThoughtStep =
  | { kind: 'reasoning'; text: string; key: string }
  | { kind: 'tools'; items: ToolInvocationUIPart[]; key: string };

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

  /** Required so tool approval cards can call back into the chat runner. */
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

/**
 * Copilot-style "Thought for Ns" panel.
 *
 * Renders ONE single collapsible above the final answer containing ALL
 * reasoning (from `<thought>` tags and/or native reasoning parts) plus ALL
 * tool invocations as interleaved compact cards — exactly like VS Code
 * Copilot's reasoning UI.
 *
 * Behaviour:
 *   - While streaming: trigger reads "Thinking…" with a shimmer; panel is
 *     open by default so the user sees the live chain-of-thought.
 *   - When streaming ends: trigger reads "Thought for Ns"; panel auto-
 *     collapses after a short delay (matches Copilot).
 *   - User can always re-expand/collapse by clicking the trigger.
 */
export const ThoughtsPanel = memo(
  ({ thoughtText, thoughtStreaming, parts, isStreaming = false, addToolResult }: ThoughtsPanelProps) => {
    const [isOpen, setIsOpen] = useState(true);
    const [duration, setDuration] = useState<number | undefined>(undefined);
    const startTimeRef = useRef<number | null>(null);
    const hasEverStreamedRef = useRef(false);
    const hasAutoCollapsedRef = useRef(false);

    /*
     * The panel is "live" while we're streaming OR while a thought block is
     * still open (no close tag yet).
     */
    const isActive = isStreaming || thoughtStreaming;

    useEffect(() => {
      if (isActive) {
        hasEverStreamedRef.current = true;

        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.max(1, Math.ceil((Date.now() - startTimeRef.current) / 1000)));
        startTimeRef.current = null;
      }
    }, [isActive]);

    // Auto-collapse ~1.2s after streaming finishes (Copilot behaviour).
    useEffect(() => {
      let timer: ReturnType<typeof setTimeout> | undefined;

      if (hasEverStreamedRef.current && !isActive && isOpen && !hasAutoCollapsedRef.current) {
        timer = setTimeout(() => {
          setIsOpen(false);
          hasAutoCollapsedRef.current = true;
        }, 1200);
      }

      return () => {
        if (timer) {
          clearTimeout(timer);
        }
      };
    }, [isActive, isOpen]);

    /**
     * Flatten parts + thought text into ordered steps. Consecutive tool
     * invocations are grouped into a single "tools" step so parallel calls
     * render as one row of cards (Copilot shows them together).
     */
    const steps = useMemo<ThoughtStep[]>(() => {
      const out: ThoughtStep[] = [];
      let pendingTools: ToolInvocationUIPart[] = [];
      let counter = 0;

      const flushTools = () => {
        if (pendingTools.length > 0) {
          out.push({ kind: 'tools', items: pendingTools, key: `tools-${counter++}` });
          pendingTools = [];
        }
      };

      // Lead with the <thought>-tag text (if any) as the first reasoning step.
      if (thoughtText && thoughtText.trim()) {
        out.push({ kind: 'reasoning', text: thoughtText, key: `thought-${counter++}` });
      }

      if (parts) {
        for (const part of parts) {
          if (part.type === 'tool-invocation') {
            pendingTools.push(part as ToolInvocationUIPart);
            continue;
          }

          flushTools();

          if (part.type === 'reasoning') {
            const r = part as ReasoningUIPart;
            const text = r.details
              ? r.details.map((d: any) => d.text || '').join('')
              : (r as any).textDelta || (r as any).text || '';

            if (text && text.trim()) {
              out.push({ kind: 'reasoning', text, key: `reasoning-${counter++}` });
            }

            continue;
          }
        }

        flushTools();
      }

      return out;
    }, [thoughtText, parts]);

    const hasContent = steps.length > 0;

    if (!hasContent) {
      return null;
    }

    const triggerLabel = isActive ? (
      <Shimmer duration={1.4}>Thinking…</Shimmer>
    ) : duration !== undefined ? (
      <span>Thought for {duration}s</span>
    ) : (
      <span>Thought process</span>
    );

    return (
      <div className="copilot-thoughts-panel mb-3">
        {/* Trigger */}
        <button
          type="button"
          onClick={() => setIsOpen((v) => !v)}
          className={classNames(
            'flex items-center gap-1.5 text-sm transition-colors bg-transparent border-none p-0 cursor-pointer',
            'text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary',
          )}
        >
          <span className="i-ph:sparkle text-base" />
          {triggerLabel}
          <span
            className={classNames(
              'i-ph:caret-down-bold text-xs transition-transform duration-150',
              isOpen && 'rotate-180',
            )}
          />
        </button>

        {/* Collapsible content */}
        <AnimatePresence initial={false}>
          {isOpen && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 32 } }}
              exit={{ height: 0, opacity: 0, transition: { duration: 0.2, ease: 'easeInOut' } }}
              style={{ overflow: 'hidden' }}
              className="mt-2"
            >
              <div className="copilot-thoughts-content relative pl-4 border-l-2 border-bolt-elements-borderColor/60 ml-1 py-1 pr-1 flex flex-col gap-3">
                {steps.map((step) => {
                  if (step.kind === 'reasoning') {
                    return (
                      <div key={step.key} className="text-[13px] leading-relaxed text-bolt-elements-textSecondary">
                        <ReasoningMarkdown html>{step.text}</ReasoningMarkdown>
                      </div>
                    );
                  }

                  /*
                   * Tool group — vertical stack of compact cards inside a
                   * single rounded container so adjacent (parallel) tool
                   * calls read as "this step called these tools".
                   */
                  return (
                    <div
                      key={step.key}
                      className="flex flex-col rounded-lg border border-bolt-elements-borderColor/50 bg-bolt-elements-background-depth-2/40 overflow-hidden"
                    >
                      {step.items.map((item, idx) => (
                        <ToolCard
                          key={(item as any).toolInvocation?.toolCallId ?? idx}
                          part={item}
                          addToolResult={addToolResult}
                        />
                      ))}
                    </div>
                  );
                })}

                {/* Live "working…" pulse while streaming */}
                {isActive && (
                  <div className="flex items-center gap-2 text-xs text-bolt-elements-textTertiary pt-0.5">
                    <span className="inline-block w-1.5 h-1.5 rounded-full bg-current animate-pulse" />
                    <span>working…</span>
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    );
  },
);

ThoughtsPanel.displayName = 'ThoughtsPanel';
