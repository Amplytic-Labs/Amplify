/**
 * Starter Templates — /docs/starter-templates
 * Documents Amplify's ACTUAL starter templates.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const templates = [
  { name: 'Expo', desc: 'React Native mobile app with Expo framework' },
  { name: 'Astro', desc: 'Modern static site builder with island architecture' },
  { name: 'NextJS', desc: 'Full-stack React framework with SSR and API routes' },
  { name: 'Vite + React', desc: 'Fast React development with Vite bundler' },
  { name: 'Vite + Vue', desc: 'Vue 3 application with Vite and TypeScript' },
  { name: 'Angular', desc: 'Enterprise-grade web framework by Google' },
  { name: 'SvelteKit', desc: 'Svelte framework with SSR and file-based routing' },
  { name: 'Qwik', desc: 'Resumable framework for instant loading' },
  { name: 'Remix', desc: 'Full-stack web framework with progressive enhancement' },
  { name: 'Slidev', desc: 'Presentation slides for developers with Markdown' },
  { name: 'SolidJS', desc: 'Simple and performant reactive UI library' },
  { name: 'Vite + Lit', desc: 'Web components with Lit and Vite' },
  { name: 'Vite + Vanilla', desc: 'Plain JavaScript/TypeScript with Vite' },
  { name: 'Vite + Preact', desc: 'Lightweight 3KB React alternative' },
];

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Available templates', href: '#templates', level: 2 },
  { title: 'Using templates', href: '#using-templates', level: 2 },
  { title: 'Importing existing projects', href: '#importing', level: 2 },
];

export default function StarterTemplatesPage() {
  return (
    <DocsArticle title="Starter Templates" toc={toc} back="/docs" metadata="14 pre-built project templates and repository import">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify provides <strong>14 starter templates</strong> for quick project setup. 
        When you create a new project, you can choose a template to get a pre-configured 
        project with all necessary dependencies and structure.
      </p>

      <h2 id="templates">Available templates</h2>
      <table>
        <thead><tr><th>Template</th><th>Description</th></tr></thead>
        <tbody>
          {templates.map((t) => (
            <tr key={t.name}><td><strong>{t.name}</strong></td><td>{t.desc}</td></tr>
          ))}
        </tbody>
      </table>

      <h2 id="using-templates">Using templates</h2>
      <p>To start a project from a template:</p>
      <ol>
        <li>Click <strong>New Chat</strong> in the sidebar</li>
        <li>In the empty chat area, you'll see the <strong>Starter Templates</strong> grid</li>
        <li>Click on any template card to initialize a project</li>
        <li>Amplify will create the project files and install dependencies</li>
        <li>The Workbench opens with the editor, preview, and terminal</li>
      </ol>
      <p>
        After the template loads, you can immediately start chatting with the AI 
        to customize the project to your needs.
      </p>

      <h2 id="importing">Importing existing projects</h2>
      <p>
        You can also import existing projects using three methods:
      </p>
      <ul>
        <li><strong>Git Clone</strong> — Click the Git Clone button and enter a repository URL. 
          Amplify clones the repo into a WebContainer and sets up the project.</li>
        <li><strong>Import Folder</strong> — Import a local folder from your filesystem 
          (available in desktop app).</li>
        <li><strong>Example Prompts</strong> — Use suggested prompts in the chat to generate 
          custom project setups.</li>
      </ul>
    </DocsArticle>
  );
}
