/**
 * Native Copilot-style tools for Amplify.
 *
 * These tools mirror the design of VSCode Copilot's built-in tools
 * (see vscode/extensions/copilot/src/extension/tools/node/):
 *   - read_file           -> ReadFileTool
 *   - list_dir            -> ListDirTool
 *   - find_files          -> FindFilesTool
 *   - grep_search         -> FindTextInFilesTool
 *   - replace_string_in_file  -> ReplaceStringTool
 *   - multi_replace_string_in_file -> MultiReplaceStringTool
 *   - create_file         -> CreateFileTool
 *   - web_search          -> WebSearchTool (uses the existing /api/web-search route)
 *
 * IMPORTANT — execution model
 * --------------------------
 * The Amplify chat pipeline runs on the server (api.chat.ts) but the
 * authoritative file system lives in the browser (WebContainer + workbench
 * store). To bridge the two:
 *
 *   1. Read-only tools (read_file, list_dir, find_files, grep_search)
 *      operate on the `files` map that the browser ships with every
 *      /api/chat request. This is the same map the system-prompt context
 *      builder uses, so the AI sees a consistent snapshot.
 *
 *   2. Mutating tools (replace_string_in_file, multi_replace_string_in_file,
 *      create_file) do NOT directly touch the file system. They return a
 *      structured "mutation signal" (JSON). The browser-side Chat.client.tsx
 *      detects these signals in tool results and applies them to the
 *      workbench file store (which in turn writes to WebContainer).
 *      This is the same pattern used by the existing `execute_plan` tool.
 *
 *   3. `web_search` calls the existing /api/web-search route so we reuse
 *      the provider plumbing (API keys, etc.).
 *
 * The execute functions receive `files: FileMap` via the second argument
 * (the tool-call context). See `mcpService.processToolInvocations` for the
 * wiring.
 */
import { z } from 'zod';
import { createScopedLogger } from '~/utils/logger';
import { WORK_DIR } from '~/utils/constants';

const logger = createScopedLogger('native-tools');

/**
 * Minimal FileMap shape we rely on. Mirrors `app/lib/stores/files.ts` but
 * kept local to avoid importing browser-only stores into a server module.
 */
export interface NativeFile {
  type: 'file';
  content: string;
  isBinary: boolean;
  isLocked?: boolean;
}
export interface NativeFolder {
  type: 'folder';
  isLocked?: boolean;
}
export type NativeDirent = NativeFile | NativeFolder;
export type NativeFileMap = Record<string, NativeDirent | undefined>;

export interface NativeToolContext {
  files?: NativeFileMap;
  toolCallId?: string;
  messages?: any[];

  /** Server-side fetch (cloudflare/node). Browser code passes its own. */
  fetch?: typeof fetch;

  /** Request URL prefix for invoking internal API routes from server. */
  apiBaseUrl?: string;
}

/* ----------------------------------------------------------------- helpers */

/** Normalise a path the model might emit (absolute /home/project/... or relative). */
function normalizePath(p: string): string {
  if (!p) {
    return p;
  }

  let path = p.trim();

  if (path.startsWith(WORK_DIR)) {
    path = path.slice(WORK_DIR.length);
  }

  if (path.startsWith('/')) {
    path = path.slice(1);
  }

  return path;
}

function fullKey(relPath: string): string {
  return `${WORK_DIR}/${relPath}`;
}

function getFileFromMap(files: NativeFileMap | undefined, rawPath: string): NativeFile | undefined {
  if (!files) {
    return undefined;
  }

  const rel = normalizePath(rawPath);
  const ent = files[fullKey(rel)] ?? files[rel];

  if (!ent || ent.type !== 'file') {
    return undefined;
  }

  return ent;
}

function listEntriesInDir(
  files: NativeFileMap | undefined,
  rawDir: string,
): Array<{ name: string; type: 'file' | 'folder' }> {
  if (!files) {
    return [];
  }

  const rel = normalizePath(rawDir);
  const prefix = rel === '' ? '' : `${rel}/`;
  const seen = new Set<string>();
  const out: Array<{ name: string; type: 'file' | 'folder' }> = [];

  for (const key of Object.keys(files)) {
    if (!key.endsWith(prefix) && !key.includes(prefix)) {
      continue;
    }

    // Strip WORK_DIR prefix from the key for comparison
    let relKey = key;

    if (relKey.startsWith(WORK_DIR + '/')) {
      relKey = relKey.slice(WORK_DIR.length + 1);
    }

    if (!relKey.startsWith(prefix) || relKey === prefix) {
      continue;
    }

    const tail = relKey.slice(prefix.length);

    if (tail.includes('/')) {
      // Direct child is a folder
      const folderName = tail.split('/')[0];

      if (!seen.has(folderName)) {
        seen.add(folderName);
        out.push({ name: folderName, type: 'folder' });
      }
    } else if (tail) {
      if (!seen.has(tail)) {
        seen.add(tail);
        out.push({ name: tail, type: 'file' });
      }
    }
  }

  return out.sort((a, b) => {
    if (a.type !== b.type) {
      return a.type === 'folder' ? -1 : 1;
    }

    return a.name.localeCompare(b.name);
  });
}

function globToRegex(pattern: string): RegExp {
  // Very small glob -> regex translator that supports *, **, ?, and basic char classes.
  let re = '';

  for (let i = 0; i < pattern.length; i++) {
    const c = pattern[i];

    if (c === '*') {
      if (pattern[i + 1] === '*') {
        re += '.*';
        i++;

        if (pattern[i + 1] === '/') {
          i++;
        } // consume the trailing slash of **/
      } else {
        re += '[^/]*';
      }
    } else if (c === '?') {
      re += '[^/]';
    } else if (c === '.') {
      re += '\\.';
    } else if (c === '/') {
      re += '/';
    } else if (/[a-zA-Z0-9_-]/.test(c)) {
      re += c;
    } else {
      re += `\\${c}`;
    }
  }

  return new RegExp(`^${re}$`);
}

/* ----------------------------------------------------------- mutation signal */
/**
 * Mutation signals are JSON strings with `type: 'amplify_file_mutation'`.
 * The browser-side Chat.client.tsx parses them out of tool results and
 * applies the operations to the workbench store.
 */
export type FileMutationOperation =
  | { op: 'create'; filePath: string; content: string }
  | { op: 'replace'; filePath: string; oldString: string; newString: string }
  | { op: 'multi_replace'; filePath: string; edits: Array<{ oldString: string; newString: string }> };

export interface FileMutationSignal {
  type: 'amplify_file_mutation';
  operations: FileMutationOperation[];
}

export function isFileMutationSignal(value: unknown): value is FileMutationSignal {
  if (!value || typeof value !== 'string') {
    return false;
  }

  if (!value.includes('amplify_file_mutation')) {
    return false;
  }

  try {
    const parsed = JSON.parse(value);
    return parsed && parsed.type === 'amplify_file_mutation' && Array.isArray(parsed.operations);
  } catch {
    return false;
  }
}

export function parseFileMutationSignal(value: string): FileMutationSignal | null {
  try {
    const parsed = JSON.parse(value);

    if (parsed && parsed.type === 'amplify_file_mutation' && Array.isArray(parsed.operations)) {
      return parsed as FileMutationSignal;
    }
  } catch {
    /* ignore */
  }
  return null;
}

/* ------------------------------------------------------------ tool builders */

/**
 * Build the native Copilot-style tool set.
 *
 * The returned object matches the shape expected by the AI SDK / MCP service:
 * each tool has `description`, `parameters` (zod schema), and `execute`.
 *
 * The execute function reads `files` from the second argument (the tool-call
 * context). The MCP service is responsible for passing `files` through.
 */
export function buildNativeTools(): Record<string, any> {
  return {
    /* --------------------------------------------------- read_file */
    read_file: {
      description:
        'Read the contents of a text file from the workspace. Line numbers are 1-indexed. ' +
        'Truncates output at 2000 lines; use offset/limit to read larger files in chunks. ' +
        'Binary files are not returned as text.',
      parameters: z.object({
        filePath: z.string().describe('Absolute or workspace-relative path of the file to read'),
        offset: z.number().optional().describe('1-based line number to start reading from'),
        limit: z.number().optional().describe('Maximum number of lines to read'),
      }),
      execute: async (
        { filePath, offset, limit }: { filePath: string; offset?: number; limit?: number },
        ctx: NativeToolContext = {},
      ) => {
        const file = getFileFromMap(ctx.files, filePath);

        if (!file) {
          return `File not found: ${filePath}. Use list_dir to inspect the workspace first.`;
        }

        if (file.isBinary) {
          return `File is binary and cannot be displayed as text: ${filePath}`;
        }

        const lines = file.content.split('\n');
        const start = Math.max(1, offset ?? 1);
        const end = Math.min(lines.length, start + (limit ?? 2000) - 1);
        const slice = lines.slice(start - 1, end);
        const numbered = slice.map((l, i) => `${String(start + i).padStart(5, ' ')}: ${l}`).join('\n');
        const truncated =
          end < lines.length ? `\n... (${lines.length - end} more lines, pass offset=${end + 1} to continue)` : '';

        return `File: ${normalizePath(filePath)} (${lines.length} lines)\n\n${numbered}${truncated}`;
      },
    },

    /* --------------------------------------------------- list_dir */
    list_dir: {
      description:
        'List the contents of a directory in the workspace. Returns file and folder names. ' +
        'Use this to explore the project structure before reading specific files.',
      parameters: z.object({
        path: z.string().describe('Absolute or workspace-relative path of the directory to list'),
      }),
      execute: async ({ path }: { path: string }, ctx: NativeToolContext = {}) => {
        const entries = listEntriesInDir(ctx.files, path);

        if (entries.length === 0) {
          return `Directory is empty or does not exist: ${path}`;
        }

        const lines = entries.map((e) => `${e.type === 'folder' ? '[dir] ' : '      '}${e.name}`);

        return `Directory: ${normalizePath(path)}\n\n${lines.join('\n')}`;
      },
    },

    /* --------------------------------------------------- find_files */
    find_files: {
      description:
        'Find files in the workspace whose path matches a glob pattern. ' +
        'Supports *, **, and ?. Useful for locating files by extension or partial name. ' +
        'Returns up to 200 matches.',
      parameters: z.object({
        pattern: z.string().describe('Glob pattern, e.g. "**/*.tsx", "src/components/*.ts"'),
      }),
      execute: async ({ pattern }: { pattern: string }, ctx: NativeToolContext = {}) => {
        if (!ctx.files) {
          return [];
        }

        const re = globToRegex(pattern);
        const matches: string[] = [];

        for (const key of Object.keys(ctx.files)) {
          let relKey = key;

          if (relKey.startsWith(WORK_DIR + '/')) {
            relKey = relKey.slice(WORK_DIR.length + 1);
          }

          if (re.test(relKey)) {
            matches.push(relKey);
          }

          if (matches.length >= 200) {
            break;
          }
        }

        if (matches.length === 0) {
          return `No files matched pattern: ${pattern}`;
        }

        return `Found ${matches.length} file(s) matching ${pattern}:\n\n${matches.join('\n')}`;
      },
    },

    /* --------------------------------------------------- grep_search */
    grep_search: {
      description:
        'Search the contents of workspace files for a pattern (regex or literal). ' +
        'Returns matching file paths with line numbers and the matching line text. ' +
        'Truncates to 50 matches; refine your pattern if you need fewer results.',
      parameters: z.object({
        pattern: z.string().describe('Regex or literal pattern to search for'),
        includePattern: z
          .string()
          .optional()
          .describe('Optional glob pattern to limit which files are searched, e.g. "*.ts"'),
        isRegex: z.boolean().optional().default(false).describe('Whether the pattern is a regex'),
        caseSensitive: z.boolean().optional().default(true).describe('Whether the search is case-sensitive'),
      }),
      execute: async (
        {
          pattern,
          includePattern,
          isRegex,
          caseSensitive,
        }: { pattern: string; includePattern?: string; isRegex?: boolean; caseSensitive?: boolean },
        ctx: NativeToolContext = {},
      ) => {
        if (!ctx.files) {
          return 'No files available to search.';
        }

        let re: RegExp;

        try {
          re = isRegex
            ? new RegExp(pattern, caseSensitive ? '' : 'i')
            : new RegExp(pattern.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), caseSensitive ? '' : 'i');
        } catch (e: any) {
          return `Invalid pattern: ${e.message}`;
        }

        const globRe = includePattern ? globToRegex(includePattern) : null;
        const matches: Array<{ file: string; line: number; text: string }> = [];
        const maxMatches = 50;

        for (const [key, ent] of Object.entries(ctx.files)) {
          if (!ent || ent.type !== 'file' || ent.isBinary) {
            continue;
          }

          let relKey = key;

          if (relKey.startsWith(WORK_DIR + '/')) {
            relKey = relKey.slice(WORK_DIR.length + 1);
          }

          if (globRe && !globRe.test(relKey)) {
            continue;
          }

          const lines = ent.content.split('\n');

          for (let i = 0; i < lines.length; i++) {
            if (re.test(lines[i])) {
              matches.push({ file: relKey, line: i + 1, text: lines[i].trim().slice(0, 200) });

              if (matches.length >= maxMatches) {
                break;
              }
            }
          }

          if (matches.length >= maxMatches) {
            break;
          }
        }

        if (matches.length === 0) {
          return `No matches for pattern: ${pattern}`;
        }

        const lines = matches.map((m) => `${m.file}:${m.line}: ${m.text}`);

        return `Found ${matches.length} match(es)${matches.length >= maxMatches ? ' (truncated)' : ''}:\n\n${lines.join('\n')}`;
      },
    },

    /* --------------------------------------------------- web_search */
    web_search: {
      description:
        'Search the web for current information. Returns a list of results with title, url, and snippet. ' +
        'Use this when the user asks about recent events, library docs, or anything outside the workspace.',
      parameters: z.object({
        query: z.string().describe('The search query'),
        maxResults: z.number().optional().default(5).describe('Maximum number of results to return (default 5)'),
      }),
      execute: async ({ query, maxResults }: { query: string; maxResults?: number }, ctx: NativeToolContext = {}) => {
        try {
          const fetchFn = ctx.fetch || fetch;
          const base = ctx.apiBaseUrl || '';
          const resp = await fetchFn(`${base}/api/web-search?query=${encodeURIComponent(query)}`, {
            method: 'GET',
            headers: { Accept: 'application/json' },
          });

          if (!resp.ok) {
            return `Web search failed: HTTP ${resp.status}`;
          }

          const data: any = await resp.json();
          const results: any[] = Array.isArray(data?.results) ? data.results : [];

          if (results.length === 0) {
            return `No web results found for: ${query}`;
          }

          const limited = results.slice(0, maxResults ?? 5);
          const lines = limited.map(
            (r, i) =>
              `${i + 1}. ${r.title || '(no title)'}\n   ${r.url || r.link || ''}\n   ${(r.snippet || r.description || '').slice(0, 300)}`,
          );

          return `Web search results for "${query}":\n\n${lines.join('\n\n')}`;
        } catch (e: any) {
          logger.error('web_search failed', e);
          return `Web search error: ${e.message}`;
        }
      },
    },

    /* --------------------------------------------------- replace_string_in_file */
    replace_string_in_file: {
      description:
        'Edit an existing file in the workspace by replacing ONE occurrence of `oldString` with `newString`. ' +
        '`oldString` MUST be the exact literal text to replace including all whitespace, indentation, and newlines, ' +
        'and MUST uniquely identify a single location — include 3 lines of surrounding context if needed. ' +
        'If the string matches multiple locations or no locations, the edit will fail. ' +
        'For multiple edits to the same file in one call, use multi_replace_string_in_file instead.',
      parameters: z.object({
        filePath: z.string().describe('Absolute or workspace-relative path of the file to edit'),
        oldString: z.string().describe('Exact literal text to find (must be unique in the file)'),
        newString: z.string().describe('Exact literal text to replace oldString with'),
      }),
      execute: async (
        { filePath, oldString, newString }: { filePath: string; oldString: string; newString: string },
        ctx: NativeToolContext = {},
      ) => {
        const rel = normalizePath(filePath);
        const file = getFileFromMap(ctx.files, rel);

        if (!file) {
          return `File not found: ${filePath}. Use list_dir or find_files to locate the file.`;
        }

        if (file.isBinary) {
          return `Cannot edit binary file: ${filePath}`;
        }

        const occurrences = file.content.split(oldString).length - 1;

        if (occurrences === 0) {
          return `oldString not found in ${rel}. Make sure you copied the exact text including whitespace and indentation.`;
        }

        if (occurrences > 1) {
          return `oldString matched ${occurrences} times in ${rel}. Add more surrounding context so the match is unique.`;
        }

        const signal: FileMutationSignal = {
          type: 'amplify_file_mutation',
          operations: [{ op: 'replace', filePath: rel, oldString, newString }],
        };

        return JSON.stringify(signal);
      },
    },

    /* --------------------------------------------------- multi_replace_string_in_file */
    multi_replace_string_in_file: {
      description:
        'Apply multiple edits to a single file in one call. Each edit follows the same rules as ' +
        'replace_string_in_file (unique, exact-match oldString). Edits are applied sequentially in the order given. ' +
        'Use this when you need to make several related edits to the same file.',
      parameters: z.object({
        filePath: z.string().describe('Absolute or workspace-relative path of the file to edit'),
        edits: z
          .array(
            z.object({
              oldString: z.string(),
              newString: z.string(),
            }),
          )
          .min(1)
          .describe('Array of edits to apply in order'),
      }),
      execute: async (
        { filePath, edits }: { filePath: string; edits: Array<{ oldString: string; newString: string }> },
        ctx: NativeToolContext = {},
      ) => {
        const rel = normalizePath(filePath);
        const file = getFileFromMap(ctx.files, rel);

        if (!file) {
          return `File not found: ${filePath}.`;
        }

        if (file.isBinary) {
          return `Cannot edit binary file: ${filePath}.`;
        }

        /*
         * Validate every edit against the ORIGINAL content (each edit is independent w.r.t. uniqueness).
         * Sequential application happens client-side.
         */
        for (const [i, e] of edits.entries()) {
          const occ = file.content.split(e.oldString).length - 1;

          if (occ === 0) {
            return `Edit #${i + 1} failed: oldString not found in ${rel}.`;
          }

          if (occ > 1) {
            return `Edit #${i + 1} failed: oldString matched ${occ} times in ${rel}. Add more surrounding context.`;
          }
        }

        const signal: FileMutationSignal = {
          type: 'amplify_file_mutation',
          operations: [{ op: 'multi_replace', filePath: rel, edits }],
        };

        return JSON.stringify(signal);
      },
    },

    /* --------------------------------------------------- create_file */
    create_file: {
      description:
        'Create a new file in the workspace with the given content. Fails if the file already exists — ' +
        'use replace_string_in_file to modify an existing file instead. Parent directories are created automatically.',
      parameters: z.object({
        filePath: z.string().describe('Absolute or workspace-relative path of the file to create'),
        content: z.string().describe('Full content of the new file'),
      }),
      execute: async ({ filePath, content }: { filePath: string; content: string }, ctx: NativeToolContext = {}) => {
        const rel = normalizePath(filePath);
        const existing = getFileFromMap(ctx.files, rel);

        if (existing) {
          return `File already exists: ${rel}. Use replace_string_in_file to edit it, or delete it first.`;
        }

        const signal: FileMutationSignal = {
          type: 'amplify_file_mutation',
          operations: [{ op: 'create', filePath: rel, content }],
        };

        return JSON.stringify(signal);
      },
    },
  };
}

/**
 * List of native tool names — useful for the UI to render Copilot-style
 * friendly names, icons, and result formatters without hard-coding them.
 */
export const NATIVE_TOOL_NAMES = [
  'read_file',
  'list_dir',
  'find_files',
  'grep_search',
  'web_search',
  'replace_string_in_file',
  'multi_replace_string_in_file',
  'create_file',
] as const;

export type NativeToolName = (typeof NATIVE_TOOL_NAMES)[number];

/**
 * Read-only native tools — these auto-execute without user approval,
 * mirroring VSCode Copilot's behaviour where the AI can freely read
 * files, list directories, search the codebase, and run web searches
 * without prompting the user for each call.
 *
 * Mutating tools (replace_string_in_file, multi_replace_string_in_file,
 * create_file) are intentionally NOT in this list — they still show
 * the Approve/Reject UI so the user stays in control of file edits.
 */
export const READ_ONLY_NATIVE_TOOLS: ReadonlySet<string> = new Set([
  'read_file',
  'list_dir',
  'find_files',
  'grep_search',
  'web_search',
]);

/**
 * Returns true if the given tool name is a read-only native tool that
 * should auto-execute without user approval.
 */
export function isReadOnlyNativeTool(toolName: string): boolean {
  return READ_ONLY_NATIVE_TOOLS.has(toolName);
}

/**
 * Returns true if the given tool name is a mutating native tool that
 * requires explicit user approval before execution.
 */
export function isMutatingNativeTool(toolName: string): boolean {
  return NATIVE_TOOL_NAMES.includes(toolName as NativeToolName) && !READ_ONLY_NATIVE_TOOLS.has(toolName);
}
