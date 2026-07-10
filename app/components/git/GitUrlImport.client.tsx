import { useSearchParams, useNavigate } from '@remix-run/react';
import { generateId, type Message } from 'ai';
import ignore from 'ignore';
import { useEffect, useState } from 'react';
import { ClientOnly } from 'remix-utils/client-only';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { useGit } from '~/lib/hooks/useGit';
import { useChatHistory } from '~/lib/persistence';
import { createCommandsMessage, detectProjectCommands, escapeAmplifyTags } from '~/utils/projectCommands';
import { LoadingOverlay } from '~/components/ui/LoadingOverlay';
import { toast } from 'react-toastify';
import type { FileMap } from '~/lib/stores/files';
import { WORK_DIR } from '~/utils/constants';

/*
 * Build a FileMap (keyed by full WORK_DIR paths, matching how the
 * `workbenchStore.files` store and the file watcher key entries) from a list
 * of `{ path, content }` records whose `path` is relative to the workdir.
 *
 * Also synthesizes `folder` entries for every parent directory so the file
 * tree renders correctly when the map is restored into the workbench store.
 */
function buildFileMapFromContents(
  files: Array<{ path: string; content: string }>,
): FileMap {
  const fileMap: FileMap = {};

  for (const file of files) {
    const fullPath = `${WORK_DIR}/${file.path}`;
    fileMap[fullPath] = {
      type: 'file',
      content: file.content,
      isBinary: false,
    };

    // Create folder entries for every parent directory (relative parts).
    const parts = file.path.split('/');

    let current = WORK_DIR;

    for (let i = 0; i < parts.length - 1; i++) {
      current = `${current}/${parts[i]}`;

      if (!fileMap[current]) {
        fileMap[current] = { type: 'folder' };
      }
    }
  }

  return fileMap;
}

const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '.github/**',
  '.vscode/**',
  '**/*.jpg',
  '**/*.jpeg',
  '**/*.png',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.vscode/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',

  // Include this so npm install runs much faster '**/*lock.json',
  '**/*lock.yaml',
];

export function GitUrlImport() {
  const [searchParams] = useSearchParams();
  const navigate = useNavigate();
  const { ready: historyReady, importChat } = useChatHistory();
  const { ready: gitReady, gitClone } = useGit();
  const [imported, setImported] = useState(false);
  const [loading, setLoading] = useState(true);

  const importRepo = async (repoUrl?: string) => {
    if (!gitReady && !historyReady) {
      return;
    }

    if (repoUrl) {
      const ig = ignore().add(IGNORE_PATTERNS);

      try {
        const { workdir, data } = await gitClone(repoUrl);

        if (importChat) {
          const filePaths = Object.keys(data).filter((filePath) => !ig.ignores(filePath));
          const textDecoder = new TextDecoder('utf-8');

          const fileContents = filePaths
            .map((filePath) => {
              const { data: content, encoding } = data[filePath];
              return {
                path: filePath,
                content:
                  encoding === 'utf8' ? content : content instanceof Uint8Array ? textDecoder.decode(content) : '',
              };
            })
            .filter((f) => f.content);

          const commands = await detectProjectCommands(fileContents);
          const commandsMessage = createCommandsMessage(commands);

          const filesMessage: Message = {
            role: 'assistant',
            content: `Cloning the repo ${repoUrl} into ${workdir}
<amplifyArtifact id="imported-files" title="Git Cloned Files"  type="bundled">
${fileContents
  .map(
    (file) =>
      `<amplifyAction type="file" filePath="${file.path}">
${escapeAmplifyTags(file.content)}
</amplifyAction>`,
  )
  .join('\n')}
</amplifyArtifact>`,
            id: generateId(),
            createdAt: new Date(),
          };

          const messages = [filesMessage];

          if (commandsMessage) {
            messages.push({
              role: 'user',
              id: generateId(),
              content: 'Setup the codebase and Start the application',
            });
            messages.push(commandsMessage);
          }

          /*
           * Build a FileMap from the cloned files so `importChat` can persist
           * them to IndexedDB (project_files / project_commits). Without this,
           * only the chat that initiated the clone can see the files — new
           * chats linked to the same project get an empty workspace because
           * `getProjectFiles()` returns undefined.
           */
          const initialFileMap = buildFileMapFromContents(fileContents);

          await importChat(
            `Git Project:${repoUrl.split('/').slice(-1)[0]}`,
            messages,
            { gitUrl: repoUrl },
            initialFileMap,
          );
        }
      } catch (error) {
        console.error('Error during import:', error);
        toast.error('Failed to import repository');
        setLoading(false);
        navigate('/');

        return;
      }
    }
  };

  useEffect(() => {
    if (!historyReady || !gitReady || imported) {
      return;
    }

    const url = searchParams.get('url');

    if (!url) {
      navigate('/');
      return;
    }

    importRepo(url).catch((error) => {
      console.error('Error importing repo:', error);
      toast.error('Failed to import repository');
      setLoading(false);
      navigate('/');
    });
    setImported(true);
  }, [searchParams, historyReady, gitReady, imported, navigate]);

  return (
    <ClientOnly fallback={<BaseChat />}>
      {() => (
        <>
          <Chat />
          {loading && <LoadingOverlay message="Please wait while we clone the repository..." />}
        </>
      )}
    </ClientOnly>
  );
}
