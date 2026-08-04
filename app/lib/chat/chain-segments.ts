import type { TextUIPart, ReasoningUIPart } from '@ai-sdk/ui-utils';
import { isToolPart, getToolNameFromPart, getToolState } from './tool-parts';

/**
 * Chain-of-thought segment splitter.
 *
 * PROBLEM BEING SOLVED
 * --------------------
 * The AI SDK streams `parts` in the order the model emitted them:
 *
 *   [reasoning₁, tool₁, text₁, reasoning₂, tool₂]
 *
 * The previous AssistantMessage renderer filtered ALL reasoning+tool parts
 * into ONE flat array and concatenated ALL text parts into ONE string, then
 * rendered exactly one `<ThoughtsPanel>` followed by one `<Markdown>`. That
 * discarded the position of `text₁` — so a normal response that arrived
 * BETWEEN two reasoning/tool bursts was "pushed out" below the entire chain,
 * and the second reasoning/tool burst glued onto the original panel instead
 * of starting a new one. Visually, the chain appeared to continue across
 * what should have been a clean break.
 *
 * WHAT THIS HELPER DOES
 * ---------------------
 * Walks `parts` in stream order and produces an ordered list of segments.
 * Three kinds:
 *
 *   - `chain`  : a run of consecutive reasoning + tool parts. ALWAYS collapsible
 *                ("Thought for Ns" / "Completed in N steps" panel). A pure-tool
 *                run with NO reasoning is STILL a `chain` — the only thing that
 *                demotes a run to `tools` (inline, non-collapsible) is being
 *                SANDWICHED between two text segments (see `tools` below).
 *   - `tools`  : a run of tool parts (with or without reasoning) that sits
 *                BETWEEN two `text` segments — i.e. the model emitted a
 *                response, then called a tool, then emitted another response.
 *                These render as flat inline `[icon] Used x tool …` rows
 *                WITHOUT a collapsible wrapper, because the surrounding text
 *                already gives the user enough context — the tool call is a
 *                side action, not a "thinking" phase.
 *   - `text`   : a text part (non-empty after trim). Closes the current
 *                chain/tools accumulator, emits itself, and starts a fresh
 *                accumulator. This is the chain-BREAK trigger.
 *
 * Empty/whitespace-only text parts do NOT create a phantom `text` segment —
 * they're skipped so we don't render empty Markdown blocks between chains.
 *
 * CLASSIFICATION RULE (v2 — fixes the v1 bug)
 * -------------------------------------------
 * In v1, a run was `chain` only if it contained a reasoning part, otherwise
 * `tools`. That was wrong: a pure-tool run at the START of a message (e.g.
 * `[tool, tool, tool, tool, reasoning, response]`) was demoted to `tools`
 * (inline, non-collapsible) even though the user clearly wanted those tools
 * grouped as the model's "thinking" phase before the answer.
 *
 * v2 rule: a run is `tools` (inline) ONLY when it is sandwiched between two
 * text segments. Everything else — leading runs, trailing runs, runs between
 * text and step-start, runs containing reasoning, etc. — is `chain`
 * (collapsible). This makes the collapsible panel the DEFAULT, with inline
 * tool rows being the special case for "tool calls between two responses".
 *
 * IMPLEMENTATION
 * --------------
 * We can't decide `tools` vs `chain` during the first walk because we don't
 * yet know if a `text` segment will follow. So we do two passes:
 *
 *   1. Walk parts, build a list of "raw runs" (non-text accumulators) and
 *      `text` segments in stream order.
 *   2. Walk the raw runs: any run that has a `text` segment BOTH before AND
 *      after it becomes `tools`; everything else becomes `chain`.
 *
 * EXAMPLES
 * --------
 *   [reasoning, tool]
 *     → [chain: [reasoning, tool]]
 *
 *   [text]
 *     → [text: "..."]
 *
 *   [reasoning, tool, text, reasoning, tool]      ← the user's bug scenario
 *     → [chain: [reasoning, tool], text: "...", chain: [reasoning, tool]]
 *
 *   [text, reasoning]
 *     → [text: "...", chain: [reasoning]]
 *
 *   [tool]                                         ← leading tool, no text around
 *     → [chain: [tool]]
 *
 *   [tool, tool, tool, tool, reasoning, response] ← user's example: ONE chain
 *     → [chain: [tool, tool, tool, tool, reasoning], text: "response"]
 *
 *   [text, tool, text]                             ← sandwiched tool
 *     → [text: "...", tools: [tool], text: "..."]
 *
 *   [reasoning, text, tool]                        ← chain split by text; tool is trailing
 *     → [chain: [reasoning], text: "...", chain: [tool]]
 *     (NOT tools — the tool is at the END, not between two texts)
 *
 *   [tool, text, reasoning, tool]                  ← leading tool, then chain
 *     → [chain: [tool], text: "...", chain: [reasoning, tool]]
 *     (NOT tools for the first run — it's at the START, not sandwiched)
 *
 *   [reasoning, "", text, reasoning]               ← empty text part skipped
 *     → [chain: [reasoning], text: "...", chain: [reasoning]]
 *
 *   [text, tool]                                   ← tool AFTER text, no text after
 *     → [text: "...", chain: [tool]]
 *     (NOT tools — no following text segment)
 *
 * STEP-START PARTS
 * ----------------
 * The AI SDK emits `step-start` parts to mark the beginning of a new
 * generation step (e.g. after a tool result comes back and the model
 * generates a follow-up turn). These are NOT reasoning, NOT tools, and NOT
 * user-facing text — but they DO semantically mark a chain break (the model
 * is starting a fresh generation after the previous turn's tools completed).
 *
 * We treat `step-start` the same as `text`: it closes the current
 * chain/tools accumulator. We do NOT emit a `text` segment for it (it has
 * no content), so it acts as a silent break. IMPORTANTLY: a `step-start`
 * does NOT count as a "text neighbor" for the sandwich rule — a run between
 * a `text` and a `step-start` is still `chain`, because the step-start
 * doesn't give the user visible response text on both sides.
 *
 * Source/dynamic parts (`source-url`, `file`, etc.) are currently ignored —
 * they don't trigger a break and don't contribute to any segment. If a
 * future feature needs them rendered inline, add a new segment kind.
 */
export type ChainSegment =
  | { kind: 'chain'; parts: (ReasoningUIPart | any)[] }
  | { kind: 'tools'; parts: any[] }
  | { kind: 'text'; text: string };

/**
 * Internal intermediate shape used during the two-pass walk.
 *
 *   - `run`  : a consecutive non-text, non-step-start accumulator. Will be
 *              reclassified to `chain` or `tools` in pass 2.
 *   - `text` : a non-empty text segment (final — not reclassified).
 *   - `break`: a step-start (silent break — does NOT count as a text
 *              neighbor for the sandwich rule).
 */
type IntermediateSegment =
  | { kind: 'run'; parts: any[] }
  | { kind: 'text'; text: string }
  | { kind: 'break' };

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
   * A step-start closes the current run and emits a `break` (silent).
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
     * then start a fresh accumulator.
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
     * `step-start` (and any other non-content marker) → close the current
     * run silently. Emits a `break` so pass 2 knows the run ended, but the
     * break does NOT count as a "text neighbor" for the sandwich rule.
     */
    if (part.type === 'step-start' || part.type === 'stepStart') {
      flushAccumulator();
      intermediate.push({ kind: 'break' });
      continue;
    }

    /*
     * Unknown part types (source-url, file, etc.) — currently ignored.
     * They don't break the chain and don't contribute to any segment.
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
   * `text` segment BOTH immediately before AND immediately after it
   * (ignoring `break` segments — those don't count as text neighbors).
   *
   * Everything else becomes `chain` (collapsible).
   *
   * We also collapse `break` segments out of the final output — they were
   * only there to mark silent breaks during pass 1.
   */
  const segments: ChainSegment[] = [];

  for (let i = 0; i < intermediate.length; i++) {
    const seg = intermediate[i];

    if (seg.kind === 'text') {
      segments.push({ kind: 'text', text: seg.text });
      continue;
    }

    if (seg.kind === 'break') {
      // Breaks are silent — they don't appear in the final output.
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
 * Find the index of the nearest `text` segment BEFORE `runIdx` in the
 * intermediate list, skipping over `break` segments. Returns -1 if there
 * isn't one (i.e. the run is at the start, or only breaks precede it).
 *
 * A `break` (step-start) does NOT count as a text neighbor — it's a silent
 * chain breaker, not user-visible response text.
 */
function findNearestTextBefore(intermediate: IntermediateSegment[], runIdx: number): number {
  for (let i = runIdx - 1; i >= 0; i--) {
    const seg = intermediate[i];

    if (seg.kind === 'text') {
      return i;
    }

    // break → keep scanning past it (it doesn't count as text but also
    // doesn't block us from finding an earlier text).
    if (seg.kind === 'break') {
      continue;
    }

    // run → we hit another run before finding text. Not sandwiched on
    // this side.
    return -1;
  }

  return -1;
}

/**
 * Find the index of the nearest `text` segment AFTER `runIdx` in the
 * intermediate list, skipping over `break` segments. Returns -1 if there
 * isn't one.
 */
function findNearestTextAfter(intermediate: IntermediateSegment[], runIdx: number): number {
  for (let i = runIdx + 1; i < intermediate.length; i++) {
    const seg = intermediate[i];

    if (seg.kind === 'text') {
      return i;
    }

    if (seg.kind === 'break') {
      continue;
    }

    // run → another run before finding text.
    return -1;
  }

  return -1;
}

/**
 * Convenience: does this segment list contain ANY chain segment?
 *
 * Used by AssistantMessage to decide whether to render ANY ThoughtsPanel.
 * Note: a `chain` segment may contain ONLY tools (no reasoning) — that's
 * still a collapsible chain, just without reasoning text inside.
 */
export function hasChainSegment(segments: ChainSegment[] | undefined): boolean {
  if (!segments) {
    return false;
  }

  return segments.some((s) => s.kind === 'chain' && s.parts.length > 0);
}

/**
 * Convenience: collect ALL tool parts across ALL segments (chain + tools).
 * Used by AssistantMessage to evaluate `hasPendingToolCalls` — a pending tool
 * in ANY segment (chain or standalone) keeps the message "active".
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
 *
 * Used by AssistantMessage for the legacy `content` fallback path and for
 * the docx-artifact extractor (which needs the full text to scan for
 * `<docxartifact>` blocks regardless of where they appear).
 *
 * NOTE: This DOES preserve order — text segments are joined in the order
 * they appeared in the stream. What it does NOT do is preserve the
 * POSITION of text relative to chain/tools segments (that information is
 * only available by walking `segments` directly, which the new renderer
 * does).
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
 * The user's requirement:
 *
 *   - While a tool is running (pending)  → show the tool's label
 *     (e.g. "Searching the web", "Reading file", "Editing file").
 *   - While reasoning is streaming but NO tool is running  → "Thinking…".
 *   - When streaming ends  → existing "Completed with N steps" label.
 *
 * The label is computed from the LAST pending tool in the segment (most
 * recent action). If multiple tools are pending simultaneously, the last
 * one wins (matches Copilot's "show the most recent step" behaviour).
 *
 * If no tool is pending but a reasoning part is present, returns
 * `'Thinking…'` so the caller can show it instead of the generic
 * "Thinking…" placeholder.
 *
 * Returns `null` when:
 *   - The segment has no parts.
 *   - No tool is pending AND no reasoning is present (caller should fall
 *     back to its own label logic, e.g. "Completed with N steps").
 *
 * The pendingLabel text comes from `getMeta(toolName).pendingLabel` — but
 * to avoid a circular import (ToolProgress imports from chain-segments via
 * other paths), we duplicate the small pending-label table here. The
 * table is intentionally tiny; the fallback `Using ${toolName}` covers
 * any tool not listed.
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
 * Mirrors the same vocabulary as `tool-parts.ts` (v7 + v4 normalised).
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
 *   - If a tool in this segment is pending  → that tool's pending label
 *     (e.g. "Searching the web"). The LAST pending tool wins (most recent).
 *   - Else if the segment contains any reasoning part  → "Thinking…".
 *   - Else  → null (caller falls back to its own label logic).
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
