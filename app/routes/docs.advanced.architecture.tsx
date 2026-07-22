/**
 * Architecture Documentation — /docs/advanced/architecture
 * Documents Amplify's ACTUAL architecture.
 */
import { Link } from '@remix-run/react';
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Overview', href: '#overview', level: 2 },
  { title: 'Framework stack', href: '#framework-stack', level: 2 },
  { title: 'State management', href: '#state-management', level: 2 },
  { title: 'Data persistence', href: '#persistence', level: 2 },
  { title: 'LLM pipeline', href: '#llm-pipeline', level: 2 },
  { title: 'API routes', href: '#api-routes', level: 2 },
  { title: 'Design systems', href: '#design-systems', level: 2 },
  { title: 'Skills system', href: '#skills-system', level: 2 },
];

export default function ArchitecturePage() {
  return (
    <DocsArticle title="Architecture" toc={toc} back="/docs" metadata="Remix v2, React 18, WebContainers, Vercel AI SDK v7, IndexedDB">
      <h2 id="overview">Overview</h2>
      <p>
        Amplify is built on <strong>Remix v2</strong> with <strong>React 18</strong> and 
        <strong>Vite v5</strong>. It runs as a Cloudflare Pages application with optional 
        Electron desktop wrapper. The AI chat pipeline uses <strong>Vercel AI SDK v7</strong> 
        (<code>ai</code> v7.0.26) for streaming, tool calls, and multi-provider support.
      </p>

      <h2 id="framework-stack">Framework stack</h2>
      <table>
        <thead><tr><th>Layer</th><th>Technology</th><th>Version</th></tr></thead>
        <tbody>
          <tr><td>Framework</td><td>Remix</td><td>v2.15.2</td></tr>
          <tr><td>Runtime</td><td>Cloudflare Pages</td><td>Wrangler v4.44</td></tr>
          <tr><td>Build tool</td><td>Vite</td><td>v5.4.x</td></tr>
          <tr><td>UI</td><td>React</td><td>v18.3.1</td></tr>
          <tr><td>AI SDK</td><td>Vercel AI SDK</td><td>v7.0.26</td></tr>
          <tr><td>State</td><td>Nanostores + Zustand</td><td>v0.10 + v5.0</td></tr>
          <tr><td>CSS</td><td>UnoCSS + SCSS + CSS Modules</td><td>v0.61</td></tr>
          <tr><td>UI primitives</td><td>Radix UI</td><td>10+ packages</td></tr>
          <tr><td>Desktop</td><td>Electron</td><td>v33.2</td></tr>
          <tr><td>IDE runtime</td><td>WebContainers</td><td>v1.6.1-internal</td></tr>
          <tr><td>Editor</td><td>CodeMirror 6</td><td>latest</td></tr>
          <tr><td>Terminal</td><td>xterm.js</td><td>v5.5</td></tr>
        </tbody>
      </table>

      <h2 id="state-management">State management</h2>
      <p>Amplify uses a dual state management system:</p>
      <ul>
        <li><strong>Nanostores</strong> — Atomic reactive stores for UI state (theme, logs, streaming)</li>
        <li><strong>Zustand</strong> — Complex stores for MCP config, settings, provider configurations</li>
      </ul>
      <p>Key stores include:</p>
      <ul>
        <li><code>themeStore</code> — Dark/light theme management</li>
        <li><code>workbenchStore</code> — File maps, artifacts, previews, action runners</li>
        <li><code>chatStore</code> — Chat state, provider selection, model config</li>
        <li><code>projectStore</code> — Project list, metadata, memory</li>
        <li><code>providerSettingsStore</code> — API keys and provider configuration</li>
        <li><code>rateLimitStore</code> — Per-provider rate limits</li>
        <li><code>mcpStore</code> — MCP server configuration</li>
      </ul>

      <h2 id="persistence">Data persistence</h2>
      <p>Amplify uses <strong>IndexedDB v4</strong> for client-side persistence:</p>
      <table>
        <thead><tr><th>Object Store</th><th>Key Path</th><th>Purpose</th></tr></thead>
        <tbody>
          <tr><td><code>chats</code></td><td>id</td><td>Chat history items</td></tr>
          <tr><td><code>snapshots</code></td><td>chatId</td><td>Per-chat file snapshots</td></tr>
          <tr><td><code>project_files</code></td><td>projectId</td><td>Current file map per project</td></tr>
          <tr><td><code>project_commits</code></td><td>id</td><td>Versioned file commits</td></tr>
          <tr><td><code>project_screenshots</code></td><td>projectId</td><td>One screenshot per project</td></tr>
        </tbody>
      </table>
      <p>Settings and API keys are persisted in <strong>localStorage</strong> and <strong>cookies</strong>.</p>

      <h2 id="llm-pipeline">LLM pipeline</h2>
      <p>The server-side LLM pipeline (<code>app/lib/.server/llm/</code>) handles:</p>
      <ul>
        <li><code>stream-text.ts</code> — Core streaming text generation with provider resolution</li>
        <li><code>select-context.ts</code> — Context selection and optimization</li>
        <li><code>create-summary.ts</code> — Auto-summarization when context exceeds 70%</li>
        <li><code>context-budget.ts</code> — Token budget calculation</li>
        <li><code>stream-recovery.ts</code> — Timeout and retry management</li>
        <li><code>switchable-stream.ts</code> — Stream switching for multi-provider support</li>
      </ul>
      <p>
        The <code>PromptLibrary</code> builds system prompts dynamically based on provider, model, 
        chat mode, project context, user memory, MCP tools, and design scheme.
      </p>

      <h2 id="api-routes">API routes</h2>
      <p>Amplify has <strong>37 API routes</strong> organized by domain:</p>
      <ul>
        <li><strong>Chat & LLM</strong>: <code>/api/chat</code>, <code>/api/models</code>, <code>/api/enhancer</code>, <code>/api/plan</code>, <code>/api/llmcall</code></li>
        <li><strong>Providers</strong>: <code>/api/configured-providers</code>, <code>/api/test-provider</code>, <code>/api/check-env-key</code></li>
        <li><strong>GitHub</strong>: <code>/api/github-stats</code>, <code>/api/github-user</code>, <code>/api/github-branches</code>, <code>/api/github-template</code></li>
        <li><strong>GitLab</strong>: <code>/api/gitlab-projects</code>, <code>/api/gitlab-branches</code></li>
        <li><strong>Deploy</strong>: <code>/api/vercel-deploy</code>, <code>/api/netlify-deploy</code>, <code>/api.vercel-user</code>, <code>/api.netlify-user</code></li>
        <li><strong>Supabase</strong>: <code>/api/supabase</code>, <code>/api/supabase-user</code>, <code>/api/supabase.query</code>, <code>/api/supabase.variables</code></li>
        <li><strong>MCP</strong>: <code>/api/mcp-check</code>, <code>/api/mcp-update-config</code></li>
        <li><strong>System</strong>: <code>/api/health</code>, <code>/api/system.diagnostics</code>, <code>/api/system.disk-info</code>, <code>/api/system.git-info</code></li>
        <li><strong>Other</strong>: <code>/api/web-search</code>, <code>/api/export-docx</code>, <code>/api/bug-report</code>, <code>/api/export-api-keys</code></li>
      </ul>

      <h2 id="design-systems">Design systems</h2>
      <p>
        Amplify includes <strong>140+ design systems</strong> in <code>design/design-systems/</code>. 
        Each system has a <code>DESIGN.md</code> defining color palettes, typography, component 
        styles, layout principles, and coding conventions. These are injected into the system prompt 
        as <code>designScheme</code> parameter, allowing the AI to generate code matching specific 
        visual styles.
      </p>
      <p>Categories include: professional, minimal, vibrant, futuristic, neon, luxury, corporate, 
        artistic, and branded systems (Apple, Tesla, Stripe, Vercel, GitHub, etc.).</p>

      <h2 id="skills-system">Skills system</h2>
      <p>
        The <code>SkillLoader</code> service loads skills from three directories:
      </p>
      <ul>
        <li><strong>Core skills</strong> (<code>app/lib/skills/</code>): react-best-practices, api-integration, frontend-design, docx</li>
        <li><strong>Design skills</strong> (<code>design/skills/</code>): supabase-backend, mobile-app, react-component, html-page, webapp-builder, appwrite, docx, react-native</li>
        <li><strong>User skills</strong> (<code>user_skills/</code>): Custom user-defined skills</li>
      </ul>
      <p>Skills are YAML-frontmatter parsed and injected into the system prompt as <code>&lt;available_skills&gt;</code> blocks.</p>
    </DocsArticle>
  );
}
