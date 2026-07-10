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

      /*
       * Detect the package manager from lock files. This ensures we use the
       * correct install + run commands for the project's package manager.
       * Priority: bun > pnpm > yarn > npm (default).
       */
      let pkgManager = 'npm';

      if (hasFile('bun.lockb') || hasFile('bun.lock')) {
        pkgManager = 'bun';
      } else if (hasFile('pnpm-lock.yaml')) {
        pkgManager = 'pnpm';
      } else if (hasFile('yarn.lock')) {
        pkgManager = 'yarn';
      }

      const installCmd = pkgManager === 'npm' ? 'npm install' : `${pkgManager} install`;
      const runCmd = pkgManager === 'yarn' ? 'yarn' : `${pkgManager} run`;

      // Check for preferred commands in priority order
      const preferredCommands = ['dev', 'start', 'preview'];
      const availableCommand = preferredCommands.find((cmd) => scripts[cmd]);

      const setupCommand = makeNonInteractive(installCmd);

      if (availableCommand) {
        return {
          type: 'Node.js',
          setupCommand,
          startCommand: `${runCmd} ${availableCommand}`,
          followupMessage: '',
        };
      }

      return {
        type: 'Node.js',
        setupCommand,
        followupMessage: '',
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
