import { memo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import type { ToolInvocationUIPart } from '@ai-sdk/ui-utils';
import { themeStore, type Theme } from '~/lib/stores/theme';
import { useStore } from '@nanostores/react';

const TOOL_FRIENDLY_NAMES: Record<string, string> = {
  web_search: 'Searched the web',
  read_file: 'Read file',
  list_dir: 'Listed directory',
  grep_search: 'Searched in codebase',
  semantic_search: 'Performed semantic search',
  read_notebook_cell: 'Read notebook cell',
  run_in_terminal: 'Executed command',
  create_file: 'Created file',
  replace_string_in_file: 'Edited file',
  multi_replace_string_in_file: 'Edited multiple files',
};

const TOOL_ICONS: Record<string, string> = {
  web_search: 'i-ph:globe',
  read_file: 'i-ph:file-text',
  list_dir: 'i-ph:folder-open',
  grep_search: 'i-ph:magnifying-glass',
  semantic_search: 'i-ph:brain',
  read_notebook_cell: 'i-ph:notebook',
  run_in_terminal: 'i-ph:terminal-window',
  create_file: 'i-ph:file-plus',
  replace_string_in_file: 'i-ph:pencil-line',
  multi_replace_string_in_file: 'i-ph:pencil-line',
};

interface ToolInvocationItemProps {
  part: ToolInvocationUIPart;
  grouped?: boolean;
}

export const ToolInvocationItem = memo(({ part, grouped }: ToolInvocationItemProps) => {
  const theme = useStore(themeStore);
  const [showDetails, setShowDetails] = useState(false);
  const { toolInvocation } = part;
  const { toolName, args, state, result } = toolInvocation as any;

  const friendlyName = TOOL_FRIENDLY_NAMES[toolName] || `Used tool ${toolName}`;
  const icon = TOOL_ICONS[toolName] || 'i-ph:wrench';

  const toggleDetails = () => setShowDetails(!showDetails);

  return (
    <div className={classNames('flex flex-col gap-1', !grouped && 'my-2')}>
      <div
        className={classNames(
          'flex items-center gap-2 p-2 cursor-pointer transition-colors text-sm',
          'bg-bolt-elements-background-depth-2 hover:bg-bolt-elements-artifacts-backgroundHover',
          !grouped && 'rounded-md border border-bolt-elements-borderColor',
          grouped && 'border-b border-bolt-elements-borderColor last:border-b-0',
        )}
        onClick={toggleDetails}
      >
        <div className={classNames(icon, 'text-bolt-elements-textSecondary')} />
        <span className="text-bolt-elements-textPrimary font-medium">
          {state === 'call' ? `${friendlyName}...` : friendlyName}
        </span>
        {state === 'result' && <span className="text-bolt-elements-textSecondary text-xs ml-auto">Completed</span>}
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
                'p-3 text-xs font-mono bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary',
                !grouped && 'border-x border-b border-bolt-elements-borderColor rounded-b-md',
                grouped && 'border-x border-b border-bolt-elements-borderColor',
              )}
            >
              <div className="mb-2">
                <span className="font-bold text-bolt-elements-textPrimary">Tool:</span> {toolName}
              </div>
              <div className="mb-2">
                <span className="font-bold text-bolt-elements-textPrimary">Args:</span> {JSON.stringify(args, null, 2)}
              </div>
              {state === 'result' && (
                <div>
                  <span className="font-bold text-bolt-elements-textPrimary">Result:</span>{' '}
                  {JSON.stringify(result, null, 2)}
                </div>
              )}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});
