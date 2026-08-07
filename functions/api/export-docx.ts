/**
 * Standalone Cloudflare Pages Function: POST /api/export-docx
 *
 * This is deployed as a SEPARATE Worker from the main Remix catch-all.
 * It handles DOCX export requests independently, keeping the heavy
 * DOCX pipeline (docx + katex + lowlight + mathml2omml ~1.5MB)
 * out of the main Worker bundle.
 *
 * The Remix route (app/routes/api.export-docx.ts) is retained as a
 * fallback — this function takes priority because it matches the path
 * more specifically than the catch-all [[path]].
 *
 * Accepts: { markdown, assets, theme? }
 * Returns: Raw .docx buffer as a download
 */

export async function onRequestPost(context: any) {
  // Delegate to the Remix server build which has the route handler.
  // In the future, this can be made fully standalone by directly
  // importing only the docx-builder code.
  try {
    const { createPagesFunctionHandler } = await import('@remix-run/cloudflare-pages');
    const serverBuild = await import('../build/server');
    const handler = createPagesFunctionHandler({ build: serverBuild });
    return handler(context);
  } catch (e: any) {
    console.error('[export-docx worker] Error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'export failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
