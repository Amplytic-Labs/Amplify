import { memo } from 'react';
import { classNames } from '~/utils/classNames';
import { ToolProgress, getToolIcon, classifyResult } from './ToolProgress';
import { getToolNameFromPart, getToolState, getToolOutput } from '~/lib/chat/tool-parts';
import styles from './chat-copilot.module.scss';

/**
 * Standalone inline tool row — used for tools-only segments (no reasoning).
 *
 * Visual: `[tool-type-icon] [ToolProgress row]`
 *
 *   [globe] Searched the web  "best react charts"
 *   [pencil] Edited file  src/index.ts
 *   [book] Read file  src/App.tsx
 *
 * - SAME flat inline row layout as inside the ThoughtsPanel chain.
 * - The tool-type icon (globe / pencil / book / wrench / etc.) sits on the
 *   left, identical to how it would appear on the chain line.
 * - Click the row to expand args + result details (handled by ToolProgress).
 * - NO chain-of-thought vertical line.
 * - NO "Thought for Ns" collapsible header.
 * - NO card / border / box around the row.
 *
 * This is the rendering path for non-reasoning models: when a model emits a
 * tool call without any surrounding `<thought>` text or native `reasoning`
 * parts, we don't wrap it in a misleading "Thought for Ns" panel — we just
 * show the tool call inline, exactly like ChatGPT / Claude.ai do.
 *
 * `inThinkingList={true}` is passed to ToolProgress so it hides its own
 * inline status icon (spinner/check/error). The status is conveyed by the
 * label shimmer (while pending) and the tool-type icon's red coloring (on
 * error), matching the chain rendering exactly.
 */
interface InlineToolRowProps {
  part: any;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
}

export const InlineToolRow = memo(({ part, addToolResult }: InlineToolRowProps) => {
  const toolName = getToolNameFromPart(part);
  const state = getToolState(part);
  const result = getToolOutput(part);

  /*
   * v7 'output-error' is itself an error; v7 'output-available' (v4 'result')
   * is an error only when the result string starts with `Error:`.
   */
  const isError = state === 'output-error' || (state === 'output-available' && classifyResult(result) === 'error');

  const toolIcon = getToolIcon(toolName);

  return (
    <div className={styles.chatThinkingToolWrapper} data-standalone="true">
      <span className={classNames(styles.chatThinkingIconStandalone, toolIcon, isError && styles.error)} aria-hidden />
      <ToolProgress part={part} addToolResult={addToolResult} inThinkingList />
    </div>
  );
});

InlineToolRow.displayName = 'InlineToolRow';
