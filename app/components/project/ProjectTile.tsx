import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Globe, ImageOff, MoreHorizontal, Pencil, Trash2, ChevronDown } from 'lucide-react';
import { classNames } from '~/utils/classNames';
import { getFrameworkMeta } from '~/lib/utils/framework-meta';
import type { Project } from '~/lib/persistence/project-store';
import { useProjectScreenshot } from '~/lib/hooks/useProjectScreenshot';
import { db } from '~/lib/persistence/useChatHistory';
import { getProjectCommit, getProjectFiles } from '~/lib/persistence/project-files';

export interface ProjectTileProps {
  project: Project;
  isSelected: boolean;
  onSelect: (project: Project) => void;
  onRenameProject: (project: Project) => void;
  onDeleteProject: (project: Project) => void;
}

/**
 * ProjectTile — a clean, non-expandable project card.
 *
 * Design (per user spec):
 *   • Dashed-border rounded container.
 *   • Hero screenshot area at the top (clickable → opens the project).
 *   • Framework icon badge in a dashed circle at the bottom-left of the hero.
 *   • NO name inside the card. The name + meta are rendered BELOW the card by
 *     the parent gallery so the tile stays a pure visual thumbnail.
 *   • A small chevron toggle reveals an optional details popover (framework,
 *     version, files, deps, start command) — but the card itself never grows,
 *     so neighbours in the grid never reflow.
 */
export function ProjectTile({ project, isSelected, onSelect, onRenameProject, onDeleteProject }: ProjectTileProps) {
  const meta = getFrameworkMeta(project.screenshotFramework || project.memory?.framework);
  const screenshot = useProjectScreenshot(project.id);

  const [menuOpen, setMenuOpen] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);

  // Lazy-loaded spec values for the details popover.
  const [versionLabel, setVersionLabel] = useState<string | undefined>();
  const [fileCount, setFileCount] = useState<number>(0);

  useEffect(() => {
    if (!showDetails || !db || !project.currentCommitId) {
      return;
    }

    let cancelled = false;
    Promise.all([getProjectCommit(db, project.currentCommitId), getProjectFiles(db, project.id)])
      .then(([commit, files]) => {
        if (cancelled) {
          return;
        }

        setVersionLabel(commit?.label);
        setFileCount(files?.files ? Object.keys(files.files).length : 0);
      })
      .catch(() => undefined);

    return () => {
      cancelled = true;
    };
  }, [showDetails, project.currentCommitId, project.id]);

  // Close kebab menu on outside click.
  useEffect(() => {
    if (!menuOpen) {
      return;
    }

    function handleClickOutside(event: MouseEvent) {
      if (menuRef.current && !menuRef.current.contains(event.target as Node)) {
        setMenuOpen(false);
      }
    }

    document.addEventListener('mousedown', handleClickOutside);

    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [menuOpen]);

  const framework = project.screenshotFramework || project.memory?.framework;
  const depCount = project.memory?.dependencies?.length ?? 0;
  const capturedRel = screenshot?.capturedAt ? timeFromNow(screenshot.capturedAt) : null;

  return (
    <div className="flex flex-col gap-2 w-full">
      <motion.div
        layout
        onClick={() => onSelect(project)}
        role="option"
        aria-selected={isSelected}
        aria-label={`Open project ${project.name}`}
        className={classNames(
          'relative rounded-2xl overflow-hidden border border-dashed transition-colors cursor-pointer group',
          isSelected
            ? 'border-blue-500/60 bg-blue-500/[0.04]'
            : 'border-sidebar-border/70 bg-sidebar/60 hover:bg-sidebar/80 hover:border-blue-500/40',
        )}
        style={{ borderWidth: 1 }}
      >
        {/* Selection accent ring */}
        {isSelected && (
          <div className="pointer-events-none absolute inset-0 ring-1 ring-blue-500/40 rounded-2xl z-20" />
        )}

        {/* Kebab menu — top-right, above the hero */}
        <div ref={menuRef} className="absolute top-2 right-2 z-30" onClick={(e) => e.stopPropagation()}>
          <button
            type="button"
            onClick={(e) => {
              e.stopPropagation();
              setMenuOpen(!menuOpen);
            }}
            className="w-7 h-7 rounded-md flex items-center justify-center text-muted-foreground hover:bg-sidebar-accent hover:text-sidebar-foreground transition-colors bg-background/70 backdrop-blur-sm border border-border/40"
            aria-label="Project actions"
            title="Project actions"
          >
            <MoreHorizontal size={14} />
          </button>
          <AnimatePresence>
            {menuOpen && (
              <motion.div
                initial={{ opacity: 0, scale: 0.9, y: -4 }}
                animate={{ opacity: 1, scale: 1, y: 0 }}
                exit={{ opacity: 0, scale: 0.9, y: -4 }}
                transition={{ duration: 0.12 }}
                className="absolute right-0 top-full mt-1 z-50 min-w-[140px] rounded-lg border border-sidebar-border bg-sidebar shadow-lg py-1 overflow-hidden"
              >
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onRenameProject(project);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-sidebar-foreground bg-sidebar hover:bg-sidebar-accent transition-colors"
                >
                  <Pencil size={12} className="shrink-0" />
                  <span>Rename</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    setShowDetails((v) => !v);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-sidebar-foreground bg-sidebar hover:bg-sidebar-accent transition-colors"
                >
                  <ChevronDown
                    size={12}
                    className={classNames('shrink-0 transition-transform', showDetails && 'rotate-180')}
                  />
                  <span>{showDetails ? 'Hide details' : 'Show details'}</span>
                </button>
                <button
                  type="button"
                  onClick={(e) => {
                    e.stopPropagation();
                    setMenuOpen(false);
                    onDeleteProject(project);
                  }}
                  className="w-full flex items-center gap-2 px-3 py-1.5 text-[12px] text-red-500 bg-sidebar hover:bg-red-500/10 transition-colors"
                >
                  <Trash2 size={12} className="shrink-0" />
                  <span>Delete project</span>
                </button>
              </motion.div>
            )}
          </AnimatePresence>
        </div>

        {/* Hero / screenshot area — clickable for redirection */}
        <button
          type="button"
          onClick={(e) => {
            e.stopPropagation();
            onSelect(project);
          }}
          className="block w-full focus:outline-none"
          style={{ height: 180 }}
          aria-label={`Open ${project.name}`}
        >
          <div className="relative w-full h-full overflow-hidden bg-muted/20">
            {screenshot?.dataUrl ? (
              <img
                src={screenshot.dataUrl}
                alt={`${project.name} preview`}
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
                <div className={classNames(meta.icon, 'w-12 h-12 opacity-80')} />
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
            {screenshot?.dataUrl && (
              <div className="absolute bottom-2.5 right-2.5 px-2 py-0.5 rounded-md text-[10px] font-medium text-foreground/80 bg-background/80 backdrop-blur-sm border border-border/60 flex items-center gap-1">
                <Globe size={9} className="text-emerald-500" />
                {capturedRel ? `captured ${capturedRel}` : 'preview'}
              </div>
            )}

            {/* Hover hint overlay */}
            <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors flex items-center justify-center opacity-0 group-hover:opacity-100">
              <span className="px-2.5 py-1 rounded-md text-[11px] font-medium text-white bg-black/60 backdrop-blur-sm">
                Open project →
              </span>
            </div>
          </div>
        </button>

        {/* Details popover — overlays the hero (absolute) so neighbours never reflow. */}
        <AnimatePresence>
          {showDetails && (
            <motion.div
              key="details"
              initial={{ opacity: 0, y: 6 }}
              animate={{ opacity: 1, y: 0 }}
              exit={{ opacity: 0, y: 6 }}
              transition={{ duration: 0.18 }}
              className="absolute left-2 right-2 bottom-2 z-20 rounded-xl border border-border/60 bg-sidebar/95 backdrop-blur-md shadow-lg p-3"
              onClick={(e) => e.stopPropagation()}
            >
              <div className="flex flex-wrap gap-y-2.5">
                <DetailField label="Framework" value={framework || '—'} half />
                <DetailField label="Version" value={versionLabel || '—'} half />
                <DetailField label="Files" value={fileCount ? String(fileCount) : '—'} half />
                <DetailField label="Dependencies" value={depCount ? `${depCount} tracked` : '—'} half />
                <DetailField label="Updated" value={formatRelativeShort(project.updatedAt)} half />
                <DetailField
                  label="Setup"
                  value={project.isSetupComplete ? 'Ready' : 'Pending'}
                  half
                  valueClass={project.isSetupComplete ? 'text-emerald-500' : 'text-amber-500'}
                />
                <div className="w-full pt-2 border-t border-border/50">
                  <DetailField label="Start command" value={project.startCommand || 'npm run dev'} full mono />
                </div>
                {project.chatIds.length > 0 && (
                  <div className="w-full pt-2 border-t border-border/50">
                    <DetailField
                      label="Chats"
                      value={`${project.chatIds.length} linked chat${project.chatIds.length === 1 ? '' : 's'}`}
                      full
                    />
                  </div>
                )}
              </div>
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>

      {/* Name + meta BELOW the tile (outside the dashed container). */}
      <div className="flex flex-col gap-0.5 px-1">
        <div className="flex items-center gap-1.5 min-w-0">
          <span
            className={classNames(
              'text-[13px] font-semibold truncate',
              isSelected ? 'text-blue-600 dark:text-blue-400' : 'text-sidebar-foreground',
            )}
          >
            {project.name}
          </span>
          {isSelected && (
            <span className="shrink-0 inline-block w-1.5 h-1.5 rounded-full bg-blue-500" title="Selected" />
          )}
        </div>
        <div className="flex items-center gap-1.5 text-[11px] text-muted-foreground min-w-0">
          {framework && (
            <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-sm bg-input/70 text-[10px] font-medium uppercase tracking-wide">
              {framework}
            </span>
          )}
          <span className="shrink-0">{formatRelativeShort(project.updatedAt)}</span>
          <span className="shrink-0">·</span>
          <span className="shrink-0">
            {project.chatIds.length} chat{project.chatIds.length === 1 ? '' : 's'}
          </span>
        </div>
      </div>
    </div>
  );
}

/** Small labelled spec field used inside the details popover. */
function DetailField({
  label,
  value,
  half,
  full,
  mono,
  valueClass,
}: {
  label: string;
  value: string;
  half?: boolean;
  full?: boolean;
  mono?: boolean;
  valueClass?: string;
}) {
  return (
    <div className={half ? 'w-1/2' : full ? 'w-full' : 'w-full'}>
      <div className="text-[10px] uppercase font-bold text-muted-foreground tracking-wide">{label}</div>
      <div
        className={classNames(
          'text-[12px] font-medium text-sidebar-foreground mt-0.5 truncate',
          mono && 'font-mono text-[11px]',
          valueClass,
        )}
      >
        {value}
      </div>
    </div>
  );
}

function timeFromNow(dateString: string): string {
  const date = new Date(dateString);
  const now = new Date();
  const diff = Math.floor((now.getTime() - date.getTime()) / 1000);

  if (diff < 60) {
    return 'just now';
  }

  if (diff < 3600) {
    return `${Math.floor(diff / 60)}m ago`;
  }

  if (diff < 86400) {
    return `${Math.floor(diff / 3600)}h ago`;
  }

  return `${Math.floor(diff / 86400)}d ago`;
}

function formatRelativeShort(iso: string): string {
  try {
    const date = new Date(iso);
    const diffMs = Date.now() - date.getTime();
    const diffMin = Math.floor(diffMs / 60000);
    const diffHr = Math.floor(diffMin / 60);
    const diffDay = Math.floor(diffHr / 24);

    if (diffMin < 1) {
      return 'just now';
    }

    if (diffMin < 60) {
      return `${diffMin}m ago`;
    }

    if (diffHr < 24) {
      return `${diffHr}h ago`;
    }

    if (diffDay < 7) {
      return `${diffDay}d ago`;
    }

    return date.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
  } catch {
    return iso;
  }
}
