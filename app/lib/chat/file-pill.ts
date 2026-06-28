/**
 * File-pill detection + icon mapping.
 *
 * When the AI mentions a file path (e.g. `app/_layout.jsx`) or a folder path
 * (e.g. `components/ui/`) inside inline code, we render it as a clickable pill
 * with a colorized file-type icon instead of plain monospace text.
 *
 * Detection rules (applied to the raw inline-code text):
 *   1. Ends with `/`                     → FOLDER  (e.g. `components/ui/`)
 *   2. Last segment has a dot + ext      → FILE    (e.g. `app/_layout.jsx`)
 *   3. Otherwise                          → null    (plain code, e.g. `useState`)
 *
 * The icon mapping favours the `logos` Iconify set (colorized brand SVGs:
 * React atom, JS yellow, TS blue, …) and falls back to Phosphor monochrome
 * file icons for less common types.
 */

export type PillType = 'file' | 'folder';

export interface FilePillMeta {
  type: 'file';

  /** Icon class, e.g. `i-logos:react` or `i-ph:file`. */
  icon: string;

  /** Display name — just the file's basename (e.g. `_layout.jsx`). */
  name: string;

  /** Lowercased extension without the dot (e.g. `jsx`). */
  ext: string;

  /** Normalized workspace-relative path (no leading slash). */
  path: string;
}

export interface FolderPillMeta {
  type: 'folder';

  /** Folder icon class. */
  icon: string;

  /** Display name — the final folder segment (e.g. `ui`). */
  name: string;

  /** Normalized workspace-relative path (no leading slash, no trailing slash). */
  path: string;
}

export type PillMeta = FilePillMeta | FolderPillMeta;

/**
 * Extension → colorized brand icon. The `logos` Iconify set ships
 * multi-color SVGs so the icons render in brand colours with no extra CSS.
 */
const EXT_ICON_MAP: Record<string, string> = {
  // React ecosystem
  jsx: 'i-logos:react',
  tsx: 'i-logos:react',

  // JS / TS
  js: 'i-logos:javascript',
  mjs: 'i-logos:javascript',
  cjs: 'i-logos:javascript',
  ts: 'i-logos:typescript',

  // Data / config
  json: 'i-logos:json',

  // Web markup
  css: 'i-logos:css-3',
  scss: 'i-logos:sass',
  sass: 'i-logos:sass',
  less: 'i-logos:less',
  html: 'i-logos:html-5',
  vue: 'i-logos:vue',
  svelte: 'i-logos:svelte-icon',
  astro: 'i-logos:astro-icon',

  // Backend
  py: 'i-logos:python',
  go: 'i-logos:go',
  rust: 'i-logos:rust',
  rs: 'i-logos:rust',
  java: 'i-logos:java',
  kt: 'i-logos:kotlin-icon',
  rb: 'i-logos:ruby',
  php: 'i-logos:php',
  c: 'i-logos:c',
  cpp: 'i-logos:cpp',
  cs: 'i-logos:csharp',

  // Mobile
  swift: 'i-logos:swift',
  dart: 'i-logos:dart',

  // Docs
  md: 'i-logos:markdown',
  mdx: 'i-logos:markdown',

  // Build / config (monochrome fallbacks)
  toml: 'i-ph:file-text',
  yaml: 'i-ph:file-text',
  yml: 'i-ph:file-text',
  env: 'i-ph:file-text',
  sh: 'i-ph:terminal-window',
  bash: 'i-ph:terminal-window',
  zsh: 'i-ph:terminal-window',

  // Images (monochrome)
  svg: 'i-ph:file-image',
  png: 'i-ph:file-image',
  jpg: 'i-ph:file-image',
  jpeg: 'i-ph:file-image',
  gif: 'i-ph:file-image',
  webp: 'i-ph:file-image',
  ico: 'i-ph:file-image',

  // Lock files
  lock: 'i-ph:lock-simple',
};

const DEFAULT_FILE_ICON = 'i-ph:file';
const FOLDER_ICON = 'i-ph:folder-simple';

/**
 * Normalise a path fragment from inline code: strip a leading slash and any
 * surrounding whitespace. Does NOT collapse `..` / `.` segments — the AI
 * rarely emits those and the workbench file map keys are literal paths.
 */
function normalizePath(raw: string): string {
  let p = raw.trim();

  // Strip a single leading slash (workspace-relative convention).
  if (p.startsWith('/')) {
    p = p.slice(1);
  }

  return p;
}

/**
 * Extract the file extension (without dot) from a filename. Returns `''` for
 * dotfiles with no real extension (e.g. `.eslintrc`) — those fall back to the
 * default file icon.
 */
function getExtension(fileName: string): string {
  const dotIdx = fileName.lastIndexOf('.');

  // No dot, or leading-dot file with no second dot → no extension.
  if (dotIdx <= 0) {
    return '';
  }

  return fileName.slice(dotIdx + 1).toLowerCase();
}

/**
 * Classify an inline-code string as a file path, folder path, or neither.
 *
 * Returns `null` for plain code (e.g. `useState`, `npm install`) so the
 * Markdown renderer falls back to the default `<code>` element.
 */
export function detectPill(raw: string): PillMeta | null {
  if (!raw || typeof raw !== 'string') {
    return null;
  }

  const text = raw.trim();

  // Reject multi-line code (block snippets leaking through) and very long strings.
  if (text.includes('\n') || text.length > 200) {
    return null;
  }

  /*
   * Reject strings with spaces that look like commands (e.g. `npm install`).
   * A valid path segment doesn't contain spaces.
   */
  if (/\s/.test(text)) {
    return null;
  }

  // ---- FOLDER: ends with `/` ----
  if (text.endsWith('/')) {
    const path = normalizePath(text.slice(0, -1));

    if (!path) {
      return null;
    }

    const segments = path.split('/');
    const name = segments[segments.length - 1];

    if (!name) {
      return null;
    }

    return { type: 'folder', icon: FOLDER_ICON, name, path };
  }

  // ---- FILE: last segment has a dot + extension ----
  const normalized = normalizePath(text);
  const segments = normalized.split('/');
  const fileName = segments[segments.length - 1];
  const ext = getExtension(fileName);

  /*
   * No extension → not a file path (could be a folder without trailing slash
   * or a code identifier). Leave as plain code to avoid false positives.
   */
  if (!ext) {
    return null;
  }

  const icon = EXT_ICON_MAP[ext] ?? DEFAULT_FILE_ICON;

  return {
    type: 'file',
    icon,
    name: fileName,
    ext,
    path: normalized,
  };
}
