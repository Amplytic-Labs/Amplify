import type { ActionFunction } from '@remix-run/node';
import mammoth from 'mammoth';
import katex from 'katex';
import { buildDocx } from '~/lib/markdown/docx-builder';
import type { PreviewDocxResponse, DiagramAsset } from '~/lib/markdown/types';
import type { DocxTheme } from '~/lib/markdown/theme';

export const action: ActionFunction = async ({ request }) => {
  try {
    if (request.method !== 'POST') {
      return Response.json({ error: 'Method not allowed' }, { status: 405 });
    }

    const body = await request.json();
    const { markdown, assets, theme } = body as {
      markdown: string;
      assets: DiagramAsset[];
      theme?: DocxTheme;
    };

    if (!markdown || typeof markdown !== 'string') {
      return Response.json({ error: 'markdown is required' }, { status: 400 });
    }

    const t0 = Date.now();

    // Collect math placeholders + their LaTeX as the docx is built.
    // `theme` is forwarded so the live preview reflects the chosen colours.
    const mathMap = new Map<string, { latex: string; display: boolean }>();
    const docxBuffer = await buildDocx(markdown, assets || [], {
      forPreview: true,
      theme,
      onMath: (placeholder, latex, display) => {
        mathMap.set(placeholder, { latex, display });
      },
    });

    // Convert DOCX → HTML. Inline embedded images as data URLs.
    const result = await mammoth.convertToHtml(
      { buffer: docxBuffer },
      {
        convertImage: mammoth.images.imgElement((image: any) =>
          image.read('base64').then((b64: string) => ({
            src: `data:${image.contentType};base64,${b64}`,
          })),
        ),
        styleMap: [
          "p[style-name='Heading 1'] => h1:fresh",
          "p[style-name='Heading 2'] => h2:fresh",
          "p[style-name='Heading 3'] => h3:fresh",
          "p[style-name='Heading 4'] => h4:fresh",
          "p[style-name='Heading 5'] => h5:fresh",
          "p[style-name='Heading 6'] => h6:fresh",
          "p[style-name='Code Block'] => pre:fresh",
        ],
      },
    );

    let html = result.value || '';
    const warnings = result.messages?.map((m: any) => String(m.message)) || [];

    // ---- Post-process: math placeholders -> KaTeX HTML ----
    html = injectMath(html, mathMap);
    // ---- Post-process: list paragraphs -> real nested <ul>/<ol>/<li> ----
    html = fixLists(html);
    // ---- Post-process: move non-header table rows into <tbody> ----
    html = fixTables(html);
    // ---- Post-process: <br/> inside <pre> -> newlines ----
    html = html.replace(/<pre>([\s\S]*?)<\/pre>/g, (_m, inner: string) =>
      `<pre>${inner.replace(/<br\s*\/?>/g, '\n')}</pre>`,
    );

    const count = (re: RegExp) => (html.match(re) || []).length;
    const meta = {
      paragraphs: count(/<p[ >]/g),
      tables: count(/<table[ >]/g),
      images: count(/<img[ >]/g),
      equations: mathMap.size,
      bytes: docxBuffer.byteLength,
    };

    const elapsed = Date.now() - t0;
    console.log(
      `[preview-docx] ${meta.paragraphs}p ${meta.tables}t ${meta.images}i ${meta.equations}eq · ${meta.bytes}B · ${elapsed}ms`,
    );

    return Response.json({ html, warnings, meta } as PreviewDocxResponse, { status: 200 });
  } catch (e: any) {
    console.error('preview-docx error', e);
    return Response.json({ error: e?.message || 'preview failed' }, { status: 500 });
  }
};

/**
 * Replace every `@@MATH..._id@@` placeholder in the mammoth HTML with
 * KaTeX-rendered HTML.
 */
function injectMath(
  html: string,
  mathMap: Map<string, { latex: string; display: boolean }>,
): string {
  if (mathMap.size === 0) return html;
  let out = html;

  for (const [placeholder, { latex, display }] of mathMap.entries()) {
    let rendered: string;

    try {
      rendered = katex.renderToString(latex, {
        displayMode: display,
        throwOnError: false,
        strict: false,
        output: 'html',
      });
    } catch {
      rendered = `<code>${escapeHtml(latex)}</code>`;
    }

    out = out.split(placeholder).join(rendered);
  }

  return out;
}

function escapeHtml(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * mammoth renders bullet/numbered list items as individual paragraphs
 * whose text starts with a marker. Walk the paragraph stream and collapse
 * consecutive list-item paragraphs into proper nested <ul>/<ol><li>.
 */
function fixLists(html: string): string {
  const parts = html.split(/(<p\b[^>]*>[\s\S]*?<\/p>)/g);
  const out: string[] = [];

  type Frame = { tag: 'ul' | 'ol'; depth: number };
  const stack: Frame[] = [];
  let liOpen = false;

  const closeItem = () => {
    if (liOpen) {
      out.push('</li>');
      liOpen = false;
    }
  };

  const closeAll = () => {
    while (stack.length) {
      closeItem();
      const f = stack.pop()!;
      out.push(`</${f.tag}>`);

      if (stack.length) liOpen = true;
    }
  };

  const openList = (tag: 'ul' | 'ol', depth: number) => {
    out.push(`<${tag}>`);
    stack.push({ tag, depth });
    liOpen = false;
  };

  for (const part of parts) {
    if (!part) continue;
    const m = part.match(/^<p\b[^>]*>([\s\S]*?)<\/p>$/);

    if (!m) {
      closeAll();
      out.push(part);
      continue;
    }

    const inner = m[1];
    const normalised = inner.replace(/(?:&nbsp;|&#160;)/g, ' ');

    const li = detectListItem(normalised);

    if (!li) {
      closeAll();
      out.push(part);
      continue;
    }

    while (stack.length && stack[stack.length - 1].depth > li.depth) {
      closeItem();
      const f = stack.pop()!;
      out.push(`</${f.tag}>`);

      if (stack.length) liOpen = true;
    }

    const top = stack.length ? stack[stack.length - 1] : null;

    if (top && top.depth === li.depth) {
      if (top.tag === li.tag) {
        closeItem();
      } else {
        closeItem();
        stack.pop();
        out.push(`</${top.tag}>`);

        if (stack.length) liOpen = true;
        openList(li.tag, li.depth);
      }
    } else {
      openList(li.tag, li.depth);
    }

    out.push(`<li>${li.content}`);
    liOpen = true;
  }

  closeAll();
  return out.join('');
}

interface ListItem {
  tag: 'ul' | 'ol';
  depth: number;
  content: string;
}

function detectListItem(inner: string): ListItem | null {
  const s = inner.trimStart();

  if (/^[•\u2022](&bull;)?\s{1,4}/.test(s) || s.startsWith('&bull;')) {
    const content = s.replace(/^(?:&bull;|•|\u2022)\s{1,4}/, '');
    return { tag: 'ul', depth: 0, content: content.trim() };
  }

  if (/^[◦\u25E6]\s{1,4}/.test(s)) {
    const content = s.replace(/^[◦\u25E6]\s{1,4}/, '');
    return { tag: 'ul', depth: 1, content: content.trim() };
  }

  if (/^[▪\u25AA]\s{1,4}/.test(s)) {
    const content = s.replace(/^[▪\u25AA]\s{1,4}/, '');
    return { tag: 'ul', depth: 2, content: content.trim() };
  }

  const ol0 = s.match(/^(\d+)\.\s{1,4}([\s\S]*)$/);

  if (ol0) return { tag: 'ol', depth: 0, content: ol0[2].trim() };

  const ol1 = s.match(/^([a-z])\.\s{1,4}([\s\S]*)$/i);

  if (ol1 && !/^[ivxlcdm]$/i.test(ol1[1])) {
    return { tag: 'ol', depth: 1, content: ol1[2].trim() };
  }

  const ol2 = s.match(/^([ivxlcdm]{1,5})\.\s{1,4}([\s\S]*)$/i);

  if (ol2) return { tag: 'ol', depth: 2, content: ol2[2].trim() };

  return null;
}

function fixTables(html: string): string {
  return html.replace(/<table>([\s\S]*?)<\/table>/g, (_full, inner: string) => {
    const rows = inner.match(/<tr>[\s\S]*?<\/tr>/g) || [];

    if (!rows.length) return `<table>${inner}</table>`;

    const head = rows[0];
    const body = rows
      .slice(1)
      .map((r) => r.replace(/<th(\s|>)/g, '<td$1').replace(/<\/th>/g, '</td>'))
      .join('');

    return `<table><thead>${head}</thead>${body ? `<tbody>${body}</tbody>` : ''}</table>`;
  });
}
