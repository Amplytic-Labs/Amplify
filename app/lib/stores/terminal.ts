import type { WebContainer, WebContainerProcess } from '@webcontainer/api';
import { atom, type WritableAtom } from 'nanostores';
import type { ITerminal } from '~/types/terminal';
import { newAmplifyShellProcess, newShellProcess } from '~/utils/shell';
import { coloredText } from '~/utils/terminal';

export class TerminalStore {
  #webcontainer: Promise<WebContainer>;
  #terminals: Array<{ terminal: ITerminal; process: WebContainerProcess }> = [];
  #amplifyTerminal = newAmplifyShellProcess();

  /*
   * Dedicated shell for project initialization (npm install + npm run dev).
   *
   * This is SEPARATE from the `#amplifyTerminal` (which the AI's shell/start
   * actions run on). Keeping them separate means:
   *  - The AI's commands (e.g. `npm install some-package`) don't interfere
   *    with the project's running dev server.
   *  - The dev server's output doesn't pollute the AI's terminal scrollback.
   *  - Ctrl+C in the AI terminal doesn't kill the dev server.
   *
   * The init terminal is attached to a hidden <Terminal> component in
   * TerminalTabs.tsx — it needs a real xterm instance to receive stdin/stdout
   * from the WebContainer process, but it's not visible to the user.
   */
  #initTerminal = newAmplifyShellProcess();

  showTerminal: WritableAtom<boolean> = import.meta.hot?.data.showTerminal ?? atom(true);

  constructor(webcontainerPromise: Promise<WebContainer>) {
    this.#webcontainer = webcontainerPromise;

    if (import.meta.hot) {
      import.meta.hot.data.showTerminal = this.showTerminal;
    }
  }
  get amplifyTerminal() {
    return this.#amplifyTerminal;
  }

  get initTerminal() {
    return this.#initTerminal;
  }

  toggleTerminal(value?: boolean) {
    this.showTerminal.set(value !== undefined ? value : !this.showTerminal.get());
  }
  async attachAmplifyTerminal(terminal: ITerminal) {
    try {
      const wc = await this.#webcontainer;
      await this.#amplifyTerminal.init(wc, terminal);
    } catch (error: any) {
      terminal.write(coloredText.red('Failed to spawn amplify shell\n\n') + error.message);
      return;
    }
  }

  /*
   * Attach the hidden init terminal. Called from TerminalTabs.tsx which
   * renders an off-screen <Terminal> for this purpose. Safe to call
   * multiple times — `AmplifyShell.init()` is guarded by
   * `#initializedOnce`.
   */
  async attachInitTerminal(terminal: ITerminal) {
    try {
      const wc = await this.#webcontainer;
      await this.#initTerminal.init(wc, terminal);
    } catch (error: any) {
      console.warn('[TerminalStore] Failed to spawn init shell:', error.message);
      return;
    }
  }

  async attachTerminal(terminal: ITerminal) {
    try {
      const shellProcess = await newShellProcess(await this.#webcontainer, terminal);
      this.#terminals.push({ terminal, process: shellProcess });
    } catch (error: any) {
      terminal.write(coloredText.red('Failed to spawn shell\n\n') + error.message);
      return;
    }
  }

  onTerminalResize(cols: number, rows: number) {
    for (const { process } of this.#terminals) {
      process.resize({ cols, rows });
    }
  }

  async detachTerminal(terminal: ITerminal) {
    const terminalIndex = this.#terminals.findIndex((t) => t.terminal === terminal);

    if (terminalIndex !== -1) {
      const { process } = this.#terminals[terminalIndex];

      try {
        process.kill();
      } catch (error) {
        console.warn('Failed to kill terminal process:', error);
      }
      this.#terminals.splice(terminalIndex, 1);
    }
  }
}
