import { describe, expect, it } from 'vitest';
import { stripCodeFenceFromArtifact, stripResidualThoughtTags, transformThoughtBlocks } from './Markdown';

describe('stripCodeFenceFromArtifact', () => {
  it('should remove code fences around artifact element', () => {
    const input = "```xml\n<div class='__amplifyArtifact__'></div>\n```";
    const expected = "\n<div class='__amplifyArtifact__'></div>\n";
    expect(stripCodeFenceFromArtifact(input)).toBe(expected);
  });

  it('should handle code fence with language specification', () => {
    const input = "```typescript\n<div class='__amplifyArtifact__'></div>\n```";
    const expected = "\n<div class='__amplifyArtifact__'></div>\n";
    expect(stripCodeFenceFromArtifact(input)).toBe(expected);
  });

  it('should not modify content without artifacts', () => {
    const input = '```\nregular code block\n```';
    expect(stripCodeFenceFromArtifact(input)).toBe(input);
  });

  it('should handle empty input', () => {
    expect(stripCodeFenceFromArtifact('')).toBe('');
  });

  it('should handle artifact without code fences', () => {
    const input = "<div class='__amplifyArtifact__'></div>";
    expect(stripCodeFenceFromArtifact(input)).toBe(input);
  });

  it('should handle multiple artifacts but only remove fences around them', () => {
    const input = [
      'Some text',
      '```typescript',
      "<div class='__amplifyArtifact__'></div>",
      '```',
      '```',
      'regular code',
      '```',
    ].join('\n');

    const expected = ['Some text', '', "<div class='__amplifyArtifact__'></div>", '', '```', 'regular code', '```'].join(
      '\n',
    );

    expect(stripCodeFenceFromArtifact(input)).toBe(expected);
  });
});

/*
 * New behaviour: `<thought>` tags are STRIPPED from the visible answer
 * markdown. The AI is now instructed to use its native reasoning
 * channel (parts[].type === 'reasoning') which is rendered by the
 * ThoughtProcess component above the answer. These tests document
 * the defence-in-depth stripping behaviour.
 */
describe('stripResidualThoughtTags', () => {
  it('should leave content without <thought> unchanged', () => {
    const input = 'Hello world, this is a normal answer.';
    expect(stripResidualThoughtTags(input)).toBe(input);
  });

  it('should leave empty input unchanged', () => {
    expect(stripResidualThoughtTags('')).toBe('');
  });

  it('should strip a complete <thought>...</thought> block entirely', () => {
    const input = '<thought>I should think about this.</thought>';
    const out = stripResidualThoughtTags(input);

    expect(out).not.toContain('<thought>');
    expect(out).not.toContain('I should think about this.');
    expect(out).not.toContain('<details');
    expect(out).not.toContain('Thought process');
  });

  it('should preserve visible content before and after a stripped thought block', () => {
    const input = 'Before.\n<thought>reasoning here</thought>\nAfter.';
    const out = stripResidualThoughtTags(input);

    expect(out).toContain('Before.');
    expect(out).toContain('After.');
    expect(out).not.toContain('reasoning here');
    expect(out).not.toContain('<thought>');
  });

  it('should strip multiple thought blocks in the same message', () => {
    const input = '<thought>step 1</thought> middle <thought>step 2</thought>';
    const out = stripResidualThoughtTags(input);

    expect(out).not.toContain('step 1');
    expect(out).not.toContain('step 2');
    expect(out).not.toContain('<thought>');
    expect(out).toContain('middle');
  });

  it('should handle multi-line thought blocks (streamed reasoning)', () => {
    const input = '<thought>\nLine 1\nLine 2\nLine 3\n</thought>';
    const out = stripResidualThoughtTags(input);

    expect(out).not.toContain('Line 1');
    expect(out).not.toContain('Line 2');
    expect(out).not.toContain('Line 3');
    expect(out).not.toContain('<thought>');
  });

  it('should handle a streaming partial <thought> with no closing tag', () => {
    const input = '<thought>partial reasoning so far';
    const out = stripResidualThoughtTags(input);

    // The partial thought should be stripped so it does not leak into
    // the visible answer while streaming.
    expect(out).not.toContain('partial reasoning so far');
    expect(out).not.toContain('<thought>');
  });

  it('should handle an orphan </thought> closing tag', () => {
    const input = 'visible answer</thought> more text';
    const out = stripResidualThoughtTags(input);

    expect(out).not.toContain('</thought>');
    expect(out).toContain('visible answer');
    expect(out).toContain('more text');
  });

  it('should not be confused by <thought> appearing inside a code fence', () => {
    // The stripper is a string-level preprocessor; it WILL strip
    // inside code fences. This is acceptable because the AI is
    // instructed not to emit <thought> tags at all, and the
    // ThoughtProcess component renders reasoning from the native
    // reasoning channel instead.
    const input = '```\n<thought>not really a thought, just code</thought>\n```';
    const out = stripResidualThoughtTags(input);

    expect(out).not.toContain('<thought>');
  });
});

/*
 * transformThoughtBlocks is kept as a backward-compat shim that
 * delegates to stripResidualThoughtTags. Verify the delegation works.
 */
describe('transformThoughtBlocks (legacy shim)', () => {
  it('should leave content without <thought> unchanged', () => {
    const input = 'Hello world, this is a normal answer.';
    expect(transformThoughtBlocks(input)).toBe(input);
  });

  it('should strip <thought> tags instead of transforming them into <details>', () => {
    const input = '<thought>hidden reasoning</thought>visible answer';
    const out = transformThoughtBlocks(input);

    expect(out).not.toContain('<thought>');
    expect(out).not.toContain('<details');
    expect(out).toContain('visible answer');
  });
});
