/**
 * Navigation data structure for Amplify docs sidebar.
 * Mirrors Appwrite's NavTree data structure for design consistency,
 * but documents Amplify's ACTUAL features.
 */

export type NavLink = {
  label: string;
  href: string;
  icon?: string;
  isNew?: boolean;
  isParent?: boolean;
  openInNewTab?: boolean;
};

export type NavGroup = {
  label?: string;
  items: Array<NavLink>;
  collapsible?: boolean;
  initiallyCollapsed?: boolean;
};

export type NavParent = {
  label: string;
  href: string;
};

export type NavTree = Array<NavGroup | NavLink>;

// Root-level sidebar navigation (matches Amplify's actual features)
export const rootNavigation: NavTree = [
  {
    items: [
      { label: 'Home', href: '/docs', icon: 'i-ph:house-bold' },
      { label: 'Quick start', href: '/docs/quick-start', icon: 'i-ph:play-bold' },
      { label: 'Starter templates', href: '/docs/starter-templates', icon: 'i-ph:squares-four-bold' },
      { label: 'Changelog', href: '/docs/changelog', icon: 'i-ph:clock-bold' },
    ],
  },
  {
    label: 'Products',
    items: [
      { label: 'Chat', href: '/docs/products/chat', icon: 'i-ph:chat-bubble-bold', isParent: true },
      { label: 'Workbench', href: '/docs/products/workbench', icon: 'i-ph:code-bold', isParent: true },
      { label: 'Providers', href: '/docs/products/providers', icon: 'i-ph:cloud-bold', isParent: true },
      { label: 'Deploy', href: '/docs/products/deploy', icon: 'i-ph:rocket-bold', isParent: true },
    ],
  },
  {
    label: 'Integrations',
    items: [
      { label: 'GitHub', href: '/docs/integrations/github', icon: 'i-ph:github-logo-bold', isParent: true },
      { label: 'GitLab', href: '/docs/integrations/gitlab', icon: 'i-ph:gitlab-logo-bold', isParent: true },
      { label: 'Supabase', href: '/docs/integrations/supabase', icon: 'i-ph:database-bold', isParent: true },
      { label: 'Vercel', href: '/docs/integrations/vercel', icon: 'i-ph:triangle-bold' },
      { label: 'Netlify', href: '/docs/integrations/netlify', icon: 'i-ph:netlify-logo-bold' },
      { label: 'MCP Servers', href: '/docs/integrations/mcp', icon: 'i-ph:plug-bold', isParent: true },
    ],
  },
  {
    label: 'Advanced',
    collapsible: true,
    initiallyCollapsed: true,
    items: [
      { label: 'Architecture', href: '/docs/advanced/architecture', icon: 'i-ph:buildings-bold' },
      { label: 'Native tools', href: '/docs/advanced/native-tools', icon: 'i-ph:wrench-bold' },
      { label: 'Planning system', href: '/docs/advanced/planning', icon: 'i-ph:map-bold' },
      { label: 'Memory', href: '/docs/advanced/memory', icon: 'i-ph:brain-bold' },
      { label: 'Self-hosting', href: '/docs/advanced/self-hosting', icon: 'i-ph:server-bold' },
      { label: 'Desktop app', href: '/docs/advanced/desktop', icon: 'i-ph:desktop-bold' },
      { label: 'Troubleshooting', href: '/docs/advanced/troubleshooting', icon: 'i-ph:warning-bold' },
    ],
  },
];

// Chat product sub-navigation
export const chatNavigation: NavTree = [
  {
    items: [
      { label: 'Home', href: '/docs', icon: 'i-ph:house-bold' },
    ],
  },
  {
    label: 'Getting started',
    items: [
      { label: 'Overview', href: '/docs/products/chat', icon: 'i-ph:info-bold' },
    ],
  },
  {
    label: 'Features',
    items: [
      { label: 'Streaming', href: '/docs/products/chat/streaming', icon: 'i-ph:wave-bold' },
      { label: 'File attachments', href: '/docs/products/chat/file-attachments', icon: 'i-ph:paperclip-bold' },
      { label: 'Reasoning mode', href: '/docs/products/chat/reasoning', icon: 'i-ph:brain-bold' },
      { label: 'Tool invocations', href: '/docs/products/chat/tool-invocations', icon: 'i-ph:wrench-bold' },
      { label: 'Context budget', href: '/docs/products/chat/context-budget', icon: 'i-ph:chart-bar-bold' },
      { label: 'Auto summarization', href: '/docs/products/chat/summarization', icon: 'i-ph:scissors-bold' },
      { label: 'Voice input', href: '/docs/products/chat/voice-input', icon: 'i-ph:microphone-bold' },
      { label: 'Prompt enhancer', href: '/docs/products/chat/prompt-enhancer', icon: 'i-ph:magic-bold' },
      { label: 'Chat modes', href: '/docs/products/chat/chat-modes', icon: 'i-ph:arrows-left-right-bold' },
      { label: 'Message rewind & fork', href: '/docs/products/chat/rewind-fork', icon: 'i-ph:arrow-counter-clockwise-bold' },
    ],
  },
];

// Workbench product sub-navigation
export const workbenchNavigation: NavTree = [
  {
    items: [
      { label: 'Home', href: '/docs', icon: 'i-ph:house-bold' },
    ],
  },
  {
    label: 'Getting started',
    items: [
      { label: 'Overview', href: '/docs/products/workbench', icon: 'i-ph:info-bold' },
    ],
  },
  {
    label: 'Components',
    items: [
      { label: 'Editor', href: '/docs/products/workbench/editor', icon: 'i-ph:text-cursor-bold' },
      { label: 'File tree', href: '/docs/products/workbench/file-tree', icon: 'i-ph:folder-open-bold' },
      { label: 'Preview', href: '/docs/products/workbench/preview', icon: 'i-ph:eye-bold' },
      { label: 'Terminal', href: '/docs/products/workbench/terminal', icon: 'i-ph:terminal-bold' },
      { label: 'Diff view', href: '/docs/products/workbench/diff-view', icon: 'i-ph:git-diff-bold' },
      { label: 'File locking', href: '/docs/products/workbench/file-locking', icon: 'i-ph:lock-bold' },
    ],
  },
];

// Providers product sub-navigation
export const providersNavigation: NavTree = [
  {
    items: [
      { label: 'Home', href: '/docs', icon: 'i-ph:house-bold' },
    ],
  },
  {
    label: 'Getting started',
    items: [
      { label: 'Overview', href: '/docs/products/providers', icon: 'i-ph:info-bold' },
      { label: 'API keys', href: '/docs/products/providers/api-keys', icon: 'i-ph:key-bold' },
      { label: 'Model selection', href: '/docs/products/providers/model-selection', icon: 'i-ph:funnel-bold' },
      { label: 'Rate limiting', href: '/docs/products/providers/rate-limiting', icon: 'i-ph:speedometer-bold' },
    ],
  },
  {
    label: 'Cloud providers',
    items: [
      { label: 'OpenAI', href: '/docs/products/providers/openai', icon: 'i-ph:cloud-bold' },
      { label: 'Anthropic', href: '/docs/products/providers/anthropic', icon: 'i-ph:brain-bold' },
      { label: 'Google', href: '/docs/products/providers/google', icon: 'i-ph:sparkle-bold' },
      { label: 'DeepSeek', href: '/docs/products/providers/deepseek', icon: 'i-ph:magnifying-glass-bold' },
      { label: 'Groq', href: '/docs/products/providers/groq', icon: 'i-ph:bolt-bold' },
      { label: 'Cohere', href: '/docs/products/providers/cohere', icon: 'i-ph:link-bold' },
      { label: 'Mistral', href: '/docs/products/providers/mistral', icon: 'i-ph:wind-bold' },
      { label: 'xAI', href: '/docs/products/providers/xai', icon: 'i-ph:atom-bold' },
      { label: 'Together AI', href: '/docs/products/providers/together', icon: 'i-ph:people-bold' },
      { label: 'Perplexity', href: '/docs/products/providers/perplexity', icon: 'i-ph:question-bold' },
      { label: 'OpenRouter', href: '/docs/products/providers/openrouter', icon: 'i-ph:route-bold' },
      { label: 'Amazon Bedrock', href: '/docs/products/providers/bedrock', icon: 'i-ph:cube-bold' },
      { label: 'GitHub Models', href: '/docs/products/providers/github-models', icon: 'i-ph:github-logo-bold' },
      { label: 'HuggingFace', href: '/docs/products/providers/huggingface', icon: 'i-ph:face-bold' },
      { label: 'Fireworks', href: '/docs/products/providers/fireworks', icon: 'i-ph:fire-bold' },
      { label: 'Cerebras', href: '/docs/products/providers/cerebras', icon: 'i-ph:cpu-bold' },
      { label: 'Moonshot', href: '/docs/products/providers/moonshot', icon: 'i-ph:moon-bold' },
      { label: 'Hyperbolic', href: '/docs/products/providers/hyperbolic', icon: 'i-ph:chart-line-up-bold' },
      { label: 'ZAI', href: '/docs/products/providers/zai', icon: 'i-ph:zap-bold' },
    ],
  },
  {
    label: 'Local providers',
    items: [
      { label: 'Ollama', href: '/docs/products/providers/ollama', icon: 'i-ph:ram-bold' },
      { label: 'LM Studio', href: '/docs/products/providers/lm-studio', icon: 'i-ph:desktop-bold' },
      { label: 'OpenAI-compatible', href: '/docs/products/providers/openai-like', icon: 'i-ph:puzzle-piece-bold' },
    ],
  },
];

// Deploy product sub-navigation
export const deployNavigation: NavTree = [
  {
    items: [
      { label: 'Home', href: '/docs', icon: 'i-ph:house-bold' },
    ],
  },
  {
    label: 'Getting started',
    items: [
      { label: 'Overview', href: '/docs/products/deploy', icon: 'i-ph:info-bold' },
    ],
  },
  {
    label: 'Platforms',
    items: [
      { label: 'GitHub Pages', href: '/docs/products/deploy/github', icon: 'i-ph:github-logo-bold' },
      { label: 'Vercel', href: '/docs/products/deploy/vercel', icon: 'i-ph:triangle-bold' },
      { label: 'Netlify', href: '/docs/products/deploy/netlify', icon: 'i-ph:netlify-logo-bold' },
      { label: 'GitLab Pages', href: '/docs/products/deploy/gitlab', icon: 'i-ph:gitlab-logo-bold' },
    ],
  },
];

// MCP sub-navigation
export const mcpNavigation: NavTree = [
  {
    items: [
      { label: 'Home', href: '/docs', icon: 'i-ph:house-bold' },
    ],
  },
  {
    label: 'Getting started',
    items: [
      { label: 'Overview', href: '/docs/integrations/mcp', icon: 'i-ph:info-bold' },
      { label: 'Transport types', href: '/docs/integrations/mcp/transports', icon: 'i-ph:bus-bold' },
      { label: 'Configuration', href: '/docs/integrations/mcp/configuration', icon: 'i-ph:sliders-bold' },
    ],
  },
];

// GitHub integration sub-navigation
export const githubNavigation: NavTree = [
  {
    items: [
      { label: 'Home', href: '/docs', icon: 'i-ph:house-bold' },
    ],
  },
  {
    label: 'Getting started',
    items: [
      { label: 'Overview', href: '/docs/integrations/github', icon: 'i-ph:info-bold' },
      { label: 'Authentication', href: '/docs/integrations/github/auth', icon: 'i-ph:key-bold' },
      { label: 'Deploy to GitHub', href: '/docs/integrations/github/deploy', icon: 'i-ph:rocket-bold' },
      { label: 'Clone repositories', href: '/docs/integrations/github/clone', icon: 'i-ph:git-branch-bold' },
    ],
  },
];
