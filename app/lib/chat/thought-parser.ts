/**
 * Thought parser — extracts Copilot-style chain-of-thought from a streamed
 * assistant response.
 *
 * The AI is instructed (see `new-prompt.ts`) to wrap its private reasoning in
 * `<thought>…</thought>` tags, followed by the user-facing answer. This mirrors
 * how VS Code Copilot surfaces a collapsible "Thought for Ns" panel above the
 * final answer.
 *
 * The parser is STREAMING-SAFE: while the model is still emitting tokens the
 * closing `</thought>` tag may not have arrived yet. We treat an unclosed
 * `<thought>` as an in-progress thought so the UI can render it live, then
 * automatically promotes it to a complete thought once the close tag arrives.
 *
 * It also tolerates multiple thought blocks interleaved with answer text —
 * each complete `<thought>…</thought>` becomes its own thought segment and the
 * text between/after them becomes answer segments.
 */

export interface ThoughtSegment {
  type: 'thought';
  text: string;

  /** True while the closing tag has not yet been seen (mid-stream). */
  streaming: boolean;
}

export interface AnswerSegment {
  type: 'answer';
  text: string;
}

export type ParsedSegment = ThoughtSegment | AnswerSegment;

export interface ParsedThoughts {
  /** Ordered list of thought + answer segments. */
  segments: ParsedSegment[];

  /** Convenience: all thought text concatenated (for the collapsible panel). */
  thoughtText: string;

  /** Convenience: all answer text concatenated (for the markdown body). */
  answerText: string;

  /** True if there is at least one thought segment (complete or streaming). */
  hasThoughts: boolean;
}

const THOUGHT_OPEN = '<thought>';
const THOUGHT_CLOSE = '</thought>';

/**
 * Parse a (possibly partial) assistant response into thought + answer segments.
 *
 * Algorithm:
 *   - Scan for `<thought>` openers.
 *   - For each opener, look for a matching `</thought>` closer.
 *     - If found → complete thought segment (text between tags).
 *     - If not found → streaming thought segment (everything after the opener).
 *   - Text outside any thought block → answer segment.
 *
 * This is O(n) and allocation-light; it re-runs on every streaming tick so it
 * must stay cheap. The input is typically a few KB at most.
 */
export function parseThoughts(content: string): ParsedThoughts {
  if (!content || typeof content !== 'string') {
    return { segments: [], thoughtText: '', answerText: '', hasThoughts: false };
  }

  // Fast path: no thought markers at all → single answer segment.
  if (!content.includes(THOUGHT_OPEN) && !content.includes(THOUGHT_CLOSE)) {
    return {
      segments: [{ type: 'answer', text: content }],
      thoughtText: '',
      answerText: content,
      hasThoughts: false,
    };
  }

  const segments: ParsedSegment[] = [];
  const thoughtParts: string[] = [];
  const answerParts: string[] = [];

  let cursor = 0;

  while (cursor < content.length) {
    const openIdx = content.indexOf(THOUGHT_OPEN, cursor);

    // No more openers — the rest is answer text.
    if (openIdx === -1) {
      const tail = content.slice(cursor);

      if (tail.length > 0) {
        segments.push({ type: 'answer', text: tail });
        answerParts.push(tail);
      }

      break;
    }

    // Text before the opener is answer text.
    if (openIdx > cursor) {
      const before = content.slice(cursor, openIdx);

      segments.push({ type: 'answer', text: before });
      answerParts.push(before);
    }

    const thoughtStart = openIdx + THOUGHT_OPEN.length;
    const closeIdx = content.indexOf(THOUGHT_CLOSE, thoughtStart);

    // No closer yet → streaming thought (everything from thoughtStart to end).
    if (closeIdx === -1) {
      const thoughtText = content.slice(thoughtStart);

      segments.push({ type: 'thought', text: thoughtText, streaming: true });
      thoughtParts.push(thoughtText);

      cursor = content.length;
      break;
    }

    // Complete thought.
    const thoughtText = content.slice(thoughtStart, closeIdx);

    segments.push({ type: 'thought', text: thoughtText, streaming: false });
    thoughtParts.push(thoughtText);

    cursor = closeIdx + THOUGHT_CLOSE.length;
  }

  // Clean up an orphan closing tag that may linger briefly during streaming.
  const thoughtText = thoughtParts
    .join('\n\n')
    .replace(/<\/thought>/g, '')
    .trim();
  let answerText = answerParts.join('').replace(/<\/thought>/g, '');

  /*
   * Tidy leading whitespace left behind by a stripped thought block so the
   * first paragraph of the real answer isn't pushed down by a blank line.
   */
  answerText = answerText.replace(/^\s+/, '');

  return {
    segments,
    thoughtText,
    answerText,
    hasThoughts: thoughtText.length > 0,
  };
}

/**
 * Extract just the visible answer text (thought blocks removed). Cheaper than
 * `parseThoughts` when the caller only needs the answer body — used by the
 * smooth-stream typewriter hook so we never animate thought characters.
 */
export function stripThoughts(content: string): string {
  if (!content || (!content.includes(THOUGHT_OPEN) && !content.includes(THOUGHT_CLOSE))) {
    return content;
  }

  const { answerText } = parseThoughts(content);

  return answerText;
}

/**
 * True while the response currently has an open `<thought>` with no matching
 * close tag. The UI uses this to keep the panel in its "Thinking…" state.
 */
export function isThoughtStreaming(content: string): boolean {
  if (!content || !content.includes(THOUGHT_OPEN)) {
    return false;
  }

  let openCount = 0;
  let pos = 0;

  while (true) {
    const idx = content.indexOf(THOUGHT_OPEN, pos);

    if (idx === -1) {
      break;
    }

    openCount++;
    pos = idx + THOUGHT_OPEN.length;
  }

  let closeCount = 0;
  pos = 0;

  while (true) {
    const idx = content.indexOf(THOUGHT_CLOSE, pos);

    if (idx === -1) {
      break;
    }

    closeCount++;
    pos = idx + THOUGHT_CLOSE.length;
  }

  return openCount > closeCount;
}
