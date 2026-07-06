import { memo, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import { detectPill, type PillMeta } from '~/lib/chat/file-pill';
import { getFileTypeIconClass } from '~/components/workbench/file-icon-map';
import styles from './chat-copilot.module.scss';

interface FilePillProps {
  /** The raw inline-code text (e.g. `app/_layout.jsx` or `components/ui/`). */
  raw: string;
}

/**
 * Inline-code file/folder pill — replaces plain `<code>` when the AI mentions
 * a file path or folder path inside backticks.
 *
 *   `app/_layout.jsx`  →  [⚛ _layout.jsx]        (file-type icon, matches workbench)
 *   `components/ui/`   →  [📁 ui]                (folder icon, amber)
 *
 * The pill is CLICKABLE when the path exists in the live workspace — clicking
 * it opens the workbench and focuses the file (or switches to the code view
 * for folders). When the path doesn't exist yet, the pill renders as a
 * non-interactive styled chip so it still looks distinctive but doesn't lie
 * about being clickable.
 *
 * Falls back to a plain `<code>` element if `detectPill` returns null (the
 * inline code isn't a file/folder path — e.g. `useState`, `npm install`).
 *
 * File-type icons use the SAME mapping as the workspace file tree
 * (getFileTypeIconClass from workbench/file-icon-map.ts) — vscode-icons
 * classes resolved by full filename (special files like package.json) then
 * by extension, falling back to a generic file icon. This keeps the inline
 * chat visually identical to the workbench.
 */
export const FilePill = memo(({ raw }: FilePillProps) => {
  const meta = useMemo(() => detectPill(raw), [raw]);
  const files = useStore(workbenchStore.files);

  /*
   * Does this path exist in the live workspace? We check both the
   * workspace-relative key (`app/foo.tsx`) and the full WORK_DIR-prefixed key
   * (`/home/project/app/foo.tsx`) because the file map uses the latter.
   */
  const exists = useMemo(() => {
    if (!meta || !files) {
      return false;
    }

    const fullKey = `${WORK_DIR}/${meta.path}`;
    const relKey = meta.path;

    return Boolean(files[fullKey] ?? files[relKey]);
  }, [meta, files]);

  if (!meta) {
    // Not a file/folder path → fall back to the default inline code style.
    return <code className={styles.inlineCode}>{raw}</code>;
  }

  const handleClick = () => {
    if (!exists) {
      return;
    }

    workbenchStore.showWorkbench.set(true);

    if (workbenchStore.currentView.get() !== 'code') {
      workbenchStore.currentView.set('code');
    }

    if (meta.type === 'file') {
      workbenchStore.setSelectedFile(`${WORK_DIR}/${meta.path}`);
    }

    /*
     * For folders, just showing the workbench + code view is enough — the
     * file tree renders and the user can see the folder.
     */
  };

  /*
   * File-type icon: uses the SAME vscode-icons mapping as the workspace
   * file tree (getFileTypeIconClass), so inline-chat pills match the
   * workbench exactly. Resolves special files (package.json, Dockerfile,
   * …) by full filename, then by extension, then falls back to a generic
   * file icon. Folders use a Phosphor folder icon.
   */
  const iconClass = meta.type === 'folder' ? 'i-ph:folder-simple' : getFileTypeIconClass(meta.name);

  return (
    <button
      type="button"
      onClick={handleClick}
      disabled={!exists}
      className={classNames(
        styles.filePill,
        meta.type === 'folder' ? styles.folderPill : styles.filePillFile,
        !exists && styles.filePillDisabled,
      )}
      title={exists ? meta.path : `${meta.path} (not in workspace)`}
      data-pill-type={meta.type}
    >
      <span className={classNames(styles.filePillIcon, iconClass)} aria-hidden />
      <span className={styles.filePillName}>{meta.name}</span>
    </button>
  );
});

FilePill.displayName = 'FilePill';

export type { PillMeta };
