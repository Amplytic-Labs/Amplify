/**
 * `<amplify-quick-actions>` XML → HTML transformation.
 *
 * WHY THIS EXISTS
 * ---------------
 * The system prompt instructs the model to emit quick-action buttons as
 * custom XML, e.g.:
 *
 *   <amplify-quick-actions>
 *     <amplify-quick-action type="message" message="Plan an app">Plan an app</amplify-quick-action>
 *     <amplify-quick-action type="message" message="Explain X">Explain a concept</amplify-quick-action>
 *   </amplify-quick-actions>
 *
 * The Markdown renderer (Markdown.tsx) has component handlers that turn
 * `<div class="__amplifyQuickAction__">` + `<button class="__amplifyQuickAction__">`
 * into styled pill buttons. But react-markdown / rehype-raw does NOT
 * understand custom XML element names like `<amplify-quick-actions>` —
 * they aren't in `allowedHTMLElements`, so the raw XML is rendered as
 * plain text.
 *
 * This module bridges that gap: it transforms the XML into the HTML form
 * the Markdown component handlers expect, BEFORE the markdown parser
 * sees it. Same pattern as `stripResidualThoughtTags` — a stateless
 * string preprocessor.
 *
 * HISTORY
 * -------
 * Previously this transformation was done by the `StreamingMessageParser`
 * and the transformed HTML was injected back into message parts via the
 * `parsedMessages` map in Chat.client.tsx. That injection caused a
 * duplicate-text bug (every text part got replaced with the FULL
 * concatenated parsed content), so the injection was removed. As a side
 * effect, quick-actions stopped rendering. This module restores the
 * transformation as a Markdown-level preprocessor — no message-parts
 * mutation required.
 *
 * STREAMING SAFETY
 * ----------------
 * Three cases handled:
 *
 *   1. COMPLETE block (open + content + close all present):
 *      Transform the whole block. Buttons are extracted from complete
 *      `<amplify-quick-action …>label</amplify-quick-action>` tags only.
 *
 *   2. PARTIAL block (open tag present, close tag NOT yet arrived —
 *      mid-stream): transform whatever complete inner `<amplify-quick-action>`
 *      tags have arrived so far. The not-yet-closed inner tag is dropped
 *      (it'll appear on the next render when its closer arrives).
 *
 *   3. PARTIAL open tag at end of stream (e.g. `<amplify-quick-acti`):
 *      The partial open tag is dropped so the user doesn't see raw XML
 *      chars flashing by. The full tag will arrive on the next chunk.
 *
 * MULTIPLE BLOCKS
 * ---------------
 * A single message may contain multiple `<amplify-quick-actions>` blocks
 * (e.g. one after each section). All are transformed independently.
 */

const QUICK_ACTIONS_OPEN = '<amplify-quick-actions>';
const QUICK_ACTIONS_CLOSE = '</amplify-quick-actions>';

/*
 * Matches a complete `<amplify-quick-action ...>label</amplify-quick-action>`
 * tag. The attribute group `([^>]*)` captures everything inside the opening
 * tag (we extract individual attrs from it afterwards). The label group
 * `([\s\S]*?)` is non-greedy so it stops at the FIRST closing tag — this
 * matters when multiple quick-action tags sit in the same block.
 */
const QUICK_ACTION_REGEX = /<amplify-quick-action([^>]*)>([\s\S]*?)<\/amplify-quick-action>/g;

/*
 * Detects a partial (still-streaming) `<amplify-quick-…` open tag at the
 * END of the content — i.e. the open tag has started arriving but the
 * closing `>` hasn't yet. We drop these so the user doesn't see a flash
 * of raw `<amplify-quick-acti…` text while the tag is being streamed.
 *
 * The regex matches any prefix of `<amplify-quick-actions>` or
 * `<amplify-quick-action` (down to as little as `<amplify-quick`) that
 * does NOT contain a `>` — because once `>` arrives, the tag is complete
 * and either becomes a real block (handled by the main loop) or is
 * harmless text.
 *
 * Examples that MATCH (partial — stripped):
 *   `<amplify-quick-acti`           (truncated tag name)
 *   `<amplify-quick-action`         (missing closing `>`)
 *   `<amplify-quick-action type="x` (attribute still streaming)
 *   `<amplify-quick-actions`        (missing closing `>`)
 *
 * Examples that DON'T match (complete — left alone):
 *   `<amplify-quick-actions>`       (has `>`, so `[^>]*` stops before it)
 *   `<amplify-quick-action …>`      (same)
 *
 * Only invoked when the full `<amplify-quick-actions>` open tag is NOT
 * present in the content (checked by the caller), so we never nuke a
 * real block's open tag.
 */
const PARTIAL_OPEN_AT_END = /<amplify-quick[^>]*$/;

/**
 * Extract a `name="value"` attribute from a tag's attribute string.
 * Returns empty string (not undefined) so callers can chain without null
 * checks — the HTML builder writes `data-name=""` for missing attrs, which
 * is harmless.
 */
function extractAttr(tagAttrs: string, name: string): string {
  const match = tagAttrs.match(new RegExp(`${name}="([^"]*)"`, 'i'));

  return match ? match[1] : '';
}

/**
 * Escape a string for safe interpolation into an HTML attribute value.
 * We control the inputs (the model's output), but defence-in-depth — never
 * trust model output to be well-formed.
 */
function escapeAttr(value: string): string {
  return value.replace(/&/g, '&amp;').replace(/"/g, '&quot;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

/**
 * Build the `<button>` HTML for a single quick-action. Mirrors the shape
 * produced by `createQuickActionElement` in message-parser.ts so the
 * existing Markdown.tsx `button` component handler picks it up unchanged.
 */
function buildButton(tagAttrs: string, label: string): string {
  const type = extractAttr(tagAttrs, 'type');
  const message = extractAttr(tagAttrs, 'message');
  const path = extractAttr(tagAttrs, 'path');
  const href = extractAttr(tagAttrs, 'href');

  return (
    '<button ' +
    'class="__amplifyQuickAction__" ' +
    'data-amplify-quick-action="true" ' +
    `data-type="${escapeAttr(type)}" ` +
    `data-message="${escapeAttr(message)}" ` +
    `data-path="${escapeAttr(path)}" ` +
    `data-href="${escapeAttr(href)}"` +
    `>${label}</button>`
  );
}

/**
 * Transform ALL `<amplify-quick-actions>` blocks in `content` into the
 * `<div class="__amplifyQuickAction__">` HTML form. Streaming-safe.
 *
 * Returns the original content unchanged if no open tag is present.
 */
export function transformAmplifyQuickActions(content: string | undefined | null): string {
  if (!content || typeof content !== 'string') {
    return content ?? '';
  }

  if (!content.includes(QUICK_ACTIONS_OPEN)) {
    // No complete open tag. Drop any PARTIAL open tag at the end (streaming).
    return content.replace(PARTIAL_OPEN_AT_END, '');
  }

  let out = '';
  let cursor = 0;

  while (cursor < content.length) {
    const openIdx = content.indexOf(QUICK_ACTIONS_OPEN, cursor);

    if (openIdx === -1) {
      // No more open tags — append the rest (after dropping any partial open at end).
      out += content.slice(cursor).replace(PARTIAL_OPEN_AT_END, '');
      break;
    }

    // Keep text before the open tag verbatim.
    out += content.slice(cursor, openIdx);

    const contentStart = openIdx + QUICK_ACTIONS_OPEN.length;
    const closeIdx = content.indexOf(QUICK_ACTIONS_CLOSE, contentStart);

    /*
     * Streaming-safe: if no closer yet, take everything from after the
     * open tag to the end of content. Complete inner `<amplify-quick-action>`
     * tags will be picked up by the regex; partial inner tags are ignored
     * (they'll be transformed on the next render when their closer arrives).
     */
    const blockContent = closeIdx === -1 ? content.slice(contentStart) : content.slice(contentStart, closeIdx);

    // Find all complete <amplify-quick-action ...>label</amplify-quick-action> in the block.
    const buttons: string[] = [];
    QUICK_ACTION_REGEX.lastIndex = 0;

    let match: RegExpExecArray | null;

    while ((match = QUICK_ACTION_REGEX.exec(blockContent)) !== null) {
      const tagAttrs = match[1];
      const label = match[2].trim();

      if (label) {
        buttons.push(buildButton(tagAttrs, label));
      }
    }

    // Always emit the wrapper div (even if empty) so the layout slot is reserved.
    out += `<div class="__amplifyQuickAction__" data-amplify-quick-action="true">${buttons.join('')}</div>`;

    if (closeIdx === -1) {
      // Streaming: consumed everything to end.
      break;
    }

    cursor = closeIdx + QUICK_ACTIONS_CLOSE.length;
  }

  return out;
}
