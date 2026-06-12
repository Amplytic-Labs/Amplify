import { memo, useEffect, useRef, useState } from 'react';
import { webcontainer } from '~/lib/webcontainer';
import { extractRelativePath } from '~/utils/diff';

interface DocxRendererProps {
  filePath: string;
  content: string; // May be base64-encoded for binary files, or empty if not yet read
}

/**
 * Renders a .docx file using the docx-preview library.
 * Accepts base64-encoded content (as stored in the FilesStore for binary files).
 * Falls back to reading the file from the WebContainer filesystem when content is empty.
 */
export const DocxRenderer = memo(({ filePath, content }: DocxRendererProps) => {
  const containerRef = useRef<HTMLDivElement>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;

    async function render() {
      if (!containerRef.current) {
        return;
      }

      setIsLoading(true);
      setError(null);

      try {
        // Clear previous render
        const container = containerRef.current;
        container.innerHTML = '';

        let arrayBuffer: ArrayBuffer;

        if (content) {
          // Content is stored as base64 for binary files created via createFile
          const binaryString = atob(content);
          const bytes = new Uint8Array(binaryString.length);

          for (let i = 0; i < binaryString.length; i++) {
            bytes[i] = binaryString.charCodeAt(i);
          }

          arrayBuffer = bytes.buffer as ArrayBuffer;
        } else {
          // Content is empty (file detected via watcher); read from WebContainer
          const wc = await webcontainer;
          const relativePath = extractRelativePath(filePath);
          const data = await wc.fs.readFile(relativePath);
          arrayBuffer = data.buffer as ArrayBuffer;
        }

        if (cancelled) {
          return;
        }

        const { renderAsync } = await import('docx-preview');

        if (cancelled) {
          return;
        }

        await renderAsync(arrayBuffer, container, undefined, {
          className: 'docx-preview',
          inWrapper: true,
          ignoreWidth: false,
          ignoreHeight: false,
          ignoreFonts: false,
          breakPages: true,
          useBase64URL: true,
          renderHeaders: true,
          renderFooters: true,
          renderFootnotes: true,
          renderEndnotes: true,
          ignoreLastRenderedPageBreak: true,
        });

        if (!cancelled) {
          setIsLoading(false);
        }
      } catch (err) {
        if (!cancelled) {
          console.error('Failed to render DOCX file:', err);
          setError(err instanceof Error ? err.message : 'Failed to render DOCX file');
          setIsLoading(false);
        }
      }
    }

    render();

    return () => {
      cancelled = true;
    };
  }, [filePath, content]);

  if (error) {
    return (
      <div className="flex items-center justify-center h-full text-bolt-elements-textSecondary p-6">
        <div className="text-center">
          <div className="i-ph:warning text-4xl mb-2 text-bolt-elements-textTertiary" />
          <p className="text-sm font-medium text-bolt-elements-textPrimary mb-1">DOCX Render Error</p>
          <p className="text-xs text-bolt-elements-textTertiary">{error}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="h-full w-full overflow-auto bg-bolt-elements-background-depth-1 relative">
      {isLoading && (
        <div className="absolute inset-0 flex items-center justify-center bg-bolt-elements-background-depth-1/80 z-10">
          <div className="flex flex-col items-center gap-2">
            <div className="i-ph:spinner-gap text-3xl animate-spin text-bolt-elements-item-contentAccent" />
            <span className="text-sm text-bolt-elements-textSecondary">Rendering document...</span>
          </div>
        </div>
      )}
      <div ref={containerRef} className="docx-container p-4" />
    </div>
  );
});

DocxRenderer.displayName = 'DocxRenderer';
