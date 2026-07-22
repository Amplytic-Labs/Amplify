'use client';

import { useDocsSidebar } from '~/components/docs/DocsSidebarContext';
import { classNames } from '~/utils/classNames';

// ---------------------------------------------------------------------------
// DocsHeader — sticky header for the documentation section
// ---------------------------------------------------------------------------

interface DocsHeaderProps {
  className?: string;
}

export default function DocsHeader({ className }: DocsHeaderProps) {
  const { setMobileOpen } = useDocsSidebar();

  return (
    <header
      className={classNames(
        'sticky top-0 z-30',
        'h-[var(--header-height, 48px)]',
        'flex items-center justify-between px-4 lg:px-6',
        'border-b border-amplify-elements-borderColor',
        'bg-amplify-elements-bg-depth-1',
        className,
      )}
    >
      {/* Left: Logo / Title + Mobile toggle */}
      <div className="flex items-center gap-3">
        {/* Mobile sidebar toggle */}
        <button
          onClick={() => setMobileOpen(true)}
          className={classNames(
            'lg:hidden flex items-center justify-center',
            'h-8 w-8 rounded-md',
            'hover:bg-amplify-elements-item-backgroundActive',
            'text-amplify-elements-textSecondary transition-theme',
          )}
          aria-label="Open sidebar navigation"
        >
          <span className="i-ph:list-bold h-5 w-5" />
        </button>

        {/* Logo + Title */}
        <a
          href="/docs"
          className={classNames(
            'flex items-center gap-2',
            'hover:opacity-80 transition-opacity',
          )}
        >
          {/* Logo icon */}
          <span className="i-ph:book-open-bold h-5 w-5 text-amplify-elements-focus shrink-0" />
          <span
            className="text-lg font-semibold text-amplify-elements-textPrimary"
            style={{ fontFamily: "'Almarai', sans-serif" }}
          >
            Amplify Docs
          </span>
        </a>
      </div>

      {/* Right: GitHub link */}
      <div className="flex items-center gap-2">
        <a
          href="https://github.com/imtia33/Open_Claude"
          target="_blank"
          rel="noopener noreferrer"
          className={classNames(
            'flex items-center gap-2',
            'px-3 py-1.5 rounded-md text-sm',
            'text-amplify-elements-textSecondary',
            'hover:bg-amplify-elements-item-backgroundActive',
            'hover:text-amplify-elements-textPrimary',
            'transition-theme',
          )}
        >
          <span className="i-ph:github-logo-bold h-4 w-4" />
          <span className="hidden sm:inline">GitHub</span>
        </a>
      </div>
    </header>
  );
}
