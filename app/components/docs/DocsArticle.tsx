/**
 * DocsArticle — Main article content layout component.
 * Replicates Appwrite's DocsArticle.svelte exactly for the Amplify docs site.
 *
 * Layout structure:
 *   ┌──────────────────────────────────────────────────────────────────────┐
 *   │ docs-article-header                                                  │
 *   │   docs-article-header-start          docs-article-header-end         │
 *   │   [back link?] [title]               [copy-as-markdown button]       │
 *   └──────────────────────────────────────────────────────────────────────┘
 *   │ docs-article-content (docs-prose)                                    │
 *   │   {children}                                                         │
 *   │                                                                      │
 *   │   docs-feedback                                                      │
 *   │   "Was this helpful?" [👍] [👎]                                      │
 *   └──────────────────────────────────────────────────────────────────────┘
 *   │ docs-references-menu (right TOC sidebar)                             │
 *   │   docs-references-menu-content                                       │
 *   │     <TableOfContents />                                              │
 *   └──────────────────────────────────────────────────────────────────────┘
 */

import { useState, useCallback } from 'react';
import { Link } from '@remix-run/react';
import { ChevronLeft, Copy, ThumbsUp, ThumbsDown } from 'lucide-react';
import { TableOfContents } from './TableOfContents';

/* ── Types ── */

export type TocItem = {
  title: string;
  href: string;
  level: number;
};

export type DocsArticleProps = {
  /** Article title rendered in docs-text-title style */
  title: string;
  /** Optional table-of-contents items shown in the right sidebar */
  toc?: Array<TocItem>;
  /** Optional back-button link href (renders a ChevronLeft + "Back" link) */
  back?: string;
  /** Optional metadata line rendered below the title */
  metadata?: string;
  /** Article body content — wrapped in docs-prose */
  children: React.ReactNode;
};

/* ── Component ── */

export function DocsArticle({
  title,
  toc,
  back,
  metadata,
  children,
}: DocsArticleProps) {
  /* ── Copy-as-markdown state ── */
  const [copied, setCopied] = useState(false);

  const handleCopyAsMarkdown = useCallback(() => {
    // Build a simple markdown representation of the article content.
    // In a production app this would parse the DOM or use a richer source,
    // but for the component we copy the title + a placeholder body.
    const markdown = `# ${title}\n\n${metadata ? `${metadata}\n\n` : ''}`;
    navigator.clipboard.writeText(markdown).then(() => {
      setCopied(true);
      setTimeout(() => setCopied(false), 2000);
    });
  }, [title, metadata]);

  /* ── Feedback state ── */
  const [feedback, setFeedback] = useState<'positive' | 'negative' | null>(null);

  const handlePositiveFeedback = useCallback(() => {
    setFeedback('positive');
  }, []);

  const handleNegativeFeedback = useCallback(() => {
    setFeedback('negative');
  }, []);

  return (
    <>
      {/* ── Article Header ── */}
      <header className="docs-article-header">
        <div className="docs-article-header-start">
          {back && (
            <Link
              to={back}
              className="docs-text-sub-body-500"
              style={{
                display: 'inline-flex',
                alignItems: 'center',
                gap: '0.5rem',
                color: 'var(--docs-color-accent)',
                textDecoration: 'none',
                fontWeight: 'var(--docs-font-weight-medium)',
                transition: 'var(--docs-transition)',
              }}
            >
              <ChevronLeft size={16} />
              Back
            </Link>
          )}
          <div>
            <h1 className="docs-text-title">{title}</h1>
            {metadata && (
              <p className="docs-text-description" style={{ marginTop: '0.5rem' }}>
                {metadata}
              </p>
            )}
          </div>
        </div>

        <div className="docs-article-header-end">
          <button
            type="button"
            onClick={handleCopyAsMarkdown}
            className="docs-feedback-btn"
            title="Copy as Markdown"
            aria-label="Copy article as Markdown"
            style={{ display: 'inline-flex', alignItems: 'center', gap: '0.375rem' }}
          >
            <Copy size={14} />
            {copied ? 'Copied!' : 'Copy'}
          </button>
        </div>
      </header>

      {/* ── Article Content ── */}
      <div className="docs-article-content">
        <div className="docs-prose">{children}</div>

        {/* ── Feedback Section ── */}
        <div className="docs-feedback">
          <span className="docs-feedback-text">Was this helpful?</span>
          <button
            type="button"
            className={`docs-feedback-btn ${feedback === 'positive' ? 'is-positive' : ''}`}
            onClick={handlePositiveFeedback}
            aria-label="Positive feedback — this page was helpful"
            disabled={feedback !== null}
            style={{
              opacity: feedback !== null && feedback !== 'positive' ? 0.5 : 1,
              ...(feedback === 'positive'
                ? { borderColor: 'hsl(145, 50%, 50%)', color: 'hsl(145, 50%, 50%)' }
                : {}),
            }}
          >
            <ThumbsUp size={16} />
          </button>
          <button
            type="button"
            className={`docs-feedback-btn ${feedback === 'negative' ? 'is-negative' : ''}`}
            onClick={handleNegativeFeedback}
            aria-label="Negative feedback — this page was not helpful"
            disabled={feedback !== null}
            style={{
              opacity: feedback !== null && feedback !== 'negative' ? 0.5 : 1,
              ...(feedback === 'negative'
                ? { borderColor: 'var(--docs-color-red-500)', color: 'var(--docs-color-red-500)' }
                : {}),
            }}
          >
            <ThumbsDown size={16} />
          </button>
        </div>
      </div>

      {/* ── Right-side TOC Sidebar ── */}
      {toc && toc.length > 0 && (
        <aside className="docs-references-menu">
          <div className="docs-references-menu-content">
            <TableOfContents items={toc} />
          </div>
        </aside>
      )}
    </>
  );
}

export default DocsArticle;
