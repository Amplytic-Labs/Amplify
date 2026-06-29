import { memo, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import type { ToolInvocationUIPart } from '@ai-sdk/ui-utils';
import { parseFileMutationSignal, isFileMutationSignal, isReadOnlyNativeTool } from '~/lib/tools/nativeTools';
import { ToolConfirmation } from './ToolConfirmation';
import styles from './chat-copilot.module.scss';

/**
 * Friendly display metadata for each native tool, mirroring VS Code Copilot's
 * terse past-tense phrasing. In Copilot, the tool itself provides an
 * `invocationMessage` (imperative, e.g. "Searching the web") and a
 * `pastTenseMessage` (e.g. "Searched the web"). We mirror that here.
 */
interface ToolMeta {
  /** Past-tense label shown when the call is complete (Copilot: pastTenseMessage). */
  label: string;

  /** Imperative label shown while the call is in flight (Copilot: invocationMessage). */
  pendingLabel: string;
}

const TOOL_META: Record<string, ToolMeta> = {
  web_search: { label: 'Searched the web', pendingLabel: 'Searching the web' },
  read_file: { label: 'Read file', pendingLabel: 'Reading file' },
  list_dir: { label: 'Listed directory', pendingLabel: 'Listing directory' },
  find_files: { label: 'Found files', pendingLabel: 'Finding files' },
  grep_search: { label: 'Searched in codebase', pendingLabel: 'Searching in codebase' },
  semantic_search: {
    label: 'Performed semantic search',
    pendingLabel: 'Performing semantic search',
  },
  read_notebook_cell: { label: 'Read notebook cell', pendingLabel: 'Reading notebook cell' },
  run_in_terminal: { label: 'Ran command', pendingLabel: 'Running command' },
  create_file: { label: 'Created file', pendingLabel: 'Creating file' },
  replace_string_in_file: { label: 'Edited file', pendingLabel: 'Editing file' },
  multi_replace_string_in_file: { label: 'Edited file', pendingLabel: 'Editing file' },
  execute_plan: { label: 'Executed plan', pendingLabel: 'Executing plan' },
  update_user_memory: { label: 'Updated memory', pendingLabel: 'Updating memory' },
  read_user_memory: { label: 'Read memory', pendingLabel: 'Reading memory' },
};

export function getMeta(toolName: string): ToolMeta {
  return TOOL_META[toolName] || { label: `Used ${toolName}`, pendingLabel: `Using ${toolName}` };
}

/**
 * Map a tool name to a Phosphor icon class that sits ON the chain-of-thought
 * line. This mirrors VS Code Copilot's `getToolInvocationIcon` (chatThinkingContentPart.ts L93-133):
 *   - search/grep/find/list/semantic/changes/codebase → magnifying glass
 *   - read/get_file/problems → book
 *   - edit/insert/create/replace → pencil
 *   - terminal → terminal
 *   - default → wrench (Copilot uses codicon-tools)
 *
 * The icon represents the TOOL TYPE (not the status). Status (in-flight vs
 * done vs error) is conveyed by the inline label shimmer + error coloring.
 */
export function getToolIcon(toolName: string): string {
  const lower = (toolName || '').toLowerCase();

  if (
    lower.includes('search') ||
    lower.includes('grep') ||
    lower.includes('find') ||
    lower.includes('list') ||
    lower.includes('semantic') ||
    lower.includes('changes') ||
    lower.includes('codebase') ||
    lower.includes('checked')
  ) {
    return 'i-ph:magnifying-glass';
  }

  if (lower.includes('read') || lower.includes('get_file') || lower.includes('problems')) {
    return 'i-ph:book-open';
  }

  if (
    lower.includes('edit') ||
    lower.includes('insert') ||
    lower.includes('create') ||
    lower.includes('replace') ||
    lower.includes('multi_replace')
  ) {
    return 'i-ph:pencil-simple';
  }

  if (lower.includes('terminal') || lower.includes('run_in')) {
    return 'i-ph:terminal-window';
  }

  if (lower.includes('plan') || lower.includes('execute_plan')) {
    return 'i-ph:list-checks';
  }

  if (lower.includes('memory')) {
    return 'i-ph:brain';
  }

  return 'i-ph:wrench';
}

/**
 * Pull a one-line summary of a tool's args for the inline progress row.
 * For native tools this mimics Copilot's "Editing <file>" / "Reading <file>"
 * suffix — much more useful than the raw JSON.
 */
function summarizeArgs(toolName: string, args: any): string {
  if (!args || typeof args !== 'object') {
    return '';
  }

  try {
    switch (toolName) {
      case 'read_file':
      case 'list_dir':
      case 'create_file':
      case 'replace_string_in_file':
      case 'multi_replace_string_in_file':
        return args.filePath || args.path || '';
      case 'find_files':
        return args.pattern || '';
      case 'grep_search':
        return args.pattern || '';
      case 'web_search':
        return args.query || '';
      case 'run_in_terminal':
        return args.command || '';
      case 'execute_plan':
        return args.taskDescription?.slice(0, 80) || '';
      default:
        return '';
    }
  } catch {
    return '';
  }
}

/**
 * Result classifier. Copilot shows an error icon (codicon-error, red) for
 * failed tool calls. We inspect the result string for known error prefixes
 * emitted by nativeTools.ts.
 */
type ResultStatus = 'success' | 'error' | 'unknown';

export function classifyResult(result: any): ResultStatus {
  if (result == null) {
    return 'unknown';
  }

  if (typeof result !== 'string') {
    return 'success';
  }

  // Mutation signals are always success (they're instructions, not errors).
  if (isFileMutationSignal(result)) {
    return 'success';
  }

  const errorPrefixes = [
    'Error:',
    'File not found',
    'Edit failed',
    'Cannot edit',
    'File already exists',
    'oldString',
    'Invalid pattern',
    'Web search failed',
    'Web search error',
    'Directory is empty',
    'No files matched',
    'No matches for pattern',
    'No web results',
  ];

  return errorPrefixes.some((p) => result.startsWith(p)) ? 'error' : 'success';
}

/**
 * Render a native tool's result in a human-friendly way for the collapsible
 * details section.
 *  - Mutation tools: parse the JSON signal and show per-operation summaries
 *    (Created X, Replaced in Y, …) plus a compact preview.
 *  - Read tools: show the (possibly truncated) string.
 *  - Objects: pretty-printed JSON.
 */
function renderResult(toolName: string, result: any): { summary: string[]; preview?: string; isMutation: boolean } {
  if (result == null) {
    return { summary: ['No result'], isMutation: false };
  }

  if (typeof result === 'string') {
    if (isFileMutationSignal(result)) {
      const signal = parseFileMutationSignal(result);

      if (signal) {
        const summaries: string[] = [];

        for (const op of signal.operations) {
          if (op.op === 'create') {
            summaries.push(`Created ${op.filePath} (${op.content.length} bytes)`);
          } else if (op.op === 'replace') {
            summaries.push(`Replaced text in ${op.filePath}`);
          } else if (op.op === 'multi_replace') {
            summaries.push(`Applied ${op.edits.length} edit(s) to ${op.filePath}`);
          }
        }

        return { summary: summaries, isMutation: true };
      }
    }

    // Plain string result — show truncated.
    const truncated = result.length > 1200 ? result.slice(0, 1200) + '\n…' : result;

    return { summary: [], preview: truncated, isMutation: false };
  }

  try {
    return { summary: [], preview: JSON.stringify(result, null, 2), isMutation: false };
  } catch {
    return { summary: [String(result)], isMutation: false };
  }
}

interface ToolProgressProps {
  part: ToolInvocationUIPart;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;

  /**
   * True when this row renders INSIDE the chain-of-thought thinking list.
   * When true, the inline status icon is hidden (the chain's .chatThinkingIcon
   * represents the step instead) — exactly matching VS Code's rule:
   *   .chat-thinking-tool-wrapper .codicon.codicon-check,
   *   .chat-thinking-tool-wrapper .codicon.codicon-loading { display: none !important; }
   */
  inThinkingList?: boolean;
}

/**
 * Copilot-exact tool invocation render.
 *
 * This is NOT a card. It's a flat inline `.progress-container` row:
 *
 *   [icon] [past-tense message] [code:filePath]
 *
 * - While the tool is in flight: spinner icon + shimmer-animated message text.
 * - When the tool completes: the message turns solid (check icon hidden by
 *   default, like Copilot — only shown if `.show-checkmarks` is set).
 * - When the tool errors: a red error icon replaces the spinner.
 * - When the tool needs user approval (mutating + pending): renders a
 *   `.chat-confirmation-widget` instead of the flat row.
 *
 * Clicking the row toggles a collapsible `.tool-input-output-part` that shows
 * the args and the result — exactly like Copilot's expando.
 */
export const ToolProgress = memo(({ part, addToolResult, inThinkingList = false }: ToolProgressProps) => {
  const [showDetails, setShowDetails] = useState(false);
  const { toolInvocation } = part;
  const { toolName, args, state, result } = toolInvocation as any;

  const meta = getMeta(toolName);
  const summary = summarizeArgs(toolName, args);
  const isResult = state === 'result';
  const isPending = state === 'call';
  const readOnly = isReadOnlyNativeTool(toolName);
  const resultStatus = isResult ? classifyResult(result) : 'unknown';
  const isError = resultStatus === 'error';

  const renderedResult = useMemo(
    () => (isResult ? renderResult(toolName, result) : null),
    [isResult, toolName, result],
  );

  // Pending mutating tool → render the confirmation widget (still flat — no outer card).
  if (isPending && !readOnly) {
    return <ToolConfirmation part={part} addToolResult={addToolResult} />;
  }

  const label = isPending ? meta.pendingLabel : meta.label;

  /*
   * Shimmer the text while in flight — matches VS Code's .shimmer-progress,
   * which animates the label inside the thinking list too.
   */
  const shimmer = isPending;

  return (
    <div className={styles.toolInvocationPart}>
      {/* The flat inline progress row — exactly Copilot's .progress-container.
           When inside the thinking list, hide the inline status icon: the
           chain-of-thought .chatThinkingIcon already represents the step
           (VS Code: .chat-thinking-tool-wrapper .codicon-check/.codicon-loading
           { display: none !important }). The label still shimmers while pending. */}
      <div
        className={classNames(
          styles.progressContainer,
          shimmer && styles.shimmerProgress,
          !isPending && !isError && styles.showCheckmarks,
          inThinkingList && styles.inThinkingList,
        )}
      >
        {/* Icon: only render when NOT inside the thinking list (the chain icon handles it there) */}
        {!inThinkingList &&
          (isPending ? (
            <span className={classNames(styles.icon, 'i-ph:spinner-gap')} aria-label="loading" />
          ) : isError ? (
            <span className={classNames(styles.icon, styles.error, 'i-ph:x-circle')} aria-label="error" />
          ) : (
            <span className={classNames(styles.icon, styles.check, 'i-ph:check-circle')} aria-label="done" />
          ))}

        {/* Message + args summary — clickable to toggle details */}
        <button
          type="button"
          onClick={() => setShowDetails((v) => !v)}
          className={classNames(
            styles.progressStep,
            'bg-transparent border-none p-0 cursor-pointer text-left flex-1 min-w-0',
          )}
        >
          <span>{label}</span>
          {summary && <code>{summary}</code>}
        </button>
      </div>

      {/* Collapsible details (Copilot's .tool-input-output-part) */}
      <AnimatePresence initial={false}>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className={classNames(styles.toolInputOutputPart, styles.expanded)}>
              {/* Args */}
              <div className={styles.ioBlock}>
                <div className={styles.ioTitle}>Input</div>
                <div className={styles.ioContent}>
                  {(() => {
                    try {
                      return JSON.stringify(args, null, 2);
                    } catch {
                      return String(args);
                    }
                  })()}
                </div>
              </div>

              {/* Result */}
              {isResult && renderedResult && (
                <>
                  {renderedResult.summary.length > 0 && (
                    <div className={styles.mutationSummary}>
                      {renderedResult.summary.map((s, i) => (
                        <span key={i} className="flex items-center gap-1.5">
                          <span className={classNames(styles.checkIcon, 'i-ph:check')} />
                          <span>{s}</span>
                        </span>
                      ))}
                    </div>
                  )}

                  <div className={styles.ioBlock}>
                    <div className={styles.ioTitle}>
                      Output
                      {renderedResult.isMutation && (
                        <span className="ml-2 normal-case font-normal text-[10px] text-[color:var(--amplify-elements-icon-success)]">
                          applied to workspace
                        </span>
                      )}
                    </div>
                    {renderedResult.preview ? (
                      <div
                        className={classNames(styles.ioContent, isError && styles.error, 'max-h-72 overflow-y-auto')}
                      >
                        {renderedResult.preview}
                      </div>
                    ) : (
                      <div className={styles.ioContent}>
                        <span className="opacity-60">No output</span>
                      </div>
                    )}
                  </div>
                </>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

ToolProgress.displayName = 'ToolProgress';
