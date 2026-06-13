import React, { useCallback, useEffect, useState } from 'react';
import { planStore } from '~/lib/planning/plan-store';
import type { Plan, PlanPoint, PlanPointStatus } from '~/lib/planning/types';
import type { PlanProgressUpdate } from '~/lib/planning/sub-chat-engine';
import { TraceTree, CircularProgress, type TraceItem, type TreeItemStatus, type TreeItemType } from './TraceTree';

interface PlanViewProps {
  planId: string;
  progress?: PlanProgressUpdate | null;
  onCancel: () => void;
}

function mapPlanPointStatus(s: PlanPointStatus): TreeItemStatus {
  switch (s) {
    case 'pending':
      return 'pending';
    case 'in_progress':
      return 'running';
    case 'verifying':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'skipped':
      return 'done';
    default:
      return 'pending';
  }
}

export const PlanView = React.memo(function PlanView({ planId, progress, onCancel }: PlanViewProps) {
  const [plan, setPlan] = useState<Plan | null>(null);

  // Poll planStore every 500ms to get the latest plan state
  useEffect(() => {
    const syncPlan = () => {
      const p = planStore.getPlan(planId);
      if (p) {
        setPlan((prev) => {
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
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="i-ph:spinner animate-spin h-5 w-5 text-bolt-elements-textSecondary" />
        <span className="text-sm text-bolt-elements-textSecondary">Loading plan...</span>
      </div>
    );
  }

  const totalCount = plan.points.length;
  const isTerminal = plan.status === 'completed' || plan.status === 'failed' || plan.status === 'cancelled';

  /* Build TraceTree items from plan points */
  const traceItems: TraceItem[] = plan.points.map((point) => {
    const hasChildren =
      point.expectedFiles.length > 0 ||
      (point.verificationResults != null && point.verificationResults.length > 0) ||
      !!point.summary ||
      !!point.error;

    return {
      id: point.id,
      text: point.title,
      status: mapPlanPointStatus(point.status),
      type: (point.status === 'completed' ? 'check' : 'bullet') as TreeItemType,
      subText:
        point.status === 'in_progress'
          ? 'Working...'
          : point.status === 'verifying'
            ? 'Verifying...'
            : point.status === 'failed' && point.error
              ? point.error.slice(0, 50)
              : undefined,
      children: hasChildren ? (
        <div className="space-y-2 text-[11px]">
          {point.status === 'completed' && point.summary && <p className="text-[#8e8e8e]">{point.summary}</p>}
          {point.status === 'failed' && point.error && <p className="text-rose-400">{point.error}</p>}
          {point.expectedFiles.length > 0 && (
            <div>
              <span className="text-[#666666] font-medium">Expected files:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {point.expectedFiles.map((file) => (
                  <span
                    key={file}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-[#1a1a1a] text-[#8e8e8e] border border-[#333333]"
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                      <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                      <polyline points="14 2 14 8 20 8" />
                    </svg>
                    {file}
                  </span>
                ))}
              </div>
            </div>
          )}
          {point.verificationResults && point.verificationResults.length > 0 && (
            <div>
              <span className="text-[#666666] font-medium">Verification:</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {point.verificationResults.map((vr, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium ${
                      vr.passed
                        ? 'bg-green-500/15 text-green-500 border border-green-500/30'
                        : 'bg-red-500/15 text-red-500 border border-red-500/30'
                    }`}
                  >
                    <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                      {vr.passed ? (
                        <polyline points="20 6 9 17 4 12" />
                      ) : (
                        <>
                          <line x1="18" y1="6" x2="6" y2="18" />
                          <line x1="6" y1="6" x2="18" y2="18" />
                        </>
                      )}
                    </svg>
                    {vr.type.replace('_', ' ')}
                  </span>
                ))}
              </div>
            </div>
          )}
        </div>
      ) : undefined,
    };
  });

  /* Compute donut segments */
  const doneCount = plan.points.filter((p) => p.status === 'completed' || p.status === 'skipped').length;
  const failedCount = plan.points.filter((p) => p.status === 'failed').length;
  const pendingCount = totalCount - doneCount - failedCount;

  return (
    <div>
      {/* Trace tree with plan points + circular progress donut */}
      <TraceTree
        headerIcon="plan"
        headerText={`${plan.points.length} milestone objectives`}
        items={traceItems}
        defaultOpen={true}
        headerBadge={
          <CircularProgress
            size={26}
            strokeWidth={3.5}
            segments={[
              { value: doneCount, color: '#22c55e' },
              { value: pendingCount, color: '#3a3a3a' },
              { value: failedCount, color: '#f43f5e' },
            ]}
          >
            <span className="text-[7px] font-bold text-[#8e8e8e] leading-none">
              {doneCount}/{totalCount}
            </span>
          </CircularProgress>
        }
      />

      {/* Progress message */}
      {progress?.message && (
        <div className="px-4 py-2">
          <p className="text-xs text-bolt-elements-textSecondary truncate">{progress.message}</p>
        </div>
      )}

      {/* Footer */}
      {!isTerminal && (
        <div className="px-4 py-2.5 flex justify-start">
          <button
            onClick={handleCancel}
            className="px-3 py-1 text-[11px] font-medium rounded border border-[#333333] text-[#8e8e8e] hover:bg-[#1a1a1a] transition-colors"
          >
            Cancel Plan
          </button>
        </div>
      )}
      {plan.status === 'failed' && (
        <div className="px-4 py-2.5">
          <p className="text-[11px] text-rose-400">Plan failed — review the failed step for details.</p>
        </div>
      )}
      {plan.status === 'completed' && (
        <div className="px-4 py-2.5">
          <p className="text-[11px] text-green-500">All plan steps completed successfully.</p>
        </div>
      )}
      {plan.status === 'cancelled' && (
        <div className="px-4 py-2.5">
          <p className="text-[11px] text-[#666666]">Plan was cancelled.</p>
        </div>
      )}
    </div>
  );
});
