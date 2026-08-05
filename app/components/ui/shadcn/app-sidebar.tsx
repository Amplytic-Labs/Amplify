'use client';

import * as React from 'react';
import { Home, Inbox, Search, Settings } from 'lucide-react';

import {
  Sidebar,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarContent,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarFooter,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarGroup,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarGroupContent,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarGroupLabel,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarHeader,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarMenu,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarMenuButton,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarMenuItem,
  // eslint-disable-next-line @typescript-eslint/no-unused-vars
  SidebarSeparator,
} from '~/components/ui/shadcn/sidebar';
import { ProjectSidebar } from '~/components/sidebar/ProjectSidebar';

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const data = {
  user: {
    name: 'John Doe',
    email: 'john@example.com',
    avatar: '',
  },
};

// eslint-disable-next-line @typescript-eslint/no-unused-vars
const menuItems = [
  { title: 'Home', url: '#', icon: Home },
  { title: 'Inbox', url: '#', icon: Inbox },
  { title: 'Search', url: '#', icon: Search },
  { title: 'Settings', url: '#', icon: Settings },
];

export function AppSidebar({ ...props }: React.ComponentProps<typeof Sidebar>) {
  return (
    <Sidebar variant="inset" {...props}>
      <ProjectSidebar />
    </Sidebar>
  );
}
