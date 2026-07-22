/**
 * TableOfContents — "On This Page" right sidebar component.
 * Replicates Appwrite's TOC exactly for the Amplify docs site.
 *
 * Features:
 *   - Renders heading "On This Page" in docs-toc-heading style (uppercase eyebrow)
 *   - Indented links for h3 (docs-toc-link-level-3) and h4 (docs-toc-link-level-4)
 *   - Highlights active section via Intersection Observer
 *   - Clickable links that scroll to the corresponding section
 *   - Uses useLocation from @remix-run/react to reset on route change
 */

import { useState, useEffect, useRef, useCallback } from 'react';
import { useLocation, Link } from '@remix-run/react';

/* ── Types ── */

export type TocItem = {
  title: string;
  /** href should be an anchor ID like "#section-name" */
  href: string;
  /** Heading level: 2 (h2), 3 (h3), or 4 (h4) */
  level: number;
};

export type TableOfContentsProps = {
  /** Heading text displayed above the TOC list */
  heading?: string;
  /** List of TOC entries to render */
  items: Array<TocItem>;
};

/* ── Component ── */

export function TableOfContents({
  heading = 'On This Page',
  items,
}: TableOfContentsProps) {
  const [activeId, setActiveId] = useState<string | null>(null);
  const observerRef = useRef<IntersectionObserver | null>(null);
  const location = useLocation();

  /* ── Intersection Observer: track which heading is in viewport ── */
  const setupObserver = useCallback(() => {
    // Disconnect any existing observer
    if (observerRef.current) {
      observerRef.current.disconnect();
    }

    // Collect all heading elements that correspond to TOC items
    const headingElements = items
      .map((item) => {
        // Strip the leading "#" from href to find the DOM element
        const id = item.href.replace(/^#/, '');
        return document.getElementById(id);
      })
      .filter((el): el is HTMLElement => el !== null);

    if (headingElements.length === 0) return;

    // Track which headings are currently visible
    const visibleIds = new Set<string>();

    observerRef.current = new IntersectionObserver(
      (entries) => {
        for (const entry of entries) {
          const id = entry.target.id;
          if (entry.isIntersecting) {
            visibleIds.add(id);
          } else {
            visibleIds.delete(id);
          }
        }

        // The "active" heading is the first one in document order
        // that is currently visible in the viewport.
        if (visibleIds.size > 0) {
          // Sort by DOM position to pick the topmost visible heading
          const sortedVisible = headingElements
            .filter((el) => visibleIds.has(el.id))
            .sort((a, b) => {
              // Compare document position
              const comparison = a.compareDocumentPosition(b);
              if (comparison & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
              if (comparison & Node.DOCUMENT_POSITION_PRECEDING) return 1;
              return 0;
            });
          setActiveId(sortedVisible[0].id);
        }
      },
      {
        // Observe slightly above the viewport top so we detect
        // headings as they scroll near the top (matching Appwrite behavior)
        rootMargin: '-80px 0px -70% 0px',
        threshold: 0,
      }
    );

    for (const el of headingElements) {
      observerRef.current.observe(el);
    }
  }, [items]);

  /* ── Re-initialize observer on route change ── */
  useEffect(() => {
    // Reset active ID when navigating to a new page
    setActiveId(null);

    // Small delay to allow new page content to render
    const timer = setTimeout(() => {
      setupObserver();
    }, 100);

    return () => {
      clearTimeout(timer);
      if (observerRef.current) {
        observerRef.current.disconnect();
        observerRef.current = null;
      }
    };
  }, [location.pathname, location.search, setupObserver]);

  /* ── Click handler: scroll to section ── */
  const handleItemClick = useCallback(
    (e: React.MouseEvent<HTMLAnchorElement>, href: string) => {
      e.preventDefault();
      const id = href.replace(/^#/, '');
      const element = document.getElementById(id);
      if (element) {
        element.scrollIntoView({ behavior: 'smooth', block: 'start' });
        // Update active ID immediately for responsive UX
        setActiveId(id);
        // Also push the hash to the URL bar for shareability
        window.history.pushState(null, '', href);
      }
    },
    []
  );

  /* ── Determine level-specific CSS class ── */
  const getLevelClass = (level: number): string => {
    if (level === 3) return 'docs-toc-link-level-3';
    if (level === 4) return 'docs-toc-link-level-4';
    return ''; // level 2 has no extra indentation
  };

  if (items.length === 0) return null;

  return (
    <nav aria-label={heading}>
      <div className="docs-toc-heading">{heading}</div>
      <ul
        role="list"
        style={{
          listStyle: 'none',
          margin: 0,
          padding: 0,
          display: 'flex',
          flexDirection: 'column',
          gap: '0.125rem',
        }}
      >
        {items.map((item) => {
          const id = item.href.replace(/^#/, '');
          const isActive = activeId === id;

          return (
            <li key={item.href}>
              <Link
                to={item.href}
                onClick={(e) => handleItemClick(e, item.href)}
                className={[
                  'docs-toc-link',
                  getLevelClass(item.level),
                  isActive ? 'is-active' : '',
                ]
                  .filter(Boolean)
                  .join(' ')}
                aria-current={isActive ? 'true' : undefined}
              >
                {item.title}
              </Link>
            </li>
          );
        })}
      </ul>
    </nav>
  );
}

export default TableOfContents;
