import type { ITheme } from '@xterm/xterm';

const boltLightTheme = {
  // Core colors
  background: '#f3f0f5',
  foreground: '#333333',
  cursor: '#333333',
  cursorAccent: '#f3f0f5',
  selectionBackground: '#b6b4b8',

  // ANSI colors (0–15)
  black: '#000000',
  red: '#cd3131',
  green: '#00bc00',
  yellow: '#949800',
  blue: '#0451a5',
  magenta: '#bc05bc',
  cyan: '#0598bc',
  white: '#555555',
  brightBlack: '#686868',
  brightRed: '#cd3131',
  brightGreen: '#00bc00',
  brightYellow: '#949800',
  brightBlue: '#0451a5',
  brightMagenta: '#bc05bc',
  brightCyan: '#0598bc',
  brightWhite: '#a5a5a5',
};

const boltTheme = {
  // Core colors
  background: '#1e1e21',
  foreground: '#eff0eb',
  cursor: '#eff0eb',
  cursorAccent: '#1e1e21',
  selectionBackground: '#363639',

  // ANSI colors (0–15)
  black: '#000000',
  red: '#ff5c57',
  green: '#5af78e',
  yellow: '#f3f99d',
  blue: '#57c7ff',
  magenta: '#ff6ac1',
  cyan: '#9aedfe',
  white: '#f1f1f0',
  brightBlack: '#686868',
  brightRed: '#ff5c57',
  brightGreen: '#5af78e',
  brightYellow: '#f3f99d',
  brightBlue: '#57c7ff',
  brightMagenta: '#ff6ac1',
  brightCyan: '#9aedfe',
  brightWhite: '#f1f1f0',
};

export function getTerminalTheme(theme: 'light' | 'dark', overrides?: ITheme): ITheme {
  const baseTheme = theme === 'light' ? boltLightTheme : boltTheme;

  return {
    ...baseTheme,
    ...overrides,
  };
}
