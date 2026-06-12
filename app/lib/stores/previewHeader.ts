import { atom, type WritableAtom } from 'nanostores';

/**
 * Shared state store for the Preview toolbar, used by both Preview.tsx
 * (which manages the iframe) and PreviewHeader.tsx (which renders the UI).
 */

export interface WindowSizeOption {
  name: string;
  width: number;
  height: number;
  icon: string;
  hasFrame?: boolean;
  frameType?: 'mobile' | 'tablet' | 'laptop' | 'desktop';
}

export const WINDOW_SIZES: WindowSizeOption[] = [
  { name: 'iPhone SE', width: 375, height: 667, icon: 'i-ph:device-mobile', hasFrame: true, frameType: 'mobile' },
  { name: 'iPhone 12/13', width: 390, height: 844, icon: 'i-ph:device-mobile', hasFrame: true, frameType: 'mobile' },
  {
    name: 'iPhone 12/13 Pro Max',
    width: 428,
    height: 926,
    icon: 'i-ph:device-mobile',
    hasFrame: true,
    frameType: 'mobile',
  },
  { name: 'iPad Mini', width: 768, height: 1024, icon: 'i-ph:device-tablet', hasFrame: true, frameType: 'tablet' },
  { name: 'iPad Air', width: 820, height: 1180, icon: 'i-ph:device-tablet', hasFrame: true, frameType: 'tablet' },
  { name: 'iPad Pro 11"', width: 834, height: 1194, icon: 'i-ph:device-tablet', hasFrame: true, frameType: 'tablet' },
  {
    name: 'iPad Pro 12.9"',
    width: 1024,
    height: 1366,
    icon: 'i-ph:device-tablet',
    hasFrame: true,
    frameType: 'tablet',
  },
  { name: 'Small Laptop', width: 1280, height: 800, icon: 'i-ph:laptop', hasFrame: true, frameType: 'laptop' },
  { name: 'Laptop', width: 1366, height: 768, icon: 'i-ph:laptop', hasFrame: true, frameType: 'laptop' },
  { name: 'Large Laptop', width: 1440, height: 900, icon: 'i-ph:laptop', hasFrame: true, frameType: 'laptop' },
  { name: 'Desktop', width: 1920, height: 1080, icon: 'i-ph:monitor', hasFrame: true, frameType: 'desktop' },
  { name: '4K Display', width: 3840, height: 2160, icon: 'i-ph:monitor', hasFrame: true, frameType: 'desktop' },
];

// Active preview index
export const activePreviewIndexAtom: WritableAtom<number> = atom(0);

// Dropdown states
export const isPortDropdownOpenAtom: WritableAtom<boolean> = atom(false);
export const isWindowSizeDropdownOpenAtom: WritableAtom<boolean> = atom(false);

// Toggle states
export const isSelectionModeAtom: WritableAtom<boolean> = atom(false);
export const isInspectorModeAtom: WritableAtom<boolean> = atom(false);
export const isDeviceModeOnAtom: WritableAtom<boolean> = atom(false);
export const isFullscreenAtom: WritableAtom<boolean> = atom(false);

// URL / path state
export const displayPathAtom: WritableAtom<string> = atom('/');
export const iframeUrlAtom: WritableAtom<string | undefined> = atom(undefined);

// Device mode state
export const selectedWindowSizeAtom: WritableAtom<WindowSizeOption> = atom<WindowSizeOption>(WINDOW_SIZES[0]);
export const isLandscapeAtom: WritableAtom<boolean> = atom(false);
export const showDeviceFrameAtom: WritableAtom<boolean> = atom(true);
export const showDeviceFrameInPreviewAtom: WritableAtom<boolean> = atom(false);
export const widthPercentAtom: WritableAtom<number> = atom(37.5);
export const currentWidthAtom: WritableAtom<number> = atom(0);

// QR modal
export const isExpoQrModalOpenAtom: WritableAtom<boolean> = atom(false);

/**
 * Callback atoms — registered by Preview.tsx so PreviewHeader can trigger
 * iframe-dependent actions without holding a ref.
 */
export const reloadPreviewFnAtom: WritableAtom<(() => void) | null> = atom<(() => void) | null>(null);
export const toggleFullscreenFnAtom: WritableAtom<(() => void) | null> = atom<(() => void) | null>(null);
export const toggleInspectorFnAtom: WritableAtom<(() => void) | null> = atom<(() => void) | null>(null);

/**
 * Helper: has-selected-preview ref is a plain object so it survives across
 * renders without causing re-renders.
 */
export const hasSelectedPreviewRef = { current: false };
