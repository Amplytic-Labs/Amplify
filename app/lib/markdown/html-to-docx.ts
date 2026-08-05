import { parse, HTMLElement, NodeType } from 'node-html-parser';
import { Paragraph, TextRun, AlignmentType, BorderStyle, ShadingType, convertInchesToTwip } from 'docx';
import { DEFAULT_DOCX_THEME } from './theme';
import type { ResolvedDocxTheme } from './theme';

/**
 * Render a raw-HTML block (from markdown) into DOCX paragraphs.
 *
 * Markdown allows inline HTML anywhere. With `rehype-raw` the preview
 * renders it natively in the browser; for DOCX we parse the HTML with
 * `node-html-parser` (a fast, dependency-free, server-side parser) and
 * map the most common tags to docx runs / paragraphs.
 *
 * Supported tags:
 *   Block:    <p>, <div>, <br>, <hr>, <pre>, <blockquote>, <ul>, <ol>, <li>,
 *             <h1>..<h6>, <details>, <summary>
 *   Inline:   <b>/<strong>, <i>/<em>, <u>, <s>/<del>, <code>, <mark>,
 *             <sub>, <sup>, <kbd>, <abbr>, <a>, <span>
 *
 * Unknown tags are unwrapped — their text content still renders, just
 * without any tag-specific styling. This keeps the DOCX readable even
 * when the markdown contains unusual HTML.
 *
 * Colours honour the resolved document theme: inline `<code>` shading uses
 * `theme.inlineCodeBg`, `<pre>` uses `theme.codeBlockBg`/`codeBlockBorder`,
 * `<a>` uses `theme.link`, `<blockquote>` uses `theme.blockquoteBorder`,
 * `<hr>` uses `theme.thematicBreak`. When no theme is passed the defaults
 * match the pre-theme implementation exactly.
 *
 * Framework-agnostic: no Next.js imports — copy-paste ready for Remix+Vite.
 */

const FONT_MONO = 'Consolas';

interface HtmlRenderCtx {
  /** Resolved colour theme. Defaults to DEFAULT_DOCX_THEME. */
  theme: ResolvedDocxTheme;
}

interface RunStyle {
  bold?: boolean;
  italics?: boolean;
  underline?: boolean;
  strike?: boolean;
  color?: string;
  font?: string;
  shading?: { type: typeof ShadingType; fill: string; color: string };
  superScript?: boolean;
  subScript?: boolean;
  highlight?: string;
}

/**
 * Render an HTML string into a list of docx Paragraphs.
 *
 * The string may contain multiple top-level elements (or mixed text +
 * elements) — we normalise it by wrapping in a synthetic root, then
 * walking the root's children.
 */
export async function renderHtmlBlock(html: string, theme?: ResolvedDocxTheme): Promise<Paragraph[]> {
  if (!html || !html.trim()) {
    return [];
  }

  const root = parse(html, {
    blockTextElements: {
      script: false,
      style: false,
      pre: true,
    },
  });
  const rctx: HtmlRenderCtx = { theme: theme ?? DEFAULT_DOCX_THEME };
  const blocks: Paragraph[] = [];

  for (const child of root.childNodes) {
    const paras = nodeToParagraphs(child, {}, rctx);

    if (paras.length) {
      blocks.push(...paras);
    }
  }

  return blocks;
}

/**
 * Walk a DOM node and emit Paragraphs. Inline content is wrapped in a
 *  default paragraph.
 */
function nodeToParagraphs(node: any, style: RunStyle, rctx: HtmlRenderCtx): Paragraph[] {
  if (!node) {
    return [];
  }

  // Text node — wrap inline text in a paragraph.
  if (node.nodeType === NodeType.TEXT_NODE) {
    const text = node.text || '';

    if (!text || !text.trim()) {
      return [];
    }

    return [
      new Paragraph({
        children: [new TextRun(applyStyle({ text: collapseWs(text) }, style))],
        spacing: { after: 160, line: 276 },
      }),
    ];
  }

  if (!(node instanceof HTMLElement)) {
    return [];
  }

  const tag = node.tagName.toLowerCase();
  const children = node.childNodes;
  const t = rctx.theme;

  // Block-level tags → emit their own paragraph(s).
  switch (tag) {
    case 'p':
    case 'div': {
      // Gather inline runs from children, emit as one paragraph.
      const runs = collectInlineRuns(children, style, rctx);

      if (runs.length === 0) {
        return [];
      }

      return [
        new Paragraph({
          children: runs,
          spacing: { after: 160, line: 276 },
        }),
      ];
    }

    case 'br':
      return [new Paragraph({ children: [new TextRun({ break: 1 })] })];

    case 'hr':
      return [
        new Paragraph({
          border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: t.thematicBreak, space: 1 } },
          spacing: { before: 120, after: 120 },
        }),
      ];

    case 'h1':
    case 'h2':
    case 'h3':
    case 'h4':
    case 'h5':
    case 'h6': {
      const runs = collectInlineRuns(children, { ...style, bold: true }, rctx);
      return [
        new Paragraph({
          children: runs,
          spacing: { before: 240, after: 120, line: 276 },
        }),
      ];
    }

    case 'pre': {
      // <pre> — preserve whitespace, monospace, no inline parsing.
      const text = node.text || '';
      const lines = text.replace(/\n$/, '').split('\n');
      const runs: TextRun[] = [];
      const border = { style: BorderStyle.SINGLE, size: 2, color: t.codeBlockBorder, space: 8 };
      lines.forEach((line, i) => {
        runs.push(
          new TextRun({
            text: line,
            font: FONT_MONO,
            size: 20,
            color: t.codeBlockColor,
          }),
        );

        if (i < lines.length - 1) {
          runs.push(new TextRun({ break: 1 }));
        }
      });

      return [
        new Paragraph({
          children: runs,
          shading: { type: ShadingType.CLEAR, fill: t.codeBlockBg, color: 'auto' },
          border: { top: border, bottom: border, left: border, right: border },
          spacing: { before: 80, after: 160, line: 260 },
        }),
      ];
    }

    case 'blockquote': {
      const out: Paragraph[] = [];

      for (const child of children) {
        const inner = nodeToParagraphs(child, style, rctx);

        for (const p of inner) {
          /*
           * Add a left border + indent to mimic a blockquote.
           * We can't mutate p.options (private), so we rebuild it.
           */
          out.push(
            new Paragraph({
              children: (p as any).options?.children || [],
              indent: { left: convertInchesToTwip(0.3) },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: t.blockquoteBorder, space: 12 } },
              spacing: { after: 80, line: 276 },
            }),
          );
        }
      }

      return out;
    }

    case 'ul':
    case 'ol': {
      const out: Paragraph[] = [];
      const ordered = tag === 'ol';
      let i = 1;

      for (const child of children) {
        if (child instanceof HTMLElement && child.tagName.toLowerCase() === 'li') {
          const marker = ordered ? `${i}.  ` : '•  ';
          const runs = collectInlineRuns(child.childNodes, style, rctx);
          out.push(
            new Paragraph({
              children: [new TextRun({ text: marker }), ...runs],
              indent: { left: convertInchesToTwip(0.3), hanging: convertInchesToTwip(0.3) },
              spacing: { after: 80, line: 276 },
            }),
          );
          i++;
        }
      }

      return out;
    }

    case 'details': {
      // Render summary as a bold paragraph, then the body paragraphs.
      const out: Paragraph[] = [];
      const summary = node.querySelector('summary');

      if (summary) {
        const runs = collectInlineRuns(summary.childNodes, { ...style, bold: true }, rctx);
        out.push(
          new Paragraph({
            children: runs,
            spacing: { before: 120, after: 80, line: 276 },
          }),
        );
      }

      // Body: all children except the summary.
      for (const child of children) {
        if (child === summary) {
          continue;
        }

        const inner = nodeToParagraphs(child, style, rctx);
        out.push(...inner);
      }

      return out;
    }

    case 'summary':
      // Handled inside <details> — but if encountered standalone, treat as a bold paragraph.
      return [
        new Paragraph({
          children: collectInlineRuns(children, { ...style, bold: true }, rctx),
          spacing: { after: 80, line: 276 },
        }),
      ];

    default: {
      // Unknown block tag — unwrap and recurse into children.
      const out: Paragraph[] = [];

      for (const child of children) {
        out.push(...nodeToParagraphs(child, style, rctx));
      }

      return out;
    }
  }
}

/** Walk DOM children of an inline context and produce a flat list of TextRuns. */
function collectInlineRuns(nodes: any[], style: RunStyle, rctx: HtmlRenderCtx): TextRun[] {
  const out: TextRun[] = [];
  const t = rctx.theme;

  for (const node of nodes) {
    if (!node) {
      continue;
    }

    if (node.nodeType === NodeType.TEXT_NODE) {
      const text = collapseWs(node.text || '');

      if (text) {
        out.push(new TextRun(applyStyle({ text }, style)));
      }

      continue;
    }

    if (!(node instanceof HTMLElement)) {
      continue;
    }

    const tag = node.tagName.toLowerCase();
    const childStyle: RunStyle = { ...style };

    switch (tag) {
      case 'b':
      case 'strong':
        childStyle.bold = true;
        break;
      case 'i':
      case 'em':
        childStyle.italics = true;
        break;
      case 'u':
        childStyle.underline = true;
        break;
      case 's':
      case 'del':
      case 'strike':
        childStyle.strike = true;
        break;
      case 'code':
        childStyle.font = FONT_MONO;
        childStyle.color = t.inlineCodeColor;
        childStyle.shading = { type: ShadingType.CLEAR, fill: t.inlineCodeBg, color: 'auto' } as any;
        break;
      case 'mark':
        childStyle.highlight = 'yellow';
        break;
      case 'sub':
        childStyle.subScript = true;
        break;
      case 'sup':
        childStyle.superScript = true;
        break;
      case 'kbd':
        childStyle.font = FONT_MONO;
        childStyle.shading = { type: ShadingType.CLEAR, fill: t.tableHeaderBg, color: 'auto' } as any;
        break;
      case 'a':
        childStyle.color = t.link;
        childStyle.underline = true;
        break;
      case 'span':
        // honour inline color/style if present
        if (node.attributes.color) {
          childStyle.color = sanitizeColor(node.attributes.color);
        }

        if (node.attributes.style) {
          const m = node.attributes.style.match(/color:\s*([^;]+)/);

          if (m) {
            childStyle.color = sanitizeColor(m[1].trim());
          }
        }

        break;
      case 'font':
        if (node.attributes.color) {
          childStyle.color = sanitizeColor(node.attributes.color);
        }

        break;
      case 'br':
        out.push(new TextRun({ break: 1 }));
        continue;
      default:
        // Unknown inline tag — just unwrap.
        break;
    }
    out.push(...collectInlineRuns(node.childNodes, childStyle, rctx));
  }

  return out;
}

/**
 * Collapse runs of whitespace into single spaces (HTML rendering rule).
 *  Preserves leading/trailing space only between inline elements.
 */
function collapseWs(s: string): string {
  return s.replace(/\s+/g, ' ');
}

/** Convert a CSS/hex colour to a 6-hex-digit DOCX colour (no #). */
function sanitizeColor(c: string): string | undefined {
  if (!c) {
    return undefined;
  }

  const s = c.trim().toLowerCase();

  // #rgb / #rrggbb
  const hexMatch = s.match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/);

  if (hexMatch) {
    let h = hexMatch[1];

    if (h.length === 3) {
      h = h
        .split('')
        .map((c) => c + c)
        .join('');
    }

    return h.toUpperCase();
  }

  // rgb(r, g, b)
  const rgbMatch = s.match(/^rgb\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)\s*\)$/);

  if (rgbMatch) {
    const r = parseInt(rgbMatch[1], 10);
    const g = parseInt(rgbMatch[2], 10);
    const b = parseInt(rgbMatch[3], 10);

    return [r, g, b]
      .map((v) => v.toString(16).padStart(2, '0'))
      .join('')
      .toUpperCase();
  }

  return undefined;
}

/** Apply a RunStyle to a TextRun constructor options object. */
function applyStyle(opts: any, style: RunStyle): any {
  if (style.bold) {
    opts.bold = true;
  }

  if (style.italics) {
    opts.italics = true;
  }

  if (style.underline) {
    opts.underline = {};
  }

  if (style.strike) {
    opts.strike = true;
  }

  if (style.color) {
    opts.color = style.color;
  }

  if (style.font) {
    opts.font = style.font;
  }

  if (style.shading) {
    opts.shading = style.shading;
  }

  if (style.highlight) {
    opts.highlight = style.highlight;
  }

  if (style.superScript) {
    opts.superScript = true;
  }

  if (style.subScript) {
    opts.subScript = true;
  }

  return opts;
}
