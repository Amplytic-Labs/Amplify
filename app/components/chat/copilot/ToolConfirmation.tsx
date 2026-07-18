import { memo } from 'react';
import { classNames } from '~/utils/classNames';
import { TOOL_EXECUTION_APPROVAL } from '~/utils/constants';
import { getMeta } from './ToolProgress';
import {
  getToolNameFromPart,
  getToolCallId,
  getToolInput,
} from '~/lib/chat/tool-parts';
import styles from './chat-copilot.module.scss';

interface ToolConfirmationProps {
  /**
   * v7 tool part (`type: 'tool-<name>'` or `'dynamic-tool'`) OR legacy v4
   * `tool-invocation` part. Both shapes are accepted.
   */
  part: any;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

/**
 * Copilot-exact `.chat-confirmation-widget` for pending mutating tools.
 *
 * VS Code Copilot shows a flat (no outer card border) widget with:
 *   - Title row: [tool icon] [tool name + past-tense label]
 *   - Message container: bordered box with the tool's input (JSON)
 *   - Buttons row: [Allow Once] (primary) [Skip] (secondary)
 *
 * This is NOT a card around the tool call — it's a styled confirmation
 * surface that appears INSTEAD of the flat progress row while the tool is
 * waiting for user consent.
 */
export const ToolConfirmation = memo(({ part, addToolResult }: ToolConfirmationProps) => {
  const toolName = getToolNameFromPart(part);
  const args = getToolInput(part);
  const toolCallId = getToolCallId(part);
  const meta = getMeta(toolName);

  const isMac = typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.platform);

  let inputJson = '';

  try {
    inputJson = JSON.stringify(args, null, 2);
  } catch {
    inputJson = String(args ?? '');
  }

  return (
    <div className={styles.chatConfirmationWidget}>
      {/* Title row */}
      <div className={styles.title}>
        <span className={classNames(styles.titleIcon, 'i-ph:wrench')} />
        <span className={styles.titleText}>{meta.pendingLabel}</span>
      </div>

      {/* Message container — bordered box with the tool input */}
      <div className={styles.messageContainer}>
        <div className={styles.message}>
          <h3>Input</h3>
          <pre className="m-0 font-mono text-[11.5px] whitespace-pre-wrap break-words">{inputJson}</pre>
        </div>
      </div>

      {/* Buttons */}
      <div className={styles.buttonsContainer}>
        <div className={styles.buttons}>
          <button
            type="button"
            className={classNames(styles.button, styles.secondary)}
            onClick={() => addToolResult({ toolCallId, result: TOOL_EXECUTION_APPROVAL.REJECT })}
          >
            Skip
            <span className="opacity-60 text-[10px] ml-1">{isMac ? '⌘⌫' : 'Ctrl+⌫'}</span>
          </button>
          <button
            type="button"
            className={classNames(styles.button, styles.primary)}
            onClick={() => addToolResult({ toolCallId, result: TOOL_EXECUTION_APPROVAL.APPROVE })}
          >
            <span className="i-ph:play text-[10px]" />
            Allow Once
            <span className="opacity-60 text-[10px] ml-1">{isMac ? '⌘↵' : 'Ctrl+↵'}</span>
          </button>
        </div>
      </div>
    </div>
  );
});

ToolConfirmation.displayName = 'ToolConfirmation';
