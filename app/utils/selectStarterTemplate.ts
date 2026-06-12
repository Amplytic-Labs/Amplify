import ignore from 'ignore';
import type { ProviderInfo } from '~/types/model';
import type { Template } from '~/types/template';
import { STARTER_TEMPLATES } from './constants';

const starterTemplateSelectionPrompt = (templates: Template[]) => `
You are an experienced developer who helps people choose the best starter template for their projects.
IMPORTANT: Vite is preferred
IMPORTANT: Only choose shadcn templates if the user explicitly asks for shadcn.

Available templates:
<template>
  <name>blank</name>
  <description>Empty starter for simple scripts, file generation (docx, pdf, xlsx, pptx, html, svg), data processing, and tasks that don't require a full web app scaffold</description>
  <tags>basic, script, file-generation, document, utility</tags>
</template>
${templates
  .map(
    (template) => `
<template>
  <name>${template.name}</name>
  <description>${template.description}</description>
  ${template.tags ? `<tags>${template.tags.join(', ')}</tags>` : ''}
</template>
`,
  )
  .join('\n')}

Response Format:
<selection>
  <templateName>{selected template name}</templateName>
  <title>{a proper title for the project}</title>
</selection>

Examples:

<example>
User: I need to build a todo app
Response:
<selection>
  <templateName>Vite React</templateName>
  <title>Simple React todo application</title>
</selection>
</example>

<example>
User: Write a script to generate numbers from 1 to 100
Response:
<selection>
  <templateName>blank</templateName>
  <title>script to generate numbers from 1 to 100</title>
</selection>
</example>

<example>
User: Create a docx file with a resume template
Response:
<selection>
  <templateName>blank</templateName>
  <title>Resume document generator</title>
</selection>
</example>

<example>
User: Generate a PDF report from some data
Response:
<selection>
  <templateName>blank</templateName>
  <title>PDF report generator</title>
</selection>
</example>

<example>
User: Make an HTML page that displays a chart
Response:
<selection>
  <templateName>blank</templateName>
  <title>HTML chart page</title>
</selection>
</example>

Instructions:
1. For trivial tasks and simple scripts, always recommend the blank template
2. For file generation tasks (creating .docx, .pdf, .xlsx, .pptx, .html, .svg, .csv, .json files), ALWAYS recommend the blank template - these do NOT need a web app scaffold
3. For code utilities, scripts, CLI tools, or data processing, recommend the blank template
4. Only recommend a web framework template (React, Vite, Astro, etc.) when the user explicitly wants to BUILD a web application or website
5. For more complex web projects, recommend templates from the provided list
6. Follow the exact XML format
7. Consider both technical requirements and tags
8. If no perfect match exists, recommend the closest option
9. When in doubt, prefer blank - it is always safe and the AI can build anything from scratch

Important: Provide only the selection tags in your response, no additional text.
MOST IMPORTANT: YOU DONT HAVE TIME TO THINK JUST START RESPONDING BASED ON HUNCH.
REMEMBER: If the user asks to create/generate a FILE (docx, pdf, xlsx, pptx, html, svg, etc.) and NOT a full web application, ALWAYS choose blank template.
`;

const templates: Template[] = STARTER_TEMPLATES.filter((t) => !t.name.includes('shadcn'));

const parseSelectedTemplate = (llmOutput: string): { template: string; title: string } | null => {
  try {
    // Extract content between <templateName> tags
    const templateNameMatch = llmOutput.match(/<templateName>(.*?)<\/templateName>/);
    const titleMatch = llmOutput.match(/<title>(.*?)<\/title>/);

    if (!templateNameMatch) {
      return null;
    }

    return { template: templateNameMatch[1].trim(), title: titleMatch?.[1].trim() || 'Untitled Project' };
  } catch (error) {
    console.error('Error parsing template selection:', error);
    return null;
  }
};

export const selectStarterTemplate = async (options: { message: string; model: string; provider: ProviderInfo }) => {
  const { message, model, provider } = options;
  const requestBody = {
    message,
    model,
    provider,
    system: starterTemplateSelectionPrompt(templates),
  };
  const response = await fetch('/api/llmcall', {
    method: 'POST',
    body: JSON.stringify(requestBody),
  });
  const respJson: { text: string } = await response.json();
  console.log(respJson);

  const { text } = respJson;
  const selectedTemplate = parseSelectedTemplate(text);

  if (selectedTemplate) {
    return selectedTemplate;
  } else {
    console.log('No template selected, using blank template');

    return {
      template: 'blank',
      title: '',
    };
  }
};

import { fetchRepoContents } from '~/lib/utils/github-templates';

const getGitHubRepoContent = async (repoName: string): Promise<{ name: string; path: string; content: string }[]> => {
  return fetchRepoContents(repoName);
};

export async function getTemplates(templateName: string, title?: string) {
  const template = STARTER_TEMPLATES.find((t) => t.name == templateName);

  if (!template) {
    return null;
  }

  const githubRepo = template.githubRepo;
  const files = await getGitHubRepoContent(githubRepo);

  let filteredFiles = files;

  /*
   * ignoring common unwanted files
   * exclude    .git
   */
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.git') == false);

  /*
   * exclude    lock files
   * WE NOW INCLUDE LOCK FILES FOR IMPROVED INSTALL TIMES
   */
  {
    /*
     *const comminLockFiles = ['package-lock.json', 'yarn.lock', 'pnpm-lock.yaml'];
     *filteredFiles = filteredFiles.filter((x) => comminLockFiles.includes(x.name) == false);
     */
  }

  // exclude    .bolt
  filteredFiles = filteredFiles.filter((x) => x.path.startsWith('.bolt') == false);

  // check for ignore file in .bolt folder
  const templateIgnoreFile = files.find((x) => x.path.startsWith('.bolt') && x.name == 'ignore');

  const filesToImport = {
    files: filteredFiles,
    ignoreFile: [] as typeof filteredFiles,
  };

  if (templateIgnoreFile) {
    // redacting files specified in ignore file
    const ignorepatterns = templateIgnoreFile.content.split('\n').map((x) => x.trim());
    const ig = ignore().add(ignorepatterns);

    // filteredFiles = filteredFiles.filter(x => !ig.ignores(x.path))
    const ignoredFiles = filteredFiles.filter((x) => ig.ignores(x.path));

    filesToImport.files = filteredFiles;
    filesToImport.ignoreFile = ignoredFiles;
  }

  const isExpo = template.tags?.includes('expo') || template.name.toLowerCase().includes('expo');
  const devCommand = isExpo ? 'npm start' : 'npm run dev';

  const assistantMessage = `
<boltArtifact id="imported-files" title="${title || 'Create initial files'}" type="bundled">
${filesToImport.files
  .map(
    (file) =>
      `<boltAction type="file" filePath="${file.path}">
${file.content}
</boltAction>`,
  )
  .join('\n')}
<boltAction type="shell">
npm install
</boltAction>
</boltArtifact>
`;
  let userMessage = ``;
  const templatePromptFile = files.filter((x) => x.path.startsWith('.bolt')).find((x) => x.name == 'prompt');

  if (templatePromptFile) {
    userMessage = `
TEMPLATE INSTRUCTIONS:
${templatePromptFile.content}

---
`;
  }

  if (filesToImport.ignoreFile.length > 0) {
    userMessage =
      userMessage +
      `
STRICT FILE ACCESS RULES - READ CAREFULLY:

The following files are READ-ONLY and must never be modified:
${filesToImport.ignoreFile.map((file) => `- ${file.path}`).join('\n')}

Permitted actions:
✓ Import these files as dependencies
✓ Read from these files
✓ Reference these files

Strictly forbidden actions:
❌ Modify any content within these files
❌ Delete these files
❌ Rename these files
❌ Move these files
❌ Create new versions of these files
❌ Suggest changes to these files

Any attempt to modify these protected files will result in immediate termination of the operation.

If you need to make changes to functionality, create new files instead of modifying the protected ones listed above.
---
`;
  }

  const packageJsonFile = filesToImport.files.find((f) => f.path.endsWith('package.json'));
  const packageJsonContext = packageJsonFile
    ? `\nHere is the template's package.json:\n\`\`\`json\n${packageJsonFile.content}\n\`\`\`\nPlease check the "scripts" section to determine the correct development start command (e.g., npm run dev, npm start, etc.).`
    : '';

  userMessage += `
---
template import is done, and you can now use the imported files.
edit only the files that need to be changed, and you can create new files as needed.
DO NOT EDIT/WRITE ANY FILES THAT ALREADY EXIST IN THE PROJECT AND DO NOT NEED TO BE MODIFIED.
---
Now that the Template is imported and \`npm install\` has been executed automatically, please continue with my original request.
${packageJsonContext}
IMPORTANT: When starting the development server, you MUST use the appropriate command from the package.json scripts.
`;

  return {
    assistantMessage,
    summary: `Injected ${template.name} template. Files created: ${filesToImport.files.map((f) => f.path).join(', ')}`,
    userMessage,
  };
}
