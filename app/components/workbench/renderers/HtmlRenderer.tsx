import { memo } from 'react';

interface HtmlRendererProps {
  filePath: string;
  content: string;
}

/**
 * Renders HTML content inside a sandboxed iframe.
 * Used by the RenderPanel for .html files.
 */
export const HtmlRenderer = memo(({ filePath: _filePath, content }: HtmlRendererProps) => {
  return (
    <div className="h-full w-full bg-white">
      <iframe
        srcDoc={content}
        style={{ width: '100%', height: '100%', border: 'none' }}
        sandbox="allow-scripts allow-forms allow-popups allow-modals"
        title="HTML Preview"
      />
    </div>
  );
});

HtmlRenderer.displayName = 'HtmlRenderer';
