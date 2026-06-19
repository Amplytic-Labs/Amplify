import { memo, useState, useMemo } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import type { ToolInvocationUIPart } from '@ai-sdk/ui-utils';
import { parseFileMutationSignal, isFileMutationSignal, isReadOnlyNativeTool } from '~/lib/tools/nativeTools';
import { TOOL_EXECUTION_APPROVAL } from '~/utils/constants';

/**
 * Friendly display metadata for each native tool, mirroring VS Code Copilot's
 * terse past-tense phrasing ("Read file", "Edited file"). The `label` is the
 * past-tense verb phrase shown when the tool has a result; `pendingLabel` is
 * the imperative form shown while the call is in flight.
 */
interface ToolMeta {
  label: string;
  pendingLabel: string;
  icon: string;
}

const TOOL_META: Record<string, ToolMeta> = {
  web_search: { label: 'Searched the web', pendingLabel: 'Searching the web', icon: 'i-ph:globe' },
  read_file: { label: 'Read file', pendingLabel: 'Reading file', icon: 'i-ph:file-text' },
  list_dir: { label: 'Listed directory', pendingLabel: 'Listing directory', icon: 'i-ph:folder-open' },
  find_files: { label: 'Found files', pendingLabel: 'Finding files', icon: 'i-ph:list-magnifying-glass' },
  grep_search: { label: 'Searched in codebase', pendingLabel: 'Searching in codebase', icon: 'i-ph:magnifying-glass' },
  semantic_search: {
    label: 'Performed semantic search',
    pendingLabel: 'Performing semantic search',
    icon: 'i-ph:brain',
  },
  read_notebook_cell: { label: 'Read notebook cell', pendingLabel: 'Reading notebook cell', icon: 'i-ph:notebook' },
  run_in_terminal: { label: 'Executed command', pendingLabel: 'Executing command', icon: 'i-ph:terminal-window' },
  create_file: { label: 'Created file', pendingLabel: 'Creating file', icon: 'i-ph:file-plus' },
  replace_string_in_file: { label: 'Edited file', pendingLabel: 'Editing file', icon: 'i-ph:pencil-line' },
  multi_replace_string_in_file: { label: 'Edited file', pendingLabel: 'Editing file', icon: 'i-ph:pencil-line' },
  execute_plan: { label: 'Executed plan', pendingLabel: 'Executing plan', icon: 'i-ph:list-checks' },
  update_user_memory: { label: 'Updated memory', pendingLabel: 'Updating memory', icon: 'i-ph:brain' },
  read_user_memory: { label: 'Read memory', pendingLabel: 'Reading memory', icon: 'i-ph:brain' },
};

function getMeta(toolName: string): ToolMeta {
  return TOOL_META[toolName] || { label: `Used ${toolName}`, pendingLabel: `Using ${toolName}`, icon: 'i-ph:wrench' };
}

/**
 * Pull a one-line summary of a tool's args for the collapsed chip view.
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
 * Result classifier. Copilot shows a green "Done" / red "Failed" badge. We
 * inspect the result string for known error prefixes emitted by nativeTools.ts.
 */
type ResultStatus = 'success' | 'error' | 'unknown';

function classifyResult(result: any): ResultStatus {
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
 * Render a native tool's result in a human-friendly way.
 *  - Mutation tools: parse the JSON signal and show per-operation summaries
 *    (Created X, Replaced in Y, …) plus a compact diff preview.
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

interface ToolCardProps {
  part: ToolInvocationUIPart;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

/**
 * Compact Copilot-style tool invocation card.
 *
 * One card = one tool call. Two visual states:
 *
 *   1. Collapsed (default): single row — icon + friendly label + args summary
 *      + status badge + expand chevron. Click to toggle details.
 *
 *   2. Expanded: shows the tool name, a nicely formatted args block, and the
 *      result (or Approve / Cancel buttons when the mutating tool is awaiting
 *      user consent).
 *
 * Read-only native tools auto-execute (see Chat.client.tsx) so they never show
 * the approval UI — they go straight from "Reading file…" to "Read file ✓".
 */
export const ToolCard = memo(({ part, addToolResult }: ToolCardProps) => {
  const [showDetails, setShowDetails] = useState(false);
  const { toolInvocation } = part;
  const { toolName, args, state, result, toolCallId } = toolInvocation as any;

  const meta = getMeta(toolName);
  const summary = summarizeArgs(toolName, args);
  const isResult = state === 'result';
  const isPending = state === 'call';
  const readOnly = isReadOnlyNativeTool(toolName);
  const resultStatus = isResult ? classifyResult(result) : 'unknown';

  const renderedResult = useMemo(
    () => (isResult ? renderResult(toolName, result) : null),
    [isResult, toolName, result],
  );

  const toggle = () => setShowDetails((v) => !v);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <div className="copilot-tool-card">
      {/* Collapsed header row */}
      <button
        type="button"
        onClick={toggle}
        className={classNames(
          'flex items-center gap-2.5 px-3 py-2 text-left text-sm w-full min-w-0',
          'hover:bg-bolt-elements-artifacts-backgroundHover/50 transition-colors cursor-pointer',
        )}
      >
        {/* Status / icon */}
        <span className="shrink-0 flex items-center justify-center w-5 h-5">
          {isPending ? (
            <span
              className={classNames(
                'inline-block w-3.5 h-3.5 rounded-full border-2 border-bolt-elements-textTertiary/30 border-t-bolt-elements-textTertiary animate-spin',
              )}
            />
          ) : resultStatus === 'error' ? (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bolt-elements-icon-error/15">
              <span className="i-ph:x-bold text-[11px] text-bolt-elements-icon-error" />
            </span>
          ) : isResult ? (
            <span className="inline-flex items-center justify-center w-4 h-4 rounded-full bg-bolt-elements-icon-success/15">
              <span className="i-ph:check-bold text-[11px] text-bolt-elements-icon-success" />
            </span>
          ) : (
            <span className={classNames(meta.icon, 'text-base text-bolt-elements-textSecondary')} />
          )}
        </span>

        {/* Label + summary */}
        <span
          className={classNames(
            'shrink-0 font-medium',
            isPending ? 'text-bolt-elements-textSecondary' : 'text-bolt-elements-textPrimary',
          )}
        >
          {isPending ? meta.pendingLabel : meta.label}
        </span>
        {summary && (
          <span className="text-bolt-elements-textSecondary text-xs truncate font-mono min-w-0 flex-1">{summary}</span>
        )}

        {/* Status badge */}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {isResult && (
            <span
              className={classNames(
                'text-[11px] font-medium uppercase tracking-wide',
                resultStatus === 'error'
                  ? 'text-bolt-elements-icon-error'
                  : resultStatus === 'success'
                    ? 'text-bolt-elements-icon-success'
                    : 'text-bolt-elements-textTertiary',
              )}
            >
              {resultStatus === 'error' ? 'Failed' : 'Done'}
            </span>
          )}
          {isPending && (
            <span className="text-[11px] font-medium uppercase tracking-wide text-bolt-elements-textTertiary">
              {readOnly ? 'Running' : 'Pending'}
            </span>
          )}
          <span
            className={classNames(
              'i-ph:caret-right-bold text-xs text-bolt-elements-textTertiary transition-transform duration-150',
              showDetails && 'rotate-90',
            )}
          />
        </span>
      </button>

      {/* Expanded details */}
      <AnimatePresence initial={false}>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-0.5 text-xs bg-bolt-elements-background-depth-3/40 border-t border-bolt-elements-borderColor/40">
              {/* Tool name */}
              <div className="py-2 flex items-center gap-2">
                <span className="font-sans text-[10px] uppercase tracking-wider font-semibold text-bolt-elements-textTertiary">
                  Tool
                </span>
                <code className="font-mono text-bolt-elements-textSecondary">{toolName}</code>
              </div>

              {/* Args */}
              <div className="mb-2">
                <div className="font-sans text-[10px] uppercase tracking-wider font-semibold text-bolt-elements-textTertiary mb-1">
                  Args
                </div>
                <pre className="p-2.5 bg-bolt-elements-background-depth-2 rounded-md overflow-x-auto whitespace-pre-wrap break-words text-[11.5px] leading-relaxed font-mono text-bolt-elements-textSecondary border border-bolt-elements-borderColor/40">
                  {JSON.stringify(args, null, 2)}
                </pre>
              </div>

              {/* Result */}
              {isResult && renderedResult && (
                <div>
                  <div className="font-sans text-[10px] uppercase tracking-wider font-semibold text-bolt-elements-textTertiary mb-1">
                    Result
                    {renderedResult.isMutation && (
                      <span className="ml-2 normal-case font-normal text-bolt-elements-icon-success">
                        applied to workspace
                      </span>
                    )}
                  </div>

                  {renderedResult.summary.length > 0 && (
                    <ul className="mb-2 space-y-0.5">
                      {renderedResult.summary.map((s, i) => (
                        <li key={i} className="flex items-start gap-1.5 text-bolt-elements-textSecondary">
                          <span className="i-ph:check text-[11px] text-bolt-elements-icon-success mt-0.5 shrink-0" />
                          <span className="font-mono text-[11.5px] break-all">{s}</span>
                        </li>
                      ))}
                    </ul>
                  )}

                  {renderedResult.preview && (
                    <pre className="p-2.5 bg-bolt-elements-background-depth-2 rounded-md overflow-x-auto whitespace-pre-wrap break-words text-[11.5px] leading-relaxed font-mono text-bolt-elements-textSecondary border border-bolt-elements-borderColor/40 max-h-72 overflow-y-auto">
                      {renderedResult.preview}
                    </pre>
                  )}
                </div>
              )}

              {/* Approval UI for pending mutating tools */}
              {isPending && !readOnly && (
                <div className="mt-3 flex items-center justify-end gap-2 font-sans">
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2 transition-colors"
                    onClick={() => addToolResult({ toolCallId, result: TOOL_EXECUTION_APPROVAL.REJECT })}
                  >
                    Cancel
                    <span className="opacity-60 text-[10px] ml-1.5">{isMac ? '⌘⌫' : 'Ctrl+⌫'}</span>
                  </button>
                  <button
                    type="button"
                    className="px-3.5 py-1.5 rounded-md text-xs font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent hover:opacity-90 transition-opacity inline-flex items-center gap-1.5"
                    onClick={() => addToolResult({ toolCallId, result: TOOL_EXECUTION_APPROVAL.APPROVE })}
                  >
                    <span className="i-ph:play text-xs" />
                    Run tool
                    <span className="opacity-60 text-[10px]">{isMac ? '⌘↵' : 'Ctrl+↵'}</span>
                  </button>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

ToolCard.displayName = 'ToolCard';
