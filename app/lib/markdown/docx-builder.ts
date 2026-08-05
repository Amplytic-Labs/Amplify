import {
  Document,
  Packer,
  Paragraph,
  TextRun,
  HeadingLevel,
  AlignmentType,
  Table,
  TableRow,
  TableCell,
  WidthType,
  BorderStyle,
  ImageRun,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  PageOrientation,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  LevelFormat,
  ShadingType,
  convertInchesToTwip,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TabStopType,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  TabStopPosition,
} from 'docx';
import type { DiagramAsset } from './types';
import { latexToOmml } from './math';
import { svgToCroppedPng, pngDataUrlToCroppedPng, pngDimensions } from './assets';
import { highlightCode, colorForClass } from './highlight';
import { renderHtmlBlock } from './html-to-docx';
import { resolveTheme, ptToHalfPoints, lineSpacingTo240ths, inchesToTwips } from './theme';
import type { DocxTheme, ResolvedDocxTheme } from './theme';

/*
 * Units cheat-sheet (docx):
 *  font size  -> half-points        (11pt = 22)
 *  spacing    -> twips (1/20 pt)     (8pt = 160)
 *  line       -> 240ths of a line    (1.15 = 276)
 *  margin     -> twips               (1in = 1440)
 *  border sz  -> 1/8 pt              (1pt = 8)
 */

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const FONT = 'Arial';
const FONT_MONO = 'Consolas';
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const BODY_SIZE = 22; // 11pt
// eslint-disable-next-line @typescript-eslint/no-unused-vars
const LINE_115 = 276; // 1.15 line spacing (Google Docs default)

/*
 * Clean table borders — visible but not harsh, like Google Docs.
 * (Colour comes from the resolved theme at build time; the static border
 *  *style* + *size* never change.)
 */
function tableBorders(t: ResolvedDocxTheme) {
  const b = { style: BorderStyle.SINGLE, size: 4, color: t.tableBorder };
  return {
    top: b,
    bottom: b,
    left: b,
    right: b,
    insideHorizontal: b,
    insideVertical: b,
  };
}

interface BuildContext {
  assets: DiagramAsset[];
  counters: {
    mermaid: number;
    chart: number;
    mathInline: number;
    mathBlock: number;
  };

  /** map of placeholder -> omml string (filled during walk) */
  ommlMap: Map<string, string>;

  /** when true, math placeholders render as readable LaTeX text (preview) */
  forPreview: boolean;

  /**
   * preview-mode callback: called for every math expression with its
   *  placeholder, raw LaTeX, and whether it's display-mode. The caller
   *  (preview-docx route) uses this to later swap the placeholder for
   *  KaTeX-rendered HTML.
   */
  onMath?: (placeholder: string, latex: string, displayMode: boolean) => void;

  /**
   * Fully-resolved colour + typography theme. Defaults to DEFAULT_DOCX_THEME
   *  (the exact look the formatter has always used), so omitting a theme is
   *  a no-op.
   */
  theme: ResolvedDocxTheme;

  /** Precomputed: body font size in half-points (e.g. 22 for 11pt). */
  bodySizeHalfPt: number;

  /** Precomputed: line spacing in 240ths (e.g. 276 for 1.15). */
  lineSpacing240: number;

  /** Precomputed: page margin in twips (e.g. 1440 for 1in). */
  marginTwip: number;
}

export interface BuildDocxOptions {
  /**
   * When true, equations are NOT injected as native OMML (which mammoth
   * cannot render). Instead a placeholder token is emitted in the text and
   * `onMath` is called with (placeholder, latex, displayMode) so the caller
   * can replace it with KaTeX HTML after the mammoth conversion. The
   * downloaded .docx (forPreview=false, the default) always gets real native
   * OMML equations.
   */
  forPreview?: boolean;

  /** Preview-mode callback — see BuildContext.onMath. */
  onMath?: (placeholder: string, latex: string, displayMode: boolean) => void;

  /**
   * Optional colour theme. Every field is optional; omitted fields fall back
   * to the default (which is the exact colour the formatter has always
   * used). Passing no theme at all produces byte-identical output to the
   * pre-theme implementation — so this is a purely additive overlay that an
   * AI chatbot (or any caller) can use to give each document its own look
   * without touching the formatting logic.
   */
  theme?: DocxTheme;
}

export async function buildDocx(
  markdown: string,
  assets: DiagramAsset[],
  options: BuildDocxOptions = {},
): Promise<Buffer> {
  const { parseMarkdown } = await import('./parse');
  const tree = parseMarkdown(markdown);

  /*
   * Resolve the colour theme once. `resolveTheme(undefined)` returns the
   * DEFAULT_DOCX_THEME verbatim — the exact colours the formatter has always
   * used — so exporting with no theme is a complete no-op.
   */
  const theme = resolveTheme(options.theme);

  const ctx: BuildContext = {
    assets,
    counters: { mermaid: 0, chart: 0, mathInline: 0, mathBlock: 0 },
    ommlMap: new Map(),
    forPreview: !!options.forPreview,
    onMath: options.onMath,
    theme,
    bodySizeHalfPt: ptToHalfPoints(theme.bodyFontSize),
    lineSpacing240: lineSpacingTo240ths(theme.lineSpacing),
    marginTwip: inchesToTwips(theme.margin),
  };

  const children = await walkChildren(tree.children, ctx);

  const codeBlockBorder = { style: BorderStyle.SINGLE, size: 2, color: theme.codeBlockBorder, space: 8 };

  // Page size: A4 = 210mm × 297mm = 11906 × 16838 twips; Letter = 8.5×11in = 12240 × 15840.
  const pageSize = theme.pageSize === 'a4' ? { width: 11906, height: 16838 } : { width: 12240, height: 15840 };
  const m = ctx.marginTwip;

  const doc = new Document({
    creator: 'Markdown Formatter',
    title: 'Document',
    styles: {
      default: {
        document: {
          run: { font: theme.fontFamily, size: ctx.bodySizeHalfPt, color: theme.body },
          paragraph: { spacing: { line: ctx.lineSpacing240, after: 160 } },
        },
        heading1: {
          run: {
            font: theme.headingFontFamily,
            size: ptToHalfPoints(theme.heading1Size),
            bold: true,
            color: theme.heading1,
          },
          paragraph: { spacing: { before: 360, after: 120, line: ctx.lineSpacing240 } },
        },
        heading2: {
          run: {
            font: theme.headingFontFamily,
            size: ptToHalfPoints(theme.heading2Size),
            bold: true,
            color: theme.heading2,
          },
          paragraph: { spacing: { before: 280, after: 120, line: ctx.lineSpacing240 } },
        },
        heading3: {
          run: {
            font: theme.headingFontFamily,
            size: ptToHalfPoints(theme.heading3Size),
            bold: true,
            color: theme.heading3,
          },
          paragraph: { spacing: { before: 240, after: 100, line: ctx.lineSpacing240 } },
        },
        heading4: {
          run: {
            font: theme.headingFontFamily,
            size: ptToHalfPoints(theme.heading4Size),
            bold: true,
            color: theme.heading4,
          },
          paragraph: { spacing: { before: 200, after: 80, line: ctx.lineSpacing240 } },
        },
        heading5: {
          run: {
            font: theme.headingFontFamily,
            size: ptToHalfPoints(theme.heading5Size),
            bold: true,
            color: theme.heading5,
          },
          paragraph: { spacing: { before: 160, after: 80, line: ctx.lineSpacing240 } },
        },
        heading6: {
          run: {
            font: theme.headingFontFamily,
            size: ptToHalfPoints(theme.heading6Size),
            bold: true,
            italics: true,
            color: theme.heading6,
          },
          paragraph: { spacing: { before: 160, after: 80, line: ctx.lineSpacing240 } },
        },
      },
      paragraphStyles: [
        {
          id: 'CodeBlock',
          name: 'Code Block',
          basedOn: 'Normal',
          next: 'Normal',
          quickFormat: true,
          run: { font: theme.codeFontFamily, size: 20, color: theme.codeBlockColor },
          paragraph: {
            spacing: { before: 80, after: 160, line: 260 },
            shading: { type: ShadingType.CLEAR, fill: theme.codeBlockBg, color: 'auto' },
            border: {
              top: codeBlockBorder,
              bottom: codeBlockBorder,
              left: codeBlockBorder,
              right: codeBlockBorder,
            },
          },
        },
      ],
    },
    sections: [
      {
        properties: {
          page: {
            size: pageSize,
            margin: { top: m, right: m, bottom: m, left: m },
          },
        },
        children,
      },
    ],
  });

  const buffer = await Packer.toBuffer(doc);

  // Preview mode: leave the placeholder text runs in place (readable LaTeX).
  if (ctx.forPreview) {
    return buffer;
  }

  // Download mode: inject native OMML equations in place of placeholders.
  return injectOmml(buffer, ctx.ommlMap);
}

async function walkChildren(nodes: any[], ctx: BuildContext): Promise<any[]> {
  const out: any[] = [];

  for (const node of nodes) {
    const result = await walkNode(node, ctx);

    if (Array.isArray(result)) {
      out.push(...result);
    } else if (result) {
      out.push(result);
    }
  }

  return out;
}

async function walkNode(node: any, ctx: BuildContext): Promise<any | any[] | null> {
  if (!node) {
    return null;
  }

  switch (node.type) {
    case 'heading':
      return new Paragraph({
        heading: headingLevel(node.depth),
        children: await inlineRuns(node.children, ctx),
      });

    case 'paragraph':
      return new Paragraph({
        children: await inlineRuns(node.children, ctx),
        spacing: { after: 160, line: ctx.lineSpacing240 },
      });

    case 'text':
      return new Paragraph({ children: [new TextRun({ text: node.value })] });

    case 'math': {
      // block math
      const id = `mathb-${ctx.counters.mathBlock++}`;
      const placeholder = `@@MATHBLOCK_${id}@@`;

      if (ctx.forPreview) {
        /*
         * preview: emit a placeholder token. The preview-docx route will
         * replace it with KaTeX-rendered HTML after the mammoth conversion.
         */
        const latex = node.value;
        ctx.onMath?.(placeholder, latex, true);

        return new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: placeholder })],
          spacing: { before: 120, after: 160, line: ctx.lineSpacing240 },
        });
      }

      const omml = latexToOmml(node.value, true);

      if (omml) {
        ctx.ommlMap.set(placeholder, omml);
        return new Paragraph({
          alignment: AlignmentType.CENTER,
          children: [new TextRun({ text: placeholder })],
          spacing: { before: 120, after: 160, line: ctx.lineSpacing240 },
        });
      }

      // fallback: render latex verbatim
      return new Paragraph({
        alignment: AlignmentType.CENTER,
        children: [new TextRun({ text: node.value, font: ctx.theme.codeFontFamily, italics: true })],
        spacing: { before: 120, after: 160 },
      });
    }

    case 'list': {
      /*
       * Build list items directly from inline runs — do NOT try to read back
       * Paragraph.options (which is private in the docx lib and would lose
       * the item's text). Each listItem's children are paragraphs + possibly
       * nested lists. Nested lists recurse with a deeper indent so they
       * actually look nested.
       */
      return await renderList(node, ctx, 0);
    }

    case 'listItem':
      // handled above in list; but if encountered standalone:
      return await walkChildren(node.children, ctx);

    case 'blockquote': {
      /*
       * Rebuild each child paragraph directly from inline runs (can't read
       * back Paragraph.options — it's private in the docx lib).
       */
      const out: any[] = [];

      for (const child of node.children) {
        if (child.type === 'paragraph') {
          const runs = await inlineRuns(child.children, ctx);
          out.push(
            new Paragraph({
              children: runs,
              indent: { left: convertInchesToTwip(0.3) },
              border: { left: { style: BorderStyle.SINGLE, size: 18, color: ctx.theme.blockquoteBorder, space: 12 } },
              spacing: { after: 80, line: ctx.lineSpacing240 },
            }),
          );
        } else {
          const r = await walkNode(child, ctx);

          if (Array.isArray(r)) {
            out.push(...r);
          } else if (r) {
            out.push(r);
          }
        }
      }

      return out;
    }

    case 'code': {
      const lang = (node.lang || '').toLowerCase();

      if (lang === 'mermaid') {
        return await diagramImage(node, ctx, 'mermaid');
      }

      if (lang === 'chart' || lang === 'chartjs') {
        return await diagramImage(node, ctx, 'chart');
      }

      // normal code block — with syntax highlighting
      return codeBlockParagraphs(node.value, lang, ctx);
    }

    case 'table':
      return await buildTable(node, ctx);

    case 'thematicBreak':
      return new Paragraph({
        border: { bottom: { style: BorderStyle.SINGLE, size: 6, color: ctx.theme.thematicBreak, space: 1 } },
        spacing: { before: 120, after: 120 },
      });

    case 'html':
      /*
       * Parse raw HTML and render it as best we can in DOCX. We use the
       * same `remark-rehype`-style approach: parse the HTML to a minimal
       * DOM, then walk it and map tags to docx runs / paragraphs.
       */
      return await renderHtmlBlock(node.value, ctx.theme);

    case 'yaml':
    case 'frontmatter':
      return null;

    case 'image': {
      // markdown image — skip if it's a data url we can't fetch; otherwise try
      return null;
    }

    case 'delete':
    case 'strong':
    case 'emphasis':
    case 'link':
      // inline — handled inside inlineRuns; if encountered standalone, wrap in paragraph
      return new Paragraph({ children: await inlineRuns([node], ctx) });

    default:
      return null;
  }
}

function headingLevel(depth: number): (typeof HeadingLevel)[keyof typeof HeadingLevel] {
  switch (depth) {
    case 1:
      return HeadingLevel.HEADING_1;
    case 2:
      return HeadingLevel.HEADING_2;
    case 3:
      return HeadingLevel.HEADING_3;
    case 4:
      return HeadingLevel.HEADING_4;
    case 5:
      return HeadingLevel.HEADING_5;
    default:
      return HeadingLevel.HEADING_6;
  }
}

/**
 * Render a list (ordered or bullet) as an array of Paragraphs.
 * `depth` controls indentation — 0 for top-level, 1 for first nested
 * level, 2 for doubly-nested, etc. Each level adds 0.3in of indent so
 * nested lists are visually distinct from their parent.
 *
 * For nested lists we use a hollow bullet (◦) / lower-alpha marker so
 * the structure is obvious even without numbering info.
 */
async function renderList(node: any, ctx: BuildContext, depth: number): Promise<any[]> {
  const items: any[] = [];
  const ordered = node.ordered;
  const start = node.start ?? 1;
  const indentStep = convertInchesToTwip(0.3); // per-level indent
  const leftIndent = indentStep * (depth + 1);

  // Marker style varies by depth so nested lists are visually distinct.
  const bulletChar = depth === 0 ? '•' : depth === 1 ? '◦' : '▪';
  const orderedChar = (n: number) => {
    if (depth === 0) {
      return `${n}.  `;
    }

    if (depth === 1) {
      return `${toAlpha(n)}.  `;
    } // a. b. c.

    return `${toRoman(n).toLowerCase()}.  `; // i. ii. iii.
  };

  for (let i = 0; i < node.children.length; i++) {
    const li = node.children[i];
    const num = start + i;
    const marker = ordered ? orderedChar(num) : `${bulletChar}  `;
    let isFirst = true;

    for (const child of li.children) {
      if (child.type === 'list') {
        // nested list — recurse with deeper indent
        const nested = await renderList(child, ctx, depth + 1);
        items.push(...nested);

        // nested list doesn't change isFirst for subsequent paragraphs
      } else if (child.type === 'paragraph') {
        const runs = await inlineRuns(child.children, ctx);

        if (isFirst) {
          items.push(
            new Paragraph({
              children: [new TextRun({ text: marker }), ...runs],
              indent: { left: leftIndent, hanging: indentStep },
              spacing: { after: 80, line: ctx.lineSpacing240 },
            }),
          );
        } else {
          items.push(
            new Paragraph({
              children: runs,
              indent: { left: leftIndent },
              spacing: { after: 80, line: ctx.lineSpacing240 },
            }),
          );
        }

        isFirst = false;
      } else {
        // other block inside a list item — render with indent
        const r = await walkNode(child, ctx);

        if (Array.isArray(r)) {
          items.push(...r);
        } else if (r) {
          items.push(r);
        }

        isFirst = false;
      }
    }

    if (isFirst) {
      // empty list item — just the marker
      items.push(
        new Paragraph({
          children: [new TextRun({ text: marker })],
          indent: { left: leftIndent, hanging: indentStep },
          spacing: { after: 80, line: ctx.lineSpacing240 },
        }),
      );
    }
  }

  return items;
}

/** 1 → "a", 2 → "b", …, 27 → "aa" (for nested ordered-list markers). */
function toAlpha(n: number): string {
  let s = '';

  while (n > 0) {
    const rem = (n - 1) % 26;
    s = String.fromCharCode(97 + rem) + s;
    n = Math.floor((n - 1) / 26);
  }

  return s;
}

/** 1 → "I", 2 → "II", 4 → "IV" (for deeply nested ordered-list markers). */
function toRoman(n: number): string {
  const map: [number, string][] = [
    [1000, 'M'],
    [900, 'CM'],
    [500, 'D'],
    [400, 'CD'],
    [100, 'C'],
    [90, 'XC'],
    [50, 'L'],
    [40, 'XL'],
    [10, 'X'],
    [9, 'IX'],
    [5, 'V'],
    [4, 'IV'],
    [1, 'I'],
  ];
  let s = '';

  for (const [v, sym] of map) {
    while (n >= v) {
      s += sym;
      n -= v;
    }
  }

  return s || 'I';
}

async function inlineRuns(nodes: any[], ctx: BuildContext): Promise<TextRun[]> {
  const runs: TextRun[] = [];

  for (const n of nodes) {
    const r = await inlineRun(n, ctx);

    if (Array.isArray(r)) {
      runs.push(...r);
    } else if (r) {
      runs.push(r);
    }
  }

  return runs;
}

async function inlineRun(node: any, ctx: BuildContext): Promise<TextRun | TextRun[] | null> {
  if (!node) {
    return null;
  }

  switch (node.type) {
    case 'text':
      return new TextRun({ text: node.value });

    case 'strong':
      return new TextRun({
        text: collectText(node),
        bold: true,
      });

    case 'emphasis':
      return new TextRun({
        text: collectText(node),
        italics: true,
      });

    case 'delete':
      return new TextRun({ text: collectText(node), strike: true });

    case 'inlineCode':
      return new TextRun({
        text: node.value,
        font: ctx.theme.codeFontFamily,
        color: ctx.theme.inlineCodeColor,
        shading: { type: ShadingType.CLEAR, fill: ctx.theme.inlineCodeBg, color: 'auto' },
      });

    case 'inlineMath': {
      const id = `mathi-${ctx.counters.mathInline++}`;
      const placeholder = `@@MATHINLINE_${id}@@`;

      if (ctx.forPreview) {
        // preview: emit placeholder; preview-docx route replaces with KaTeX HTML.
        ctx.onMath?.(placeholder, node.value, false);
        return new TextRun({ text: placeholder });
      }

      const omml = latexToOmml(node.value, false);

      if (omml) {
        ctx.ommlMap.set(placeholder, omml);
        return new TextRun({ text: placeholder });
      }

      return new TextRun({ text: node.value, font: ctx.theme.codeFontFamily, italics: true });
    }

    case 'link': {
      // render as text with underline + themed link colour, but no hyperlink object (keeps it simple/clean)
      const text = collectText(node);
      return new TextRun({ text, color: ctx.theme.link, underline: {} });
    }

    case 'image':
      // inline images not embedded in docx for now
      return new TextRun({ text: collectText(node) || '[image]' });

    case 'break':
      return new TextRun({ break: 1 });

    default:
      return new TextRun({ text: collectText(node) });
  }
}

function collectText(node: any): string {
  if (!node) {
    return '';
  }

  if (typeof node.value === 'string') {
    return node.value;
  }

  if (Array.isArray(node.children)) {
    return node.children.map(collectText).join('');
  }

  return '';
}

/*
 * (list/blockquote now build paragraphs directly from inline runs — no
 *  need to read back Paragraph.options, which is private in the docx lib.)
 */

/**
 * Build the paragraphs for a fenced code block, with syntax highlighting.
 *
 * `language` is the info-string after the fence (e.g. "js", "python").
 * When the language is recognised by `lowlight` (highlight.js), each
 * token gets its own `<TextRun>` coloured according to the `oneLight`-
 * inspired palette in `highlight.ts`. Unrecognised / missing languages
 * fall back to a single plain run per line.
 *
 * The whole block sits in a single `<Paragraph>` using the `CodeBlock`
 * style (Consolas, 10pt, gray shading, light border). Line breaks
 * between code lines use `<TextRun break:1>` so the gray background
 * stays continuous across the whole block.
 */
function codeBlockParagraphs(code: string, language: string = '', ctx?: BuildContext): Paragraph[] {
  /*
   * Highlight once for the whole block — `highlightCode` returns a flat
   * list of tokens, each with text + className. Newlines inside tokens
   * become explicit `\n` markers (see `highlight.ts`); we emit them as
   * `<TextRun break:1>`.
   *
   * The colour palette is the built-in `oneLight`-inspired one. When the
   * caller supplies a theme with `syntaxColors`, those overrides win for
   * any class they list — so an AI can recolour code to match a doc theme
   * without touching the highlighter itself.
   */
  const syntaxOverride = ctx?.theme.syntaxColors;
  const tokens = highlightCode(code, language);

  const runs: TextRun[] = [];

  for (const tok of tokens) {
    if (tok.text === '\n') {
      runs.push(new TextRun({ break: 1 }));
      continue;
    }

    if (!tok.text) {
      continue;
    }

    const color = colorForClass(tok.className, syntaxOverride);
    runs.push(
      new TextRun({
        text: tok.text,
        font: ctx?.theme.codeFontFamily ?? FONT_MONO,
        size: 20, // 10pt for code
        color,
      }),
    );
  }

  const bg = ctx?.theme.codeBlockBg ?? 'F5F5F5';
  const borderColor = ctx?.theme.codeBlockBorder ?? 'E0E0E0';
  const border = { style: BorderStyle.SINGLE, size: 2, color: borderColor, space: 8 };

  return [
    new Paragraph({
      style: 'CodeBlock',
      children: runs,
      shading: { type: ShadingType.CLEAR, fill: bg, color: 'auto' },
      border: {
        top: border,
        bottom: border,
        left: border,
        right: border,
      },
      spacing: { before: 80, after: 160, line: 260 },
    }),
  ];
}

async function diagramImage(node: any, ctx: BuildContext, kind: 'mermaid' | 'chart'): Promise<Paragraph | null> {
  const idx = ctx.counters[kind]++;
  const id = `${kind}-${idx}`;
  const asset = ctx.assets.find((a) => a.id === id);

  if (!asset) {
    // no asset provided — render code as a code block fallback
    return codeBlockParagraphs(node.value, '', ctx)[0];
  }

  try {
    let pngBuf: Buffer;

    if (asset.pngDataUrl) {
      pngBuf = await pngDataUrlToCroppedPng(asset.pngDataUrl);
    } else if (asset.svg) {
      pngBuf = await svgToCroppedPng(asset.svg);
    } else {
      return codeBlockParagraphs(node.value, '', ctx)[0];
    }

    const dim = await pngDimensions(pngBuf);

    /*
     * Size caps — different for diagrams vs charts.
     *
     * A4 page = 210mm × 297mm. With 1in (25.4mm) margins the usable text
     * area is ~159mm × 246mm (≈ 6.26in × 9.69in). Per user request:
     *   • Mermaid diagrams should be ~50% of the page width → cap at 3.25in.
     *     (3.25in = 312px @ 96dpi in docx image transforms). Height also
     *     capped at 4in so tall flowcharts don't dominate the page.
     *   • Charts stay at a larger cap (6in × 7in) — they're data visualisations
     *     that need width to be readable.
     */
    const isMermaid = kind === 'mermaid';
    const MAX_W_PX = isMermaid ? 312 : 576; // mermaid 3.25in, chart 6in
    const MAX_H_PX = isMermaid ? 384 : 672; // mermaid 4in,   chart 7in
    const scaleW = Math.min(1, MAX_W_PX / dim.width);
    const scaleH = Math.min(1, MAX_H_PX / dim.height);
    const scale = Math.min(scaleW, scaleH);
    const w = Math.round(dim.width * scale);
    const h = Math.round(dim.height * scale);

    return new Paragraph({
      alignment: AlignmentType.CENTER,
      children: [
        new ImageRun({
          type: 'png',
          data: pngBuf,
          transformation: { width: w, height: h },
        }),
      ],
      spacing: { before: 120, after: 160 },
    });
  } catch (e) {
    console.error('diagramImage error', e);
    return codeBlockParagraphs(node.value, '', ctx)[0];
  }
}

async function buildTable(node: any, ctx: BuildContext): Promise<Table> {
  const rows: TableRow[] = [];

  /*
   * node.children: array of tableRow, each with tableCell children.
   * GFM table cells may contain either:
   *   - block nodes (paragraph, list, …) — walk them normally, OR
   *   - bare inline nodes (text, strong, emphasis, inlineCode, …) —
   *     GFM's parser puts inline nodes directly as tableCell children
   *     without wrapping them in a paragraph. We detect this case and
   *     build a single paragraph from the inline runs so the cell
   *     content (e.g. `inline code`) is not lost.
   */
  const INLINE_TYPES = new Set([
    'text',
    'strong',
    'emphasis',
    'delete',
    'inlineCode',
    'link',
    'image',
    'break',
    'inlineMath',
  ]);

  for (let r = 0; r < node.children.length; r++) {
    const tr = node.children[r];
    const cells: TableCell[] = [];

    for (const tc of tr.children) {
      let paras: Paragraph[];
      const hasBlock = tc.children.some((c: any) => c && !INLINE_TYPES.has(c.type));

      if (!hasBlock) {
        // All children are inline nodes → build one paragraph from them.
        const runs = await inlineRuns(tc.children, ctx);
        paras = [new Paragraph({ children: runs, spacing: { after: 60, line: ctx.lineSpacing240 } })];
      } else {
        const cellChildren = await walkChildren(tc.children, ctx);
        paras = cellChildren.length
          ? cellChildren.map((c: any) => (c instanceof Paragraph ? c : new Paragraph({ children: [c] })))
          : [new Paragraph({ children: [] })];
      }

      const isHeader = r === 0;
      cells.push(
        new TableCell({
          children: paras,
          shading: isHeader ? { type: ShadingType.CLEAR, fill: ctx.theme.tableHeaderBg, color: 'auto' } : undefined,
          margins: { top: 80, bottom: 80, left: 120, right: 120 },
        }),
      );
    }
    rows.push(
      new TableRow({
        children: cells,
        tableHeader: r === 0,
      }),
    );
  }

  return new Table({
    rows,
    width: { size: 100, type: WidthType.PERCENTAGE },
    borders: tableBorders(ctx.theme),
  });
}

/**
 * Post-process the generated docx: replace placeholder text runs with
 * native OMML equations.
 */
async function injectOmml(buffer: Buffer, ommlMap: Map<string, string>): Promise<Buffer> {
  if (ommlMap.size === 0) {
    return buffer;
  }

  const { unzipSync, zipSync, strToU8, strFromU8 } = await import('fflate');
  const files = unzipSync(new Uint8Array(buffer));
  let xml = strFromU8(files['word/document.xml']);

  for (const [placeholder, omml] of ommlMap.entries()) {
    /*
     * The placeholder is inside a <w:r><w:t>...</w:t></w:r>.
     * Replace that whole run with the OMML markup.
     * Inline placeholder -> replace run with <m:oMath>...</m:oMath>
     * Block placeholder  -> replace run with <m:oMathPara><m:oMath>...</m:oMath></m:oMathPara>
     */
    const isBlock = placeholder.startsWith('@@MATHBLOCK');
    const inner = isBlock ? `<m:oMathPara>${omml}</m:oMathPara>` : omml;

    // Match the run containing the placeholder. The run may include <w:rPr>.
    const runRegex = new RegExp(
      `<w:r>(?:<w:rPr>[\\s\\S]*?</w:rPr>)?<w:t[^>]*>${escapeRegex(placeholder)}</w:t></w:r>`,
      'g',
    );
    xml = xml.replace(runRegex, inner);
  }

  files['word/document.xml'] = strToU8(xml);

  const out = zipSync(files);

  return Buffer.from(out);
}

function escapeRegex(s: string): string {
  return s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
