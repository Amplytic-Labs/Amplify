import { json, type MetaFunction } from '@remix-run/cloudflare';
import { ClientOnly } from 'remix-utils/client-only';
import { SidebarProvider, SidebarInset, Sidebar, useSidebar } from '~/components/ui/shadcn/sidebar';
import { ProjectSidebar } from '~/components/sidebar/ProjectSidebar';
import { BaseChat } from '~/components/chat/BaseChat';
import { Chat } from '~/components/chat/Chat.client';
import { Header } from '~/components/header/Header';
import Background from '~/components/ui/Background';
import { themeStore } from '~/lib/stores/theme';
import { chatStore } from '~/lib/stores/chat';
import { useStore } from '@nanostores/react';
import { insetView, showChatView } from '~/lib/stores/insetView';
import { setSelectedProject } from '~/lib/stores/selectedProject';
import { ProjectsGallery } from '~/components/project/ProjectsGallery';
import type { Project } from '~/lib/persistence/project-store';

export const meta: MetaFunction = () => {
  return [{ title: 'Amplify' }, { name: 'description', content: 'Talk with Amplify, your AI development assistant' }];
};

export const loader = () => json({});

const user = {
  name: 'John Doe',
  email: 'john@example.com',
  avatar: '',
};

/**
 * Landing page component for Amplify
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
  const insetViewValue = useStore(insetView);

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
            {/*
              Sidebar-inset content swap:
                • insetView === 'projects' → full-screen projects gallery replaces
                  the chat (triggered by the sidebar "Projects" nav button).
                • insetView === 'chat' (default) → the base chat. Selecting a
                  project from the gallery flips this back to 'chat'.
            */}
            {insetViewValue === 'projects' ? (
              <ClientOnly fallback={<BaseChat />}>
                {() => <ProjectsGallery onSelectProject={handleSelectProjectFromGallery} />}
              </ClientOnly>
            ) : (
              <ClientOnly fallback={<BaseChat />}>{() => <Chat />}</ClientOnly>
            )}
          </div>
        </Background>
      </SidebarInset>
    </SidebarProvider>
  );
}

/**
 * Handler invoked when a project tile is clicked in the gallery.
 *
 * Sets the selection optimistically, then dispatches a window event that the
 * ProjectSidebar listens for — the sidebar runs its full project-load flow
 * (create an empty project chat, load workspace files, auto-run setup,
 * navigate). Finally flips the inset back to the chat view.
 *
 * The selection logic lives in the sidebar (not here) so all the existing
 * workspace/IndexedDB/navigate plumbing stays in one place.
 */
function handleSelectProjectFromGallery(project: Project) {
  setSelectedProject(project.id);

  window.dispatchEvent(new CustomEvent('amplify:select-project-from-gallery', { detail: { projectId: project.id } }));

  showChatView();
}

function AppSidebar() {
  return (
    <Sidebar variant="inset">
      <ProjectSidebar user={user} />
    </Sidebar>
  );
}
