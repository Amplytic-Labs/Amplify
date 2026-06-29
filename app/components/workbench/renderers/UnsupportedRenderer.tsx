import { memo } from 'react';
import { getFileExtension } from '~/lib/renderable/registry';

interface UnsupportedRendererProps {
  filePath: string;
  content?: string;
}

/**
 * Fallback renderer shown when no specific renderer exists for a file type.
 */
export const UnsupportedRenderer = memo(({ filePath }: UnsupportedRendererProps) => {
  const extension = getFileExtension(filePath);

  return (
    <div className="flex items-center justify-center h-full text-amplify-elements-textSecondary">
      <div className="text-center">
        <div className="i-ph:file-question text-4xl mb-2 text-amplify-elements-textTertiary" />
        <p className="text-sm">No renderer available for .{extension} files.</p>
      </div>
    </div>
  );
});

UnsupportedRenderer.displayName = 'UnsupportedRenderer';
