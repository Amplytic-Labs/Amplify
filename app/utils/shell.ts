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
  #outputStream: ReadableStreamDefaultReader<string> | undefined;
  #shellInputStream: WritableStreamDefaultWriter<string> | undefined;

  /*
   * Track the onData disposable + pipe so we can tear them down before re-init
   * (prevents the "characters multiply on reset" bug where each reset adds a
   * duplicate onData listener + echo pipe on the same long-lived XTerm).
   */
  #onDataDisposable: { dispose: () => void } | undefined;
  #terminalPipeController: AbortController | undefined;
  #expoUrlAbort: AbortController | undefined;
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

    this.#expoUrlAbort?.abort();
    this.#expoUrlAbort = undefined;

    try {
      this.#process?.kill();
    } catch {
      /* process may already be dead */
    }
    this.#process = undefined;

    this.#outputStream = undefined;
    this.#shellInputStream = undefined;
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

    // Use all three streams from tee: one for terminal, one for command execution, one for Expo URL detection
    const { process, commandStream, expoUrlStream } = await this.newAmplifyShellProcess(webcontainer, terminal);
    this.#process = process;
    this.#outputStream = commandStream.getReader();

    // Start background Expo URL watcher immediately
    this._watchExpoUrlInBackground(expoUrlStream);

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

    // Tee the output so we can have three independent readers
    const [streamA, streamB] = process.output.tee();
    const [streamC, streamD] = streamB.tee();

    const jshReady = withResolvers<void>();
    let isInteractive = false;

    /*
     * Use an AbortController so #teardown() can cancel this pipe without
     * waiting for the stream to end naturally.
     */
    this.#terminalPipeController = new AbortController();
    streamA.pipeTo(
      new WritableStream({
        write(data) {
          if (!isInteractive) {
            const [, osc] = data.match(/\x1b\]654;([^\x07]+)\x07/) || [];

            if (osc === 'interactive') {
              isInteractive = true;
              jshReady.resolve();
            }
          }

          terminal.write(data);
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

    // Return all streams for use in init
    return { process, terminalStream: streamA, commandStream: streamC, expoUrlStream: streamD };
  }

  // Dedicated background watcher for Expo URL
  private async _watchExpoUrlInBackground(stream: ReadableStream<string>) {
    this.#expoUrlAbort = new AbortController();

    const reader = stream.getReader();
    let buffer = '';
    // ANSI escape code regex — strip these BEFORE URL matching so they don't
    // break the URL regex. The previous approach matched the URL first and then
    // tried to strip ANSI codes from the match, but embedded ANSI sequences
    // between URL characters prevented the regex from matching at all.
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    // Also strip OSC (Operating System Command) sequences and other control chars
    const oscRegex = /\x1b\][^\x07]*\x07/g;
    // Expo URL regex — matches both exp:// and *.boltexpo.dev formats
    const expoUrlRegex = /(exp:\/\/[^\s]+|https?:\/\/[^\s]+\.boltexpo\.dev[^\s]*)/;

    while (true) {
      if (this.#expoUrlAbort?.signal.aborted) {
        break;
      }

      const { value, done } = await reader.read();

      if (done) {
        break;
      }

      buffer += value || '';

      // Strip ANSI escape codes AND OSC sequences from buffer before URL matching.
      // We also strip other common terminal noise characters.
      const cleanBuffer = buffer
        .replace(ansiRegex, '')
        .replace(oscRegex, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a]/g, ''); // Strip control chars except \n, \r, \t

      const expoUrlMatch = cleanBuffer.match(expoUrlRegex);

      if (expoUrlMatch) {
        // Remove any remaining non-printable characters from the matched URL
        const cleanUrl = expoUrlMatch[1].replace(/[^\x20-\x7E]/g, '');
        expoUrlAtom.set(cleanUrl);
        // Clear the buffer after a successful match — the Expo URL is emitted
        // once per project start, so we don't need to retain old data.
        buffer = '';
      }

      if (buffer.length > 4096) {
        buffer = buffer.slice(-2048);
      }
    }
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
    let fullOutput = '';
    let exitCode: number = 0;
    let buffer = ''; // <-- Add a buffer to accumulate output

    if (!this.#outputStream) {
      return { output: fullOutput, exitCode };
    }

    const tappedStream = this.#outputStream;

    // ANSI escape code regex — strip BEFORE URL matching so embedded ANSI
    // sequences between URL characters don't break the match.
    const ansiRegex = /[\u001b\u009b][[()#;?]*(?:[0-9]{1,4}(?:;[0-9]{0,4})*)?[0-9A-ORZcf-nqry=><]/g;
    // Also strip OSC sequences
    const oscRegex = /\x1b\][^\x07]*\x07/g;
    // Regex for Expo URL
    const expoUrlRegex = /(exp:\/\/[^\s]+|https?:\/\/[^\s]+\.boltexpo\.dev[^\s]*)/;

    while (true) {
      const { value, done } = await tappedStream.read();

      if (done) {
        break;
      }

      const text = value || '';
      fullOutput += text;
      buffer += text; // <-- Accumulate in buffer

      // Strip ANSI escape codes AND OSC sequences from buffer before URL matching.
      const cleanBuffer = buffer
        .replace(ansiRegex, '')
        .replace(oscRegex, '')
        .replace(/[\x00-\x08\x0b\x0c\x0e-\x1a]/g, '');

      // Extract Expo URL from cleaned buffer and set store
      const expoUrlMatch = cleanBuffer.match(expoUrlRegex);

      if (expoUrlMatch) {
        // Remove any remaining non-printable characters from the matched URL
        const cleanUrl = expoUrlMatch[1].replace(/[^\x20-\x7E]/g, '');
        expoUrlAtom.set(cleanUrl);

        // Clear buffer after successful match to avoid re-matching
        buffer = '';
      }

      // Check if command completion signal with exit code
      const [, osc, , , code] = text.match(/\x1b\]654;([^\x07=]+)=?((-?\d+):(\d+))?\x07/) || [];

      if (osc === 'exit') {
        exitCode = parseInt(code, 10);
      }

      if (osc === waitCode) {
        break;
      }
    }

    return { output: fullOutput, exitCode };
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
