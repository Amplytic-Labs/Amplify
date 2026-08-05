/**
 * Artifact stripper — removes `<amplifyArtifact>…</amplifyArtifact>` blocks from a
 * streamed assistant response so the "Created N files" / "Ran N command" trace
 * trees never render in the chat.
 *
 * WHY: when the model calls the `inject_template` tool, the tool's `execute`
 * writes a full `<amplifyArtifact>` document (template files + `npm install`
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
 * closing `</amplifyArtifact>` tag may not have arrived yet. We treat an unclosed
 * `<amplifyArtifact>` as an in-progress artifact and strip from the opener to the
 * end so the partial artifact never flashes in the UI.
 */

import { isToolPart, getToolNameFromPart } from '~/lib/chat/tool-parts';

const ARTIFACT_OPEN_TAG = '<amplifyArtifact';
const ARTIFACT_CLOSE_TAG = '</amplifyArtifact>';

/**
 * Remove every `<amplifyArtifact …>…</amplifyArtifact>` block (and any in-progress
 * unclosed opener) from `text`. Also collapses the blank lines a stripped
 * block leaves behind so the surrounding answer text stays tidy.
 *
 * This is O(n) and allocation-light; it re-runs on every streaming tick so it
 * must stay cheap. The input is typically a few KB at most.
 */
export function stripAmplifyArtifacts(text: string): string {
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

    // Find the matching `</amplifyArtifact>` closer.
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
 * Replace every `<amplifyArtifact>…</amplifyArtifact>` block in `text` with a
 * concise one-line summary of what it contained (file paths + shell/start
 * commands), so the LLM knows the workspace structure WITHOUT carrying the
 * full file contents in the prompt.
 *
 * WHY: a git-imported or template-injected project can easily be 200k+ tokens
 * of file contents wrapped in `<amplifyArtifact>`. The client message parser
 * already consumed that block on first load and wrote the files into the
 * WebContainer, so from the model's perspective the raw artifact is dead
 * weight. Re-sending it every turn was bloating the prompt to ~273k tokens and
 * forcing `createSummary` to run on every message.
 *
 * This mirrors what the `inject_template` TOOL returns to the model — a short
 * `summary` ("Injected X template. Files created: a, b, c") rather than the
 * full file bodies. If the model needs actual file contents it can use the
 * `list_dir` / `read_file` tools, exactly as it does after calling
 * `inject_template`.
 *
 * The replacement line looks like:
 *   `[Workspace update — N file(s): src/main.tsx, package.json, … ; 1 shell command: npm install]`
 *
 * Streaming-safe: an unclosed `<amplifyArtifact>` opener is dropped entirely
 * (treated as in-progress) so partial artifacts never reach the model.
 */
const ACTION_FILE_RE = /<amplifyAction\s+type="file"\s+filePath="([^"]*)"\s*>/g;
const ACTION_SHELL_RE = /<amplifyAction\s+type="shell"\s*>([\s\S]*?)<\/amplifyAction>/g;
const ACTION_START_RE = /<amplifyAction\s+type="start"\s*>([\s\S]*?)<\/amplifyAction>/g;

export function stripAmplifyArtifactsWithSummary(text: string): string {
  if (!text || typeof text !== 'string') {
    return text || '';
  }

  // Fast path: no artifact markers at all → nothing to do.
  if (!text.includes(ARTIFACT_OPEN_TAG) && !text.includes(ARTIFACT_CLOSE_TAG)) {
    return text;
  }

  let out = '';
  let cursor = 0;

  while (cursor < text.length) {
    const openIdx = text.indexOf(ARTIFACT_OPEN_TAG, cursor);

    // No more openers — keep the rest verbatim.
    if (openIdx === -1) {
      out += text.slice(cursor);
      break;
    }

    // Keep text before the opener.
    if (openIdx > cursor) {
      out += text.slice(cursor, openIdx);
    }

    const closeIdx = text.indexOf(ARTIFACT_CLOSE_TAG, openIdx);

    // No closer yet → streaming artifact. Drop it entirely.
    if (closeIdx === -1) {
      cursor = text.length;
      break;
    }

    const block = text.slice(openIdx, closeIdx + ARTIFACT_CLOSE_TAG.length);
    cursor = closeIdx + ARTIFACT_CLOSE_TAG.length;

    // Extract a concise description of what this artifact contained.
    out += summarizeArtifactBlock(block);
  }

  // Tidy up blank lines left behind.
  out = out
    .replace(/\n{3,}/g, '\n\n')
    .replace(/[ \t]+\n/g, '\n')
    .trimEnd();

  return out;
}

/**
 * Build a one-line summary of a single `<amplifyArtifact>` block: how many
 * files, their paths (capped to avoid re-bloating the prompt), and any
 * shell/start commands. The full file CONTENTS are never included — only
 * paths and commands, which is what the model needs to decide which
 * `list_dir` / `read_file` calls to make.
 */
function summarizeArtifactBlock(block: string): string {
  const parts: string[] = [];

  /*
   * File paths — collect all, but only list the first 40 in the summary line
   * to avoid re-bloating the prompt for very large repos. The count is always
   * accurate so the model knows how many files exist.
   */
  const filePaths: string[] = [];
  let m: RegExpExecArray | null;
  const fileRe = new RegExp(ACTION_FILE_RE);

  while ((m = fileRe.exec(block)) !== null) {
    filePaths.push(m[1]);
  }

  if (filePaths.length > 0) {
    const shown = filePaths.slice(0, 40);
    const more = filePaths.length > shown.length ? `, +${filePaths.length - shown.length} more` : '';
    parts.push(`${filePaths.length} file${filePaths.length === 1 ? '' : 's'}: ${shown.join(', ')}${more}`);
  }

  // Shell commands (setup/install).
  const shellRe = new RegExp(ACTION_SHELL_RE);
  const shellCmds: string[] = [];

  while ((m = shellRe.exec(block)) !== null) {
    const cmd = m[1].trim();

    if (cmd) {
      shellCmds.push(cmd);
    }
  }

  if (shellCmds.length > 0) {
    parts.push(`${shellCmds.length} shell command${shellCmds.length === 1 ? '' : 's'}: ${shellCmds.join(' ; ')}`);
  }

  // Start commands (dev server).
  const startRe = new RegExp(ACTION_START_RE);
  const startCmds: string[] = [];

  while ((m = startRe.exec(block)) !== null) {
    const cmd = m[1].trim();

    if (cmd) {
      startCmds.push(cmd);
    }
  }

  if (startCmds.length > 0) {
    parts.push(`start command: ${startCmds.join(' ; ')}`);
  }

  if (parts.length === 0) {
    return '[workspace update]';
  }

  return `[workspace update — ${parts.join(' ; ')}]`;
}

/**
 * True if the given AI-SDK `parts` array contains an `inject_template` tool
 * invocation (in any state — call, result, or streaming). Used by the
 * AssistantMessage to decide whether to suppress the artifact trace tree.
 *
 * V7 MIGRATION (Task 3b): tool parts have `type: 'tool-<name>'` or
 * `'dynamic-tool'` (NOT the v4 literal `'tool-invocation'`). We use the
 * shared `isToolPart` + `getToolNameFromPart` helpers so both shapes work.
 */
export function hasInjectTemplateCall(parts: any[] | undefined): boolean {
  if (!parts || !Array.isArray(parts)) {
    return false;
  }

  return parts.some((p) => isToolPart(p) && getToolNameFromPart(p) === 'inject_template');
}
