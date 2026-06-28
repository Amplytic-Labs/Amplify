import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { SidebarProvider, SidebarInset, Sidebar, useSidebar } from '~/components/ui/shadcn/sidebar';
import { ProjectSidebar } from '~/components/sidebar/ProjectSidebar';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import Background from '~/components/ui/Background';
import { themeStore, setTheme } from '~/lib/stores/theme';
import { chatStore } from '~/lib/stores/chat';
import { useStore } from '@nanostores/react';
export const meta: MetaFunction = () => {
  return [{ title: 'Bolt' }, { name: 'description', content: 'Talk with Bolt, an AI assistant from StackBlitz' }];
};

export const loader = () => json({});

const user = {
  name: 'John Doe',
  email: 'john@example.com',
  avatar: '',
};

/**
 * Landing page component for Bolt
 * Note: Settings functionality should ONLY be accessed through the sidebar menu.
 * Do not add settings button/panel to this landing page as it was intentionally removed
 * to keep the UI clean and consistent with the design system.
 */
export default function Index() {
  return (
    <ClientOnly fallback={<div className="flex items-center justify-center h-screen">Loading...</div>}>
      {() => <MainLayout />}
    </ClientOnly>
  );
}

import { useEffect, useRef } from 'react';

function SidebarStateEffect({ chatStarted }: { chatStarted: boolean }) {
  const { setOpen } = useSidebar();
  const prevChatStarted = useRef(chatStarted);

  useEffect(() => {
    if (chatStarted && !prevChatStarted.current) {
      setOpen(false);
    }
    prevChatStarted.current = chatStarted;
  }, [chatStarted, setOpen]);
  
  return null;
}

function MainLayout() {
  const theme = useStore(themeStore);
  const chat = useStore(chatStore);
  return (
    <SidebarProvider>
      <SidebarStateEffect chatStarted={chat.started} />
      <AppSidebar />
      <SidebarInset variant="inset">
        <Background mode={theme} transparent={chat.started}>
          <header className="flex h-12 shrink-0 items-center  px-4 w-full">
            <div className="flex-1 min-w-0">
              <Header />
            </div>
          </header>
          <div className="flex-1 overflow-hidden">
            <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
          </div>
        </Background>
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
