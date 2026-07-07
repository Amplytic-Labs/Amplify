import { memo, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';

/**
 * ContextBudgetIndicator
 *
 * Shows a live "context budget" pill in the chat input bar: how much of the
 * current model's context window is being used by the conversation so far.
 *
 * Data sources:
 *   - The `usage` annotation on the LAST assistant message (written by
 *     api.chat.ts on completion) gives us the cumulative promptTokens for the
 *     most recent turn — this is the most accurate "conversation so far" size.
 *   - The active model's `maxTokenAllowed` (from ModelInfo, resolved via the
 *     model selector) gives us the denominator.
 *
 * Color coding:
 *   - < 50%  → emerald (healthy)
 *   - 50-75% → amber (approaching summarization threshold)
 *   - 75-90% → orange (summarization should trigger soon)
 *   - > 90%  → red (over budget — summarization will run on next turn)
 *
 * This is a client-side estimate; the actual trigger lives server-side in
 * context-budget.ts (which uses a more accurate token counter + the real
 * maxTokenAllowed from ModelInfo). The pill is informational so the user
 * understands WHY a summarization step ran.
 */
interface ContextBudgetIndicatorProps {
  /** Active model's max context window (maxTokenAllowed from ModelInfo). */
  maxTokenAllowed?: number;

  /** Conversation messages (to read the last usage annotation). */
  messages?: any[];
}

export const ContextBudgetIndicator = memo(({ maxTokenAllowed, messages }: ContextBudgetIndicatorProps) => {
  const files = useStore(workbenchStore.files);

  // Find the last assistant message with a usage annotation
  const lastUsage = useMemo(() => {
    if (!messages || messages.length === 0) {
      return undefined;
    }

    for (let i = messages.length - 1; i >= 0; i--) {
      const msg = messages[i];

      if (msg.role !== 'assistant') {
        continue;
      }

      const annotations = msg.annotations as any[] | undefined;

      if (!annotations) {
        continue;
      }

      const usageAnn = annotations.find((a) => a?.type === 'usage');

      if (usageAnn?.value?.promptTokens) {
        return usageAnn.value;
      }
    }

    return undefined;
  }, [messages]);

  if (!maxTokenAllowed || !lastUsage?.promptTokens) {
    return null;
  }

  const used = lastUsage.promptTokens;
  const pct = Math.min(100, Math.round((used / maxTokenAllowed) * 100));

  // Don't show the pill for trivially small conversations
  if (used < 1000) {
    return null;
  }

  const formatTokens = (n: number) => {
    if (n >= 1000000) {
      return `${(n / 1000000).toFixed(1)}M`;
    }

    if (n >= 1000) {
      return `${(n / 1000).toFixed(1)}k`;
    }

    return `${n}`;
  };

  const colorClass =
    pct < 50
      ? 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400'
      : pct < 75
        ? 'bg-amber-500/10 text-amber-600 dark:text-amber-400'
        : pct < 90
          ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
          : 'bg-red-500/10 text-red-600 dark:text-red-400';

  const barColorClass =
    pct < 50 ? 'bg-emerald-500' : pct < 75 ? 'bg-amber-500' : pct < 90 ? 'bg-orange-500' : 'bg-red-500';

  const fileCount = files ? Object.keys(files).filter((k) => files[k]?.type === 'file').length : 0;

  return (
    <div
      className={classNames(
        'hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-mono font-semibold leading-none',
        colorClass,
      )}
      title={`Conversation using ~${formatTokens(used)} of ${formatTokens(maxTokenAllowed)} tokens (${pct}%)${
        fileCount > 0 ? `\n${fileCount} workspace files` : ''
      }\nSummarization triggers at 70% of usable budget`}
    >
      <div className="flex items-center gap-1">
        <div className="i-ph:gauge text-[10px]" />
        <span>
          {formatTokens(used)}/{formatTokens(maxTokenAllowed)}
        </span>
      </div>
      {/* Mini progress bar */}
      <div className="w-12 h-1 rounded-full bg-current/20 overflow-hidden">
        <div
          className={classNames('h-full rounded-full transition-all duration-300', barColorClass)}
          style={{ width: `${pct}%` }}
        />
      </div>
      <span>{pct}%</span>
    </div>
  );
});
