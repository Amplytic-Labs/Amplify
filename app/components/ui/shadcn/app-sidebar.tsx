'use client';

import * as React from 'react';
import { Command, Home, Inbox, Search, Settings } from 'lucide-react';

import { NavUser } from '~/components/ui/shadcn/nav-user';
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarSeparator,
} from '~/components/ui/shadcn/sidebar';
import { ProjectSidebar } from '~/components/sidebar/ProjectSidebar';

const data = {
  user: {
    name: 'John Doe',
    email: 'john@example.com',
    avatar: '',
  },
};

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
