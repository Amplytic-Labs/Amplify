/**
 * DOCX artifact extractor — finds `<docxartifact theme={{...}}>…</docxartifact>`
 * blocks in a streamed assistant response, extracts:
 *
 *   1. The inner markdown (rendered as a Word document in the Document panel).
 *   2. An optional inline `theme={{...}}` object (React Native–style) that
 *      recolours / re-typesets the document.
 *
 * …and removes the whole block from the text that feeds the chat Markdown
 * renderer (so the user never sees raw markdown or the theme attribute).
 *
 * WHY: the AI emits a full markdown document wrapped in `<docxartifact>` when
 * the user asks for a Word/docx file. Showing that raw markdown in the chat
 * would be redundant (it's already rendered as a real .docx in the Document
 * panel) and would double the visible content. The optional `theme={{...}}`
 * attribute lets the AI give each document its own look — fonts, colours,
 * sizes, margins — in a single declarative object, exactly like a React
 * Native style prop.
 *
 * STREAMING-SAFE: while the block is still streaming, the closing
 * `</docxartifact>` tag may not have arrived yet. We treat an unclosed tag as
 * in-progress: the visible text is truncated at the opener, and the (partial)
 * inner markdown is still extracted so the live preview can update as more
 * content streams in. The theme attribute is also parsed best-effort during
 * streaming (complete key:value pairs are captured; a truncated last pair is
 * skipped). Once the closer arrives, the full markdown + theme are captured
 * and `streaming` flips to false.
 *
 * This mirrors `stripAmplifyArtifacts` in `artifact-stripper.ts` but ALSO
 * returns the captured content (the amplify stripper just discards).
 */

import { parseInlineTheme } from '~/lib/markdown/theme';
import type { DocxTheme } from '~/lib/markdown/theme';

const DOCX_OPEN_TAG_PREFIX = '<docxartifact';
const DOCX_CLOSE_TAG = '</docxartifact>';

/**
 * Match the full opening tag with an optional `theme={{...}}` (double-brace,
 * JSX-style) or `theme={...}` (single-brace) attribute.
 *
 * Capture group 1 = theme object source inside `{{…}}` (double brace).
 * Capture group 2 = theme object source inside `{…}` (single brace).
 * The whole match spans from `<docxartifact` through the closing `>`.
 *
 * Non-greedy `[\s\S]*?` ensures we stop at the FIRST `}}` / `}` — which is
 * correct because theme values (colours, font names, numbers) never contain
 * `}` characters.
 */
const OPEN_TAG_RE =
  /<docxartifact\b(?:\s+theme\s*=\s*\{\{([\s\S]*?)\}\}|\s+theme\s*=\s*\{([\s\S]*?)\})?\s*>/;

export interface DocxExtraction {
  /** The text with the `<docxartifact>` block removed (for chat rendering). */
  visibleText: string;
  /** The markdown extracted from inside the tag, or null if no tag present. */
  docxMarkdown: string | null;
  /** True while the closing tag hasn't arrived yet (still streaming). */
  streaming: boolean;
  /**
   * The theme parsed from the `theme={{...}}` attribute, or null if the tag
   * had no theme attribute (or the theme couldn't be parsed). This is a
   * PARTIAL `DocxTheme` — only the fields the AI specified. The docx-builder
   * resolves it onto the defaults via `resolveTheme()`.
   */
  theme: DocxTheme | null;
}

/**
 * Extract the first `<docxartifact theme={{...}}>…</docxartifact>` block from
 * `text`.
 *
 * If the tag is unclosed (streaming), the inner markdown is everything from
 * after the opener to the end of `text`, and `streaming` is true. If there's
 * no opener at all, `docxMarkdown` is null and `visibleText` is the input
 * unchanged.
 *
 * O(n) and allocation-light — re-runs on every streaming tick.
 */
export function extractDocxArtifact(text: string): DocxExtraction {
  if (!text || typeof text !== 'string') {
    return { visibleText: text || '', docxMarkdown: null, streaming: false, theme: null };
  }

  // Find the opening tag prefix.
  const tagStart = text.indexOf(DOCX_OPEN_TAG_PREFIX);

  if (tagStart === -1) {
    return { visibleText: text, docxMarkdown: null, streaming: false, theme: null };
  }

  // Try to match the full opening tag (with optional theme attribute).
  // OPEN_TAG_RE has no `g` flag, so exec matches at the start of the slice.
  const tagMatch = OPEN_TAG_RE.exec(text.slice(tagStart));

  if (!tagMatch) {
    /*
     * The opening tag isn't complete yet — most likely the `theme={{...}}`
     * attribute is still streaming (the closing `}}` or `>` hasn't arrived).
     * We can't determine where the content starts, so we return no markdown
     * yet. But we DO try to parse whatever complete key:value pairs have
     * arrived in the partial theme object, so the live preview can start
     * applying the theme colours/typography as soon as possible.
     */
    const partialTheme = tryParsePartialTheme(text.slice(tagStart));

    return {
      visibleText: text.slice(0, tagStart),
      docxMarkdown: null,
      streaming: true,
      theme: partialTheme,
    };
  }

  // Parse the theme from whichever capture group matched (double vs single brace).
  const themeSrc = tagMatch[1] ?? tagMatch[2] ?? null;
  const theme = themeSrc ? parseInlineTheme(themeSrc) : null;

  // contentStart = index in the ORIGINAL text right after the opening tag's `>`.
  const contentStart = tagStart + tagMatch[0].length;

  // Find the closing tag.
  const closeIdx = text.indexOf(DOCX_CLOSE_TAG, contentStart);

  let docxMarkdown: string | null;
  let visibleText: string;
  let streaming: boolean;

  if (closeIdx === -1) {
    // Streaming — unclosed. Inner markdown is the rest of the text.
    docxMarkdown = text.slice(contentStart).trim();
    visibleText = text.slice(0, tagStart);
    streaming = true;
  } else {
    // Closed. Inner markdown is between the tags.
    docxMarkdown = text.slice(contentStart, closeIdx).trim();
    visibleText = text.slice(0, tagStart) + text.slice(closeIdx + DOCX_CLOSE_TAG.length);
    streaming = false;
  }

  // Tidy up the visible text: collapse blank gaps left by the removed block.
  visibleText = visibleText
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();

  if (!docxMarkdown) {
    docxMarkdown = null;
  }

  return { visibleText, docxMarkdown, streaming, theme };
}

/**
 * Best-effort parse of a partially-streamed `theme={{...}}` attribute.
 *
 * When the opening tag is still streaming (the closing `}}` or `>` hasn't
 * arrived), `OPEN_TAG_RE` won't match. But we can still look for `theme={{`
 * and parse whatever complete `key: value` pairs have arrived so far. The
 * `parseInlineTheme` regex only captures complete pairs, so a truncated last
 * pair is harmlessly skipped.
 *
 * Returns null if no `theme=` attribute is detected, or if no complete pairs
 * have arrived yet.
 */
function tryParsePartialTheme(text: string): DocxTheme | null {
  const themeAttrIdx = text.indexOf('theme=');

  if (themeAttrIdx === -1) return null;

  let afterEq = themeAttrIdx + 'theme='.length;

  // Skip whitespace between `=` and `{`.
  while (afterEq < text.length && /\s/.test(text[afterEq])) afterEq++;

  if (afterEq >= text.length || text[afterEq] !== '{') return null;

  // Determine the object source — skip `{{` (double brace) or `{` (single).
  let src: string;
  if (text[afterEq + 1] === '{') {
    src = text.slice(afterEq + 2);
  } else {
    src = text.slice(afterEq + 1);
  }

  const theme = parseInlineTheme(src);

  // Only return if at least one field parsed successfully.
  return Object.keys(theme).length > 0 ? theme : null;
}
