import ignore from 'ignore';
import { useGit } from '~/lib/hooks/useGit';
import { detectProjectCommands } from '~/utils/projectCommands';
import { useState } from 'react';
import { toast } from '~/components/ui/toast';
import { LoadingOverlay } from '~/components/ui/LoadingOverlay';

import { classNames } from '~/utils/classNames';
import { Button } from '~/components/ui/Button';
import type { IChatMetadata } from '~/lib/persistence/db';
import { X, Github, GitBranch } from 'lucide-react';
import type { FileMap } from '~/lib/stores/files';
import { WORK_DIR, chatNameForRepo } from '~/utils/constants';

/*
 * Build a FileMap (keyed by full WORK_DIR paths, matching how the
 * `workbenchStore.files` store and the file watcher key entries) from a list
 * of `{ path, content }` records whose `path` is relative to the workdir.
 * Also synthesizes `folder` entries for every parent directory.
 */
function buildFileMapFromContents(files: Array<{ path: string; content: string }>): FileMap {
  const fileMap: FileMap = {};

  for (const file of files) {
    const fullPath = `${WORK_DIR}/${file.path}`;
    fileMap[fullPath] = {
      type: 'file',
      content: file.content,
      isBinary: false,
    };

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

// Import the new repository selector components
import { GitHubRepositorySelector } from '~/components/@settings/tabs/github/components/GitHubRepositorySelector';
import { GitLabRepositorySelector } from '~/components/@settings/tabs/gitlab/components/GitLabRepositorySelector';

const IGNORE_PATTERNS = [
  'node_modules/**',
  '.git/**',
  '.github/**',
  '.vscode/**',
  'dist/**',
  'build/**',
  '.next/**',
  'coverage/**',
  '.cache/**',
  '.idea/**',
  '**/*.log',
  '**/.DS_Store',
  '**/npm-debug.log*',
  '**/yarn-debug.log*',
  '**/yarn-error.log*',

  // Include this so npm install runs much faster '**/*lock.json',
  '**/*lock.yaml',
];

const ig = ignore().add(IGNORE_PATTERNS);

const MAX_FILE_SIZE = 100 * 1024; // 100KB limit per file
const MAX_TOTAL_SIZE = 500 * 1024; // 500KB total limit

interface GitCloneButtonProps {
  className?: string;
  importChat?: (
    description: string,
    messages: Message[],
    metadata?: IChatMetadata,
    initialFileMap?: FileMap,
  ) => Promise<void>;
}

export default function GitCloneButton({ importChat, className }: GitCloneButtonProps) {
  const { ready, gitClone } = useGit();
  const [loading, setLoading] = useState(false);
  const [isDialogOpen, setIsDialogOpen] = useState(false);
  const [selectedProvider, setSelectedProvider] = useState<'github' | 'gitlab' | null>(null);

  const handleClone = async (repoUrl: string) => {
    if (!ready) {
      return;
    }

    setLoading(true);
    setIsDialogOpen(false);
    setSelectedProvider(null);

    try {
      const { data } = await gitClone(repoUrl);

      if (importChat) {
        const filePaths = Object.keys(data).filter((filePath) => !ig.ignores(filePath));
        const textDecoder = new TextDecoder('utf-8');

        let totalSize = 0;
        const skippedFiles: string[] = [];
        const fileContents = [];

        for (const filePath of filePaths) {
          const { data: content, encoding } = data[filePath];

          // Skip binary files
          if (
            content instanceof Uint8Array &&
            !filePath.match(/\.(txt|md|astro|mjs|js|jsx|ts|tsx|json|html|css|scss|less|yml|yaml|xml|svg|vue|svelte)$/i)
          ) {
            skippedFiles.push(filePath);
            continue;
          }

          try {
            const textContent =
              encoding === 'utf8' ? content : content instanceof Uint8Array ? textDecoder.decode(content) : '';

            if (!textContent) {
              continue;
            }

            // Check file size
            const fileSize = new TextEncoder().encode(textContent).length;

            if (fileSize > MAX_FILE_SIZE) {
              skippedFiles.push(`${filePath} (too large: ${Math.round(fileSize / 1024)}KB)`);
              continue;
            }

            // Check total size
            if (totalSize + fileSize > MAX_TOTAL_SIZE) {
              skippedFiles.push(`${filePath} (would exceed total size limit)`);
              continue;
            }

            totalSize += fileSize;
            fileContents.push({
              path: filePath,
              content: textContent,
            });
          } catch (e: any) {
            skippedFiles.push(`${filePath} (error: ${e.message})`);
          }
        }

        const commands = await detectProjectCommands(fileContents);

        /*
         * SILENT FILE LOADING: Do NOT create chat messages for system-initiated
         * file loading. Previously this built a `filesMessage` (with
         * "Cloning the repo..." text + a bundled artifact that rendered as
         * "Created N files") and a `commandsMessage` (with "Found 'start'
         * script..." text). Those messages cluttered the chat and confused
         * users into thinking the AI created the files.
         *
         * Now we pass an EMPTY messages array. The files are persisted to
         * IndexedDB via `initialFileMap` (importChat calls createProjectCommit
         * + detectProjectCommands + setProjectCommands). After the page
         * reload, `restoreFileMap` writes files to the WebContainer from
         * IndexedDB, and `runProjectAutoSetup` silently runs npm install +
         * start. The chat starts clean — no file-loading messages.
         *
         * The `commands` variable is still computed here for potential future
         * use but is NOT embedded in any message. importChat detects commands
         * independently from the FileMap.
         */
        void commands; // detected inside importChat via initialFileMap

        if (skippedFiles.length > 0) {
          console.log(`[GitClone] Skipped ${skippedFiles.length} files:`, skippedFiles);
        }

        const initialFileMap = buildFileMapFromContents(fileContents);

        await importChat(chatNameForRepo(repoUrl), [], undefined, initialFileMap);
      }
    } catch (error) {
      console.error('Error during import:', error);
      toast.error('Failed to import repository');
    } finally {
      setLoading(false);
    }
  };

  return (
    <>
      <Button
        onClick={() => {
          setSelectedProvider(null);
          setIsDialogOpen(true);
        }}
        title="Clone a repo"
        variant="default"
        size="lg"
        className={classNames(
          'gap-2 bg-amplify-elements-background-depth-1',
          'text-amplify-elements-textPrimary',
          'hover:bg-amplify-elements-background-depth-2',
          'border border-amplify-elements-borderColor',
          'h-10 px-4 py-2 min-w-[120px] justify-center',
          'transition-all duration-200 ease-in-out',
          className,
        )}
        disabled={!ready || loading}
      >
        Clone a repo
        <div className="flex items-center gap-1 ml-2">
          <Github className="w-4 h-4" />
          <GitBranch className="w-4 h-4" />
        </div>
      </Button>

      {/* Provider Selection Dialog */}
      {isDialogOpen && !selectedProvider && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl border border-amplify-elements-borderColor dark:border-amplify-elements-borderColor max-w-md w-full">
            <div className="p-6">
              <div className="flex items-center justify-between mb-4">
                <h3 className="text-lg font-semibold text-amplify-elements-textPrimary dark:text-amplify-elements-textPrimary">
                  Choose Repository Provider
                </h3>
                <button
                  onClick={() => setIsDialogOpen(false)}
                  className="p-2 rounded-lg bg-transparent hover:bg-amplify-elements-background-depth-1 dark:hover:bg-amplify-elements-background-depth-1 text-amplify-elements-textSecondary dark:text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary dark:hover:text-amplify-elements-textPrimary transition-all duration-200 hover:scale-105 active:scale-95"
                >
                  <X className="w-5 h-5 transition-transform duration-200 hover:rotate-90" />
                </button>
              </div>

              <div className="space-y-3">
                <button
                  onClick={() => setSelectedProvider('github')}
                  className="w-full p-4 rounded-lg bg-amplify-elements-background-depth-1 dark:bg-amplify-elements-background-depth-1 hover:bg-amplify-elements-background-depth-2 dark:hover:bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor dark:border-amplify-elements-borderColor hover:border-amplify-elements-borderColorActive dark:hover:border-amplify-elements-borderColorActive transition-all duration-200 text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center group-hover:bg-blue-500/20 dark:group-hover:bg-blue-500/30 transition-colors">
                      <Github className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                    </div>
                    <div>
                      <div className="font-medium text-amplify-elements-textPrimary dark:text-amplify-elements-textPrimary">
                        GitHub
                      </div>
                      <div className="text-sm text-amplify-elements-textSecondary dark:text-amplify-elements-textSecondary">
                        Clone from GitHub repositories
                      </div>
                    </div>
                  </div>
                </button>

                <button
                  onClick={() => setSelectedProvider('gitlab')}
                  className="w-full p-4 rounded-lg bg-amplify-elements-background-depth-1 dark:bg-amplify-elements-background-depth-1 hover:bg-amplify-elements-background-depth-2 dark:hover:bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor dark:border-amplify-elements-borderColor hover:border-amplify-elements-borderColorActive dark:hover:border-amplify-elements-borderColorActive transition-all duration-200 text-left group"
                >
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-lg bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center group-hover:bg-orange-500/20 dark:group-hover:bg-orange-500/30 transition-colors">
                      <GitBranch className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                    </div>
                    <div>
                      <div className="font-medium text-amplify-elements-textPrimary dark:text-amplify-elements-textPrimary">
                        GitLab
                      </div>
                      <div className="text-sm text-amplify-elements-textSecondary dark:text-amplify-elements-textSecondary">
                        Clone from GitLab repositories
                      </div>
                    </div>
                  </div>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* GitHub Repository Selection */}
      {isDialogOpen && selectedProvider === 'github' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl border border-amplify-elements-borderColor dark:border-amplify-elements-borderColor w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-amplify-elements-borderColor dark:border-amplify-elements-borderColor flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-blue-500/10 dark:bg-blue-500/20 flex items-center justify-center">
                  <Github className="w-6 h-6 text-blue-600 dark:text-blue-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-amplify-elements-textPrimary dark:text-amplify-elements-textPrimary">
                    Import GitHub Repository
                  </h3>
                  <p className="text-sm text-amplify-elements-textSecondary dark:text-amplify-elements-textSecondary">
                    Clone a repository from GitHub to your workspace
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDialogOpen(false);
                  setSelectedProvider(null);
                }}
                className="p-2 rounded-lg bg-transparent hover:bg-amplify-elements-background-depth-1 dark:hover:bg-amplify-elements-background-depth-1 text-amplify-elements-textSecondary dark:text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary dark:hover:text-amplify-elements-textPrimary transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <X className="w-5 h-5 transition-transform duration-200 hover:rotate-90" />
              </button>
            </div>

            <div className="p-6 max-h-[calc(90vh-140px)] overflow-y-auto">
              <GitHubRepositorySelector onClone={handleClone} />
            </div>
          </div>
        </div>
      )}

      {/* GitLab Repository Selection */}
      {isDialogOpen && selectedProvider === 'gitlab' && (
        <div className="fixed inset-0 bg-black/50 backdrop-blur-sm z-50 flex items-center justify-center p-4">
          <div className="bg-white dark:bg-gray-950 rounded-xl shadow-xl border border-amplify-elements-borderColor dark:border-amplify-elements-borderColor w-full max-w-4xl max-h-[90vh] overflow-hidden">
            <div className="p-6 border-b border-amplify-elements-borderColor dark:border-amplify-elements-borderColor flex items-center justify-between">
              <div className="flex items-center gap-3">
                <div className="w-10 h-10 rounded-lg bg-orange-500/10 dark:bg-orange-500/20 flex items-center justify-center">
                  <GitBranch className="w-6 h-6 text-orange-600 dark:text-orange-400" />
                </div>
                <div>
                  <h3 className="text-lg font-semibold text-amplify-elements-textPrimary dark:text-amplify-elements-textPrimary">
                    Import GitLab Repository
                  </h3>
                  <p className="text-sm text-amplify-elements-textSecondary dark:text-amplify-elements-textSecondary">
                    Clone a repository from GitLab to your workspace
                  </p>
                </div>
              </div>
              <button
                onClick={() => {
                  setIsDialogOpen(false);
                  setSelectedProvider(null);
                }}
                className="p-2 rounded-lg bg-transparent hover:bg-amplify-elements-background-depth-1 dark:hover:bg-amplify-elements-background-depth-1 text-amplify-elements-textSecondary dark:text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary dark:hover:text-amplify-elements-textPrimary transition-all duration-200 hover:scale-105 active:scale-95"
              >
                <X className="w-5 h-5 transition-transform duration-200 hover:rotate-90" />
              </button>
            </div>

            <div className="p-6 max-h-[calc(90vh-140px)] overflow-y-auto">
              <GitLabRepositorySelector onClone={handleClone} />
            </div>
          </div>
        </div>
      )}

      {loading && <LoadingOverlay message="Please wait while we clone the repository..." />}
    </>
  );
}
