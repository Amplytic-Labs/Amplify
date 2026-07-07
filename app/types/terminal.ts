export interface ITerminal {
  readonly cols?: number;
  readonly rows?: number;

  reset: () => void;
  clear?: () => void;
  write: (data: string) => void;
  /**
   * Registers a data listener. Returns a disposable whose `dispose()` removes
   * the listener. Capturing and disposing this is critical to avoid listener
   * accumulation (e.g. the "characters multiply on terminal reset" bug).
   */
  onData: (cb: (data: string) => void) => { dispose: () => void };
  input: (data: string) => void;
  focus?: () => void;
}
