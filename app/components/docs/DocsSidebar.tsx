'use client';

import { useState, useCallback } from 'react';
import { useLocation } from '@remix-run/react';
import { Collapsible, CollapsibleTrigger, CollapsibleContent } from '~/components/ui/Collapsible';
import { ScrollArea } from '~/components/ui/ScrollArea';
import { classNames } from '~/utils/classNames';
import { source } from '~/lib/docs/source';
import { useDocsSidebar } from '~/components/docs/DocsSidebarContext';
import type { PageTree } from 'fumadocs-core/server';

// ---------------------------------------------------------------------------
// Section icon mapping — Phosphor icons for each docs section
// ---------------------------------------------------------------------------

const SECTION_ICONS: Record<string, string> = {
  'Getting Started': 'i-ph:rocket-bold',
  Architecture: 'i-ph:building-bold',
  Features: 'i-ph:sparkle-bold',
  Providers: 'i-ph:cloud-bold',
  Integrations: 'i-ph:puzzle-piece-bold',
  Advanced: 'i-ph:shield-star-bold',
  'Self-Hosting': 'i-ph:cloud-arrow-up-bold',
  Migration: 'i-ph:arrows-left-right-bold',
  Extending: 'i-ph:plus-circle-bold',
  Contributing: 'i-ph:heart-bold',
};

// ---------------------------------------------------------------------------
// Tree node renderer
// ---------------------------------------------------------------------------

interface TreeNodeProps {
  node: PageTree.Folder | PageTree.Item;
  currentUrl: string;
  depth: number;
}

function TreeNode({ node, currentUrl, depth }: TreeNodeProps) {
  if (node.type === 'page') {
    const isActive = node.url === currentUrl;
    return (
      <a
        href={node.url}
        className={classNames(
          'flex items-center gap-2 px-3 py-1.5 rounded-md text-sm transition-theme',
          'hover:bg-amplify-elements-item-backgroundActive',
          isActive
            ? 'bg-amplify-elements-item-backgroundActive text-amplify-elements-item-contentActive font-medium'
            : 'text-amplify-elements-item-contentDefault',
          depth > 0 ? 'ml-4' : '',
        )}
      >
        <span className={classNames(isActive ? 'font-medium' : '')}>{node.name}</span>
      </a>
    );
  }

  // folder
  const folder = node as PageTree.Folder;
  const iconClass = SECTION_ICONS[folder.name] || 'i-ph:folder-bold';
  const hasActiveChild = folder.children?.some(
    (child) => child.type === 'page' && child.url === currentUrl,
  );
  const defaultOpen = folder.defaultOpen ?? hasActiveChild ?? false;
  const [open, setOpen] = useState(defaultOpen);

  return (
    <Collapsible open={open} onOpenChange={setOpen}>
      <CollapsibleTrigger
        className={classNames(
          'flex items-center gap-2 w-full px-3 py-2 rounded-md text-sm font-medium transition-theme',
          'hover:bg-amplify-elements-item-backgroundActive',
          'text-amplify-elements-textPrimary',
          depth > 0 ? 'ml-2' : '',
        )}
      >
        <span className={classNames(iconClass, 'h-4 w-4 shrink-0')} />
        <span className="flex-1 truncate">{folder.name}</span>
        <span
          className={classNames(
            'i-ph:caret-down-bold h-4 w-4 shrink-0 transition-transform duration-200',
            open ? 'rotate-0' : '-rotate-90',
          )}
        />
      </CollapsibleTrigger>
      <CollapsibleContent className="mt-1 space-y-0.5">
        {folder.children?.map((child) => (
          <TreeNode key={child.name} node={child} currentUrl={currentUrl} depth={depth + 1} />
        ))}
      </CollapsibleContent>
    </Collapsible>
  );
}

// ---------------------------------------------------------------------------
// Sidebar navigation tree — shared between desktop and mobile
// ---------------------------------------------------------------------------

function SidebarTree({ currentUrl }: { currentUrl: string }) {
  const tree = source.getPageTree();

  return (
    <div className="p-4 space-y-1">
      {tree.children.map((child) => (
        <TreeNode
          key={child.name}
          node={child as PageTree.Folder | PageTree.Item}
          currentUrl={currentUrl}
          depth={0}
        />
      ))}
    </div>
  );
}

// ---------------------------------------------------------------------------
// DocsSidebar component
// ---------------------------------------------------------------------------

interface DocsSidebarProps {
  className?: string;
}

export default function DocsSidebar({ className }: DocsSidebarProps) {
  const location = useLocation();
  const currentUrl = location.pathname;
  const { mobileOpen, setMobileOpen } = useDocsSidebar();

  const closeMobile = useCallback(() => setMobileOpen(false), [setMobileOpen]);

  return (
    <>
      {/* ── Desktop sidebar ────────────────────────────────────────────── */}
      <aside
        className={classNames(
          'hidden lg:flex flex-col w-[280px] shrink-0',
          'border-r border-amplify-elements-borderColor',
          'bg-amplify-elements-bg-depth-1',
          className,
        )}
      >
        <ScrollArea className="flex-1 h-[calc(100vh - var(--header-height, 48px))]">
          <SidebarTree currentUrl={currentUrl} />
        </ScrollArea>
      </aside>

      {/* ── Mobile overlay ─────────────────────────────────────────────── */}
      {mobileOpen && (
        <>
          {/* Backdrop */}
          <div
            className="fixed inset-0 z-40 bg-black/50 lg:hidden"
            onClick={closeMobile}
            aria-hidden="true"
          />

          {/* Sidebar panel */}
          <aside
            className={classNames(
              'fixed inset-y-0 left-0 z-50 w-[280px]',
              'bg-amplify-elements-bg-depth-1',
              'border-r border-amplify-elements-borderColor',
              'shadow-lg lg:hidden',
            )}
          >
            {/* Close button + title */}
            <div className="flex items-center justify-between px-4 py-3 border-b border-amplify-elements-borderColor">
              <span
                className="text-sm font-semibold text-amplify-elements-textPrimary"
                style={{ fontFamily: "'Almarai', sans-serif" }}
              >
                Amplify Docs
              </span>
              <button
                onClick={closeMobile}
                className={classNames(
                  'flex items-center justify-center h-8 w-8 rounded-md',
                  'hover:bg-amplify-elements-item-backgroundActive',
                  'text-amplify-elements-textSecondary transition-theme',
                )}
                aria-label="Close sidebar"
              >
                <span className="i-ph:x-bold h-5 w-5" />
              </button>
            </div>

            <ScrollArea className="flex-1 h-[calc(100vh - 52px)]">
              <SidebarTree currentUrl={currentUrl} />
            </ScrollArea>
          </aside>
        </>
      )}
    </>
  );
}
