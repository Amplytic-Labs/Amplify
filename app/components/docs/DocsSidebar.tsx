/**
 * DocsSidebar — Sticky sidebar navigation for Amplify docs.
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, Link } from '@remix-run/react';
import {
  Search,
  ChevronLeft,
  ChevronDown,
  ChevronRight,
  ExternalLink,
  Home,
  Play,
  BookOpen,
  Settings2,
  Clock,
  Puzzle,
  FileText,
  MessageCircle,
  Code2,
  Cloud,
  Folder,
  Rocket,
  TerminalSquare,
  ShieldCheck,
  Building2,
  SlidersHorizontal,
  AlertTriangle,
  Info,
  Brain,
  Eye,
  KeyRound,
  Filter,
  Gauge,
  Paperclip,
  BarChart3,
  Waves,
  ArrowLeftRight,
  Quote,
  TextCursorInput,
  FolderOpen,
  GitCompare,
  LayoutGrid,
  Link2,
  Plug2,
  GitBranch,
  Zap,
  Microchip,
  Wind,
  Mail,
} from 'lucide-react';
import type { NavLink, NavGroup, NavParent, NavTree } from './navigation';

/* ─── Props ─── */

interface DocsSidebarProps {
  navigation: NavTree;
  parent?: NavParent;
  showSidenav?: boolean;
  onCloseSidenav?: () => void;
  onOpenSearch?: () => void;
}

/* ─── Icon map ─── */

const phosphorToLucide: Record<string, React.ComponentType<{ className?: string }>> = {
  'i-ph:house-bold': Home,
  'i-ph:play-bold': Play,
  'i-ph:book-open-bold': BookOpen,
  'i-ph:gear-bold': Settings2,
  'i-ph:clock-bold': Clock,
  'i-ph:puzzle-piece-bold': Puzzle,
  'i-ph:document-bold': FileText,
  'i-ph:chat-bubble-bold': MessageCircle,
  'i-ph:code-bold': Code2,
  'i-ph:cloud-bold': Cloud,
  'i-ph:folder-bold': Folder,
  'i-ph:rocket-bold': Rocket,
  'i-ph:terminal-bold': TerminalSquare,
  'i-ph:shield-check-bold': ShieldCheck,
  'i-ph:buildings-bold': Building2,
  'i-ph:sliders-bold': SlidersHorizontal,
  'i-ph:warning-bold': AlertTriangle,
  'i-ph:info-bold': Info,
  'i-ph:brain-bold': Brain,
  'i-ph:eye-bold': Eye,
  'i-ph:key-bold': KeyRound,
  'i-ph:funnel-bold': Filter,
  'i-ph:speedometer-bold': Gauge,
  'i-ph:paperclip-bold': Paperclip,
  'i-ph:chart-bar-bold': BarChart3,
  'i-ph:wave-bold': Waves,
  'i-ph:arrows-left-right-bold': ArrowLeftRight,
  'i-ph:quotes-bold': Quote,
  'i-ph:text-cursor-bold': TextCursorInput,
  'i-ph:folder-open-bold': FolderOpen,
  'i-ph:git-diff-bold': GitCompare,
  'i-ph:api-bold': Code2,
  'i-ph:link-bold': Link2,
  'i-ph:plug-bold': Plug2,
  'i-ph:git-branch-bold': GitBranch,
  'i-ph:bolt-bold': Zap,
  'i-ph:ram-bold': Microchip,
  'i-ph:wind-bold': Wind,
  'i-ph:magnifying-glass-bold': Search,
  'i-ph:view-grid-bold': LayoutGrid,
  'i-ph:database-bold': BarChart3,
  'i-ph:wrench-bold': Settings2,
  'i-ph:map-bold': BookOpen,
  'i-ph:lock-bold': KeyRound,
  'i-ph:desktop-bold': Building2,
  'i-ph:github-logo-bold': GitBranch,
  'i-ph:gitlab-logo-bold': GitBranch,
  'i-ph:triangle-bold': Zap,
  'i-ph:squares-four-bold': LayoutGrid,
  'i-ph:sparkle-bold': Zap,
  'i-ph:atom-bold': Zap,
  'i-ph:people-bold': MessageCircle,
  'i-ph:question-bold': Info,
  'i-ph:route-bold': ArrowLeftRight,
  'i-ph:cube-bold': Building2,
  'i-ph:face-bold': Brain,
  'i-ph:fire-bold': Zap,
  'i-ph:cpu-bold': Microchip,
  'i-ph:moon-bold': Clock,
  'i-ph:chart-line-up-bold': BarChart3,
  'i-ph:zap-bold': Zap,
  'i-ph:bus-bold': Plug2,
  'i-ph:magic-bold': Zap,
  'i-ph:scissors-bold': Filter,
  'i-ph:microphone-bold': MessageCircle,
  'i-ph:arrow-counter-clockwise-bold': Home,
  'i-ph:netlify-logo-bold': Cloud,
  'i-ph:openai-logo-bold': Zap,
  'i-ph:google-logo-bold': Cloud,
  'i-ph:envelope-bold': Mail,
  'i-ph:server-bold': Building2,
};



function resolveIcon(iconName?: string): React.ComponentType<{ className?: string }> | null {
  if (!iconName) return null;
  if (phosphorToLucide[iconName]) return phosphorToLucide[iconName];
  const bare = iconName.replace(/^i-ph:/, '').replace(/-bold$/, '');
  const key = `i-ph:${bare}-bold`;
  if (phosphorToLucide[key]) return phosphorToLucide[key];
  return null;
}

/* ─── NavItemButton ─── */

function NavItemButton({ link, isSelected }: { link: NavLink; isSelected: boolean }) {
  const IconComponent = resolveIcon(link.icon);
  const isExternal = link.openInNewTab;
  const isParentLink = link.isParent;

  return (
    <Link
      to={link.href}
      target={isExternal ? '_blank' : undefined}
      rel={isExternal ? 'noopener noreferrer' : undefined}
      className={`docs-side-nav-button ${isSelected ? 'is-selected' : ''}`}
    >
      {IconComponent && <IconComponent className="docs-side-nav-icon" />}
      <span className="docs-text-caption-500">{link.label}</span>
      {link.isNew && <span className="docs-nav-new-badge">New</span>}
      {isParentLink && !isExternal && <ChevronRight className="docs-nav-chevron" size={14} />}
      {isExternal && <ExternalLink className="docs-nav-external-icon" size={12} />}
    </Link>
  );
}

/* ─── NavGroupSection ─── */

function NavGroupSection({
  group,
  currentPath,
}: {
  group: NavGroup;
  currentPath: string;
}) {
  const [collapsed, setCollapsed] = useState(group.initiallyCollapsed ?? false);
  const isCollapsible = group.collapsible ?? false;

  const hasActiveItem = group.items.some((item) => currentPath === item.href || currentPath.startsWith(item.href + '/'));

  useEffect(() => {
    if (hasActiveItem && isCollapsible) {
      setCollapsed(false);
    }
  }, [hasActiveItem, isCollapsible]);

  const toggleCollapse = useCallback(() => {
    if (isCollapsible) setCollapsed((prev) => !prev);
  }, [isCollapsible]);

  return (
    <div className="docs-side-nav-group">
      {group.label && (
        isCollapsible ? (
          <button
            type="button"
            className="docs-side-nav-header-collapsible"
            onClick={toggleCollapse}
            aria-expanded={!collapsed}
          >
            <span className="docs-text-eyebrow">{group.label}</span>
            <ChevronDown
              className="docs-collapse-chevron"
              size={14}
              style={{ transform: collapsed ? 'rotate(-90deg)' : 'rotate(0deg)' }}
            />
          </button>
        ) : (
          <span className="docs-text-eyebrow">{group.label}</span>
        )
      )}
      {!collapsed && (
        <div className="docs-side-nav-group-items" style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
          {group.items.map((item) => {
            const isSelected =
              currentPath === item.href ||
              (currentPath.startsWith(item.href + '/') && !!item.isParent);
            return <NavItemButton key={item.href} link={item} isSelected={isSelected} />;
          })}
        </div>
      )}
    </div>
  );
}

/* ─── DocsSidebar (main component) ─── */

export default function DocsSidebar({
  navigation,
  parent,
  showSidenav = true,
  onCloseSidenav,
  onOpenSearch,
}: DocsSidebarProps) {
  const location = useLocation();
  const currentPath = location.pathname;
  const sidebarRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!onCloseSidenav) return;

    function handleClickOutside(event: MouseEvent) {
      if (
        sidebarRef.current &&
        !sidebarRef.current.contains(event.target as Node)
      ) {
        onCloseSidenav?.();
      }
    }

    if (showSidenav) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => {
      document.removeEventListener('mousedown', handleClickOutside);
    };
  }, [showSidenav, onCloseSidenav]);

  useEffect(() => {
    if (!onCloseSidenav) return;

    function handleEscape(event: KeyboardEvent) {
      if (event.key === 'Escape') {
        onCloseSidenav?.();
      }
    }

    if (showSidenav) {
      document.addEventListener('keydown', handleEscape);
    }
    return () => {
      document.removeEventListener('keydown', handleEscape);
    };
  }, [showSidenav, onCloseSidenav]);

  return (
    <nav
      ref={sidebarRef}
      className="docs-side-nav"
      aria-label="Documentation navigation"
    >
      <div className="docs-side-nav-wrapper">
        {onOpenSearch && (
          <div className="docs-side-nav-search" style={{ display: 'flex', gap: '0.5rem' }}>
            <button
              type="button"
              className="docs-side-nav-button"
              onClick={onOpenSearch}
              aria-label="Search documentation"
              style={{ justifyContent: 'center' }}
            >
              <Search className="docs-side-nav-icon" size={16} />
              <span className="docs-text-caption-500" style={{ color: 'var(--docs-color-tertiary)' }}>
                Search…
              </span>
              <kbd
                className="docs-text-caption-500"
                style={{
                  marginInlineStart: 'auto',
                  padding: '0.125rem 0.375rem',
                  border: '1px solid var(--docs-color-smooth)',
                  borderRadius: '0.25rem',
                  color: 'var(--docs-color-tertiary)',
                  fontSize: 'var(--docs-font-size-micro)',
                }}
              >
                ⌘K
              </kbd>
            </button>
          </div>
        )}

        {parent && (
          <div className="docs-side-nav-wrapper-parent">
            <Link to={parent.href} className="docs-side-nav-back-icon" aria-label={`Back to ${parent.label}`}>
              <ChevronLeft size={16} />
            </Link>
            <div className="docs-side-nav-wrapper-parent-title">
              <span className="docs-text-eyebrow">{parent.label}</span>
            </div>
          </div>
        )}

        <div className="docs-side-nav-scroll">
          {navigation.map((node, index) => {
            if ('items' in node) {
              return (
                <NavGroupSection
                  key={`group-${node.label ?? index}`}
                  group={node as NavGroup}
                  currentPath={currentPath}
                />
              );
            } else {
              const link = node as NavLink;
              const isSelected =
                currentPath === link.href ||
                (currentPath.startsWith(link.href + '/') && !!link.isParent);
              return (
                <NavItemButton
                  key={link.href}
                  link={link}
                  isSelected={isSelected}
                />
              );
            }
          })}
        </div>
      </div>
    </nav>
  );
}
