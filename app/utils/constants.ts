import { LLMManager } from '~/lib/modules/llm/manager';
import type { Template } from '~/types/template';

export const WORK_DIR_NAME = 'project';
export const WORK_DIR = `/home/${WORK_DIR_NAME}`;
export const MODIFICATIONS_TAG_NAME = 'amplify_file_modifications';
export const MODEL_REGEX = /^\[Model: (.*?)\]\n\n/;
export const PROVIDER_REGEX = /\[Provider: (.*?)\]\n\n/;
export const DEFAULT_MODEL = 'claude-3-5-sonnet-latest';
export const PROMPT_COOKIE_KEY = 'cachedPrompt';
export const TOOL_EXECUTION_APPROVAL = {
  APPROVE: 'Yes, approved.',
  REJECT: 'No, rejected.',
} as const;
export const TOOL_NO_EXECUTE_FUNCTION = 'Error: No execute function found on tool';
export const TOOL_EXECUTION_DENIED = 'Error: User denied access to tool execution';
export const TOOL_EXECUTION_ERROR = 'Error: An error occured while calling tool';

/**
 * Provider list and default provider are now lazy-loaded because
 * LLMManager uses dynamic imports for providers (reducing the initial
 * Worker bundle by ~500KB-1MB). These are Promises that resolve once
 * on first access and are then cached.
 */
const llmManager = LLMManager.getInstance(import.meta.env);

export const PROVIDER_LIST = llmManager.getAllProviders();
export const DEFAULT_PROVIDER = llmManager.getDefaultProvider();

export const providerBaseUrlEnvKeys: Record<string, { baseUrlKey?: string; apiTokenKey?: string }> = {};

/**
 * Initialize provider env keys mapping asynchronously.
 * Called once during app startup.
 */
export async function initProviderEnvKeys() {
  const providers = await PROVIDER_LIST;
  providers.forEach((provider) => {
    providerBaseUrlEnvKeys[provider.name] = {
      baseUrlKey: provider.config.baseUrlKey,
      apiTokenKey: provider.config.apiTokenKey,
    };
  });
}

// Eagerly initialize for backward compatibility
initProviderEnvKeys().catch(() => {});

// starter Templates

export const STARTER_TEMPLATES: Template[] = [
  {
    name: 'Expo App',
    label: 'Expo App',
    description: 'Expo starter template for building cross-platform mobile apps',
    githubRepo: 'Amplytic-Labs/Expo-Starter-Template',
    tags: ['mobile', 'expo', 'mobile-app', 'android', 'iphone'],
    icon: 'i-amplify:expo',
  },
  {
    name: 'Basic Astro',
    label: 'Astro Basic',
    description: 'Lightweight Astro starter template for building fast static websites',
    githubRepo: 'Amplytic-Labs/amplify-astro-basic-template',
    tags: ['astro', 'blog', 'performance'],
    icon: 'i-amplify:astro',
  },
  {
    name: 'NextJS Shadcn',
    label: 'Next.js with shadcn/ui',
    description: 'Next.js starter fullstack template integrated with shadcn/ui components and styling system',
    githubRepo: 'Amplytic-Labs/amplify-nextjs-shadcn-template',
    tags: ['nextjs', 'react', 'typescript', 'shadcn', 'tailwind'],
    icon: 'i-amplify:nextjs',
  },
  {
    name: 'Vite Shadcn',
    label: 'Vite with shadcn/ui',
    description: 'Vite starter fullstack template integrated with shadcn/ui components and styling system',
    githubRepo: 'Amplytic-Labs/vite-shadcn',
    tags: ['vite', 'react', 'typescript', 'shadcn', 'tailwind'],
    icon: 'i-amplify:shadcn',
  },
  {
    name: 'Remix Typescript',
    label: 'Remix TypeScript',
    description: 'Remix framework starter with TypeScript for full-stack web applications',
    githubRepo: 'Amplytic-Labs/amplify-remix-ts-template',
    tags: ['remix', 'typescript', 'fullstack', 'react'],
    icon: 'i-amplify:remix',
  },
  {
    name: 'Slidev',
    label: 'Slidev Presentation',
    description: 'Slidev starter template for creating developer-friendly presentations using Markdown',
    githubRepo: 'Amplytic-Labs/amplify-slidev-template',
    tags: ['slidev', 'presentation', 'markdown'],
    icon: 'i-amplify:slidev',
  },
  {
    name: 'Sveltekit',
    label: 'SvelteKit',
    description: 'SvelteKit starter template for building fast, efficient web applications',
    githubRepo: 'Amplytic-Labs/amplify-sveltekit-template',
    tags: ['svelte', 'sveltekit', 'typescript'],
    icon: 'i-amplify:svelte',
  },
  {
    name: 'Vanilla Vite',
    label: 'Vanilla + Vite',
    description: 'Minimal Vite starter template for vanilla JavaScript projects',
    githubRepo: 'Amplytic-Labs/vanilla-vite-template',
    tags: ['vite', 'vanilla-js', 'minimal'],
    icon: 'i-amplify:vite',
  },
  {
    name: 'Vite React',
    label: 'React + Vite + TypeScript',
    description: 'React starter template powered by Vite for fast development experience',
    githubRepo: 'Amplytic-Labs/amplify-vite-react-ts-template',
    tags: ['react', 'vite', 'frontend', 'website', 'app'],
    icon: 'i-amplify:react',
  },
  {
    name: 'Vite Typescript',
    label: 'Vite + TypeScript',
    description: 'Vite starter template with TypeScript configuration for type-safe development',
    githubRepo: 'Amplytic-Labs/amplify-vite-ts-template',
    tags: ['vite', 'typescript', 'minimal'],
    icon: 'i-amplify:typescript',
  },
  {
    name: 'Vue',
    label: 'Vue.js',
    description: 'Vue.js starter template with modern tooling and best practices',
    githubRepo: 'Amplytic-Labs/amplify-vue-template',
    tags: ['vue', 'typescript', 'frontend'],
    icon: 'i-amplify:vue',
  },
  {
    name: 'Angular',
    label: 'Angular Starter',
    description: 'A modern Angular starter template with TypeScript support and best practices configuration',
    githubRepo: 'Amplytic-Labs/amplify-angular-template',
    tags: ['angular', 'typescript', 'frontend', 'spa'],
    icon: 'i-amplify:angular',
  },
  {
    name: 'SolidJS',
    label: 'SolidJS Tailwind',
    description: 'Lightweight SolidJS starter template for building fast static websites',
    githubRepo: 'Amplytic-Labs/solidjs-ts-tw',
    tags: ['solidjs'],
    icon: 'i-amplify:solidjs',
  },
];

/**
 * Generate a clean, human-readable chat/project name from a git repo URL.
 *
 * - If the repo matches a STARTER_TEMPLATES entry (by githubRepo), returns
 *   `Start with {Template} Template` (e.g. "Start with Expo Template").
 * - Otherwise, prettifies the repo name: strips `.git`, replaces `-`/`_`
 *   with spaces, and Title-Cases it (e.g. "expo-starter-template" →
 *   "Expo Starter Template").
 *
 * This replaces the old ugly `Git Project:Expo-Starter-Template.git`
 * naming that leaked the raw repo slug (with `.git` suffix) into the
 * sidebar and project list.
 */
export function chatNameForRepo(repoUrl: string): string {
  if (!repoUrl || typeof repoUrl !== 'string') {
    return 'Imported Project';
  }

  // Normalize: strip trailing slashes + .git suffix
  const cleaned = repoUrl.replace(/\/+$/, '').replace(/\.git$/, '');
  const repoName = cleaned.split('/').slice(-1)[0] || 'Imported Project';

  // Match against STARTER_TEMPLATES by githubRepo
  const match = STARTER_TEMPLATES.find((t) => cleaned.includes(t.githubRepo));

  if (match) {
    // Strip a trailing " App" so "Expo App" → "Expo"
    const shortName = match.name.replace(/\s+App$/i, '').trim() || match.name;

    return `Start with ${shortName} Template`;
  }

  // Fall back to a prettified repo name
  const pretty = repoName
    .replace(/[-_]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/\b\w/g, (c) => c.toUpperCase());

  return pretty || 'Imported Project';
}
