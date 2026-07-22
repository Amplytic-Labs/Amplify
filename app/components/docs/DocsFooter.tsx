'use client';

import { useLocation } from '@remix-run/react';
import { classNames } from '~/utils/classNames';
import { source } from '~/lib/docs/source';
import type { DocsPageMeta } from '~/lib/docs/source';

// ---------------------------------------------------------------------------
// DocsFooter — prev/next page navigation at the bottom of docs pages
// ---------------------------------------------------------------------------

interface DocsFooterProps {
  className?: string;
}

interface NavLinkProps {
  page: DocsPageMeta;
  direction: 'previous' | 'next';
}

function NavLink({ page, direction }: NavLinkProps) {
  const isPrev = direction === 'previous';

  return (
    <a
      href={page.url}
      className={classNames(
        'flex items-center gap-3 group',
        'px-4 py-3 rounded-lg',
        'border border-amplify-elements-borderColor',
        'hover:border-amplify-elements-borderColorActive',
        'bg-amplify-elements-bg-depth-1',
        'hover:bg-amplify-elements-item-backgroundActive',
        'transition-theme',
        isPrev ? 'flex-row' : 'flex-row-reverse',
      )}
    >
      {/* Arrow icon */}
      <span
        className={classNames(
          'h-5 w-5 shrink-0',
          'text-amplify-elements-textSecondary group-hover:text-amplify-elements-focus',
          'transition-theme',
          isPrev ? 'i-ph:caret-left-bold' : 'i-ph:caret-right-bold',
        )}
      />

      {/* Label + Title */}
      <div
        className={classNames(
          'flex flex-col gap-0.5 min-w-0',
          isPrev ? 'text-left' : 'text-right',
        )}
      >
        <span className="text-xs text-amplify-elements-textSecondary uppercase tracking-wider">
          {isPrev ? 'Previous' : 'Next'}
        </span>
        <span
          className="text-sm font-medium text-amplify-elements-textPrimary truncate group-hover:text-amplify-elements-item-contentActive transition-theme"
        >
          {page.title}
        </span>
      </div>
    </a>
  );
}

export default function DocsFooter({ className }: DocsFooterProps) {
  const location = useLocation();
  const currentUrl = location.pathname;

  const neighbours = source.findNeighbours(currentUrl);
  const { previous, next } = neighbours;

  // Don't render if there's no prev/next navigation
  if (!previous && !next) {
    return null;
  }

  return (
    <footer
      className={classNames(
        'mt-12 pt-8 pb-4',
        'border-t border-amplify-elements-borderColor',
        className,
      )}
    >
      <div className="flex items-stretch gap-4">
        {previous && <NavLink page={previous} direction="previous" />}
        {next && <NavLink page={next} direction="next" />}
      </div>
    </footer>
  );
}
