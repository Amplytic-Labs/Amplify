/**
 * Memory Documentation — /docs/advanced/memory
 * Documents Amplify's ACTUAL memory system.
 */
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'User memory', href: '#user-memory', level: 2 },
  { title: 'Project memory', href: '#project-memory', level: 2 },
  { title: 'Memory in prompts', href: '#in-prompts', level: 2 },
  { title: 'Vector search', href: '#vector-search', level: 2 },
];

export default function MemoryPage() {
  return (
    <DocsArticle title="Memory" toc={toc} back="/docs" metadata="User-level and project-level memory stores with vector search">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify has a two-tier memory system that helps the AI remember context across 
        conversations. Memory is injected into the system prompt so the AI can reference 
        past preferences, decisions, and project details without you repeating them.
      </p>

      <h2 id="user-memory">User memory</h2>
      <p>
        <strong>User-level memories</strong> are stored in localStorage via <code>memoryStore</code>. 
        These are personal preferences and general knowledge that apply across all projects:
      </p>
      <ul>
        <li>Preferred coding style (e.g., "I prefer functional components over class components")</li>
        <li>Common patterns you want the AI to follow</li>
        <li>Preferences for naming conventions, file organization, etc.</li>
      </ul>
      <p>
        Manage user memories in <strong>Settings → Memory</strong> tab. You can add, edit, delete, 
        and search memories. Deduplication is automatic based on content matching.
      </p>

      <h2 id="project-memory">Project memory</h2>
      <p>
        <strong>Project-level memory</strong> is structured metadata stored in the <code>projectStore</code> 
        for each project. It includes:
      </p>
      <table>
        <thead><tr><th>Field</th><th>Description</th></tr></thead>
        <tbody>
          <tr><td><code>framework</code></td><td>Main framework (React, Vue, Svelte, etc.)</td></tr>
          <tr><td><code>stateManagement</code></td><td>State management approach</td></tr>
          <tr><td><code>backend</code></td><td>Backend technology</td></tr>
          <tr><td><code>architecture</code></td><td>Architecture pattern (SPA, SSR, etc.)</td></tr>
          <tr><td><code>theme</code></td><td>Design system or color theme</td></tr>
          <tr><td><code>codingStyle</code></td><td>Preferred coding conventions</td></tr>
          <tr><td><code>dependencies</code></td><td>Key project dependencies</td></tr>
          <tr><td><code>notes</code></td><td>Free-form notes about the project</td></tr>
        </tbody>
      </table>
      <p>
        Edit project memory in the <strong>ProjectMemoryPanel</strong> accessible from the Workbench.
      </p>

      <h2 id="in-prompts">Memory in prompts</h2>
      <p>
        Both memory types are injected into the system prompt during chat requests:
      </p>
      <ul>
        <li>User memories are wrapped in <code>&lt;user_memory&gt;</code> blocks</li>
        <li>Project memory is included as structured context</li>
      </ul>
      <p>
        This means the AI automatically knows your preferences and project context 
        without you having to repeat them in every message.
      </p>

      <h2 id="vector-search">Vector search</h2>
      <p>
        Amplify includes a vector store system using <strong>@orama/orama</strong> for semantic search:
      </p>
      <ul>
        <li><code>user-profile-store.ts</code> — User-level vector embeddings</li>
        <li><code>project-context-store.ts</code> — Project-level vector embeddings</li>
        <li><code>persistence.ts</code> — Vector persistence to IndexedDB</li>
      </ul>
      <p>
        This enables semantic search over memories, finding relevant context even when 
        exact keyword matches aren't available.
      </p>
    </DocsArticle>
  );
}
