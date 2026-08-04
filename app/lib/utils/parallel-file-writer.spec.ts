import { describe, it, expect, vi, beforeEach } from 'vitest';

/*
 * Unit tests for the parallel-file-writer helper logic.
 *
 * We do NOT test the actual WebContainer FS (it requires a browser
 * environment with COOP/COEP headers to boot). Instead we mock the
 * `webcontainer` Promise and verify:
 *   - writeFilesParallel calls fs.writeFile with the right paths/contents
 *   - mkdir dedup works correctly
 *   - concurrency limit is respected (no more than N in-flight writes)
 *   - progress callback fires correctly
 *   - failed writes are collected, not thrown
 *   - fileMapToWriteTasks converts the workbench FileMap shape correctly
 */

/*
 * Mock the webcontainer module BEFORE importing the writer.
 * vi.hoisted ensures the fake FS is available to the mock factory.
 */
const { fakeFs } = vi.hoisted(() => ({
  fakeFs: {
    mkdir: vi.fn<(args: any[]) => Promise<any>>(async () => undefined),
    writeFile: vi.fn<(args: any[]) => Promise<any>>(async () => undefined),
  },
}));

vi.mock('~/lib/webcontainer', () => ({
  webcontainer: Promise.resolve({ fs: fakeFs }),
}));

// Import after mock is in place.
import { writeFilesParallel, fileMapToWriteTasks } from './parallel-file-writer';

// Helper to reset mock call counts between tests.
beforeEach(() => {
  fakeFs.mkdir.mockClear();
  fakeFs.writeFile.mockClear();
});

describe('writeFilesParallel', () => {
  it('returns empty progress for empty task list', async () => {
    const result = await writeFilesParallel([]);

    expect(result).toEqual({ done: 0, total: 0, failed: [] });
    expect(fakeFs.writeFile).not.toHaveBeenCalled();
    expect(fakeFs.mkdir).not.toHaveBeenCalled();
  });

  it('writes all files and reports done count', async () => {
    const tasks = [
      { path: 'src/a.ts', content: 'a' },
      { path: 'src/b.ts', content: 'b' },
      { path: 'src/c.ts', content: 'c' },
    ];

    const result = await writeFilesParallel(tasks, { concurrency: 2 });

    expect(result.done).toBe(3);
    expect(result.total).toBe(3);
    expect(result.failed).toEqual([]);
    expect(fakeFs.writeFile).toHaveBeenCalledTimes(3);

    // Verify each file was written with the correct args.
    const writeCalls = fakeFs.writeFile.mock.calls;
    const paths = writeCalls.map((c: any[]) => c[0]).sort();
    expect(paths).toEqual(['src/a.ts', 'src/b.ts', 'src/c.ts']);
  });

  it('dedupes parent dirs and calls mkdir once per unique dir', async () => {
    const tasks = [
      { path: 'src/components/Button.tsx', content: 'btn' },
      { path: 'src/components/Input.tsx', content: 'input' },
      { path: 'src/lib/utils.ts', content: 'utils' },
      { path: 'src/lib/helpers.ts', content: 'helpers' },
      { path: 'README.md', content: 'readme' },
    ];

    await writeFilesParallel(tasks, { concurrency: 4 });

    // Unique dirs: src/components, src/lib (README.md has no dir, skipped)
    const mkdirCalls = fakeFs.mkdir.mock.calls;
    const dirs = mkdirCalls.map((c: any[]) => c[0]).sort();
    expect(dirs).toEqual(['src/components', 'src/lib']);
    expect(mkdirCalls.length).toBe(2);
  });

  it('uses recursive: true for mkdir', async () => {
    const tasks = [{ path: 'a/b/c/d.txt', content: 'deep' }];

    await writeFilesParallel(tasks);

    expect(fakeFs.mkdir).toHaveBeenCalledWith('a/b/c', { recursive: true });
  });

  it('respects concurrency limit (no more than N in-flight writes)', async () => {
    // Track in-flight count and peak.
    let inFlight = 0;
    let peak = 0;

    fakeFs.writeFile.mockImplementation(async () => {
      inFlight++;
      peak = Math.max(peak, inFlight);

      // Yield to allow other writes to start.
      await new Promise((r) => setTimeout(r, 5));
      inFlight--;
    });

    const tasks = Array.from({ length: 50 }, (_, i) => ({ path: `f${i}.ts`, content: String(i) }));

    await writeFilesParallel(tasks, { concurrency: 5 });

    expect(peak).toBeLessThanOrEqual(5);
    expect(peak).toBeGreaterThan(1); // Sanity: at least some parallelism happened.
  });

  it('collects failed writes into the failed array instead of throwing', async () => {
    fakeFs.writeFile.mockImplementation(async (path: any) => {
      if (String(path).includes('bad')) {
        throw new Error('disk full');
      }

      return undefined;
    });

    const tasks = [
      { path: 'good1.ts', content: 'a' },
      { path: 'bad1.ts', content: 'b' },
      { path: 'good2.ts', content: 'c' },
      { path: 'bad2.ts', content: 'd' },
    ];

    const result = await writeFilesParallel(tasks, { concurrency: 2 });

    expect(result.done).toBe(2);
    expect(result.total).toBe(4);
    expect(result.failed.length).toBe(2);
    expect(result.failed.map((f) => f.path).sort()).toEqual(['bad1.ts', 'bad2.ts']);
    expect(result.failed[0].error).toBe('disk full');
  });

  it('fires onProgress callback after each file completes', async () => {
    const tasks = [
      { path: 'a.ts', content: 'a' },
      { path: 'b.ts', content: 'b' },
      { path: 'c.ts', content: 'c' },
    ];

    const progressCalls: number[] = [];
    await writeFilesParallel(tasks, {
      concurrency: 1,
      onProgress: (p) => progressCalls.push(p.done),
    });

    // With concurrency 1, writes happen in order: done goes 1, 2, 3.
    expect(progressCalls).toEqual([1, 2, 3]);
  });

  it('replaces empty string content with a single space (WC quirk)', async () => {
    const tasks = [{ path: 'empty.txt', content: '' }];

    await writeFilesParallel(tasks);

    expect(fakeFs.writeFile).toHaveBeenCalledWith('empty.txt', ' ');
  });

  it('passes Uint8Array content through without space substitution', async () => {
    const binary = new Uint8Array([1, 2, 3]);
    const tasks = [{ path: 'bin.dat', content: binary }];

    await writeFilesParallel(tasks);

    expect(fakeFs.writeFile).toHaveBeenCalledWith('bin.dat', binary);
  });
});

describe('fileMapToWriteTasks', () => {
  it('converts FileMap entries to WriteTasks with relative paths', () => {
    const workdir = '/home/webcontainer/project';
    const fileMap = {
      [`${workdir}/src/index.ts`]: { type: 'file', content: 'export const x = 1;' },
      [`${workdir}/README.md`]: { type: 'file', content: '# Hello' },
    };

    const tasks = fileMapToWriteTasks(fileMap, workdir);

    expect(tasks).toHaveLength(2);
    expect(tasks.map((t) => t.path).sort()).toEqual(['README.md', 'src/index.ts']);
    expect(tasks.find((t) => t.path === 'src/index.ts')?.content).toBe('export const x = 1;');
  });

  it('skips folder entries (folders are created implicitly by mkdir)', () => {
    const workdir = '/workdir';
    const fileMap = {
      [`${workdir}/src`]: { type: 'folder' },
      [`${workdir}/src/index.ts`]: { type: 'file', content: 'x' },
    };

    const tasks = fileMapToWriteTasks(fileMap, workdir);

    expect(tasks).toHaveLength(1);
    expect(tasks[0].path).toBe('src/index.ts');
  });

  it('handles paths that are already relative (no workdir prefix)', () => {
    const tasks = fileMapToWriteTasks(
      {
        'src/a.ts': { type: 'file', content: 'a' },
      },
      '/workdir',
    );

    expect(tasks).toHaveLength(1);
    expect(tasks[0].path).toBe('src/a.ts');
  });

  it('skips entries with empty paths after stripping workdir', () => {
    const tasks = fileMapToWriteTasks(
      {
        '/workdir': { type: 'file', content: 'oops' },
      },
      '/workdir',
    );

    expect(tasks).toHaveLength(0);
  });

  it('passes through isBinary flag via encoding hint', () => {
    const tasks = fileMapToWriteTasks(
      {
        '/workdir/data.bin': { type: 'file', content: 'base64data', isBinary: true },
        '/workdir/text.txt': { type: 'file', content: 'hello', isBinary: false },
      },
      '/workdir',
    );

    expect(tasks).toHaveLength(2);

    const bin = tasks.find((t) => t.path === 'data.bin');
    const txt = tasks.find((t) => t.path === 'text.txt');
    expect(bin?.encoding).toBeUndefined(); // binary files don't pass encoding
    expect(txt?.encoding).toBe('utf8');
  });
});
