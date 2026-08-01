import { AnimatePresence, motion } from 'framer-motion';
import { memo, useMemo, useState, useEffect, useCallback, useRef } from 'react';
import { createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric } from 'shiki';
import { classNames } from '~/utils/classNames';
import {
  TOOL_EXECUTION_APPROVAL,
  TOOL_EXECUTION_DENIED,
  TOOL_EXECUTION_ERROR,
  TOOL_NO_EXECUTE_FUNCTION,
} from '~/utils/constants';
import { cubicEasingFn } from '~/utils/easings';
import { logger } from '~/utils/logger';
import { themeStore, type Theme } from '~/lib/stores/theme';
import { useStore } from '@nanostores/react';
import type { ToolCallAnnotation } from '~/types/context';
import {
  getToolNameFromPart,
  getToolCallId,
  getToolState,
  getToolInput,
  getToolOutput,
  ToolState,
} from '~/lib/chat/tool-parts';

const highlighterOptions = {
  langs: ['json'],
  themes: ['light-plus', 'dark-plus'],
};

const jsonHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> =
  import.meta.hot?.data.jsonHighlighter ?? (await createHighlighter(highlighterOptions));

if (import.meta.hot) {
  import.meta.hot.data.jsonHighlighter = jsonHighlighter;
}

interface JsonCodeBlockProps {
  className?: string;
  code: string;
  theme: Theme;
}

function JsonCodeBlock({ className, code, theme }: JsonCodeBlockProps) {
  let formattedCode = code;

  try {
    if (typeof formattedCode === 'object') {
      formattedCode = JSON.stringify(formattedCode, null, 2);
    } else if (typeof formattedCode === 'string') {
      // Attempt to parse and re-stringify for formatting
      try {
        const parsed = JSON.parse(formattedCode);
        formattedCode = JSON.stringify(parsed, null, 2);
      } catch {
        // Leave as is if not JSON
      }
    }
  } catch (e) {
    // If parsing fails, keep original code
    logger.error('Failed to parse JSON', { error: e });
  }

  return (
    <div
      className={classNames('text-xs rounded-md overflow-hidden mcp-tool-invocation-code', className)}
      dangerouslySetInnerHTML={{
        __html: jsonHighlighter.codeToHtml(formattedCode, {
          lang: 'json',
          theme: theme === 'dark' ? 'dark-plus' : 'light-plus',
        }),
      }}
    ></div>
  );
}

interface ToolInvocationsProps {
  /**
   * v7 tool parts (`type: 'tool-<name>'` or `'dynamic-tool'`) OR legacy v4
   * `tool-invocation` parts. The prop name is kept for backward compatibility
   * but the element shape is shape-agnostic — fields are accessed via the
   * shared helpers in `~/lib/chat/tool-parts`.
   */
  toolInvocations: any[];
  toolCallAnnotations: ToolCallAnnotation[];
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

export const ToolInvocations = memo(({ toolInvocations, toolCallAnnotations, addToolResult }: ToolInvocationsProps) => {
  const theme = useStore(themeStore);
  const [showDetails, setShowDetails] = useState(false);

  const toggleDetails = () => {
    setShowDetails((prev) => !prev);
  };

  /*
   * v7 migration: state checks use the v7 vocabulary. `getToolState` returns
   * the normalised v7 state (mapping v4 'call'/'result' onto
   * 'input-available'/'output-available' if a legacy part slips through).
   */
  const toolCalls = useMemo(
    () => toolInvocations.filter((inv) => ToolState.isCall(getToolState(inv))),
    [toolInvocations],
  );

  const toolResults = useMemo(
    () => toolInvocations.filter((inv) => ToolState.isResult(getToolState(inv))),
    [toolInvocations],
  );

  const hasToolCalls = toolCalls.length > 0;
  const hasToolResults = toolResults.length > 0;

  if (!hasToolCalls && !hasToolResults) {
    return null;
  }

  return (
    <div className="tool-invocation border border-amplify-elements-borderColor flex flex-col overflow-hidden rounded-lg w-full transition-border duration-150">
      <div className="flex">
        <button
          className="flex items-stretch bg-amplify-elements-background-depth-2 hover:bg-amplify-elements-artifacts-backgroundHover w-full overflow-hidden"
          onClick={toggleDetails}
          aria-label={showDetails ? 'Collapse details' : 'Expand details'}
        >
          <div className="p-2.5">
            <div className="i-ph:wrench text-xl text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors"></div>
          </div>
          <div className="p-2.5 w-full text-left">
            <div className="w-full text-amplify-elements-textPrimary font-medium leading-5 text-sm">
              Tool Invocations{' '}
              {hasToolResults && (
                <div className="text-amplify-elements-textSecondary text-xs mt-0.5">
                  ({toolResults.length} tool{hasToolResults ? 's' : ''} used)
                </div>
              )}
            </div>
          </div>
        </button>
        <AnimatePresence>
          {hasToolResults && (
            <motion.button
              initial={{ width: 0 }}
              animate={{ width: 'auto' }}
              exit={{ width: 0 }}
              transition={{ duration: 0.15, ease: cubicEasingFn }}
              className="bg-amplify-elements-artifacts-background hover:bg-amplify-elements-artifacts-backgroundHover"
              onClick={toggleDetails}
            >
              <div className="p-2">
                <div
                  className={`${showDetails ? 'i-ph:caret-up-bold' : 'i-ph:caret-down-bold'} text-xl text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors`}
                ></div>
              </div>
            </motion.button>
          )}
        </AnimatePresence>
      </div>
      <AnimatePresence>
        {hasToolCalls && (
          <motion.div
            className="details"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: '0px' }}
            transition={{ duration: 0.15 }}
          >
            <div className="bg-amplify-elements-artifacts-borderColor h-[1px]" />

            <div className="px-3 py-3 text-left bg-amplify-elements-background-depth-2">
              <ToolCallsList
                toolInvocations={toolCalls}
                toolCallAnnotations={toolCallAnnotations}
                addToolResult={addToolResult}
                theme={theme}
              />
            </div>
          </motion.div>
        )}

        {hasToolResults && showDetails && (
          <motion.div
            className="details"
            initial={{ height: 0 }}
            animate={{ height: 'auto' }}
            exit={{ height: '0px' }}
            transition={{ duration: 0.15 }}
          >
            <div className="bg-amplify-elements-artifacts-borderColor h-[1px]" />

            <div className="p-5 text-left bg-amplify-elements-actions-background">
              <ToolResultsList toolInvocations={toolResults} toolCallAnnotations={toolCallAnnotations} theme={theme} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

const toolVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

interface ToolResultsListProps {
  toolInvocations: any[];
  toolCallAnnotations: ToolCallAnnotation[];
  theme: Theme;
}

const ToolResultsList = memo(({ toolInvocations, toolCallAnnotations, theme }: ToolResultsListProps) => {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <ul className="list-none space-y-4">
        {toolInvocations.map((tool, index) => {
          const toolCallState = getToolState(tool);

          if (!ToolState.isResult(toolCallState)) {
            return null;
          }

          const toolName = getToolNameFromPart(tool);
          const toolCallId = getToolCallId(tool);
          const args = getToolInput(tool);
          const result = getToolOutput(tool);

          const annotation = toolCallAnnotations.find((annotation) => {
            return annotation.toolCallId === toolCallId;
          });

          const isErrorResult = [TOOL_NO_EXECUTE_FUNCTION, TOOL_EXECUTION_DENIED, TOOL_EXECUTION_ERROR].includes(
            result,
          );

          return (
            <motion.li
              key={index}
              variants={toolVariants}
              initial="hidden"
              animate="visible"
              transition={{
                duration: 0.2,
                ease: cubicEasingFn,
              }}
            >
              <div className="flex items-center gap-1.5 text-xs mb-1">
                {isErrorResult ? (
                  <div className="text-lg text-amplify-elements-icon-error">
                    <div className="i-ph:x"></div>
                  </div>
                ) : (
                  <div className="text-lg text-amplify-elements-icon-success">
                    <div className="i-ph:check"></div>
                  </div>
                )}
                <div className="text-amplify-elements-textSecondary text-xs">Server:</div>
                <div className="text-amplify-elements-textPrimary font-semibold">{annotation?.serverName}</div>
              </div>

              <div className="ml-6 mb-2">
                <div className="text-amplify-elements-textSecondary text-xs mb-1">
                  Tool: <span className="text-amplify-elements-textPrimary font-semibold">{toolName}</span>
                </div>
                <div className="text-amplify-elements-textSecondary text-xs mb-1">
                  Description:{' '}
                  <span className="text-amplify-elements-textPrimary font-semibold">{annotation?.toolDescription}</span>
                </div>
                <div className="text-amplify-elements-textSecondary text-xs mb-1">Parameters:</div>
                <div className="bg-amplify-elements-background-depth-1 p-3 rounded-md">
                  <div className="relative group/copy">
                    <JsonCodeBlock className="mb-0" code={JSON.stringify(args)} theme={theme} />
                    <CopyJsonButton text={JSON.stringify(args, null, 2)} />
                  </div>
                </div>
                <div className="text-amplify-elements-textSecondary text-xs mt-3 mb-1">Result:</div>
                <div className="bg-amplify-elements-background-depth-1 p-3 rounded-md">
                  <div className="relative group/copy">
                    <JsonCodeBlock className="mb-0" code={JSON.stringify(result)} theme={theme} />
                    <CopyJsonButton text={typeof result === 'string' ? result : JSON.stringify(result, null, 2)} />
                  </div>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
});

interface ToolCallsListProps {
  toolInvocations: any[];
  toolCallAnnotations: ToolCallAnnotation[];
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  theme: Theme;
}

const ToolCallsList = memo(({ toolInvocations, toolCallAnnotations, addToolResult }: ToolCallsListProps) => {
  const [expanded, setExpanded] = useState<{ [id: string]: boolean }>({});

  // Dedup guard for auto-approval. Multiple effects (here, in ToolProgress.tsx,
  // and in Chat.client.tsx) can fire in parallel for the same pending toolCallId.
  // Without this guard, addToolResult gets called multiple times for the same id,
  // which causes the AI SDK to emit duplicate state transitions and the chat ends
  // up rendering the message twice — especially noticeable when a tool fails.
  const autoApprovedToolCallIdsRef = useRef<Set<string>>(new Set());

  // OS detection for shortcut display
  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  // ───────────────────────────────────────────────────────────────
  // Auto-approval: every tool runs automatically EXCEPT execute_plan,
  // which is the only tool that requires explicit user approval
  // (the user approves the full enriched plan in PlanApprovalDialog).
  // ───────────────────────────────────────────────────────────────
  useEffect(() => {
    const pending = toolInvocations.filter(
      (inv) => ToolState.isCall(getToolState(inv)) && getToolNameFromPart(inv) !== 'execute_plan',
    );

    for (const inv of pending) {
      const id = getToolCallId(inv);

      if (id && !autoApprovedToolCallIdsRef.current.has(id)) {
        autoApprovedToolCallIdsRef.current.add(id);
        addToolResult({
          toolCallId: id,
          result: TOOL_EXECUTION_APPROVAL.APPROVE,
        });
      }
    }
  }, [toolInvocations, addToolResult]);

  useEffect(() => {
    const expandedState: { [id: string]: boolean } = {};
    toolInvocations.forEach((inv) => {
      if (ToolState.isCall(getToolState(inv))) {
        expandedState[getToolCallId(inv)] = true;
      }
    });
    setExpanded(expandedState);
  }, [toolInvocations]);

  // Keyboard shortcut logic
  useEffect(() => {
    const handleKeyDown = (e: KeyboardEvent) => {
      // Ignore if focus is in an input/textarea/contenteditable
      const active = document.activeElement as HTMLElement | null;

      if (active && (active.tagName === 'INPUT' || active.tagName === 'TEXTAREA' || active.isContentEditable)) {
        return;
      }

      if (Object.keys(expanded).length === 0) {
        return;
      }

      const openId = Object.keys(expanded).find((id) => expanded[id]);

      if (!openId) {
        return;
      }

      // Cancel: Cmd/Ctrl + Backspace
      if ((isMac ? e.metaKey : e.ctrlKey) && e.key === 'Backspace') {
        e.preventDefault();
        addToolResult({
          toolCallId: openId,
          result: TOOL_EXECUTION_APPROVAL.REJECT,
        });
      }

      // Run tool: Cmd/Ctrl + Enter
      if ((isMac ? e.metaKey : e.ctrlKey) && (e.key === 'Enter' || e.key === 'Return')) {
        e.preventDefault();
        addToolResult({
          toolCallId: openId,
          result: TOOL_EXECUTION_APPROVAL.APPROVE,
        });
      }
    };
    window.addEventListener('keydown', handleKeyDown);

    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [expanded, addToolResult, isMac]);

  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <ul className="list-none space-y-4">
        {toolInvocations.map((tool, index) => {
          const toolCallState = getToolState(tool);

          if (!ToolState.isCall(toolCallState)) {
            return null;
          }

          const toolName = getToolNameFromPart(tool);
          const toolCallId = getToolCallId(tool);
          const annotation = toolCallAnnotations.find((annotation) => annotation.toolCallId === toolCallId);

          // Only execute_plan requires explicit user approval — it opens the
          // PlanApprovalDialog after planner enrichment. All other tools
          // auto-approve (see the useEffect above) and just show a "running"
          // indicator while they execute.
          const needsApproval = toolName === 'execute_plan';

          return (
            <motion.li
              key={index}
              variants={toolVariants}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.2, ease: cubicEasingFn }}
            >
              <div className="bg-amplify-elements-background-depth-3 rounded-lg p-2">
                <div key={toolCallId} className="flex gap-1">
                  <div className="flex flex-col items-center ">
                    <span className="mr-auto font-light font-normal text-md text-amplify-elements-textPrimary rounded-md">
                      {toolName}
                    </span>
                    <span className="text-xs text-amplify-elements-textSecondary font-light break-words max-w-64">
                      {annotation?.toolDescription}
                    </span>
                  </div>
                  <div className="flex items-center justify-end gap-2 ml-auto">
                    {needsApproval ? (
                      <>
                        <button
                          className={classNames(
                            'h-10 px-2.5 py-1.5 rounded-lg text-xs h-auto',
                            'bg-transparent',
                            'text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary',
                            'transition-all duration-200',
                            'flex items-center gap-2',
                          )}
                          onClick={() =>
                            addToolResult({
                              toolCallId,
                              result: TOOL_EXECUTION_APPROVAL.REJECT,
                            })
                          }
                        >
                          Cancel <span className="opacity-70 text-xs ml-1">{isMac ? '⌘⌫' : 'Ctrl+Backspace'}</span>
                        </button>
                        <button
                          className={classNames(
                            'h-10 inline-flex items-center gap-2 px-3 py-1.5 text-xs font-normal rounded-lg transition-colors',
                            'bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor',
                            'text-accent-500 hover:text-amplify-elements-textPrimary',
                            'disabled:opacity-50 disabled:cursor-not-allowed',
                          )}
                          onClick={() =>
                            addToolResult({
                              toolCallId,
                              result: TOOL_EXECUTION_APPROVAL.APPROVE,
                            })
                          }
                        >
                          Run tool <span className="opacity-70 text-xs ml-1">{isMac ? '⌘↵' : 'Ctrl+Enter'}</span>
                        </button>
                      </>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-xs text-amplify-elements-textSecondary">
                        <span className="inline-block w-3 h-3 border-2 border-blue-500/40 border-t-blue-500 rounded-full animate-spin" />
                        Running…
                      </span>
                    )}
                  </div>
                </div>
              </div>
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
});

/**
 * Copy button that appears on hover inside JSON code blocks in tool
 * results. The parent container must have the `group/copy` class.
 *
 * Fades in on hover, shows a green check for 1.5s after copying, then
 * reverts to the copy icon.
 */
function CopyJsonButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(text);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard unavailable (permissions) — silently ignore */
    }
  }, [text]);

  return (
    <button
      type="button"
      onClick={handleCopy}
      aria-label={copied ? 'Copied' : 'Copy to clipboard'}
      className="absolute top-1.5 right-1.5 p-1 rounded-md text-xs bg-transparent hover:bg-amplify-elements-background-depth-2 text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary opacity-0 group-hover/copy:opacity-100 focus-within:opacity-100 transition-all duration-150 cursor-pointer"
    >
      <div className={copied ? 'i-ph:check text-green-500' : 'i-ph:copy'} />
    </button>
  );
}
