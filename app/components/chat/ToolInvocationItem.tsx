import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { getToolNameFromPart, getToolState, getToolInput, getToolOutput, ToolState } from '~/lib/chat/tool-parts';
import { parseFileMutationSignal, isFileMutationSignal } from '~/lib/tools/nativeTools';

/**
 * Friendly display names for the native Copilot-style tools.
 * Mirrors the look-and-feel of VSCode Copilot's tool invocation chips.
 */
const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  // Native tools
  web_search: 'Searched the web',
  fetch_webpage: 'Read web page',
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
  fetch_webpage: 'i-ph:globe',
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
 * Extract a one-line summary of a tool's args for the collapsed view.
 * For native tools, this mimics Copilot's "Editing <file>" / "Reading <file>"
 * chip — much more useful than the raw JSON.
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
      case 'fetch_webpage':
        try {
          const u = new URL(args.url);
          return u.host + u.pathname.slice(0, 40);
        } catch {
          return args.url || '';
        }
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
 * Render the result of a native tool in a human-friendly way.
 * For mutation tools, we parse the mutation signal and show the operations.
 * For other tools, we show the truncated string result.
 */
function renderResult(toolName: string, result: any): string {
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

    return result.length > 400 ? result.slice(0, 400) + '...' : result;
  }

  try {
    return JSON.stringify(result, null, 2);
  } catch {
    return String(result);
  }
}

interface ToolInvocationItemProps {
  /**
   * v7 tool part (`type: 'tool-<name>'` or `'dynamic-tool'`) OR legacy v4
   * `tool-invocation` part. Both shapes are accepted.
   */
  part: any;
  grouped?: boolean;
}

export const ToolInvocationItem = memo(({ part, grouped }: ToolInvocationItemProps) => {
  const [showDetails, setShowDetails] = useState(false);

  /*
   * v7 migration: tool fields are FLAT on the part. The shared helpers
   * handle both v7 and legacy v4 nested shapes.
   */
  const toolName = getToolNameFromPart(part);
  const args = getToolInput(part);
  const state = getToolState(part);
  const result = getToolOutput(part);

  const friendlyName = TOOL_FRIENDLY_NAMES[toolName] || `Used tool ${toolName}`;
  const icon = TOOL_ICONS[toolName] || 'i-ph:wrench';
  const summary = summarizeArgs(toolName, args);

  const toggleDetails = () => setShowDetails(!showDetails);

  const isResult = ToolState.isResult(state);

  /*
   * SINGLE-RULE CONVENTION (see nativeTools.ts → buildNativeTools docstring):
   * a tool result is an error IFF its string starts with `Error:`. Everything
   * else (no results, empty, not available, hint messages) is a success.
   * New tools that follow the convention get correct UI without edits here.
   */
  const isError = typeof result === 'string' && result.startsWith('Error:');

  return (
    <div className={classNames('flex flex-col gap-1', !grouped && 'my-2')}>
      <div
        className={classNames(
          'flex items-center gap-2 p-2 cursor-pointer transition-colors text-sm',
          'bg-amplify-elements-background-depth-2 hover:bg-amplify-elements-artifacts-backgroundHover',
          !grouped && 'rounded-md border border-amplify-elements-borderColor',
          grouped && 'border-b border-amplify-elements-borderColor last:border-b-0',
        )}
        onClick={toggleDetails}
      >
        <div className={classNames(icon, 'text-amplify-elements-textSecondary')} />
        <span className="text-amplify-elements-textPrimary font-medium">
          {ToolState.isCall(state) ? `${friendlyName}...` : friendlyName}
        </span>
        {summary && (
          <span className="text-amplify-elements-textSecondary text-xs truncate max-w-md font-mono">{summary}</span>
        )}
        {isResult && (
          <span
            className={classNames(
              'text-xs ml-auto',
              isError ? 'text-amplify-elements-icon-error' : 'text-amplify-elements-icon-success',
            )}
          >
            {isError ? 'Failed' : 'Done'}
          </span>
        )}
      </div>

      <AnimatePresence>
        {showDetails && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            className="overflow-hidden"
          >
            <div
              className={classNames(
                'p-3 text-xs font-mono bg-amplify-elements-background-depth-3 text-amplify-elements-textSecondary',
                !grouped && 'border-x border-b border-amplify-elements-borderColor rounded-b-md',
                grouped && 'border-x border-b border-amplify-elements-borderColor',
              )}
            >
              <div className="mb-2">
                <span className="font-bold text-amplify-elements-textPrimary">Tool:</span> {toolName}
              </div>
              <div className="mb-2">
                <span className="font-bold text-amplify-elements-textPrimary">Args:</span>{' '}
                <pre className="mt-1 p-2 bg-amplify-elements-background-depth-2 rounded overflow-x-auto">
                  {JSON.stringify(args, null, 2)}
                </pre>
              </div>
              {isResult && (
                <div>
                  <span className="font-bold text-amplify-elements-textPrimary">Result:</span>
                  <pre className="mt-1 p-2 bg-amplify-elements-background-depth-2 rounded overflow-x-auto whitespace-pre-wrap break-words">
                    {renderResult(toolName, result)}
                  </pre>
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
