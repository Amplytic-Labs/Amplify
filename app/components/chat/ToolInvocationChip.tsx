import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import type { ToolInvocationUIPart } from '@ai-sdk/ui-utils';
import { parseFileMutationSignal, isFileMutationSignal } from '~/lib/tools/nativeTools';
import {
  TOOL_EXECUTION_APPROVAL,
} from '~/utils/constants';

/**
 * Friendly display labels for each native tool, mirroring VSCode
 * Copilot's terse past-tense phrasing ("Read file", "Edited file").
 */
const TOOL_LABELS: Record<string, string> = {
  web_search: 'Searched the web',
  read_file: 'Read file',
  list_dir: 'Listed directory',
  find_files: 'Found files',
  grep_search: 'Searched in codebase',
  replace_string_in_file: 'Edited file',
  multi_replace_string_in_file: 'Edited file',
  create_file: 'Created file',

  // Legacy / sentinel names from earlier prototypes
  semantic_search: 'Performed semantic search',
  read_notebook_cell: 'Read notebook cell',
  run_in_terminal: 'Executed command',
};

const TOOL_ICONS: Record<string, string> = {
  web_search: 'i-ph:globe',
  read_file: 'i-ph:file-text',
  list_dir: 'i-ph:folder-open',
  find_files: 'i-ph:list-magnifying-glass',
  grep_search: 'i-ph:magnifying-glass',
  semantic_search: 'i-ph:brain',
  read_notebook_cell: 'i-ph:notebook',
  run_in_terminal: 'i-ph:terminal-window',
  create_file: 'i-ph:file-plus',
  replace_string_in_file: 'i-ph:pencil-line',
  multi_replace_string_in_file: 'i-ph:pencil-line',
};

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
        return args.filePath || '';
      case 'list_dir':
        return args.path || '';
      case 'find_files':
        return args.pattern || '';
      case 'grep_search':
        return args.pattern || '';
      case 'web_search':
        return args.query || '';
      case 'create_file':
        return args.filePath || '';
      case 'replace_string_in_file':
      case 'multi_replace_string_in_file':
        return args.filePath || '';
      default:
        return '';
    }
  } catch {
    return '';
  }
}

/**
 * Render a native tool's result in a human-friendly way.
 * Mutation tools: parse the JSON signal and show per-operation summaries.
 * Read tools: show a truncated string.
 */
function renderResultSummary(toolName: string, result: any): string {
  if (result == null) {
    return '';
  }

  if (typeof result === 'string') {
    if (isFileMutationSignal(result)) {
      const signal = parseFileMutationSignal(result);

      if (signal) {
        return signal.operations
          .map((op) => {
            if (op.op === 'create') {
              return `Created ${op.filePath} (${op.content.length} bytes)`;
            }

            if (op.op === 'replace') {
              return `Replaced text in ${op.filePath}`;
            }

            if (op.op === 'multi_replace') {
              return `Applied ${op.edits.length} edit(s) to ${op.filePath}`;
            }

            return JSON.stringify(op);
          })
          .join('\n');
      }
    }

    return result.length > 600 ? result.slice(0, 600) + '…' : result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

interface ToolInvocationChipProps {
  part: ToolInvocationUIPart;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  isFirst?: boolean;
  isLast?: boolean;
}

/**
 * Compact Copilot-style tool chip rendered INSIDE the ThoughtProcess
 * panel. One chip = one tool call. The chip has two states:
 *
 *   1. Collapsed (default): single row with icon + friendly name +
 *      args summary + status badge. Click to expand details.
 *
 *   2. Expanded: shows args JSON, result (or approval buttons if the
 *      tool is awaiting user consent for a mutating tool).
 *
 * When the tool is in `state === 'call'` (awaiting approval), the
 * expanded view shows Approve / Cancel buttons that call back into
 * `addToolResult` — same flow as the legacy ToolInvocations component.
 */
export const ToolInvocationChip = memo(({ part, addToolResult, isFirst, isLast }: ToolInvocationChipProps) => {
  const [showDetails, setShowDetails] = useState(false);
  const { toolInvocation } = part;
  const { toolName, args, state, result, toolCallId } = toolInvocation as any;

  const label = TOOL_LABELS[toolName] || `Used tool ${toolName}`;
  const icon = TOOL_ICONS[toolName] || 'i-ph:wrench';
  const summary = summarizeArgs(toolName, args);

  const isResult = state === 'result';
  const isPending = state === 'call';

  const isError =
    typeof result === 'string' &&
    (result.startsWith('Error:') ||
      result.startsWith('File not found') ||
      result.startsWith('Edit failed') ||
      result.startsWith('Cannot edit') ||
      result.startsWith('File already exists') ||
      result.startsWith('oldString') ||
      result.startsWith('Invalid pattern') ||
      result.startsWith('Web search failed') ||
      result.startsWith('Web search error'));

  const toggle = () => setShowDetails((v) => !v);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  return (
    <div
      className={classNames(
        'flex flex-col',
        !isFirst && 'border-t border-bolt-elements-borderColor/50',
      )}
    >
      {/* Chip header row */}
      <button
        type="button"
        onClick={toggle}
        className={classNames(
          'flex items-center gap-2 px-3 py-2 text-left text-sm w-full',
          'hover:bg-bolt-elements-artifacts-backgroundHover/40 transition-colors cursor-pointer',
        )}
      >
        <div className={classNames(icon, 'text-bolt-elements-textSecondary text-base shrink-0')} />
        <span className="text-bolt-elements-textPrimary font-medium shrink-0">
          {isPending ? `${label}…` : label}
        </span>
        {summary && (
          <span className="text-bolt-elements-textSecondary text-xs truncate font-mono ml-1">{summary}</span>
        )}
        <span className="ml-auto flex items-center gap-2 shrink-0">
          {isResult && (
            <span
              className={classNames(
                'text-[11px] uppercase tracking-wide',
                isError ? 'text-bolt-elements-icon-error' : 'text-bolt-elements-icon-success',
              )}
            >
              {isError ? 'Failed' : 'Done'}
            </span>
          )}
          {isPending && (
            <span className="text-[11px] uppercase tracking-wide text-bolt-elements-textTertiary">Pending</span>
          )}
          <div
            className={classNames(
              'i-ph:caret-right-bold text-xs text-bolt-elements-textTertiary transition-transform',
              showDetails && 'rotate-90',
            )}
          />
        </span>
      </button>

      {/* Expanded details */}
      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.18, ease: 'easeInOut' }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1 text-xs font-mono bg-bolt-elements-background-depth-3/60 text-bolt-elements-textSecondary">
              <div className="mb-2">
                <span className="font-bold text-bolt-elements-textPrimary font-sans text-[11px] uppercase tracking-wide">
                  Tool
                </span>{' '}
                <span className="font-sans">{toolName}</span>
              </div>
              <div className="mb-2">
                <span className="font-bold text-bolt-elements-textPrimary font-sans text-[11px] uppercase tracking-wide">
                  Args
                </span>
                <pre className="mt-1 p-2 bg-bolt-elements-background-depth-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                  {JSON.stringify(args, null, 2)}
                </pre>
              </div>

              {isResult && (
                <div>
                  <span className="font-bold text-bolt-elements-textPrimary font-sans text-[11px] uppercase tracking-wide">
                    Result
                  </span>
                  <pre className="mt-1 p-2 bg-bolt-elements-background-depth-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                    {renderResultSummary(toolName, result)}
                  </pre>
                </div>
              )}

              {isPending && (
                <div className="mt-3 flex items-center justify-end gap-2 font-sans">
                  <button
                    type="button"
                    className="px-2.5 py-1.5 rounded-md text-xs text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
                    onClick={() =>
                      addToolResult({ toolCallId, result: TOOL_EXECUTION_APPROVAL.REJECT })
                    }
                  >
                    Cancel <span className="opacity-60 text-[10px] ml-1">{isMac ? '⌘⌫' : 'Ctrl+⌫'}</span>
                  </button>
                  <button
                    type="button"
                    className="px-3 py-1.5 rounded-md text-xs font-medium bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent hover:opacity-90 transition-opacity inline-flex items-center gap-2"
                    onClick={() =>
                      addToolResult({ toolCallId, result: TOOL_EXECUTION_APPROVAL.APPROVE })
                    }
                  >
                    Run tool <span className="opacity-60 text-[10px]">{isMac ? '⌘↵' : 'Ctrl+↵'}</span>
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
