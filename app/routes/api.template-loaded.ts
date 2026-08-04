import { json, type ActionFunctionArgs } from '@remix-run/cloudflare';
import { z } from 'zod';
import { resolveTemplateLoad } from '~/lib/utils/template-load-registry';

/**
 * POST /api/template-loaded
 *
 * Called by the client after `inject_template` finishes writing all template
 * files to the WebContainer (via writeFilesParallel). Resolves the pending
 * Promise in the template-load registry so `inject_template.execute` can
 * return its real result to the model.
 *
 * Body:
 *   {
 *     loadId: string,            // matches the loadId sent in the tool-result annotation
 *     done: number,              // files successfully written
 *     total: number,             // total files attempted
 *     failed: Array<{ path: string; error: string }>
 *   }
 *
 * Response:
 *   200 { ok: true }              // load resolved successfully
 *   200 { ok: false, reason: 'no-pending-load' }  // loadId not found (timeout or duplicate)
 *   400 { error: 'invalid body' } // schema validation failed
 */

const templateLoadedSchema = z.object({
  loadId: z.string().min(1),
  done: z.number().int().min(0),
  total: z.number().int().min(0),
  failed: z
    .array(
      z.object({
        path: z.string(),
        error: z.string(),
      }),
    )
    .default([]),
});

export async function action({ request }: ActionFunctionArgs) {
  if (request.method !== 'POST') {
    return json({ error: 'Method not allowed' }, { status: 405 });
  }

  let body: unknown;

  try {
    body = await request.json();
  } catch {
    return json({ error: 'Invalid JSON body' }, { status: 400 });
  }

  const parsed = templateLoadedSchema.safeParse(body);

  if (!parsed.success) {
    return json({ error: 'Invalid body', issues: parsed.error.issues }, { status: 400 });
  }

  const { loadId, done, total, failed } = parsed.data;

  const resolved = resolveTemplateLoad(loadId, { done, total, failed });

  if (!resolved) {
    /*
     * No pending load with this ID — either:
     *   - The load already timed out (execute already returned a warning)
     *   - The client signaled twice (deduped)
     *   - The loadId was never registered (client bug)
     *
     * Return 200 with ok=false so the client doesn't treat this as an error
     * (the client doesn't care — it already did its job of writing files).
     */
    return json({ ok: false, reason: 'no-pending-load' });
  }

  return json({ ok: true });
}
