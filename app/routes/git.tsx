import type { LoaderFunctionArgs } from '@remix-run/cloudflare';
import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { SidebarProvider, SidebarInset, Sidebar } from '~/components/ui/shadcn/sidebar';
import { ProjectSidebar } from '~/components/sidebar/ProjectSidebar';
import { BaseChat } from '~/components/chat/BaseChat';
import { GitUrlImport } from '~/components/git/GitUrlImport.client';
import { Header } from '~/components/header/Header';
import BackgroundRays from '~/components/ui/BackgroundRays';

export const meta: MetaFunction = () => {
  return [{ title: 'Amplify' }, { name: 'description', content: 'Talk with Amplify, your AI development assistant' }];
};

export async function loader(args: LoaderFunctionArgs) {
  return json({ url: args.params.url });
}

const user = {
  name: 'John Doe',
  email: 'john@example.com',
  avatar: '',
};

export default function Index() {
  return (
    <ClientOnly fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      {() => <GitImportLayout />}
    </ClientOnly>
  );
}

function GitImportLayout() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset variant="inset">
        <BackgroundRays />
        <header className="flex h-12 shrink-0 items-center px-4 w-full">
          <div className="flex-1 min-w-0">
            <Header />
          </div>
        </header>
        <div className="flex-1 overflow-hidden">
          <ClientOnly fallback={<BaseChat />}>{() => <GitUrlImport />}</ClientOnly>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <ProjectSidebar user={user} />
    </Sidebar>
  );
}
