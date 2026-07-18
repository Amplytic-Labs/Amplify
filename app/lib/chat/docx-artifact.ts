/**
 * DOCX artifact extractor — finds `<docxartifact>…</docxartifact>` blocks in
 * a streamed assistant response, extracts the inner markdown (so it can be
 * rendered as a Word document in a dedicated preview panel), and removes
 * the block from the text that feeds the chat Markdown renderer.
 *
 * WHY: the AI emits a full markdown document wrapped in `<docxartifact>` when
 * the user asks for a Word/docx file. Showing that raw markdown in the chat
 * would be redundant (it's already rendered as a real .docx in the Document
 * panel) and would double the visible content. So we:
 *
 *   1. Strip the `<docxartifact>` block from the chat-visible text.
 *   2. Hand the inner markdown to the DocxArtifact store, which the
 *      DocxPreviewPanel reads to build + render the actual .docx.
 *
 * STREAMING-SAFE: while the block is still streaming, the closing
 * `</docxartifact>` tag may not have arrived yet. We treat an unclosed
 * `<docxartifact>` as in-progress: the visible text is truncated at the
 * opener, and the (partial) inner markdown is still extracted so the live
 * preview can update as more content streams in. Once the closer arrives,
 * the full markdown is captured and `streaming` flips to false.
 *
 * This mirrors `stripAmplifyArtifacts` in `artifact-stripper.ts` but ALSO
 * returns the captured content (the amplify stripper just discards).
 */

const DOCX_OPEN_TAG = '<docxartifact>';
const DOCX_CLOSE_TAG = '</docxartifact>';

export interface DocxExtraction {
  /** The text with the `<docxartifact>` block removed (for chat rendering). */
  visibleText: string;
  /** The markdown extracted from inside the tag, or null if no tag present. */
  docxMarkdown: string | null;
  /** True while the closing tag hasn't arrived yet (still streaming). */
  streaming: boolean;
}

/**
 * Extract the first `<docxartifact>…</docxartifact>` block from `text`.
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
    return { visibleText: text || '', docxMarkdown: null, streaming: false };
  }

  const openIdx = text.indexOf(DOCX_OPEN_TAG);

  if (openIdx === -1) {
    return { visibleText: text, docxMarkdown: null, streaming: false };
  }

  const contentStart = openIdx + DOCX_OPEN_TAG.length;
  const closeIdx = text.indexOf(DOCX_CLOSE_TAG, contentStart);

  let docxMarkdown: string | null;
  let visibleText: string;
  let streaming: boolean;

  if (closeIdx === -1) {
    // Streaming — unclosed. Inner markdown is the rest of the text.
    docxMarkdown = text.slice(contentStart).trim();
    visibleText = text.slice(0, openIdx);
    streaming = true;
  } else {
    // Closed. Inner markdown is between the tags.
    docxMarkdown = text.slice(contentStart, closeIdx).trim();
    visibleText = text.slice(0, openIdx) + text.slice(closeIdx + DOCX_CLOSE_TAG.length);
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

  return { visibleText, docxMarkdown, streaming };
}
