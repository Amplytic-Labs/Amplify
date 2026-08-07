import { json } from '@remix-run/cloudflare';

/**
 * Git repository information endpoint.
 *
 * Workers-compatible: `child_process` and `fs` are NOT available in
 * Cloudflare Workers V8 isolates. This route now returns build-time
 * git metadata injected via Vite `define` (set by CI/CD) or falls
 * back to "unknown" values.
 *
 * For local development (Node/Bun), git info is read at build time
 * by the `pre-start.cjs` script and injected as env vars.
 */

// Build-time git metadata — these are replaced by Vite's `define` or
// remain as fallback strings. CI should set VITE_GIT_BRANCH etc.
declare const process: { env: Record<string, string | undefined> };

export async function loader() {
  try {
    // In Workers, use build-time injected env vars or Vite defines.
    // In CI, these are typically set as environment variables.
    const branch =
      process.env?.VITE_GIT_BRANCH ||
      process.env?.CF_PAGES_BRANCH ||
      'unknown';
    const commit =
      process.env?.VITE_GIT_COMMIT ||
      process.env?.CF_PAGES_COMMIT_SHA ||
      'unknown';
    const remoteUrl = process.env?.VITE_GIT_REMOTE_URL || undefined;
    const isDirty = process.env?.VITE_GIT_DIRTY === 'true';

    // Last commit info from env (injected by CI)
    let lastCommit: { message: string; date: string; author: string } | undefined;

    if (process.env?.VITE_GIT_LAST_COMMIT_MSG) {
      lastCommit = {
        message: process.env.VITE_GIT_LAST_COMMIT_MSG,
        date: process.env.VITE_GIT_LAST_COMMIT_DATE || 'unknown',
        author: process.env.VITE_GIT_LAST_COMMIT_AUTHOR || 'unknown',
      };
    }

    return json({
      branch,
      commit,
      isDirty: isDirty ?? false,
      remoteUrl,
      lastCommit,
    });
  } catch (error) {
    console.error('Error fetching git info:', error);
    return json(
      {
        branch: 'error',
        commit: 'error',
        isDirty: false,
        error: error instanceof Error ? error.message : 'Unknown error',
      },
      { status: 500 },
    );
  }
}
