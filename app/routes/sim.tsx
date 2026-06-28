import { json } from '@remix-run/cloudflare';
import type { MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { SidebarProvider, SidebarTrigger, SidebarInset, Sidebar } from '~/components/ui/shadcn/sidebar';
import { ProjectSidebar } from '~/components/sidebar/ProjectSidebar';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';

export const meta: MetaFunction = () => [{ title: 'Sidebar UI Preview' }];
export const loader = () => json({});

export default function SimRoute() {
  return (
    <ClientOnly fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      {() => <SidebarPreview />}
    </ClientOnly>
  );
}

const user = {
  name: 'John Doe',
  email: 'john@example.com',
  avatar: '',
};

function SidebarPreview() {
  return (
    <SidebarProvider>
      <AppSidebar />
      <SidebarInset variant="inset">
        <header className="flex h-12 shrink-0 items-center gap-2  px-4">
          <SidebarTrigger />
          <Header />
        </header>
        <div className="flex-1 overflow-hidden">
          <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}

/* ================================================================== */
/*  App Sidebar                                                        */
/* ================================================================== */

function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <ProjectSidebar user={user} />
    </Sidebar>
  );
}

/* ================================================================== */
/*  Info Card                                                          */
/* ================================================================== */

function InfoCard({ title, description }: { title: string; description: string }) {
  return (
    <div className="rounded-lg border border-bolt-elements-borderColor bg-bolt-elements-background-depth-2 p-4">
      <h3 className="text-sm font-semibold text-bolt-elements-textPrimary">{title}</h3>
      <p className="text-xs text-bolt-elements-textSecondary mt-1">{description}</p>
    </div>
  );
}
