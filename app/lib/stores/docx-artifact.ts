import { atom } from 'nanostores';
import type { DocxTheme } from '~/lib/markdown/theme';

/**
 * DocxArtifact store — holds the markdown content + optional inline theme
 * extracted from a `<docxartifact theme={{...}}>…</docxartifact>` block in an
 * assistant message.
 *
 * WHY a separate store (not the workbench file tree): a DOCX document is
 * NOT a workspace file. It is a transient, chat-generated artifact that the
 * user previews in a dedicated panel and optionally downloads. It must not
 * pollute the WebContainer file tree, survive as a "file", or interfere with
 * a running project. Keeping it in its own store means:
 *
 *   • The workbench can show it as a separate "Document" view alongside
 *     "Code" / "Preview" — coexistence is just a tab switch.
 *   • When the user sends a new message that produces a new document, the
 *     store simply replaces the previous one (latest-wins) — no accumulation.
 *   • Closing the document view clears the content so it doesn't linger.
 *
 * The store is intentionally tiny: just the markdown source, the optional
 * theme, and the id of the message that produced it. The DocxPreviewPanel
 * does the heavy lifting (debounced fetch to /api/preview-docx + download
 * via /api/export-docx).
 */

export interface DocxArtifactState {
  /** The raw markdown extracted from inside the `<docxartifact>` tag. */
  markdown: string;
  /** The message id that produced this document (for scoping/debugging). */
  messageId: string;
  /** Whether the docx block is still streaming in (unclosed tag). */
  streaming: boolean;
  /**
   * The inline theme parsed from the `theme={{...}}` attribute, or null if
   * the tag had no theme. This is a PARTIAL DocxTheme — only the fields the
   * AI specified. The docx-builder resolves it onto the defaults.
   */
  theme: DocxTheme | null;
}

export const docxArtifactStore = atom<DocxArtifactState | null>(null);

/**
 * Set the current document. Called from AssistantMessage whenever a
 * `<docxartifact>` block is detected in the streamed content. Latest-wins:
 * a newer call always replaces the previous document.
 */
export function setDocxArtifact(
  markdown: string,
  messageId: string,
  streaming: boolean,
  theme: DocxTheme | null = null,
) {
  const current = docxArtifactStore.get();

  /*
   * Avoid redundant updates: if the message id + markdown + theme haven't
   * changed, skip the set. This keeps the preview from re-fetching on every
   * identical streaming tick once the content has stabilized.
   */
  if (
    current &&
    current.messageId === messageId &&
    current.markdown === markdown &&
    // Deep-ish compare of the theme: stringify both (null → 'null').
    JSON.stringify(current.theme) === JSON.stringify(theme)
  ) {
    return;
  }

  docxArtifactStore.set({ markdown, messageId, streaming, theme });
}

/** Clear the current document (e.g. when the document view is closed). */
export function clearDocxArtifact() {
  docxArtifactStore.set(null);
}
