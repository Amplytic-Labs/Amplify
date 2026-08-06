import type { CSSProperties } from 'react';

declare global {
  interface Window {
    showDirectoryPicker(): Promise<FileSystemDirectoryHandle>;
    webkitSpeechRecognition: typeof SpeechRecognition;
    SpeechRecognition: typeof SpeechRecognition;
  }

  interface Performance {
    memory?: {
      jsHeapSizeLimit: number;
      totalJSHeapSize: number;
      usedJSHeapSize: number;
    };
  }
}

/*
 * Web Component type declarations for custom elements loaded from CDN.
 * These elements are created at runtime via script injection (see
 * ChatModeToggle.tsx); we only declare enough of their shape for JSX
 * type-checking, not full property validation.
 *
 * NOTE: must be declared inside `React.JSX` because @types/react 18
 * re-declares the global `JSX` namespace as `React.JSX`. Declaring only
 * the global `JSX` is insufficient — TS resolves the JSX namespace via
 * the jsx-runtime import source, which is React.
 */
declare module 'react' {
  namespace JSX {
    interface IntrinsicElements {
      'iconify-icon': {
        icon: string;
        style?: CSSProperties;
        className?: string;
        width?: number | string;
        height?: number | string;
        flip?: string;
        rotate?: number | string;
        inline?: boolean;
        [key: string]: unknown;
      };
    }
  }
}
