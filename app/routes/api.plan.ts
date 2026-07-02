/**
 * /api/plan — Dedicated Planner Endpoint
 *
 * This is the route that actually passes `PLANNER_SYSTEM_PROMPT` to an LLM.
 *
 * Before this route existed, `PLANNER_SYSTEM_PROMPT` (defined in
 * `app/lib/planning/planner-prompt.ts`) was dead code — defined and
 * re-exported but never imported. Planning was triggered by the AI
 * calling the `execute_plan` tool, whose `execute` function simply
 * packaged the AI's inline `planPoints` (title + description only)
 * into a signal. No dedicated planner LLM step ran.
 *
 * Now: when the client detects an `execute_plan_signal`, it calls
 * this endpoint with the user request + the AI's draft points +
 * project context. The endpoint runs `PLANNER_SYSTEM_PROMPT` against
 * GLM-4.7-Flash (Z.ai), which produces full Task Contracts —
 * goal, requirements, successCriteria, requiredSkills,
 * requiredToolOutputs, expectedFiles, verificationChecks, constraints.
 *
 * The result is parsed by `extractPlanFromResponse` and returned to
 * the client, which swaps the AI's draft plan for the enriched one
 * before showing the approval dialog.
 *
 * This realizes the GPT-co-designed architecture's "Planner AI →
 * immutable TaskSpecification" step.
 */

import { type ActionFunctionArgs } from '@remix-run/cloudflare';
import { generateText } from 'ai';
import { PROVIDER_LIST } from '~/utils/constants';
import { getApiKeysFromCookie, getProviderSettingsFromCookie } from '~/lib/api/cookies';
import { createScopedLogger } from '~/utils/logger';
import { PLANNER_SYSTEM_PROMPT, extractPlanFromResponse } from '~/lib/planning/planner-prompt';

const logger = createScopedLogger('api.plan');

/**
 * The model the planner uses. GLM-4.7-Flash is fast and cheap, which
 * is ideal for a planning step that runs on top of the main chat.
 */
const PLANNER_MODEL = 'glm-4.7-flash';
const PLANNER_PROVIDER_NAME = 'Z.ai';
const PLANNER_MAX_TOKENS = 16384;

interface DraftPlanPoint {
  title?: string;
  description?: string;
  expectedFiles?: string[];
}

interface PlanRequestBody {
  userRequest?: string;
  draftPlanPoints?: DraftPlanPoint[];
  projectContext?: string;
}

/**
 * Builds the user message for the planner LLM.
 *
 * The planner receives:
 *  1. The original user request (the "what").
 *  2. The AI's preliminary breakdown as a *hint* — explicitly told to
 *     refine and enrich, not copy verbatim.
 *  3. Project context (framework, file tree, vector recall) so the
 *     planner can pick realistic `requiredSkills` and `expectedFiles`.
 */
function buildPlannerUserMessage(
  userRequest: string,
  draftPlanPoints: DraftPlanPoint[],
  projectContext: string,
): string {
  const parts: string[] = [];

  parts.push(`===== USER REQUEST =====\n${userRequest.trim()}`);

  if (draftPlanPoints.length > 0) {
    parts.push(
      `===== PRELIMINARY BREAKDOWN (for reference — refine and enrich into full Task Contracts; do NOT copy verbatim) =====`,
    );
    draftPlanPoints.forEach((p, i) => {
      const title = p.title?.trim() || `(untitled step ${i + 1})`;
      const desc = p.description?.trim() || '(no description)';
      let line = `${i + 1}. ${title}: ${desc}`;

      if (p.expectedFiles && p.expectedFiles.length > 0) {
        line += `\n   Expected files: ${p.expectedFiles.join(', ')}`;
      }

      parts.push(line);
    });
  }

  if (projectContext && projectContext.trim()) {
    parts.push(`===== PROJECT CONTEXT =====\n${projectContext.trim()}`);
  }

  parts.push(
    `===== INSTRUCTIONS =====\nProduce the full structured plan now, wrapped in <plan> tags exactly as specified in the system prompt. Every plan point must include title, goal, description, requirements, successCriteria, requiredSkills, requiredToolOutputs, expectedFiles, and verificationChecks.`,
  );

  return parts.join('\n\n');
}

export async function action({ context, request }: ActionFunctionArgs) {
  let body: PlanRequestBody;

  try {
    body = await request.json();
  } catch {
    return Response.json({ ok: false, error: 'Invalid JSON body' }, { status: 400 });
  }

  const { userRequest, draftPlanPoints, projectContext } = body;

  if (!userRequest || typeof userRequest !== 'string' || !userRequest.trim()) {
    return Response.json({ ok: false, error: 'Missing or empty userRequest' }, { status: 400 });
  }

  const draftPoints = Array.isArray(draftPlanPoints) ? draftPlanPoints : [];
  const ctxStr = typeof projectContext === 'string' ? projectContext : '';

  const userMessage = buildPlannerUserMessage(userRequest, draftPoints, ctxStr);

  try {
    const providerInfo = PROVIDER_LIST.find((p) => p.name === PLANNER_PROVIDER_NAME);

    if (!providerInfo) {
      throw new Error(`Planner provider "${PLANNER_PROVIDER_NAME}" is not registered`);
    }

    const cookieHeader = request.headers.get('Cookie');
    const apiKeys = getApiKeysFromCookie(cookieHeader);
    const providerSettings = getProviderSettingsFromCookie(cookieHeader);

    const model = providerInfo.getModelInstance({
      model: PLANNER_MODEL,
      serverEnv: context.cloudflare?.env as any,
      apiKeys,
      providerSettings,
    });

    logger.info(
      `Planner call: model=${PLANNER_MODEL} provider=${PLANNER_PROVIDER_NAME} draftPoints=${draftPoints.length} ctxLen=${ctxStr.length}`,
    );

    const result = await generateText({
      model,
      system: PLANNER_SYSTEM_PROMPT,
      messages: [{ role: 'user', content: userMessage }],
      temperature: 0,
      maxTokens: PLANNER_MAX_TOKENS,
    });

    const plan = extractPlanFromResponse(result.text);

    if (!plan) {
      logger.warn('Planner produced no parseable <plan> block');
      return Response.json(
        {
          ok: false,
          error: 'Planner did not produce a valid plan. Showing the original draft instead.',
          rawText: (result.text || '').slice(0, 2000),
        },
        { status: 502 },
      );
    }

    logger.info(`Planner produced ${plan.planPoints.length} task contracts`);

    return Response.json({ ok: true, plan });
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : 'Planner call failed';

    if (message.includes('API key')) {
      return Response.json({ ok: false, error: 'Missing or invalid Z.ai API key for the planner.' }, { status: 401 });
    }

    logger.error('Planner call failed:', message);

    return Response.json({ ok: false, error: message }, { status: 500 });
  }
}
