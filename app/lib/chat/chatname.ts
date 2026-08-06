/**
 * Chat-name tag handling — the NEW (token-efficient) chat-naming method.
 *
 * Instead of making a SEPARATE AI call to name the chat (the old
 * `/api/chat-title` endpoint, now removed), the system prompt asks the AI
 * to prepend a `<chatname>…</chatname>` tag to its FIRST response only.
 * We extract the name from that tag and use it as the chat/project title.
 *
 * Key properties:
 *   - The instruction is added to the system prompt ONLY on the first
 *     message (when no assistant message exists yet). It is silent on all
 *     subsequent turns — zero extra tokens, zero extra round-trips.
 *   - The `<chatname>` tag is STRIPPED from the assistant message before
 *     it is displayed to the user and before it is stored / re-sent to the
 *     AI. So the AI never sees its own previous `<chatname>` tag, and the
 *     user never sees it either.
 *
 * This module is shared between:
 *   - `stream-text.ts` (server) — strips `<chatname>` from prior assistant
 *     messages before sending them to the LLM, so the tag never leaks
 *     back into the model's context on turn 2+.
 *   - `AssistantMessage.tsx` (client) — strips `<chatname>` from the
 *     streamed content so it is never rendered.
 *   - `useChatHistory.ts` (client) — extracts the name and sets the chat
 *     description / project name.
 */

export const CHATNAME_OPEN = '<chatname>';
export const CHATNAME_CLOSE = '</chatname>';

/**
 * Extract the chat name from the FIRST `<chatname>…</chatname>` block in
 * the content. Returns `null` if no complete (closed) tag is present.
 *
 * A partially-streamed `<chatname>name…` (no closing tag yet) returns
 * `null` — we only commit the name once the tag is closed, to avoid
 * capturing a half-finished name.
 */
export function extractChatName(content: string | undefined | null): string | null {
  if (!content || typeof content !== 'string') {
    return null;
  }

  const start = content.indexOf(CHATNAME_OPEN);

  if (start === -1) {
    return null;
  }

  const nameStart = start + CHATNAME_OPEN.length;
  const end = content.indexOf(CHATNAME_CLOSE, nameStart);

  if (end === -1) {
    // Closing tag not yet seen (mid-stream) — don't commit a partial name.
    return null;
  }

  const name = content.slice(nameStart, end).trim();

  // Sanity: reject empty or absurdly long names.
  if (!name || name.length > 80) {
    return null;
  }

  // Strip surrounding quotes/whitespace the model may have added.
  return name.replace(/^["'`]+|["'`]+$/g, '').trim() || null;
}

/**
 * Remove ALL `<chatname>…</chatname>` blocks from the content, plus any
 * trailing/partial open tag that may be present while streaming.
 *
 * Also tidies leading whitespace left behind by a stripped tag so the
 * first paragraph of the real answer isn't pushed down.
 *
 * Streaming-safe: if only an open tag is present (no closer), the open
 * tag and everything after it (up to the end) is removed — so the user
 * never sees a half-rendered `<chatname>partial name…` while the model
 * is still emitting the name.
 */
export function stripChatName(content: string | undefined | null): string {
  if (!content || typeof content !== 'string') {
    return content ?? '';
  }

  if (!content.includes(CHATNAME_OPEN)) {
    return content;
  }

  let result = '';
  let cursor = 0;

  while (cursor < content.length) {
    const openIdx = content.indexOf(CHATNAME_OPEN, cursor);

    if (openIdx === -1) {
      // No more open tags — append the rest.
      result += content.slice(cursor);
      break;
    }

    // Keep text before the open tag.
    result += content.slice(cursor, openIdx);

    const nameStart = openIdx + CHATNAME_OPEN.length;
    const closeIdx = content.indexOf(CHATNAME_CLOSE, nameStart);

    if (closeIdx === -1) {
      /*
       * Open tag with no closer (mid-stream): drop the open tag + the
       * not-yet-finished name. We intentionally do NOT append it.
       */
      break;
    }

    // Skip past the closed tag.
    cursor = closeIdx + CHATNAME_CLOSE.length;
  }

  // Tidy leading whitespace left behind by a stripped leading tag.
  return result.replace(/^\s+/, '');
}
