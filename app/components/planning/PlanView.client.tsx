'use client';

import { memo, useMemo, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  CheckCircle2,
  Loader2,
  Clock,
  AlertTriangle,
  XCircle,
  SkipForward,
  Play,
  Pause,
  X,
  Eye,
  ChevronDown,
  ChevronRight,
  Coins,
} from 'lucide-react';
import { useStore } from '@nanostores/react';
import type { Plan, PlanPoint, PointStatus } from '~/lib/planning/types';
import { planExecutionStore } from '~/lib/planning/plan-executor';
import { VerificationResults } from './VerificationResults';

// ─── Props ────────────────────────────────────────────────

interface PlanViewProps {
  plan: Plan;
  onApprove?: () => void;
  onModify?: (plan: Plan) => void;
  onCancel?: () => void;
  onViewSubChat?: (subChatId: string) => void;
}

// ─── Helpers ──────────────────────────────────────────────

const statusConfig: Record<PointStatus, { icon: typeof CheckCircle2; color: string; label: string }> = {
  completed: { icon: CheckCircle2, color: 'text-green-400', label: 'Completed' },
  executing: { icon: Loader2, color: 'text-blue-400', label: 'Executing' },
  verifying: { icon: AlertTriangle, color: 'text-yellow-400', label: 'Verifying' },
  pending: { icon: Clock, color: 'text-zinc-500', label: 'Pending' },
  failed: { icon: XCircle, color: 'text-red-400', label: 'Failed' },
  skipped: { icon: SkipForward, color: 'text-zinc-600', label: 'Skipped' },
};

const planStatusBadge: Record<string, { label: string; className: string }> = {
  creating: { label: 'Draft', className: 'bg-blue-500/15 text-blue-400' },
  approved: { label: 'Approved', className: 'bg-green-500/15 text-green-400' },
  executing: { label: 'Executing', className: 'bg-yellow-500/15 text-yellow-400' },
  paused: { label: 'Paused', className: 'bg-orange-500/15 text-orange-400' },
  completed: { label: 'Completed', className: 'bg-green-500/15 text-green-400' },
  failed: { label: 'Failed', className: 'bg-red-500/15 text-red-400' },
};

function formatTokenCount(n: number): string {
  if (n >= 1000) {
    return `${(n / 1000).toFixed(1)}k`;
  }
  return String(n);
}

// ─── Verification Badges ─────────────────────────────────

function VerificationBadges({ point }: { point: PlanPoint }) {
  if (!point.verificationResult) return null;

  const { verificationResult: v } = point;

  const badges: { label: string; passed: boolean }[] = [];

  if (point.verificationTypes.includes('lint')) {
    badges.push({ label: 'Lint', passed: v.lintPassed });
  }
  if (point.verificationTypes.includes('type-check')) {
    badges.push({ label: 'Type', passed: v.typeCheckPassed });
  }
  if (point.verificationTypes.includes('flow-verify')) {
    badges.push({ label: 'Flow', passed: v.flowVerified });
  }

  if (badges.length === 0) return null;

  return (
    <div className="flex items-center gap-1.5 ml-2">
      {badges.map((badge) => (
        <span
          key={badge.label}
          className={`inline-flex items-center gap-0.5 text-xs px-1.5 py-0.5 rounded-md ${
            badge.passed ? 'bg-green-500/10 text-green-400' : 'bg-red-500/10 text-red-400'
          }`}
        >
          {badge.passed ? <CheckCircle2 className="w-3 h-3" /> : <XCircle className="w-3 h-3" />}
          {badge.label}
        </span>
      ))}
    </div>
  );
}

// ─── Plan Point Row ───────────────────────────────────────

function PlanPointRow({
  point,
  isActive,
  onViewSubChat,
}: {
  point: PlanPoint;
  isActive: boolean;
  onViewSubChat?: (subChatId: string) => void;
}) {
  const config = statusConfig[point.status];
  const StatusIcon = config.icon;
  const [showVerification, setShowVerification] = useState(false);

  return (
    <motion.div
      initial={{ opacity: 0, x: -12 }}
      animate={{ opacity: 1, x: 0 }}
      transition={{ duration: 0.25, delay: point.index * 0.05 }}
      className={`flex items-start gap-3 p-3 rounded-lg border transition-colors ${
        isActive
          ? 'bg-blue-500/5 border-blue-500/30'
          : 'bg-zinc-800/50 border-zinc-700/50 hover:bg-zinc-800'
      }`}
    >
      {/* Index + status icon */}
      <div className="flex flex-col items-center gap-0.5 pt-0.5">
        <span className="text-xs text-zinc-500 font-mono">{point.index + 1}</span>
        <StatusIcon
          className={`w-4 h-4 ${config.color} ${point.status === 'executing' ? 'animate-spin' : ''}`}
        />
      </div>

      {/* Content */}
      <div className="flex-1 min-w-0">
        <div className="flex items-center gap-2">
          <span
            className={`text-sm font-medium ${
              point.status === 'completed' ? 'text-zinc-100' : 'text-zinc-300'
            } ${point.status === 'skipped' ? 'line-through text-zinc-600' : ''}`}
          >
            {point.title}
          </span>
          <VerificationBadges point={point} />
        </div>

        {point.description && (
          <p className="text-xs text-zinc-500 mt-1 leading-relaxed">{point.description}</p>
        )}

        {/* Verification results inline */}
        <AnimatePresence>
          {showVerification && point.verificationResult && (
            <motion.div
              initial={{ height: 0, opacity: 0 }}
              animate={{ height: 'auto', opacity: 1 }}
              exit={{ height: 0, opacity: 0 }}
              className="mt-2 overflow-hidden"
            >
              <VerificationResults result={point.verificationResult} />
            </motion.div>
          )}
        </AnimatePresence>

        {/* Token usage for completed point */}
        {point.tokenUsage && (
          <div className="flex items-center gap-1 mt-1.5">
            <Coins className="w-3 h-3 text-zinc-600" />
            <span className="text-xs text-zinc-600">
              {formatTokenCount(point.tokenUsage.totalTokens)} tokens
            </span>
          </div>
        )}
      </div>

      {/* Actions */}
      <div className="flex items-center gap-1.5 flex-shrink-0">
        {point.verificationResult && (
          <button
            onClick={() => setShowVerification(!showVerification)}
            className="p-1 rounded-md text-zinc-500 hover:text-zinc-300 hover:bg-zinc-700/50 transition-colors"
            title="Toggle verification details"
          >
            {showVerification ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
          </button>
        )}

        {point.status === 'completed' && point.subChatId && onViewSubChat && (
          <button
            onClick={() => onViewSubChat(point.subChatId!)}
            className="inline-flex items-center gap-1 px-2 py-1 rounded-md text-xs text-zinc-400 hover:text-zinc-200 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 transition-colors"
            title="View sub-chat"
          >
            <Eye className="w-3 h-3" />
            View Chat
          </button>
        )}
      </div>
    </motion.div>
  );
}

// ─── Plan View ─────────────────────────────────────────────

export const PlanView = memo(function PlanView({
  plan,
  onApprove,
  onModify,
  onCancel,
  onViewSubChat,
}: PlanViewProps) {
  const executionState = useStore(planExecutionStore);

  const isExecuting = executionState.isExecuting && executionState.currentPlanId === plan.id;
  const currentPointIndex = executionState.currentPointIndex;

  const completedCount = plan.points.filter((p) => p.status === 'completed').length;
  const failedCount = plan.points.filter((p) => p.status === 'failed').length;
  const totalCount = plan.points.length;

  const totalTokens = useMemo(() => {
    return plan.points.reduce((sum, p) => sum + (p.tokenUsage?.totalTokens ?? 0), 0);
  }, [plan.points]);

  const estimatedTokens = plan.totalEstimatedTokens;
  const badge = planStatusBadge[plan.status] ?? planStatusBadge.creating;

  return (
    <motion.div
      initial={{ opacity: 0, y: 12 }}
      animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.3 }}
      className="w-full max-w-2xl mx-auto"
    >
      <div className="rounded-lg border border-zinc-700/50 bg-zinc-900 overflow-hidden">
        {/* Header */}
        <div className="px-4 py-3 border-b border-zinc-700/50 bg-zinc-900">
          <div className="flex items-start justify-between gap-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <h3 className="text-sm font-semibold text-zinc-100 truncate">{plan.title}</h3>
                <span className={`inline-flex items-center px-1.5 py-0.5 rounded-md text-xs font-medium ${badge.className}`}>
                  {badge.label}
                </span>
              </div>
              {plan.description && (
                <p className="text-xs text-zinc-400 mt-1 leading-relaxed">{plan.description}</p>
              )}
            </div>
          </div>

          {/* Progress bar */}
          {(plan.status === 'executing' || plan.status === 'paused' || plan.status === 'completed') && (
            <div className="mt-3">
              <div className="flex items-center justify-between mb-1">
                <span className="text-xs text-zinc-500">
                  {completedCount}/{totalCount} points completed
                  {failedCount > 0 && <span className="text-red-400 ml-1.5">({failedCount} failed)</span>}
                </span>
                <span className="text-xs text-zinc-500">
                  {totalCount > 0 ? Math.round((completedCount / totalCount) * 100) : 0}%
                </span>
              </div>
              <div className="h-1.5 bg-zinc-800 rounded-full overflow-hidden">
                <motion.div
                  className="h-full rounded-full bg-gradient-to-r from-blue-500 to-green-500"
                  initial={{ width: 0 }}
                  animate={{
                    width: `${totalCount > 0 ? (completedCount / totalCount) * 100 : 0}%`,
                  }}
                  transition={{ duration: 0.5, ease: 'easeOut' }}
                />
              </div>
            </div>
          )}
        </div>

        {/* Points list */}
        <div className="divide-y divide-zinc-700/30">
          <AnimatePresence mode="popLayout">
            {plan.points.map((point) => (
              <PlanPointRow
                key={point.index}
                point={point}
                isActive={isExecuting && currentPointIndex === point.index}
                onViewSubChat={onViewSubChat}
              />
            ))}
          </AnimatePresence>
        </div>

        {/* Footer */}
        <div className="px-4 py-3 border-t border-zinc-700/50 bg-zinc-900/80">
          {/* Action buttons based on plan status */}
          <div className="flex items-center justify-between gap-3">
            {/* Left: Token summary */}
            <div className="flex items-center gap-3">
              <div className="flex items-center gap-1.5">
                <Coins className="w-3.5 h-3.5 text-zinc-500" />
                <span className="text-xs text-zinc-500">
                  {totalTokens > 0 ? `${formatTokenCount(totalTokens)} used` : ''}
                  {estimatedTokens > 0 ? ` / ~${formatTokenCount(estimatedTokens)} est.` : ''}
                </span>
              </div>
            </div>

            {/* Right: Action buttons */}
            <div className="flex items-center gap-2">
              {/* Creating state: Approve / Cancel */}
              {plan.status === 'creating' && (
                <>
                  <button
                    onClick={onCancel}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-zinc-400 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700/50 transition-colors"
                  >
                    <X className="w-3.5 h-3.5" />
                    Cancel
                  </button>
                  <button
                    onClick={onApprove}
                    className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-green-600 hover:bg-green-500 transition-colors"
                  >
                    <CheckCircle2 className="w-3.5 h-3.5" />
                    Approve Plan
                  </button>
                </>
              )}

              {/* Executing state: Pause */}
              {(plan.status === 'executing' || plan.status === 'approved') && isExecuting && (
                <button
                  onClick={onCancel}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-yellow-400 bg-yellow-500/10 hover:bg-yellow-500/20 border border-yellow-500/30 transition-colors"
                >
                  <Pause className="w-3.5 h-3.5" />
                  Pause
                </button>
              )}

              {/* Approved but not yet executing: Start */}
              {plan.status === 'approved' && !isExecuting && (
                <button
                  onClick={onApprove}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  Start Execution
                </button>
              )}

              {/* Paused: Resume */}
              {plan.status === 'paused' && (
                <button
                  onClick={onApprove}
                  className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-md text-xs font-medium text-white bg-blue-600 hover:bg-blue-500 transition-colors"
                >
                  <Play className="w-3.5 h-3.5" />
                  Resume
                </button>
              )}

              {/* Completed summary */}
              {plan.status === 'completed' && (
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-4 h-4 text-green-400" />
                  <span className="text-xs text-green-400 font-medium">
                    {completedCount} of {totalCount} points completed successfully
                  </span>
                </div>
              )}

              {/* Failed summary */}
              {plan.status === 'failed' && (
                <div className="flex items-center gap-2">
                  <XCircle className="w-4 h-4 text-red-400" />
                  <span className="text-xs text-red-400 font-medium">
                    Execution failed at point {currentPointIndex + 1}
                  </span>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </motion.div>
  );
});
