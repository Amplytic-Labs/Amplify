import { json, type LoaderFunctionArgs } from '@remix-run/cloudflare';
import { getTemplateFilesForLoad } from '~/lib/utils/template-load-registry';

/**
 * GET /api/template-files?loadId=X
 *
 * Returns the file list for an in-flight template load. The client calls
 * this after receiving an `inject_template` tool result containing a
 * `loadId`. The client then writes the files in parallel via
 * `writeFilesParallel` and POSTs `/api/template-loaded` on completion.
 *
 * Why a separate endpoint (not inlining files in the tool result):
 *   - Tool results go into the AI's context window. 400 file paths + their
 *     contents would bloat the context and waste tokens.
 *   - The AI doesn't need to see the file contents — it just needs to know
 *     "the template was injected, here's the summary".
 *
 * Why a separate endpoint (not via dataStream):
 *   - The dataStream's `text-delta` chunks end up as text parts on the
 *     assistant message, which the AI sees in its next-turn context.
 *   - We want this file list to be CLIENT-ONLY — invisible to the AI.
 *
 * Response:
 *   200 { ok: true, files: WriteTask[] }
 *   404 { ok: false, error: 'load-not-found' }  // loadId unknown or already completed
 */
export async function loader({ request }: LoaderFunctionArgs) {
  if (request.method !== 'GET') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  const url = new URL(request.url);
  const loadId = url.searchParams.get('loadId');

  if (!loadId) {
    return json({ error: 'Missing loadId query parameter' }, { status: 400 });
  }

  const files = getTemplateFilesForLoad(loadId);

  if (!files) {
    /*
     * Either the loadId was never registered, or the load already completed
     * and the files were cleared from memory. The client should treat this
     * as "nothing to do" — likely a duplicate request after the load finished.
     */
    return json({ ok: false, error: 'load-not-found' }, { status: 404 });
  }

  return json({ ok: true, files });
}
