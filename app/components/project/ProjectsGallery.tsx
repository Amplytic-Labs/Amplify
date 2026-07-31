import { useEffect, useMemo, useState } from 'react';
import { useStore } from '@nanostores/react';
import { motion } from 'framer-motion';
import { ArrowLeft, Folder, Search, Sparkles, Plus } from 'lucide-react';
import { projectStore, type Project } from '~/lib/persistence/project-store';
import { showChatView } from '~/lib/stores/insetView';
import { selectedProjectId, setSelectedProject, clearSelectedProject } from '~/lib/stores/selectedProject';
import { ProjectTile } from './ProjectTile';
import { Dialog, DialogButton, DialogDescription, DialogRoot, DialogTitle } from '~/components/ui/Dialog';

interface ProjectsGalleryProps {
  /**
   * Called when a project is selected from the gallery. The parent (sidebar)
   * wires this to its existing `handleSelectProject` flow, which creates an
   * empty project chat, loads the workspace, and switches back to the chat
   * view.
   */
  onSelectProject: (project: Project) => void;
}

/**
 * ProjectsGallery — full-screen (sidebar-inset) gallery of all projects.
 *
 * Renders in place of the chat when `insetView === 'projects'`. Replaces the
 * old in-sidebar ExpandableCard list with a responsive grid of clean
 * ProjectTile cards (name shown below the tile, not inside).
 *
 * Selecting a project calls `onSelectProject` and flips `insetView` back to
 * `'chat'` so the base chat is restored with the project's workspace loaded.
 */
export function ProjectsGallery({ onSelectProject }: ProjectsGalleryProps) {
  /*
   * Reactive project list — re-renders on any project mutation.
   * projectStore._versionStore is private but stable across releases.
   */
  // @ts-expect-error — _versionStore is private but stable across releases.
  const projectsVersion = useStore(projectStore._versionStore);
  const selectedId = useStore(selectedProjectId);

  const allProjects = useMemo(() => {
    void projectsVersion;
    return projectStore.getAllProjects();
  }, [projectsVersion]);

  const [search, setSearch] = useState('');
  const [dialog, setDialog] = useState<
    | {
        type: 'delete';
        project: Project;
      }
    | { type: 'rename'; project: Project }
    | null
  >(null);
  const [renameValue, setRenameValue] = useState('');

  useEffect(() => {
    if (dialog?.type === 'rename') {
      setRenameValue(dialog.project.name);
    }
  }, [dialog]);

  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();

    if (!q) {
      return allProjects;
    }

    return allProjects.filter((p) => {
      const haystack = [p.name, p.description ?? '', ...(p.technologies ?? [])].join(' ').toLowerCase();
      return haystack.includes(q);
    });
  }, [allProjects, search]);

  const handleSelect = (project: Project) => {
    setSelectedProject(project.id);
    onSelectProject(project);

    // Return to base chat — the gallery swaps out for the chat view.
    showChatView();
  };

  const handleRename = (project: Project, newName: string) => {
    const trimmed = newName.trim();

    if (!trimmed) {
      return;
    }

    projectStore.updateProject(project.id, { name: trimmed });
    setDialog(null);
  };

  const handleDelete = (project: Project) => {
    projectStore.deleteProject(project.id);

    if (selectedId === project.id) {
      clearSelectedProject();
    }

    setDialog(null);
  };

  return (
    <div className="flex flex-col h-full w-full bg-background overflow-hidden">
      {/* Top bar — back to chat + title + search */}
      <div className="shrink-0 flex flex-col gap-3 px-4 sm:px-6 lg:px-8 pt-4 pb-3 border-b border-border/60">
        <div className="flex items-center justify-between gap-3">
          <div className="flex items-center gap-3 min-w-0">
            <button
              type="button"
              onClick={showChatView}
              className="shrink-0 inline-flex items-center gap-1.5 px-2.5 py-1.5 rounded-md text-[13px] text-muted-foreground bg-sidebar hover:text-sidebar-foreground hover:bg-sidebar-accent/60 transition-colors"
              title="Back to chat"
            >
              <ArrowLeft size={15} />
              <span className="hidden sm:inline">Back to chat</span>
            </button>
            <div className="h-4 w-px bg-border/60 hidden sm:block" />
            <h1 className="flex items-center gap-2 text-[18px] font-semibold text-sidebar-foreground truncate">
              <Folder size={18} className="text-blue-500 shrink-0" />
              <span>Projects</span>
              <span className="text-[12px] font-normal text-muted-foreground">({filtered.length})</span>
            </h1>
          </div>
        </div>

        <div className="relative w-full max-w-md">
          <Search size={15} className="absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <input
            type="search"
            placeholder="Search projects by name, description, or tech…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="w-full bg-sidebar border border-sidebar-border rounded-lg pl-9 pr-3 py-2 text-[13px] text-sidebar-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-1 focus:ring-blue-500/50"
          />
        </div>
      </div>

      {/* Gallery grid — scrolls */}
      <div className="flex-1 overflow-y-auto custom-scrollbar px-4 sm:px-6 lg:px-8 py-5">
        {filtered.length === 0 ? (
          <EmptyState hasProjects={allProjects.length > 0} onCreate={() => showChatView()} />
        ) : (
          <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4 gap-5 max-w-[1400px] mx-auto">
            {filtered.map((project) => (
              <motion.div
                key={project.id}
                layout
                initial={{ opacity: 0, y: 8 }}
                animate={{ opacity: 1, y: 0 }}
                transition={{ duration: 0.2 }}
              >
                <ProjectTile
                  project={project}
                  isSelected={selectedId === project.id}
                  onSelect={handleSelect}
                  onRenameProject={(p) => setDialog({ type: 'rename', project: p })}
                  onDeleteProject={(p) => setDialog({ type: 'delete', project: p })}
                />
              </motion.div>
            ))}
          </div>
        )}
      </div>

      {/* Rename / delete dialogs */}
      <DialogRoot open={dialog !== null}>
        <Dialog onClose={() => setDialog(null)} onBackdrop={() => setDialog(null)} className="w-[420px] max-w-[92vw]">
          <div className="p-6 bg-white dark:bg-gray-950">
            {dialog?.type === 'rename' && (
              <>
                <DialogTitle className="text-gray-900 dark:text-white">Rename project</DialogTitle>
                <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                  Choose a new name for this project. This doesn&apos;t affect any chats or files.
                </DialogDescription>
                <input
                  type="text"
                  value={renameValue}
                  onChange={(e) => setRenameValue(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter') {
                      e.preventDefault();
                      handleRename(dialog.project, renameValue);
                    }
                  }}
                  autoFocus
                  className="mt-4 w-full rounded-md border border-gray-300 dark:border-gray-700 bg-white dark:bg-gray-900 px-3 py-2 text-sm text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                  placeholder="Project name"
                />
                <div className="flex justify-end gap-3 mt-6">
                  <DialogButton type="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </DialogButton>
                  <DialogButton type="primary" onClick={() => handleRename(dialog.project, renameValue)}>
                    Save
                  </DialogButton>
                </div>
              </>
            )}
            {dialog?.type === 'delete' && (
              <>
                <DialogTitle className="text-gray-900 dark:text-white">Delete project?</DialogTitle>
                <DialogDescription className="mt-2 text-gray-600 dark:text-gray-400">
                  <span className="font-medium text-gray-900 dark:text-white">{dialog.project.name}</span> will be
                  permanently deleted. Its {dialog.project.chatIds.length} chat
                  {dialog.project.chatIds.length === 1 ? '' : 's'} will be kept as personal chats, but all project
                  files, version history, and memory will be removed.
                </DialogDescription>
                <div className="flex justify-end gap-3 mt-6">
                  <DialogButton type="secondary" onClick={() => setDialog(null)}>
                    Cancel
                  </DialogButton>
                  <DialogButton
                    type="primary"
                    onClick={() => handleDelete(dialog.project)}
                    className="bg-red-500 hover:bg-red-600"
                  >
                    Delete project
                  </DialogButton>
                </div>
              </>
            )}
          </div>
        </Dialog>
      </DialogRoot>
    </div>
  );
}

function EmptyState({ hasProjects, onCreate }: { hasProjects: boolean; onCreate: () => void }) {
  return (
    <div className="flex flex-col items-center justify-center gap-4 text-center py-20 max-w-md mx-auto">
      <div className="relative">
        <div className="absolute inset-0 bg-gradient-to-br from-blue-500/20 to-blue-400/10 blur-xl rounded-full" />
        <div className="relative w-16 h-16 rounded-2xl bg-gradient-to-br from-blue-500/15 to-blue-400/10 flex items-center justify-center ring-1 ring-blue-500/20">
          {hasProjects ? (
            <Search size={26} className="text-blue-500" />
          ) : (
            <Sparkles size={26} className="text-blue-500" />
          )}
        </div>
      </div>
      <div className="space-y-1.5">
        <p className="text-[15px] font-semibold text-sidebar-foreground">
          {hasProjects ? 'No projects match your search' : 'No projects yet'}
        </p>
        <p className="text-[12px] text-muted-foreground/80 leading-relaxed">
          {hasProjects
            ? 'Try a different keyword, or clear the search to see all your projects.'
            : 'Projects are created automatically when you open the workspace from a chat. Files, memory, and versions are shared across every chat in a project.'}
        </p>
      </div>
      {!hasProjects && (
        <button
          type="button"
          onClick={onCreate}
          className="mt-1 inline-flex items-center gap-1.5 px-3.5 py-2 rounded-full text-[12px] font-medium text-blue-600 dark:text-blue-400 bg-blue-500/10 hover:bg-blue-500/15 border border-blue-500/20 transition-colors"
        >
          <Plus size={13} className="shrink-0" />
          <span>Start a new chat</span>
        </button>
      )}
    </div>
  );
}
