import React, { useCallback, useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { planStore } from '~/lib/planning/plan-store';
import type { Plan, PlanPoint, PlanPointStatus } from '~/lib/planning/types';
import type { PlanProgressUpdate } from '~/lib/planning/sub-chat-engine';

interface PlanViewProps {
  planId: string;
  progress?: PlanProgressUpdate | null;
  onCancel: () => void;
}

function StatusIcon({ status, index }: { status: PlanPointStatus; index: number }) {
  switch (status) {
    case 'pending':
      return (
        <div className="flex items-center justify-center w-6 h-6 rounded-full border-2 border-gray-400 dark:border-gray-500 bg-transparent">
          <span className="text-xs font-medium text-gray-400 dark:text-gray-500">{index + 1}</span>
        </div>
      );
    case 'in_progress':
      return (
        <div className="flex items-center justify-center w-6 h-6">
          <div className="i-ph:spinner animate-spin h-5 w-5 text-bolt-elements-buttonPrimaryColor" />
        </div>
      );
    case 'verifying':
      return (
        <div className="flex items-center justify-center w-6 h-6">
          <div className="i-ph:spinner animate-spin h-5 w-5 text-orange-500" />
        </div>
      );
    case 'completed':
      return <div className="i-ph:check-circle-fill h-6 w-6 text-green-500" />;
    case 'failed':
      return <div className="i-ph:x-circle-fill h-6 w-6 text-red-500" />;
    case 'skipped':
      return <div className="i-ph:minus h-6 w-6 text-gray-400" />;
    default:
      return null;
  }
}

function TimelineLine({ status }: { status: PlanPointStatus }) {
  const isDone = status === 'completed' || status === 'failed' || status === 'skipped';
  return (
    <div
      className={classNames(
        'absolute left-[11px] top-6 w-0.5 h-full -translate-x-1/2',
        isDone ? 'bg-gray-300 dark:bg-gray-600' : 'bg-gray-200 dark:bg-gray-700',
      )}
    />
  );
}

export const PlanView = React.memo(function PlanView({ planId, progress, onCancel }: PlanViewProps) {
  const [plan, setPlan] = useState<Plan | null>(null);

  // Poll planStore every 500ms to get the latest plan state
  useEffect(() => {
    const syncPlan = () => {
      const p = planStore.getPlan(planId);
      if (p) {
        setPlan((prev) => {
          // Only update if the plan changed (shallow compare by reference)
          if (prev === p) return prev;
          return { ...p, points: [...p.points] };
        });
      }
    };

    syncPlan();

    const interval = setInterval(syncPlan, 500);
    return () => clearInterval(interval);
  }, [planId]);

  const handleCancel = useCallback(() => {
    planStore.cancelPlan(planId);
    onCancel();
  }, [planId, onCancel]);

  if (!plan) {
    return (
      <div className="flex items-center gap-3 px-4 py-3 rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2">
        <div className="i-ph:spinner animate-spin h-5 w-5 text-bolt-elements-textSecondary" />
        <span className="text-sm text-bolt-elements-textSecondary">Loading plan...</span>
      </div>
    );
  }

  const completedCount = plan.points.filter((p) => p.status === 'completed' || p.status === 'skipped').length;
  const totalCount = plan.points.length;
  const progressPercent = totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0;

  // Find the currently active point for showing the progress message
  const activePoint = plan.points.find((p) => p.status === 'in_progress' || p.status === 'verifying');

  return (
    <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-hidden">
      {/* Header */}
      <div className="px-4 py-3 border-b border-bolt-elements-borderColor">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-2">
            <div className="i-ph:list-checks h-5 w-5 text-bolt-elements-buttonPrimaryColor" />
            <span className="text-sm font-medium text-bolt-elements-textPrimary">Executing Plan</span>
          </div>
          <span className="text-xs text-bolt-elements-textSecondary">
            {completedCount}/{totalCount} steps
          </span>
        </div>
        {/* Task description */}
        <p className="text-sm text-bolt-elements-textSecondary mt-1.5 line-clamp-2">{plan.description}</p>
        {/* Progress bar */}
        <div className="mt-2.5 h-1.5 w-full rounded-full bg-gray-200 dark:bg-gray-700 overflow-hidden">
          <div
            className="h-full rounded-full bg-bolt-elements-buttonPrimaryColor transition-all duration-500 ease-out"
            style={{ width: `${progressPercent}%` }}
          />
        </div>
      </div>

      {/* Timeline */}
      <div className="px-4 py-3 max-h-[320px] overflow-y-auto scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-bolt-elements-bg-depth-3">
        <div className="relative space-y-0">
          {plan.points.map((point, index) => (
            <div key={point.id} className="relative flex gap-3 pb-4 last:pb-0">
              {/* Timeline line (except for last item) */}
              {index < plan.points.length - 1 && <TimelineLine status={point.status} />}

              {/* Status icon */}
              <div className="relative z-10 mt-0.5 flex-shrink-0">
                <StatusIcon status={point.status} index={index} />
              </div>

              {/* Content */}
              <div className="flex-1 min-w-0 pt-px">
                <div
                  className={classNames(
                    'text-sm font-medium',
                    point.status === 'pending'
                      ? 'text-gray-400 dark:text-gray-500'
                      : point.status === 'failed'
                        ? 'text-red-500'
                        : point.status === 'skipped'
                          ? 'text-gray-400 dark:text-gray-500 line-through'
                          : 'text-bolt-elements-textPrimary',
                  )}
                >
                  {point.title}
                </div>
                {point.status === 'in_progress' && (
                  <p className="text-xs text-bolt-elements-textSecondary mt-0.5 truncate">
                    {progress?.message || 'Working...'}
                  </p>
                )}
                {point.status === 'verifying' && (
                  <p className="text-xs text-orange-500 mt-0.5">Running verification checks...</p>
                )}
                {point.status === 'failed' && point.error && (
                  <p className="text-xs text-red-400 mt-0.5 line-clamp-2">{point.error}</p>
                )}
                {point.status === 'completed' && point.summary && (
                  <p className="text-xs text-bolt-elements-textSecondary mt-0.5 line-clamp-2">{point.summary}</p>
                )}
              </div>
            </div>
          ))}
        </div>
      </div>

      {/* Footer with current progress message and cancel button */}
      <div className="px-4 py-3 border-t border-bolt-elements-borderColor">
        {progress?.message && (
          <p className="text-xs text-bolt-elements-textSecondary mb-2 truncate">{progress.message}</p>
        )}
        <button
          onClick={handleCancel}
          className="px-3 py-1 text-xs font-medium rounded border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-1 hover:text-bolt-elements-textPrimary transition-colors"
        >
          Cancel Plan
        </button>
      </div>
    </div>
  );
});