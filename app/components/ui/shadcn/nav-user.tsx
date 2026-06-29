'use client';

import { BadgeCheck, Bell, ChevronsUpDown, CreditCard, LogOut, Sparkles } from 'lucide-react';
import * as DropdownMenu from '@radix-ui/react-dropdown-menu';

import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from '~/components/ui/shadcn/sidebar';
import { classNames } from '~/utils/classNames';

export function NavUser({
  user,
}: {
  user: {
    name: string;
    email: string;
    avatar: string;
  };
}) {
  const { isMobile } = useSidebar();
  const initials = user.name
    .split(' ')
    .map((n) => n[0])
    .join('')
    .slice(0, 2)
    .toUpperCase();

  const avatarEl = (
    <div className="flex h-8 w-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground text-xs font-bold shrink-0">
      {initials}
    </div>
  );

  return (
    <SidebarMenu>
      <SidebarMenuItem>
        <DropdownMenu.Root>
          <DropdownMenu.Trigger asChild>
            <SidebarMenuButton
              size="lg"
              className="data-[state=open]:bg-sidebar-accent data-[state=open]:text-sidebar-accent-foreground"
            >
              {avatarEl}
              <div className="grid flex-1 text-left text-sm leading-tight">
                <span className="truncate font-medium">{user.name}</span>
                <span className="truncate text-xs opacity-60">{user.email}</span>
              </div>
              <ChevronsUpDown className="ml-auto size-4" />
            </SidebarMenuButton>
          </DropdownMenu.Trigger>

          <DropdownMenu.Portal>
            <DropdownMenu.Content
              className={classNames(
                'min-w-56 rounded-lg p-1.5',
                'bg-amplify-elements-bg-depth-2 border border-amplify-elements-borderColor',
                'shadow-lg z-50',
                'animate-in fade-in-80 zoom-in-95',
              )}
              side={isMobile ? 'bottom' : 'right'}
              align="end"
              sideOffset={4}
            >
              {/* User info */}
              <DropdownMenu.Label className="p-0 font-normal">
                <div className="flex items-center gap-2 px-2 py-1.5 text-left text-sm">
                  {avatarEl}
                  <div className="grid flex-1 text-left text-sm leading-tight">
                    <span className="truncate font-medium text-amplify-elements-textPrimary">{user.name}</span>
                    <span className="truncate text-xs text-amplify-elements-textSecondary">{user.email}</span>
                  </div>
                </div>
              </DropdownMenu.Label>

              <DropdownMenu.Separator className="h-px bg-amplify-elements-borderColor my-1" />

              <DropdownMenu.Group>
                <DropdownMenuItem icon={<Sparkles className="size-4" />}>Upgrade to Pro</DropdownMenuItem>
              </DropdownMenu.Group>

              <DropdownMenu.Separator className="h-px bg-amplify-elements-borderColor my-1" />

              <DropdownMenu.Group>
                <DropdownMenuItem icon={<BadgeCheck className="size-4" />}>Account</DropdownMenuItem>
                <DropdownMenuItem icon={<CreditCard className="size-4" />}>Billing</DropdownMenuItem>
                <DropdownMenuItem icon={<Bell className="size-4" />}>Notifications</DropdownMenuItem>
              </DropdownMenu.Group>

              <DropdownMenu.Separator className="h-px bg-amplify-elements-borderColor my-1" />

              <DropdownMenuItem icon={<LogOut className="size-4" />}>Log out</DropdownMenuItem>
            </DropdownMenu.Content>
          </DropdownMenu.Portal>
        </DropdownMenu.Root>
      </SidebarMenuItem>
    </SidebarMenu>
  );
}

/* Helper component for dropdown items */
function DropdownMenuItem({
  children,
  icon,
  onSelect,
}: {
  children: React.ReactNode;
  icon?: React.ReactNode;
  onSelect?: () => void;
}) {
  return (
    <DropdownMenu.Item
      className={classNames(
        'relative flex items-center gap-2 rounded-md px-2 py-1.5 text-sm',
        'text-amplify-elements-textPrimary cursor-pointer outline-none',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'transition-colors select-none',
      )}
      onSelect={onSelect}
    >
      {icon}
      {children}
    </DropdownMenu.Item>
  );
}
