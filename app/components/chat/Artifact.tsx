import { useStore } from '@nanostores/react';
import { AnimatePresence, motion } from 'framer-motion';
import { computed } from 'nanostores';
import { memo, useEffect, useMemo, useRef, useState } from 'react';
import { createHighlighter, type BundledLanguage, type BundledTheme, type HighlighterGeneric } from 'shiki';
import type { ActionState } from '~/lib/runtime/action-runner';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import { WORK_DIR } from '~/utils/constants';

const highlighterOptions = {
  langs: ['shell'],
  themes: ['light-plus', 'dark-plus'],
};

const shellHighlighter: HighlighterGeneric<BundledLanguage, BundledTheme> =
  import.meta.hot?.data.shellHighlighter ?? (await createHighlighter(highlighterOptions));

if (import.meta.hot) {
  import.meta.hot.data.shellHighlighter = shellHighlighter;
}

interface ArtifactProps {
  messageId: string;
  artifactId: string;
}

export const Artifact = memo(({ artifactId }: ArtifactProps) => {
  const [isOpen, setIsOpen] = useState(false);

  const artifacts = useStore(workbenchStore.artifacts);
  const artifact = artifacts[artifactId];

  const actions = useStore(
    computed(artifact.runner.actions, (actions) => {
      return Object.values(actions).filter((action) => {
        return action.type !== 'supabase' && !(action.type === 'shell' && action.content?.includes('supabase'));
      });
    }),
  );

  /* ---- Compute summary counts ---- */
  const summary = useMemo(() => {
    const fileCount = actions.filter((a) => a.type === 'file').length;
    const shellCount = actions.filter((a) => a.type === 'shell').length;
    const startCount = actions.filter((a) => a.type === 'start').length;
    const isRunning = actions.some((a) => a.status === 'running' || a.status === 'pending');

    return { fileCount, shellCount, startCount, isRunning };
  }, [actions]);

  /* ---- Build summary text ---- */
  const summaryText = useMemo(() => {
    const { fileCount, shellCount, startCount, isRunning } = summary;

    // Bundled artifacts (template/git clone) — simple message, no counts
    if (artifact.type === 'bundled') {
      return isRunning ? 'Initializing project…' : 'Project initialized';
    }

    // AI-created artifacts — show detailed counts
    const parts: string[] = [];

    if (fileCount > 0) {
      parts.push(`${fileCount} file${fileCount > 1 ? 's' : ''}`);
    }

    if (shellCount > 0) {
      parts.push(`${shellCount} command${shellCount > 1 ? 's' : ''}`);
    }

    if (startCount > 0) {
      parts.push('start');
    }

    if (parts.length === 0 && isRunning) {
      return artifact.title;
    }

    const prefix = isRunning ? 'Working on' : 'Updated';

    return `${prefix} ${parts.join(', ')}`;
  }, [summary, artifact.type, artifact.title]);

  return (
    <div className="flex flex-col mb-4">
      {/* ---- Compact header (reasoning-block style) ---- */}
      <div
        className="flex items-center gap-2 text-bolt-elements-textTertiary text-sm transition-colors hover:text-bolt-elements-textPrimary cursor-pointer bg-transparent border-none p-0"
        onClick={() => {
          workbenchStore.showWorkbench.set(true);
        }}
      >
        {/* Status icon */}
        <div
          className={classNames(
            'text-base shrink-0',
            summary.isRunning ? 'text-accent-500' : 'text-bolt-elements-icon-success',
          )}
        >
          {summary.isRunning ? (
            <div className="i-svg-spinners:90-ring-with-bg" />
          ) : (
            <div className="i-ph:check-circle" />
          )}
        </div>

        {/* Summary text */}
        <span className="flex-1 truncate">{summaryText}</span>

        {/* Expand / collapse chevron */}
        {actions.length > 0 && (
          <button
            className="shrink-0 bg-transparent border-none p-0 cursor-pointer text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary transition-colors"
            onClick={(e) => {
              e.stopPropagation();
              setIsOpen(!isOpen);
            }}
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

      {/* ---- Expandable action details ---- */}
      <AnimatePresence initial={false}>
        {isOpen && actions.length > 0 && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{
              height: 'auto',
              opacity: 1,
              transition: { type: 'spring', stiffness: 300, damping: 30 },
            }}
            exit={{
              height: 0,
              opacity: 0,
              transition: { duration: 0.25, ease: 'easeInOut' },
            }}
            style={{ overflow: 'hidden' }}
            className="mt-2 rounded-lg relative before:absolute before:left-0 before:top-0 before:bottom-0 before:w-1 before:bg-bolt-elements-textTertiary"
          >
            <div className="text-sm text-bolt-elements-textPrimary max-h-96 overflow-y-auto pl-4 py-2 bg-bolt-elements-background-depth-2 rounded-lg">
              <ActionList actions={actions} />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
});

interface ShellCodeBlockProps {
  classsName?: string;
  code: string;
}

function ShellCodeBlock({ classsName, code }: ShellCodeBlockProps) {
  return (
    <div
      className={classNames('text-xs', classsName)}
      dangerouslySetInnerHTML={{
        __html: shellHighlighter.codeToHtml(code, {
          lang: 'shell',
          theme: 'dark-plus',
        }),
      }}
    ></div>
  );
}

interface ActionListProps {
  actions: ActionState[];
}

const actionVariants = {
  hidden: { opacity: 0, y: 20 },
  visible: { opacity: 1, y: 0 },
};

export function openArtifactInWorkbench(filePath: any) {
  workbenchStore.showWorkbench.set(true);
  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
}

const ActionList = memo(({ actions }: ActionListProps) => {
  return (
    <motion.div initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
      <ul className="list-none space-y-2.5">
        {actions.map((action, index) => {
          const { status, type, content } = action;
          const isLast = index === actions.length - 1;

          return (
            <motion.li
              key={index}
              variants={actionVariants}
              initial="hidden"
              animate="visible"
              transition={{
                duration: 0.2,
                ease: cubicEasingFn,
              }}
            >
              <div className="flex items-center gap-1.5 text-sm">
                <div className={classNames('text-lg', getIconColor(action.status))}>
                  {status === 'running' ? (
                    <>
                      {type !== 'start' ? (
                        <div className="i-svg-spinners:90-ring-with-bg"></div>
                      ) : (
                        <div className="i-ph:terminal-window-duotone"></div>
                      )}
                    </>
                  ) : status === 'pending' ? (
                    <div className="i-ph:circle-duotone"></div>
                  ) : status === 'complete' ? (
                    <div className="i-ph:check"></div>
                  ) : status === 'failed' || status === 'aborted' ? (
                    <div className="i-ph:x"></div>
                  ) : null}
                </div>
                {type === 'file' ? (
                  <div>
                    Create{' '}
                    <code
                      className="bg-bolt-elements-artifacts-inlineCode-background text-bolt-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-bolt-elements-item-contentAccent hover:underline cursor-pointer"
                      onClick={() => openArtifactInWorkbench(action.filePath)}
                    >
                      {action.filePath}
                    </code>
                  </div>
                ) : type === 'shell' ? (
                  <div className="flex items-center w-full min-h-[28px]">
                    <span className="flex-1">Run command</span>
                  </div>
                ) : type === 'start' ? (
                  <a
                    onClick={(e) => {
                      e.preventDefault();
                      workbenchStore.currentView.set('preview');
                    }}
                    className="flex items-center w-full min-h-[28px]"
                  >
                    <span className="flex-1">Start Application</span>
                  </a>
                ) : null}
              </div>
              {(type === 'shell' || type === 'start') && (
                <ShellCodeBlock
                  classsName={classNames('mt-1', {
                    'mb-3.5': !isLast,
                  })}
                  code={content}
                />
              )}
            </motion.li>
          );
        })}
      </ul>
    </motion.div>
  );
});

function getIconColor(status: ActionState['status']) {
  switch (status) {
    case 'pending': {
      return 'text-bolt-elements-textTertiary';
    }
    case 'running': {
      return 'text-bolt-elements-loader-progress';
    }
    case 'complete': {
      return 'text-bolt-elements-icon-success';
    }
    case 'aborted': {
      return 'text-bolt-elements-textSecondary';
    }
    case 'failed': {
      return 'text-bolt-elements-icon-error';
    }
    default: {
      return undefined;
    }
  }
}
