import React, { useCallback, useEffect, useRef, useState } from 'react';
import { Brain, ChevronDown, ChevronRight, Plus, X, Sparkles, Clock, RotateCcw } from 'lucide-react';
import { motion, AnimatePresence } from 'framer-motion';
import { Input } from '~/components/ui/Input';
import { Label } from '~/components/ui/Label';
import { Button } from '~/components/ui/Button';
import { Badge } from '~/components/ui/Badge';
import { classNames } from '~/utils/classNames';
import { projectStore, type ProjectMemory } from '~/lib/persistence/project-store';

interface ProjectMemoryPanelProps {
  projectId: string;

  /** Whether the panel is rendered inside a dialog (controls padding/height). */
  embedded?: boolean;

  /** Optional callback after a memory field is updated. */
  onChange?: () => void;
}

const FIELD_DEFS: Array<{
  key: keyof ProjectMemory;
  label: string;
  placeholder: string;
}> = [
  { key: 'framework', label: 'Framework', placeholder: 'e.g. Next.js 14, Vite + React' },
  { key: 'stateManagement', label: 'State Management', placeholder: 'e.g. Zustand, Redux Toolkit' },
  { key: 'backend', label: 'Backend', placeholder: 'e.g. Supabase, Prisma + Postgres' },
  { key: 'architecture', label: 'Architecture', placeholder: 'e.g. App Router, Feature-based' },
  { key: 'theme', label: 'Theme / Styling', placeholder: 'e.g. Tailwind CSS, styled-components' },
  { key: 'codingStyle', label: 'Coding Style', placeholder: 'e.g. TypeScript, functional components' },
];

function formatTimestamp(iso?: string): string {
  if (!iso) {
    return 'Not set';
  }

  try {
    const date = new Date(iso);
    const now = Date.now();
    const diffMs = now - date.getTime();
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
    return 'Not set';
  }
}

export function ProjectMemoryPanel({ projectId, embedded = false, onChange }: ProjectMemoryPanelProps) {
  /*
   * Subscribe reactively to the project's version counter so we re-render
   * whenever the memory is updated (from anywhere in the app).
   */
  const project = projectStore.useProject(projectId);
  const [collapsed, setCollapsed] = useState(false);
  const [newDep, setNewDep] = useState('');
  const [notesValue, setNotesValue] = useState<string>(project?.memory?.notes ?? '');

  /*
   * Keep local notes textarea in sync with the project memory (only when it
   * changes externally).
   */
  useEffect(() => {
    setNotesValue(project?.memory?.notes ?? '');
  }, [project?.memory?.notes]);

  const memory: ProjectMemory = project?.memory ?? {};

  /*
   * Debounced field updates: we keep a local mirror of each text field so the
   * input stays responsive, then flush to the store after 400ms of inactivity.
   * This avoids writing to localStorage on every keystroke.
   */
  const [localFields, setLocalFields] = useState<Record<string, string>>({});
  const flushTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  // Seed local fields whenever the project memory changes externally.
  useEffect(() => {
    const seed: Record<string, string> = {};

    FIELD_DEFS.forEach(({ key }) => {
      seed[key] = (project?.memory?.[key] as string) ?? '';
    });
    setLocalFields(seed);
  }, [project?.memory]);

  const flushFields = useCallback(() => {
    if (Object.keys(localFields).length === 0) {
      return;
    }

    const updates: Partial<ProjectMemory> = {};

    (Object.keys(localFields) as (keyof ProjectMemory)[]).forEach((key) => {
      const newVal = localFields[key as string] ?? '';
      const oldVal = (project?.memory?.[key as keyof ProjectMemory] as string) ?? '';

      if (newVal !== oldVal) {
        (updates as any)[key] = newVal;
      }
    });

    if (Object.keys(updates).length > 0) {
      projectStore.updateProjectMemory(projectId, updates);
      onChange?.();
    }
  }, [localFields, project?.memory, projectId, onChange]);

  const scheduleFlush = useCallback(() => {
    if (flushTimer.current) {
      clearTimeout(flushTimer.current);
    }

    flushTimer.current = setTimeout(() => {
      flushTimer.current = null;
      flushFields();
    }, 400);
  }, [flushFields]);

  // Flush pending changes when the component unmounts.
  useEffect(() => {
    return () => {
      if (flushTimer.current) {
        clearTimeout(flushTimer.current);
        flushFields();
      }
    };
  }, [flushFields]);

  const handleFieldChange = useCallback(
    (key: keyof ProjectMemory, value: string) => {
      setLocalFields((prev) => ({ ...prev, [key]: value }));
      scheduleFlush();
    },
    [scheduleFlush],
  );

  const handleNotesBlur = useCallback(() => {
    if ((project?.memory?.notes ?? '') !== notesValue) {
      projectStore.updateProjectMemory(projectId, { notes: notesValue });
      onChange?.();
    }
  }, [projectId, notesValue, project?.memory?.notes, onChange]);

  const handleAddDep = useCallback(() => {
    const trimmed = newDep.trim();

    if (!trimmed) {
      return;
    }

    projectStore.addDependency(projectId, trimmed);
    setNewDep('');
    onChange?.();
  }, [projectId, newDep, onChange]);

  const handleRemoveDep = useCallback(
    (dep: string) => {
      const current = project?.memory?.dependencies ?? [];
      projectStore.updateProjectMemory(projectId, {
        dependencies: current.filter((d) => d !== dep),
      });
      onChange?.();
    },
    [projectId, project?.memory?.dependencies, onChange],
  );

  if (!project) {
    return (
      <div className={classNames('p-4 text-sm text-amplify-elements-textSecondary', embedded ? '' : 'h-full')}>
        Project not found.
      </div>
    );
  }

  return (
    <div
      className={classNames(
        'flex flex-col bg-amplify-elements-background-depth-1 text-amplify-elements-textPrimary',
        embedded ? '' : 'rounded-lg border border-amplify-elements-borderColor h-full',
      )}
    >
      {/* Header */}
      <button
        type="button"
        onClick={() => setCollapsed(!collapsed)}
        className="flex items-center gap-2 px-4 py-3 border-b border-amplify-elements-borderColor hover:bg-amplify-elements-background-depth-2 transition-colors text-left"
        aria-expanded={!collapsed}
        aria-label="Toggle project memory panel"
      >
        <Brain size={16} className="text-blue-500 shrink-0" />
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <span className="text-sm font-medium truncate">{project.name}</span>
            <Badge variant="primary" size="sm">
              Memory
            </Badge>
          </div>
          <div className="flex items-center gap-1 text-xs text-amplify-elements-textTertiary mt-0.5">
            <Clock size={10} />
            <span>Updated {formatTimestamp(memory.updatedAt ?? project.updatedAt)}</span>
          </div>
        </div>
        {collapsed ? (
          <ChevronRight size={16} className="text-amplify-elements-textTertiary shrink-0" />
        ) : (
          <ChevronDown size={16} className="text-amplify-elements-textTertiary shrink-0" />
        )}
      </button>

      <AnimatePresence initial={false}>
        {!collapsed && (
          <motion.div
            initial={{ height: 0, opacity: 0 }}
            animate={{ height: 'auto', opacity: 1 }}
            exit={{ height: 0, opacity: 0 }}
            transition={{ duration: 0.2 }}
            className="overflow-hidden"
          >
            <div className="px-4 py-4 space-y-4">
              {/* Field grid */}
              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                {FIELD_DEFS.map(({ key, label, placeholder }) => (
                  <div key={key} className="space-y-1.5">
                    <Label className="text-xs text-amplify-elements-textSecondary">{label}</Label>
                    <Input
                      type="text"
                      value={localFields[key] ?? ''}
                      placeholder={placeholder}
                      onChange={(e) => handleFieldChange(key, e.target.value)}
                      className="h-9 text-sm bg-amplify-elements-background"
                    />
                  </div>
                ))}
              </div>

              {/* Dependencies */}
              <div className="space-y-2">
                <Label className="text-xs text-amplify-elements-textSecondary">Dependencies</Label>
                <div className="flex flex-wrap gap-1.5 min-h-[28px]">
                  {(memory.dependencies ?? []).length === 0 && (
                    <span className="text-xs text-amplify-elements-textTertiary italic">No dependencies tracked</span>
                  )}
                  {(memory.dependencies ?? []).map((dep) => (
                    <Badge key={dep} variant="subtle" size="md" className="gap-1 pr-1">
                      <span>{dep}</span>
                      <button
                        type="button"
                        onClick={() => handleRemoveDep(dep)}
                        className="rounded-full hover:bg-amplify-elements-background-depth-3 p-0.5"
                        aria-label={`Remove ${dep}`}
                      >
                        <X size={10} />
                      </button>
                    </Badge>
                  ))}
                </div>
                <div className="flex gap-2">
                  <Input
                    type="text"
                    value={newDep}
                    onChange={(e) => setNewDep(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') {
                        e.preventDefault();
                        handleAddDep();
                      }
                    }}
                    placeholder="Add dependency (e.g. zod, framer-motion)"
                    className="h-8 text-xs bg-amplify-elements-background"
                  />
                  <Button
                    type="button"
                    variant="secondary"
                    size="sm"
                    onClick={handleAddDep}
                    className="h-8 px-2"
                    aria-label="Add dependency"
                  >
                    <Plus size={14} />
                  </Button>
                </div>
              </div>

              {/* Notes */}
              <div className="space-y-1.5">
                <Label className="text-xs text-amplify-elements-textSecondary">Notes</Label>
                <textarea
                  value={notesValue}
                  onChange={(e) => setNotesValue(e.target.value)}
                  onBlur={handleNotesBlur}
                  placeholder="Free-form notes about this project — conventions, gotchas, todos…"
                  rows={4}
                  className="w-full rounded-md border border-amplify-elements-border bg-amplify-elements-background px-3 py-2 text-sm placeholder:text-amplify-elements-textSecondary focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-amplify-elements-ring resize-y min-h-[80px]"
                />
              </div>

              <div className="flex items-center gap-1.5 text-[11px] text-amplify-elements-textTertiary pt-1">
                <Sparkles size={10} />
                <span>
                  Memory is injected into every chat's system prompt. Fields are auto-detected from your files but never
                  overwrite manual edits.
                </span>
              </div>
            </div>
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
}

export default ProjectMemoryPanel;
