import { memo, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import * as Popover from '@radix-ui/react-popover';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { motion, AnimatePresence } from 'framer-motion';

/**
 * ContextBudgetIndicator
 *
 * A live "context budget" pill in the chat input bar showing how much of the
 * current model's context window is being consumed by the conversation.
 *
 * Click to open a detailed popover with:
 *   - Model name + context window
 *   - Tokens used so far
 *   - The summarization trigger threshold (70% of usable budget)
 *   - A visual progress bar with color-coded zones
 *   - Workspace file count
 *
 * Color coding:
 *   - < 50%  → emerald (healthy)
 *   - 50-70% → amber (comfortable)
 *   - 70-90% → orange (summarization will trigger on next turn)
 *   - > 90%  → red (over budget — summarization runs now)
 *
 * When over 70%, the status dot pulses to draw attention.
 *
 * The actual trigger lives server-side in context-budget.ts (which uses a
 * more accurate token counter + the real maxTokenAllowed from ModelInfo).
 * This pill is informational so the user understands WHY a summarization
 * step ran.
 */
interface ContextBudgetIndicatorProps {
  /** Active model's max context window (maxTokenAllowed from ModelInfo). */
  maxTokenAllowed?: number;

  /** Conversation messages (to read the last usage annotation). */
  messages?: any[];

  /** Active model name for display in the popover. */
  modelName?: string;
}

export const ContextBudgetIndicator = memo(({ maxTokenAllowed, messages, modelName }: ContextBudgetIndicatorProps) => {
  const files = useStore(workbenchStore.files);
  const [open, setOpen] = useState(false);

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

  // Reserve estimates matching context-budget.ts (8192 system + ~8192 completion)
  const systemReserve = 8192;
  const completionReserve = 8192;
  const usableBudget = Math.max(0, maxTokenAllowed - systemReserve - completionReserve);
  const triggerThreshold = Math.floor(usableBudget * 0.7);
  const triggerPct = Math.min(100, Math.round((used / triggerThreshold) * 100));

  const isOverTrigger = used >= triggerThreshold;

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

  const dotColorClass = isOverTrigger
    ? 'bg-red-500'
    : pct < 50
      ? 'bg-emerald-500'
      : pct < 75
        ? 'bg-amber-500'
        : 'bg-orange-500';

  const fileCount = files ? Object.keys(files).filter((k) => files[k]?.type === 'file').length : 0;

  return (
    <Popover.Root open={open} onOpenChange={setOpen}>
      <Popover.Trigger asChild>
        <button
          type="button"
          className={classNames(
            'hidden sm:flex items-center gap-1.5 px-2 py-1 rounded-lg text-[9px] font-mono font-semibold leading-none',
            'transition-all duration-200 hover:scale-[1.03] hover:shadow-md cursor-pointer',
            'focus:outline-none focus-visible:ring-2 focus-visible:ring-primary/40',
            colorClass,
          )}
          title={`Conversation using ~${formatTokens(used)} of ${formatTokens(maxTokenAllowed)} tokens (${pct}%)`}
          aria-label={`Context budget: ${pct}% used. Click for details.`}
        >
          {/* Pulsing status dot — pulses when over the summarization trigger */}
          <span className="relative flex h-1.5 w-1.5">
            {isOverTrigger && (
              <span
                className={classNames(
                  'absolute inline-flex h-full w-full rounded-full opacity-75 animate-ping',
                  dotColorClass,
                )}
              />
            )}
            <span className={classNames('relative inline-flex rounded-full h-1.5 w-1.5', dotColorClass)} />
          </span>
          <span>
            {formatTokens(used)}/{formatTokens(maxTokenAllowed)}
          </span>
          {/* Mini progress bar */}
          <div className="w-10 h-1 rounded-full bg-current/20 overflow-hidden">
            <div
              className={classNames('h-full rounded-full transition-all duration-500', barColorClass)}
              style={{ width: `${pct}%` }}
            />
          </div>
          <span>{pct}%</span>
        </button>
      </Popover.Trigger>
      <AnimatePresence>
        {open && (
          <Popover.Portal forceMount>
            <Popover.Content sideOffset={8} align="end" className="z-[100] outline-none w-[280px]" asChild>
              <motion.div
                initial={{ opacity: 0, y: -6, scale: 0.96 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: -6, scale: 0.96 }}
                transition={{ duration: 0.16, ease: 'easeOut' }}
                className={classNames(
                  'rounded-xl border border-amplify-elements-borderColor',
                  'bg-amplify-elements-background-depth-1 shadow-2xl',
                  'p-3 text-xs',
                )}
              >
                {/* Header */}
                <div className="flex items-center justify-between mb-2.5">
                  <div className="flex items-center gap-1.5">
                    <span className="i-ph:gauge-fill text-sm text-primary" />
                    <span className="font-semibold text-amplify-elements-textPrimary">Context Budget</span>
                  </div>
                  {modelName && (
                    <span className="font-mono text-[10px] px-1.5 py-0.5 rounded bg-amplify-elements-item-backgroundAccent text-amplify-elements-item-contentAccent">
                      {modelName}
                    </span>
                  )}
                </div>

                {/* Big token readout */}
                <div className="flex items-baseline gap-1.5 mb-2">
                  <span className="text-lg font-bold font-mono text-amplify-elements-textPrimary">
                    {formatTokens(used)}
                  </span>
                  <span className="text-amplify-elements-textSecondary">/ {formatTokens(maxTokenAllowed)} tokens</span>
                </div>

                {/* Full-width progress bar with trigger marker */}
                <div className="relative h-2 rounded-full bg-amplify-elements-background-depth-3 overflow-visible mb-1.5">
                  <div
                    className={classNames('h-full rounded-full transition-all duration-500', barColorClass)}
                    style={{ width: `${pct}%` }}
                  />
                  {/* Summarization trigger marker at 70% of usable */}
                  <div
                    className="absolute top-1/2 -translate-y-1/2 w-0.5 h-3 bg-red-500/70"
                    style={{ left: `${Math.min(100, (triggerThreshold / maxTokenAllowed) * 100)}%` }}
                    title={`Summarization trigger at ${formatTokens(triggerThreshold)} tokens`}
                  />
                </div>

                {/* Legend */}
                <div className="flex items-center justify-between text-[10px] text-amplify-elements-textSecondary mb-3">
                  <span>0</span>
                  <span className="flex items-center gap-1">
                    <span className="inline-block w-0.5 h-2 bg-red-500/70" />
                    trigger ~{formatTokens(triggerThreshold)}
                  </span>
                  <span>{formatTokens(maxTokenAllowed)}</span>
                </div>

                {/* Detail rows */}
                <div className="space-y-1.5 font-mono text-[10px]">
                  <div className="flex justify-between">
                    <span className="text-amplify-elements-textSecondary">Used</span>
                    <span className="text-amplify-elements-textPrimary font-semibold">{formatTokens(used)}</span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amplify-elements-textSecondary">Remaining</span>
                    <span className="text-amplify-elements-textPrimary">
                      {formatTokens(Math.max(0, maxTokenAllowed - used))}
                    </span>
                  </div>
                  <div className="flex justify-between">
                    <span className="text-amplify-elements-textSecondary">Summarization trigger</span>
                    <span className={isOverTrigger ? 'text-red-500 font-semibold' : 'text-amber-500'}>
                      {formatTokens(triggerThreshold)} {isOverTrigger && '✓'}
                    </span>
                  </div>
                  {fileCount > 0 && (
                    <div className="flex justify-between">
                      <span className="text-amplify-elements-textSecondary">Workspace files</span>
                      <span className="text-amplify-elements-textPrimary">{fileCount}</span>
                    </div>
                  )}
                </div>

                {/* Status banner */}
                <div
                  className={classNames(
                    'mt-3 px-2 py-1.5 rounded-lg text-[10px] leading-snug',
                    isOverTrigger
                      ? 'bg-red-500/10 text-red-600 dark:text-red-400'
                      : triggerPct > 80
                        ? 'bg-orange-500/10 text-orange-600 dark:text-orange-400'
                        : 'bg-emerald-500/10 text-emerald-600 dark:text-emerald-400',
                  )}
                >
                  {isOverTrigger ? (
                    <>Conversation condensed on the last turn to fit the context window.</>
                  ) : triggerPct > 80 ? (
                    <>Approaching context limit — the next turn will condense older messages.</>
                  ) : (
                    <>Healthy. Older messages will be summarized once you near the limit.</>
                  )}
                </div>

                <Popover.Arrow className="fill-amplify-elements-background-depth-1" />
              </motion.div>
            </Popover.Content>
          </Popover.Portal>
        )}
      </AnimatePresence>
    </Popover.Root>
  );
});

ContextBudgetIndicator.displayName = 'ContextBudgetIndicator';
