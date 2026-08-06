import { memo, useCallback, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { findRenderableFiles, getFileExtension } from '~/lib/renderable/registry';
import { getRenderer } from './renderers';
import { path } from '~/utils/path';
import { extractRelativePath } from '~/utils/diff';
import { classNames } from '~/utils/classNames';

/**
 * RenderPanel – the main render view shown in the Render tab of the Workbench.
 *
 * Layout:
 *  ┌──────────────────────────────────┐
 *  │ [filename] [chevron ▼]          │  ← toolbar
 *  ├──────────────────────────────────┤
 *  │                                  │
 *  │     (renderer output)            │  ← content area
 *  │                                  │
 *  └──────────────────────────────────┘
 */
export const RenderPanel = memo(() => {
  const files = useStore(workbenchStore.files);
  const [selectedFilePath, setSelectedFilePath] = useState<string | null>(null);
  const [isDropdownOpen, setIsDropdownOpen] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');

  // Derive the list of renderable files whenever the files map changes.
  const renderableFiles = useMemo(() => findRenderableFiles(files), [files]);

  // Effective selected file: the user's pick, or the first renderable file as default.
  const activeFile =
    selectedFilePath && renderableFiles.includes(selectedFilePath) ? selectedFilePath : (renderableFiles[0] ?? null);

  // File content from the store (may be empty for binary files from the watcher).
  const activeFileContent = activeFile ? ((files[activeFile] as { content?: string })?.content ?? '') : '';

  // Get the appropriate renderer for the active file.
  const Renderer = activeFile ? getRenderer(activeFile) : null;

  // Relative display name for the file.
  const displayName = activeFile ? path.basename(extractRelativePath(activeFile)) : '';

  // Filtered list for the dropdown search.
  const filteredFiles = useMemo(() => {
    if (!searchQuery.trim()) {
      return renderableFiles;
    }

    const query = searchQuery.toLowerCase();

    return renderableFiles.filter((fp) => fp.toLowerCase().includes(query));
  }, [renderableFiles, searchQuery]);

  const handleSelectFile = useCallback((filePath: string) => {
    setSelectedFilePath(filePath);
    setIsDropdownOpen(false);
    setSearchQuery('');
  }, []);

  // Helper to get an icon class per extension
  const getIconForExtension = (ext: string) => {
    switch (ext) {
      case 'html':
        return 'i-ph:code';
      case 'docx':
        return 'i-ph:file-doc';
      default:
        return 'i-ph:file-text';
    }
  };

  if (renderableFiles.length === 0) {
    return (
      <div className="flex items-center justify-center h-full text-amplify-elements-textSecondary">
        <div className="text-center">
          <div className="i-ph:file-x text-4xl mb-2 text-amplify-elements-textTertiary" />
          <p className="text-sm font-medium text-amplify-elements-textPrimary">No renderable files found</p>
          <p className="text-xs text-amplify-elements-textTertiary mt-1">
            Add an .html or .docx file to your project to preview it here.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div className="flex flex-col h-full w-full">
      {/* Toolbar */}
      <div className="bg-amplify-elements-background-depth-2 px-3 py-2 flex items-center gap-2 border-b border-amplify-elements-borderColor">
        {/* Active file name (click to re-render) */}
        <button
          className="flex items-center gap-1.5 text-sm font-medium text-amplify-elements-textPrimary hover:text-amplify-elements-item-contentAccent transition-colors bg-transparent"
          onClick={() => {
            // Force a re-render by toggling to null and back
            setSelectedFilePath(null);
            setTimeout(() => setSelectedFilePath(activeFile), 0);
          }}
          title={activeFile ? extractRelativePath(activeFile) : ''}
        >
          {activeFile && (
            <div
              className={classNames(
                getIconForExtension(getFileExtension(activeFile)),
                'text-base text-amplify-elements-textTertiary',
              )}
            />
          )}
          <span>{displayName}</span>
        </button>

        {/* Chevron dropdown trigger */}
        <div className="relative">
          <button
            className="flex items-center justify-center w-6 h-6 rounded hover:bg-amplify-elements-background-depth-3 transition-colors bg-transparent"
            onClick={() => setIsDropdownOpen((prev) => !prev)}
            title="Select a renderable file"
          >
            <div
              className={classNames(
                'i-ph:caret-down text-sm text-amplify-elements-textTertiary transition-transform',
                isDropdownOpen ? 'rotate-180' : '',
              )}
            />
          </button>

          {/* Dropdown */}
          {isDropdownOpen && (
            <>
              {/* Backdrop to close */}
              <div className="fixed inset-0 z-40" onClick={() => setIsDropdownOpen(false)} />

              <div className="absolute left-0 top-full mt-1 z-50 w-80 max-h-80 overflow-hidden bg-amplify-elements-background-depth-2 shadow-xl border border-amplify-elements-borderColor rounded-xl">
                {/* Search input */}
                <div className="p-2 border-b border-amplify-elements-borderColor">
                  <div className="relative">
                    <div className="absolute left-2.5 top-1/2 -translate-y-1/2 text-amplify-elements-textTertiary">
                      <div className="i-ph:magnifying-glass text-sm" />
                    </div>
                    <input
                      type="text"
                      placeholder="Search renderable files..."
                      value={searchQuery}
                      onChange={(e) => setSearchQuery(e.target.value)}
                      className="w-full pl-8 pr-3 py-1.5 text-sm rounded-lg bg-amplify-elements-background-depth-1 border border-amplify-elements-borderColor focus:outline-none focus:ring-2 focus:ring-accent-500/50 text-amplify-elements-textPrimary"
                      autoFocus
                    />
                  </div>
                </div>

                {/* File list */}
                <div className="overflow-y-auto max-h-60">
                  {filteredFiles.length > 0 ? (
                    filteredFiles.map((fp) => {
                      const relPath = extractRelativePath(fp);
                      const name = path.basename(relPath);
                      const ext = getFileExtension(fp);
                      const isActive = fp === activeFile;

                      return (
                        <button
                          key={fp}
                          onClick={() => handleSelectFile(fp)}
                          className={classNames(
                            'w-full px-3 py-2.5 text-left flex items-center gap-2.5 transition-colors bg-transparent group',
                            isActive
                              ? 'bg-amplify-elements-item-backgroundActive text-amplify-elements-item-contentAccent'
                              : 'hover:bg-amplify-elements-background-depth-1 text-amplify-elements-textPrimary',
                          )}
                        >
                          <div
                            className={classNames(
                              getIconForExtension(ext),
                              'text-base shrink-0',
                              isActive
                                ? 'text-amplify-elements-item-contentAccent'
                                : 'text-amplify-elements-textTertiary group-hover:text-amplify-elements-item-contentActive',
                            )}
                          />
                          <div className="flex-1 min-w-0">
                            <p className="text-sm font-medium truncate">{name}</p>
                            <p
                              className={classNames(
                                'text-xs truncate',
                                isActive
                                  ? 'text-amplify-elements-item-contentAccent/70'
                                  : 'text-amplify-elements-textTertiary',
                              )}
                            >
                              {relPath}
                            </p>
                          </div>
                          {isActive && (
                            <div className="shrink-0 text-amplify-elements-item-contentAccent">
                              <svg
                                xmlns="http://www.w3.org/2000/svg"
                                width="14"
                                height="14"
                                viewBox="0 0 24 24"
                                fill="none"
                                stroke="currentColor"
                                strokeWidth="2.5"
                                strokeLinecap="round"
                                strokeLinejoin="round"
                              >
                                <polyline points="20 6 9 17 4 12" />
                              </svg>
                            </div>
                          )}
                        </button>
                      );
                    })
                  ) : (
                    <div className="flex flex-col items-center justify-center p-4 text-center">
                      <div className="i-ph:file-dashed text-3xl text-amplify-elements-textTertiary mb-1" />
                      <p className="text-xs text-amplify-elements-textTertiary">No matching files</p>
                    </div>
                  )}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {/* Content area */}
      <div className="flex-1 overflow-hidden">
        {Renderer && activeFile ? (
          <Renderer filePath={activeFile} content={activeFileContent} />
        ) : (
          <div className="flex items-center justify-center h-full text-amplify-elements-textSecondary">
            Select a file to render.
          </div>
        )}
      </div>
    </div>
  );
});

RenderPanel.displayName = 'RenderPanel';
