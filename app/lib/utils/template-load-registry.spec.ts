import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  waitForTemplateLoad,
  resolveTemplateLoad,
  cancelTemplateLoad,
  getTemplateFilesForLoad,
  pendingLoadCount,
} from './template-load-registry';

/*
 * Unit tests for the template-load registry.
 *
 * The registry bridges inject_template.execute (server-side, awaits
 * completion) and the /api/template-loaded route (server-side, signals
 * completion). It's a module-level Map of pending loads keyed by loadId.
 */

// Use fake timers so we can test timeout behavior deterministically.
beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('waitForTemplateLoad + resolveTemplateLoad', () => {
  it('resolves with the progress when resolveTemplateLoad is called', async () => {
    const loadId = 'test-load-1';
    const files = [{ path: 'a.ts', content: 'a' }];

    const promise = waitForTemplateLoad(loadId, files);

    // Resolve immediately.
    const resolved = resolveTemplateLoad(loadId, {
      done: 1,
      total: 1,
      failed: [],
    });

    expect(resolved).toBe(true);

    const progress = await promise;
    expect(progress.loadId).toBe(loadId);
    expect(progress.done).toBe(1);
    expect(progress.total).toBe(1);
    expect(progress.failed).toEqual([]);
    expect(progress.completedAt).toBeTruthy();
  });

  it('resolves with failures when client reports partial failure', async () => {
    const loadId = 'test-load-2';
    const files = [
      { path: 'a.ts', content: 'a' },
      { path: 'b.ts', content: 'b' },
      { path: 'c.ts', content: 'c' },
    ];

    const promise = waitForTemplateLoad(loadId, files);

    resolveTemplateLoad(loadId, {
      done: 2,
      total: 3,
      failed: [{ path: 'c.ts', error: 'ENOENT' }],
    });

    const progress = await promise;
    expect(progress.done).toBe(2);
    expect(progress.total).toBe(3);
    expect(progress.failed).toEqual([{ path: 'c.ts', error: 'ENOENT' }]);
  });

  it('returns false when resolving an unknown loadId', () => {
    const resolved = resolveTemplateLoad('nonexistent', {
      done: 0,
      total: 0,
      failed: [],
    });

    expect(resolved).toBe(false);
  });

  it('returns false when resolving an already-completed load (dedup)', async () => {
    const loadId = 'test-load-3';
    const promise = waitForTemplateLoad(loadId, []);

    const first = resolveTemplateLoad(loadId, { done: 0, total: 0, failed: [] });
    await promise;

    // Second resolve should be a no-op.
    const second = resolveTemplateLoad(loadId, { done: 0, total: 0, failed: [] });

    expect(first).toBe(true);
    expect(second).toBe(false);
  });
});

describe('waitForTemplateLoad timeout', () => {
  it('rejects after the timeout period', async () => {
    const loadId = 'test-timeout';
    const promise = waitForTemplateLoad(loadId, [], 5000);

    // Advance past the timeout.
    vi.advanceTimersByTime(5001);

    await expect(promise).rejects.toThrow('timed out after 5000ms');
  });

  it('does NOT reject if resolved before the timeout', async () => {
    const loadId = 'test-no-timeout';
    const promise = waitForTemplateLoad(loadId, [], 5000);

    // Resolve before the timeout fires.
    resolveTemplateLoad(loadId, { done: 0, total: 0, failed: [] });

    vi.advanceTimersByTime(10000);

    await expect(promise).resolves.toMatchObject({ loadId });
  });
});

describe('cancelTemplateLoad', () => {
  it('cancels a pending load without resolving or rejecting it', async () => {
    const loadId = 'test-cancel';
    const promise = waitForTemplateLoad(loadId, []);

    const cancelled = cancelTemplateLoad(loadId);
    expect(cancelled).toBe(true);

    /*
     * Promise should still be pending after cancel (we removed it from the
     * registry without resolving). Verify by racing with a sentinel.
     */
    const sentinel = Promise.resolve('still-pending');
    const result = await Promise.race([promise, sentinel]);
    expect(result).toBe('still-pending');
  });

  it('returns false for an unknown loadId', () => {
    expect(cancelTemplateLoad('nonexistent')).toBe(false);
  });
});

describe('getTemplateFilesForLoad', () => {
  it('returns the files registered with the load', async () => {
    const loadId = 'test-files';
    const files = [
      { path: 'src/a.ts', content: 'a' },
      { path: 'src/b.ts', content: 'b' },
    ];

    const promise = waitForTemplateLoad(loadId, files);

    const retrieved = getTemplateFilesForLoad(loadId);
    expect(retrieved).toEqual(files);

    // Cleanup.
    cancelTemplateLoad(loadId);
    await Promise.race([promise, Promise.resolve()]);
  });

  it('returns undefined for an unknown loadId', () => {
    expect(getTemplateFilesForLoad('nonexistent')).toBeUndefined();
  });

  it('returns undefined after the load has been resolved', async () => {
    const loadId = 'test-files-cleared';
    const files = [{ path: 'a.ts', content: 'a' }];

    const promise = waitForTemplateLoad(loadId, files);
    resolveTemplateLoad(loadId, { done: 1, total: 1, failed: [] });
    await promise;

    expect(getTemplateFilesForLoad(loadId)).toBeUndefined();
  });
});

describe('pendingLoadCount', () => {
  it('tracks the number of currently-pending loads', async () => {
    expect(pendingLoadCount()).toBe(0);

    const p1 = waitForTemplateLoad('count-1', []);
    const p2 = waitForTemplateLoad('count-2', []);
    expect(pendingLoadCount()).toBe(2);

    resolveTemplateLoad('count-1', { done: 0, total: 0, failed: [] });
    await p1;
    expect(pendingLoadCount()).toBe(1);

    cancelTemplateLoad('count-2');
    await Promise.race([p2, Promise.resolve()]);
    expect(pendingLoadCount()).toBe(0);
  });
});
