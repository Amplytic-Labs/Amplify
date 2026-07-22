import { DocsLayout } from 'fumadocs-ui/layouts/docs';
import { DocsPage, DocsBody, DocsTitle, DocsDescription } from 'fumadocs-ui/layouts/docs/page';
import { baseOptions } from '@/lib/layout.shared';
import { source } from '@/lib/source';
import { useParams } from 'react-router-dom';

export default function DocsRoute() {
  const params = useParams();
  const slugStr = params['*'] || '';
  const slugs = slugStr ? slugStr.split('/') : [];

  const page = source.getPage(slugs);

  if (!page) {
    return (
      <DocsLayout {...baseOptions()} tree={source.getPageTree()}>
        <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
          <h1 className="text-2xl font-bold mb-2">Page Not Found</h1>
          <p className="text-fd-muted-foreground mb-4">
            The documentation page you&apos;re looking for doesn&apos;t exist.
          </p>
          <a href="/docs" className="text-fd-primary underline">Go to Docs Home</a>
        </div>
      </DocsLayout>
    );
  }

  const MDX = page.data.mdx;

  return (
    <DocsLayout {...baseOptions()} tree={source.getPageTree()}>
      <DocsPage toc={page.data.toc}>
        <DocsTitle>{page.data.title}</DocsTitle>
        <DocsDescription>{page.data.description}</DocsDescription>
        <DocsBody>
          <MDX />
        </DocsBody>
      </DocsPage>
    </DocsLayout>
  );
}
