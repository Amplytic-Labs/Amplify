/**
 * Custom docs source loader for the Amplify docs system.
 *
 * Since fumadocs npm packages are not compatible with this project's
 * Remix + React 18 + Vite 5 stack, this module manually builds the
 * page tree and provides content lookup methods that the Remix route
 * handlers and custom docs UI components use.
 */

// ---------------------------------------------------------------------------
// Page tree types (defined locally since fumadocs-core is not installed)
// ---------------------------------------------------------------------------

export interface PageTreeItem {
  type: 'page';
  name: string;
  url: string;
  icon?: string;
}

export interface PageTreeFolder {
  type: 'folder';
  name: string;
  description?: string;
  icon?: string;
  defaultOpen?: boolean;
  children: PageTreeNode[];
}

export type PageTreeNode = PageTreeItem | PageTreeFolder;

export interface PageTreeRoot {
  name: string;
  children: PageTreeNode[];
}

// ---------------------------------------------------------------------------
// Page metadata type
// ---------------------------------------------------------------------------

export interface DocsPageMeta {
  /** Display title of the page */
  title: string;
  /** Short description for sidebar / search */
  description: string;
  /** URL path relative to the docs root (e.g. "/docs/getting-started/quick-start") */
  url: string;
  /** Slug segments used to look up the page (e.g. ["getting-started", "quick-start"]) */
  slugs: string[];
  /** Icon name (lucide icon string) — resolved at render time */
  icon?: string;
  /** Relative file path to the MDX/Markdown content file */
  filePath: string;
}

// ---------------------------------------------------------------------------
// Page tree — manual definition
// ---------------------------------------------------------------------------
// Each entry matches the content/docs/ directory hierarchy. When actual
// MDX/Markdown files are added to content/docs/, the filePath values here
// will point to them so route loaders can read and render the content.

const BASE_URL = "/docs";

/** Helper: build a full URL from slug segments */
function slugUrl(slugs: string[]): string {
  return `${BASE_URL}/${slugs.join("/")}`;
}

/** Helper: build a relative file path from slug segments */
function slugFilePath(slugs: string[]): string {
  return `content/docs/${slugs.join("/")}.mdx`;
}

// ── Getting Started ──────────────────────────────────────────────────────

const gettingStartedPages: DocsPageMeta[] = [
  {
    title: "Quick Start",
    description: "Get up and running with Amplify in under 5 minutes",
    url: slugUrl(["getting-started", "quick-start"]),
    slugs: ["getting-started", "quick-start"],
    icon: "Rocket",
    filePath: slugFilePath(["getting-started", "quick-start"]),
  },
  {
    title: "Installation",
    description: "Install Amplify on your platform of choice",
    url: slugUrl(["getting-started", "installation"]),
    slugs: ["getting-started", "installation"],
    icon: "Download",
    filePath: slugFilePath(["getting-started", "installation"]),
  },
  {
    title: "Configuration",
    description: "Configure providers, features, and preferences",
    url: slugUrl(["getting-started", "configuration"]),
    slugs: ["getting-started", "configuration"],
    icon: "Settings",
    filePath: slugFilePath(["getting-started", "configuration"]),
  },
];

// ── Architecture ─────────────────────────────────────────────────────────

const architecturePages: DocsPageMeta[] = [
  {
    title: "Overview",
    description: "High-level architecture and design principles",
    url: slugUrl(["architecture", "overview"]),
    slugs: ["architecture", "overview"],
    icon: "LayoutDashboard",
    filePath: slugFilePath(["architecture", "overview"]),
  },
  {
    title: "LLM Pipeline",
    description: "How the AI SDK pipeline processes requests and streams responses",
    url: slugUrl(["architecture", "llm-pipeline"]),
    slugs: ["architecture", "llm-pipeline"],
    icon: "Workflow",
    filePath: slugFilePath(["architecture", "llm-pipeline"]),
  },
  {
    title: "State Management",
    description: "Zustand stores, persistence, and reactive state flow",
    url: slugUrl(["architecture", "state-management"]),
    slugs: ["architecture", "state-management"],
    icon: "Database",
    filePath: slugFilePath(["architecture", "state-management"]),
  },
];

// ── Features ─────────────────────────────────────────────────────────────

const featuresPages: DocsPageMeta[] = [
  {
    title: "Chat",
    description: "Multi-provider chat interface with streaming and context management",
    url: slugUrl(["features", "chat"]),
    slugs: ["features", "chat"],
    icon: "MessageSquare",
    filePath: slugFilePath(["features", "chat"]),
  },
  {
    title: "Workbench",
    description: "Live preview, editor, and terminal workspace",
    url: slugUrl(["features", "workbench"]),
    slugs: ["features", "workbench"],
    icon: "Monitor",
    filePath: slugFilePath(["features", "workbench"]),
  },
  {
    title: "Native Tools",
    description: "Built-in tool system for actions, file operations, and shell commands",
    url: slugUrl(["features", "native-tools"]),
    slugs: ["features", "native-tools"],
    icon: "Wrench",
    filePath: slugFilePath(["features", "native-tools"]),
  },
  {
    title: "Planning",
    description: "Multi-step planning engine with checkpoints and sub-chats",
    url: slugUrl(["features", "planning"]),
    slugs: ["features", "planning"],
    icon: "ListChecks",
    filePath: slugFilePath(["features", "planning"]),
  },
  {
    title: "Memory",
    description: "Vector-based memory and project context persistence",
    url: slugUrl(["features", "memory"]),
    slugs: ["features", "memory"],
    icon: "Brain",
    filePath: slugFilePath(["features", "memory"]),
  },
];

// ── Providers ────────────────────────────────────────────────────────────

const providersPages: DocsPageMeta[] = [
  {
    title: "Overview",
    description: "Supported LLM providers and how they integrate",
    url: slugUrl(["providers", "overview"]),
    slugs: ["providers", "overview"],
    icon: "Cloud",
    filePath: slugFilePath(["providers", "overview"]),
  },
  {
    title: "Cloud Providers",
    description: "OpenAI, Anthropic, Google, Mistral, and more",
    url: slugUrl(["providers", "cloud-providers"]),
    slugs: ["providers", "cloud-providers"],
    icon: "CloudCog",
    filePath: slugFilePath(["providers", "cloud-providers"]),
  },
  {
    title: "Local Providers",
    description: "Ollama, LM Studio, and other self-hosted options",
    url: slugUrl(["providers", "local-providers"]),
    slugs: ["providers", "local-providers"],
    icon: "Server",
    filePath: slugFilePath(["providers", "local-providers"]),
  },
  {
    title: "Rate Limits",
    description: "Understanding and handling API rate limits",
    url: slugUrl(["providers", "rate-limits"]),
    slugs: ["providers", "rate-limits"],
    icon: "ShieldAlert",
    filePath: slugFilePath(["providers", "rate-limits"]),
  },
];

// ── Integrations ─────────────────────────────────────────────────────────

const integrationsPages: DocsPageMeta[] = [
  {
    title: "MCP",
    description: "Model Context Protocol integration for tool servers",
    url: slugUrl(["integrations", "mcp"]),
    slugs: ["integrations", "mcp"],
    icon: "Puzzle",
    filePath: slugFilePath(["integrations", "mcp"]),
  },
  {
    title: "Vector DB",
    description: "Orama vector database for semantic search and memory",
    url: slugUrl(["integrations", "vector-db"]),
    slugs: ["integrations", "vector-db"],
    icon: "SearchCode",
    filePath: slugFilePath(["integrations", "vector-db"]),
  },
];

// ── Advanced ─────────────────────────────────────────────────────────────

const advancedPages: DocsPageMeta[] = [
  {
    title: "Sandboxing",
    description: "WebContainer sandboxing and security boundaries",
    url: slugUrl(["advanced", "sandboxing"]),
    slugs: ["advanced", "sandboxing"],
    icon: "Lock",
    filePath: slugFilePath(["advanced", "sandboxing"]),
  },
  {
    title: "Troubleshooting",
    description: "Common issues and how to resolve them",
    url: slugUrl(["advanced", "troubleshooting"]),
    slugs: ["advanced", "troubleshooting"],
    icon: "Bug",
    filePath: slugFilePath(["advanced", "troubleshooting"]),
  },
];

// ── Self-Hosting ─────────────────────────────────────────────────────────

const selfHostingPages: DocsPageMeta[] = [
  {
    title: "Docker",
    description: "Deploy Amplify with Docker and Docker Compose",
    url: slugUrl(["self-hosting", "docker"]),
    slugs: ["self-hosting", "docker"],
    icon: "Container",
    filePath: slugFilePath(["self-hosting", "docker"]),
  },
  {
    title: "Cloudflare",
    description: "Deploy to Cloudflare Pages with Wrangler",
    url: slugUrl(["self-hosting", "cloudflare"]),
    slugs: ["self-hosting", "cloudflare"],
    icon: "Globe",
    filePath: slugFilePath(["self-hosting", "cloudflare"]),
  },
  {
    title: "Native",
    description: "Run Amplify natively on Linux, macOS, or Windows",
    url: slugUrl(["self-hosting", "native"]),
    slugs: ["self-hosting", "native"],
    icon: "Terminal",
    filePath: slugFilePath(["self-hosting", "native"]),
  },
];

// ── Migration ────────────────────────────────────────────────────────────

const migrationPages: DocsPageMeta[] = [
  {
    title: "Workbench to Docker",
    description: "Migrate from workbench mode to Docker deployment",
    url: slugUrl(["migration", "workbench-to-docker"]),
    slugs: ["migration", "workbench-to-docker"],
    icon: "ArrowRightLeft",
    filePath: slugFilePath(["migration", "workbench-to-docker"]),
  },
  {
    title: "Workbench to Custom",
    description: "Migrate from workbench mode to a custom deployment",
    url: slugUrl(["migration", "workbench-to-custom"]),
    slugs: ["migration", "workbench-to-custom"],
    icon: "ArrowRightLeft",
    filePath: slugFilePath(["migration", "workbench-to-custom"]),
  },
  {
    title: "API Migration",
    description: "Migrate between provider API versions",
    url: slugUrl(["migration", "api-migration"]),
    slugs: ["migration", "api-migration"],
    icon: "ArrowRightLeft",
    filePath: slugFilePath(["migration", "api-migration"]),
  },
];

// ── Extending ────────────────────────────────────────────────────────────

const extendingPages: DocsPageMeta[] = [
  {
    title: "Adding Providers",
    description: "How to add a new LLM provider to Amplify",
    url: slugUrl(["extending", "adding-providers"]),
    slugs: ["extending", "adding-providers"],
    icon: "PlusCircle",
    filePath: slugFilePath(["extending", "adding-providers"]),
  },
  {
    title: "Adding Skills",
    description: "Create and register custom skills for project workflows",
    url: slugUrl(["extending", "adding-skills"]),
    slugs: ["extending", "adding-skills"],
    icon: "Sparkles",
    filePath: slugFilePath(["extending", "adding-skills"]),
  },
  {
    title: "Adding Tools",
    description: "Extend native tools with custom implementations",
    url: slugUrl(["extending", "adding-tools"]),
    slugs: ["extending", "adding-tools"],
    icon: "Hammer",
    filePath: slugFilePath(["extending", "adding-tools"]),
  },
];

// ── Contributing ─────────────────────────────────────────────────────────

const contributingPages: DocsPageMeta[] = [
  {
    title: "Contributing",
    description: "How to contribute code, docs, and ideas to Amplify",
    url: slugUrl(["contributing"]),
    slugs: ["contributing"],
    icon: "HeartHandshake",
    filePath: slugFilePath(["contributing"]),
  },
];

// ---------------------------------------------------------------------------
// All pages flat list (for lookup)
// ---------------------------------------------------------------------------

const ALL_PAGES: DocsPageMeta[] = [
  ...gettingStartedPages,
  ...architecturePages,
  ...featuresPages,
  ...providersPages,
  ...integrationsPages,
  ...advancedPages,
  ...selfHostingPages,
  ...migrationPages,
  ...extendingPages,
  ...contributingPages,
];

// ---------------------------------------------------------------------------
// Build PageTree from page groups
// ---------------------------------------------------------------------------
// Since fumadocs-mdx is not available, we construct the tree manually.
// The tree uses the exact PageTree types from fumadocs-core that
// DocsLayout expects.

/** Helper to convert DocsPageMeta → PageTreeItem */
function pageToItem(page: DocsPageMeta): PageTreeItem {
  return {
    type: "page",
    name: page.title,
    url: page.url,
    // icon is resolved to a ReactElement at render time via the layout,
    // so we leave it as undefined here and let sidebar components handle it.
  };
}

/** Helper to build a PageTreeFolder from a section definition */
function folderFromSection(
  name: string,
  description: string,
  pages: DocsPageMeta[],
  defaultOpen?: boolean,
): PageTreeFolder {
  return {
    type: "folder",
    name,
    description,
    defaultOpen,
    children: pages.map(pageToItem),
  };
}

// ---------------------------------------------------------------------------
// The root page tree
// ---------------------------------------------------------------------------

const PAGE_TREE: PageTreeRoot = {
  name: "Amplify Docs",
  children: [
    folderFromSection(
      "Getting Started",
      "Set up Amplify and start building",
      gettingStartedPages,
      true, // defaultOpen — first section should be expanded
    ),
    folderFromSection(
      "Architecture",
      "Understand how Amplify works under the hood",
      architecturePages,
    ),
    folderFromSection(
      "Features",
      "Core features and capabilities",
      featuresPages,
    ),
    folderFromSection(
      "Providers",
      "LLM provider configuration and support",
      providersPages,
    ),
    folderFromSection(
      "Integrations",
      "External service integrations",
      integrationsPages,
    ),
    folderFromSection(
      "Advanced",
      "Sandboxing, troubleshooting, and edge cases",
      advancedPages,
    ),
    folderFromSection(
      "Self-Hosting",
      "Deploy Amplify on your own infrastructure",
      selfHostingPages,
    ),
    folderFromSection(
      "Migration",
      "Migration guides for deployment and API changes",
      migrationPages,
    ),
    folderFromSection(
      "Extending",
      "Customize and extend Amplify",
      extendingPages,
    ),
    folderFromSection(
      "Contributing",
      "Join the Amplify community",
      contributingPages,
    ),
  ],
};

// ---------------------------------------------------------------------------
// Source API — the public interface consumed by route handlers and layouts
// ---------------------------------------------------------------------------

export const source = {
  /**
   * Return the full page tree for DocsLayout sidebar rendering.
   * This is the same shape that fumadocs-mdx's `loader()` would produce,
   * but built manually since we can't use fumadocs-mdx with Vite 5.
   */
  getPageTree(): PageTreeRoot {
    return PAGE_TREE;
  },

  /**
   * Look up a page by its slug segments.
   *
   * @param slugs - Array of slug segments, e.g. ["getting-started", "quick-start"]
   * @returns The page metadata, or undefined if no page matches
   *
   * Route handlers should call this to find the page, then use `page.filePath`
   * to load the actual MDX/Markdown content for rendering.
   */
  getPage(slugs: string[] | undefined): DocsPageMeta | undefined {
    if (!slugs || slugs.length === 0) return undefined;
    return ALL_PAGES.find((p) => {
      if (p.slugs.length !== slugs.length) return false;
      return p.slugs.every((s, i) => s === slugs[i]);
    });
  },

  /**
   * Return all pages as a flat list.
   * Useful for search indexing or generating static params.
   */
  getPages(): DocsPageMeta[] {
    return ALL_PAGES;
  },

  /**
   * Generate Remix-style route params for all pages.
   * Each param object has a `slug` field with the slug segments joined by "/".
   *
   * This can be used in a Remix route loader to generate static paths
   * for SSG or pre-rendering.
   */
  generateParams(): Array<{ slug: string }> {
    return ALL_PAGES.map((p) => ({
      slug: p.slugs.join("/"),
    }));
  },

  /**
   * Find the previous and next pages relative to a given URL.
   * Useful for implementing prev/next navigation on doc pages.
   */
  findNeighbours(url: string): { previous?: DocsPageMeta; next?: DocsPageMeta } {
    const index = ALL_PAGES.findIndex((p) => p.url === url);
    if (index === -1) return {};
    return {
      previous: index > 0 ? ALL_PAGES[index - 1] : undefined,
      next: index < ALL_PAGES.length - 1 ? ALL_PAGES[index + 1] : undefined,
    };
  },
};
