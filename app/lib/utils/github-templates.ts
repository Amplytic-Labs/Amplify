import JSZip from 'jszip';

// Function to detect if we're running in Cloudflare
export function isCloudflareEnvironment(context: any): boolean {
  // Check if we're in production AND have Cloudflare Pages specific env vars
  const isProduction = process.env.NODE_ENV === 'production';
  const hasCfPagesVars = !!(
    context?.cloudflare?.env?.CF_PAGES ||
    context?.cloudflare?.env?.CF_PAGES_URL ||
    context?.cloudflare?.env?.CF_PAGES_COMMIT_SHA
  );

  return isProduction && hasCfPagesVars;
}

/**
 * Resolve the default branch of a GitHub repo via the REST API.
 *
 * Used so we can hit `codeload.github.com/{repo}/zip/refs/heads/{branch}`
 * directly (which is NOT rate-limited the way `api.github.com/repos/…/zipball`
 * is). For unauthenticated requests the api.github.com zipball endpoint is
 * capped at 60/hour — shared across every user on the same NAT — so 403
 * responses were common. codeload has no such limit for public repos.
 *
 * Falls back to 'main' if the API call fails (rate-limited, network error,
 * private repo without auth, etc.) — most modern repos use 'main' as the
 * default branch, so this is a safe bet.
 */
async function resolveDefaultBranch(repo: string, githubToken?: string): Promise<string> {
  try {
    const repoResponse = await fetch(`https://api.github.com/repos/${repo}`, {
      headers: {
        Accept: 'application/vnd.github.v3+json',
        'User-Agent': 'Amplify',
        ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
      },
    });

    if (!repoResponse.ok) {
      return 'main';
    }

    const repoData = (await repoResponse.json()) as any;
    return repoData?.default_branch || 'main';
  } catch {
    return 'main';
  }
}

// Cloudflare-compatible method using GitHub Contents API
export async function fetchRepoContentsCloudflare(repo: string, githubToken?: string) {
  const baseUrl = 'https://api.github.com';

  // Get repository info to find default branch
  const repoResponse = await fetch(`${baseUrl}/repos/${repo}`, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Amplify',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
  });

  if (!repoResponse.ok) {
    throw new Error(`Repository not found: ${repo}`);
  }

  const repoData = (await repoResponse.json()) as any;
  const defaultBranch = repoData.default_branch;

  // Get the tree recursively
  const treeResponse = await fetch(`${baseUrl}/repos/${repo}/git/trees/${defaultBranch}?recursive=1`, {
    headers: {
      Accept: 'application/vnd.github.v3+json',
      'User-Agent': 'Amplify',
      ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
    },
  });

  if (!treeResponse.ok) {
    throw new Error(`Failed to fetch repository tree: ${treeResponse.status}`);
  }

  const treeData = (await treeResponse.json()) as any;

  // Filter for files only (not directories) and limit size
  const files = treeData.tree.filter((item: any) => {
    if (item.type !== 'blob') {
      return false;
    }

    if (item.path.startsWith('.git/')) {
      return false;
    }

    // Allow lock files even if they're large
    const isLockFile =
      item.path.endsWith('package-lock.json') ||
      item.path.endsWith('yarn.lock') ||
      item.path.endsWith('pnpm-lock.yaml');

    // For non-lock files, limit size to 100KB
    if (!isLockFile && item.size >= 100000) {
      return false;
    }

    return true;
  });

  // Fetch file contents in batches to avoid overwhelming the API
  const batchSize = 10;
  const fileContents = [];

  for (let i = 0; i < files.length; i += batchSize) {
    const batch = files.slice(i, i + batchSize);
    const batchPromises = batch.map(async (file: any) => {
      try {
        const contentResponse = await fetch(`${baseUrl}/repos/${repo}/contents/${file.path}`, {
          headers: {
            Accept: 'application/vnd.github.v3+json',
            'User-Agent': 'Amplify',
            ...(githubToken ? { Authorization: `Bearer ${githubToken}` } : {}),
          },
        });

        if (!contentResponse.ok) {
          console.warn(`Failed to fetch ${file.path}: ${contentResponse.status}`);
          return null;
        }

        const contentData = (await contentResponse.json()) as any;
        const content = atob(contentData.content.replace(/\\s/g, ''));

        return {
          name: file.path.split('/').pop() || '',
          path: file.path,
          content,
        };
      } catch (error) {
        console.warn(`Error fetching ${file.path}:`, error);
        return null;
      }
    });

    const batchResults = await Promise.all(batchPromises);
    fileContents.push(...batchResults.filter(Boolean));

    // Add a small delay between batches to be respectful to the API
    if (i + batchSize < files.length) {
      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  return fileContents;
}

/**
 * Fetch a repo's file contents via a zipball download.
 *
 * STRATEGY (fixes the 403 regression):
 * ------------------------------------
 * The OLD approach hit `api.github.com/repos/{repo}/zipball`, which is the
 * GitHub REST API endpoint. For unauthenticated requests that endpoint is
 * rate-limited to 60/hour, shared per-IP — so on a shared NAT (office, CGNAT,
 * cloud egress) you blow through the limit in minutes and every subsequent
 * call returns 403. That 403 was surfaced to the user as
 * "Failed to fetch release zipball: 403" inside the inject_template tool
 * result, breaking template injection entirely.
 *
 * The NEW approach:
 *   1. Resolve the default branch via ONE tiny api.github.com call
 *      (cached implicitly per call; falls back to 'main' on any error).
 *   2. Download the zip directly from `codeload.github.com/{repo}/zip/refs/heads/{branch}`
 *      — this is the same zip GitHub serves via the "Download ZIP" button on
 *      the web UI. It is NOT rate-limited the way the API endpoint is.
 *   3. If codeload returns non-200 for any reason, fall back to the
 *      Contents-API path (the Cloudflare method) as a last resort.
 *
 * Authenticated requests (when GITHUB_TOKEN is set) use the api.github.com
 * zipball endpoint directly — authed requests have a 5000/hour limit, so
 * the original 403 doesn't happen.
 */
export async function fetchRepoContentsZip(repo: string, githubToken?: string) {
  // Authenticated path — the api.github.com zipball endpoint is safe with auth.
  if (githubToken) {
    try {
      const zipResponse = await fetch(`https://api.github.com/repos/${repo}/zipball`, {
        headers: {
          Accept: 'application/vnd.github.v3+json',
          'User-Agent': 'Amplify',
          Authorization: `Bearer ${githubToken}`,
        },
      });

      if (zipResponse.ok) {
        return await extractZipContents(await zipResponse.arrayBuffer());
      }

      // Non-OK authed response — fall through to the unauthed codeload path.
      console.warn(`[github-templates] Authed zipball returned ${zipResponse.status}, falling back to codeload`);
    } catch (e) {
      console.warn('[github-templates] Authed zipball fetch threw, falling back to codeload:', e);
    }
  }

  // Unauthenticated path — use codeload directly (NOT rate-limited like the API).
  const defaultBranch = await resolveDefaultBranch(repo, githubToken);

  // Try the default branch first, then 'main', then 'master' — covers the
  // rare case where resolveDefaultBranch fell back to 'main' but the repo
  // actually uses 'master' (or vice versa).
  const branchesToTry = Array.from(new Set([defaultBranch, 'main', 'master']));

  for (const branch of branchesToTry) {
    const codeloadUrl = `https://codeload.github.com/${repo}/zip/refs/heads/${branch}`;

    try {
      const zipResponse = await fetch(codeloadUrl, {
        headers: {
          'User-Agent': 'Amplify',
        },
      });

      if (zipResponse.ok) {
        return await extractZipContents(await zipResponse.arrayBuffer());
      }

      // 404 → branch doesn't exist, try the next one. Other errors → log and try next.
      console.warn(`[github-templates] codeload branch '${branch}' returned ${zipResponse.status}`);
    } catch (e) {
      console.warn(`[github-templates] codeload branch '${branch}' threw:`, e);
    }
  }

  // Last resort — fall back to the Contents API (slow but works for any public repo).
  console.warn('[github-templates] All codeload branches failed, falling back to Contents API');
  return fetchRepoContentsCloudflare(repo, githubToken);
}

/**
 * Extract file contents from a downloaded zip ArrayBuffer.
 *
 * Shared between the authed (api.github.com/zipball) and unauthed
 * (codeload.github.com/zip/refs/heads/…) paths so both produce the
 * same `{ name, path, content }[]` shape.
 */
async function extractZipContents(zipArrayBuffer: ArrayBuffer) {
  const zip = await JSZip.loadAsync(zipArrayBuffer);

  // Find the root folder name (GitHub wraps everything under
  // "{owner}-{repo}-{sha}/" so we strip that prefix from each path).
  let rootFolderName = '';
  zip.forEach((relativePath) => {
    if (!rootFolderName && relativePath.includes('/')) {
      rootFolderName = relativePath.split('/')[0];
    }
  });

  const promises = Object.keys(zip.files).map(async (filename) => {
    const zipEntry = zip.files[filename];

    // Skip directories
    if (zipEntry.dir) {
      return null;
    }

    // Skip the root folder itself
    if (filename === rootFolderName) {
      return null;
    }

    // Remove the root folder from the path
    let normalizedPath = filename;

    if (rootFolderName && filename.startsWith(rootFolderName + '/')) {
      normalizedPath = filename.substring(rootFolderName.length + 1);
    }

    // Get the file content
    const content = await zipEntry.async('string');

    return {
      name: normalizedPath.split('/').pop() || '',
      path: normalizedPath,
      content,
    };
  });

  const results = await Promise.all(promises);

  return results.filter(Boolean);
}

export async function fetchRepoContents(repo: string, context?: any) {
  const githubToken =
    context?.cloudflare?.env?.GITHUB_TOKEN || process.env.GITHUB_TOKEN || process.env.VITE_GITHUB_ACCESS_TOKEN;

  if (isCloudflareEnvironment(context)) {
    return fetchRepoContentsCloudflare(repo, githubToken);
  } else {
    return fetchRepoContentsZip(repo, githubToken);
  }
}
