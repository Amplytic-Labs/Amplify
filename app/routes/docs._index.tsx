/**
 * Docs Landing Page — The main /docs index page.
 * 
 * Uses Appwrite's visual design style but documents Amplify's ACTUAL features.
 */
import { Link } from '@remix-run/react';
import {
  Play,
  MessageCircle,
  Code,
  Cloud,
  Rocket,
  Brain,
  TerminalSquare,
  Eye,
  GitBranch,
  Plug,
  Database,
  Wrench,
  Map,
  Server,
  Monitor,
  ArrowRight,
  Sparkles,
  Key,
  Gauge,
  Funnel,
  Paperclip,
  Waves,
  Mic,
  Scissors,
  RotateCcw,
  ArrowLeftRight,
  Lock,
  GitCompare,
  FolderOpen,
  TextCursorInput,
  Triangle,
  Github,
  HelpCircle,
} from 'lucide-react';
import DocsArticle from '~/components/docs/DocsArticle';

/* ─── Core Features ─── */
const coreFeatureCards = [
  { icon: MessageCircle, title: 'Chat', desc: 'AI-powered conversations with streaming, reasoning, tool invocations, and file attachments', href: '/docs/products/chat' },
  { icon: Code, title: 'Workbench', desc: 'Full IDE experience — editor, live preview, terminal, diff view, and file locking', href: '/docs/products/workbench' },
  { icon: Cloud, title: 'Providers', desc: '22+ AI providers — OpenAI, Anthropic, Google, DeepSeek, Ollama, and more', href: '/docs/products/providers' },
  { icon: Rocket, title: 'Deploy', desc: 'One-click deployment to GitHub, Vercel, Netlify, and GitLab', href: '/docs/products/deploy' },
];

/* ─── Chat Feature Cards ─── */
const chatFeatureCards = [
  { icon: Waves, title: 'Streaming', desc: 'Real-time token-by-token response streaming', href: '/docs/products/chat/streaming' },
  { icon: Brain, title: 'Reasoning', desc: 'Extended thinking display for reasoning models', href: '/docs/products/chat/reasoning' },
  { icon: Wrench, title: 'Tool calls', desc: 'Native tools: read files, edit code, search web', href: '/docs/products/chat/tool-invocations' },
  { icon: Paperclip, title: 'Attachments', desc: 'Attach images and files to messages', href: '/docs/products/chat/file-attachments' },
  { icon: Gauge, title: 'Context budget', desc: 'Live token usage tracking', href: '/docs/products/chat/context-budget' },
  { icon: Scissors, title: 'Auto summarize', desc: 'Automatic context compression', href: '/docs/products/chat/summarization' },
  { icon: Mic, title: 'Voice input', desc: 'Speech-to-text via Web Speech API', href: '/docs/products/chat/voice-input' },
  { icon: RotateCcw, title: 'Rewind & fork', desc: 'Navigate back and branch conversations', href: '/docs/products/chat/rewind-fork' },
];

/* ─── Workbench Feature Cards ─── */
const workbenchFeatureCards = [
  { icon: TextCursorInput, title: 'CodeMirror Editor', desc: 'Syntax highlighting for 40+ languages', href: '/docs/products/workbench/editor' },
  { icon: FolderOpen, title: 'File tree', desc: 'Project file navigation with icons', href: '/docs/products/workbench/file-tree' },
  { icon: Eye, title: 'Live Preview', desc: 'WebContainer-powered browser preview', href: '/docs/products/workbench/preview' },
  { icon: TerminalSquare, title: 'Terminal', desc: 'xterm.js integrated terminal', href: '/docs/products/workbench/terminal' },
  { icon: GitCompare, title: 'Diff view', desc: 'Visual comparison of code changes', href: '/docs/products/workbench/diff-view' },
  { icon: Lock, title: 'File locking', desc: 'Protect files from AI modifications', href: '/docs/products/workbench/file-locking' },
];

/* ─── Integration Cards ─── */
const integrationCards = [
  { icon: Github, title: 'GitHub', desc: 'Clone repos, push code, deploy pages', href: '/docs/integrations/github' },
  { icon: GitBranch, title: 'GitLab', desc: 'Project management and deployment', href: '/docs/integrations/gitlab' },
  { icon: Database, title: 'Supabase', desc: 'Database integration with live queries', href: '/docs/integrations/supabase' },
  { icon: Triangle, title: 'Vercel', desc: 'Deploy directly to Vercel', href: '/docs/integrations/vercel' },
  { icon: Plug, title: 'MCP Servers', desc: 'Model Context Protocol for tool extensions', href: '/docs/integrations/mcp' },
];

/* ─── Advanced Cards ─── */
const advancedCards = [
  { icon: Sparkles, title: 'Architecture', desc: 'Remix v2, WebContainers, AI SDK v7', href: '/docs/advanced/architecture' },
  { icon: Map, title: 'Planning system', desc: 'Task contracts and sub-chat engine', href: '/docs/advanced/planning' },
  { icon: Brain, title: 'Memory', desc: 'User and project-level memory stores', href: '/docs/advanced/memory' },
  { icon: Wrench, title: 'Native tools', desc: '8 built-in Copilot-style tools', href: '/docs/advanced/native-tools' },
  { icon: Monitor, title: 'Desktop app', desc: 'Electron v33 with auto-update', href: '/docs/advanced/desktop' },
  { icon: Server, title: 'Self-hosting', desc: 'Docker and Cloudflare Pages setup', href: '/docs/advanced/self-hosting' },
];

export default function DocsLandingPage() {
  return (
    <DocsArticle title="Amplify Documentation" metadata="Learn how to use Amplify — the AI-powered development environment">
      {/* ── Hero Banner ── */}
      <div style={{ padding: '4rem 0 3rem', textAlign: 'center' }}>
        <h1 className="docs-text-display" style={{ marginBottom: '1rem' }}>
          Welcome to <span style={{ color: 'var(--docs-color-accent)' }}>Amplify</span> Docs
        </h1>
        <p className="docs-text-description" style={{ maxWidth: '40rem', marginInline: 'auto' }}>
          Amplify is an open-source AI-powered development environment. Chat with 22+ AI providers, 
          generate code in a full IDE workbench, and deploy to the cloud — all from your browser.
        </p>
        <Link to="/docs/quick-start" className="docs-landing-hero-cta" style={{ marginTop: '1.5rem', display: 'inline-flex' }}>
          <Play size={16} />
          Quick Start Guide
          <ArrowRight size={16} />
        </Link>
      </div>

      {/* ── Core Products ── */}
      <div style={{ marginBottom: '3rem' }}>
        <h2>Products</h2>
        <p>
          Amplify provides four core products that work together seamlessly:
        </p>
        <div className="docs-platforms-grid" style={{ padding: '1rem 0' }}>
          {coreFeatureCards.map((card) => (
            <Link key={card.href} to={card.href} className="docs-landing-card">
              <card.icon className="docs-landing-card-icon" size={24} />
              <span className="docs-landing-card-title">{card.title}</span>
              <span className="docs-landing-card-desc">{card.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Chat Features ── */}
      <div style={{ marginBottom: '3rem' }}>
        <h2>Chat Features</h2>
        <p>
          Amplify's chat goes beyond simple messaging. It supports streaming responses, 
          reasoning mode, native tool invocations, file attachments, and automatic context management.
        </p>
        <div className="docs-platforms-grid" style={{ padding: '1rem 0' }}>
          {chatFeatureCards.map((card) => (
            <Link key={card.href} to={card.href} className="docs-landing-card">
              <card.icon className="docs-landing-card-icon" size={24} />
              <span className="docs-landing-card-title">{card.title}</span>
              <span className="docs-landing-card-desc">{card.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Workbench Features ── */}
      <div style={{ marginBottom: '3rem' }}>
        <h2>Workbench Features</h2>
        <p>
          The Workbench provides a complete IDE experience powered by WebContainers — 
          a Node.js runtime that runs entirely in your browser.
        </p>
        <div className="docs-platforms-grid" style={{ padding: '1rem 0' }}>
          {workbenchFeatureCards.map((card) => (
            <Link key={card.href} to={card.href} className="docs-landing-card">
              <card.icon className="docs-landing-card-icon" size={24} />
              <span className="docs-landing-card-title">{card.title}</span>
              <span className="docs-landing-card-desc">{card.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Integrations ── */}
      <div style={{ marginBottom: '3rem' }}>
        <h2>Integrations</h2>
        <p>
          Connect Amplify with your existing tools and services.
        </p>
        <div className="docs-platforms-grid" style={{ padding: '1rem 0', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))' }}>
          {integrationCards.map((card) => (
            <Link key={card.href} to={card.href} className="docs-landing-card">
              <card.icon className="docs-landing-card-icon" size={24} />
              <span className="docs-landing-card-title">{card.title}</span>
              <span className="docs-landing-card-desc">{card.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Advanced ── */}
      <div style={{ marginBottom: '3rem' }}>
        <h2>Advanced</h2>
        <p>
          Dive deeper into Amplify's architecture, tools, and deployment options.
        </p>
        <div className="docs-platforms-grid" style={{ padding: '1rem 0', gridTemplateColumns: 'repeat(auto-fill, minmax(10rem, 1fr))' }}>
          {advancedCards.map((card) => (
            <Link key={card.href} to={card.href} className="docs-landing-card">
              <card.icon className="docs-landing-card-icon" size={24} />
              <span className="docs-landing-card-title">{card.title}</span>
              <span className="docs-landing-card-desc">{card.desc}</span>
            </Link>
          ))}
        </div>
      </div>

      {/* ── Info Callout ── */}
      <div className="docs-inline-info">
        <Sparkles className="docs-inline-info-icon" size={20} />
        <div>
          <div className="docs-inline-info-title">Open Source</div>
          <div className="docs-inline-info-content">
            Amplify is open source under the MIT license. You can contribute, report issues, 
            and help shape the future of AI-powered development.
            Visit <a href="https://github.com/imtia33/Open_Claude" target="_blank" rel="noopener noreferrer">GitHub</a> to get involved.
          </div>
        </div>
      </div>
    </DocsArticle>
  );
}
