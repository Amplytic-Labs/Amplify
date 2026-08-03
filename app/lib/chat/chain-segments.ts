import type { TextUIPart, ReasoningUIPart } from '@ai-sdk/ui-utils';
import { isToolPart } from './tool-parts';

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
 *   - `chain`  : a run of consecutive reasoning + tool parts that CONTAINS
 *                at least one reasoning part. These are the "Thought for Ns"
 *                collapsible panels. A pure-tool run is NOT a chain — see
 *                `tools` below.
 *   - `tools`  : a run of consecutive tool parts with NO reasoning. These
 *                render as flat inline `[icon] Used x tool …` rows WITHOUT
 *                a "Thought for Ns" collapsible wrapper — non-reasoning
 *                models should not get a misleading thinking panel.
 *   - `text`   : a text part (non-empty after trim). Closes the current
 *                chain/tools accumulator, emits itself, and starts a fresh
 *                accumulator. This is the chain-BREAK trigger.
 *
 * Empty/whitespace-only text parts do NOT create a phantom `text` segment —
 * they're skipped so we don't render empty Markdown blocks between chains.
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
 *   [tool]                                         ← non-reasoning model
 *     → [tools: [tool]]
 *
 *   [tool, tool, tool]                             ← multiple tools, no reasoning
 *     → [tools: [tool, tool, tool]]
 *
 *   [reasoning, text, tool]                        ← chain split by text
 *     → [chain: [reasoning], text: "...", tools: [tool]]
 *
 *   [reasoning, "", text, reasoning]               ← empty text part skipped
 *     → [chain: [reasoning], text: "...", chain: [reasoning]]
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
 * no content), so it acts as a silent break.
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

  const segments: ChainSegment[] = [];

  /*
   * Current accumulator for consecutive reasoning/tool parts. Reset to []
   * every time a text or step-start part closes the current run.
   */
  let acc: any[] = [];
  let accHasReasoning = false;

  const flushAccumulator = () => {
    if (acc.length === 0) {
      return;
    }

    if (accHasReasoning) {
      segments.push({ kind: 'chain', parts: acc });
    } else {
      segments.push({ kind: 'tools', parts: acc });
    }

    acc = [];
    accHasReasoning = false;
  };

  for (const part of parts) {
    if (!part || typeof part !== 'object') {
      continue;
    }

    // Reasoning part → accumulate, mark accumulator as having reasoning.
    if (part.type === 'reasoning') {
      acc.push(part);
      accHasReasoning = true;
      continue;
    }

    /*
     * Tool part (v7 `tool-<name>` / `dynamic-tool` OR legacy v4
     * `tool-invocation`) → accumulate, but don't mark as reasoning.
     */
    if (isToolPart(part)) {
      acc.push(part);
      continue;
    }

    /*
     * Text part → close current chain/tools run, emit a text segment
     * (if non-empty), then start a fresh accumulator.
     */
    if (part.type === 'text') {
      const text = (part as TextUIPart).text ?? '';

      if (text.trim() !== '') {
        flushAccumulator();
        segments.push({ kind: 'text', text });
      }

      // Empty text parts are skipped entirely — no break, no segment.
      continue;
    }

    /*
     * `step-start` (and any other non-content marker) → close the current
     * run silently. Does NOT emit a text segment (no user-facing content).
     */
    if (part.type === 'step-start' || part.type === 'stepStart') {
      flushAccumulator();
      continue;
    }

    /*
     * Unknown part types (source-url, file, etc.) — currently ignored.
     * They don't break the chain and don't contribute to any segment.
     */
  }

  // Flush any trailing accumulator (the common case: ends with reasoning/tools).
  flushAccumulator();

  return segments.length > 0 ? segments : undefined;
}

/**
 * Convenience: does this segment list contain ANY chain (reasoning) segment?
 * Used by AssistantMessage to decide whether to render ANY ThoughtsPanel.
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
