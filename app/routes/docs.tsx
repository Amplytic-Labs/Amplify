/**
 * Docs layout route — wraps all /docs/* pages.
 */

import { Outlet } from '@remix-run/react';
import DocsSidebar from '~/components/docs/DocsSidebar';
import DocsHeader from '~/components/docs/DocsHeader';
import { DocsSidebarProvider } from '~/components/docs/DocsSidebarContext';

export default function DocsLayoutRoute() {
  return (
    <DocsSidebarProvider>
      <div className="flex flex-col min-h-screen bg-amplify-elements-bg-depth-1">
        <DocsHeader />
        <div className="flex flex-1 overflow-hidden">
          <DocsSidebar />
          <main className="flex-1 overflow-y-auto px-6 py-8 lg:px-12 max-w-4xl mx-auto w-full">
            <Outlet />
          </main>
        </div>
      </div>
    </DocsSidebarProvider>
  );
}
