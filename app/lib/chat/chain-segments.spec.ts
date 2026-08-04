import { describe, it, expect } from 'vitest';
import { splitPartsIntoSegments, hasChainSegment, collectAllToolParts, concatTextSegments } from './chain-segments';

/*
 * Helpers to build parts in the various shapes the splitter must accept.
 * The splitter is shape-agnostic via `isToolPart` (handles both v7
 * `tool-<name>` and legacy v4 `tool-invocation`).
 */
const text = (t: string) => ({ type: 'text' as const, text: t });
const reasoning = (t: string) => ({
  type: 'reasoning' as const,
  details: [{ type: 'text', text: t }],
  text: t,
});
const tool = (id: string, name = 'read_file', state = 'output-available') => ({
  type: `tool-${name}` as const,
  toolCallId: id,
  state,
  input: { filePath: 'src/index.ts' },
  output: 'file contents',
});
const legacyTool = (id: string) => ({
  type: 'tool-invocation' as const,
  toolInvocation: {
    toolCallId: id,
    toolName: 'list_dir',
    state: 'result',
    args: { path: '.' },
    result: 'file list',
  },
});
const stepStart = () => ({ type: 'step-start' as const });

describe('splitPartsIntoSegments', () => {
  it('returns undefined for empty/undefined input', () => {
    expect(splitPartsIntoSegments(undefined)).toBeUndefined();
    expect(splitPartsIntoSegments(null)).toBeUndefined();
    expect(splitPartsIntoSegments([])).toBeUndefined();
  });

  it('returns undefined when only unknown part types are present', () => {
    expect(splitPartsIntoSegments([{ type: 'source-url' } as any])).toBeUndefined();
  });

  it('[reasoning, tool] → 1 chain, 0 text', () => {
    const segs = splitPartsIntoSegments([reasoning('thinking…'), tool('t1')]);
    expect(segs).toEqual([{ kind: 'chain', parts: [reasoning('thinking…'), tool('t1')] }]);
  });

  it('[text] → 0 chain, 1 text', () => {
    const segs = splitPartsIntoSegments([text('Hello world')]);
    expect(segs).toEqual([{ kind: 'text', text: 'Hello world' }]);
  });

  it('[reasoning, tool, text, reasoning, tool] → 2 chains, 1 text in between (THE BUG)', () => {
    const r1 = reasoning('first thought');
    const t1 = tool('t1');
    const mid = text('Here is the answer so far.');
    const r2 = reasoning('second thought');
    const t2 = tool('t2');

    const segs = splitPartsIntoSegments([r1, t1, mid, r2, t2]);

    expect(segs).toEqual([
      { kind: 'chain', parts: [r1, t1] },
      { kind: 'text', text: 'Here is the answer so far.' },
      { kind: 'chain', parts: [r2, t2] },
    ]);
  });

  it('[text, reasoning] → 1 text, 1 chain (text first)', () => {
    const segs = splitPartsIntoSegments([text('Let me check.'), reasoning('thinking')]);
    expect(segs).toEqual([
      { kind: 'text', text: 'Let me check.' },
      { kind: 'chain', parts: [reasoning('thinking')] },
    ]);
  });

  it('[reasoning, text, tool] → chain, text, chain (trailing tool is NOT tools-inline)', () => {
    /*
     * v2 rule: trailing tools (no text after) are CHAIN, not tools-inline.
     * The user wants any consecutive non-text run to be a collapsible chain
     * unless it's sandwiched between two text responses.
     */
    const r = reasoning('thinking');
    const t = text('intermediate text');
    const tl = tool('t1');

    const segs = splitPartsIntoSegments([r, t, tl]);

    expect(segs).toEqual([
      { kind: 'chain', parts: [r] },
      { kind: 'text', text: 'intermediate text' },
      { kind: 'chain', parts: [tl] },
    ]);
  });

  it('[tool] alone → chain (collapsible, even without reasoning)', () => {
    /*
     * v2 rule: a lone tool at the start of a message is a CHAIN, not
     * tools-inline. v1 incorrectly demoted this to `tools`. The user
     * explicitly wants any consecutive non-text run to be collapsible
     * unless sandwiched between two texts.
     */
    const segs = splitPartsIntoSegments([tool('t1')]);
    expect(segs).toEqual([{ kind: 'chain', parts: [tool('t1')] }]);
  });

  it('[tool, tool, tool] → single chain (multiple tools, no reasoning, not sandwiched)', () => {
    const t1 = tool('t1');
    const t2 = tool('t2');
    const t3 = tool('t3');

    const segs = splitPartsIntoSegments([t1, t2, t3]);

    expect(segs).toEqual([{ kind: 'chain', parts: [t1, t2, t3] }]);
  });

  it('[text, tool, text] → text, tools, text (user concern: tool between responses)', () => {
    /*
     * The ONLY case where a run becomes `tools` (inline, non-collapsible):
     * sandwiched between two text segments.
     */
    const segs = splitPartsIntoSegments([text('first response'), tool('t1'), text('second response')]);
    expect(segs).toEqual([
      { kind: 'text', text: 'first response' },
      { kind: 'tools', parts: [tool('t1')] },
      { kind: 'text', text: 'second response' },
    ]);
  });

  it('[tool, text, reasoning, tool] → chain, text, chain (lone tool at start is CHAIN)', () => {
    /*
     * v2: leading tool is CHAIN, not tools-inline. Only sandwiched runs
     * are tools-inline.
     */
    const segs = splitPartsIntoSegments([tool('t1'), text('ok'), reasoning('th'), tool('t2')]);
    expect(segs).toEqual([
      { kind: 'chain', parts: [tool('t1')] },
      { kind: 'text', text: 'ok' },
      { kind: 'chain', parts: [reasoning('th'), tool('t2')] },
    ]);
  });

  it('[text, tool] → text, chain (trailing tool is CHAIN, not tools-inline)', () => {
    /*
     * v2: trailing tool (no text after) is CHAIN. Not sandwiched.
     */
    const segs = splitPartsIntoSegments([text('response'), tool('t1')]);
    expect(segs).toEqual([
      { kind: 'text', text: 'response' },
      { kind: 'chain', parts: [tool('t1')] },
    ]);
  });

  it('[tool, text] → chain, text (leading tool is CHAIN, not tools-inline)', () => {
    /*
     * v2: leading tool is CHAIN. Not sandwiched.
     */
    const segs = splitPartsIntoSegments([tool('t1'), text('response')]);
    expect(segs).toEqual([
      { kind: 'chain', parts: [tool('t1')] },
      { kind: 'text', text: 'response' },
    ]);
  });

  it('[tool, tool, tool, tool, reasoning, response] → ONE collapsible chain (user example)', () => {
    /*
     * The user's exact example from their feedback:
     *   tool, tool, tool, tool, reasoning, response
     * should collapse into ONE chain followed by ONE text response.
     * v1 broke this into tools-inline + chain. v2 keeps it as one chain.
     */
    const t1 = tool('t1');
    const t2 = tool('t2');
    const t3 = tool('t3');
    const t4 = tool('t4');
    const r = reasoning('thinking');
    const txt = text('the final answer');

    const segs = splitPartsIntoSegments([t1, t2, t3, t4, r, txt]);

    expect(segs).toEqual([
      { kind: 'chain', parts: [t1, t2, t3, t4, r] },
      { kind: 'text', text: 'the final answer' },
    ]);
  });

  it('[text, tool, tool, text, tool, text] → text, tools, text, tools, text', () => {
    /*
     * Multiple sandwiched tool runs: each sandwiched run is its own
     * `tools` segment.
     */
    const segs = splitPartsIntoSegments([
      text('a'),
      tool('t1'),
      tool('t2'),
      text('b'),
      tool('t3'),
      text('c'),
    ]);

    expect(segs).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'tools', parts: [tool('t1'), tool('t2')] },
      { kind: 'text', text: 'b' },
      { kind: 'tools', parts: [tool('t3')] },
      { kind: 'text', text: 'c' },
    ]);
  });

  it('empty/whitespace text parts are skipped (no phantom text segment)', () => {
    const segs = splitPartsIntoSegments([
      reasoning('thinking'),
      text(''),
      text('   '),
      text('\n'),
      reasoning('more thinking'),
    ]);

    expect(segs).toEqual([{ kind: 'chain', parts: [reasoning('thinking'), reasoning('more thinking')] }]);
  });

  it('preserves chain continuity across consecutive reasoning parts (no split)', () => {
    const r1 = reasoning('first');
    const r2 = reasoning('second');
    const r3 = reasoning('third');

    const segs = splitPartsIntoSegments([r1, r2, r3]);

    expect(segs).toEqual([{ kind: 'chain', parts: [r1, r2, r3] }]);
  });

  it('step-start closes the current chain silently (no text segment emitted)', () => {
    const segs = splitPartsIntoSegments([reasoning('first'), stepStart(), reasoning('second')]);
    expect(segs).toEqual([
      { kind: 'chain', parts: [reasoning('first')] },
      { kind: 'chain', parts: [reasoning('second')] },
    ]);
  });

  it('step-start does NOT count as text neighbor for sandwich rule', () => {
    /*
     * [text, tool, step-start, tool] → text, chain (the step-start breaks
     * the run, but neither half is sandwiched between two TEXT segments,
     * so both halves become chain). Actually: text → tool is a run after
     * text; then step-start breaks; then tool is another run. The first
     * run is between text and step-start (not text-text), so it's chain.
     * The second run is after a step-start with no text after, so it's
     * chain. Result: text, chain, chain.
     */
    const segs = splitPartsIntoSegments([text('a'), tool('t1'), stepStart(), tool('t2')]);
    expect(segs).toEqual([
      { kind: 'text', text: 'a' },
      { kind: 'chain', parts: [tool('t1')] },
      { kind: 'chain', parts: [tool('t2')] },
    ]);
  });

  it('legacy v4 tool-invocation parts are handled (no crash, classified as tool)', () => {
    const segs = splitPartsIntoSegments([legacyTool('t1')]);
    expect(segs?.length).toBe(1);
    expect(segs?.[0].kind).toBe('chain');
  });

  it('mixed v7 and v4 tool parts work in the same segment', () => {
    const segs = splitPartsIntoSegments([reasoning('th'), tool('t1'), legacyTool('t2')]);
    expect(segs).toEqual([{ kind: 'chain', parts: [reasoning('th'), tool('t1'), legacyTool('t2')] }]);
  });
});

describe('hasChainSegment', () => {
  it('returns false for undefined', () => {
    expect(hasChainSegment(undefined)).toBe(false);
  });

  it('returns false when only tools-inline + text segments exist (no chain)', () => {
    /*
     * The only way to have NO chain segment is the fully-sandwiched case:
     * text, tools, text. Everything else has at least one chain.
     */
    const segs = splitPartsIntoSegments([text('a'), tool('t1'), text('b')]);
    expect(hasChainSegment(segs)).toBe(false);
  });

  it('returns true when at least one chain segment exists', () => {
    const segs = splitPartsIntoSegments([text('hi'), reasoning('th')]);
    expect(hasChainSegment(segs)).toBe(true);
  });

  it('returns true for a lone tool (chain in v2)', () => {
    const segs = splitPartsIntoSegments([tool('t1')]);
    expect(hasChainSegment(segs)).toBe(true);
  });
});

describe('collectAllToolParts', () => {
  it('returns empty array for undefined', () => {
    expect(collectAllToolParts(undefined)).toEqual([]);
  });

  it('collects tools from both chain and tools segments', () => {
    const t1 = tool('t1');
    const t2 = tool('t2');
    const t3 = tool('t3');

    const segs = splitPartsIntoSegments([reasoning('th'), t1, text('mid'), t2, t3]);
    expect(segs).toBeDefined();

    const all = collectAllToolParts(segs);
    expect(all.length).toBe(3);
    expect(all).toContainEqual(t1);
    expect(all).toContainEqual(t2);
    expect(all).toContainEqual(t3);
  });
});

describe('concatTextSegments', () => {
  it('returns empty string for undefined', () => {
    expect(concatTextSegments(undefined)).toBe('');
  });

  it('joins text segments in stream order', () => {
    const segs = splitPartsIntoSegments([text('a'), reasoning('th'), text('b'), text('c')]);
    expect(concatTextSegments(segs)).toBe('abc');
  });

  it('returns empty string when no text segments exist', () => {
    const segs = splitPartsIntoSegments([reasoning('th'), tool('t1')]);
    expect(concatTextSegments(segs)).toBe('');
  });
});
