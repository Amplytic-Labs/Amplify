/**
 * Quick Start Guide — /docs/quick-start
 * Documents how to ACTUALLY get started with Amplify.
 */
import { Link } from '@remix-run/react';
import DocsArticle from '~/components/docs/DocsArticle';

const toc = [
  { title: 'Prerequisites', href: '#prerequisites', level: 2 },
  { title: 'Access Amplify', href: '#access-amplify', level: 2 },
  { title: 'Configure a provider', href: '#configure-provider', level: 2 },
  { title: 'Start chatting', href: '#start-chatting', level: 2 },
  { title: 'Generate code', href: '#generate-code', level: 2 },
  { title: 'Use the Workbench', href: '#use-workbench', level: 2 },
  { title: 'Deploy your project', href: '#deploy-project', level: 2 },
  { title: 'Next steps', href: '#next-steps', level: 2 },
];

export default function QuickStartPage() {
  return (
    <DocsArticle title="Quick Start" toc={toc} back="/docs" metadata="Get started with Amplify in 5 minutes">
      <p>
        This guide walks you through setting up Amplify and your first AI-powered development session.
        You'll learn how to configure an AI provider, start a chat, generate code, and deploy your project.
      </p>

      <h2 id="prerequisites">Prerequisites</h2>
      <ul>
        <li>A modern web browser (Chrome, Firefox, Safari, Edge)</li>
        <li>An API key from at least one AI provider (e.g., OpenAI, Anthropic, Google)</li>
        <li>For local providers: Ollama or LM Studio installed (optional)</li>
      </ul>
      <div className="docs-inline-info">
        <div className="docs-inline-info-title">API keys</div>
        <div className="docs-inline-info-content">
          You need at least one API key to use cloud providers. Get keys from:
          <a href="https://platform.openai.com/api-keys" target="_blank" rel="noopener noreferrer">OpenAI</a>,
          <a href="https://console.anthropic.com/" target="_blank" rel="noopener noreferrer">Anthropic</a>,
          <a href="https://aistudio.google.com/apikey" target="_blank" rel="noopener noreferrer">Google</a>,
          or any of the 22+ supported providers.
          For free local usage, install <Link to="/docs/products/providers/ollama">Ollama</Link>.
        </div>
      </div>

      <h2 id="access-amplify">Access Amplify</h2>
      <p>You can use Amplify in two ways:</p>
      <h3>Web application</h3>
      <p>Visit <a href="https://amplify.dev" target="_blank" rel="noopener noreferrer">amplify.dev</a> — no installation needed. Works in any modern browser.</p>
      <h3>Desktop application</h3>
      <p>Download the Electron desktop app from <a href="https://github.com/imtia33/Open_Claude/releases" target="_blank" rel="noopener noreferrer">GitHub Releases</a> for macOS, Windows, or Linux. The desktop app provides native menu bar, auto-updates, and better file system access.</p>

      <h2 id="configure-provider">Configure a provider</h2>
      <p>After launching Amplify, configure at least one AI provider:</p>
      <ol>
        <li>Click the <strong>Settings</strong> button (gear icon) in the sidebar</li>
        <li>Go to <strong>Cloud Providers</strong> or <strong>Local Providers</strong></li>
        <li>Enter your API key for the desired provider</li>
        <li>Click <strong>Save</strong></li>
      </ol>
      <p>
        Amplify supports 22+ providers including OpenAI, Anthropic, Google, DeepSeek, Groq, Cohere, 
        Mistral, xAI, Together, Perplexity, OpenRouter, Amazon Bedrock, GitHub Models, HuggingFace, 
        Fireworks, Cerebras, Moonshot, Hyperbolic, ZAI, Ollama, LM Studio, and any OpenAI-compatible endpoint.
      </p>
      <div className="docs-inline-info">
        <div className="docs-inline-info-title">Multiple providers</div>
        <div className="docs-inline-info-content">
          You can configure multiple providers simultaneously. Switch between models from different 
          providers mid-conversation using the model selector in the chat input.
        </div>
      </div>

      <h2 id="start-chatting">Start chatting</h2>
      <p>Once a provider is configured, start a new chat:</p>
      <ol>
        <li>Click <strong>New Chat</strong> in the sidebar</li>
        <li>Select a model from the model picker dropdown</li>
        <li>Type your message and press <strong>Enter</strong></li>
        <li>Watch the AI stream its response in real-time</li>
      </ol>
      <p>
        Amplify has two chat modes: <strong>discuss</strong> (conversation only) and <strong>build</strong> 
        (code generation mode). Use <code>build</code> mode when you want the AI to create or modify files.
      </p>

      <h2 id="generate-code">Generate code</h2>
      <p>In <code>build</code> mode, Amplify generates and modifies files using native tools:</p>
      <pre><code>{`// Example prompts for build mode:
"Create a React component for a user profile page"
"Add dark mode support to my existing layout"
"Fix the TypeScript error in src/utils/api.ts"
"Build a REST API endpoint for user authentication"

// Amplify will:
// 1. Read existing files to understand your project
// 2. Generate or modify the necessary files
// 3. Show changes in the diff view
// 4. Run install/build commands in the terminal
// 5. Update the live preview automatically`}</code></pre>

      <h2 id="use-workbench">Use the Workbench</h2>
      <p>
        When Amplify generates code, the Workbench panel opens with:
      </p>
      <ul>
        <li><strong>Editor</strong> — CodeMirror 6 editor with syntax highlighting for 40+ languages</li>
        <li><strong>File Tree</strong> — Navigate your project files</li>
        <li><strong>Live Preview</strong> — See your app running in a WebContainer iframe</li>
        <li><strong>Terminal</strong> — Run commands with xterm.js</li>
        <li><strong>Diff View</strong> — Review and accept/reject AI changes</li>
      </ul>
      <p>
        WebContainers run Node.js directly in your browser, so you can preview full-stack apps without local setup.
      </p>

      <h2 id="deploy-project">Deploy your project</h2>
      <p>Amplify supports one-click deployment to four platforms:</p>
      <ul>
        <li><Link to="/docs/products/deploy/github"><strong>GitHub Pages</strong></Link> — Push to a repo and deploy</li>
        <li><Link to="/docs/integrations/vercel"><strong>Vercel</strong></Link> — Deploy with Vercel CLI</li>
        <li><Link to="/docs/integrations/netlify"><strong>Netlify</strong></Link> — Deploy with Netlify CLI</li>
        <li><Link to="/docs/integrations/gitlab"><strong>GitLab Pages</strong></Link> — Deploy via GitLab CI</li>
      </ul>

      <h2 id="next-steps">Next steps</h2>
      <p>Now that you're set up, explore more features:</p>
      <ul>
        <li><Link to="/docs/products/chat">Chat</Link> — Streaming, reasoning, tool calls, and more</li>
        <li><Link to="/docs/products/workbench">Workbench</Link> — Editor, preview, terminal, diff view</li>
        <li><Link to="/docs/products/providers">Providers</Link> — All 22+ AI providers</li>
        <li><Link to="/docs/advanced/native-tools">Native tools</Link> — 8 built-in Copilot-style tools</li>
        <li><Link to="/docs/integrations/mcp">MCP Servers</Link> — Extend with external tools</li>
        <li><Link to="/docs/advanced/memory">Memory</Link> — Project and user-level memory stores</li>
      </ul>
    </DocsArticle>
  );
}
