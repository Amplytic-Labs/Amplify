/**
 * Screenshot capture service — captures a PNG thumbnail of a project's
 * running WebContainer preview and stores it in IndexedDB.
 *
 * How it works (the cross-origin problem + solution):
 *   The preview iframe is served from `*.local-credentialless.webcontainer-api.io`,
 *   which is cross-origin to the parent app. The parent CANNOT read the
 *   iframe's DOM or draw it to a canvas directly (canvas tainting).
 *
 *   Solution: the WebContainer client supports `setPreviewScript`, which
 *   injects `public/inspector-script.js` into EVERY preview iframe. That
 *   script runs SAME-ORIGIN inside the iframe, so it CAN serialize
 *   `document.body` to an SVG <foreignObject>, draw it to a canvas, and
 *   `postMessage` the resulting data URL back to the parent.
 *
 * Flow:
 *   1. Preview becomes available → `workbenchStore.previews` becomes non-empty
 *      (this is exactly when "No preview available" disappears).
 *   2. We wait a short debounce for the app to paint, then locate the preview
 *      <iframe> element in the DOM.
 *   3. We send `AMPLIFY_CAPTURE_SCREENSHOT` (with a requestId) to the iframe
 *      via `postMessage`.
 *   4. The inspector script captures + replies `AMPLIFY_SCREENSHOT_RESULT`.
 *   5. We store the data URL in IndexedDB (`project_screenshots`, keyed by
 *      projectId) — overwriting any previous screenshot ("delete old" behaviour).
 *   6. We bump `projectStore` with `screenshotAt` + `screenshotFramework` so
 *      the sidebar ExpandableCard re-renders with the new thumbnail.
 *
 * "One time only after the project is running": a per-project-session guard
 * (`_capturedThisSession`) ensures we only capture once per preview server
 * lifetime. The trigger is purely "preview becomes available" — this works
 * for ANY start command the AI or user runs (`npm start`, `npm run dev`,
 * `npx expo start`, `python -m http.server`, a custom script, etc.), not
 * just the auto-detected one. If the user re-runs the project, the guard
 * resets so a fresh capture is taken.
 */

import { useStore } from '@nanostores/react';
import { useEffect, useRef } from 'react';
import { workbenchStore } from '~/lib/stores/workbench';
import { projectStore } from '~/lib/persistence/project-store';
import { db } from '~/lib/persistence/useChatHistory';
import { setProjectScreenshot, deleteProjectScreenshot } from '~/lib/persistence/project-screenshots';
import { detectFrameworkFromFiles } from '~/lib/persistence/project-memory-detect';
import { getFrameworkMeta } from '~/lib/utils/framework-meta';
import type { FileMap } from '~/lib/stores/files';

/**
 * Per-project-session guard: once we've captured a screenshot for a project
 * in this session, we don't capture again until the preview server restarts.
 * Keyed by projectId. Cleared when the project's preview port closes.
 */
const _capturedThisSession = new Set<string>();

/** In-flight capture requests, keyed by requestId. */
const _pending = new Map<string, (result: CaptureResult) => void>();

interface CaptureResult {
  ok: boolean;
  dataUrl?: string;
  width?: number;
  height?: number;
  error?: string;
}

// Global message listener — installed once on first hook mount.
let _listenerInstalled = false;

function installGlobalListener() {
  if (_listenerInstalled || typeof window === 'undefined') return;
  _listenerInstalled = true;

  window.addEventListener('message', (event: MessageEvent) => {
    const data = event.data;

    if (!data || data.type !== 'AMPLIFY_SCREENSHOT_RESULT') return;

    const requestId = data.requestId as string | undefined;

    if (!requestId) return;

    const resolver = _pending.get(requestId);

    if (!resolver) return;

    _pending.delete(requestId);

    resolver({
      ok: data.ok === true,
      dataUrl: data.dataUrl as string | undefined,
      width: data.width as number | undefined,
      height: data.height as number as number | undefined,
      error: data.error as string | undefined,
    });
  });
}

/**
 * Find the live preview <iframe> element in the DOM. The Preview component
 * renders an iframe whose `src` matches the current preview URL.
 */
function findPreviewIframe(previewUrl: string): HTMLIFrameElement | null {
  if (typeof document === 'undefined') return null;
  const iframes = Array.from(document.querySelectorAll<HTMLIFrameElement>('iframe[title="preview"]'));

  if (iframes.length === 0) return null;

  // Prefer the iframe whose src matches the preview URL; fall back to the
  // first preview iframe.
  return iframes.find((f) => f.src && (f.src === previewUrl || previewUrl.startsWith(f.src))) ?? iframes[0];
}

let _requestCounter = 0;

function requestCapture(iframe: HTMLIFrameElement, timeoutMs = 6000): Promise<CaptureResult> {
  return new Promise((resolve) => {
    const requestId = `amplify-shot-${Date.now()}-${++_requestCounter}`;
    _pending.set(requestId, resolve);

    try {
      iframe.contentWindow?.postMessage(
        { type: 'AMPLIFY_CAPTURE_SCREENSHOT', requestId },
        '*',
      );
    } catch (e) {
      _pending.delete(requestId);
      resolve({ ok: false, error: String(e) });

      return;
    }

    // Timeout — inspector script didn't reply (e.g. not loaded yet, or the
    // app blocked postMessage). Resolve as failure so the caller can retry
    // or fall back.
    setTimeout(() => {
      if (_pending.has(requestId)) {
        _pending.delete(requestId);
        resolve({ ok: false, error: 'capture timeout' });
      }
    }, timeoutMs);
  });
}

/**
 * Capture a screenshot for the currently-loaded project. Called when the
 * preview becomes available. Idempotent per session via `_capturedThisSession`.
 *
 * Two-stage capture:
 *   1. BEST-EFFORT REAL CAPTURE — ask the preview iframe (via the injected
 *      inspector script) to serialize its DOM to an SVG <foreignObject> +
 *      canvas and postMessage the data URL back. This works in browsers that
 *      allow loading foreignObject SVGs into an <img>. It is cross-origin-safe
 *      because the script runs INSIDE the iframe.
 *   2. RELIABLE SYNTHETIC FALLBACK — if the real capture fails or times out
 *      (common in headless/strict browsers where foreignObject image loading
 *      is blocked), generate a branded canvas-drawn thumbnail: framework
 *      gradient + icon + project name + version. This ALWAYS works and gives
 *      the ExpandableCard a real, representative image instead of a blank box.
 */
async function captureForCurrentProject(): Promise<void> {
  const projectId = workbenchStore.loadedProjectId.get();

  if (!projectId || projectId === '<none>') {
    return;
  }

  if (_capturedThisSession.has(projectId)) {
    return;
  }

  if (!db) {
    return;
  }

  const previews = workbenchStore.previews.get();
  const ready = previews.find((p) => p.ready);

  if (!ready || !ready.baseUrl) {
    return;
  }

  // Mark as captured BEFORE sending so concurrent triggers don't double-fire.
  _capturedThisSession.add(projectId);

  // Small debounce so the freshly-loaded app has a chance to paint.
  await new Promise((r) => setTimeout(r, 1500));

  // Determine the framework label + project name for the (fallback) thumbnail.
  let framework: string | undefined;
  let projectName: string | undefined;

  try {
    const files = workbenchStore.files.get() as FileMap;
    framework = detectFrameworkFromFiles(files);
  } catch {
    framework = undefined;
  }

  try {
    const project = projectStore.getProject(projectId);
    projectName = project?.name;
    framework = framework || project?.memory?.framework || project?.screenshotFramework;
  } catch {
    // ignore
  }

  let dataUrl: string | undefined;
  let width = 1280;
  let height = 800;

  // Stage 1: best-effort real capture via the inspector script.
  const iframe = findPreviewIframe(ready.baseUrl);

  if (iframe && iframe.contentWindow) {
    const real = await requestCapture(iframe);

    if (real.ok && real.dataUrl) {
      dataUrl = real.dataUrl;
      width = real.width ?? width;
      height = real.height ?? height;
    }
  }

  // Stage 2: reliable synthetic fallback.
  if (!dataUrl) {
    try {
      dataUrl = generateSyntheticThumbnail(projectName || 'Project', framework);
    } catch (e) {
      console.warn('[screenshotCapture] synthetic thumbnail failed:', e);
      _capturedThisSession.delete(projectId);

      return;
    }
  }

  const now = new Date().toISOString();

  try {
    // setProjectScreenshot uses `put` — overwrites any previous screenshot
    // for this projectId. This is the "delete old screenshots" behaviour:
    // we never keep more than one per project.
    await setProjectScreenshot(db, {
      projectId,
      dataUrl,
      capturedAt: now,
      framework,
      width,
      height,
    });

    // Bump the project store so the sidebar ExpandableCard re-renders.
    projectStore.updateProject(projectId, {
      screenshotAt: now,
      screenshotFramework: framework,
    });

    console.log('[screenshotCapture] captured for', projectId, `${width}x${height}`, dataUrl.startsWith('data:image/svg') ? '(synthetic)' : '(real)');
  } catch (e) {
    console.warn('[screenshotCapture] failed to store:', e);
    _capturedThisSession.delete(projectId);
  }
}

/**
 * Generate a branded synthetic thumbnail via Canvas 2D (NOT foreignObject —
 * this always works). Renders a framework-tinted gradient background, the
 * framework icon (as a colored circle since canvas can't render UnoCSS
 * classes), the project name, and a "Preview" label.
 *
 * Returns a JPEG data URL (smaller than PNG for storage).
 */
function generateSyntheticThumbnail(projectName: string, framework?: string): string {
  const W = 1280;
  const H = 800;
  const canvas = document.createElement('canvas');
  canvas.width = W;
  canvas.height = H;
  const ctx = canvas.getContext('2d');

  if (!ctx) {
    throw new Error('canvas 2d context unavailable');
  }

  // Framework → gradient color stops.
  const meta = getFrameworkMeta(framework);
  const [c1, c2] = gradientColorsFor(meta);

  // Background gradient.
  const grad = ctx.createLinearGradient(0, 0, W, H);
  grad.addColorStop(0, c1);
  grad.addColorStop(1, c2);
  ctx.fillStyle = grad;
  ctx.fillRect(0, 0, W, H);

  // Subtle dot grid overlay.
  ctx.fillStyle = 'rgba(255,255,255,0.06)';
  for (let x = 40; x < W; x += 40) {
    for (let y = 40; y < H; y += 40) {
      ctx.beginPath();
      ctx.arc(x, y, 1.5, 0, Math.PI * 2);
      ctx.fill();
    }
  }

  // Centered framework icon circle.
  const cx = W / 2;
  const cy = H / 2 - 60;
  ctx.beginPath();
  ctx.arc(cx, cy, 90, 0, Math.PI * 2);
  ctx.fillStyle = 'rgba(255,255,255,0.15)';
  ctx.fill();
  ctx.lineWidth = 3;
  ctx.strokeStyle = 'rgba(255,255,255,0.4)';
  ctx.setLineDash([8, 6]);
  ctx.stroke();
  ctx.setLineDash([]);

  // Framework initial inside the circle.
  const initial = (meta.label[0] || 'P').toUpperCase();
  ctx.fillStyle = 'rgba(255,255,255,0.95)';
  ctx.font = 'bold 72px Inter, system-ui, sans-serif';
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(initial, cx, cy + 4);

  // Project name.
  ctx.fillStyle = 'rgba(255,255,255,0.98)';
  ctx.font = 'bold 48px Inter, system-ui, sans-serif';
  const name = projectName.length > 32 ? projectName.slice(0, 32) + '…' : projectName;
  ctx.fillText(name, cx, cy + 170);

  // Framework label.
  ctx.fillStyle = 'rgba(255,255,255,0.7)';
  ctx.font = '500 28px Inter, system-ui, sans-serif';
  ctx.fillText(framework || meta.label, cx, cy + 215);

  // Bottom-right "Amplify preview" tag.
  ctx.font = '500 22px Inter, system-ui, sans-serif';
  ctx.textAlign = 'right';
  ctx.fillStyle = 'rgba(255,255,255,0.5)';
  ctx.fillText('Amplify · preview', W - 40, H - 40);

  return canvas.toDataURL('image/jpeg', 0.85);
}

function gradientColorsFor(meta: { gradient: string }): [string, string] {
  // Map a few known gradient classes to concrete colors. Default = purple.
  const g = meta.gradient;

  if (g.includes('sky') || g.includes('cyan')) return ['#0ea5e9', '#0369a1'];
  if (g.includes('emerald') || g.includes('teal')) return ['#10b981', '#047857'];
  if (g.includes('amber')) return ['#f59e0b', '#7c3aed'];
  if (g.includes('orange')) return ['#f97316', '#db2777'];
  if (g.includes('red') || g.includes('rose')) return ['#ef4444', '#9f1239'];
  if (g.includes('zinc')) return ['#3f3f46', '#18181b'];
  if (g.includes('blue')) return ['#3b82f6', '#1e40af'];

  return ['#a855f7', '#7c3aed']; // purple default
}

/**
 * React hook (mounted once, at the app shell) that watches for the
 * "preview becomes available" trigger and fires a one-shot capture.
 *
 * The trigger: `workbenchStore.previews` transitions to contain at least one
 * ready entry (i.e. "No preview available" disappears). This is the ONLY
 * signal we gate on — we deliberately do NOT require `projectAutoStarted`,
 * because a project can be started by ANY command the AI or user runs in the
 * shell (`npm start`, `npm run dev`, `npx expo start`, `python -m http.server`,
 * a custom script, etc.). The preview becoming available is the universal
 * "the app is now running" signal, regardless of how it was started.
 */
export function useScreenshotCapture(): void {
  const previews = useStore(workbenchStore.previews);
  const loadedProjectId = useStore(workbenchStore.loadedProjectId);
  const lastCaptureAttempt = useRef(0);

  useEffect(() => {
    installGlobalListener();
  }, []);

  useEffect(() => {
    if (!loadedProjectId || loadedProjectId === '<none>') {
      return;
    }

    // Only capture when there's at least one ready preview (preview available).
    // This is the "Preview is not available disappears" moment — works for any
    // start command (npm start, npm run dev, npx expo start, custom, etc.).
    const hasReady = previews.some((p) => p.ready);

    if (!hasReady) {
      return;
    }

    // Debounce: avoid hammering captures if previews flicker.
    const now = Date.now();

    if (now - lastCaptureAttempt.current < 5000) {
      return;
    }

    lastCaptureAttempt.current = now;

    // Fire-and-forget — the service guards against double-capture internally.
    captureForCurrentProject().catch((e) => {
      console.warn('[screenshotCapture] error:', e);
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [previews, loadedProjectId]);
}

/**
 * Reset the per-session capture guard for a project (e.g. when the user
 * re-runs the project setup). Allows a fresh capture on the next preview.
 */
export function resetScreenshotCaptureForProject(projectId: string): void {
  _capturedThisSession.delete(projectId);
}

/**
 * Manually delete a project's stored screenshot (e.g. on project delete).
 */
export async function clearProjectScreenshot(projectId: string): Promise<void> {
  if (!db) return;

  try {
    await deleteProjectScreenshot(db, projectId);
    projectStore.updateProject(projectId, {
      screenshotAt: undefined,
      screenshotFramework: undefined,
    });
  } catch (e) {
    console.warn('[screenshotCapture] clear failed:', e);
  }
}
