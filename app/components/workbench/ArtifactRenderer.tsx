import { memo } from 'react';
import ReactMarkdown from 'react-markdown';
import { useStore } from '@nanostores/react';
import { workbenchStore } from '~/lib/stores/workbench';
import { Mermaid } from '~/components/chat/Mermaid';
import { rehypePlugins, remarkPlugins } from '~/utils/markdown';
import { classNames } from '~/utils/classNames';

interface ArtifactRendererProps {
  filePath: string;
}

export const ArtifactRenderer = memo(({ filePath }: ArtifactRendererProps) => {
  const files = useStore(workbenchStore.files);
  const file = files[filePath];

  if (!file || file.type !== 'file') {
    return (
      <div className="flex items-center justify-center h-full text-amplify-elements-textSecondary">
        File not found or is not a file.
      </div>
    );
  }

  const content = file.content || '';
  const extension = filePath.split('.').pop()?.toLowerCase();

  if (extension === 'md') {
    return (
      <div className="h-full overflow-auto p-6 modern-scrollbar bg-amplify-elements-background">
        <ReactMarkdown
          remarkPlugins={remarkPlugins(false)}
          rehypePlugins={rehypePlugins(false)}
          className="prose prose-sm max-w-none text-amplify-elements-textPrimary"
        >
          {content}
        </ReactMarkdown>
      </div>
    );
  }

  if (extension === 'mermaid') {
    return (
      <div className="h-full overflow-auto flex items-center justify-center p-6 bg-amplify-elements-background">
        <Mermaid chart={content} />
      </div>
    );
  }

  if (extension === 'svg') {
    return (
      <div className="h-full overflow-auto flex items-center justify-center p-6 bg-amplify-elements-background">
        <div className="max-w-full max-h-full" dangerouslySetInnerHTML={{ __html: content }} />
      </div>
    );
  }

  if (extension === 'html') {
    return (
      <div className="h-full w-full bg-white">
        <iframe
          srcDoc={content}
          style={{ width: '100%', height: '100%', border: 'none' }}
          sandbox="allow-scripts allow-forms allow-popups allow-modals"
        />
      </div>
    );
  }

  return (
    <div className="flex items-center justify-center h-full text-amplify-elements-textSecondary">
      No renderer available for .{extension} files.
    </div>
  );
});
