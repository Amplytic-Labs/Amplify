import type { TextUIPart, ReasoningUIPart } from '@ai-sdk/ui-utils';
import { isToolPart, getToolNameFromPart, getToolState } from './tool-parts';

/**
 * Chain-of-thought segment splitter — COPILOT-FAITHFUL semantics.
 *
 * PROBLEM BEING SOLVED
 * --------------------
 * The AI SDK streams `parts` in the order the model emitted them:
 *
 *   [reasoning₁, tool₁, text₁, reasoning₂, tool₂]
 *
 * VS Code Copilot's renderer (in vscode/workbench/contrib/chat/browser/)
 * groups consecutive `thinking` + `toolInvocation` parts into ONE
 * collapsible "Thinking" panel. A `markdown` part — i.e. real user-facing
 * response text — TERMINATES the panel. The next thinking/tool run after
 * that text starts a FRESH panel.
 *
 * That's exactly the behaviour the user wants:
 *
 *   - "any combination of tools and thought parts in consecutive should be
 *      chained together — does not matter who comes after who or is it
 *      tools repeating or just thought blocks repeating"
 *   - "they may send a normal response before executing a tool and say like
 *      'I will not use list_dir' — so as you can see we should break the
 *      previous chain of thought"
 *
 * WHAT THIS HELPER DOES
 * ---------------------
 * Walks `parts` in stream order and produces an ordered list of segments.
 * Three kinds:
 *
 *   - `chain`  : a run of consecutive reasoning + tool parts. ALWAYS collapsible.
 *                A pure-tool run with NO reasoning is STILL a `chain`.
 *   - `tools`  : a run of tool parts (with or without reasoning) that sits
 *                BETWEEN two `text` segments — i.e. the model emitted a
 *                response, then called a tool, then emitted another response.
 *                These render as flat inline `[icon] Used x tool …` rows
 *                WITHOUT a collapsible wrapper. (Sandwiched case only.)
 *   - `text`   : a text part (non-empty after trim). Closes the current
 *                chain/tools accumulator, emits itself, and starts a fresh
 *                accumulator. This is the chain-BREAK trigger — matching
 *                Copilot's "markdown terminates the thinking panel" rule.
 *
 * RULE (final, Copilot-faithful)
 * ------------------------------
 *   - `text` (non-empty)            → BREAKS the chain.
 *   - `reasoning` / tool parts      → accumulate into the current run.
 *   - `step-start`                  → IGNORED. Does NOT break the chain.
 *                                     The AI SDK emits step-starts between
 *                                     agent steps (after a tool result
 *                                     comes back). Copilot's renderer never
 *                                     sees these (the extension API has no
 *                                     such concept), so to faithfully match
 *                                     Copilot we must NOT break on them.
 *                                     This is the fix for "the same chain
 *                                     repeats multiple times across steps".
 *   - empty/whitespace text         → skipped (no phantom text segment).
 *   - unknown parts (source-url,
 *     file, etc.)                   → ignored, no break.
 *
 * Two-pass implementation:
 *   1. Walk parts, build a list of "raw runs" + `text` segments in stream order.
 *   2. Walk raw runs: any run with a `text` BOTH before AND after it becomes
 *      `tools` (inline); everything else becomes `chain` (collapsible).
 *
 * EXAMPLES
 * --------
 *   [reasoning, tool]                              → [chain: [reasoning, tool]]
 *   [text]                                         → [text: "..."]
 *   [reasoning, tool, text, reasoning, tool]       → [chain, text, chain]
 *   [step-start, reasoning, step-start, tool]      → [chain: [reasoning, tool]]
 *                                                    (step-starts ignored)
 *   [reasoning, step-start, reasoning, tool, text] → [chain: [r,r,t], text]
 *                                                    (ONE chain — step-start
 *                                                     did NOT split it)
 *   [text, tool, text]                             → [text, tools, text]
 *                                                    (sandwiched → inline)
 *   [tool, tool, tool, reasoning, response]        → [chain: [t,t,t,r], text]
 *                                                    (ONE chain + ONE text)
 */
export type ChainSegment =
  | { kind: 'chain'; parts: (ReasoningUIPart | any)[] }
  | { kind: 'tools'; parts: any[] }
  | { kind: 'text'; text: string };

/**
 * Internal intermediate shape used during the two-pass walk.
 *
 *   - `run`  : a consecutive non-text accumulator. Will be reclassified to
 *              `chain` or `tools` in pass 2.
 *   - `text` : a non-empty text segment (final — not reclassified).
 */
type IntermediateSegment = { kind: 'run'; parts: any[] } | { kind: 'text'; text: string };

/**
 * Split a `UIMessage.parts` array into ordered segments.
 *
 * Returns `undefined` when `parts` is undefined/null/empty — callers can
 * treat that as "no segments, fall back to legacy content rendering".
 */
export function splitPartsIntoSegments(
  parts: (TextUIPart | ReasoningUIPart | any)[] | undefined | null,
): ChainSegment[] | undefined {
  if (!parts || parts.length === 0) {
    return undefined;
  }

  /*
   * PASS 1 — walk parts in stream order, building intermediate segments.
   *
   * Consecutive reasoning/tool parts accumulate into a single `run`. A
   * non-empty text part closes the current run and emits a `text` segment.
   *
   * NOTE: `step-start` is intentionally NOT handled here. It falls through
   * to the "unknown part types — ignored" branch, so it neither breaks the
   * chain nor contributes to any segment. This matches Copilot's renderer,
   * which never sees step-starts at all.
   */
  const intermediate: IntermediateSegment[] = [];
  let acc: any[] = [];

  const flushAccumulator = () => {
    if (acc.length === 0) {
      return;
    }

    intermediate.push({ kind: 'run', parts: acc });
    acc = [];
  };

  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    // Reasoning part → accumulate.
    if (part.type === 'reasoning') {
      acc.push(part);
      continue;
    }

    /*
     * Tool part (v7 `tool-<name>` / `dynamic-tool` OR legacy v4
     * `tool-invocation`) → accumulate.
     */
    if (isToolPart(part)) {
      acc.push(part);
      continue;
    }

    /*
     * Text part → close current run, emit a text segment (if non-empty),
     * then start a fresh accumulator. THIS is the chain-break trigger.
     */
    if (part.type === 'text') {
      const text = (part as TextUIPart).text ?? '';

      if (text.trim() !== '') {
        flushAccumulator();
        intermediate.push({ kind: 'text', text });
      }

      // Empty text parts are skipped entirely — no break, no segment.
      continue;
    }

    /*
     * All other part types — `step-start`, `source-url`, `file`, etc. —
     * are IGNORED. They do NOT break the chain and do NOT contribute to
     * any segment. This is the Copilot-faithful behaviour: only real
     * user-facing text terminates a thinking panel.
     */
  }

  // Flush any trailing accumulator (the common case: ends with reasoning/tools).
  flushAccumulator();

  if (intermediate.length === 0) {
    return undefined;
  }

  /*
   * PASS 2 — reclassify each `run` as `chain` or `tools`.
   *
   * A run becomes `tools` (inline, non-collapsible) ONLY when it has a
   * `text` segment BOTH immediately before AND immediately after it.
   * Everything else becomes `chain` (collapsible).
   */
  const segments: ChainSegment[] = [];

  for (let i = 0; i < intermediate.length; i++) {
    const seg = intermediate[i];

    if (seg.kind === 'text') {
      segments.push({ kind: 'text', text: seg.text });
      continue;
    }

    // seg.kind === 'run' — decide chain vs tools by looking at neighbors.
    const prevTextIdx = findNearestTextBefore(intermediate, i);
    const nextTextIdx = findNearestTextAfter(intermediate, i);

    const isSandwichedBetweenText = prevTextIdx !== -1 && nextTextIdx !== -1;

    if (isSandwichedBetweenText) {
      segments.push({ kind: 'tools', parts: seg.parts });
    } else {
      segments.push({ kind: 'chain', parts: seg.parts });
    }
  }

  return segments.length > 0 ? segments : undefined;
}

/**
 * Find the index of the nearest `text` segment BEFORE `runIdx`.
 * Returns -1 if there isn't one (i.e. the run is at the start).
 */
function findNearestTextBefore(intermediate: IntermediateSegment[], runIdx: number): number {
  for (let i = runIdx - 1; i >= 0; i--) {
    const seg = intermediate[i];

    if (seg.kind === 'text') {
      return i;
    }

    // run → another run before finding text. Not sandwiched on this side.
    return -1;
  }

  return -1;
}

/**
 * Find the index of the nearest `text` segment AFTER `runIdx`.
 * Returns -1 if there isn't one.
 */
function findNearestTextAfter(intermediate: IntermediateSegment[], runIdx: number): number {
  for (let i = runIdx + 1; i < intermediate.length; i++) {
    const seg = intermediate[i];

    if (seg.kind === 'text') {
      return i;
    }

    // run → another run before finding text.
    return -1;
  }

  return -1;
}

/**
 * Convenience: does this segment list contain ANY chain segment?
 */
export function hasChainSegment(segments: ChainSegment[] | undefined): boolean {
  if (!segments) {
    return false;
  }

  return segments.some((s) => s.kind === 'chain' && s.parts.length > 0);
}

/**
 * Convenience: collect ALL tool parts across ALL segments (chain + tools).
 */
export function collectAllToolParts(segments: ChainSegment[] | undefined): any[] {
  if (!segments) {
    return [];
  }

  const out: any[] = [];

  for (const seg of segments) {
    if (seg.kind === 'chain' || seg.kind === 'tools') {
      out.push(...seg.parts.filter((p) => isToolPart(p)));
    }
  }

  return out;
}

/**
 * Convenience: concatenate all text segments into a single string.
 */
export function concatTextSegments(segments: ChainSegment[] | undefined): string {
  if (!segments) {
    return '';
  }

  return segments
    .filter((s): s is { kind: 'text'; text: string } => s.kind === 'text')
    .map((s) => s.text)
    .join('');
}

/*
 * ===========================================================================
 * ACTIVE LABEL — what should the chain header show while streaming?
 * ===========================================================================
 *
 *   - While a tool is running (pending)  → show the tool's label
 *     (e.g. "Searching the web", "Reading file", "Editing file").
 *   - While reasoning is streaming but NO tool is running  → "Thinking…".
 *   - When streaming ends  → "" (empty — no "Thought for Ns" label,
 *     per user request).
 */
const TOOL_PENDING_LABELS: Record<string, string> = {
  web_search: 'Searching the web',
  fetch_webpage: 'Reading web page',
  read_file: 'Reading file',
  list_dir: 'Listing directory',
  find_files: 'Finding files',
  grep_search: 'Searching in codebase',
  semantic_search: 'Performing semantic search',
  read_notebook_cell: 'Reading notebook cell',
  run_in_terminal: 'Running command',
  create_file: 'Creating file',
  replace_string_in_file: 'Editing file',
  multi_replace_string_in_file: 'Editing file',
  execute_plan: 'Executing plan',
  update_user_memory: 'Updating memory',
  read_user_memory: 'Reading memory',
};

/**
 * Returns the pending-state label for a tool name (e.g. "Searching the web").
 * Falls back to `Using ${toolName}` for tools not in the table.
 */
export function getToolPendingLabel(toolName: string): string {
  return TOOL_PENDING_LABELS[toolName] || `Using ${toolName}`;
}

/**
 * Tool-call states that count as "pending" (in-flight, no result yet).
 */
const PENDING_TOOL_STATES = new Set([
  'input-streaming',
  'input-available',
  'partial',
  'partial-call',
  'call',
  'approval-requested',
]);

/**
 * Compute the "active label" for a chain segment — what the header should
 * show while this segment is streaming.
 *
 *   - If a tool in this segment is pending  → that tool's pending label.
 *   - Else if the segment contains any reasoning part  → "Thinking…".
 *   - Else  → null (caller falls back to empty / no label).
 *
 * `isStreaming` controls whether the segment is considered "active". When
 * false, this function always returns null (nothing is in-flight).
 */
export function getActiveChainLabel(
  segment: { kind: 'chain'; parts: any[] } | undefined,
  isStreaming: boolean,
): string | null {
  if (!segment || !isStreaming || segment.parts.length === 0) {
    return null;
  }

  let lastPendingToolLabel: string | null = null;
  let hasReasoning = false;

  for (const part of segment.parts) {
    if (part?.type === 'reasoning') {
      hasReasoning = true;
      continue;
    }

    if (isToolPart(part)) {
      const state = getToolState(part);

      if (PENDING_TOOL_STATES.has(state)) {
        const name = getToolNameFromPart(part);
        lastPendingToolLabel = getToolPendingLabel(name);
      }
    }
  }

  if (lastPendingToolLabel) {
    return lastPendingToolLabel;
  }

  if (hasReasoning) {
    return 'Thinking…';
  }

  return null;
}
