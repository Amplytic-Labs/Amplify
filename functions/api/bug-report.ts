/**
 * Standalone Cloudflare Pages Function: POST /api/bug-report
 *
 * Deployed as a SEPARATE Worker from the main Remix catch-all.
 * Handles bug report submission to GitHub.
 *
 * Note: @octokit/rest has been replaced with raw fetch() calls
 * in the Remix route, so this is mainly for architectural separation.
 * Kept as a separate function for future independence.
 */

export async function onRequestPost(context: any) {
  try {
    const { createPagesFunctionHandler } = await import('@remix-run/cloudflare-pages');
    const serverBuild = await import('../build/server');
    const handler = createPagesFunctionHandler({ build: serverBuild });
    return handler(context);
  } catch (e: any) {
    console.error('[bug-report worker] Error:', e);
    return new Response(JSON.stringify({ error: e?.message || 'bug report failed' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }
}
