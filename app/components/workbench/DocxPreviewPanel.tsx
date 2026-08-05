import { useState, useEffect, useRef, useCallback, memo } from 'react';
import { useStore } from '@nanostores/react';
import { docxArtifactStore, clearDocxArtifact } from '~/lib/stores/docx-artifact';
import { workbenchStore } from '~/lib/stores/workbench';
import { Markdown } from '~/components/chat/Markdown';
import type { DiagramAsset } from '~/lib/markdown/types';
import { Download, RefreshCw, X, FileText, Loader2, AlertCircle } from 'lucide-react';

/*
 * DOCX preview panel — renders a chat-generated `<docxartifact>` document
 * as a faithful Word-document preview (via the /api/preview-docx route that
 * builds a real .docx then converts it back to HTML with mammoth) and offers
 * a one-click download of the actual .docx file (via /api/export-docx).
 *
 * COEXISTENCE WITH WORKSPACE: this panel lives in the workbench as the
 * "document" view, alongside "code" / "preview". It does NOT touch the
 * WebContainer file tree — the document is a transient chat artifact held
 * in the docxArtifactStore. Switching back to "code" / "preview" leaves the
 * workspace untouched; the document stays in the store until cleared or
 * replaced by a newer `<docxartifact>`.
 *
 * DIAGRAM ASSETS: mermaid + chart.js blocks inside the document are rendered
 * in an off-screen <Markdown> container; once rendered, their SVG / PNG data
 * URLs are collected (in document order) and sent to the server so the .docx
 * embeds real diagram images instead of code-block fallbacks. Math equations
 * are converted to native OMML server-side (no asset needed).
 */

const PREVIEW_DEBOUNCE_MS = 600;
const ASSET_RENDER_WAIT_MS = 1500;

interface PreviewMeta {
  paragraphs: number;
  tables: number;
  images: number;
  equations: number;
  bytes: number;
}

export const DocxPreviewPanel = memo(() => {
  const docxState = useStore(docxArtifactStore);
  const markdown = docxState?.markdown || '';
  const isStreaming = docxState?.streaming ?? false;
  const theme = docxState?.theme ?? null;

  /*
   * Serialised theme for change-detection in effect deps (avoids re-fetching
   * when the theme object identity changes but content is identical).
   */
  const themeKey = JSON.stringify(theme);

  const [html, setHtml] = useState('');
  const [loading, setLoading] = useState(false);
  const [meta, setMeta] = useState<PreviewMeta | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [downloading, setDownloading] = useState(false);

  const hiddenRenderRef = useRef<HTMLDivElement>(null);
  const fetchTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assetTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const assetsRef = useRef<DiagramAsset[]>([]);
  const assetsReadyRef = useRef(false);
  const lastFetchedKeyRef = useRef('');

  /*
   * Collect rendered diagram assets (mermaid SVGs + chart.js canvas PNGs)
   * from the off-screen <Markdown> render, in document order. The ids match
   * the docx-builder's expected format: `mermaid-0`, `mermaid-1`, `chart-0`…
   */
  const collectAssets = useCallback((): DiagramAsset[] => {
    const container = hiddenRenderRef.current;

    if (!container) {
      return [];
    }

    const assets: DiagramAsset[] = [];
    let mermaidIdx = 0;
    let chartIdx = 0;

    // Mermaid renders an <svg> inside a .mermaid container.
    const mermaidSvgs = container.querySelectorAll('.mermaid svg, [data-mermaid] svg');

    mermaidSvgs.forEach((svg) => {
      const clone = svg.cloneNode(true) as SVGElement;
      clone.setAttribute('xmlns', 'http://www.w3.org/2000/svg');

      const svgStr = new XMLSerializer().serializeToString(clone);
      assets.push({ id: `mermaid-${mermaidIdx++}`, type: 'mermaid', svg: svgStr });
    });

    // Chart.js renders a <canvas> inside a chart container.
    const canvases = container.querySelectorAll('canvas');

    canvases.forEach((canvas) => {
      try {
        const pngDataUrl = (canvas as HTMLCanvasElement).toDataURL('image/png');
        assets.push({ id: `chart-${chartIdx++}`, type: 'chart', pngDataUrl });
      } catch {
        // canvas may be tainted (cross-origin) — skip it; builder falls back to code block
      }
    });

    return assets;
  }, []);

  const fetchPreview = useCallback(
    async (md: string, force = false) => {
      if (!md.trim()) {
        setHtml('');
        setMeta(null);

        return;
      }

      /*
       * Read the current theme fresh from the store on every call — the
       * theme may have been updated since the last render (streaming ticks).
       */
      const currentTheme = docxArtifactStore.get()?.theme ?? null;
      const key = md + '\u0000' + JSON.stringify(currentTheme);

      /*
       * Skip if nothing changed (avoid re-fetch on identical streaming ticks).
       * Both markdown AND theme must match the last-fetched values.
       */
      if (!force && key === lastFetchedKeyRef.current && assetsReadyRef.current) {
        return;
      }

      setLoading(true);
      setError(null);

      try {
        const assets = assetsReadyRef.current ? collectAssets() : [];
        const res = await fetch('/api/preview-docx', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ markdown: md, assets, theme: currentTheme }),
        });

        if (!res.ok) {
          const err = (await res.json().catch(() => ({}))) as { error?: string };
          throw new Error(err.error || `Preview failed (${res.status})`);
        }

        const data = (await res.json()) as { html?: string; meta?: PreviewMeta };
        setHtml(data.html || '');
        setMeta(data.meta || null);
        lastFetchedKeyRef.current = key;
      } catch (e: any) {
        setError(e?.message || 'Failed to render document preview');
      } finally {
        setLoading(false);
      }
    },
    [collectAssets],
  );

  /*
   * When the markdown changes (streaming or new document):
   *   1. Reset the asset-ready flag (new content needs re-render).
   *   2. After the off-screen <Markdown> mounts, wait for mermaid/chart to
   *      finish rendering, then collect assets + fetch the preview.
   *   3. Debounce so rapid streaming ticks don't spam the API.
   */
  useEffect(() => {
    if (!markdown) {
      setHtml('');
      setMeta(null);
      setError(null);
      assetsReadyRef.current = false;
      assetsRef.current = [];

      return;
    }

    assetsReadyRef.current = false;

    // Clear pending timers
    if (fetchTimerRef.current) {
      clearTimeout(fetchTimerRef.current);
    }

    if (assetTimerRef.current) {
      clearTimeout(assetTimerRef.current);
    }

    // Wait for the off-screen render's mermaid/chart to finish, then fetch.
    assetTimerRef.current = setTimeout(() => {
      assetsReadyRef.current = true;
      assetsRef.current = collectAssets();
      fetchPreview(markdown);
    }, ASSET_RENDER_WAIT_MS);

    // eslint-disable-next-line consistent-return
    return () => {
      if (assetTimerRef.current) {
        clearTimeout(assetTimerRef.current);
      }
    };
  }, [markdown, themeKey, collectAssets, fetchPreview]);

  // Re-fetch with fresh assets once streaming completes (final render)
  // eslint-disable-next-line consistent-return
  useEffect(() => {
    if (!isStreaming && markdown && assetsReadyRef.current) {
      fetchTimerRef.current = setTimeout(() => {
        assetsReadyRef.current = true;
        assetsRef.current = collectAssets();
        fetchPreview(markdown, true);
      }, PREVIEW_DEBOUNCE_MS);

      return () => {
        if (fetchTimerRef.current) {
          clearTimeout(fetchTimerRef.current);
        }
      };
    }
  }, [isStreaming, markdown, themeKey, collectAssets, fetchPreview]);

  const handleDownload = useCallback(async () => {
    if (!markdown) {
      return;
    }

    setDownloading(true);

    try {
      const assets = collectAssets();
      const currentTheme = docxArtifactStore.get()?.theme ?? null;
      const res = await fetch('/api/export-docx', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ markdown, assets, theme: currentTheme }),
      });

      if (!res.ok) {
        const err = (await res.json().catch(() => ({}))) as { error?: string };
        throw new Error(err.error || `Download failed (${res.status})`);
      }

      const blob = await res.blob();
      const url = URL.createObjectURL(blob);
      const a = document.createElement('a');
      a.href = url;
      a.download = 'document.docx';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);
      URL.revokeObjectURL(url);
    } catch (e: any) {
      setError(e?.message || 'Failed to download document');
    } finally {
      setDownloading(false);
    }
  }, [markdown, collectAssets]);

  const handleClose = useCallback(() => {
    clearDocxArtifact();
    workbenchStore.currentView.set('code');
  }, []);

  const handleRefresh = useCallback(() => {
    assetsReadyRef.current = true;
    assetsRef.current = collectAssets();
    fetchPreview(markdown, true);
  }, [markdown, collectAssets, fetchPreview]);

  if (!markdown) {
    return (
      <div className="h-full flex items-center justify-center bg-amplify-elements-background-depth-2">
        <div className="flex flex-col items-center gap-3 text-amplify-elements-textTertiary">
          <FileText className="w-8 h-8" />
          <p className="text-sm">No document to preview</p>
          <p className="text-xs text-amplify-elements-textTertiary/70">
            Ask the AI to create a document and it will appear here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full flex flex-col bg-amplify-elements-background-depth-2 overflow-hidden">
      {/* Off-screen render for diagram asset collection */}
      <div
        ref={hiddenRenderRef}
        aria-hidden
        style={{
          position: 'absolute',
          left: '-99999px',
          top: '0',
          width: '800px',
          pointerEvents: 'none',
          opacity: '0',
        }}
      >
        <Markdown>{markdown}</Markdown>
      </div>

      {/* Toolbar */}
      <div className="flex items-center justify-between gap-2 px-4 py-2.5 border-b border-amplify-elements-borderColor bg-amplify-elements-background-depth-1">
        <div className="flex items-center gap-2 min-w-0">
          <FileText className="w-4 h-4 text-amplify-elements-textSecondary flex-shrink-0" />
          <span className="text-sm font-medium text-amplify-elements-textPrimary truncate">Document</span>
          {isStreaming && (
            <span className="flex items-center gap-1 text-[10px] text-amplify-elements-textTertiary">
              <Loader2 className="w-3 h-3 animate-spin" />
              streaming…
            </span>
          )}
          {meta && !isStreaming && (
            <span className="hidden sm:inline text-[10px] text-amplify-elements-textTertiary font-mono">
              {meta.paragraphs}p · {meta.tables}t · {meta.images}i{meta.equations > 0 ? ` · ${meta.equations}eq` : ''} ·{' '}
              {(meta.bytes / 1024).toFixed(0)}KB
            </span>
          )}
        </div>
        <div className="flex items-center gap-1">
          <button
            onClick={handleRefresh}
            disabled={loading}
            title="Refresh preview"
            className="p-1.5 rounded-md text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary hover:bg-amplify-elements-background-depth-3 transition-colors disabled:opacity-50"
          >
            <RefreshCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
          </button>
          <button
            onClick={handleDownload}
            disabled={downloading}
            title="Download .docx"
            className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-xs font-medium bg-accent-500/10 text-accent-500 hover:bg-accent-500/20 transition-colors disabled:opacity-50"
          >
            {downloading ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <Download className="w-3.5 h-3.5" />}
            <span className="hidden sm:inline">Download</span>
          </button>
          <button
            onClick={handleClose}
            title="Close document"
            className="p-1.5 rounded-md text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary hover:bg-amplify-elements-background-depth-3 transition-colors"
          >
            <X className="w-3.5 h-3.5" />
          </button>
        </div>
      </div>

      {/* Preview body */}
      <div className="flex-1 overflow-auto">
        {error ? (
          <div className="flex flex-col items-center justify-center h-full gap-2 p-6 text-center">
            <AlertCircle className="w-8 h-8 text-red-400" />
            <p className="text-sm text-red-400">{error}</p>
            <button
              onClick={handleRefresh}
              className="mt-2 text-xs text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary underline"
            >
              Try again
            </button>
          </div>
        ) : loading && !html ? (
          <div className="flex items-center justify-center h-full">
            <div className="flex flex-col items-center gap-3 text-amplify-elements-textTertiary">
              <Loader2 className="w-6 h-6 animate-spin" />
              <p className="text-sm">Rendering document…</p>
            </div>
          </div>
        ) : (
          <div className="docx-preview-content max-w-3xl mx-auto bg-white text-black shadow-lg my-6 mx-4 p-12 rounded-sm">
            {html ? (
              <div dangerouslySetInnerHTML={{ __html: html }} />
            ) : (
              <div className="flex items-center justify-center py-12 text-amplify-elements-textTertiary">
                <Loader2 className="w-5 h-5 animate-spin" />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  );
});
