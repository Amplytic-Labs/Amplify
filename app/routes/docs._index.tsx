/**
 * Docs landing page — /docs
 */

import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import DocsFooter from '~/components/docs/DocsFooter';

const landingContent = `
Amplify is an **open-source AI-powered coding environment** built on Remix v2 with the Vercel AI SDK v7.
It provides a browser-based IDE experience with real-time AI assistance, supporting **22+ LLM providers** from
cloud giants like Anthropic and OpenAI to local options like Ollama and LM Studio.

## Key Features

- **22+ AI Providers** — Connect to Anthropic, OpenAI, Google, Groq, DeepSeek, Mistral, and many more
- **MCP Support** — Full Model Context Protocol with Stdio, SSE, and StreamableHTTP transports
- **Vector DB (Orama)** — Browser-native full-text search with BM25 ranking, saving 70-90% of tokens
- **WebContainer Sandboxing** — StackBlitz's browser-based Node.js runtime for real development in the browser
- **Planning System** — Break complex tasks into structured plans with verification checkpoints
- **Memory System** — Dual memory with legacy MemoryStore and Orama vector stores for semantic search
- **Native Tools** — 8 Copilot-style tools for full workspace control
- **100+ Design Systems** — Bundled visual guidelines from Stripe, Vercel, Notion, Apple, and more
- **Skills Marketplace** — Procedural markdown instructions with progressive loading

## Get Started

- [Quick Start](/docs/getting-started/quick-start) — Set up in under 5 minutes
- [Configuration](/docs/getting-started/configuration) — Environment variables and provider settings
- [Architecture](/docs/architecture/overview) — How Amplify works under the hood
- [Self-Hosting](/docs/self-hosting/docker) — Deploy with Docker, Cloudflare, or natively

## Open Source

Amplify is **MIT licensed** and open for contributions. See the [Contributing Guide](/docs/contributing/contributing) to get started.
`;

export default function DocsIndexPage() {
  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-amplify-elements-textPrimary mb-3">Welcome to Amplify Docs</h1>
        <p className="text-lg text-amplify-elements-textSecondary">
          Open-source AI-powered coding environment with 22+ LLM providers
        </p>
      </div>
      <div className="docs-content prose max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm]}>
          {landingContent}
        </ReactMarkdown>
      </div>
      <DocsFooter currentUrl="/docs" />
    </div>
  );
}
