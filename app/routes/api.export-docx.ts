import type { ActionFunction } from '@remix-run/node';
import { buildDocx } from '~/lib/markdown/docx-builder';
import type { ExportRequest } from '~/lib/markdown/types';

/*
 * Pure-JS DOCX build (docx lib + sharp for SVG→PNG). No system deps —
 * runs anywhere (Cloudflare Pages / Node / Bun).
 *
 * Accepts: { markdown, assets, theme? } and returns the raw .docx buffer
 * as a download.
 */
export const action: ActionFunction = async ({ request }) => {
  try {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = (await request.json()) as ExportRequest;
    const { markdown, assets, theme } = body;

    if (!markdown || typeof markdown !== 'string') {
      return Response.json({ error: 'markdown is required' }, { status: 400 });
    }

    /*
     * `theme` is optional and additive — omitting it (or passing an empty
     * object) yields byte-identical output to the pre-theme implementation.
     */
    const docxBuffer = await buildDocx(markdown, assets || [], { theme });

    return new Response(docxBuffer, {
      status: 200,
      headers: {
        'Content-Type': 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
        'Content-Disposition': 'attachment; filename="document.docx"',
        'Content-Length': String(docxBuffer.byteLength),
      },
    });
  } catch (e: any) {
    console.error('export-docx error', e);
    return Response.json({ error: e?.message || 'export failed' }, { status: 500 });
  }
};
