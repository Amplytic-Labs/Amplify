import { HomeLayout } from 'fumadocs-ui/layouts/home';
import { baseOptions } from '@/lib/layout.shared';

export default function HomePage() {
  return (
    <HomeLayout {...baseOptions()}>
      <div className="flex flex-col items-center justify-center min-h-[60vh] text-center px-6">
        <h1 className="text-4xl font-bold mb-4">Amplify Documentation</h1>
        <p className="text-lg text-fd-muted-foreground max-w-2xl mb-8">
          Comprehensive documentation for Amplify — an open-source AI-powered coding environment
          with 22+ LLM providers, MCP support, vector database, and sandboxed workbench.
        </p>
        <div className="flex gap-4">
          <a href="/docs" className="inline-flex items-center justify-center rounded-md bg-fd-primary px-6 py-3 text-sm font-medium text-fd-primary-fg shadow transition-colors hover:bg-fd-primary/90">
            Read the Docs
          </a>
          <a href="https://github.com/imtia33/Open_Claude" className="inline-flex items-center justify-center rounded-md border border-fd-border px-6 py-3 text-sm font-medium shadow-sm transition-colors hover:bg-fd-accent">
            GitHub
          </a>
        </div>
      </div>
    </HomeLayout>
  );
}
