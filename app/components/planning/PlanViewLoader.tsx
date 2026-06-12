'use client';

import { useEffect, useState } from 'react';
import { useStore } from '@nanostores/react';
import type { Plan } from '~/lib/planning/types';
import { planExecutionStore, planExecutor } from '~/lib/planning/plan-executor';
import { openDatabaseV3, getPlan } from '~/lib/persistence/db-v3';
import { PlanView } from './PlanView.client';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('PlanViewLoader');

/**
 * Wrapper that loads the Plan from IndexedDB when planExecutionStore has a currentPlanId,
 * then renders the full PlanView component.
 */
export function PlanViewLoader() {
  const planState = useStore(planExecutionStore);
  const [plan, setPlan] = useState<Plan | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    const planId = planState.currentPlanId;
    if (!planId) {
      setPlan(null);
      return;
    }

    let cancelled = false;
    setLoading(true);

    (async () => {
      try {
        const db = await openDatabaseV3();
        if (!db || cancelled) return;

        const loadedPlan = await getPlan(db, planId);
        if (!cancelled) {
          setPlan(loadedPlan ?? null);
        }
      } catch (err) {
        logger.error('Failed to load plan:', err);
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    })();

    return () => { cancelled = true; };
  }, [planState.currentPlanId]);

  // Re-poll when execution state changes (plan points update during execution)
  useEffect(() => {
    if (!planState.currentPlanId || !planState.isExecuting) return;

    const interval = setInterval(async () => {
      try {
        const db = await openDatabaseV3();
        if (!db) return;
        const refreshed = await getPlan(db, planState.currentPlanId!);
        if (refreshed) setPlan(refreshed);
      } catch {
        // Silently skip
      }
    }, 2000);

    return () => clearInterval(interval);
  }, [planState.currentPlanId, planState.isExecuting]);

  if (!planState.currentPlanId) {
    return null;
  }

  if (loading) {
    return (
      <div className="mx-4 mb-2 rounded-lg border border-blue-200 dark:border-blue-800 bg-blue-50 dark:bg-blue-950/30 p-3 flex items-center gap-2 text-sm text-blue-600 dark:text-blue-400">
        <div className="h-4 w-4 animate-spin i-ph:spinner" />
        <span>Loading plan...</span>
      </div>
    );
  }

  if (!plan) {
    return (
      <div className="mx-4 mb-2 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-zinc-50 dark:bg-zinc-900/50 p-3 text-sm text-zinc-500">
        Plan data not found.
      </div>
    );
  }

  return (
    <div className="mx-4 mb-2">
      <PlanView
        plan={plan}
        onApprove={() => {
          planExecutor.resume(plan.id).catch((err) => logger.error('Resume failed:', err));
        }}
        onCancel={() => {
          planExecutor.abort();
        }}
      />
    </div>
  );
}