/**
 * Docs catch-all route — /docs/*
 *
 * Handles all individual documentation pages. Uses the slug from the URL
 * to look up the page in the source, then renders its MDX content.
 *
 * Content is embedded at build time using Vite's import.meta.glob with ?raw.
 */

import { useParams } from '@remix-run/react';
import ReactMarkdown from 'react-markdown';
import remarkGfm from 'remark-gfm';
import remarkFrontmatter from 'remark-frontmatter';
import { source } from '~/lib/docs/source';
import DocsFooter from '~/components/docs/DocsFooter';

// Import all MDX files as raw strings at build time via Vite's import.meta.glob
const rawImports = import.meta.glob('/content/docs/**/*.mdx', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const mdImports = import.meta.glob('/content/docs/**/*.md', {
  eager: true,
  query: '?raw',
  import: 'default',
}) as Record<string, string>;

const contentModules: Record<string, string> = { ...rawImports, ...mdImports };

/**
 * Parse frontmatter from raw MDX/MD content.
 */
function parseFrontmatter(raw: string): {
  title: string;
  description: string;
  content: string;
} {
  const frontmatterMatch = raw.match(/^---\n([\s\S]*?)\n---\n/);
  let title = '';
  let description = '';
  let content = raw;

  if (frontmatterMatch) {
    const frontmatter = frontmatterMatch[1];
    content = raw.slice(frontmatterMatch[0].length);

    const titleMatch = frontmatter.match(/^title:\s*(.+)$/m);
    if (titleMatch) title = titleMatch[1].trim().replace(/^["']|["']$/g, '');

    const descMatch = frontmatter.match(/^description:\s*(.+)$/m);
    if (descMatch) description = descMatch[1].trim().replace(/^["']|["']$/g, '');
  }

  return { title, description, content };
}

function getRawContent(slugs: string[]): string | undefined {
  const paths = [
    `/content/docs/${slugs.join('/')}.mdx`,
    `/content/docs/${slugs.join('/')}.md`,
  ];

  for (const path of paths) {
    if (contentModules[path]) return contentModules[path];
  }

  return undefined;
}

export default function DocsSlugPage() {
  const params = useParams();
  const slugStr = params['*'] as string | undefined;
  const slugs = slugStr ? slugStr.split('/') : [];

  const page = source.getPage(slugs);

  if (!page) {
    return (
      <div className="flex flex-col items-center justify-center min-h-[50vh] text-center">
        <h1 className="text-2xl font-bold text-amplify-elements-textPrimary mb-2">Page Not Found</h1>
        <p className="text-amplify-elements-textSecondary mb-4">
          The documentation page you&apos;re looking for doesn&apos;t exist.
        </p>
        <a href="/docs" className="text-amplify-elements-focus underline hover:no-underline">
          Go to Docs Home
        </a>
      </div>
    );
  }

  const rawContent = getRawContent(slugs);
  const parsed = rawContent ? parseFrontmatter(rawContent) : null;

  const title = parsed?.title || page.title;
  const description = parsed?.description || page.description;
  const markdownContent = parsed?.content || `# ${page.title}\n\n${page.description}\n\n*Content file could not be loaded.*`;

  return (
    <div>
      <div className="mb-8">
        <h1 className="text-3xl font-bold text-amplify-elements-textPrimary mb-3">{title}</h1>
        <p className="text-lg text-amplify-elements-textSecondary">{description}</p>
      </div>
      <div className="docs-content prose max-w-none">
        <ReactMarkdown remarkPlugins={[remarkGfm, remarkFrontmatter]}>
          {markdownContent}
        </ReactMarkdown>
      </div>
      <DocsFooter currentUrl={page.url} />
    </div>
  );
}
