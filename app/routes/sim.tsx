import { json } from '@remix-run/cloudflare';
import type { MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { useState, useCallback, useRef, useEffect, useMemo } from 'react';
import { AnimatePresence, motion } from 'framer-motion';

export const meta: MetaFunction = () => [{ title: 'Artifact UI Simulator' }];
export const loader = () => json({});

export default function SimRoute() {
  return (
    <ClientOnly fallback={<div className="flex items-center justify-center h-screen">Loading simulator...</div>}>
      {() => <ArtifactSimulator />}
    </ClientOnly>
  );
}

/* ---- Types mirroring the real codebase ---- */

type ActionStatus = 'pending' | 'running' | 'complete' | 'failed' | 'aborted';
type ActionType = 'file' | 'shell' | 'start';

interface SimAction {
  id: string;
  type: ActionType;
  status: ActionStatus;
  filePath?: string;
  content: string;
  fileAction?: 'create' | 'update';
}

interface SimArtifact {
  id: string;
  title: string;
  type?: string;
  actions: SimAction[];
}

/* ---- Plan types mirroring app/lib/planning/types.ts ---- */

type SimPlanStatus = 'draft' | 'approved' | 'executing' | 'completed' | 'failed' | 'cancelled';
type SimPlanPointStatus = 'pending' | 'in_progress' | 'verifying' | 'completed' | 'failed' | 'skipped';
type SimVerificationType = 'lint' | 'type_check' | 'flow_verification' | 'build_check';

interface SimVerificationResult {
  type: SimVerificationType;
  passed: boolean;
  message: string;
}

interface SimPlanPoint {
  id: string;
  title: string;
  description: string;
  status: SimPlanPointStatus;
  order: number;
  expectedFiles: string[];
  verificationChecks: SimVerificationType[];
  verificationResults?: SimVerificationResult[];
  summary?: string;
  error?: string;
}

interface SimPlan {
  id: string;
  description: string;
  status: SimPlanStatus;
  points: SimPlanPoint[];
  userRequest: string;
}

/* ================================================================== */
/*  MAIN SIMULATOR COMPONENT                                          */
/* ================================================================== */

function ArtifactSimulator() {
  const [artifacts, setArtifacts] = useState<SimArtifact[]>([]);
  const [plans, setPlans] = useState<SimPlan[]>([]);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);
  const nextId = useRef(0);

  const uid = () => `sim-${nextId.current++}`;

  const updateArtifact = useCallback((artifactId: string, updater: (a: SimArtifact) => SimArtifact) => {
    setArtifacts((prev) => prev.map((a) => (a.id === artifactId ? updater(a) : a)));
  }, []);

  const updatePlan = useCallback((planId: string, updater: (p: SimPlan) => SimPlan) => {
    setPlans((prev) => prev.map((p) => (p.id === planId ? updater(p) : p)));
  }, []);

  const addBundledArtifact = useCallback(() => {
    const id = uid();
    setArtifacts((prev) => [...prev, { id, title: 'Setting up your project', type: 'bundled', actions: [] }]);
    return id;
  }, []);

  const addRegularArtifact = useCallback(() => {
    const id = uid();
    setArtifacts((prev) => [...prev, { id, title: 'New Project', type: undefined, actions: [] }]);
    return id;
  }, []);

  /* ---- Plan management ---- */

  const addPlan = useCallback(
    (params: { description: string; userRequest: string; points: Omit<SimPlanPoint, 'id' | 'status' | 'order'>[] }) => {
      const id = uid();
      const points: SimPlanPoint[] = params.points.map((pt, i) => ({
        ...pt,
        id: `pp_${id}_${i}`,
        status: 'pending' as SimPlanPointStatus,
        order: i,
      }));
      setPlans((prev) => [
        ...prev,
        { id, description: params.description, userRequest: params.userRequest, status: 'draft', points },
      ]);
      return id;
    },
    [],
  );

  const setPlanStatus = useCallback(
    (planId: string, status: SimPlanStatus) => {
      updatePlan(planId, (p) => ({ ...p, status }));
    },
    [updatePlan],
  );

  const advancePlanPoint = useCallback(
    (
      planId: string,
      pointId: string,
      status: SimPlanPointStatus,
      extra?: { summary?: string; error?: string; verificationResults?: SimVerificationResult[] },
    ) => {
      updatePlan(planId, (p) => ({
        ...p,
        points: p.points.map((pt) => (pt.id === pointId ? { ...pt, status, ...(extra ?? {}) } : pt)),
      }));
    },
    [updatePlan],
  );

  const runVerification = useCallback(
    (planId: string, pointId: string, allPass: boolean = true) => {
      const plan = plans.find((p) => p.id === planId);
      const point = plan?.points.find((pt) => pt.id === pointId);
      if (!point) return;
      const results: SimVerificationResult[] = point.verificationChecks.map((check) => ({
        type: check,
        passed: allPass || Math.random() > 0.3,
        message: allPass ? `${check} passed` : `${check} failed: found issues`,
      }));
      advancePlanPoint(planId, pointId, 'verifying', { verificationResults: results });
    },
    [plans, advancePlanPoint],
  );

  const addFileAction = useCallback(
    (
      artifactId: string,
      filePath: string,
      content: string = '// file content',
      fileAction: 'create' | 'update' = 'create',
    ) => {
      updateArtifact(artifactId, (a) => ({
        ...a,
        actions: [...a.actions, { id: uid(), type: 'file', status: 'pending', filePath, content, fileAction }],
      }));
    },
    [updateArtifact],
  );

  const addShellAction = useCallback(
    (artifactId: string, command: string) => {
      updateArtifact(artifactId, (a) => ({
        ...a,
        actions: [...a.actions, { id: uid(), type: 'shell', status: 'pending', content: command }],
      }));
    },
    [updateArtifact],
  );

  const addStartAction = useCallback(
    (artifactId: string, command: string = 'npm run dev') => {
      updateArtifact(artifactId, (a) => ({
        ...a,
        actions: [...a.actions, { id: uid(), type: 'start', status: 'pending', content: command }],
      }));
    },
    [updateArtifact],
  );

  const setActionStatus = useCallback(
    (artifactId: string, actionId: string, status: ActionStatus) => {
      updateArtifact(artifactId, (a) => ({
        ...a,
        actions: a.actions.map((act) => (act.id === actionId ? { ...act, status } : act)),
      }));
    },
    [updateArtifact],
  );

  const setAllRunning = useCallback(
    (artifactId: string) => {
      updateArtifact(artifactId, (a) => ({
        ...a,
        actions: a.actions.map((act) => (act.status === 'pending' ? { ...act, status: 'running' } : act)),
      }));
    },
    [updateArtifact],
  );

  const setAllComplete = useCallback(
    (artifactId: string) => {
      updateArtifact(artifactId, (a) => ({
        ...a,
        actions: a.actions.map((act) =>
          act.status === 'pending' || act.status === 'running' ? { ...act, status: 'complete' } : act,
        ),
      }));
    },
    [updateArtifact],
  );

  const reset = useCallback(() => {
    setArtifacts([]);
    setPlans([]);
    nextId.current = 0;
  }, []);

  /* ---- Auto-play scenario ---- */
  const runScenario = useCallback(async () => {
    if (autoPlayRef.current) return;
    autoPlayRef.current = true;
    setAutoPlay(true);

    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

    const bundledId = addBundledArtifact();
    await sleep(400);
    addFileAction(bundledId, 'package.json', '{ "name": "my-app" }');
    await sleep(300);
    addFileAction(bundledId, 'src/App.tsx', 'export default function App() {}');
    await sleep(300);
    addFileAction(bundledId, 'src/index.tsx', 'import App from "./App"');
    await sleep(300);
    addShellAction(bundledId, 'npm install');
    await sleep(400);
    setAllRunning(bundledId);
    await sleep(800);
    setAllComplete(bundledId);
    await sleep(600);

    const regularId = addRegularArtifact();
    await sleep(400);
    addFileAction(regularId, 'src/components/Header.tsx', 'export function Header() {}', 'update');
    await sleep(300);
    addFileAction(regularId, 'src/components/Footer.tsx', 'export function Footer() {}', 'update');
    await sleep(300);
    addShellAction(regularId, 'npx tailwindcss -i ./src/input.css -o ./dist/output.css');
    await sleep(200);
    addStartAction(regularId, 'npm run dev');
    await sleep(400);
    setAllRunning(regularId);
    await sleep(1000);
    setAllComplete(regularId);

    await sleep(500);
    const failId = addRegularArtifact();
    addFileAction(failId, 'broken.ts', 'syntax error{{{');
    addShellAction(failId, 'tsc --noEmit');
    await sleep(400);
    setAllRunning(failId);
    await sleep(600);
    updateArtifact(failId, (a) => ({
      ...a,
      actions: a.actions.map((act, i) => (i === a.actions.length - 1 ? { ...act, status: 'failed' } : act)),
    }));

    /* ---- Plan scenario ---- */
    await sleep(800);
    const planId = addPlan({
      userRequest: 'Implement a login screen with email/password authentication',
      description:
        'Login Screen Implementation — Create auth flow with email/password login, utilities, context provider, and route integration.',
      points: [
        {
          title: 'Create Login component with email/password form',
          description:
            'Build a Login.tsx component with email input, password input, submit button, and basic form validation.',
          expectedFiles: ['src/components/Login.tsx'],
          verificationChecks: ['lint', 'type_check', 'flow_verification'],
        },
        {
          title: 'Create auth utility functions',
          description: 'Create src/lib/auth.ts with login(), logout(), and isAuthenticated() utility functions.',
          expectedFiles: ['src/lib/auth.ts'],
          verificationChecks: ['lint', 'type_check'],
        },
        {
          title: 'Create auth context provider',
          description: 'Build AuthContext.tsx to provide auth state (user, isAuthenticated) to the component tree.',
          expectedFiles: ['src/contexts/AuthContext.tsx'],
          verificationChecks: ['lint', 'type_check', 'flow_verification'],
        },
        {
          title: 'Integrate login into app routes',
          description: 'Wire up the login page into the app router and protect routes with auth guards.',
          expectedFiles: ['src/app/login/page.tsx', 'src/app/layout.tsx'],
          verificationChecks: ['lint', 'type_check', 'flow_verification', 'build_check'],
        },
      ],
    });

    // Approval phase
    await sleep(600);
    setPlanStatus(planId, 'approved');
    await sleep(400);
    setPlanStatus(planId, 'executing');
    await sleep(300);

    // Execute Point 0 — success
    const pt0 = `pp_${planId}_0`;
    advancePlanPoint(planId, pt0, 'in_progress');
    await sleep(900);
    advancePlanPoint(planId, pt0, 'verifying', {
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        { type: 'type_check', passed: true, message: 'type_check passed' },
        { type: 'flow_verification', passed: true, message: 'flow_verification passed' },
      ],
    });
    await sleep(500);
    advancePlanPoint(planId, pt0, 'completed', {
      summary: 'Created Login.tsx with email/password form, validation, and submit handler.',
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        { type: 'type_check', passed: true, message: 'type_check passed' },
        { type: 'flow_verification', passed: true, message: 'flow_verification passed' },
      ],
    });
    await sleep(300);

    // Execute Point 1 — success
    const pt1 = `pp_${planId}_1`;
    advancePlanPoint(planId, pt1, 'in_progress');
    await sleep(700);
    advancePlanPoint(planId, pt1, 'verifying', {
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        { type: 'type_check', passed: true, message: 'type_check passed' },
      ],
    });
    await sleep(400);
    advancePlanPoint(planId, pt1, 'completed', {
      summary: 'Created auth.ts with login(), logout(), and isAuthenticated() functions.',
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        { type: 'type_check', passed: true, message: 'type_check passed' },
      ],
    });
    await sleep(300);

    // Execute Point 2 — success
    const pt2 = `pp_${planId}_2`;
    advancePlanPoint(planId, pt2, 'in_progress');
    await sleep(800);
    advancePlanPoint(planId, pt2, 'verifying', {
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        { type: 'type_check', passed: true, message: 'type_check passed' },
        { type: 'flow_verification', passed: true, message: 'flow_verification passed' },
      ],
    });
    await sleep(500);
    advancePlanPoint(planId, pt2, 'completed', {
      summary: 'Created AuthContext.tsx providing user state and auth methods to the tree.',
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        { type: 'type_check', passed: true, message: 'type_check passed' },
        { type: 'flow_verification', passed: true, message: 'flow_verification passed' },
      ],
    });
    await sleep(300);

    // Execute Point 3 — FAILS to demonstrate error state
    const pt3 = `pp_${planId}_3`;
    advancePlanPoint(planId, pt3, 'in_progress');
    await sleep(900);
    advancePlanPoint(planId, pt3, 'verifying', {
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        {
          type: 'type_check',
          passed: false,
          message: 'type_check failed: Property "user" does not exist on type "AuthState"',
        },
        {
          type: 'flow_verification',
          passed: false,
          message: 'flow_verification failed: /login route not connected to layout',
        },
        { type: 'build_check', passed: false, message: 'build_check failed: compilation error' },
      ],
    });
    await sleep(600);
    advancePlanPoint(planId, pt3, 'failed', {
      error:
        'Type error: Property "user" does not exist on type "AuthState". Route /login not connected to app layout.',
      verificationResults: [
        { type: 'lint', passed: true, message: 'lint passed' },
        {
          type: 'type_check',
          passed: false,
          message: 'type_check failed: Property "user" does not exist on type "AuthState"',
        },
        {
          type: 'flow_verification',
          passed: false,
          message: 'flow_verification failed: /login route not connected to layout',
        },
        { type: 'build_check', passed: false, message: 'build_check failed: compilation error' },
      ],
    });

    await sleep(400);
    setPlanStatus(planId, 'failed');

    autoPlayRef.current = false;
    setAutoPlay(false);
  }, [
    addBundledArtifact,
    addRegularArtifact,
    addFileAction,
    addShellAction,
    addStartAction,
    setAllRunning,
    setAllComplete,
    updateArtifact,
    addPlan,
    setPlanStatus,
    advancePlanPoint,
  ]);

  /* ---- Target artifact for manual controls ---- */
  const [targetIdx, setTargetIdx] = useState(0);
  const targetArtifact = artifacts[targetIdx];

  /* ---- Target plan for manual controls ---- */
  const [targetPlanIdx, setTargetPlanIdx] = useState(0);
  const targetPlan = plans[targetPlanIdx];

  const addSamplePlan = useCallback(() => {
    return addPlan({
      userRequest: 'Implement a login screen with email/password authentication',
      description: 'Login Screen Implementation — Create auth flow with login, utilities, context, and routes.',
      points: [
        {
          title: 'Create Login component with email/password form',
          description:
            'Build a Login.tsx component with email input, password input, submit button, and basic form validation.',
          expectedFiles: ['src/components/Login.tsx'],
          verificationChecks: ['lint', 'type_check', 'flow_verification'],
        },
        {
          title: 'Create auth utility functions',
          description: 'Create src/lib/auth.ts with login(), logout(), and isAuthenticated() utility functions.',
          expectedFiles: ['src/lib/auth.ts'],
          verificationChecks: ['lint', 'type_check'],
        },
        {
          title: 'Create auth context provider',
          description: 'Build AuthContext.tsx to provide auth state to the component tree.',
          expectedFiles: ['src/contexts/AuthContext.tsx'],
          verificationChecks: ['lint', 'type_check', 'flow_verification'],
        },
        {
          title: 'Integrate login into app routes',
          description: 'Wire up the login page into the app router and protect routes with auth guards.',
          expectedFiles: ['src/app/login/page.tsx', 'src/app/layout.tsx'],
          verificationChecks: ['lint', 'type_check', 'flow_verification', 'build_check'],
        },
      ],
    });
  }, [addPlan]);

  return (
    <div className="flex h-screen w-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary overflow-hidden">
      {/* ========== LEFT: Chat area ========== */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="text-xs uppercase tracking-wider text-bolt-elements-textTertiary mb-2 font-semibold">
          Artifact & Plan UI Simulator — Chat View
        </div>

        {artifacts.length === 0 && plans.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-bolt-elements-textTertiary">
            <div className="i-ph:cube text-5xl mb-3 opacity-30" />
            <p className="text-sm">No artifacts or plans yet. Use the controls on the right to add some.</p>
          </div>
        )}

        {artifacts.map((artifact) => (
          <SimulatedArtifactCard key={artifact.id} artifact={artifact} />
        ))}

        {plans.map((plan) =>
          plan.status === 'draft' || plan.status === 'approved' ? (
            <SimulatedPlanApproval
              key={plan.id}
              plan={plan}
              onExecute={() => setPlanStatus(plan.id, 'executing')}
              onCancel={() => setPlanStatus(plan.id, 'cancelled')}
            />
          ) : (
            <SimulatedPlanView key={plan.id} plan={plan} onCancel={() => setPlanStatus(plan.id, 'cancelled')} />
          ),
        )}
      </div>

      {/* ========== RIGHT: Control panel ========== */}
      <div className="w-80 shrink-0 border-l border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 overflow-y-auto p-4 space-y-4">
        <h2 className="text-sm font-bold text-bolt-elements-textPrimary">Control Panel</h2>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">Scenarios</h3>
          <button
            disabled={autoPlay}
            onClick={runScenario}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-accent-500 text-white hover:bg-accent-600 disabled:opacity-50 transition-colors"
          >
            {autoPlay ? 'Running...' : '▶ Auto-play Full Scenario'}
          </button>
          <button
            onClick={reset}
            className="w-full px-3 py-2 rounded-lg text-xs font-medium bg-bolt-elements-background-depth-3 text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary border border-bolt-elements-borderColor transition-colors"
          >
            ↺ Reset All
          </button>
        </div>

        <div className="space-y-2">
          <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">
            Add Artifact
          </h3>
          <button
            onClick={addBundledArtifact}
            className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent hover:opacity-80 transition-opacity"
          >
            + Bundled Artifact
          </button>
          <button
            onClick={addRegularArtifact}
            className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-item-backgroundAccent text-bolt-elements-item-contentAccent hover:opacity-80 transition-opacity"
          >
            + Regular Artifact
          </button>
        </div>

        {artifacts.length > 0 && (
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">
              Target Artifact
            </h3>
            <select
              value={targetIdx}
              onChange={(e) => setTargetIdx(Number(e.target.value))}
              className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary"
            >
              {artifacts.map((a, i) => (
                <option key={a.id} value={i}>
                  [{i}] {a.title} ({a.actions.length} actions)
                </option>
              ))}
            </select>
          </div>
        )}

        {targetArtifact && (
          <>
            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">
                Add Action
              </h3>
              <button
                onClick={() => addFileAction(targetArtifact.id, `src/file-${targetArtifact.actions.length + 1}.tsx`)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary border border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-1 transition-colors text-left"
              >
                📄 Add File Action
              </button>
              <button
                onClick={() => addShellAction(targetArtifact.id, `npm install pkg-${targetArtifact.actions.length}`)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary border border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-1 transition-colors text-left"
              >
                🐚 Add Shell Action
              </button>
              <button
                onClick={() => addStartAction(targetArtifact.id)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-background-depth-3 text-bolt-elements-textPrimary border border-bolt-elements-borderColor hover:bg-bolt-elements-background-depth-1 transition-colors text-left"
              >
                ▶ Add Start Action
              </button>
            </div>

            <div className="space-y-2">
              <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">
                Batch Status
              </h3>
              <button
                onClick={() => setAllRunning(targetArtifact.id)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-blue-500/20 text-blue-400 border border-blue-500/30 hover:bg-blue-500/30 transition-colors"
              >
                ⟳ Set All Pending → Running
              </button>
              <button
                onClick={() => setAllComplete(targetArtifact.id)}
                className="w-full px-3 py-2 rounded-lg text-xs bg-green-500/20 text-green-400 border border-green-500/30 hover:bg-green-500/30 transition-colors"
              >
                ✓ Set All → Complete
              </button>
              <button
                onClick={() => {
                  updateArtifact(targetArtifact.id, (a) => ({
                    ...a,
                    actions: a.actions.map((act, i) =>
                      i === a.actions.length - 1 ? { ...act, status: 'failed' } : act,
                    ),
                  }));
                }}
                className="w-full px-3 py-2 rounded-lg text-xs bg-red-500/20 text-red-400 border border-red-500/30 hover:bg-red-500/30 transition-colors"
              >
                ✗ Fail Last Action
              </button>
            </div>

            {targetArtifact.actions.length > 0 && (
              <div className="space-y-2">
                <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">
                  Actions
                </h3>
                <div className="space-y-1 max-h-60 overflow-y-auto">
                  {targetArtifact.actions.map((action) => (
                    <div
                      key={action.id}
                      className="flex items-center gap-2 text-xs p-2 rounded bg-bolt-elements-background-depth-1"
                    >
                      <StatusIcon status={action.status} />
                      <span className="truncate flex-1">
                        {action.type === 'file'
                          ? action.filePath
                          : action.type === 'shell'
                            ? action.content
                            : 'Start App'}
                      </span>
                      <select
                        value={action.status}
                        onChange={(e) => setActionStatus(targetArtifact.id, action.id, e.target.value as ActionStatus)}
                        className="text-[10px] bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded px-1 py-0.5 text-bolt-elements-textSecondary"
                      >
                        <option value="pending">pending</option>
                        <option value="running">running</option>
                        <option value="complete">complete</option>
                        <option value="failed">failed</option>
                        <option value="aborted">aborted</option>
                      </select>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </>
        )}

        {/* ========== Plan controls ========== */}
        <div className="border-t border-bolt-elements-borderColor pt-4">
          <div className="space-y-2">
            <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">Plans</h3>
            <button
              onClick={addSamplePlan}
              className="w-full px-3 py-2 rounded-lg text-xs bg-purple-500/20 text-purple-400 border border-purple-500/30 hover:bg-purple-500/30 transition-colors"
            >
              + Add Plan
            </button>
          </div>

          {plans.length > 0 && (
            <>
              <div className="space-y-2 mt-3">
                <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">
                  Target Plan
                </h3>
                <select
                  value={targetPlanIdx}
                  onChange={(e) => setTargetPlanIdx(Number(e.target.value))}
                  className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary"
                >
                  {plans.map((p, i) => (
                    <option key={p.id} value={i}>
                      [{i}] {p.description.slice(0, 30)}... ({p.status})
                    </option>
                  ))}
                </select>
              </div>

              {targetPlan && (
                <div className="space-y-2 mt-3">
                  <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">
                    Plan Status
                  </h3>
                  <select
                    value={targetPlan.status}
                    onChange={(e) => setPlanStatus(targetPlan.id, e.target.value as SimPlanStatus)}
                    className="w-full px-3 py-2 rounded-lg text-xs bg-bolt-elements-background-depth-1 border border-bolt-elements-borderColor text-bolt-elements-textPrimary"
                  >
                    <option value="draft">draft</option>
                    <option value="approved">approved</option>
                    <option value="executing">executing</option>
                    <option value="completed">completed</option>
                    <option value="failed">failed</option>
                    <option value="cancelled">cancelled</option>
                  </select>

                  <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider mt-2">
                    Plan Points
                  </h3>
                  <div className="space-y-1 max-h-60 overflow-y-auto">
                    {targetPlan.points.map((point) => (
                      <div
                        key={point.id}
                        className="flex items-center gap-2 text-xs p-2 rounded bg-bolt-elements-background-depth-1"
                      >
                        <PlanPointStatusIcon status={point.status} />
                        <span className="truncate flex-1">{point.title}</span>
                        <select
                          value={point.status}
                          onChange={(e) =>
                            advancePlanPoint(targetPlan.id, point.id, e.target.value as SimPlanPointStatus)
                          }
                          className="text-[10px] bg-bolt-elements-background-depth-3 border border-bolt-elements-borderColor rounded px-1 py-0.5 text-bolt-elements-textSecondary"
                        >
                          <option value="pending">pending</option>
                          <option value="in_progress">in_progress</option>
                          <option value="verifying">verifying</option>
                          <option value="completed">completed</option>
                          <option value="failed">failed</option>
                          <option value="skipped">skipped</option>
                        </select>
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </>
          )}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SMALL ICON HELPERS (used in the control panel)                    */
/* ================================================================== */

function StatusIcon({ status }: { status: ActionStatus }) {
  const colorMap: Record<ActionStatus, string> = {
    pending: 'bg-[#3a3a3a]',
    running: 'bg-amber-400 animate-pulse',
    complete: 'bg-green-500',
    failed: 'bg-rose-500',
    aborted: 'bg-[#555555]',
  };
  return <div className={`w-2 h-2 rounded-full shrink-0 ${colorMap[status]}`} />;
}

function PlanPointStatusIcon({ status }: { status: SimPlanPointStatus }) {
  const colorMap: Record<SimPlanPointStatus, string> = {
    pending: 'bg-[#3a3a3a]',
    in_progress: 'bg-amber-400 animate-pulse',
    verifying: 'bg-orange-400 animate-pulse',
    completed: 'bg-green-500',
    failed: 'bg-rose-500',
    skipped: 'bg-[#555555]',
  };
  return <div className={`w-2 h-2 rounded-full shrink-0 ${colorMap[status]}`} />;
}

/* ================================================================== */
/*  TRACE TREE — Core collapsible tree with curved SVG connectors     */
/*  Pixel-perfect adaptation of the reference design                  */
/* ================================================================== */

/* Precise SVG connector paths from the reference */
const FIRST_CURVE_PATH = 'M13.9248 14.9347C9.45169 15.4312 0.924805 12.3128 0.924805 0';
const NEXT_CURVE_PATH = 'M13.9248 52.9347C9.45169 53.4312 0.924805 50.3128 0.924805 38';
const VERTICAL_BAR_PATH = 'M0.00292969 0H2.00293L1.8448 38H0.00292969V0Z';

type TreeItemStatus = 'done' | 'running' | 'failed' | 'pending';
type TreeItemType = 'bullet' | 'check';
type TreeItemIcon = 'dot' | 'check' | 'plus' | 'modify' | 'terminal';

interface TraceItem {
  id: string;
  text: string;
  status: TreeItemStatus;
  type: TreeItemType;
  icon?: TreeItemIcon;
  subText?: string;
  children?: React.ReactNode;
}

function getDotClass(status: TreeItemStatus): string {
  switch (status) {
    case 'done':
      return 'bg-[#8e8e8e]';
    case 'running':
      return 'bg-amber-400 ring-2 ring-amber-400/50 animate-pulse';
    case 'failed':
      return 'bg-rose-500';
    default:
      return 'bg-[#3a3a3a]';
  }
}

function getIconColor(status: TreeItemStatus): string {
  switch (status) {
    case 'done':
      return 'text-[#8e8e8e]';
    case 'running':
      return 'text-amber-400';
    case 'failed':
      return 'text-rose-500';
    default:
      return 'text-[#555555]';
  }
}

function getTextColor(status: TreeItemStatus): string {
  switch (status) {
    case 'done':
      return 'text-[#8e8e8e]';
    case 'running':
      return 'text-[#b0b0b0]';
    case 'failed':
      return 'text-rose-400';
    default:
      return 'text-[#555555]';
  }
}

function getConnectorColor(): string {
  return '#404040';
}

/* ================================================================== */
/*  CIRCULAR PROGRESS — Full-circle stacked donut chart               */
/* ================================================================== */

interface CircularProgressSegment {
  value: number;
  color: string;
}

function CircularProgress({
  segments,
  size = 24,
  strokeWidth = 3.5,
  children,
}: {
  segments: CircularProgressSegment[];
  size?: number;
  strokeWidth?: number;
  children?: React.ReactNode;
}) {
  const r = (size - strokeWidth) / 2;
  const total = segments.reduce((sum, s) => sum + s.value, 0);
  const center = size / 2;

  // Build arcs for segments > 0
  const arcs: { d: string; color: string }[] = [];

  if (total === 0) {
    // Empty state: just a gray ring
    arcs.push({ d: describeFullCircle(center, r), color: '#3a3a3a' });
  } else if (segments.filter((s) => s.value > 0).length === 1) {
    // Single segment fills the whole circle
    const seg = segments.find((s) => s.value > 0)!;
    arcs.push({ d: describeFullCircle(center, r), color: seg.color });
  } else {
    const GAP_DEG = 4;
    const activeCount = segments.filter((s) => s.value > 0).length;
    const totalGap = GAP_DEG * activeCount;
    const available = 360 - totalGap;
    let angle = 0;

    segments.forEach((seg) => {
      if (seg.value <= 0) return;
      const segAngle = (seg.value / total) * available;
      const startAngle = angle + GAP_DEG / 2;
      const endAngle = angle + segAngle + GAP_DEG / 2;
      arcs.push({
        d: describeArc(center, r, startAngle, endAngle),
        color: seg.color,
      });
      angle += segAngle + GAP_DEG;
    });
  }

  return (
    <div className="relative inline-flex items-center justify-center" style={{ width: size, height: size }}>
      <svg width={size} height={size} viewBox={`0 0 ${size} ${size}`} className="shrink-0">
        {arcs.map((arc, i) => (
          <path key={i} d={arc.d} fill="none" stroke={arc.color} strokeWidth={strokeWidth} strokeLinecap="round" />
        ))}
      </svg>
      {children && <div className="absolute inset-0 flex items-center justify-center">{children}</div>}
    </div>
  );
}

/** Convert a "clock" angle (0°=top, clockwise) to SVG x,y */
function polarToXY(cx: number, cy: number, r: number, angleDeg: number) {
  const rad = ((angleDeg - 90) * Math.PI) / 180;
  return { x: cx + r * Math.cos(rad), y: cy + r * Math.sin(rad) };
}

/** SVG path for a clockwise arc from startAngle to endAngle (0°=top) */
function describeArc(cx: number, r: number, startAngle: number, endAngle: number): string {
  const start = polarToXY(cx, cx, r, startAngle);
  const end = polarToXY(cx, cx, r, endAngle);
  const largeArc = endAngle - startAngle > 180 ? 1 : 0;
  return `M ${start.x} ${start.y} A ${r} ${r} 0 ${largeArc} 1 ${end.x} ${end.y}`;
}

/** SVG path for a full circle (two semicircles) */
function describeFullCircle(cx: number, r: number): string {
  return `M ${cx} ${cx - r} A ${r} ${r} 0 1 1 ${cx} ${cx + r} A ${r} ${r} 0 1 1 ${cx} ${cx - r}`;
}

function TraceTree({
  headerIcon,
  headerText,
  items,
  defaultOpen = false,
  headerBadge,
}: {
  headerIcon: 'plan' | 'command' | 'file';
  headerText: string;
  items: TraceItem[];
  defaultOpen?: boolean;
  headerBadge?: React.ReactNode;
}) {
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [expandedId, setExpandedId] = useState<string | null>(null);
  const connColor = getConnectorColor();
  const firstTop = -2;
  const nextTop = -40;
  const leftOff = -3;

  return (
    <div >
      {/* Collapsible header */}
      <button
        onClick={() => setIsOpen(!isOpen)}
        className="inline-flex items-center gap-2 text-sm text-left cursor-pointer group px-4 py-0 transition-colors bg-bolt-elements-background-depth-1 rounded-lg"
      >
        {/* Header icon */}
        {headerIcon === 'plan' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0 text-[#8e8e8e] group-hover:text-accent-500 transition-colors"
          >
            <circle cx="12" cy="12" r="10" />
            <circle cx="12" cy="12" r="6" />
            <circle cx="12" cy="12" r="2" />
            <line x1="12" y1="2" x2="12" y2="4" />
            <line x1="12" y1="20" x2="12" y2="22" />
            <line x1="2" y1="12" x2="4" y2="12" />
            <line x1="20" y1="12" x2="22" y2="12" />
          </svg>
        ) : headerIcon === 'file' ? (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0 text-[#8e8e8e] group-hover:text-accent-500 transition-colors"
          >
            <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z" />
            <polyline points="14 2 14 8 20 8" />
          </svg>
        ) : (
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.8"
            className="shrink-0 text-[#8e8e8e] group-hover:text-accent-500 transition-colors"
          >
            <polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2" />
          </svg>
        )}
        <span className="text-[#8e8e8e] group-hover:text-[#d0d0d0] transition-colors">{headerText}</span>
        {headerBadge}
        <motion.div animate={{ rotate: isOpen ? 0 : -90 }} transition={{ type: 'spring', stiffness: 300, damping: 25 }}>
          <svg
            width="14"
            height="14"
            viewBox="0 0 24 24"
            fill="none"
            stroke="currentColor"
            strokeWidth="2"
            strokeLinecap="round"
            strokeLinejoin="round"
            className="text-[#666666]"
          >
            <polyline points="6 9 12 15 18 9" />
          </svg>
        </motion.div>
      </button>

      {/* Collapsible content */}
      <AnimatePresence initial={false}>
        {isOpen && items.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: {
                height: { duration: 0.25, ease: [0.25, 1, 0.5, 1] },
                opacity: { duration: 0.15 },
              },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: {
                height: { duration: 0.2, ease: [0.25, 1, 0.5, 1] },
                opacity: { duration: 0.12 },
              },
            }}
            style={{ overflow: 'hidden' }}
          >
            <div style={{left:15}} className="flex flex-col py-0.5 relative pl-[9px] pr-4 pb-3 max-h-80 overflow-y-auto">
              {items.map((item, i) => {
                const isFirst = i === 0;
                const hasExpand = !!item.children;
                const isExpanded = expandedId === item.id;

                return (
                  <div key={item.id}>
                    <motion.div
                      initial={{ x: -4, opacity: 0 }}
                      animate={{ x: 0, opacity: 1 }}
                      transition={{ delay: i * 0.03, duration: 0.18 }}
                      className={`flex items-center group relative ${hasExpand ? 'cursor-pointer' : ''}`}
                      style={{ minHeight: 26 }}
                      onClick={() => hasExpand && setExpandedId(isExpanded ? null : item.id)}
                    >
                      {/* SVG Connector */}
                      <div className="relative shrink-0" style={{ height: 26, width: 15 }}>
                        {isFirst ? (
                          <svg
                            width="15"
                            height="16"
                            viewBox="0 0 15 16"
                            fill="none"
                            style={{ position: 'absolute', top: firstTop, left: leftOff }}
                          >
                            <path d={FIRST_CURVE_PATH} stroke={connColor} strokeWidth="1.85" />
                          </svg>
                        ) : (
                          <svg
                            width="15"
                            height="54"
                            viewBox="0 0 15 54"
                            fill="none"
                            style={{ position: 'absolute', top: nextTop, left: leftOff }}
                          >
                            <path d={NEXT_CURVE_PATH} stroke={connColor} strokeWidth="1.85" />
                            <path d={VERTICAL_BAR_PATH} fill={connColor} />
                          </svg>
                        )}
                      </div>

                      {/* Status icon */}
                      <div className="w-4 h-4 flex items-center justify-center shrink-0 z-10">
                        {(() => {
                          const icon = item.icon || (item.type === 'check' ? 'check' : 'dot');
                          const color = getIconColor(item.status);
                          switch (icon) {
                            case 'check':
                              return (
                                <svg
                                  width="15"
                                  height="15"
                                  viewBox="0 0 15 15"
                                  fill="none"
                                  className={`w-4 h-4 ${color}`}
                                >
                                  <path
                                    d="M12 3.59961L5.40002 10.1996L2.40002 7.19961"
                                    stroke="currentColor"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                    strokeWidth="1.33"
                                  />
                                </svg>
                              );
                            case 'plus':
                              return (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={`w-3.5 h-3.5 ${color}`}
                                >
                                  <path
                                    d="M12 5v14M5 12h14"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              );
                            case 'modify':
                              return (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={`w-3.5 h-3.5 ${color}`}
                                >
                                  <path
                                    d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <path
                                    d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                </svg>
                              );
                            case 'terminal':
                              return (
                                <svg
                                  width="14"
                                  height="14"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  className={`w-3.5 h-3.5 ${color}`}
                                >
                                  <polyline
                                    points="4 17 10 11 4 5"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                    strokeLinejoin="round"
                                  />
                                  <line
                                    x1="12"
                                    y1="19"
                                    x2="20"
                                    y2="19"
                                    stroke="currentColor"
                                    strokeWidth="2"
                                    strokeLinecap="round"
                                  />
                                </svg>
                              );
                            default:
                              return <div className={`w-1.5 h-1.5 rounded-full ${getDotClass(item.status)}`} />;
                          }
                        })()}
                      </div>

                      {/* Item text + optional sub-text */}
                      <div className="px-1 flex-1 min-w-0 flex items-baseline gap-2">
                        <span className={`text-xs truncate ${getTextColor(item.status)}`}>{item.text}</span>
                        {item.subText && (
                          <span className="text-[10px] text-[#555555] truncate shrink-0">{item.subText}</span>
                        )}
                        {hasExpand && (
                          <span className="text-[10px] text-[#555555] ml-auto shrink-0">{isExpanded ? '▲' : '▼'}</span>
                        )}
                      </div>
                    </motion.div>

                    {/* Expandable children */}
                    <AnimatePresence initial={false}>
                      {isExpanded && item.children && (
                        <motion.div
                          initial={{ height: 0, opacity: 0 }}
                          animate={{ height: 'auto', opacity: 1, transition: { duration: 0.15 } }}
                          exit={{ height: 0, opacity: 0, transition: { duration: 0.1 } }}
                          style={{ overflow: 'hidden' }}
                        >
                          <div className="ml-[35px] py-1.5">{item.children}</div>
                        </motion.div>
                      )}
                    </AnimatePresence>
                  </div>
                );
              })}
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/*  SIMULATED ARTIFACT CARD — Trace Tree style                        */
/* ================================================================== */

function SimulatedArtifactCard({ artifact }: { artifact: SimArtifact }) {
  const actions = artifact.actions;

  const { fileItems, commandItems, fileSummary, commandSummary } = useMemo(() => {
    const fileActions = actions.filter((a) => a.type === 'file');
    const shellActions = actions.filter((a) => a.type === 'shell');

    const mapStatus = (s: ActionStatus): TreeItemStatus => {
      switch (s) {
        case 'pending':
          return 'pending';
        case 'running':
          return 'running';
        case 'complete':
          return 'done';
        case 'failed':
          return 'failed';
        case 'aborted':
          return 'done';
      }
    };

    const files: TraceItem[] = fileActions.map((a) => ({
      id: a.id,
      text: a.filePath!,
      status: mapStatus(a.status),
      type: 'bullet' as TreeItemType,
      icon: (a.fileAction === 'update' ? 'modify' : 'plus') as TreeItemIcon,
    }));

    const commands: TraceItem[] = shellActions.map((a) => ({
      id: a.id,
      text: a.content,
      status: mapStatus(a.status),
      type: 'bullet' as TreeItemType,
      icon: 'terminal' as TreeItemIcon,
    }));

    const createCount = fileActions.filter((a) => a.fileAction !== 'update').length;
    const updateCount = fileActions.filter((a) => a.fileAction === 'update').length;
    const isRunning = fileActions.some((a) => a.status === 'running' || a.status === 'pending');

    let fileText = '';
    if (fileActions.length > 0) {
      if (isRunning) {
        fileText = `Working on ${fileActions.length} file${fileActions.length > 1 ? 's' : ''}`;
      } else if (createCount > 0 && updateCount > 0) {
        fileText = `Created ${createCount}, updated ${updateCount} file${fileActions.length > 1 ? 's' : ''}`;
      } else if (updateCount > 0) {
        fileText = `Updated ${updateCount} file${updateCount > 1 ? 's' : ''}`;
      } else {
        fileText = `Created ${createCount} file${createCount > 1 ? 's' : ''}`;
      }
    }

    const cmdRunning = shellActions.some((a) => a.status === 'running' || a.status === 'pending');
    const cmdText =
      shellActions.length > 0
        ? cmdRunning
          ? `Running ${shellActions.length} command${shellActions.length > 1 ? 's' : ''}`
          : `Ran ${shellActions.length} command${shellActions.length > 1 ? 's' : ''}`
        : '';

    return { fileItems: files, commandItems: commands, fileSummary: fileText, commandSummary: cmdText };
  }, [actions, artifact]);

  return (
    <>
      {fileItems.length > 0 && <TraceTree headerIcon="file" headerText={fileSummary} items={fileItems} />}
      {commandItems.length > 0 && <TraceTree headerIcon="command" headerText={commandSummary} items={commandItems} />}
    </>
  );
}

/* ================================================================== */
/*  SIMULATED PLAN APPROVAL — compact card style                      */
/* ================================================================== */

function SimulatedPlanApproval({
  plan,
  onExecute,
  onCancel,
}: {
  plan: SimPlan;
  onExecute: () => void;
  onCancel: () => void;
}) {
  /* Show approval as a TraceTree with all points as bullet items */
  const traceItems: TraceItem[] = plan.points.map((p) => ({
    id: p.id,
    text: p.title,
    status: 'pending' as TreeItemStatus,
    type: 'bullet' as TreeItemType,
    subText: p.expectedFiles.length > 0 ? p.expectedFiles.join(', ') : undefined,
  }));

  return (
    <div>
      <TraceTree
        headerIcon="plan"
        headerText={`${plan.points.length} milestone objectives`}
        items={traceItems}
        defaultOpen={true}
        headerBadge={
          <span
            className={`text-[10px] px-1.5 py-0.5 rounded-full font-medium ${
              plan.status === 'draft'
                ? 'bg-yellow-500/20 text-yellow-500 border border-yellow-500/30'
                : 'bg-green-500/20 text-green-500 border border-green-500/30'
            }`}
          >
            {plan.status === 'draft' ? 'Draft' : 'Approved'}
          </span>
        }
      />
      {/* Action buttons */}
      <div className="flex items-center justify-start gap-2 px-4 py-3">
        <button
          onClick={onCancel}
          className="px-4 py-2 rounded-lg text-sm bg-transparent text-bolt-elements-textSecondary hover:bg-bolt-elements-background-depth-1 transition-colors"
        >
          Cancel
        </button>
        <button
          onClick={onExecute}
          className="px-4 py-2 rounded-lg text-sm font-medium bg-accent-500 text-white hover:bg-accent-600 transition-colors flex items-center gap-1.5"
        >
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
            <polygon points="5 3 19 12 5 21 5 3" />
          </svg>
          Execute Plan
        </button>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SIMULATED PLAN VIEW — Trace Tree style with expandable details    */
/* ================================================================== */

function mapPlanPointStatus(s: SimPlanPointStatus): TreeItemStatus {
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

function SimulatedPlanView({ plan, onCancel }: { plan: SimPlan; onCancel: () => void }) {
  const totalCount = plan.points.length;
  const isTerminal = plan.status === 'completed' || plan.status === 'failed' || plan.status === 'cancelled';

  const traceItems: TraceItem[] = plan.points.map((point) => {
    /* Build expandable children for each point */
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
          {/* Summary or error */}
          {point.status === 'completed' && point.summary && <p className="text-[#8e8e8e]">{point.summary}</p>}
          {point.status === 'failed' && point.error && <p className="text-rose-400">{point.error}</p>}
          {/* Expected files */}
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
          {/* Verification results */}
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

  return (
    <div>
      {/* Trace tree with plan points + circular progress donut */}
      {(() => {
        const doneCount = plan.points.filter((p) => p.status === 'completed' || p.status === 'skipped').length;
        const failedCount = plan.points.filter((p) => p.status === 'failed').length;
        const pendingCount = totalCount - doneCount - failedCount;

        return (
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
        );
      })()}

      {/* Footer */}
      {!isTerminal && (
        <div className="px-4 py-2.5 flex justify-start">
          <button
            onClick={onCancel}
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
}
