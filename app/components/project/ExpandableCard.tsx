import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { ChevronDown, Globe, ImageOff, RefreshCw, MoreHorizontal } from 'lucide-react';
import { classNames } from '~/utils/classNames';
import { getFrameworkMeta } from '~/lib/utils/framework-meta';

export interface ExpandableCardProps {
  /** Project / site name (shown in the expanded detail panel header). */
  name: string;
  /** Framework label used for the badge + the fallback thumbnail tint. */
  framework?: string;
  /**
   * Screenshot data URL (PNG/JPEG). When provided, rendered as the card's
   * hero image. When absent, a branded placeholder (framework icon + gradient)
   * is shown instead.
   */
  screenshot?: string;
  /** Small badge tags shown in the expanded panel (e.g. ["Vite + React"]). */
  tags?: string[];
  /** ISO timestamp of the last screenshot capture (shown as "captured X ago"). */
  screenshotAt?: string;
  /** Click handler for the screenshot hero area (open the project, etc.). */
  onScreenshotPress?: () => void;
  /** Click handler for the whole card's select action (header row). */
  onSelect?: () => void;
  /** Whether this card is currently selected (drives ring + accent). */
  isSelected?: boolean;
  /** Kebab menu node (rename/delete actions), rendered top-right. */
  menu?: React.ReactNode;
  /** Expanded detail children (specs, version, latest deployment, etc.). */
  children?: React.ReactNode;
}

/**
 * ExpandableCard — a web port of the React Native ExpandableCard the user
 * provided. Behaviour parity:
 *   • Dashed-border rounded container.
 *   • Hero screenshot area (200px) at the top — clickable for redirection.
 *   • Framework icon badge in a dashed circle at the bottom-left of the hero.
 *   • Expand/collapse toggle (chevron) centred at the bottom.
 *   • On expand: container grows vertically + a detail panel fades in below
 *     the hero (name, tags, free-form children).
 *   • Expanding one card does NOT reflow neighbours — the list uses
 *     `layout` animations + the card's height transition is self-contained,
 *     so siblings slide smoothly instead of jumping.
 */
export function ExpandableCard({
  name,
  framework,
  screenshot,
  tags = [],
  screenshotAt,
  onScreenshotPress,
  onSelect,
  isSelected,
  menu,
  children,
}: ExpandableCardProps) {
  const [isExpanded, setIsExpanded] = useState(false);
  const meta = getFrameworkMeta(framework);
  const heroRef = useRef<HTMLButtonElement>(null);

  // Reset to collapsed when the project changes (defensive — keeps the list
  // tidy when selection switches between projects).
  useEffect(() => {
    if (!isSelected) {
      setIsExpanded(false);
    }
  }, [isSelected]);

  const toggleExpand = (e: React.MouseEvent) => {
    e.stopPropagation();
    setIsExpanded((v) => !v);
  };

  const capturedRel = screenshotAt ? timeFromNow(screenshotAt) : null;

  return (
    <motion.div
      layout
      onClick={onSelect}
      role="option"
      aria-selected={isSelected}
      aria-label={`Project: ${name}`}
      className={classNames(
        'relative rounded-2xl overflow-hidden border border-dashed transition-colors',
        isSelected
          ? 'border-blue-500/60 bg-blue-500/[0.04]'
          : 'border-sidebar-border/70 bg-sidebar/60 hover:bg-sidebar/80',
      )}
      style={{ borderWidth: 1 }}
    >
      {/* Selection accent ring */}
      {isSelected && (
        <div className="pointer-events-none absolute inset-0 ring-1 ring-blue-500/40 rounded-2xl z-20" />
      )}

      {/* Kebab menu — top-right, above the hero */}
      {menu && (
        <div className="absolute top-2 right-2 z-30" onClick={(e) => e.stopPropagation()}>
          {menu}
        </div>
      )}

      {/* Hero / screenshot area — clickable for redirection */}
      <button
        ref={heroRef}
        type="button"
        onClick={(e) => {
          e.stopPropagation();
          onScreenshotPress?.();
        }}
        className="block w-full focus:outline-none"
        style={{ height: 160 }}
        aria-label={`Open ${name}`}
      >
        <div className="relative w-full h-full overflow-hidden bg-muted/20">
          {screenshot ? (
            <img
              src={screenshot}
              alt={`${name} preview`}
              className="w-full h-full object-cover object-top"
              loading="lazy"
              onError={(e) => {
                (e.currentTarget as HTMLImageElement).style.display = 'none';
              }}
            />
          ) : (
            <div
              className={classNames(
                'w-full h-full flex flex-col items-center justify-center gap-2 bg-gradient-to-br',
                meta.gradient,
              )}
            >
              <div className={classNames(meta.icon, 'w-10 h-10 opacity-80')} />
              <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground">
                <ImageOff size={11} />
                <span>No preview yet</span>
              </div>
            </div>
          )}

          {/* Framework icon badge — dashed circle, bottom-left of hero */}
          <div
            className="absolute bottom-2.5 left-2.5 w-9 h-9 rounded-full flex items-center justify-center bg-background/80 backdrop-blur-sm border border-dashed border-border/80 shadow-sm"
            title={framework || meta.label}
          >
            <div className={classNames(meta.icon, 'w-5 h-5')} />
          </div>

          {/* "Live" / captured-ago chip — bottom-right of hero */}
          {screenshot && (
            <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-foreground/80 bg-background/80 backdrop-blur-sm border border-border/60 flex items-center gap-1">
              <Globe size={9} className="text-emerald-500" />
              {capturedRel ? `captured ${capturedRel}` : 'preview'}
            </div>
          )}

          {/* Hover hint overlay */}
          <div className="absolute inset-0 bg-black/0 hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 hover:opacity-100">
            <span className="px-2.5 py-1 rounded-md text-[11px] font-medium text-white bg-black/60 backdrop-blur-sm">
              Open project →
            </span>
          </div>
        </div>
      </button>

      {/* Header row — name + chevron toggle */}
      <div className="flex items-center gap-2 px-3 py-2">
        <div className="flex-1 min-w-0">
          <div className="text-[13px] font-semibold text-sidebar-foreground truncate">{name}</div>
          <div className="flex items-center gap-1.5 mt-0.5">
            {framework && (
              <span className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded-sm bg-input/70 text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                {framework}
              </span>
            )}
            {tags.map((t) => (
              <span
                key={t}
                className="inline-flex items-center px-1.5 py-0.5 rounded-sm bg-muted/50 text-[10px] text-muted-foreground"
              >
                {t}
              </span>
            ))}
          </div>
        </div>
        <button
          type="button"
          onClick={toggleExpand}
          className={classNames(
            'shrink-0 w-7 h-7 rounded-full flex items-center justify-center transition-colors',
            isExpanded ? 'bg-blue-500/15 text-blue-500' : 'text-muted-foreground hover:bg-muted/60',
          )}
          aria-label={isExpanded ? 'Collapse details' : 'Expand details'}
          aria-expanded={isExpanded}
        >
          <motion.span animate={{ rotate: isExpanded ? 180 : 0 }} transition={{ duration: 0.2 }}>
            <ChevronDown size={16} />
          </motion.span>
        </button>
      </div>

      {/* Expanded detail panel — height + opacity animated; neighbours slide
          via the parent list's `layout` prop so the layout is never harmed. */}
      <AnimatePresence initial={false}>
        {isExpanded && (
          <motion.div
            key="detail"
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.25, ease: [0.4, 0, 0.2, 1] }}
            className="overflow-hidden"
          >
            <div className="px-3 pb-3 pt-1">
              <div className="rounded-xl bg-muted/20 border border-border/50 p-3">{children}</div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </motion.div>
  );
}

function timeFromNow(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) return 'just now';
  if (diff < 3600) return `${Math.floor(diff / 60)}m ago`;
  if (diff < 86400) return `${Math.floor(diff / 3600)}h ago`;

  return `${Math.floor(diff / 86400)}d ago`;
}

export { RefreshCw, MoreHorizontal };
