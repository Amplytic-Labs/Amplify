/**
 * Central registry for renderable file types.
 * Adding a new format only requires:
 *   1. Adding the extension to RENDERABLE_EXTENSIONS
 *   2. Creating a renderer component
 *   3. Registering it in the RENDERER_MAP (done in renderers/index.ts)
 */

export const RENDERABLE_EXTENSIONS = ['html', 'docx'] as const;

export type RenderableExtension = (typeof RENDERABLE_EXTENSIONS)[number];

/**
 * Check whether a given file path has a renderable extension.
 */
export function isRenderableFile(filePath: string): boolean {
  const ext = getFileExtension(filePath);
  return (RENDERABLE_EXTENSIONS as readonly string[]).includes(ext);
}

/**
 * Extract the lowercased extension from a file path.
 */
export function getFileExtension(filePath: string): string {
  return filePath.split('.').pop()?.toLowerCase() ?? '';
}

/**
 * Scan a record of files (from the files store) and return all paths that are renderable.
 */
export function findRenderableFiles(files: Record<string, { type: string } | undefined>): string[] {
  return Object.entries(files)
    .filter(([filePath, dirent]) => dirent?.type === 'file' && isRenderableFile(filePath))
    .map(([filePath]) => filePath);
}
