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

  it('[reasoning, text, tool] → 2 segments split by text (chain then tools)', () => {
    const r = reasoning('thinking');
    const t = text('intermediate text');
    const tl = tool('t1');

    const segs = splitPartsIntoSegments([r, t, tl]);

    expect(segs).toEqual([
      { kind: 'chain', parts: [r] },
      { kind: 'text', text: 'intermediate text' },
      { kind: 'tools', parts: [tl] },
    ]);
  });

  it('[tool] alone → tools segment (non-reasoning model, NO chain panel)', () => {
    const segs = splitPartsIntoSegments([tool('t1')]);
    expect(segs).toEqual([{ kind: 'tools', parts: [tool('t1')] }]);
  });

  it('[tool, tool, tool] → single tools segment (multiple tools, no reasoning)', () => {
    const t1 = tool('t1');
    const t2 = tool('t2');
    const t3 = tool('t3');

    const segs = splitPartsIntoSegments([t1, t2, t3]);

    expect(segs).toEqual([{ kind: 'tools', parts: [t1, t2, t3] }]);
  });

  it('[text, tool, text] → text, tools, text (user concern: tool between responses)', () => {
    const segs = splitPartsIntoSegments([text('first response'), tool('t1'), text('second response')]);
    expect(segs).toEqual([
      { kind: 'text', text: 'first response' },
      { kind: 'tools', parts: [tool('t1')] },
      { kind: 'text', text: 'second response' },
    ]);
  });

  it('[tool, text, reasoning, tool] → tools, text, chain (lone tool then chain)', () => {
    const segs = splitPartsIntoSegments([tool('t1'), text('ok'), reasoning('th'), tool('t2')]);
    expect(segs).toEqual([
      { kind: 'tools', parts: [tool('t1')] },
      { kind: 'text', text: 'ok' },
      { kind: 'chain', parts: [reasoning('th'), tool('t2')] },
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

  it('legacy v4 tool-invocation parts are handled (no crash, classified as tool)', () => {
    const segs = splitPartsIntoSegments([legacyTool('t1')]);
    expect(segs?.length).toBe(1);
    expect(segs?.[0].kind).toBe('tools');
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

  it('returns false when only tools/text segments exist', () => {
    const segs = splitPartsIntoSegments([tool('t1'), text('hi')]);
    expect(hasChainSegment(segs)).toBe(false);
  });

  it('returns true when at least one chain segment exists', () => {
    const segs = splitPartsIntoSegments([text('hi'), reasoning('th')]);
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
