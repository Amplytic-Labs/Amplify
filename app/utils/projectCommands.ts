import type { Message } from 'ai';
import { generateId } from './fileUtils';

export interface ProjectCommands {
  type: string;
  setupCommand?: string;
  startCommand?: string;
  followupMessage: string;
}

interface FileContent {
  content: string;
  path: string;
}

/*
 * Helper function to keep the setup command simple and predictable.
 * Previously this prepended `export CI=true …` and rewrote `npm install` into
 * `npm install --yes --no-audit --no-fund --silent` (the `--yes` flag is not a
 * valid `npm install` option and could confuse the package manager). It also
 * injected `npx update-browserslist-db@latest` and `npx shadcn@latest init`.
 *
 * Per user request we now keep the setup command as a plain `npm install` — no
 * environment exports, no extra npx calls, no shadcn init. The start command
 * runs only AFTER install finishes (the ActionRunner serializes actions and
 * project-auto-run.ts awaits setup before firing start).
 */
function makeNonInteractive(command: string): string {
  return command.trim();
}

export async function detectProjectCommands(files: FileContent[]): Promise<ProjectCommands> {
  const hasFile = (name: string) => files.some((f) => f.path.endsWith(name));

  if (hasFile('package.json')) {
    const packageJsonFile = files.find((f) => f.path.endsWith('package.json'));

    if (!packageJsonFile) {
      return { type: '', setupCommand: '', followupMessage: '' };
    }

    try {
      const packageJson = JSON.parse(packageJsonFile.content);
      const scripts = packageJson?.scripts || {};

      // Check for preferred commands in priority order
      const preferredCommands = ['dev', 'start', 'preview'];
      const availableCommand = preferredCommands.find((cmd) => scripts[cmd]);

      /*
       * Keep the setup command simple: just `npm install`.
       * (Previously this also ran `npx update-browserslist-db@latest` and, for
       * shadcn projects, `npx shadcn@latest init` — both removed per user
       * request. The start command runs only after install completes.)
       */
      const setupCommand = makeNonInteractive('npm install');

      if (availableCommand) {
        return {
          type: 'Node.js',
          setupCommand,
          startCommand: `npm run ${availableCommand}`,
          followupMessage: `Found "${availableCommand}" script in package.json. Running "npm run ${availableCommand}" after installation.`,
        };
      }

      return {
        type: 'Node.js',
        setupCommand,
        followupMessage:
          'Would you like me to inspect package.json to determine the available scripts for running this project?',
      };
    } catch (error) {
      console.error('Error parsing package.json:', error);
      return { type: '', setupCommand: '', followupMessage: '' };
    }
  }

  if (hasFile('index.html')) {
    return {
      type: 'Static',
      startCommand: 'npx --yes serve',
      followupMessage: '',
    };
  }

  return { type: '', setupCommand: '', followupMessage: '' };
}

export function createCommandsMessage(commands: ProjectCommands): Message | null {
  if (!commands.setupCommand && !commands.startCommand) {
    return null;
  }

  let commandString = '';

  if (commands.setupCommand) {
    commandString += `
<amplifyAction type="shell">${commands.setupCommand}</amplifyAction>`;
  }

  if (commands.startCommand) {
    commandString += `
<amplifyAction type="start">${commands.startCommand}</amplifyAction>
`;
  }

  return {
    role: 'assistant',
    content: `
${commands.followupMessage ? `\n\n${commands.followupMessage}` : ''}
<amplifyArtifact id="project-setup" title="Project Setup">
${commandString}
</amplifyArtifact>`,
    id: generateId(),
    createdAt: new Date(),
  };
}

export function escapeAmplifyArtifactTags(input: string) {
  // Regular expression to match amplifyArtifact tags and their content
  const regex = /(<amplifyArtifact[^>]*>)([\s\S]*?)(<\/amplifyArtifact>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeAmplifyActionTags(input: string) {
  // Regular expression to match amplifyAction tags and their content
  const regex = /(<amplifyAction[^>]*>)([\s\S]*?)(<\/amplifyAction>)/g;

  return input.replace(regex, (match, openTag, content, closeTag) => {
    // Escape the opening tag
    const escapedOpenTag = openTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Escape the closing tag
    const escapedCloseTag = closeTag.replace(/</g, '&lt;').replace(/>/g, '&gt;');

    // Return the escaped version
    return `${escapedOpenTag}${content}${escapedCloseTag}`;
  });
}

export function escapeAmplifyTags(input: string) {
  return escapeAmplifyArtifactTags(escapeAmplifyActionTags(input));
}

// We have this seperate function to simplify the restore snapshot process in to one single artifact.
export function createCommandActionsString(commands: ProjectCommands): string {
  if (!commands.setupCommand && !commands.startCommand) {
    // Return empty string if no commands
    return '';
  }

  let commandString = '';

  if (commands.setupCommand) {
    commandString += `
<amplifyAction type="shell">${commands.setupCommand}</amplifyAction>`;
  }

  if (commands.startCommand) {
    commandString += `
<amplifyAction type="start">${commands.startCommand}</amplifyAction>
`;
  }

  return commandString;
}
