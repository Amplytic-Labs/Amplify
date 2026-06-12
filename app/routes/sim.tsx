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
}

interface SimArtifact {
  id: string;
  title: string;
  type?: string;
  actions: SimAction[];
}

/* ================================================================== */
/*  MAIN SIMULATOR COMPONENT                                          */
/* ================================================================== */

function ArtifactSimulator() {
  const [artifacts, setArtifacts] = useState<SimArtifact[]>([]);
  const [autoPlay, setAutoPlay] = useState(false);
  const autoPlayRef = useRef(false);
  const nextId = useRef(0);

  const uid = () => `sim-${nextId.current++}`;

  const updateArtifact = useCallback((artifactId: string, updater: (a: SimArtifact) => SimArtifact) => {
    setArtifacts((prev) => prev.map((a) => (a.id === artifactId ? updater(a) : a)));
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

  const addFileAction = useCallback(
    (artifactId: string, filePath: string, content: string = '// file content') => {
      updateArtifact(artifactId, (a) => ({
        ...a,
        actions: [...a.actions, { id: uid(), type: 'file', status: 'pending', filePath, content }],
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
    addFileAction(regularId, 'src/components/Header.tsx', 'export function Header() {}');
    await sleep(300);
    addFileAction(regularId, 'src/components/Footer.tsx', 'export function Footer() {}');
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
  ]);

  /* ---- Target artifact for manual controls ---- */
  const [targetIdx, setTargetIdx] = useState(0);
  const targetArtifact = artifacts[targetIdx];

  return (
    <div className="flex h-screen w-screen bg-bolt-elements-background-depth-1 text-bolt-elements-textPrimary overflow-hidden">
      {/* ========== LEFT: Chat area ========== */}
      <div className="flex-1 overflow-y-auto p-6 space-y-4">
        <div className="text-xs uppercase tracking-wider text-bolt-elements-textTertiary mb-2 font-semibold">
          Artifact UI Simulator — Chat View
        </div>

        {artifacts.length === 0 && (
          <div className="flex flex-col items-center justify-center h-64 text-bolt-elements-textTertiary">
            <div className="i-ph:cube text-5xl mb-3 opacity-30" />
            <p className="text-sm">No artifacts yet. Use the controls on the right to add some.</p>
          </div>
        )}

        {artifacts.map((artifact) => (
          <SimulatedArtifactCard key={artifact.id} artifact={artifact} />
        ))}
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
            <h3 className="text-xs font-semibold text-bolt-elements-textSecondary uppercase tracking-wider">Target</h3>
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
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SIMULATED ARTIFACT CARD — matches new Artifact.tsx design          */
/* ================================================================== */

function SimulatedArtifactCard({ artifact }: { artifact: SimArtifact }) {
  const [isOpen, setIsOpen] = useState(false);
  const actions = artifact.actions;

  const summary = useMemo(() => {
    const fileCount = actions.filter((a) => a.type === 'file').length;
    const shellCount = actions.filter((a) => a.type === 'shell').length;
    const startCount = actions.filter((a) => a.type === 'start').length;
    const isRunning = actions.some((a) => a.status === 'running' || a.status === 'pending');
    return { fileCount, shellCount, startCount, isRunning };
  }, [actions]);

  const summaryText = useMemo(() => {
    const { fileCount, shellCount, startCount, isRunning } = summary;
    const parts: string[] = [];
    if (fileCount > 0) parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
    if (shellCount > 0) parts.push(`${shellCount} command${shellCount > 1 ? 's' : ''}`);
    if (startCount > 0) parts.push('start');
    if (parts.length === 0 && isRunning) return artifact.type === 'bundled' ? 'Setting up…' : artifact.title;
    const prefix = isRunning ? 'Working on' : artifact.type === 'bundled' ? 'Created' : 'Updated';
    return `${prefix} ${parts.join(', ')}`;
  }, [summary, artifact.type, artifact.title]);

  return (
    <div className="flex flex-col mb-4">
      {/* Compact header */}
      <div className="flex items-center gap-2 text-bolt-elements-textTertiary text-sm transition-colors hover:text-bolt-elements-textPrimary cursor-pointer bg-transparent border-none p-0">
        <div
          className={`text-base shrink-0 ${summary.isRunning ? 'text-accent-500' : 'text-bolt-elements-icon-success'}`}
        >
          {summary.isRunning ? (
            <div className="i-svg-spinners:90-ring-with-bg" />
          ) : (
            <div className="i-ph:check-circle" />
          )}
        </div>
        <span className="flex-1 truncate">{summaryText}</span>
        {actions.length > 0 && (
          <button
            className="shrink-0 bg-transparent border-none p-0 cursor-pointer text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
            onClick={() => setIsOpen(!isOpen)}
          >
            {isOpen ? (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="18 15 12 9 6 15" />
              </svg>
            ) : (
              <svg
                xmlns="http://www.w3.org/2000/svg"
                width="16"
                height="16"
                viewBox="0 0 24 24"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                strokeLinecap="round"
                strokeLinejoin="round"
              >
                <polyline points="6 9 12 15 18 9" />
              </svg>
            )}
          </button>
        )}
      </div>

      {/* Expandable details */}
      <AnimatePresence initial={false}>
        {isOpen && actions.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1, transition: { type: 'spring', stiffness: 300, damping: 30 } }}
            exit={{ height: 0, opacity: 0, transition: { duration: 0.25, ease: 'easeInOut' } }}
            style={{ overflow: 'hidden' }}
            className="mt-2 rounded-lg relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-bolt-elements-textTertiary"
          >
            <div className="text-sm text-bolt-elements-textPrimary max-h-96 overflow-y-auto pl-4 py-2 bg-bolt-elements-background-depth-2 rounded-lg">
              <SimulatedActionList actions={actions} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

/* ================================================================== */
/*  ACTION LIST                                                        */
/* ================================================================== */

const actionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

function SimulatedActionList({ actions }: { actions: SimAction[] }) {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <ul className="list-none space-y-2.5">
        {actions.map((action, index) => {
          const isLast = index === actions.length - 1;
          return (
            <motion.li
              key={action.id}
              variants={actionVariants}
              initial="hidden"
              animate="visible"
              transition={{ duration: 0.2 }}
            >
              <div className="flex items-center gap-1.5 text-sm">
                <StatusIcon status={action.status} />
                {action.type === 'file' ? (
                  <div>
                    Create{' '}
                    <code className="bg-bolt-elements-artifacts-inlineCode-background text-bolt-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-bolt-elements-item-contentAccent hover:underline cursor-pointer">
                      {action.filePath}
                    </code>
                  </div>
                ) : action.type === 'shell' ? (
                  <div className="flex items-center w-full min-h-[28px]">
                    <span className="flex-1">Run command</span>
                  </div>
                ) : (
                  <div className="flex items-center w-full min-h-[28px]">
                    <span className="flex-1">Start Application</span>
                  </div>
                )}
              </div>
              {(action.type === 'shell' || action.type === 'start') && (
                <pre className={`text-xs mt-1 font-mono text-bolt-elements-textSecondary ${!isLast ? 'mb-3.5' : ''}`}>
                  {action.content}
                </pre>
              )}
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
}

/* ================================================================== */
/*  HELPERS                                                            */
/* ================================================================== */

function StatusIcon({ status }: { status: ActionStatus }) {
  return (
    <div className={`text-lg ${getIconColor(status)}`}>
      {status === 'running' ? (
        <div className="i-svg-spinners:90-ring-with-bg" />
      ) : status === 'pending' ? (
        <div className="i-ph:circle-duotone" />
      ) : status === 'complete' ? (
        <div className="i-ph:check" />
      ) : status === 'failed' ? (
        <div className="i-ph:x" />
      ) : (
        <div className="i-ph:circle-dashed" />
      )}
    </div>
  );
}

function getIconColor(status: ActionStatus) {
  switch (status) {
    case 'pending':
      return 'text-bolt-elements-textTertiary';
    case 'running':
      return 'text-accent-500';
    case 'complete':
      return 'text-bolt-elements-icon-success';
    case 'aborted':
      return 'text-bolt-elements-textSecondary';
    case 'failed':
      return 'text-bolt-elements-icon-error';
    default:
      return '';
  }
}
