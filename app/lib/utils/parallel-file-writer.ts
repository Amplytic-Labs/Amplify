import { webcontainer } from '~/lib/webcontainer';
import path from 'node:path';

/**
 * Parallel file writer for the WebContainer FS.
 *
 * WHY THIS EXISTS
 * ---------------
 * The previous file-loading paths serialized every write:
 *
 *   - inject_template: streamed an <amplifyArtifact> XML blob, the client
 *     message parser parsed it into <amplifyAction> chunks, and each action
 *     was enqueued into ActionRunner.#currentExecutionPromise — a single
 *     .then() chain that processed one file at a time. With 400 files this
 *     meant ~200s of sequential writes + per-file focus/save round-trips.
 *
 *   - restoreFileMap (manual template pick): two sequential for-loops over
 *     folders then files, each `await webcontainer.fs.writeFile(...)` blocking
 *     the next.
 *
 * This module replaces both with a concurrency-limited parallel writer.
 *
 * IS PARALLELISM ACTUALLY SUPPORTED BY WebContainer?
 * --------------------------------------------------
 * Yes. Verified by reading @webcontainer/api@1.6.1 source:
 *   - FileSystemAPIClient.writeFile/mkdir are thin async wrappers around a
 *     Comlink proxy (this._fs).
 *   - Comlink's expose() dispatches each message independently — it does NOT
 *     queue. Each proxy.method() call returns its own Promise.
 *   - The worker's message listener fires per-message and starts the async
 *     FS work without waiting for prior work to complete.
 *
 * So Promise.all([wc.fs.writeFile(a), wc.fs.writeFile(b), ...]) executes
 * concurrently at the message-passing layer. The underlying FS (Node-like,
 * in the WebContainer worker) handles concurrent writes to different paths.
 *
 * Even if the worker's FS internally serializes (closed-source, can't verify
 * 100%), we still win because we remove:
 *   - ActionRunner.#currentExecutionPromise chain overhead
 *   - Duplicate mkdir calls (we dedupe parent dirs upfront)
 *   - Per-file editor focus + save round-trips
 *
 * DESIGN
 * ------
 * Two phases:
 *
 *   1. Mkdir phase — collect the unique set of parent directories across all
 *      tasks and mkdir them in parallel (recursive). Most templates share
 *      parent dirs (src/, src/components/, etc.) so this collapses N mkdir
 *      calls into ~10-20.
 *
 *   2. Write phase — fan out N writeFile calls across `concurrency` workers
 *      pulling from a shared queue. Each worker awaits its current write
 *      before pulling the next. This bounds in-flight Promises to
 *      `concurrency` so we don't post 400 messages at once (which would
 *      saturate the Comlink message queue and spike memory).
 *
 * PROGRESS CALLBACK
 * -----------------
 * The optional onProgress callback fires after each file completes (success
 * or failure). Callers can use it for logging/telemetry — but per the user's
 * request, we deliberately do NOT surface a UI progress indicator. Files
 * just appear in the file tree as the watcher picks them up.
 *
 * ERROR HANDLING
 * --------------
 * Individual file write failures are collected into the `failed` array of
 * the returned WriteProgress. The Promise resolves successfully even if some
 * files failed — the caller decides whether partial failure is acceptable.
 * This matches the previous behavior (restoreFileMap had try/catch around
 * each write that silently swallowed errors).
 */

export interface WriteTask {
  /** Path relative to the WebContainer workdir (e.g. "src/index.ts"). */
  path: string;

  /** File content — string for text, Uint8Array for binary. */
  content: string | Uint8Array;

  /** Optional encoding hint passed to writeFile. */
  encoding?: string;
}

export interface WriteProgress {
  /** Number of files successfully written. */
  done: number;

  /** Total number of files in the batch. */
  total: number;

  /** Files that failed to write, with their error messages. */
  failed: Array<{ path: string; error: string }>;
}

export interface WriteFilesOptions {
  /**
   * Maximum number of concurrent writeFile calls. Defaults to 12 — balances
   * speed against Comlink message-queue pressure. Tune via env var
   * FILE_WRITE_CONCURRENCY if needed.
   */
  concurrency?: number;

  /**
   * Optional progress callback. Fires after each file completes (success or
   * failure). NOT used for UI display — files appear in the file tree
   * silently via the watcher.
   */
  onProgress?: (progress: WriteProgress) => void;
}

/**
 * Default concurrency. Tunable via env var FILE_WRITE_CONCURRENCY.
 * 12 is a sweet spot: enough to keep the worker busy without saturating
 * the Comlink message queue.
 */
const DEFAULT_CONCURRENCY =
  typeof process !== 'undefined' && process.env?.FILE_WRITE_CONCURRENCY
    ? parseInt(process.env.FILE_WRITE_CONCURRENCY, 10)
    : 12;

/**
 * Write an array of files to the WebContainer in parallel.
 *
 * Two phases:
 *   1. Mkdir all unique parent dirs in parallel (deduped).
 *   2. Write all files via a concurrency-limited worker pool.
 *
 * Returns the final WriteProgress (done/total/failed). Resolves successfully
 * even if some files failed — inspect `failed` to detect partial failure.
 *
 * @throws if the WebContainer fails to boot or if `tasks` is empty.
 */
export async function writeFilesParallel(tasks: WriteTask[], opts: WriteFilesOptions = {}): Promise<WriteProgress> {
  if (tasks.length === 0) {
    return { done: 0, total: 0, failed: [] };
  }

  const wc = await webcontainer;
  const concurrency = Math.min(opts.concurrency ?? DEFAULT_CONCURRENCY, tasks.length);

  /*
   * Phase 1 — mkdir all unique parent dirs in parallel.
   *
   * Collect unique dir paths across all tasks. Most templates share a small
   * set of parent dirs (src/, src/components/, src/lib/, etc.), so this
   * collapses ~400 redundant mkdir calls into ~10-20.
   *
   * We use { recursive: true } so missing intermediate dirs are created.
   * Errors are swallowed (dir may already exist, which is fine).
   */
  const uniqueDirs = new Set<string>();

  for (const task of tasks) {
    const dir = path.dirname(task.path);

    if (dir !== '.' && dir !== '') {
      uniqueDirs.add(dir);
    }
  }

  if (uniqueDirs.size > 0) {
    const mkdirTasks = Array.from(uniqueDirs).map(async (dir) => {
      try {
        await wc.fs.mkdir(dir, { recursive: true });
      } catch {
        // Swallow — dir likely already exists, which is fine.
      }
    });

    await Promise.all(mkdirTasks);
  }

  /*
   * Phase 2 — write files via a concurrency-limited worker pool.
   *
   * We don't just Promise.all all writes because:
   *   - 400 in-flight Promises would post 400 messages to Comlink at once,
   *     spiking memory and slowing down the message queue.
   *   - A bounded pool keeps the worker busy without overwhelming it.
   *
   * Workers pull from a shared queue (via shift()). Each worker awaits its
   * current write before pulling the next, so at most `concurrency` writes
   * are in flight at any time.
   */
  const progress: WriteProgress = {
    done: 0,
    total: tasks.length,
    failed: [],
  };

  const queue = [...tasks];

  const worker = async () => {
    while (queue.length > 0) {
      const task = queue.shift();

      if (!task) {
        break;
      }

      try {
        const isBinary = task.content instanceof Uint8Array;

        if (isBinary) {
          /*
           * Binary: pass through without encoding (Comlink.transfer handles
           * the buffer ownership transfer under the hood).
           */
          await wc.fs.writeFile(task.path, task.content);
        } else {
          /*
           * Text: pass encoding if provided, otherwise let WC infer.
           * Empty string is replaced with a single space — matches the
           * existing FilesStore.createFile behavior (WC rejects '' for
           * some file types).
           */
          const contentToWrite = (task.content as string).length === 0 ? ' ' : task.content;

          if (task.encoding) {
            await wc.fs.writeFile(task.path, contentToWrite, task.encoding);
          } else {
            await wc.fs.writeFile(task.path, contentToWrite);
          }
        }

        progress.done++;
      } catch (e: any) {
        progress.failed.push({
          path: task.path,
          error: e?.message ?? String(e),
        });
      }

      // Fire progress callback (if any) after each file.
      if (opts.onProgress) {
        try {
          opts.onProgress({ ...progress, failed: [...progress.failed] });
        } catch {
          // Swallow callback errors — they shouldn't break the write.
        }
      }
    }
  };

  // Spawn `concurrency` workers and wait for all to drain the queue.
  const workers = Array.from({ length: concurrency }, () => worker());
  await Promise.all(workers);

  return progress;
}

/**
 * Helper: convert a FileMap (the workbench store shape) to WriteTask[].
 *
 * FileMap values look like:
 *   { type: 'file', content: string, isBinary?: boolean }
 *   { type: 'folder' }   (skipped — folders are created implicitly by mkdir)
 *
 * Paths in FileMap are absolute (workdir-prefixed); we strip the workdir
 * prefix to get relative paths for the WebContainer FS.
 */
export function fileMapToWriteTasks(fileMap: Record<string, any>, workdir: string): WriteTask[] {
  const tasks: WriteTask[] = [];

  for (const [rawPath, value] of Object.entries(fileMap)) {
    if (!value || value.type !== 'file') {
      continue;
    }

    let relativePath = rawPath;

    if (relativePath.startsWith(workdir)) {
      relativePath = relativePath.slice(workdir.length);
    }

    if (relativePath.startsWith('/')) {
      relativePath = relativePath.slice(1);
    }

    if (!relativePath) {
      continue;
    }

    tasks.push({
      path: relativePath,
      content: value.content,
      encoding: value.isBinary ? undefined : 'utf8',
    });
  }

  return tasks;
}
