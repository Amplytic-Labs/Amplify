import { describe, expect, it } from 'vitest';
import {
  isFileMutationSignal,
  parseFileMutationSignal,
  buildNativeTools,
  type NativeFileMap,
} from './nativeTools';

const WORK_DIR = '/home/project';

function makeFileMap(files: Record<string, string>): NativeFileMap {
  const map: NativeFileMap = {};

  for (const [path, content] of Object.entries(files)) {
    map[`${WORK_DIR}/${path}`] = { type: 'file', content, isBinary: false };
  }

  return map;
}

describe('isFileMutationSignal', () => {
  it('should return false for non-string values', () => {
    expect(isFileMutationSignal(null)).toBe(false);
    expect(isFileMutationSignal(undefined)).toBe(false);
    expect(isFileMutationSignal({ foo: 'bar' })).toBe(false);
    expect(isFileMutationSignal(42)).toBe(false);
  });

  it('should return false for strings that do not contain the signal marker', () => {
    expect(isFileMutationSignal('hello world')).toBe(false);
    expect(isFileMutationSignal('{"type":"other"}')).toBe(false);
    expect(isFileMutationSignal('File not found: foo.ts')).toBe(false);
  });

  it('should return false for malformed JSON containing the marker', () => {
    expect(isFileMutationSignal('open_claude_file_mutation not json')).toBe(false);
    expect(isFileMutationSignal('{open_claude_file_mutation')).toBe(false);
  });

  it('should return true for a valid mutation signal JSON string', () => {
    const signal = JSON.stringify({
      type: 'open_claude_file_mutation',
      operations: [{ op: 'create', filePath: 'foo.ts', content: 'export const x = 1;' }],
    });
    expect(isFileMutationSignal(signal)).toBe(true);
  });
});

describe('parseFileMutationSignal', () => {
  it('should return null for invalid JSON', () => {
    expect(parseFileMutationSignal('not json')).toBeNull();
  });

  it('should return null for valid JSON that is not a mutation signal', () => {
    expect(parseFileMutationSignal('{"type":"other"}')).toBeNull();
    expect(parseFileMutationSignal('{"type":"open_claude_file_mutation"}')).toBeNull(); // missing operations
    expect(parseFileMutationSignal('{"operations":[]}')).toBeNull(); // missing type
  });

  it('should parse a create operation', () => {
    const signal = JSON.stringify({
      type: 'open_claude_file_mutation',
      operations: [{ op: 'create', filePath: 'src/foo.ts', content: 'hello' }],
    });
    const parsed = parseFileMutationSignal(signal);

    expect(parsed).not.toBeNull();
    expect(parsed?.type).toBe('open_claude_file_mutation');
    expect(parsed?.operations).toHaveLength(1);
    expect(parsed?.operations[0]).toEqual({ op: 'create', filePath: 'src/foo.ts', content: 'hello' });
  });

  it('should parse a multi_replace operation with multiple edits', () => {
    const signal = JSON.stringify({
      type: 'open_claude_file_mutation',
      operations: [
        {
          op: 'multi_replace',
          filePath: 'src/foo.ts',
          edits: [
            { oldString: 'a', newString: 'b' },
            { oldString: 'c', newString: 'd' },
          ],
        },
      ],
    });
    const parsed = parseFileMutationSignal(signal);

    expect(parsed?.operations[0].op).toBe('multi_replace');
    if (parsed?.operations[0].op === 'multi_replace') {
      expect(parsed.operations[0].edits).toHaveLength(2);
    }
  });
});

describe('native tools — read_file', () => {
  const tools = buildNativeTools();
  const readFile = tools.read_file;

  it('should return file not found when the file is missing', async () => {
    const result = await readFile.execute({ filePath: 'missing.ts' }, { files: makeFileMap({}) });
    expect(result).toContain('File not found');
  });

  it('should return file contents with line numbers when the file exists', async () => {
    const files = makeFileMap({ 'app.ts': 'line one\nline two\nline three' });
    const result = await readFile.execute({ filePath: 'app.ts' }, { files });

    expect(result).toContain('app.ts');
    expect(result).toContain('line one');
    expect(result).toContain('line two');
    expect(result).toContain('line three');
    // Line numbers are 1-indexed and padded
    expect(result).toMatch(/\s*1: line one/);
  });

  it('should accept absolute paths starting with /home/project', async () => {
    const files = makeFileMap({ 'app.ts': 'content' });
    const result = await readFile.execute({ filePath: '/home/project/app.ts' }, { files });
    expect(result).toContain('content');
  });

  it('should respect offset and limit', async () => {
    const files = makeFileMap({ 'app.ts': 'l1\nl2\nl3\nl4\nl5' });
    const result = await readFile.execute({ filePath: 'app.ts', offset: 2, limit: 2 }, { files });

    expect(result).toContain('l2');
    expect(result).toContain('l3');
    expect(result).not.toContain('l1');
    expect(result).not.toContain('l4');
  });
});

describe('native tools — list_dir', () => {
  const tools = buildNativeTools();

  it('should list files and folders at the root', async () => {
    const files = makeFileMap({
      'package.json': '{}',
      'src/index.ts': '',
      'src/utils/helpers.ts': '',
      'README.md': '',
    });
    const result = await tools.list_dir.execute({ path: '' }, { files });

    expect(result).toContain('package.json');
    expect(result).toContain('README.md');
    expect(result).toContain('[dir] src');
  });

  it('should list contents of a subdirectory', async () => {
    const files = makeFileMap({
      'src/index.ts': '',
      'src/utils/helpers.ts': '',
      'src/utils/math.ts': '',
      'README.md': '',
    });
    const result = await tools.list_dir.execute({ path: 'src' }, { files });

    expect(result).toContain('index.ts');
    expect(result).toContain('[dir] utils');
    expect(result).not.toContain('README.md');
  });

  it('should report empty/missing dir gracefully', async () => {
    const result = await tools.list_dir.execute({ path: 'nope' }, { files: makeFileMap({}) });
    expect(result).toContain('empty or does not exist');
  });
});

describe('native tools — find_files (glob)', () => {
  const tools = buildNativeTools();

  it('should match a simple extension glob', async () => {
    const files = makeFileMap({
      'a.ts': '',
      'b.ts': '',
      'c.tsx': '',
      'd.md': '',
    });
    const result = await tools.find_files.execute({ pattern: '*.ts' }, { files });

    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('c.tsx');
    expect(result).not.toContain('d.md');
  });

  it('should support ** glob for nested paths', async () => {
    const files = makeFileMap({
      'src/a.ts': '',
      'src/sub/b.ts': '',
      'src/sub/deep/c.ts': '',
      'other/d.ts': '',
    });
    const result = await tools.find_files.execute({ pattern: '**/*.ts' }, { files });

    expect(result).toContain('src/a.ts');
    expect(result).toContain('src/sub/b.ts');
    expect(result).toContain('src/sub/deep/c.ts');
    expect(result).toContain('other/d.ts');
  });

  it('should report when no files match', async () => {
    const files = makeFileMap({ 'a.ts': '' });
    const result = await tools.find_files.execute({ pattern: '*.py' }, { files });
    expect(result).toContain('No files matched');
  });
});

describe('native tools — grep_search', () => {
  const tools = buildNativeTools();

  it('should find literal matches with file and line number', async () => {
    const files = makeFileMap({
      'a.ts': 'const x = 1;\nconst y = 2;\n',
      'b.ts': 'const z = 3;\n',
    });
    const result = await tools.grep_search.execute({ pattern: 'const' }, { files });

    expect(result).toContain('a.ts:1');
    expect(result).toContain('a.ts:2');
    expect(result).toContain('b.ts:1');
  });

  it('should support regex patterns when isRegex is true', async () => {
    const files = makeFileMap({
      'a.ts': 'foo123bar\nfoo456bar\nbaz\n',
    });
    const result = await tools.grep_search.execute({ pattern: 'foo\\d+bar', isRegex: true }, { files });

    expect(result).toContain('a.ts:1');
    expect(result).toContain('a.ts:2');
    expect(result).not.toContain('baz');
  });

  it('should be case-insensitive when caseSensitive is false', async () => {
    const files = makeFileMap({ 'a.ts': 'Hello\nHELLO\nhello\n' });
    const result = await tools.grep_search.execute(
      { pattern: 'hello', caseSensitive: false },
      { files },
    );

    // All three lines should match
    const matches = (result.match(/a\.ts:\d+/g) || []).length;
    expect(matches).toBe(3);
  });

  it('should respect includePattern to limit files searched', async () => {
    const files = makeFileMap({
      'a.ts': 'match\n',
      'b.ts': 'match\n',
      'c.md': 'match\n',
    });
    const result = await tools.grep_search.execute(
      { pattern: 'match', includePattern: '*.ts' },
      { files },
    );

    expect(result).toContain('a.ts');
    expect(result).toContain('b.ts');
    expect(result).not.toContain('c.md');
  });

  it('should report when no matches are found', async () => {
    const files = makeFileMap({ 'a.ts': 'foo' });
    const result = await tools.grep_search.execute({ pattern: 'nothing' }, { files });
    expect(result).toContain('No matches');
  });

  it('should handle invalid regex gracefully', async () => {
    const files = makeFileMap({ 'a.ts': 'foo' });
    const result = await tools.grep_search.execute({ pattern: '[', isRegex: true }, { files });
    expect(result).toContain('Invalid pattern');
  });
});

describe('native tools — replace_string_in_file', () => {
  const tools = buildNativeTools();

  it('should fail when the file does not exist', async () => {
    const result = await tools.replace_string_in_file.execute(
      { filePath: 'missing.ts', oldString: 'a', newString: 'b' },
      { files: makeFileMap({}) },
    );
    expect(result).toContain('File not found');
  });

  it('should fail when oldString is not present', async () => {
    const files = makeFileMap({ 'a.ts': 'hello world' });
    const result = await tools.replace_string_in_file.execute(
      { filePath: 'a.ts', oldString: 'nonexistent', newString: 'whatever' },
      { files },
    );
    expect(result).toContain('oldString not found');
  });

  it('should fail when oldString matches multiple times', async () => {
    const files = makeFileMap({ 'a.ts': 'foo foo foo' });
    const result = await tools.replace_string_in_file.execute(
      { filePath: 'a.ts', oldString: 'foo', newString: 'bar' },
      { files },
    );
    expect(result).toContain('matched 3 times');
  });

  it('should return a mutation signal when oldString is unique', async () => {
    const files = makeFileMap({ 'a.ts': 'hello world' });
    const result = await tools.replace_string_in_file.execute(
      { filePath: 'a.ts', oldString: 'hello', newString: 'goodbye' },
      { files },
    );

    expect(isFileMutationSignal(result)).toBe(true);
    const parsed = parseFileMutationSignal(result);

    expect(parsed?.operations).toHaveLength(1);
    expect(parsed?.operations[0].op).toBe('replace');
  });
});

describe('native tools — multi_replace_string_in_file', () => {
  const tools = buildNativeTools();

  it('should fail if any edit has a non-unique oldString', async () => {
    const files = makeFileMap({ 'a.ts': 'foo foo bar' });
    const result = await tools.multi_replace_string_in_file.execute(
      {
        filePath: 'a.ts',
        edits: [
          { oldString: 'foo', newString: 'x' }, // matches multiple
          { oldString: 'bar', newString: 'y' },
        ],
      },
      { files },
    );

    expect(result).toContain('Edit #1 failed');
    expect(result).toContain('matched 2 times');
  });

  it('should return a multi_replace mutation signal when all edits are valid', async () => {
    const files = makeFileMap({ 'a.ts': 'one two three' });
    const result = await tools.multi_replace_string_in_file.execute(
      {
        filePath: 'a.ts',
        edits: [
          { oldString: 'one', newString: '1' },
          { oldString: 'two', newString: '2' },
        ],
      },
      { files },
    );

    expect(isFileMutationSignal(result)).toBe(true);
    const parsed = parseFileMutationSignal(result);

    expect(parsed?.operations[0].op).toBe('multi_replace');
    if (parsed?.operations[0].op === 'multi_replace') {
      expect(parsed.operations[0].edits).toHaveLength(2);
    }
  });
});

describe('native tools — create_file', () => {
  const tools = buildNativeTools();

  it('should fail if the file already exists', async () => {
    const files = makeFileMap({ 'a.ts': 'existing' });
    const result = await tools.create_file.execute(
      { filePath: 'a.ts', content: 'new' },
      { files },
    );
    expect(result).toContain('already exists');
  });

  it('should return a create mutation signal when the file does not exist', async () => {
    const result = await tools.create_file.execute(
      { filePath: 'new.ts', content: 'export const x = 1;' },
      { files: makeFileMap({}) },
    );

    expect(isFileMutationSignal(result)).toBe(true);
    const parsed = parseFileMutationSignal(result);

    expect(parsed?.operations).toHaveLength(1);
    expect(parsed?.operations[0].op).toBe('create');
  });
});
