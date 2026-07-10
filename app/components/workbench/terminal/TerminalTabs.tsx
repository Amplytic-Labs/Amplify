import { useStore } from '@nanostores/react';
import React, { memo, useCallback, useEffect, useRef, useState } from 'react';
import { Panel, type ImperativePanelHandle } from 'react-resizable-panels';
import { IconButton } from '~/components/ui/IconButton';
import { shortcutEventEmitter } from '~/lib/hooks';
import { themeStore } from '~/lib/stores/theme';
import { workbenchStore } from '~/lib/stores/workbench';
import { classNames } from '~/utils/classNames';
import { Terminal, type TerminalRef } from './Terminal';
import { TerminalManager } from './TerminalManager';
import { createScopedLogger } from '~/utils/logger';

const logger = createScopedLogger('Terminal');

/*
 * Maximum number of USER-ADDED terminals (beyond the two fixed tabs).
 * Total visible tabs = 2 (fixed) + MAX_TERMINALS (user) = 5.
 */
const MAX_TERMINALS = 3;
export const DEFAULT_TERMINAL_SIZE = 25;

/*
 * Fixed tab indices.
 *
 *   Index 0 — "Amplify Terminal"  →  initTerminal  (project auto-setup:
 *                                     npm install + npm run dev). This is
 *                                     the SPECIAL terminal the user calls
 *                                     "the amplify terminal" — it initializes
 *                                     and runs the project. Visible by default
 *                                     so the user can SEE the running command.
 *                                     Silent in chat (no message created).
 *
 *   Index 1 — "AI Terminal"        →  amplifyTerminal (AI's shell + start
 *                                     actions). SEPARATE from the project
 *                                     init terminal so the AI's commands
 *                                     (e.g. `npm install some-package`) don't
 *                                     Ctrl+C the dev server, and the dev
 *                                     server's output doesn't pollute the AI's
 *                                     scrollback.
 *
 *   Index 2+ — user-added terminals (newShellProcess). Max MAX_TERMINALS.
 *
 * Previously the visible "Amplify Terminal" tab was attached to
 * `amplifyTerminal` (AI's shell) while project-init ran on a HIDDEN off-screen
 * `initTerminal` — so the user saw an empty terminal while npm install + start
 * ran invisibly. This restructure makes the project-init terminal visible and
 * gives AI commands their own visible tab.
 */
const INIT_TAB_INDEX = 0;
const AI_TAB_INDEX = 1;

export const TerminalTabs = memo(() => {
  const showTerminal = useStore(workbenchStore.showTerminal);
  const theme = useStore(themeStore);

  const terminalRefs = useRef<Map<number, TerminalRef>>(new Map());
  const terminalPanelRef = useRef<ImperativePanelHandle>(null);
  const terminalToggledByShortcut = useRef(false);

  const [activeTerminal, setActiveTerminal] = useState(0);
  const [terminalCount, setTerminalCount] = useState(0);

  const addTerminal = () => {
    if (terminalCount < MAX_TERMINALS) {
      setTerminalCount(terminalCount + 1);

      // New user terminal is at index (terminalCount + 2): old count + 2 fixed tabs.
      setActiveTerminal(terminalCount + 2);
    }
  };

  const closeTerminal = useCallback(
    (index: number) => {
      // Can't close the two fixed tabs (init + AI).
      if (index === INIT_TAB_INDEX || index === AI_TAB_INDEX) {
        return;
      }

      const terminalRef = terminalRefs.current.get(index);

      if (terminalRef?.getTerminal) {
        const terminal = terminalRef.getTerminal();

        if (terminal) {
          workbenchStore.detachTerminal(terminal);
        }
      }

      // Remove the terminal from refs
      terminalRefs.current.delete(index);

      // Adjust terminal count and active terminal
      setTerminalCount(terminalCount - 1);

      if (activeTerminal === index) {
        setActiveTerminal(Math.max(0, index - 1));
      } else if (activeTerminal > index) {
        setActiveTerminal(activeTerminal - 1);
      }
    },
    [activeTerminal, terminalCount],
  );

  useEffect(() => {
    return () => {
      terminalRefs.current.forEach((ref, index) => {
        /*
         * Only detach user-added terminals (index >= 2). The fixed tabs
         * (init + AI) are managed by the store and don't need detaching.
         */
        if (index >= 2 && ref?.getTerminal) {
          const terminal = ref.getTerminal();

          if (terminal) {
            workbenchStore.detachTerminal(terminal);
          }
        }
      });
    };
  }, []);

  useEffect(() => {
    const { current: terminal } = terminalPanelRef;

    if (!terminal) {
      return;
    }

    const isCollapsed = terminal.isCollapsed();

    if (!showTerminal && !isCollapsed) {
      terminal.collapse();
    } else if (showTerminal && isCollapsed) {
      terminal.resize(DEFAULT_TERMINAL_SIZE);
    }

    terminalToggledByShortcut.current = false;
  }, [showTerminal]);

  useEffect(() => {
    const unsubscribeFromEventEmitter = shortcutEventEmitter.on('toggleTerminal', () => {
      terminalToggledByShortcut.current = true;
    });

    const unsubscribeFromThemeStore = themeStore.subscribe(() => {
      terminalRefs.current.forEach((ref) => {
        ref?.reloadStyles();
      });
    });

    return () => {
      unsubscribeFromEventEmitter();
      unsubscribeFromThemeStore();
    };
  }, []);

  /*
   * Total tabs = 2 fixed (init + AI) + terminalCount (user-added).
   */
  const totalTabs = terminalCount + 2;

  return (
    <Panel
      ref={terminalPanelRef}
      defaultSize={showTerminal ? DEFAULT_TERMINAL_SIZE : 0}
      minSize={10}
      collapsible
      onExpand={() => {
        if (!terminalToggledByShortcut.current) {
          workbenchStore.toggleTerminal(true);
        }
      }}
      onCollapse={() => {
        if (!terminalToggledByShortcut.current) {
          workbenchStore.toggleTerminal(false);
        }
      }}
    >
      <div className="h-full">
        <div className="bg-amplify-elements-terminals-background h-full flex flex-col">
          <div className="flex items-center bg-amplify-elements-background-depth-2 border-y border-amplify-elements-borderColor gap-1.5 min-h-[34px] p-2">
            {Array.from({ length: totalTabs }, (_, index) => {
              const isActive = activeTerminal === index;

              return (
                <React.Fragment key={index}>
                  {index === INIT_TAB_INDEX ? (
                    <button
                      key={index}
                      className={classNames(
                        'flex items-center text-sm cursor-pointer gap-1.5 px-3 py-2 h-full whitespace-nowrap rounded-full',
                        {
                          'bg-amplify-elements-terminals-buttonBackground text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary':
                            isActive,
                          'bg-amplify-elements-background-depth-2 text-amplify-elements-textSecondary hover:bg-amplify-elements-terminals-buttonBackground':
                            !isActive,
                        },
                      )}
                      onClick={() => setActiveTerminal(index)}
                    >
                      <div className="i-ph:terminal-window-duotone text-lg" />
                      Amplify Terminal
                    </button>
                  ) : index === AI_TAB_INDEX ? (
                    <button
                      key={index}
                      className={classNames(
                        'flex items-center text-sm cursor-pointer gap-1.5 px-3 py-2 h-full whitespace-nowrap rounded-full',
                        {
                          'bg-amplify-elements-terminals-buttonBackground text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary':
                            isActive,
                          'bg-amplify-elements-background-depth-2 text-amplify-elements-textSecondary hover:bg-amplify-elements-terminals-buttonBackground':
                            !isActive,
                        },
                      )}
                      onClick={() => setActiveTerminal(index)}
                    >
                      <div className="i-ph:robot-duotone text-lg" />
                      AI Terminal
                    </button>
                  ) : (
                    <React.Fragment>
                      <button
                        key={index}
                        className={classNames(
                          'flex items-center text-sm cursor-pointer gap-1.5 px-3 py-2 h-full whitespace-nowrap rounded-full',
                          {
                            'bg-amplify-elements-terminals-buttonBackground text-amplify-elements-textPrimary':
                              isActive,
                            'bg-amplify-elements-background-depth-2 text-amplify-elements-textSecondary hover:bg-amplify-elements-terminals-buttonBackground':
                              !isActive,
                          },
                        )}
                        onClick={() => setActiveTerminal(index)}
                      >
                        <div className="i-ph:terminal-window-duotone text-lg" />
                        Terminal {terminalCount > 1 && index - 1}
                        <button
                          className="bg-transparent text-amplify-elements-textTertiary hover:text-amplify-elements-textPrimary hover:bg-transparent rounded"
                          onClick={(e) => {
                            e.stopPropagation();
                            closeTerminal(index);
                          }}
                        >
                          <div className="i-ph:x text-xs" />
                        </button>
                      </button>
                    </React.Fragment>
                  )}
                </React.Fragment>
              );
            })}
            {terminalCount < MAX_TERMINALS && <IconButton icon="i-ph:plus" size="md" onClick={addTerminal} />}
            <IconButton
              icon="i-ph:arrow-clockwise"
              title="Reset Terminal"
              size="md"
              onClick={() => {
                const ref = terminalRefs.current.get(activeTerminal);

                if (ref?.getTerminal()) {
                  const terminal = ref.getTerminal()!;

                  if (activeTerminal === INIT_TAB_INDEX) {
                    /*
                     * Amplify (init) terminal: use the shell's soft reset.
                     * Clears the screen + sends `clear` to the running shell
                     * WITHOUT spawning a new jsh process.
                     */
                    workbenchStore.initTerminal.resetTerminal();
                    terminal.focus();
                  } else if (activeTerminal === AI_TAB_INDEX) {
                    /*
                     * AI terminal: same soft reset as the init terminal.
                     */
                    workbenchStore.amplifyTerminal.resetTerminal();
                    terminal.focus();
                  } else {
                    /*
                     * User terminal: detach (kills the old process) BEFORE
                     * re-attaching so we don't accumulate onData listeners.
                     */
                    workbenchStore.detachTerminal(terminal);
                    terminal.clear();
                    terminal.focus();
                    workbenchStore.attachTerminal(terminal);
                  }
                }
              }}
            />
            <IconButton
              className="ml-auto"
              icon="i-ph:caret-down"
              title="Close"
              size="md"
              onClick={() => workbenchStore.toggleTerminal(false)}
            />
          </div>
          {Array.from({ length: totalTabs }, (_, index) => {
            const isActive = activeTerminal === index;

            logger.debug(`Starting terminal [${index}]`);

            if (index === INIT_TAB_INDEX) {
              return (
                <React.Fragment key={`terminal-container-${index}`}>
                  <Terminal
                    key={`terminal-${index}`}
                    id={`terminal_${index}`}
                    className={classNames('h-full overflow-hidden modern-scrollbar-invert', {
                      hidden: !isActive,
                    })}
                    ref={(ref) => {
                      if (ref) {
                        terminalRefs.current.set(index, ref);
                      }
                    }}
                    onTerminalReady={(terminal) => workbenchStore.attachInitTerminal(terminal)}
                    onTerminalResize={(cols, rows) => workbenchStore.onTerminalResize(cols, rows)}
                    theme={theme}
                  />
                  <TerminalManager
                    terminal={terminalRefs.current.get(index)?.getTerminal() || null}
                    isActive={isActive}
                  />
                </React.Fragment>
              );
            } else if (index === AI_TAB_INDEX) {
              return (
                <React.Fragment key={`terminal-container-${index}`}>
                  <Terminal
                    key={`terminal-${index}`}
                    id={`terminal_${index}`}
                    className={classNames('h-full overflow-hidden modern-scrollbar-invert', {
                      hidden: !isActive,
                    })}
                    ref={(ref) => {
                      if (ref) {
                        terminalRefs.current.set(index, ref);
                      }
                    }}
                    onTerminalReady={(terminal) => workbenchStore.attachAmplifyTerminal(terminal)}
                    onTerminalResize={(cols, rows) => workbenchStore.onTerminalResize(cols, rows)}
                    theme={theme}
                  />
                  <TerminalManager
                    terminal={terminalRefs.current.get(index)?.getTerminal() || null}
                    isActive={isActive}
                  />
                </React.Fragment>
              );
            } else {
              return (
                <React.Fragment key={`terminal-container-${index}`}>
                  <Terminal
                    key={`terminal-${index}`}
                    id={`terminal_${index}`}
                    className={classNames('modern-scrollbar h-full overflow-hidden', {
                      hidden: !isActive,
                    })}
                    ref={(ref) => {
                      if (ref) {
                        terminalRefs.current.set(index, ref);
                      }
                    }}
                    onTerminalReady={(terminal) => workbenchStore.attachTerminal(terminal)}
                    onTerminalResize={(cols, rows) => workbenchStore.onTerminalResize(cols, rows)}
                    theme={theme}
                  />
                  <TerminalManager
                    terminal={terminalRefs.current.get(index)?.getTerminal() || null}
                    isActive={isActive}
                  />
                </React.Fragment>
              );
            }
          })}
        </div>
      </div>
    </Panel>
  );
});
