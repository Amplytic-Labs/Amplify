import { describe, expect, it, vi, beforeEach } from 'vitest';
import { StreamingMessageParser, type ActionCallback, type ArtifactCallback } from './message-parser';
import { EnhancedStreamingMessageParser } from './enhanced-message-parser';

interface ExpectedResult {
  output: string;
  callbacks?: {
    onArtifactOpen?: number;
    onArtifactClose?: number;
    onActionOpen?: number;
    onActionClose?: number;
  };
}

describe('StreamingMessageParser', () => {
  it('should pass through normal text', () => {
    const parser = new StreamingMessageParser();
    expect(parser.parse('test_id', 'Hello, world!')).toBe('Hello, world!');
  });

  it('should allow normal HTML tags', () => {
    const parser = new StreamingMessageParser();
    expect(parser.parse('test_id', 'Hello <strong>world</strong>!')).toBe('Hello <strong>world</strong>!');
  });

  describe('no artifacts', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar', 'Foo bar'],
      ['Foo bar <', 'Foo bar '],
      ['Foo bar <p', 'Foo bar <p'],
      [['Foo bar <', 's', 'p', 'an>some text</span>'], 'Foo bar <span>some text</span>'],
    ])('should correctly parse chunks and strip out amplify artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('invalid or incomplete artifacts', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      ['Foo bar <a', 'Foo bar '],
      ['Foo bar <am', 'Foo bar '],
      ['Foo bar <ampl', 'Foo bar '],
      ['Foo bar <ampli', 'Foo bar '],
      ['Foo bar <amplif', 'Foo bar '],
      ['Foo bar <amplifyA', 'Foo bar '],
      ['Foo bar <amplifyArtifacs></amplifyArtifact>', 'Foo bar <amplifyArtifacs></amplifyArtifact>'],
      ['Before <oltArtfiact>foo</amplifyArtifact> After', 'Before <oltArtfiact>foo</amplifyArtifact> After'],
      ['Before <amplifyArtifactt>foo</amplifyArtifact> After', 'Before <amplifyArtifactt>foo</amplifyArtifact> After'],
    ])('should correctly parse chunks and strip out amplify artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('valid artifacts without actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Some text before <amplifyArtifact title="Some title" id="artifact_1">foo bar</amplifyArtifact> Some more text',
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <amplifyArti',
          'fact',
          ' title="Some title" id="artifact_1" type="bundled" >foo</amplifyArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <amplifyArti',
          'fac',
          't title="Some title" id="artifact_1"',
          ' ',
          '>',
          'foo</amplifyArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <amplifyArti',
          'fact',
          ' title="Some title" id="artifact_1"',
          ' >fo',
          'o</amplifyArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <amplifyArti',
          'fact tit',
          'le="Some ',
          'title" id="artifact_1">fo',
          'o',
          '<',
          '/amplifyArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        [
          'Some text before <amplifyArti',
          'fact title="Some title" id="artif',
          'act_1">fo',
          'o<',
          '/amplifyArtifact> Some more text',
        ],
        {
          output: 'Some text before  Some more text',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
      [
        'Before <amplifyArtifact title="Some title" id="artifact_1">foo</amplifyArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 0, onActionClose: 0 },
        },
      ],
    ])('should correctly parse chunks and strip out amplify artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });

  describe('valid artifacts with actions', () => {
    it.each<[string | string[], ExpectedResult | string]>([
      [
        'Before <amplifyArtifact title="Some title" id="artifact_1"><amplifyAction type="shell">npm install</amplifyAction></amplifyArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 1, onActionClose: 1 },
        },
      ],
      [
        'Before <amplifyArtifact title="Some title" id="artifact_1"><amplifyAction type="shell">npm install</amplifyAction><amplifyAction type="file" filePath="index.js">some content</amplifyAction></amplifyArtifact> After',
        {
          output: 'Before  After',
          callbacks: { onArtifactOpen: 1, onArtifactClose: 1, onActionOpen: 2, onActionClose: 2 },
        },
      ],
    ])('should correctly parse chunks and strip out amplify artifacts (%#)', (input, expected) => {
      runTest(input, expected);
    });
  });
});

describe('EnhancedStreamingMessageParser', () => {
  /*
   * Auto-detection of code blocks / shell commands was intentionally
   * removed in commit 7b9631d (2026-08-02). The enhanced parser is now
   * a thin wrapper around StreamingMessageParser and only emits
   * artifact/action callbacks for EXPLICIT <amplifyArtifact> tags.
   *
   * Plain markdown code blocks (```bash, ```javascript, etc.) are
   * passed through as regular text — the AI uses them to show code
   * to the user, not to trigger execution. The AI uses explicit
   * <amplifyArtifact><amplifyAction> tags when it wants Amplify to
   * execute or apply content.
   *
   * These tests assert the new behavior: NO auto-detection.
   */

  const makeCallbacks = () => ({
    onArtifactOpen: vi.fn(),
    onArtifactClose: vi.fn(),
    onActionOpen: vi.fn(),
    onActionClose: vi.fn(),
  });

  it('does NOT auto-wrap shell code blocks as actions', () => {
    const callbacks = makeCallbacks();
    const parser = new EnhancedStreamingMessageParser({ callbacks });

    parser.parse('test_shell', '```bash\nnpm install && npm run dev\n```');

    expect(callbacks.onArtifactOpen).not.toHaveBeenCalled();
    expect(callbacks.onActionOpen).not.toHaveBeenCalled();
  });

  it('does NOT auto-wrap file-creation code blocks as artifacts', () => {
    const callbacks = makeCallbacks();
    const parser = new EnhancedStreamingMessageParser({ callbacks });

    parser.parse(
      'test_file',
      'Create a new file called index.js:\n\n```javascript\nfunction hello() {\n  console.log("Hello World");\n}\n```',
    );

    expect(callbacks.onArtifactOpen).not.toHaveBeenCalled();
    expect(callbacks.onActionOpen).not.toHaveBeenCalled();
  });

  it('does NOT auto-wrap "Create file:" patterns', () => {
    const callbacks = makeCallbacks();
    const parser = new EnhancedStreamingMessageParser({ callbacks });

    const fence = '```';
    const inputs = [
      `I'll create a React component.\n\napp/components/Button.tsx:\n\n${fence}tsx\nimport React from 'react';\nexport const Button = () => <button/>;\n${fence}`,
      `Here's config.json:\n\n${fence}json\n{"name": "test"}\n${fence}`,
      `Update app.js:\n\n${fence}javascript\nconst app = express();\n${fence}`,
    ];

    for (let i = 0; i < inputs.length; i++) {
      parser.parse(`test_pattern_${i}`, inputs[i]);
    }

    expect(callbacks.onArtifactOpen).not.toHaveBeenCalled();
    expect(callbacks.onActionOpen).not.toHaveBeenCalled();
  });

  it('does NOT auto-detect shell commands across many styles', () => {
    const callbacks = makeCallbacks();
    const parser = new EnhancedStreamingMessageParser({ callbacks });

    const inputs = [
      '```bash\nnpm install\n```',
      '```bash\ngit clone https://example.com/repo.git\n```',
      '```bash\ndocker build -t myapp .\n```',
      '```bash\nwebcontainer run --preview\n```',
    ];

    for (let i = 0; i < inputs.length; i++) {
      parser.parse(`test_cmd_${i}`, inputs[i]);
    }

    expect(callbacks.onActionOpen).not.toHaveBeenCalled();
  });

  it('handles streaming input without auto-wrapping', () => {
    const callbacks = makeCallbacks();
    const parser = new EnhancedStreamingMessageParser({ callbacks });

    const chunks = [
      'Create the file:\n\n',
      'app.js:\n\n',
      '```javascript\n',
      'const app = ',
      'express();\n',
      'app.listen(3000);\n',
      '```',
    ];

    let fullInput = '';

    for (const chunk of chunks) {
      fullInput += chunk;
      parser.parse('test_stream_1', fullInput);
    }

    expect(callbacks.onArtifactOpen).not.toHaveBeenCalled();
    expect(callbacks.onActionOpen).not.toHaveBeenCalled();
  });

  it('still honors EXPLICIT <amplifyArtifact> tags (regression guard)', () => {
    const callbacks = makeCallbacks();
    const parser = new EnhancedStreamingMessageParser({ callbacks });

    const input =
      'Before <amplifyArtifact title="Some title" id="artifact_1"><amplifyAction type="shell">npm install</amplifyAction></amplifyArtifact> After';
    parser.parse('test_explicit', input);

    expect(callbacks.onArtifactOpen).toHaveBeenCalledTimes(1);
    expect(callbacks.onArtifactClose).toHaveBeenCalledTimes(1);
    expect(callbacks.onActionOpen).toHaveBeenCalledTimes(1);
    expect(callbacks.onActionClose).toHaveBeenCalledTimes(1);
  });

  it('performs well under bulk parsing', () => {
    const enhancedCallbacks = makeCallbacks();
    const enhancedParser = new EnhancedStreamingMessageParser({ callbacks: enhancedCallbacks });

    const fence = '```';
    const testInputs = [
      `Create app.tsx:\n\n${fence}tsx\nimport React from 'react';\nexport const App = () => <div>Hello</div>;\n${fence}`,
      `Run commands:\n\n${fence}bash\nnpm install\nnpm run dev\n${fence}`,
      `Here's config.json:\n\n${fence}json\n{"name": "test"}\n${fence}`,
      `Example code:\n\n${fence}javascript\nfunction example() {}\n${fence}`,
    ];

    const startTime = performance.now();
    const iterations = 100;

    for (let i = 0; i < iterations; i++) {
      for (let j = 0; j < testInputs.length; j++) {
        enhancedParser.parse(`perf_test_${i}_${j}`, testInputs[j]);
      }

      enhancedParser.reset();
    }

    const duration = performance.now() - startTime;
    const avgTimePerOp = duration / (iterations * testInputs.length);

    // Should complete quickly (less than 1ms average per operation)
    expect(avgTimePerOp).toBeLessThan(1.0);

    // No auto-detection — callbacks should NOT fire for plain code blocks.
    expect(enhancedCallbacks.onArtifactOpen).not.toHaveBeenCalled();
    expect(enhancedCallbacks.onActionOpen).not.toHaveBeenCalled();
  });
});

function runTest(input: string | string[], outputOrExpectedResult: string | ExpectedResult) {
  let expected: ExpectedResult;

  if (typeof outputOrExpectedResult === 'string') {
    expected = { output: outputOrExpectedResult };
  } else {
    expected = outputOrExpectedResult;
  }

  const callbacks = {
    onArtifactOpen: vi.fn<ArtifactCallback>((data) => {
      expect(data).toMatchSnapshot('onArtifactOpen');
    }),
    onArtifactClose: vi.fn<ArtifactCallback>((data) => {
      expect(data).toMatchSnapshot('onArtifactClose');
    }),
    onActionOpen: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionOpen');
    }),
    onActionClose: vi.fn<ActionCallback>((data) => {
      expect(data).toMatchSnapshot('onActionClose');
    }),
  };

  const parser = new StreamingMessageParser({
    artifactElement: () => '',
    callbacks,
  });

  let message = '';

  let result = '';

  const chunks = Array.isArray(input) ? input : input.split('');

  for (const chunk of chunks) {
    message += chunk;

    result += parser.parse('message_1', message);
  }

  for (const name in expected.callbacks) {
    const callbackName = name;

    expect(callbacks[callbackName as keyof typeof callbacks]).toHaveBeenCalledTimes(
      expected.callbacks[callbackName as keyof typeof expected.callbacks] ?? 0,
    );
  }

  expect(result).toEqual(expected.output);
}
