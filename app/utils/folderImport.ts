import type { UIMessage } from 'ai';
import { generateId } from './fileUtils';
import { detectProjectCommands, createCommandsMessage, escapeAmplifyTags } from './projectCommands';

export const createChatFromFolder = async (
  files: File[],
  binaryFiles: string[],
  folderName: string,
): Promise<UIMessage[]> => {
  const fileArtifacts = await Promise.all(
    files.map(async (file) => {
      return new Promise<{ content: string; path: string }>((resolve, reject) => {
        const reader = new FileReader();

        reader.onload = () => {
          const content = reader.result as string;
          const relativePath = file.webkitRelativePath.split('/').slice(1).join('/');
          resolve({
            content,
            path: relativePath,
          });
        };
        reader.onerror = reject;
        reader.readAsText(file);
      });
    }),
  );

  const commands = await detectProjectCommands(fileArtifacts);
  const commandsMessage = createCommandsMessage(commands);

  const binaryFilesMessage =
    binaryFiles.length > 0
      ? `\n\nSkipped ${binaryFiles.length} binary files:\n${binaryFiles.map((f) => `- ${f}`).join('\n')}`
      : '';

  const filesMessage: UIMessage = {
    role: 'assistant',
    id: generateId(),
    // AI SDK v7: createdAt not part of UIMessage, using type assertion
    ...( { createdAt: new Date() } as any),
    parts: [{
      type: 'text' as const,
      text: `I've imported the contents of the "${folderName}" folder.${binaryFilesMessage}

<amplifyArtifact id="imported-files" title="Imported Files" type="bundled" >
${fileArtifacts
  .map(
    (file) => `<amplifyAction type="file" filePath="${file.path}">
${escapeAmplifyTags(file.content)}
</amplifyAction>`,
  )
  .join('\n\n')}
</amplifyArtifact>`,
    }],
  };

  const userMessage: UIMessage = {
    role: 'user',
    id: generateId(),
    // AI SDK v7: createdAt not part of UIMessage, using type assertion
    ...( { createdAt: new Date() } as any),
    parts: [{
      type: 'text' as const,
      text: `Import the "${folderName}" folder`,
    }],
  };

  const messages = [userMessage, filesMessage];

  if (commandsMessage) {
    messages.push({
      role: 'user',
      id: generateId(),
      parts: [{
        type: 'text' as const,
        text: 'Setup the codebase and Start the application',
      }],
    });
    messages.push(commandsMessage);
  }

  return messages;
};
