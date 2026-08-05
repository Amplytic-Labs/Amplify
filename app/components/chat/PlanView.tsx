import React, { useCallback, useEffect, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { planStore } from '~/lib/planning/plan-store';
import { ExecutionManager } from '~/lib/planning/execution-manager';
import { ExecutionStateManager } from '~/lib/planning/execution-state';
import type { Plan, PlanPoint, PlanPointStatus, Checkpoint } from '~/lib/planning/types';
import type { PlanProgressUpdate } from '~/lib/planning/sub-chat-engine';
import { TraceTree, CircularProgress, type TraceItem, type TreeItemStatus, type TreeItemType } from './TraceTree';

/* ================================================================== */
/*  CSS KEYFRAME ANIMATIONS (injected once)                            */
/* ================================================================== */

const STYLE_ID = 'plan-view-animations';

function injectAnimations() {
  if (typeof document === 'undefined') {
    return;
  }

  if (document.getElementById(STYLE_ID)) {
    return;
  }

  const style = document.createElement('style');
  style.id = STYLE_ID;
  style.textContent = `
    @keyframes pv-pulse {
      0%, 100% { opacity: 1; }
      50% { opacity: 0.5; }
    }
    @keyframes pv-spin {
      from { transform: rotate(0deg); }
      to { transform: rotate(360deg); }
    }
    @keyframes pv-glow {
      0%, 100% { box-shadow: 0 0 4px 0 rgba(168, 85, 247, 0.3); }
      50% { box-shadow: 0 0 12px 2px rgba(168, 85, 247, 0.5); }
    }
    @keyframes pv-shimmer {
      0% { background-position: -200% 0; }
      100% { background-position: 200% 0; }
    }
    @keyframes pv-progress-fill {
      from { width: 0%; }
    }
    .pv-badge-pulse {
      animation: pv-pulse 2s cubic-bezier(0.4, 0, 0.6, 1) infinite;
    }
    .pv-spin {
      animation: pv-spin 1s linear infinite;
    }
    .pv-chip-hover:hover {
      box-shadow: 0 0 8px 1px rgba(168, 85, 247, 0.4);
    }
    .pv-resume-btn {
      background: linear-gradient(135deg, #16a34a, #22c55e, #4ade80);
      background-size: 200% 200%;
      animation: pv-shimmer 3s ease infinite;
    }
    .pv-resume-btn:hover {
      background: linear-gradient(135deg, #15803d, #16a34a, #22c55e);
    }
  `;
  document.head.appendChild(style);
}

interface PlanViewProps {
  planId: string;
  progress?: PlanProgressUpdate | null;
  onCancel: () => void;
  onResume?: () => void;
}

function mapPlanPointStatus(s: PlanPointStatus): TreeItemStatus {
  switch (s) {
    case 'pending':
      return 'pending';
    case 'preparing':
    case 'in_progress':
    case 'waiting_for_tool':
    case 'waiting_for_user':
    case 'verifying':
      return 'running';
    case 'completed':
      return 'done';
    case 'failed':
      return 'failed';
    case 'skipped':
    case 'cancelled':
      return 'done';
    default:
      return 'pending';
  }
}

/* ================================================================== */
/*  Execution State Badge                                              */
/* ================================================================== */

/**
 * Renders the execution state badge for a plan point.
 * Enhanced with pulse animation for running, spinner for preparing,
 * and proper dark mode support.
 */
function ExecutionStateBadge({ point }: { point: PlanPoint }) {
  const stateInfo = ExecutionStateManager.describeState(point);
  const isRunning = point.executionState?.status === 'running';
  const isPreparing = point.executionState?.status === 'preparing';

  return (
    <div className="flex items-center gap-1.5 mt-1">
      {/* Status dot / spinner */}
      {isPreparing ? (
        <svg
          width="10"
          height="10"
          viewBox="0 0 24 24"
          fill="none"
          className="pv-spin shrink-0"
          style={{ color: stateInfo.color }}
        >
          <circle
            cx="12"
            cy="12"
            r="10"
            stroke="currentColor"
            strokeWidth="3"
            strokeDasharray="31.4 31.4"
            strokeLinecap="round"
          />
        </svg>
      ) : (
        <span
          className={`inline-block w-1.5 h-1.5 rounded-full shrink-0 transition-colors duration-300 ${
            isRunning ? 'pv-badge-pulse' : ''
          }`}
          style={{ backgroundColor: stateInfo.color }}
        />
      )}
      <span
        className={`text-[10px] font-medium transition-colors duration-300 ${isRunning ? 'pv-badge-pulse' : ''}`}
        style={{ color: stateInfo.color }}
      >
        {stateInfo.label}
      </span>
      {stateInfo.detail && (
        <span className="text-[10px] text-[#666] dark:text-gray-500 truncate max-w-[180px] transition-colors duration-300">
          {stateInfo.detail}
        </span>
      )}
    </div>
  );
}

/* ================================================================== */
/*  Checkpoint Timeline                                                */
/* ================================================================== */

/**
 * Renders a checkpoint list as a vertical timeline with colored nodes.
 * Completed checkpoints = green, interrupted (has remaining work) = amber.
 */
function CheckpointList({ checkpoints }: { checkpoints: Checkpoint[] }) {
  if (checkpoints.length === 0) {
    return null;
  }

  return (
    <div className="mt-2">
      <span className="text-[10px] text-[#666] dark:text-gray-500 font-medium mb-1.5 block">Checkpoints</span>
      <div className="relative ml-1">
        {/* Vertical timeline line */}
        <div className="absolute left-[4px] top-1 bottom-1 w-px bg-[#333] dark:bg-gray-700" />

        <div className="space-y-2">
          {checkpoints.map((cp, i) => {
            const isInterrupted = cp.remainingWork.length > 0;
            // eslint-disable-next-line @typescript-eslint/no-unused-vars
            const isLast = i === checkpoints.length - 1;
            const nodeColor = isInterrupted ? 'bg-amber-500' : 'bg-green-500';
            const nodeRing = isInterrupted ? 'ring-2 ring-amber-500/30' : 'ring-2 ring-green-500/30';

            return (
              <motion.div
                key={cp.index}
                initial={{ opacity: 0, x: -6 }}
                animate={{ opacity: 1, x: 0 }}
                transition={{ delay: i * 0.05, duration: 0.2 }}
                className="relative flex items-start gap-2.5 pl-0"
              >
                {/* Timeline node */}
                <div className="relative z-10 mt-0.5 shrink-0">
                  <div className={`w-2 h-2 rounded-full ${nodeColor} ${nodeRing} transition-all duration-300`} />
                </div>

                {/* Content */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-1.5 text-[10px]">
                    <span className="text-[#555] dark:text-gray-600 font-mono font-medium">#{cp.index + 1}</span>
                    <span className="text-[#8e8e8e] dark:text-gray-400">
                      {cp.progressSummary.filesModified.length} files, {cp.progressSummary.toolsCalled} tools
                    </span>
                    {isInterrupted && (
                      <span className="text-amber-500 dark:text-amber-400 font-medium">
                        · {cp.remainingWork.length} remaining
                      </span>
                    )}
                  </div>
                  {cp.progressSummary.stepsCompleted.length > 0 && (
                    <div className="text-[9px] text-[#555] dark:text-gray-600 mt-0.5 truncate">
                      {cp.progressSummary.stepsCompleted.slice(-2).join(' → ')}
                    </div>
                  )}
                </div>
              </motion.div>
            );
          })}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  Skill Chips with glow + tooltip                                    */
/* ================================================================== */

/**
 * Renders skill chips with a subtle glow on hover and a tooltip
 * showing the skill's purpose.
 */
function SkillChips({ skills }: { skills?: string[] }) {
  if (!skills || skills.length === 0) {
    return null;
  }

  return (
    <div className="flex flex-wrap gap-1 mt-1.5">
      {skills.map((skill) => (
        <div key={skill} className="group relative">
          <span
            className="pv-chip-hover inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium
              bg-blue-500/10 text-blue-400 border border-blue-500/20
              dark:bg-blue-400/15 dark:text-blue-300 dark:border-blue-400/25
              transition-all duration-200 cursor-default"
          >
            <svg width="8" height="8" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
            </svg>
            {skill}
          </span>
          {/* Tooltip */}
          <div
            className="absolute bottom-full left-1/2 -translate-x-1/2 mb-1.5 px-2 py-1 rounded-md
              bg-[#1a1a1a] dark:bg-gray-800 border border-[#333] dark:border-gray-600
              text-[9px] text-[#999] dark:text-gray-400 whitespace-nowrap
              opacity-0 group-hover:opacity-100 transition-opacity duration-150 pointer-events-none z-20
              shadow-lg"
          >
            Skill: {skill}
            <div className="absolute top-full left-1/2 -translate-x-1/2 -mt-px">
              <div className="w-1.5 h-1.5 rotate-45 bg-[#1a1a1a] dark:bg-gray-800 border-r border-b border-[#333] dark:border-gray-600" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}

/* ================================================================== */
/*  Constraints Card                                                   */
/* ================================================================== */

/**
 * Renders constraints in a distinct amber/orange card with alert icon
 * so they stand out clearly.
 */
function ConstraintsCard({ constraints }: { constraints: NonNullable<PlanPoint['constraints']> }) {
  const items = [
    ...(constraints.doNotModify?.map((f) => ({ type: 'file' as const, text: f })) ?? []),
    ...(constraints.additional?.map((c) => ({ type: 'rule' as const, text: c })) ?? []),
  ];

  if (items.length === 0) {
    return null;
  }

  return (
    <div
      className="mt-2 rounded-md border border-amber-500/25 dark:border-amber-500/35
        bg-amber-500/10 dark:bg-amber-500/15 p-2 transition-colors duration-200"
    >
      <div className="flex items-center gap-1.5 mb-1">
        <svg
          width="11"
          height="11"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2"
          className="text-amber-500 dark:text-amber-400 shrink-0"
        >
          <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
          <line x1="12" y1="9" x2="12" y2="13" />
          <line x1="12" y1="17" x2="12.01" y2="17" />
        </svg>
        <span className="text-[10px] font-semibold text-amber-600 dark:text-amber-400 uppercase tracking-wider">
          Constraints
        </span>
      </div>
      <ul className="space-y-0.5">
        {items.map((item, i) => (
          <li key={i} className="flex items-start gap-1.5 text-[10px] text-amber-700 dark:text-amber-300">
            {item.type === 'file' ? (
              <svg
                width="9"
                height="9"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                className="shrink-0 mt-0.5 opacity-60"
              >
                <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                <polyline points="14 2 14 8 20 8" />
              </svg>
            ) : (
              <span className="shrink-0 opacity-60">⊘</span>
            )}
            <span className="truncate">{item.type === 'file' ? `Don't modify: ${item.text}` : item.text}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

/* ================================================================== */
/*  Main PlanView Component                                            */
/* ================================================================== */

export const PlanView = React.memo(({ planId, progress, onCancel, onResume }: PlanViewProps) => {
  const [plan, setPlan] = useState<Plan | null>(null);
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  const [showDetails, _setShowDetails] = useState<string | null>(null);

  // Inject CSS animations on mount
  useEffect(() => {
    injectAnimations();
  }, []);

  // Poll planStore every 500ms to get the latest plan state
  useEffect(() => {
    const syncPlan = () => {
      const p = planStore.getPlan(planId);

      if (p) {
        setPlan((prev) => {
          if (prev === p) {
            return prev;
          }

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

  const handleResume = useCallback(() => {
    onResume?.();
  }, [onResume]);

  if (!plan) {
    return (
      <div className="flex items-center gap-3 px-4 py-3">
        <div className="i-ph:spinner animate-spin h-5 w-5 text-amplify-elements-textSecondary" />
        <span className="text-sm text-amplify-elements-textSecondary">Loading plan...</span>
      </div>
    );
  }

  const totalCount = plan.points.length;
  const isTerminal = plan.status === 'completed' || plan.status === 'failed' || plan.status === 'cancelled';

  // Check if the plan can be resumed (has incomplete tasks)
  const execState = ExecutionManager.getExecutionState(plan.id);
  const canResume = execState?.canResume && !isTerminal && plan.status !== 'executing';

  // Compute progress counts
  const doneCount = plan.points.filter((p) => p.status === 'completed' || p.status === 'skipped').length;
  const failedCount = plan.points.filter((p) => p.status === 'failed').length;
  const pendingCount = totalCount - doneCount - failedCount;
  const progressPercent = totalCount > 0 ? Math.round((doneCount / totalCount) * 100) : 0;

  /* Build TraceTree items from plan points */
  const traceItems: TraceItem[] = plan.points.map((point) => {
    const hasChildren =
      point.expectedFiles.length > 0 ||
      (point.verificationResults != null && point.verificationResults.length > 0) ||
      !!point.summary ||
      !!point.error ||
      (point.checkpoints && point.checkpoints.length > 0) ||
      (point.requiredSkills && point.requiredSkills.length > 0) ||
      !!point.executionState ||
      (point.requirements && point.requirements.length > 0);

    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const isExpanded = showDetails === point.id;

    return {
      id: point.id,
      text: point.title,
      status: mapPlanPointStatus(point.status),
      type: (point.status === 'completed' ? 'check' : 'bullet') as TreeItemType,
      subText:
        point.status === 'preparing'
          ? 'Preparing tools & skills...'
          : point.status === 'in_progress'
            ? 'Working...'
            : point.status === 'verifying'
              ? 'Verifying...'
              : point.status === 'waiting_for_tool'
                ? 'Waiting for tool...'
                : point.status === 'waiting_for_user'
                  ? 'Waiting for input...'
                  : point.status === 'failed' && point.error
                    ? point.error.slice(0, 50)
                    : undefined,
      children: hasChildren ? (
        <div className="space-y-2 text-[11px]">
          {/* Goal */}
          {point.goal && <p className="text-[#8e8e8e] dark:text-gray-400 italic">{point.goal}</p>}

          {/* Execution state badge */}
          {point.executionState && <ExecutionStateBadge point={point} />}

          {/* Skills */}
          <SkillChips skills={point.requiredSkills} />

          {/* Requirements */}
          {point.requirements && point.requirements.length > 0 && (
            <div>
              <span className="text-[#666] dark:text-gray-500 font-medium">Requirements:</span>
              <ul className="mt-0.5 space-y-0.5">
                {point.requirements.map((req, i) => (
                  <li key={i} className="text-[#8e8e8e] dark:text-gray-400">
                    • {req}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Success criteria */}
          {point.successCriteria && point.successCriteria.length > 0 && (
            <div>
              <span className="text-[#666] dark:text-gray-500 font-medium">Success criteria:</span>
              <ul className="mt-0.5 space-y-0.5">
                {point.successCriteria.map((crit, i) => (
                  <li key={i} className="text-[#8e8e8e] dark:text-gray-400">
                    ✓ {crit}
                  </li>
                ))}
              </ul>
            </div>
          )}

          {/* Completed summary */}
          {point.status === 'completed' && point.summary && (
            <p className="text-[#8e8e8e] dark:text-gray-400">{point.summary}</p>
          )}
          {point.status === 'failed' && point.error && (
            <p className="text-rose-400 dark:text-rose-400">{point.error}</p>
          )}

          {/* Expected files */}
          {point.expectedFiles.length > 0 && (
            <div>
              <span className="text-[#666] dark:text-gray-500 font-medium">Expected files:</span>
              <div className="flex flex-wrap gap-1 mt-1">
                {point.expectedFiles.map((file) => (
                  <span
                    key={file}
                    className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono
                      bg-[#1a1a1a] dark:bg-gray-800/80 text-[#8e8e8e] dark:text-gray-400
                      border border-[#333] dark:border-gray-600 transition-colors duration-200"
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

          {/* Checkpoints */}
          {point.checkpoints && point.checkpoints.length > 0 && <CheckpointList checkpoints={point.checkpoints} />}

          {/* Verification results */}
          {point.verificationResults && point.verificationResults.length > 0 && (
            <div>
              <span className="text-[#666] dark:text-gray-500 font-medium">Verification:</span>
              <div className="flex flex-wrap gap-1.5 mt-1">
                {point.verificationResults.map((vr, i) => (
                  <span
                    key={i}
                    className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-medium transition-colors duration-200 ${
                      vr.passed
                        ? 'bg-green-500/15 text-green-500 dark:text-green-400 border border-green-500/30 dark:border-green-500/40'
                        : 'bg-red-500/15 text-red-500 dark:text-red-400 border border-red-500/30 dark:border-red-500/40'
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

          {/* Constraints */}
          {point.constraints &&
            (point.constraints.doNotModify?.length || point.constraints.additional?.length ? (
              <ConstraintsCard constraints={point.constraints} />
            ) : null)}
        </div>
      ) : undefined,
    };
  });

  return (
    <div className="relative">
      {/* ── Progress bar at top ── */}
      <div className="h-0.5 w-full bg-[#1a1a1a] dark:bg-gray-800 overflow-hidden rounded-t">
        <motion.div
          className="h-full rounded-t"
          style={{
            background: 'linear-gradient(90deg, #a855f7, #d946ef, #a855f7)',
            backgroundSize: '200% 100%',
          }}
          initial={{ width: '0%' }}
          animate={{
            width: `${progressPercent}%`,
            backgroundPosition: ['0% 0%', '100% 0%'],
          }}
          transition={{
            width: { duration: 0.6, ease: 'easeOut' },
            backgroundPosition: { duration: 2, repeat: Infinity, repeatType: 'mirror', ease: 'linear' },
          }}
        />
      </div>

      {/* Trace tree with plan points + circular progress donut */}
      <TraceTree
        headerIcon="plan"
        headerText={`${plan.points.length} milestone objectives`}
        items={traceItems}
        defaultOpen={true}
        headerBadge={
          <motion.div
            initial={{ scale: 0.8, opacity: 0 }}
            animate={{ scale: 1, opacity: 1 }}
            transition={{ type: 'spring', stiffness: 300, damping: 20 }}
          >
            <CircularProgress
              size={26}
              strokeWidth={3.5}
              segments={[
                { value: doneCount, color: '#22c55e' },
                { value: pendingCount, color: '#3a3a3a' },
                { value: failedCount, color: '#f43f5e' },
              ]}
            >
              <span className="text-[7px] font-bold text-[#8e8e8e] dark:text-gray-400 leading-none">
                {doneCount}/{totalCount}
              </span>
            </CircularProgress>
          </motion.div>
        }
      />

      {/* Progress message */}
      {progress?.message && (
        <div className="px-4 py-2">
          <p className="text-xs text-amplify-elements-textSecondary truncate">{progress.message}</p>
        </div>
      )}

      {/* Footer actions */}
      <div className="px-4 py-2.5 flex items-center justify-between gap-2">
        {/* Cancel button (only while executing) */}
        <AnimatePresence>
          {!isTerminal && plan.status === 'executing' && (
            <motion.button
              initial={{ opacity: 0, scale: 0.95 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.95 }}
              transition={{ duration: 0.15 }}
              onClick={handleCancel}
              className="px-3 py-1 text-[11px] font-medium rounded border border-[#333] dark:border-gray-600
                text-[#8e8e8e] dark:text-gray-400 hover:bg-[#1a1a1a] dark:hover:bg-gray-800
                transition-colors duration-200"
            >
              Cancel Plan
            </motion.button>
          )}
        </AnimatePresence>

        {/* Resume button (when plan is paused/failed with resumable tasks) */}
        <AnimatePresence>
          {canResume && onResume && (
            <motion.button
              initial={{ opacity: 0, scale: 0.9 }}
              animate={{ opacity: 1, scale: 1 }}
              exit={{ opacity: 0, scale: 0.9 }}
              transition={{ type: 'spring', stiffness: 400, damping: 20 }}
              onClick={handleResume}
              className="pv-resume-btn px-4 py-1.5 text-[11px] font-semibold rounded-md
                text-white shadow-md shadow-green-500/20
                hover:shadow-lg hover:shadow-green-500/30
                flex items-center gap-1.5 transition-shadow duration-200"
            >
              <svg width="12" height="12" viewBox="0 0 24 24" fill="currentColor">
                <path d="M8 5v14l11-7z" />
              </svg>
              {execState?.nextTask?.isResume ? 'Resume from Checkpoint' : 'Continue Plan'}
            </motion.button>
          )}
        </AnimatePresence>

        {/* Status messages */}
        {plan.status === 'failed' && !canResume && (
          <p className="text-[11px] text-rose-400 dark:text-rose-400">
            Plan failed — review the failed step for details.
          </p>
        )}
        {plan.status === 'completed' && (
          <motion.p
            initial={{ opacity: 0, y: 4 }}
            animate={{ opacity: 1, y: 0 }}
            className="text-[11px] text-green-500 dark:text-green-400 font-medium"
          >
            ✓ All plan steps completed successfully
          </motion.p>
        )}
        {plan.status === 'cancelled' && (
          <p className="text-[11px] text-[#666] dark:text-gray-500">Plan was cancelled.</p>
        )}
      </div>
    </div>
  );
});
