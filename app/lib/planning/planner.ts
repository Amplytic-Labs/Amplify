/**
 * Planner — client-side wrapper for the dedicated planner LLM step.
 *
 * This module is the client half of the wiring that makes
 * `PLANNER_SYSTEM_PROMPT` actually get used. See `app/routes/api.plan.ts`
 * for the server half.
 *
 * Flow:
 *   1. The main chat AI calls the `execute_plan` tool with a *draft*
 *      plan (title + description per point).
 *   2. `Chat.client.tsx` detects the `execute_plan_signal`.
 *   3. It calls `enrichSignalWithPlan(signal, projectContext)` (below),
 *      which hits `/api/plan` — the endpoint that runs
 *      `PLANNER_SYSTEM_PROMPT` against GLM-4.7-Flash.
 *   4. The planner returns full Task Contracts (goal, requirements,
 *      successCriteria, requiredSkills, requiredToolOutputs,
 *      expectedFiles, verificationChecks, constraints).
 *   5. The enriched signal replaces the draft, and the approval dialog
 *      shows the rich contracts.
 *   6. On approval, `createPlanWithContractsAsync` persists the
 *      immutable Task Contracts + initializes mutable ExecutionState.
 *
 * Graceful degradation: if the planner call fails (network error, bad
 * key, unparseable output), `enrichSignalWithPlan` returns the original
 * draft signal unchanged so the user can still approve and execute.
 */

/*
 * ───────────────────────────────────────────────────────────────────
 * Types
 * ───────────────────────────────────────────────────────────────────
 */

export interface PlannerToolOutputReference {
  tool: string;
  id: string;
  args?: Record<string, unknown>;
  label?: string;
}

export interface PlannerConstraints {
  doNotModify?: string[];
  doNotInstall?: string[];
  additional?: string[];
}

/**
 * A single enriched plan point — a full Task Contract produced by the
 * planner LLM. This matches the shape `extractPlanFromResponse` returns
 * and what `createPlanWithContractsAsync` accepts.
 */
export interface PlannerPlanPoint {
  title: string;
  goal: string;
  description: string;
  requirements: string[];
  successCriteria: string[];
  requiredSkills: string[];
  requiredToolOutputs: PlannerToolOutputReference[];
  expectedFiles: string[];
  verificationChecks: string[];
  constraints?: PlannerConstraints;
}

/**
 * The full planner result — the parsed `<plan>` JSON.
 */
export interface PlannerResult {
  taskDescription: string;
  plannerNotes?: string;
  planPoints: PlannerPlanPoint[];
}

/**
 * A draft plan point as emitted by the main chat AI's `execute_plan`
 * tool call (before enrichment).
 */
export interface DraftPlanPoint {
  title: string;
  description: string;
  expectedFiles?: string[];
  verificationRules?: string[];
}

/**
 * The shape of the `execute_plan_signal` that flows from the AI's tool
 * call through to the approval dialog. After enrichment, each point
 * carries the full Task Contract fields.
 */
export interface ExecutePlanSignal {
  type: 'execute_plan_signal';
  taskDescription: string;
  planPoints: Array<DraftPlanPoint & Partial<PlannerPlanPoint>>;

  /** Planner guidance inherited by every worker. Present after enrichment. */
  plannerNotes?: string;

  /** True once the planner LLM has enriched this signal. */
  _enriched?: boolean;
}

/*
 * ───────────────────────────────────────────────────────────────────
 * API call
 * ───────────────────────────────────────────────────────────────────
 */

export interface GeneratePlanParams {
  userRequest: string;
  draftPlanPoints?: DraftPlanPoint[];
  projectContext?: string;
}

/**
 * Calls `/api/plan` to produce full Task Contracts for the given
 * request. Throws on failure — the caller decides how to degrade.
 */
export async function generatePlan(params: GeneratePlanParams): Promise<PlannerResult> {
  const resp = await fetch('/api/plan', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      userRequest: params.userRequest,
      draftPlanPoints: params.draftPlanPoints,
      projectContext: params.projectContext,
    }),
  });

  let data: any = null;

  try {
    data = await resp.json();
  } catch {
    // Non-JSON response
  }

  if (!resp.ok || !data?.ok || !data?.plan) {
    const error = data?.error || `Planner request failed (${resp.status})`;
    throw new Error(error);
  }

  return data.plan as PlannerResult;
}

/*
 * ───────────────────────────────────────────────────────────────────
 * Signal enrichment
 * ───────────────────────────────────────────────────────────────────
 */

/**
 * Enriches an `execute_plan_signal` by running it through the planner
 * LLM (`PLANNER_SYSTEM_PROMPT` via `/api/plan`).
 *
 * - Preserves the signal's `type` and `taskDescription` (uses the
 *   planner's taskDescription if it provides one).
 * - Replaces `planPoints` with the planner's full Task Contracts.
 * - Attaches `plannerNotes` so workers inherit planner guidance.
 * - On failure, returns the original signal unchanged with
 *   `_enriched: false` so the UI can still proceed with the draft.
 */
export async function enrichSignalWithPlan(
  signal: ExecutePlanSignal,
  projectContext?: string,
): Promise<ExecutePlanSignal> {
  try {
    const result = await generatePlan({
      userRequest: signal.taskDescription,
      draftPlanPoints: signal.planPoints.map((p) => ({
        title: p.title,
        description: p.description,
        expectedFiles: p.expectedFiles,
      })),
      projectContext,
    });

    return {
      ...signal,
      taskDescription: result.taskDescription || signal.taskDescription,
      plannerNotes: result.plannerNotes,
      planPoints: result.planPoints,
      _enriched: true,
    };
  } catch (e) {
    console.warn('[planner] enrichment failed, falling back to draft plan:', e);
    return { ...signal, _enriched: false };
  }
}
