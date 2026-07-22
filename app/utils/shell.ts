import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import type { ITerminal } from '~/types/terminal';
import { withResolvers } from './promises';
import { atom } from 'nanostores';
import { expoUrlAtom } from '~/lib/stores/qrCodeStore';

export async function newShellProcess(webcontainer: WebContainer, terminal: ITerminal) {
  const args: string[] = [];

  // we spawn a JSH process with a fallback cols and rows in case the process is not attached yet to a visible terminal
  const process = await webcontainer.spawn('/bin/jsh', ['--osc', ...args], {
    terminal: {
      cols: terminal.cols ?? 80,
      rows: terminal.rows ?? 15,
    },
  });

  const input = process.input.getWriter();
  const output = process.output;

  const jshReady = withResolvers<void>();

  let isInteractive = false;
  output.pipeTo(
    new WritableStream({
      write(data) {
        if (!isInteractive) {
          const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

          if (osc === 'interactive') {
            // wait until we see the interactive OSC
            isInteractive = true;

            jshReady.resolve();
          }
        }

        terminal.write(data);

        // Capture terminal output for debugging
        try {
          import('~/utils/debugLogger')
            .then(({ captureTerminalLog }) => {
              // Clean the data by removing ANSI escape sequences for logging
              const cleanData = data.replace(/\x1b\[[0-9;]*[mG]/g, '').trim();

              if (cleanData) {
                captureTerminalLog(cleanData, 'output');
              }
            })
            .catch(() => {
              // Ignore if debug logger is not available
            });
        } catch {
          // Ignore errors in debug logging
        }
      },
    }),
  );

  terminal.onData((data) => {
    // console.log('terminal onData', { data, isInteractive });

    if (isInteractive) {
      input.write(data);

      // Capture terminal input for debugging
      try {
        import('~/utils/debugLogger')
          .then(({ captureTerminalLog }) => {
            // Clean the data and check if it's a command (not just cursor movement)
            const cleanData = data.replace(/\x1b\[[0-9;]*[A-Z]/g, '').trim();

            if (cleanData && cleanData !== '\r' && cleanData !== '\n') {
              captureTerminalLog(cleanData, 'input');
            }
          })
          .catch(() => {
            // Ignore if debug logger is not available
          });
      } catch {
        // Ignore errors in debug logging
      }
    }
  });

  await jshReady.promise;

  return process;
}

export type ExecutionResult = { output: string; exitCode: number } | undefined;

export class AmplifyShell {
  #initialized: (() => void) | undefined;
  #readyPromise: Promise<void>;
  #webcontainer: WebContainer | undefined;
  #terminal: ITerminal | undefined;
  #process: WebContainerProcess | undefined;
  executionState = atom<
    { sessionId: string; active: boolean; executionPrms?: Promise<any>; abort?: () => void } | undefined
  >();
  #shellInputStream: WritableStreamDefaultWriter<string> | undefined;

  /*
   * OSC signal queue: When OSC codes are detected in the terminal writer,
   * they are pushed here. waitTillOscCode() reads from this queue instead
   * of a separate stream reader. This eliminates the tee backpressure bug.
   *
   * Each entry: { osc: string, text: string, code?: string, sessionId?: string }
   */
  #oscQueue: Array<{ osc: string; text: string; code?: string; sessionId?: string }> = [];
  #oscResolve: ((value: void) => void) | undefined;

  /*
   * Output accumulator: The terminal writer appends all text here.
   * waitTillOscCode reads from this buffer when it needs output text.
   */
  #outputAccumulator = '';

  /*
   * Track the onData disposable + pipe so we can tear them down before re-init
   * (prevents the "characters multiply on reset" bug where each reset adds a
   * duplicate onData listener + echo pipe on the same long-lived XTerm).
   */
  #onDataDisposable: { dispose: () => void } | undefined;
  #terminalPipeController: AbortController | undefined;

  #initializedOnce = false;

  /*
   * Track directly-spawned detached processes (dev servers started via
   * spawnDetached()). These are NOT children of the jsh shell, so the Ctrl+C
   * sent to jsh in killRunningProcesses() won't reach them — we kill them
   * explicitly here on chat switch / reset.
   */
  #detachedProcesses: WebContainerProcess[] = [];

  constructor() {
    this.#readyPromise = new Promise((resolve) => {
      this.#initialized = resolve;
    });
  }

  ready() {
    return this.#readyPromise;
  }

  /**
   * Tear down everything a previous init() / newAmplifyShellProcess() created:
   * the onData listener, the terminal echo pipe, the expo-url watcher, and the
   * jsh process itself. Safe to call even if nothing was set up.
   *
   * This is what makes reset() safe — without it, every reset layers a new
   * onData listener on the same XTerm, so N resets ⇒ N+1 characters per
   * keystroke.
   */
  #teardown() {
    try {
      this.#onDataDisposable?.dispose();
    } catch {
      /* ignore */
    }
    this.#onDataDisposable = undefined;

    this.#terminalPipeController?.abort();
    this.#terminalPipeController = undefined;


    try {
      this.#process?.kill();
    } catch {
      /* process may already be dead */
    }
    this.#process = undefined;

    this.#shellInputStream = undefined;
    this.#oscQueue = [];
    this.#oscResolve = undefined;
    this.#outputAccumulator = '';
  }

  async init(webcontainer: WebContainer, terminal: ITerminal) {
    /*
     * If we already have a live process for this terminal, do NOT re-init —
     * re-initing is the root cause of the multiply-characters bug. Callers
     * that just want to clear the screen should use resetTerminal() instead.
     */
    if (this.#initializedOnce && this.#process && this.#terminal === terminal) {
      return;
    }

    // Tear down any prior process / listeners / pipes before spawning new ones.
    this.#teardown();

    this.#webcontainer = webcontainer;
    this.#terminal = terminal;

    // No tee — process.output is piped directly to a single WritableStream.
    // This eliminates the backpressure bug where tee'd branches block each other
    // when one isn't continuously consumed (the old commandStream reader).
    // All data processing (terminal, Expo URL, OSC detection) happens in one place.
    const { process } = await this.newAmplifyShellProcess(webcontainer, terminal);
    this.#process = process;

    await this.waitTillOscCode('interactive');
    this.#initialized?.();
    this.#initializedOnce = true;
  }

  /**
   * Soft reset: clear the screen + send `clear` to the shell WITHOUT spawning
   * a new jsh process or registering a new onData listener. This is what the
   * Reset button should call instead of attachAmplifyTerminal(terminal).
   */
  resetTerminal() {
    if (!this.#terminal) {
      return;
    }

    try {
      this.#terminal.clear?.();
    } catch {
      /* ignore */
    }

    // Send `clear` to the running shell so the scrollback + prompt are reset.
    try {
      this.#terminal.input('clear\n');
    } catch {
      /* ignore */
    }

    try {
      this.#terminal.focus?.();
    } catch {
      /* ignore */
    }
  }

  async newAmplifyShellProcess(webcontainer: WebContainer, terminal: ITerminal) {
    const args: string[] = [];
    const process = await webcontainer.spawn('/bin/jsh', ['--osc', ...args], {
      terminal: {
        cols: terminal.cols ?? 80,
        rows: terminal.rows ?? 15,
      },
    });

    const input = process.input.getWriter();
    this.#shellInputStream = input;

    const jshReady = withResolvers<void>();
    let isInteractive = false;

    /*
     * NO TEE — pipe process.output directly to a single WritableStream.
     *
     * Why: The previous approach used ReadableStream.tee() to split the
     * output into multiple branches (terminal + commandStream + expoUrlStream).
     * This was fundamentally broken because .tee() applies backpressure
     * from BOTH branches back to the original stream. If one branch's
     * reader isn't actively consuming data (the commandStream reader was
     * only used during executeCommand calls), the tee's internal queue
     * fills up and blocks data flow to the other branches — including
     * the terminal writer and the Expo URL detector. The Expo URL never
     * appeared because data literally stopped flowing through the pipe.
     *
     * Now: A single WritableStream callback processes ALL data:
     *   1. terminal.write(data) — render to xterm
     *   2. Expo URL detection — regex match on stripped buffer
     *   3. OSC code detection — push signals to #oscQueue for waitTillOscCode()
     *   4. Accumulate output text — stored in #outputAccumulator
     *
     * Since this writer is ALWAYS consuming (pipeTo runs continuously),
     * there is zero backpressure and data flows without interruption.
     * waitTillOscCode() reads from the in-memory #oscQueue instead of
     * a stream reader, so it always works regardless of tee state.
     */
    let expoUrlBuffer = '';
    const expoUrlRegex = /(exp:\/\/[^\s]+|https?:\/\/[^\s]+\.boltexpo\.dev[^\s]*)/;
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    const oscTerminalRegex = /\x1b\][^\x07]*\x07/g;

    // Reference to `this` for use inside the closure — private fields can only
    // be accessed via `this.#field` directly inside the class body, not via
    // a variable reference like `shell.#field`. We bridge them through a
    // plain object that the closure can mutate.
    const bridge = {
      pushOsc: (entry: { osc: string; text: string; code?: string }) => { this.#oscQueue.push(entry); },
      resolveOsc: () => { this.#oscResolve?.(); this.#oscResolve = undefined; },
      appendOutput: (text: string) => { this.#outputAccumulator += text; },
    };

    this.#terminalPipeController = new AbortController();
    process.output.pipeTo(
      new WritableStream({
        write(data) {
          // --- OSC code detection (for jsh interactive + command completion) ---
          if (!isInteractive) {
            const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

            if (osc === 'interactive') {
              isInteractive = true;
              jshReady.resolve();
            }
          }

          // Detect ALL OSC codes for the queue (command completion signals)
          const [, osc, , , code] = data.match(/\x1b\]654;([^\x07=]+)=?((-?\d+):(\d+))?\x07/) || [];
          if (osc) {
            bridge.pushOsc({ osc, text: data, code });
            // If waitTillOscCode is waiting, resolve its promise
            bridge.resolveOsc();
          }

          // --- Write to terminal ---
          terminal.write(data);

          // --- Accumulate output for waitTillOscCode ---
          bridge.appendOutput(data || '');

          // --- Expo URL detection ---
          expoUrlBuffer += data || '';
          // Strip ANSI + OSC + control chars before URL matching
          const cleanBuffer = expoUrlBuffer
            .replace(ansiRegex, '')
            .replace(oscTerminalRegex, '')
            .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a]/g, '');
          const expoUrlMatch = cleanBuffer.match(expoUrlRegex);
          if (expoUrlMatch) {
            const cleanUrl = expoUrlMatch[1].replace(/[^\x20-\x7E]/g, '');
            expoUrlAtom.set(cleanUrl);
            expoUrlBuffer = ''; // Clear after match
          }
          if (expoUrlBuffer.length > 4096) {
            expoUrlBuffer = expoUrlBuffer.slice(-2048);
          }
        },
      }),
      { signal: this.#terminalPipeController.signal },
    );

    /*
     * Capture the disposable so #teardown() can remove this listener.
     * Without this, every reset layers a new onData listener on the same
     * XTerm instance and keystrokes get echoed N+1 times.
     */
    this.#onDataDisposable = terminal.onData((data) => {
      if (isInteractive) {
        input.write(data);
      }
    });

    await jshReady.promise;

    return { process };
  }

  get terminal() {
    return this.#terminal;
  }

  get process() {
    return this.#process;
  }

  /*
   * Kill any running processes on this shell. Called when switching chats
   * to ensure terminal processes from the previous chat don't leak into
   * the new one.
   *
   * Sends Ctrl+C (\x03) to the terminal input, which kills the foreground
   * process. For detached (backgrounded) processes like `npm run dev &`,
   * this may not be sufficient — but the WebContainer's process table is
   * scoped to the jsh process, and when the shell receives Ctrl+C it
   * typically propagates the SIGINT to child processes.
   *
   * Also resets executionState so the next executeCommand doesn't think
   * a command is still running.
   */
  killRunningProcesses() {
    /*
     * Kill directly-spawned detached processes (dev servers started via
     * spawnDetached()). These are NOT children of jsh, so the Ctrl+C sent to
     * jsh below will NOT reach them — we must kill them explicitly.
     */
    for (const proc of this.#detachedProcesses) {
      try {
        proc.kill();
      } catch {
        /* process may already be dead */
      }
    }
    this.#detachedProcesses = [];

    if (!this.#terminal) {
      return;
    }

    try {
      // Send Ctrl+C to kill the foreground process
      this.#terminal.input('\x03');
    } catch {
      /* ignore */
    }

    // Reset execution state
    this.executionState.set({
      sessionId: '',
      active: false,
      abort: undefined,
    });
  }

  /**
   * Spawn a long-running command (e.g. `npm run dev` dev server) as a DIRECT
   * WebContainer process, bypassing the jsh shell entirely.
   *
   * Why this exists (instead of using executeCommand with detached:true):
   * The detached executeCommand path appends ` &` to background the command so
   * the jsh prompt returns — but jsh ECHOES the input, so the user sees
   * `npm run dev &` in the terminal, which looks like a stray character.
   * Spawning directly via webcontainer.spawn() avoids both issues:
   *  - No `&` needed (the process runs independently of jsh, not as a child).
   *  - No input echo (we're not typing into jsh).
   *
   * The process's stdout/stderr are piped to the terminal so the user still
   * sees the dev server output (port info, errors, HMR logs, etc.).
   *
   * The spawned process is tracked in #detachedProcesses so
   * killRunningProcesses() can terminate it when switching chats.
   */
  async spawnDetached(command: string): Promise<void> {
    if (!this.#webcontainer || !this.#terminal) {
      console.warn('[spawnDetached] Shell not initialized — cannot spawn.');

      return;
    }

    const trimmed = command.trim();

    if (!trimmed) {
      return;
    }

    /*
     * Parse the command into program + args. Simple whitespace-splitting is
     * sufficient here because start commands come from detectProjectCommands
     * and are always simple: `npm run dev`, `pnpm run dev`, `yarn dev`,
     * `npx --yes serve`. No pipes, no &&, no quotes, no env vars.
     */
    const parts = trimmed.split(/\s+/);
    const program = parts[0];
    const args = parts.slice(1);

    try {
      const proc = await this.#webcontainer.spawn(program, args);

      this.#detachedProcesses.push(proc);

      // Pipe the process output to the terminal so the user sees dev server output.
      const terminal = this.#terminal;

      proc.output
        .pipeTo(
          new WritableStream({
            write(data) {
              terminal.write(data);
            },
          }),
        )
        .catch(() => {
          /* stream closed — ignore */
        });
    } catch (e) {
      console.error(`[spawnDetached] Failed to spawn "${trimmed}":`, e);

      // Surface the error in the terminal so the user knows the start failed.
      try {
        this.#terminal.write(`\r\nFailed to start: ${trimmed}\r\n${(e as Error)?.message || e}\r\n`);
      } catch {
        /* ignore */
      }
    }
  }

  async executeCommand(
    sessionId: string,
    command: string,
    abort?: () => void,
    options?: { detached?: boolean },
  ): Promise<ExecutionResult> {
    if (!this.process || !this.terminal) {
      return undefined;
    }

    /*
     * detached mode: used for long-running commands (dev servers / `start`
     * actions). Such a command never exits, so the normal
     * waitTillOscCode('exit') would hold executionState.active forever —
     * causing EVERY subsequent executeCommand to send Ctrl+C and kill the
     * dev server. In detached mode we background the command (` &`) so the
     * shell prompt returns, and we do NOT track it in executionState, so
     * later shell commands run normally without interrupting the server.
     */
    const detached = !!options?.detached;

    /*
     * Split &&-chained commands and execute them ONE AT A TIME.
     *
     * Why: the shell integration emits an OSC 'exit' sequence after each
     * sub-command in a && chain. Our waitTillOscCode('exit') breaks on
     * the FIRST exit it sees, so sending the whole chain as one line
     * would make executeCommand return after just the first sub-command
     * — the next executeCommand call would then inject its command while
     * the rest of the chain is still running (e.g. npm install gets
     * killed mid-way by the start command being injected).
     *
     * By splitting on && and running each sub-command individually, each
     * gets its own executeSingleCommand call with its own exit-OSC wait,
     * so commands run truly sequentially. If any sub-command fails
     * (non-zero exit), we stop the chain (same semantics as &&).
     */
    const subCommands = this.#splitCommandChain(command);

    if (subCommands.length <= 1) {
      return this.#executeSingleCommand(sessionId, command, abort, detached);
    }

    let lastResp: ExecutionResult | undefined;

    for (const subCmd of subCommands) {
      lastResp = await this.#executeSingleCommand(sessionId, subCmd, abort, detached);

      // && semantics: stop if the previous command failed.
      if (lastResp && lastResp.exitCode !== 0) {
        break;
      }
    }

    return lastResp;
  }

  /**
   * Splits a command string on top-level && separators (not inside quotes).
   * Returns the trimmed, non-empty sub-commands.
   */
  #splitCommandChain(command: string): string[] {
    const parts: string[] = [];
    let current = '';
    let inSingle = false;
    let inDouble = false;
    let escaped = false;

    for (let i = 0; i < command.length; i++) {
      const ch = command[i];

      if (escaped) {
        current += ch;
        escaped = false;
        continue;
      }

      if (ch === '\\') {
        current += ch;
        escaped = true;
        continue;
      }

      if (ch === "'" && !inDouble) {
        inSingle = !inSingle;
        current += ch;
        continue;
      }

      if (ch === '"' && !inSingle) {
        inDouble = !inDouble;
        current += ch;
        continue;
      }

      // Check for && (only when not inside quotes)
      if (ch === '&' && !inSingle && !inDouble && command[i + 1] === '&') {
        parts.push(current.trim());
        current = '';
        i++; // skip the second &
        continue;
      }

      current += ch;
    }

    if (current.trim()) {
      parts.push(current.trim());
    }

    return parts.filter(Boolean);
  }

  /**
   * Executes a SINGLE command (no && chain) in the terminal and waits for
   * it to complete. This is the original executeCommand logic.
   *
   * When `detached` is true (used for long-running `start` commands like dev
   * servers), the command is backgrounded with ` &` and NOT tracked in
   * executionState. This is critical: a dev server never exits, so tracking
   * it would leave executionState.active=true forever, causing every later
   * executeCommand to send Ctrl+C and kill the server. Detached commands
   * return immediately with an undefined result.
   */
  async #executeSingleCommand(
    sessionId: string,
    command: string,
    abort?: () => void,
    detached: boolean = false,
  ): Promise<ExecutionResult> {
    if (!this.process || !this.terminal) {
      return undefined;
    }

    const state = this.executionState.get();

    if (!detached) {
      if (state?.active && state.abort) {
        state.abort();
      }

      /*
       * Only send Ctrl+C (\x03) when a tracked command is genuinely running.
       * Sending it unconditionally when the shell is idle can interfere with
       * the prompt and cause the next command to be swallowed.
       */
      if (state?.active) {
        this.terminal.input('\x03');
        await this.waitTillOscCode('prompt');
      }

      if (state && state.executionPrms) {
        await state.executionPrms;
      }
    } else {
      /*
       * Detached: still wait for any in-flight tracked command (e.g. the
       * `npm install` setup) to finish before launching the dev server, but
       * do NOT abort it and do NOT send Ctrl+C.
       */
      if (state?.active && state.executionPrms) {
        try {
          await state.executionPrms;
        } catch {
          /* ignore — the tracked command's error is handled by its caller */
        }
      }
    }

    const cmdToRun = detached ? `${command.trim()} &` : `${command.trim()}`;

    //start a new execution
    this.terminal.input(cmdToRun + '\n');

    if (detached) {
      /*
       * Long-running command (dev server) launched in the background. Do NOT
       * track it in executionState and do NOT wait for an exit OSC (it will
       * never come). Give the shell a brief moment to accept the background
       * job and return the prompt.
       */
      await new Promise((resolve) => setTimeout(resolve, 300));

      return undefined;
    }

    //wait for the execution to finish
    const executionPromise = this.getCurrentExecutionResult();
    this.executionState.set({ sessionId, active: true, executionPrms: executionPromise, abort });

    const resp = await executionPromise;
    this.executionState.set({ sessionId, active: false });

    if (resp) {
      try {
        resp.output = cleanTerminalOutput(resp.output);
      } catch (error) {
        console.log('failed to format terminal output', error);
      }
    }

    return resp;
  }

  async getCurrentExecutionResult(): Promise<ExecutionResult> {
    const { output, exitCode } = await this.waitTillOscCode('exit');
    return { output, exitCode };
  }

  onQRCodeDetected?: (qrCode: string) => void;

  async waitTillOscCode(waitCode: string) {
    let exitCode: number = 0;

    /*
     * Queue-based OSC detection: Instead of reading from a separate stream
     * (which caused the tee backpressure bug), we now read from an in-memory
     * queue that is populated by the terminal writer callback in
     * newAmplifyShellProcess(). The terminal writer pushes OSC codes to
     * #oscQueue as it processes data, and signals #oscResolve when a new
     * entry arrives.
     *
     * This approach works because:
     * 1. The terminal writer is ALWAYS consuming data (no backpressure)
     * 2. The queue is in-memory, so there's no stream blocking issue
     * 3. We use a Promise-based signal (#oscResolve) to efficiently wait
     *    for new OSC codes without polling
     *
     * The output text is taken from #outputAccumulator which the terminal
     * writer continuously populates. We snapshot it at the start and
     * compare with the current state when we find the matching OSC code.
     */
    const outputSnapshotStart = this.#outputAccumulator.length;

    while (true) {
      // Check the queue for any OSC codes that arrived since last check
      while (this.#oscQueue.length > 0) {
        const entry = this.#oscQueue.shift()!;

        if (entry.osc === 'exit' && entry.code) {
          exitCode = parseInt(entry.code, 10);
        }

        if (entry.osc === waitCode) {
          // Found the OSC code we're waiting for
          // Return all accumulated output since we started waiting
          const fullOutput = this.#outputAccumulator.slice(outputSnapshotStart);
          return { output: fullOutput, exitCode };
        }
      }

      // No matching OSC code in queue — wait for the next one to arrive
      // The terminal writer will resolve #oscResolve when it pushes a new entry
      await new Promise<void>((resolve) => {
        this.#oscResolve = resolve;
      });
    }
  }
}

/**
 * Cleans and formats terminal output while preserving structure and paths
 * Handles ANSI, OSC, and various terminal control sequences
 */
export function cleanTerminalOutput(input: string): string {
  // Step 1: Remove OSC sequences (including those with parameters)
  const removeOsc = input
    .replace(/\x1b\](\d+;[^\x07\x1b]*|\d+[^\x07\x1b]*)\x07/g, '')
    .replace(/\](\d+;[^\n]*|\d+[^\n]*)/g, '');

  // Step 2: Remove ANSI escape sequences and color codes more thoroughly
  const removeAnsi = removeOsc
    // Remove all escape sequences with parameters
    .replace(/\u001b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    .replace(/\x1b\[[\?]?[0-9;]*[a-zA-Z]/g, '')
    // Remove color codes
    .replace(/\u001b\[[0-9;]*m/g, '')
    .replace(/\x1b\[[0-9;]*m/g, '')
    // Clean up any remaining escape characters
    .replace(/\u001b/g, '')
    .replace(/\x1b/g, '');

  // Step 3: Clean up carriage returns and newlines
  const cleanNewlines = removeAnsi
    .replace(/\r\n/g, '\n')
    .replace(/\r/g, '\n')
    .replace(/\n{3,}/g, '\n\n');

  // Step 4: Add newlines at key breakpoints while preserving paths
  const formatOutput = cleanNewlines
    // Preserve prompt line
    .replace(/^([~\/][^\n❯]+)❯/m, '$1\n❯')
    // Add newline before command output indicators
    .replace(/(?<!^|\n)>/g, '\n>')
    // Add newline before error keywords without breaking paths
    .replace(/(?<!^|\n|\w)(error|failed|warning|Error|Failed|Warning):/g, '\n$1:')
    // Add newline before 'at' in stack traces without breaking paths
    .replace(/(?<!^|\n|\/)(at\s+(?!async|sync))/g, '\nat ')
    // Ensure 'at async' stays on same line
    .replace(/\bat\s+async/g, 'at async')
    // Add newline before npm error indicators
    .replace(/(?<!^|\n)(npm ERR!)/g, '\n$1');

  // Step 5: Clean up whitespace while preserving intentional spacing
  const cleanSpaces = formatOutput
    .split('\n')
    .map((line) => line.trim())
    .filter((line) => line.length > 0)
    .join('\n');

  // Step 6: Final cleanup
  return cleanSpaces
    .replace(/\n{3,}/g, '\n\n') // Replace multiple newlines with double newlines
    .replace(/:\s+/g, ': ') // Normalize spacing after colons
    .replace(/\s{2,}/g, ' ') // Remove multiple spaces
    .replace(/^\s+|\s+$/g, '') // Trim start and end
    .replace(/\u0000/g, ''); // Remove null characters
}

export function newAmplifyShellProcess() {
  return new AmplifyShell();
}
