import { memo, useMemo } from 'react';
import { useStore } from '@nanostores/react';
import { classNames } from '~/utils/classNames';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import { detectPill, type PillMeta } from '~/lib/chat/file-pill';
import { getFileIconStyle } from './file-icons';
import styles from './chat-copilot.module.scss';

interface FilePillProps {
  /** The raw inline-code text (e.g. `app/_layout.jsx` or `components/ui/`). */
  raw: string;
}

/**
 * Inline-code file/folder pill — replaces plain `<code>` when the AI mentions
 * a file path or folder path inside backticks.
 *
 *   `app/_layout.jsx`  →  [⚛ _layout.jsx]        (React logo, cyan)
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
 * File-type icons are rendered as INLINE SVG data-URIs (see file-icons.ts)
 * so brand colours (React cyan, JS yellow, TS blue, …) show without relying
 * on UnoCSS icon auto-resolution.
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
   * File-type icon: inline SVG data-URI for brand-coloured icons, or a
   * Phosphor class for the generic fallback.
   */
  const iconStyle = meta.type === 'file' ? getFileIconStyle(meta.ext) : null;
  const iconClass = meta.type === 'folder' ? 'i-ph:folder-simple' : iconStyle ? null : 'i-ph:file';

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
      {iconStyle ? (
        <span className={styles.filePillIconSvg} style={iconStyle} aria-hidden />
      ) : (
        <span className={classNames(styles.filePillIcon, iconClass)} aria-hidden />
      )}
      <span className={styles.filePillName}>{meta.name}</span>
    </button>
  );
});

FilePill.displayName = 'FilePill';

export type { PillMeta };
