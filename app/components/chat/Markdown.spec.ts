import { describe, expect, it } from 'vitest';
import { stripCodeFenceFromArtifact, transformThoughtBlocks } from './Markdown';

describe('stripCodeFenceFromArtifact', () => {
  it('should remove code fences around artifact element', () => {
    const input = "```xml\n<div class='__boltArtifact__'></div>\n```";
    const expected = "\n<div class='__boltArtifact__'></div>\n";
    expect(stripCodeFenceFromArtifact(input)).toBe(expected);
  });

  it('should handle code fence with language specification', () => {
    const input = "```typescript\n<div class='__boltArtifact__'></div>\n```";
    const expected = "\n<div class='__boltArtifact__'></div>\n";
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
    const input = "<div class='__boltArtifact__'></div>";
    expect(stripCodeFenceFromArtifact(input)).toBe(input);
  });

  it('should handle multiple artifacts but only remove fences around them', () => {
    const input = [
      'Some text',
      '```typescript',
      "<div class='__boltArtifact__'></div>",
      '```',
      '```',
      'regular code',
      '```',
    ].join('\n');

    const expected = ['Some text', '', "<div class='__boltArtifact__'></div>", '', '```', 'regular code', '```'].join(
      '\n',
    );

    expect(stripCodeFenceFromArtifact(input)).toBe(expected);
  });
});

describe('transformThoughtBlocks', () => {
  it('should leave content without <thought> unchanged', () => {
    const input = 'Hello world, this is a normal answer.';
    expect(transformThoughtBlocks(input)).toBe(input);
  });

  it('should leave empty input unchanged', () => {
    expect(transformThoughtBlocks('')).toBe('');
  });

  it('should transform a complete <thought>...</thought> block into a details element', () => {
    const input = '<thought>I should think about this.</thought>';
    const out = transformThoughtBlocks(input);

    expect(out).toContain('<details class="__boltThought__">');
    expect(out).toContain('<summary>Thought process</summary>');
    expect(out).toContain('I should think about this.');
    expect(out).toContain('</details>');
    // The original <thought> tag should not survive
    expect(out).not.toMatch(/<thought>/);
  });

  it('should preserve content before and after the thought block', () => {
    const input = 'Before.\n<thought>reasoning here</thought>\nAfter.';
    const out = transformThoughtBlocks(input);

    expect(out).toContain('Before.');
    expect(out).toContain('After.');
    expect(out).toContain('reasoning here');
  });

  it('should handle multiple thought blocks in the same message', () => {
    const input = '<thought>step 1</thought> middle <thought>step 2</thought>';
    const out = transformThoughtBlocks(input);

    const detailsCount = (out.match(/<details class="__boltThought__">/g) || []).length;
    expect(detailsCount).toBe(2);
    expect(out).toContain('step 1');
    expect(out).toContain('step 2');
  });

  it('should handle multi-line thought blocks (streamed reasoning)', () => {
    const input = '<thought>\nLine 1\nLine 2\nLine 3\n</thought>';
    const out = transformThoughtBlocks(input);

    expect(out).toContain('Line 1');
    expect(out).toContain('Line 2');
    expect(out).toContain('Line 3');
    expect(out).toContain('</details>');
  });

  it('should handle a streaming partial <thought> with no closing tag', () => {
    const input = '<thought>partial reasoning so far';
    const out = transformThoughtBlocks(input);

    // Should render as an OPEN details element so the user sees live CoT
    expect(out).toContain('<details class="__boltThought__" open>');
    expect(out).toContain('partial reasoning so far');
    expect(out).not.toMatch(/<thought>/);
  });

  it('should not be confused by <thought> appearing inside a code fence', () => {
    // We don't strip code fences here — that's the job of stripCodeFenceFromArtifact.
    // The transformer just looks for the literal <thought> tag. This test documents
    // that behaviour so future refactors are aware of it.
    const input = '```\n<thought>not really a thought, just code</thought>\n```';
    const out = transformThoughtBlocks(input);

    // The transformer is a string-level preprocessor; it WILL transform inside
    // code fences. This is an acceptable trade-off because the AI is instructed
    // not to emit <thought> inside code, and the alternative (a full markdown
    // AST walker) is significantly more complex.
    expect(out).toContain('<details class="__boltThought__">');
  });
});
