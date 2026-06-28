/**
 * Artifact stripper — removes `<boltArtifact>…</boltArtifact>` blocks from a
 * streamed assistant response so the "Created N files" / "Ran N command" trace
 * trees never render in the chat.
 *
 * WHY: when the model calls the `inject_template` tool, the tool's `execute`
 * writes a full `<boltArtifact>` document (template files + `npm install`
 * shell action) into the message text as a side-effect. That artifact is then
 * parsed by the message parser (which actually creates the files and runs the
 * commands via the action runner) AND rendered by the Markdown component
 * (which shows the Artifact/TraceTree UI).
 *
 * The user-facing trace tree ("Created 50 files" / "Ran 1 command") for a
 * template injection holds no value in the chat — it's silent scaffolding.
 * So when a message contains an `inject_template` tool invocation, we strip
 * the artifact blocks from the text that feeds the Markdown renderer. The
 * message parser still sees the raw `message.content` (it runs independently
 * in `useMessageParser`), so the files are still created and the commands
 * still run — only the visual trace tree is suppressed.
 *
 * The stripper is STREAMING-SAFE: while the artifact is still streaming the
 * closing `</boltArtifact>` tag may not have arrived yet. We treat an unclosed
 * `<boltArtifact>` as an in-progress artifact and strip from the opener to the
 * end so the partial artifact never flashes in the UI.
 */

const ARTIFACT_OPEN_TAG = '<boltArtifact';
const ARTIFACT_CLOSE_TAG = '</boltArtifact>';

/**
 * Remove every `<boltArtifact …>…</boltArtifact>` block (and any in-progress
 * unclosed opener) from `text`. Also collapses the blank lines a stripped
 * block leaves behind so the surrounding answer text stays tidy.
 *
 * This is O(n) and allocation-light; it re-runs on every streaming tick so it
 * must stay cheap. The input is typically a few KB at most.
 */
export function stripBoltArtifacts(text: string): string {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  // Fast path: no artifact markers at all → nothing to strip.
  if (!text.includes(ARTIFACT_OPEN_TAG) && !text.includes(ARTIFACT_CLOSE_TAG)) {
    return text;
  }

  let out = '';
  let cursor = 0;

  while (cursor < text.length) {
    const openIdx = text.indexOf(ARTIFACT_OPEN_TAG, cursor);

    // No more openers — the rest is kept verbatim.
    if (openIdx === -1) {
      out += text.slice(cursor);
      break;
    }

    // Text before the opener is kept.
    if (openIdx > cursor) {
      out += text.slice(cursor, openIdx);
    }

    // Find the matching `</boltArtifact>` closer.
    const closeIdx = text.indexOf(ARTIFACT_CLOSE_TAG, openIdx);

    /*
     * No closer yet → streaming artifact. Drop everything from the opener to
     * the end (the partial artifact must not flash in the UI).
     */
    if (closeIdx === -1) {
      cursor = text.length;
      break;
    }

    // Skip past the entire artifact block (opener → closer inclusive).
    cursor = closeIdx + ARTIFACT_CLOSE_TAG.length;
  }

  /*
   * Tidy up: collapse runs of blank lines left behind by a stripped block so
   * the answer text doesn't get pushed apart by empty gaps.
   */
  out = out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();

  return out;
}

/**
 * True if the given AI-SDK `parts` array contains an `inject_template` tool
 * invocation (in any state — call, result, or streaming). Used by the
 * AssistantMessage to decide whether to suppress the artifact trace tree.
 */
export function hasInjectTemplateCall(
  parts: ({ type: string; toolInvocation?: { toolName?: string } } | { type: string })[] | undefined,
): boolean {
  if (!parts || !Array.isArray(parts)) {
    return false;
  }

  return parts.some(
    (p) =>
      p.type === 'tool-invocation' &&
      (p as { toolInvocation?: { toolName?: string } }).toolInvocation?.toolName === 'inject_template',
  );
}
