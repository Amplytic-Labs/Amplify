import path from 'node:path';

/**
 * Security utilities for path handling to prevent path traversal attacks.
 */

/**
 * Normalizes a path and ensures it remains within a specified root directory.
 *
 * @param requestedPath The path requested by the user or system.
 * @param rootDir The absolute path to the root directory that should be enforced.
 * @returns The normalized absolute path if it's within the root, or null if it's a traversal attempt.
 *
 * @example
 * normalizePath('../../etc/passwd', '/app/skills') // returns null
 * normalizePath('core-skills/git.md', '/app/skills') // returns '/app/skills/core-skills/git.md'
 */
export function normalizePath(requestedPath: string, rootDir: string): string | null {
  if (!requestedPath || !rootDir) return null;

  // 1. Resolve the root directory to an absolute path
  const absoluteRoot = path.resolve(rootDir);

  // 2. Join the root with the requested path and resolve it
  // path.join + path.resolve handles '..' and '.' segments
  const absoluteRequested = path.resolve(absoluteRoot, requestedPath);

  // 3. Check if the resolved path starts with the absolute root path
  // We add a trailing separator to the root to prevent partial match attacks
  // (e.g., /app/skills_secret vs /app/skills)
  const rootWithTrailingSlash = absoluteRoot.endsWith(path.sep) ? absoluteRoot : absoluteRoot + path.sep;

  if (absoluteRequested.startsWith(rootWithTrailingSlash) || absoluteRequested === absoluteRoot) {
    return absoluteRequested;
  }

  return null;
}

/**
 * Checks if a path is potentially dangerous (contains traversal sequences).
 * This is a fast check that can be used before full normalization.
 *
 * @param p The path to check.
 * @returns True if the path contains '..' or other traversal patterns.
 */
export function isPotentiallyDangerous(p: string): boolean {
  return p.includes('..') || p.includes('\0');
}
