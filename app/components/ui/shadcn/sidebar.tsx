'use client';

import * as React from 'react';
import { cva, type VariantProps } from 'class-variance-authority';
import { PanelLeftIcon } from 'lucide-react';
import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as SeparatorPrimitive from '@radix-ui/react-separator';

import { classNames } from '~/utils/classNames';

const SIDEBAR_COOKIE_NAME = 'sidebar_state';
const SIDEBAR_COOKIE_MAX_AGE = 60 * 60 * 24 * 7;
const SIDEBAR_WIDTH = '16rem';
const SIDEBAR_WIDTH_MOBILE = '18rem';
const SIDEBAR_WIDTH_ICON = '3rem';
const SIDEBAR_KEYBOARD_SHORTCUT = 'b';

type SidebarContextProps = {
  state: 'expanded' | 'collapsed';
  open: boolean;
  setOpen: (open: boolean) => void;
  openMobile: boolean;
  setOpenMobile: (open: boolean) => void;
  isMobile: boolean;
  toggleSidebar: () => void;
};

const SidebarContext = React.createContext<SidebarContextProps | null>(null);

function useSidebar() {
  const context = React.useContext(SidebarContext);
  if (!context) {
    throw new Error('useSidebar must be used within a SidebarProvider.');
  }
  return context;
}

/* ------------------------------------------------------------------ */
/*  useIsMobile hook (inline)                                         */
/* ------------------------------------------------------------------ */

function useIsMobile(breakpoint = 768) {
  const [isMobile, setIsMobile] = React.useState(false);

  React.useEffect(() => {
    const mql = window.matchMedia(`(max-width: ${breakpoint - 1}px)`);
    const onChange = () => setIsMobile(mql.matches);
    mql.addEventListener('change', onChange);
    setIsMobile(mql.matches);
    return () => mql.removeEventListener('change', onChange);
  }, [breakpoint]);

  return isMobile;
}

/* ================================================================== */
/*  SidebarProvider                                                    */
/* ================================================================== */

function SidebarProvider({
  defaultOpen = true,
  open: openProp,
  onOpenChange: setOpenProp,
  className,
  style,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  defaultOpen?: boolean;
  open?: boolean;
  onOpenChange?: (open: boolean) => void;
}) {
  const isMobile = useIsMobile();
  const [openMobile, setOpenMobile] = React.useState(false);

  const [_open, _setOpen] = React.useState(defaultOpen);
  const open = openProp ?? _open;
  const setOpen = React.useCallback(
    (value: boolean | ((value: boolean) => boolean)) => {
      const openState = typeof value === 'function' ? value(open) : value;
      if (setOpenProp) {
        setOpenProp(openState);
      } else {
        _setOpen(openState);
      }
      document.cookie = `${SIDEBAR_COOKIE_NAME}=${openState}; path=/; max-age=${SIDEBAR_COOKIE_MAX_AGE}`;
    },
    [setOpenProp, open],
  );

  const toggleSidebar = React.useCallback(() => {
    return isMobile ? setOpenMobile((o) => !o) : setOpen((o) => !o);
  }, [isMobile, setOpen, setOpenMobile]);

  React.useEffect(() => {
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === SIDEBAR_KEYBOARD_SHORTCUT && (event.metaKey || event.ctrlKey)) {
        event.preventDefault();
        toggleSidebar();
      }
    };
    window.addEventListener('keydown', handleKeyDown);
    return () => window.removeEventListener('keydown', handleKeyDown);
  }, [toggleSidebar]);

  const state = open ? 'expanded' : 'collapsed';

  const contextValue = React.useMemo<SidebarContextProps>(
    () => ({ state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar }),
    [state, open, setOpen, isMobile, openMobile, setOpenMobile, toggleSidebar],
  );

  return (
    <SidebarContext.Provider value={contextValue}>
      <TooltipPrimitive.Provider>
        <div
          data-slot="sidebar-wrapper"
          style={
            {
              '--sidebar-width': SIDEBAR_WIDTH,
              '--sidebar-width-icon': SIDEBAR_WIDTH_ICON,
              ...style,
            } as React.CSSProperties
          }
          className={classNames('group/sidebar-wrapper flex h-screen w-full overflow-hidden bg-sidebar', className)}
          {...props}
        >
          {children}
        </div>
      </TooltipPrimitive.Provider>
    </SidebarContext.Provider>
  );
}

/* ================================================================== */
/*  Sidebar                                                            */
/* ================================================================== */

function Sidebar({
  side = 'left',
  variant = 'sidebar',
  collapsible = 'offcanvas',
  className,
  children,
  ...props
}: React.ComponentProps<'div'> & {
  side?: 'left' | 'right';
  variant?: 'sidebar' | 'floating' | 'inset';
  collapsible?: 'offcanvas' | 'icon' | 'none';
}) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar();

  if (collapsible === 'none') {
    return (
      <div
        data-slot="sidebar"
        className={classNames('flex h-full w-64 flex-col bg-sidebar text-sidebar-foreground', className)}
        {...props}
      >
        {children}
      </div>
    );
  }

  if (isMobile) {
    return (
      <DialogPrimitive.Root open={openMobile} onOpenChange={setOpenMobile}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay
            forceMount
            className={classNames(
              'fixed inset-0 z-40 bg-black/50',
              'transition-opacity duration-300 ease-in-out',
              'data-[state=open]:opacity-100 data-[state=closed]:opacity-0',
            )}
          />
          <DialogPrimitive.Content
            forceMount
            className={classNames(
              'fixed inset-y-0 z-50 w-72 bg-sidebar text-sidebar-foreground p-0',
              'transition-transform duration-300 ease-in-out',
              side === 'left'
                ? 'left-0 data-[state=open]:translate-x-0 data-[state=closed]:-translate-x-full'
                : 'right-0 data-[state=open]:translate-x-0 data-[state=closed]:translate-x-full',
            )}
          >
            <DialogPrimitive.Title className="sr-only">Sidebar</DialogPrimitive.Title>
            <DialogPrimitive.Description className="sr-only">Displays the mobile sidebar.</DialogPrimitive.Description>
            <div className="flex h-full w-full flex-col">{children}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    );
  }

  const isCollapsed = state === 'collapsed';
  const isIcon = collapsible === 'icon' && isCollapsed;
  const sidebarWidth = isIcon ? SIDEBAR_WIDTH_ICON : SIDEBAR_WIDTH;

  return (
    <div
      className="group peer hidden md:block text-sidebar-foreground"
      data-state={state}
      data-collapsible={isCollapsed ? collapsible : ''}
      data-variant={variant}
      data-side={side}
      data-slot="sidebar"
    >
      {/* Sidebar gap for layout */}
      <div
        data-slot="sidebar-gap"
        style={{
          width: isIcon ? SIDEBAR_WIDTH_ICON : isCollapsed && collapsible === 'offcanvas' ? '0' : SIDEBAR_WIDTH,
          transition: 'width 200ms ease',
        }}
      />
      {/* Sidebar container */}
      <div
        data-slot="sidebar-container"
        data-side={side}
        style={{
          position: 'fixed',
          top: 0,
          bottom: 0,
          zIndex: 10,
          display: 'flex',
          width: sidebarWidth,
          transition: 'left 200ms ease, right 200ms ease, width 200ms ease',
          ...(side === 'left'
            ? { left: isCollapsed && collapsible === 'offcanvas' ? `-${SIDEBAR_WIDTH}` : '0' }
            : { right: isCollapsed && collapsible === 'offcanvas' ? `-${SIDEBAR_WIDTH}` : '0' }),
        }}
        className={classNames(
          'h-screen',
          variant === 'floating' || variant === 'inset' ? 'p-2' : '',
          variant !== 'floating' && variant !== 'inset' && side === 'left' ? 'border-r border-sidebar-border' : '',
          variant !== 'floating' && variant !== 'inset' && side === 'right' ? 'border-l border-sidebar-border' : '',
          className,
        )}
        {...props}
      >
        <div
          data-sidebar="sidebar"
          data-slot="sidebar-inner"
          className={classNames(
            'flex size-full flex-col bg-sidebar',
            variant === 'floating' ? 'rounded-lg shadow-sm ring-1 ring-sidebar-border' : '',
            variant === 'inset' ? 'rounded-xl' : '',
          )}
        >
          {children}
        </div>
      </div>
    </div>
  );
}

/* ================================================================== */
/*  SidebarTrigger                                                     */
/* ================================================================== */

function SidebarTrigger({ className, onClick, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar, open } = useSidebar();

  return (
    <button
      data-sidebar="trigger"
      data-slot="sidebar-trigger"
      className={classNames(
        'inline-flex items-center justify-center rounded-md p-2 ',
        'text-[#09090b] dark:text-white bg-transparent hover:text-[#09090b]/80 dark:hover:text-white/80',
        'transition-colors focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        className,
      )}
      onClick={(event) => {
        onClick?.(event as any);
        toggleSidebar();
      }}
      {...props}
    >
      <svg
        viewBox="0 0 32 32"
        className="w-7 h-7"
        style={{
          transform: open ? 'rotate(-45deg)' : 'rotate(0deg)',
          transition: 'transform 600ms cubic-bezier(0.4, 0, 0.2, 1)',
        }}
      >
        <path
          d="M27 10 13 10C10.8 10 9 8.2 9 6 9 3.5 10.8 2 13 2 15.2 2 17 3.8 17 6L17 26C17 28.2 18.8 30 21 30 23.2 30 25 28.2 25 26 25 23.8 23.2 22 21 22L7 22"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
          strokeDasharray={open ? '20 300' : '12 63'}
          strokeDashoffset={open ? -32.42 : 0}
          style={{
            transition:
              'stroke-dasharray 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
        <path
          d="M7 16 27 16"
          fill="none"
          stroke="currentColor"
          strokeLinecap="round"
          strokeLinejoin="round"
          strokeWidth={3}
          style={{
            transition:
              'stroke-dasharray 600ms cubic-bezier(0.4, 0, 0.2, 1), stroke-dashoffset 600ms cubic-bezier(0.4, 0, 0.2, 1)',
          }}
        />
      </svg>
      <span className="sr-only">Toggle Sidebar</span>
    </button>
  );
}

/* ================================================================== */
/*  SidebarRail                                                        */
/* ================================================================== */

function SidebarRail({ className, ...props }: React.ComponentProps<'button'>) {
  const { toggleSidebar } = useSidebar();

  return (
    <button
      data-sidebar="rail"
      data-slot="sidebar-rail"
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className={classNames(
        'absolute inset-y-0 z-20 hidden w-4 sm:flex',
        'after:absolute after:inset-y-0 after:left-1/2 after:w-0.5',
        'hover:after:bg-sidebar-border',
        'transition-all ease-linear',
        className,
      )}
      style={{ cursor: 'pointer' }}
      {...props}
    />
  );
}

/* ================================================================== */
/*  SidebarInset                                                       */
/* ================================================================== */

function SidebarInset({
  className,
  variant = 'sidebar',
  ...props
}: React.ComponentProps<'main'> & {
  variant?: 'sidebar' | 'floating' | 'inset';
}) {
  const { state } = useSidebar();

  return (
    <main
      data-slot="sidebar-inset"
      data-variant={variant}
      className={classNames(
        'relative flex w-full flex-1 flex-col transition-[margin,border-radius] duration-200 ease',
        variant === 'inset'
          ? classNames(
              'bg-card shadow-sm overflow-hidden',
              state === 'collapsed' ? 'md:m-0 md:rounded-none' : 'md:m-2 md:rounded-xl',
            )
          : variant === 'floating'
            ? 'bg-card rounded-xl shadow-sm'
            : 'bg-card',
        className,
      )}
      {...props}
    />
  );
}

/* ================================================================== */
/*  SidebarHeader / SidebarFooter / SidebarSeparator                   */
/* ================================================================== */

function SidebarHeader({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-header"
      data-sidebar="header"
      className={classNames('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

function SidebarFooter({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-footer"
      data-sidebar="footer"
      className={classNames('flex flex-col gap-2 p-2', className)}
      {...props}
    />
  );
}

function SidebarSeparator({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <SeparatorPrimitive.Root
      data-slot="sidebar-separator"
      data-sidebar="separator"
      className={classNames('mx-2 w-auto bg-sidebar-border', className)}
      {...props}
    />
  );
}

/* ================================================================== */
/*  SidebarContent                                                     */
/* ================================================================== */

function SidebarContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-content"
      data-sidebar="content"
      className={classNames('flex min-h-0 flex-1 flex-col gap-0 overflow-auto', className)}
      style={{ scrollbarWidth: 'none' }}
      {...props}
    />
  );
}

/* ================================================================== */
/*  SidebarGroup / SidebarGroupLabel / SidebarGroupAction / Content    */
/* ================================================================== */

function SidebarGroup({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group"
      data-sidebar="group"
      className={classNames('relative flex w-full min-w-0 flex-col p-2', className)}
      {...props}
    />
  );
}

function SidebarGroupLabel({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-label"
      data-sidebar="group-label"
      className={classNames(
        'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium',
        'text-sidebar-foreground/70 transition-[margin,opacity] duration-200 ease-linear',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupAction({ className, ...props }: React.ComponentProps<'button'>) {
  return (
    <button
      data-slot="sidebar-group-action"
      data-sidebar="group-action"
      className={classNames(
        'absolute top-3.5 right-3 flex aspect-square w-5 items-center justify-center rounded-md p-0',
        'bg-sidebar text-sidebar-foreground ring-sidebar-ring outline-none',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'focus-visible:ring-2 transition-transform',
        className,
      )}
      {...props}
    />
  );
}

function SidebarGroupContent({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-group-content"
      data-sidebar="group-content"
      className={classNames('w-full text-sm', className)}
      {...props}
    />
  );
}

/* ================================================================== */
/*  SidebarMenu / SidebarMenuItem                                      */
/* ================================================================== */

function SidebarMenu({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu"
      data-sidebar="menu"
      className={classNames('flex w-full min-w-0 flex-col gap-0', className)}
      {...props}
    />
  );
}

function SidebarMenuItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-item"
      data-sidebar="menu-item"
      className={classNames('relative', className)}
      {...props}
    />
  );
}

/* ================================================================== */
/*  SidebarMenuButton                                                  */
/* ================================================================== */

const sidebarMenuButtonVariants = cva(
  'flex w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm bg-sidebar text-sidebar-foreground ring-sidebar-ring outline-none transition-[width,height,padding,background-color] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground',
  {
    variants: {
      variant: {
        default: 'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        outline:
          'bg-amplify-elements-bg-depth-1 shadow-[0_0_0_1px_var(--sidebar-border)] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
      },
      size: {
        default: 'h-8 text-sm',
        sm: 'h-7 text-xs',
        lg: 'h-12 text-sm',
      },
    },
    defaultVariants: {
      variant: 'default',
      size: 'default',
    },
  },
);

function SidebarMenuButton({
  isActive = false,
  variant = 'default',
  size = 'default',
  tooltip,
  className,
  children,
  ...props
}: React.ComponentProps<'button'> & {
  isActive?: boolean;
  tooltip?: string | React.ComponentProps<typeof TooltipPrimitive.Content>;
} & VariantProps<typeof sidebarMenuButtonVariants>) {
  const { isMobile, state } = useSidebar();

  const button = (
    <button
      data-slot="sidebar-menu-button"
      data-sidebar="menu-button"
      data-size={size}
      data-active={isActive}
      className={classNames(sidebarMenuButtonVariants({ variant, size }), className)}
      {...props}
    >
      {children}
    </button>
  );

  if (!tooltip) {
    return button;
  }

  const tooltipChildren = typeof tooltip === 'string' ? tooltip : (tooltip as any).children;
  const tooltipProps = typeof tooltip === 'string' ? {} : tooltip;

  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{button}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          align="center"
          hidden={state !== 'collapsed' || isMobile}
          className={classNames(
            'z-50 overflow-hidden rounded-md bg-amplify-elements-bg-depth-3 px-3 py-1.5 text-xs',
            'text-amplify-elements-textPrimary shadow-md',
          )}
          sideOffset={5}
          {...tooltipProps}
        >
          {tooltipChildren}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

/* ================================================================== */
/*  SidebarMenuAction / SidebarMenuBadge / SidebarMenuSkeleton         */
/* ================================================================== */

function SidebarMenuAction({
  className,
  showOnHover = false,
  ...props
}: React.ComponentProps<'button'> & { showOnHover?: boolean }) {
  return (
    <button
      data-slot="sidebar-menu-action"
      data-sidebar="menu-action"
      className={classNames(
        'absolute top-1.5 right-1 flex aspect-square w-5 items-center justify-center rounded-md p-0',
        'bg-sidebar text-sidebar-foreground ring-sidebar-ring outline-none transition-transform',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2',
        showOnHover ? 'opacity-0 hover:opacity-100' : '',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuBadge({ className, ...props }: React.ComponentProps<'div'>) {
  return (
    <div
      data-slot="sidebar-menu-badge"
      data-sidebar="menu-badge"
      className={classNames(
        'pointer-events-none absolute right-1 flex h-5 min-w-5 items-center justify-center rounded-md px-1 text-xs font-medium',
        'text-sidebar-foreground select-none',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSkeleton({
  className,
  showIcon = false,
  ...props
}: React.ComponentProps<'div'> & { showIcon?: boolean }) {
  const [width] = React.useState(() => `${Math.floor(Math.random() * 40) + 50}%`);

  return (
    <div
      data-slot="sidebar-menu-skeleton"
      data-sidebar="menu-skeleton"
      className={classNames('flex h-8 items-center gap-2 rounded-md px-2', className)}
      {...props}
    >
      {showIcon && (
        <div className="size-4 rounded-md bg-sidebar-accent animate-pulse" data-sidebar="menu-skeleton-icon" />
      )}
      <div
        className="h-4 flex-1 rounded-md bg-sidebar-accent animate-pulse"
        style={{ maxWidth: width }}
        data-sidebar="menu-skeleton-text"
      />
    </div>
  );
}

/* ================================================================== */
/*  SidebarMenuSub / SidebarMenuSubItem / SidebarMenuSubButton         */
/* ================================================================== */

function SidebarMenuSub({ className, ...props }: React.ComponentProps<'ul'>) {
  return (
    <ul
      data-slot="sidebar-menu-sub"
      data-sidebar="menu-sub"
      className={classNames(
        'mx-3.5 flex min-w-0 flex-col gap-1 border-l border-sidebar-border px-2.5 py-0.5',
        className,
      )}
      {...props}
    />
  );
}

function SidebarMenuSubItem({ className, ...props }: React.ComponentProps<'li'>) {
  return (
    <li
      data-slot="sidebar-menu-sub-item"
      data-sidebar="menu-sub-item"
      className={classNames('relative', className)}
      {...props}
    />
  );
}

function SidebarMenuSubButton({
  size = 'md',
  isActive = false,
  className,
  ...props
}: React.ComponentProps<'a'> & { size?: 'sm' | 'md'; isActive?: boolean }) {
  return (
    <a
      data-slot="sidebar-menu-sub-button"
      data-sidebar="menu-sub-button"
      data-size={size}
      data-active={isActive}
      className={classNames(
        'flex h-7 min-w-0 items-center gap-2 overflow-hidden rounded-md px-2',
        'text-sidebar-foreground ring-sidebar-ring outline-none',
        'hover:bg-sidebar-accent hover:text-sidebar-accent-foreground',
        'focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground',
        'disabled:pointer-events-none disabled:opacity-50',
        'data-[active=true]:bg-sidebar-accent data-[active=true]:text-sidebar-accent-foreground',
        size === 'md' ? 'text-sm' : 'text-xs',
        className,
      )}
      {...props}
    />
  );
}

/* ================================================================== */
/*  SidebarInput                                                       */
/* ================================================================== */

function SidebarInput({ className, ...props }: React.ComponentProps<'input'>) {
  return (
    <input
      data-slot="sidebar-input"
      data-sidebar="input"
      className={classNames(
        'h-8 w-full rounded-md border border-sidebar-border bg-amplify-elements-bg-depth-1 px-3 py-1 text-sm',
        'text-sidebar-foreground placeholder:text-sidebar-foreground/50',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-sidebar-ring',
        className,
      )}
      {...props}
    />
  );
}

/* ================================================================== */
/*  Exports                                                            */
/* ================================================================== */

export {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupAction,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInput,
  SidebarInset,
  SidebarMenu,
  SidebarMenuAction,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarMenuSkeleton,
  SidebarMenuSub,
  SidebarMenuSubButton,
  SidebarMenuSubItem,
  SidebarProvider,
  SidebarRail,
  SidebarSeparator,
  SidebarTrigger,
  useSidebar,
};
