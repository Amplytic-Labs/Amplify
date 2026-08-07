/**
 * Standalone Cloudflare Pages Function: POST /api/preview-docx
 *
 * Deployed as a SEPARATE Worker from the main Remix catch-all.
 * Handles DOCX preview (markdown → docx → HTML) independently.
 *
 * Heavy deps: mammoth + docx + katex + lowlight + mathml2omml (~1.8MB)
 * These are kept out of the main Worker bundle.
 */

export async function onRequestPost(context: any) {
  try {
    const { createPagesFunctionHandler } = await import('@remix-run/cloudflare-pages');
    const serverBuild = await import('../build/server');
    const handler = createPagesFunctionHandler({ build: serverBuild });
    return handler(context);
  } catch (e: any) {
    console.error('[preview-docx worker] Error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'preview failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
