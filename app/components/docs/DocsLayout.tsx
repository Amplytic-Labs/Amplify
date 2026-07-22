import React, { useState, useEffect, useCallback, useRef, useMemo } from 'react';
import { useLocation, useNavigate, Link } from '@remix-run/react';
import {
  Search,
  Menu,
  X,
  Github,
  Sun,
  Moon,
  Monitor,
  ChevronRight,
  ExternalLink,
  Star,
  Zap,
  House,
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
  LayoutGrid,
  Link2,
  GitBranch,
  Plug2,
  Building2,
  ShieldCheck,
  Server,
  SlidersHorizontal,
  AlertTriangle,
  Info,
  Brain,
  Mail,
  BarChart3,
  Activity,
  ArrowLeftRight,
  Paperclip,
  Quote,
  TextCursorInput,
  FolderOpen,
  Eye,
  GitCompare,
  KeyRound,
  Filter,
  Gauge,
  Cpu,
  Wind,
} from 'lucide-react';
import { classNames } from '~/utils/classNames';
import type { NavTree, NavParent, NavLink, NavGroup } from './navigation';

/* ─── Icon mapping from icon strings to Lucide components ─── */
const iconMap: Record<string, React.ComponentType<{ className?: string }>> = {
  'i-ph:house-bold': House,
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
  'i-ph:view-grid-bold': LayoutGrid,
  'i-ph:api-bold': Code2,
  'i-ph:link-bold': Link2,
  'i-ph:git-branch-bold': GitBranch,
  'i-ph:plug-bold': Plug2,
  'i-ph:buildings-bold': Building2,
  'i-ph:shield-check-bold': ShieldCheck,
  'i-ph:server-bold': Server,
  'i-ph:sliders-bold': SlidersHorizontal,
  'i-ph:warning-bold': AlertTriangle,
  'i-ph:info-bold': Info,
  'i-ph:brain-bold': Brain,
  'i-ph:envelope-bold': Mail,
  'i-ph:chart-bar-bold': BarChart3,
  'i-ph:wave-bold': Activity,
  'i-ph:arrows-left-right-bold': ArrowLeftRight,
  'i-ph:paperclip-bold': Paperclip,
  'i-ph:quotes-bold': Quote,
  'i-ph:text-cursor-bold': TextCursorInput,
  'i-ph:folder-open-bold': FolderOpen,
  'i-ph:eye-bold': Eye,
  'i-ph:git-diff-bold': GitCompare,
  'i-ph:key-bold': KeyRound,
  'i-ph:funnel-bold': Filter,
  'i-ph:speedometer-bold': Gauge,
  'i-ph:openai-logo-bold': Zap,
  'i-ph:google-logo-bold': Sun,
  'i-ph:magnifying-glass-bold': Search,
  'i-ph:bolt-bold': Zap,
  'i-ph:ram-bold': Cpu,
  'i-ph:wind-bold': Wind,
};

/* ─── Theme Types ─── */
type ThemeMode = 'light' | 'dark' | 'system';

/* ─── Grid Variant Types ─── */
type LayoutVariant = 'default' | 'two-side-navs' | 'expanded';

/* ─── Props ─── */
interface DocsLayoutProps {
  variant?: LayoutVariant;
  navigation: NavTree;
  parent?: NavParent;
  children: React.ReactNode;
  isReferences?: boolean;
}

/* ─── GitHub Stats (simplified for docs header) ─── */
interface GitHubRepoStats {
  stars: number;
  label: string;
}

/* ─── Search Result ─── */
interface SearchResult {
  title: string;
  href: string;
  excerpt?: string;
  group?: string;
}

/* ─── Helper: flatten navigation into searchable items ─── */
function flattenNavigation(nav: NavTree): SearchResult[] {
  const results: SearchResult[] = [];

  for (const item of nav) {
    if ('items' in item) {
      // NavGroup
      const group = item.label || '';
      for (const link of item.items) {
        results.push({
          title: link.label,
          href: link.href,
          group,
        });
      }
    } else {
      // NavLink
      results.push({
        title: item.label,
        href: item.href,
      });
    }
  }

  return results;
}

/* ─── Helper: resolve effective theme from system preference ─── */
function getEffectiveTheme(mode: ThemeMode): 'light' | 'dark' {
  if (mode === 'system') {
    if (typeof window !== 'undefined' && window.matchMedia) {
      return window.matchMedia('(prefers-color-scheme: dark)').matches ? 'dark' : 'light';
    }
    return 'light';
  }
  return mode;
}

/* ─── Helper: apply theme to document ─── */
function applyThemeToDocument(theme: 'light' | 'dark') {
  document.documentElement.setAttribute('data-theme', theme);
  document.documentElement.classList.remove('light', 'dark');
  document.documentElement.classList.add(theme);

  // Also update body class for broader compatibility
  document.body.classList.remove('light', 'dark');
  document.body.classList.add(theme);

  // Persist in localStorage
  localStorage.setItem('amplify_docs_theme', theme);
}

/* ─── Helper: persist theme mode (light/dark/system) ─── */
function persistThemeMode(mode: ThemeMode) {
  localStorage.setItem('amplify_docs_theme_mode', mode);
}

/* ─── Helper: read persisted theme mode ─── */
function readPersistedThemeMode(): ThemeMode {
  if (typeof window === 'undefined') return 'system';
  const stored = localStorage.getItem('amplify_docs_theme_mode');
  if (stored === 'light' || stored === 'dark' || stored === 'system') return stored;
  return 'system';
}

/* ─────────────────────────────────────────────────────────────
 * DocsLayout Component
 *
 * Main docs layout component that recreates the Appwrite docs
 * website design. Manages:
 *   - Desktop & mobile header with logo, nav, search, theme, GitHub
 *   - Sidebar navigation with collapsible groups
 *   - Content area with grid layout (3 variants)
 *   - Search modal overlay (Cmd+K / Ctrl+K)
 *   - Keyboard shortcuts (Escape to close)
 * ───────────────────────────────────────────────────────────── */
export function DocsLayout({
  variant = 'default',
  navigation,
  parent,
  children,
  isReferences = false,
}: DocsLayoutProps) {
  /* ── State ── */
  const [showSidenav, setShowSidenav] = useState(false);
  const [showSearch, setShowSearch] = useState(false);
  const [currentVariant, setCurrentVariant] = useState<LayoutVariant>(variant);
  const [themeMode, setThemeMode] = useState<ThemeMode>('system');
  const [effectiveTheme, setEffectiveTheme] = useState<'light' | 'dark'>('light');
  const [searchQuery, setSearchQuery] = useState('');
  const [githubStats, setGithubStats] = useState<GitHubRepoStats | null>(null);
  const [collapsedGroups, setCollapsedGroups] = useState<Record<string, boolean>>(() => {
    // Initialize collapsed state from navigation data
    const initial: Record<string, boolean> = {};
    for (const item of navigation) {
      if ('items' in item && item.collapsible && item.initiallyCollapsed && item.label) {
        initial[item.label] = true;
      }
    }
    return initial;
  });

  /* ── Refs ── */
  const searchInputRef = useRef<HTMLInputElement>(null);
  const searchOverlayRef = useRef<HTMLDivElement>(null);

  /* ── Remix hooks ── */
  const location = useLocation();
  const navigate = useNavigate();
  const currentPath = location.pathname;

  /* ── Searchable items ── */
  const searchItems = useMemo(() => flattenNavigation(navigation), [navigation]);

  /* ── Filtered search results ── */
  const filteredResults = useMemo(() => {
    if (!searchQuery.trim()) return searchItems;
    const q = searchQuery.toLowerCase();
    return searchItems.filter(
      (item) =>
        item.title.toLowerCase().includes(q) ||
        (item.excerpt && item.excerpt.toLowerCase().includes(q)) ||
        (item.group && item.group.toLowerCase().includes(q)),
    );
  }, [searchQuery, searchItems]);

  /* ── Initialize theme on mount ── */
  useEffect(() => {
    const persistedMode = readPersistedThemeMode();
    setThemeMode(persistedMode);
    const effective = getEffectiveTheme(persistedMode);
    setEffectiveTheme(effective);
    applyThemeToDocument(effective);
  }, []);

  /* ── Listen for system theme changes when mode is 'system' ── */
  useEffect(() => {
    if (themeMode !== 'system') return;

    const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)');
    const handler = (e: MediaQueryListEvent) => {
      const newEffective = e.matches ? 'dark' : 'light';
      setEffectiveTheme(newEffective);
      applyThemeToDocument(newEffective);
    };

    mediaQuery.addEventListener('change', handler);
    return () => mediaQuery.removeEventListener('change', handler);
  }, [themeMode]);

  /* ── Fetch GitHub stats ── */
  useEffect(() => {
    async function fetchStats() {
      try {
        const response = await fetch('/api.github-stats');
        if (response.ok) {
          const data = await response.json() as { stars?: number; publicRepos?: number };
          const stars = data.stars ?? data.publicRepos ?? 0;
          setGithubStats({
            stars,
            label: `${stars.toLocaleString()} stars`,
          });
        }
      } catch {
        // Silently ignore — stats are optional UI decoration
      }
    }

    fetchStats();
  }, []);

  /* ── Focus search input when modal opens ── */
  useEffect(() => {
    if (showSearch && searchInputRef.current) {
      searchInputRef.current.focus();
    }
  }, [showSearch]);

  /* ── Lock body scroll when sidenav is open on mobile ── */
  useEffect(() => {
    if (showSidenav) {
      document.body.style.overflow = 'hidden';
    } else {
      document.body.style.overflow = '';
    }
    return () => {
      document.body.style.overflow = '';
    };
  }, [showSidenav]);

  /* ── Lock body scroll when search modal is open ── */
  useEffect(() => {
    if (showSearch) {
      document.body.style.overflow = 'hidden';
    } else {
      if (!showSidenav) {
        document.body.style.overflow = '';
      }
    }
    return () => {
      if (!showSidenav && !showSearch) {
        document.body.style.overflow = '';
      }
    };
  }, [showSearch, showSidenav]);

  /* ── Keyboard shortcuts ── */
  const handleKeyDown = useCallback(
    (e: KeyboardEvent) => {
      // Cmd+K / Ctrl+K opens search
      if ((e.metaKey || e.ctrlKey) && e.key === 'k') {
        e.preventDefault();
        setShowSearch(true);
        setShowSidenav(false);
        return;
      }

      // Escape closes search and/or sidebar
      if (e.key === 'Escape') {
        if (showSearch) {
          e.preventDefault();
          setShowSearch(false);
          setSearchQuery('');
          return;
        }
        if (showSidenav) {
          e.preventDefault();
          setShowSidenav(false);
          return;
        }
      }
    },
    [showSearch, showSidenav],
  );

  useEffect(() => {
    document.addEventListener('keydown', handleKeyDown);
    return () => document.removeEventListener('keydown', handleKeyDown);
  }, [handleKeyDown]);

  /* ── Theme toggle handler ── */
  const handleThemeChange = useCallback(
    (mode: ThemeMode) => {
      setThemeMode(mode);
      persistThemeMode(mode);
      const effective = getEffectiveTheme(mode);
      setEffectiveTheme(effective);
      applyThemeToDocument(effective);
    },
    [],
  );

  /* ── Toggle collapsible group ── */
  const toggleGroup = useCallback((label: string) => {
    setCollapsedGroups((prev) => ({
      ...prev,
      [label]: !prev[label],
    }));
  }, []);

  /* ── Search result click handler ── */
  const handleSearchSelect = useCallback(
    (result: SearchResult) => {
      setShowSearch(false);
      setSearchQuery('');
      navigate(result.href);
    },
    [navigate],
  );

  /* ── Search overlay click (close on backdrop click) ── */
  const handleSearchOverlayClick = useCallback(
    (e: React.MouseEvent) => {
      if (e.target === searchOverlayRef.current) {
        setShowSearch(false);
        setSearchQuery('');
      }
    },
    [],
  );

  /* ── Grid class based on variant ── */
  const gridClassName = useMemo(() => {
    switch (currentVariant) {
      case 'default':
        return 'docs-grid-side-nav';
      case 'two-side-navs':
        return 'docs-grid-two-side-navs';
      case 'expanded':
        return 'docs-grid-huge-navs';
      default:
        return 'docs-grid-side-nav';
    }
  }, [currentVariant]);

  /* ── Update variant when prop changes ── */
  useEffect(() => {
    setCurrentVariant(variant);
  }, [variant]);

  /* ── Render NavIcon ── */
  const renderNavIcon = useCallback((iconStr?: string) => {
    if (!iconStr) return null;
    const IconComponent = iconMap[iconStr];
    if (!IconComponent) return null;
    return <IconComponent className="docs-side-nav-icon" />;
  }, []);

  /* ── Render navigation item ── */
  const renderNavItem = useCallback(
    (link: NavLink) => {
      const isSelected = currentPath === link.href;
      const isExternal = link.openInNewTab;
      const isParentLink = link.isParent;

      return (
        <Link
          key={link.href}
          to={link.href}
          className={classNames('docs-side-nav-button', isSelected && 'is-selected')}
          target={isExternal ? '_blank' : undefined}
          rel={isExternal ? 'noopener noreferrer' : undefined}
          onClick={() => setShowSidenav(false)}
        >
          {renderNavIcon(link.icon)}
          <span className="docs-text-sub-body-500" style={{ flex: 1 }}>
            {link.label}
          </span>
          {link.isNew && <span className="docs-nav-new-badge">New</span>}
          {isParentLink && !isSelected && (
            <ChevronRight className="docs-nav-chevron" width={12} height={12} />
          )}
          {isExternal && <ExternalLink className="docs-nav-external-icon" />}
        </Link>
      );
    },
    [currentPath, renderNavIcon],
  );

  /* ── Render navigation group ── */
  const renderNavGroup = useCallback(
    (group: NavGroup) => {
      const isCollapsible = group.collapsible;
      const isCollapsed = collapsedGroups[group.label || ''] ?? false;
      const label = group.label;

      return (
        <div key={label || group.items[0]?.href} className="docs-side-nav-group">
          {label && (
            <div
              className={classNames(
                'docs-text-eyebrow',
                isCollapsible && 'docs-side-nav-header-collapsible',
              )}
              onClick={isCollapsible ? () => toggleGroup(label) : undefined}
              role={isCollapsible ? 'button' : undefined}
              tabIndex={isCollapsible ? 0 : undefined}
              onKeyDown={
                isCollapsible
                  ? (e) => {
                      if (e.key === 'Enter' || e.key === ' ') {
                        e.preventDefault();
                        toggleGroup(label);
                      }
                    }
                  : undefined
              }
            >
              <span>{label}</span>
              {isCollapsible && (
                <ChevronRight
                  className="docs-collapse-chevron"
                  width={12}
                  height={12}
                  style={{
                    transform: isCollapsed ? 'rotate(0deg)' : 'rotate(90deg)',
                  }}
                />
              )}
            </div>
          )}
          {(!isCollapsible || !isCollapsed) && (
            <div className="docs-side-nav-group-items" style={{ display: 'flex', flexDirection: 'column', gap: '0.125rem' }}>
              {group.items.map(renderNavItem)}
            </div>
          )}
        </div>
      );
    },
    [collapsedGroups, toggleGroup, renderNavItem],
  );

  /* ── Render navigation section ── */
  const renderNavigation = useCallback(() => {
    return (
      <nav className="docs-side-nav-scroll" aria-label="Documentation navigation">
        {/* Parent back-link */}
        {parent && (
          <div className="docs-side-nav-wrapper-parent">
            <Link
              to={parent.href}
              className="docs-side-nav-button"
              onClick={() => setShowSidenav(false)}
              style={{ width: '100%', justifyContent: 'center' }}
            >
              <ChevronRight
                className="docs-side-nav-back-icon"
                width={16}
                height={16}
                style={{ transform: 'rotate(180deg)' }}
              />
              <span className="docs-side-nav-wrapper-parent-title docs-text-sub-body-500">
                {parent.label}
              </span>
            </Link>
          </div>
        )}

        {/* Navigation tree */}
        {navigation.map((item) => {
          if ('items' in item) {
            return renderNavGroup(item);
          }
          return renderNavItem(item);
        })}
      </nav>
    );
  }, [navigation, parent, renderNavGroup, renderNavItem]);

  /* ──────────────────────────────────────────────────────────
   * RENDER
   * ────────────────────────────────────────────────────────── */

  return (
    <div className={classNames('docs-root docs-page', showSidenav && 'is-nav-open')}>
      {/* ── Search Modal Overlay ── */}
      {showSearch && (
        <>
          <div
            className="docs-search-overlay"
            ref={searchOverlayRef}
            onClick={handleSearchOverlayClick}
            aria-hidden="true"
          />
          <div className="docs-search-modal" role="dialog" aria-modal="true" aria-label="Search documentation">
            <div className="docs-search-modal-input">
              <Search width={20} height={20} style={{ color: 'var(--docs-color-tertiary)' }} />
              <input
                ref={searchInputRef}
                type="text"
                placeholder="Search documentation..."
                value={searchQuery}
                onChange={(e) => setSearchQuery(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Escape') {
                    setShowSearch(false);
                    setSearchQuery('');
                  }
                  if (e.key === 'Enter' && filteredResults.length > 0) {
                    handleSearchSelect(filteredResults[0]);
                  }
                }}
                aria-label="Search documentation"
              />
              <button
                onClick={() => {
                  setShowSearch(false);
                  setSearchQuery('');
                }}
                style={{
                  display: 'flex',
                  alignItems: 'center',
                  justifyContent: 'center',
                  padding: '0.375rem',
                  borderRadius: '0.375rem',
                  color: 'var(--docs-color-tertiary)',
                  cursor: 'pointer',
                  background: 'none',
                  border: 'none',
                }}
                aria-label="Close search"
              >
                <X width={16} height={16} />
              </button>
            </div>
            <div className="docs-search-results">
              {filteredResults.length === 0 && searchQuery.trim() && (
                <div
                  style={{
                    padding: '1.5rem',
                    textAlign: 'center',
                    color: 'var(--docs-color-tertiary)',
                    fontSize: 'var(--docs-font-size-tiny)',
                  }}
                >
                  No results found for &ldquo;{searchQuery}&rdquo;
                </div>
              )}
              {filteredResults.map((result) => (
                <Link
                  key={result.href}
                  to={result.href}
                  className="docs-search-result-item"
                  onClick={() => handleSearchSelect(result)}
                >
                  <Search width={14} height={14} style={{ color: 'var(--docs-color-tertiary)' }} />
                  <div style={{ flex: 1 }}>
                    <div className="docs-search-result-title">{result.title}</div>
                    {result.group && (
                      <div className="docs-search-result-excerpt">{result.group}</div>
                    )}
                  </div>
                  <ChevronRight width={14} height={14} style={{ color: 'var(--docs-color-tertiary)' }} />
                </Link>
              ))}
              {!searchQuery.trim() && (
                <div
                  style={{
                    padding: '1rem',
                    textAlign: 'center',
                    color: 'var(--docs-color-tertiary)',
                    fontSize: 'var(--docs-font-size-tiny)',
                  }}
                >
                  Type to search documentation
                </div>
              )}
            </div>
            <div
              style={{
                display: 'flex',
                alignItems: 'center',
                justifyContent: 'center',
                gap: '0.75rem',
                padding: '0.75rem',
                borderTop: '1px solid var(--docs-color-border)',
                color: 'var(--docs-color-tertiary)',
                fontSize: 'var(--docs-font-size-micro)',
              }}
            >
              <span>
                <span className="docs-kbd">Enter</span> to select
              </span>
              <span>
                <span className="docs-kbd">Esc</span> to close
              </span>
            </div>
          </div>
        </>
      )}

      {/* ── Mobile Header ── */}
      <header className="docs-mobile-header">
        <Link to="/docs" className="docs-logo" aria-label="Amplify Docs Home">
          {/* Light-mode logo */}
          <img
            src="/Amplify-light.svg"
            alt="Amplify"
            className="docs-u-only-light"
            style={{ height: '1.75rem', width: 'auto' }}
          />
          {/* Dark-mode logo */}
          <img
            src="/Amplify-dark.svg"
            alt="Amplify"
            className="docs-u-only-dark"
            style={{ height: '1.75rem', width: 'auto' }}
          />
        </Link>

        <div style={{ display: 'flex', alignItems: 'center', gap: '0.5rem' }}>
          {/* Mobile search trigger */}
          <button
            className="docs-hamburger-btn"
            onClick={() => setShowSearch(true)}
            aria-label="Open search"
          >
            <Search width={18} height={18} />
          </button>

          {/* Theme toggle (compact) */}
          <button
            className="docs-hamburger-btn"
            onClick={() => {
              const next = effectiveTheme === 'dark' ? 'light' : 'dark';
              handleThemeChange(next);
            }}
            aria-label={`Switch to ${effectiveTheme === 'dark' ? 'light' : 'dark'} theme`}
          >
            {effectiveTheme === 'dark' ? <Sun width={18} height={18} /> : <Moon width={18} height={18} />}
          </button>

          {/* Hamburger toggle */}
          <button
            className="docs-hamburger-btn"
            onClick={() => setShowSidenav(!showSidenav)}
            aria-label={showSidenav ? 'Close navigation' : 'Open navigation'}
            aria-expanded={showSidenav}
          >
            {showSidenav ? <X width={18} height={18} /> : <Menu width={18} height={18} />}
          </button>
        </div>
      </header>

      {/* ── Desktop Header ── */}
      <header className="docs-main-header is-transparent">
        <div className="docs-main-header-wrapper">
          {/* Header Start: Logo + Nav + Search */}
          <div className="docs-main-header-start">
            {/* Logo */}
            <Link to="/docs" className="docs-logo" aria-label="Amplify Docs Home">
              {/* Light-mode logo */}
              <img
                src="/Amplify-light.svg"
                alt="Amplify"
                className="docs-u-only-light"
                style={{ height: '1.75rem', width: 'auto' }}
              />
              {/* Dark-mode logo */}
              <img
                src="/Amplify-dark.svg"
                alt="Amplify"
                className="docs-u-only-dark"
                style={{ height: '1.75rem', width: 'auto' }}
              />
              <span className="docs-logo-text">Amplify</span>
            </Link>

            {/* Nav links */}
            <nav className="docs-header-nav" aria-label="Main navigation">
              <Link to="/docs" className="docs-header-nav-link">
                Docs
              </Link>
            </nav>

            {/* Search input button */}
            <button
              className="docs-search-input"
              onClick={() => setShowSearch(true)}
              aria-label="Search documentation"
              type="button"
            >
              <Search className="docs-search-icon" width={16} height={16} />
              <span style={{ flex: 1 }}>Search docs...</span>
              <span className="docs-kbd" style={{ marginLeft: 'auto' }}>
                {typeof navigator !== 'undefined' && /Mac|iPod|iPhone|iPad/.test(navigator.userAgent)
                  ? '⌘K'
                  : 'Ctrl+K'}
              </span>
            </button>
          </div>

          {/* Header End: GitHub stats + Theme toggle */}
          <div className="docs-main-header-end">
            {/* GitHub stats link */}
            <a
              href="https://github.com/samvimeri/amplify-ai"
              target="_blank"
              rel="noopener noreferrer"
              className="docs-inline-tag"
              aria-label="View Amplify on GitHub"
            >
              <Github width={14} height={14} />
              {githubStats ? (
                <>
                  <Star width={12} height={12} style={{ color: 'var(--docs-color-accent)' }} />
                  {githubStats.label}
                </>
              ) : (
                'GitHub'
              )}
            </a>

            {/* Theme toggle selector */}
            <div className="docs-theme-select" role="radiogroup" aria-label="Theme selection">
              <button
                className={classNames('docs-theme-option', themeMode === 'light' && 'is-active')}
                onClick={() => handleThemeChange('light')}
                aria-label="Light theme"
                role="radio"
                aria-checked={themeMode === 'light'}
                type="button"
              >
                <Sun width={16} height={16} />
              </button>
              <button
                className={classNames('docs-theme-option', themeMode === 'dark' && 'is-active')}
                onClick={() => handleThemeChange('dark')}
                aria-label="Dark theme"
                role="radio"
                aria-checked={themeMode === 'dark'}
                type="button"
              >
                <Moon width={16} height={16} />
              </button>
              <button
                className={classNames('docs-theme-option', themeMode === 'system' && 'is-active')}
                onClick={() => handleThemeChange('system')}
                aria-label="System theme"
                role="radio"
                aria-checked={themeMode === 'system'}
                type="button"
              >
                <Monitor width={16} height={16} />
              </button>
            </div>
          </div>
        </div>
      </header>

      {/* ── Grid Container: Sidebar + Content ── */}
      <div className={classNames(gridClassName, showSidenav && 'is-open')}>
        {/* ── Side Navigation ── */}
        <aside className="docs-side-nav" aria-label="Sidebar navigation">
          <div className="docs-side-nav-wrapper">
            {renderNavigation()}
          </div>
        </aside>

        {/* ── Main Content Section ── */}
        <main className="docs-main-section" id="docs-main-content" role="main">
          {children}
        </main>
      </div>
    </div>
  );
}

export default DocsLayout;
