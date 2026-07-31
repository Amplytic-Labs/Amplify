import React, { memo, useCallback, useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { Dialog, DialogRoot, DialogTitle, DialogDescription, DialogButton } from '~/components/ui/Dialog';

interface PlanPointInput {
  title: string;
  description: string;
  goal?: string;
  requirements?: string[];
  successCriteria?: string[];
  requiredSkills?: string[];
  expectedFiles?: string[];
  verificationRules?: string[];
  constraints?: {
    doNotModify?: string[];
    doNotInstall?: string[];
    additional?: string[];
  };
}

interface PlanApprovalDialogProps {
  open: boolean;
  signal: {
    taskDescription: string;
    planPoints: PlanPointInput[];
    plannerNotes?: string;
    _enriched?: boolean;
  } | null;

  // True while the planner LLM enriches the draft into full Task Contracts.
  planning?: boolean;
  onApprove: () => void;
  onReject: () => void;
  onModify: (points: Array<{ title: string; description: string }>) => void;
}

/**
 * Collapsible section for task contract details.
 */
function DetailSection({
  label,
  icon,
  items,
  color = 'text-gray-600 dark:text-gray-400',
}: {
  label: string;
  icon: React.ReactNode;
  items: string[];
  color?: string;
}) {
  const [open, setOpen] = useState(false);

  if (items.length === 0) {
    return null;
  }

  return (
    <div className="mt-1">
      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="bg-transparent flex items-center gap-1 text-[10px] font-medium text-gray-500 dark:text-gray-500 hover:text-gray-700 dark:hover:text-gray-300 transition-colors"
      >
        <svg
          width="8"
          height="8"
          viewBox="0 0 24 24"
          fill="none"
          stroke="currentColor"
          strokeWidth="2.5"
          className={`transition-transform duration-200 ${open ? 'rotate-90' : ''}`}
        >
          <polyline points="9 18 15 12 9 6" />
        </svg>
        {icon}
        {label} ({items.length})
      </button>
      {open && (
        <ul className="mt-1 space-y-0.5 pl-4">
          {items.map((item, i) => (
            <li key={i} className={`text-[10px] ${color} leading-relaxed`}>
              {item}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

export const PlanApprovalDialog = memo(
  ({ open, signal, planning = false, onApprove, onReject, onModify }: PlanApprovalDialogProps) => {
    const [isEditing, setIsEditing] = useState(false);
    const [editedPoints, setEditedPoints] = useState<Array<{ title: string; description: string }>>([]);
    const [expandedSteps, setExpandedSteps] = useState<Set<number>>(new Set());

    // Reset editing state when signal changes
    useEffect(() => {
      if (signal) {
        setEditedPoints(signal.planPoints.map((p) => ({ title: p.title, description: p.description })));
        setIsEditing(false);
        setExpandedSteps(new Set());
      }
    }, [signal]);

    const handleModify = useCallback(() => {
      if (!signal) {
        return;
      }

      if (isEditing) {
        // Submit modifications
        onModify(editedPoints);
      } else {
        // Enter edit mode
        setIsEditing(true);
      }
    }, [signal, isEditing, editedPoints, onModify]);

    const handlePointTitleChange = useCallback((index: number, value: string) => {
      setEditedPoints((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], title: value };

        return next;
      });
    }, []);

    const handlePointDescriptionChange = useCallback((index: number, value: string) => {
      setEditedPoints((prev) => {
        const next = [...prev];
        next[index] = { ...next[index], description: value };

        return next;
      });
    }, []);

    const toggleStepExpand = useCallback((index: number) => {
      setExpandedSteps((prev) => {
        const next = new Set(prev);

        if (next.has(index)) {
          next.delete(index);
        } else {
          next.add(index);
        }

        return next;
      });
    }, []);

    if (!signal) {
      return null;
    }

    const points = signal.planPoints;
    const totalSkills = [...new Set(points.flatMap((p) => p.requiredSkills || []))].length;
    const totalConstraints = points.filter(
      (p) => p.constraints && (p.constraints.doNotModify?.length || 0) + (p.constraints.additional?.length || 0) > 0,
    ).length;

    // Use original signal points for display (with contract fields), edited points only when editing
    const displayPoints: PlanPointInput[] = isEditing ? editedPoints : points;

    return (
      <DialogRoot
        open={open}
        onOpenChange={(isOpen) => {
          if (!isOpen) {
            onReject();
          }
        }}
      >
        <Dialog className="w-[620px] max-h-[85vh] flex flex-col" showCloseButton={false}>
          <div className="p-6 bg-white dark:bg-gray-950 relative z-10 flex flex-col max-h-[85vh]">
            {/* Header */}
            <DialogTitle className="flex items-center gap-2.5">
              <div className="flex items-center justify-center w-7 h-7 rounded-lg bg-gradient-to-br from-blue-500 to-blue-400 text-white">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <path d="M9 11l3 3L22 4" />
                  <path d="M21 12v7a2 2 0 01-2 2H5a2 2 0 01-2-2V5a2 2 0 012-2h11" />
                </svg>
              </div>
              Review Plan
            </DialogTitle>
            <DialogDescription className="mt-1.5 line-clamp-2 text-sm">{signal.taskDescription}</DialogDescription>

            {/* Summary row */}
            <div className="flex items-center gap-3 mt-3 text-[11px] text-gray-500 dark:text-gray-500">
              <span className="flex items-center gap-1">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                  <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                </svg>
                {points.length} steps
              </span>
              {totalSkills > 0 && (
                <span className="flex items-center gap-1">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                  </svg>
                  {totalSkills} skill{totalSkills !== 1 ? 's' : ''}
                </span>
              )}
              {totalConstraints > 0 && (
                <span className="flex items-center gap-1 text-amber-500">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                    <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                    <line x1="12" y1="9" x2="12" y2="13" />
                    <line x1="12" y1="17" x2="12.01" y2="17" />
                  </svg>
                  {totalConstraints} constrained
                </span>
              )}
            </div>

            {/* Divider */}
            <div className="h-px bg-gray-200 dark:bg-gray-800 my-3" />

            {/* Plan points list */}
            <div className="flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-amplify-elements-bg-depth-3 pr-1">
              {planning ? (
                <div className="flex flex-col items-center justify-center py-10 px-4 text-center">
                  <div className="relative w-10 h-10 mb-4">
                    <div className="absolute inset-0 rounded-full border-2 border-blue-200 dark:border-blue-400/20" />
                    <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-blue-500 dark:border-t-fuchsia-400 animate-spin" />
                  </div>
                  <div className="text-sm font-medium text-gray-700 dark:text-gray-200">Generating detailed plan…</div>
                  <div className="text-[11px] text-gray-500 dark:text-gray-500 mt-1.5 max-w-xs leading-relaxed">
                    The planner is enriching each step into a full Task Contract — goal, requirements, success criteria,
                    required skills, and constraints.
                  </div>
                  {points.length > 0 && (
                    <div className="text-[10px] text-gray-400 dark:text-gray-600 mt-3">
                      {points.length} draft step{points.length !== 1 ? 's' : ''} from the assistant · refining now
                    </div>
                  )}
                </div>
              ) : (
                <div className="space-y-2.5">
                  {displayPoints.map((point, index) => {
                    const isExpanded = expandedSteps.has(index);
                    const hasDetails =
                      point.goal ||
                      (point.requirements?.length || 0) > 0 ||
                      (point.successCriteria?.length || 0) > 0 ||
                      (point.requiredSkills?.length || 0) > 0 ||
                      point.constraints;

                    return (
                      <div
                        key={index}
                        className={classNames(
                          'rounded-xl border transition-all duration-200',
                          'border-gray-200 dark:border-gray-700/50',
                          isExpanded
                            ? 'bg-gray-50 dark:bg-gray-800/40 shadow-sm'
                            : 'bg-white dark:bg-gray-900/50 hover:border-gray-300 dark:hover:border-gray-600',
                        )}
                      >
                        <div
                          className="flex items-start gap-3 p-3 cursor-pointer"
                          onClick={() => hasDetails && !isEditing && toggleStepExpand(index)}
                        >
                          {/* Step number — purple gradient */}
                          <div className="flex-shrink-0 flex items-center justify-center w-7 h-7 rounded-full bg-gradient-to-br from-blue-500 to-blue-400 text-white text-xs font-bold shadow-sm shadow-blue-500/20">
                            {index + 1}
                          </div>

                          <div className="flex-1 min-w-0 space-y-1">
                            {isEditing ? (
                              <>
                                <input
                                  type="text"
                                  value={point.title}
                                  onChange={(e) => handlePointTitleChange(index, e.target.value)}
                                  className="w-full text-sm font-medium bg-transparent border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-gray-900 dark:text-white focus:outline-none focus:ring-2 focus:ring-blue-500/50"
                                  placeholder="Step title"
                                  onClick={(e) => e.stopPropagation()}
                                />
                                <textarea
                                  value={point.description}
                                  onChange={(e) => handlePointDescriptionChange(index, e.target.value)}
                                  rows={2}
                                  className="w-full text-xs bg-transparent border border-gray-300 dark:border-gray-600 rounded-md px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-2 focus:ring-blue-500/50 resize-none"
                                  placeholder="Step description"
                                  onClick={(e) => e.stopPropagation()}
                                />
                              </>
                            ) : (
                              <>
                                <div className="text-sm font-semibold text-gray-900 dark:text-white leading-tight">
                                  {point.title}
                                </div>
                                {point.goal && (
                                  <p className="text-[11px] text-blue-500 dark:text-blue-400 italic leading-snug">
                                    {point.goal}
                                  </p>
                                )}
                                <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed line-clamp-2">
                                  {point.description}
                                </p>

                                {/* Skill chips (always visible) */}
                                {point.requiredSkills && point.requiredSkills.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1">
                                    {point.requiredSkills.map((skill) => (
                                      <span
                                        key={skill}
                                        className="inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-medium bg-blue-500/10 dark:bg-blue-400/15 text-blue-600 dark:text-blue-300 border border-blue-500/20 dark:border-blue-400/25"
                                      >
                                        <svg width="7" height="7" viewBox="0 0 24 24" fill="currentColor">
                                          <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                                        </svg>
                                        {skill}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Constraints warning (always visible) */}
                                {point.constraints &&
                                  (point.constraints.doNotModify?.length || 0) +
                                    (point.constraints.additional?.length || 0) >
                                    0 && (
                                    <div className="flex items-center gap-1 mt-1 text-[10px] text-amber-600 dark:text-amber-400">
                                      <svg
                                        width="10"
                                        height="10"
                                        viewBox="0 0 24 24"
                                        fill="none"
                                        stroke="currentColor"
                                        strokeWidth="2"
                                      >
                                        <path d="M10.29 3.86L1.82 18a2 2 0 001.71 3h16.94a2 2 0 001.71-3L13.71 3.86a2 2 0 00-3.42 0z" />
                                        <line x1="12" y1="9" x2="12" y2="13" />
                                      </svg>
                                      {(point.constraints.doNotModify?.length || 0) +
                                        (point.constraints.additional?.length || 0)}{' '}
                                      constraint
                                      {(point.constraints.doNotModify?.length || 0) +
                                        (point.constraints.additional?.length || 0) !==
                                      1
                                        ? 's'
                                        : ''}
                                    </div>
                                  )}

                                {/* Expected files */}
                                {point.expectedFiles && point.expectedFiles.length > 0 && (
                                  <div className="flex flex-wrap gap-1 mt-1.5">
                                    {point.expectedFiles.map((file) => (
                                      <span
                                        key={file}
                                        className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                                      >
                                        <svg
                                          width="8"
                                          height="8"
                                          viewBox="0 0 24 24"
                                          fill="none"
                                          stroke="currentColor"
                                          strokeWidth="2"
                                        >
                                          <path d="M14 2H6a2 2 0 00-2 2v16a2 2 0 002 2h12a2 2 0 002-2V8z" />
                                          <polyline points="14 2 14 8 20 8" />
                                        </svg>
                                        {file}
                                      </span>
                                    ))}
                                  </div>
                                )}

                                {/* Expand indicator */}
                                {hasDetails && !isExpanded && (
                                  <div className="text-[10px] text-gray-400 dark:text-gray-600 mt-1">
                                    Click to see details →
                                  </div>
                                )}
                              </>
                            )}
                          </div>
                        </div>

                        {/* Expanded details */}
                        {isExpanded && !isEditing && (
                          <div className="px-3 pb-3 pt-0 ml-10 space-y-2 border-t border-gray-100 dark:border-gray-700/50 mt-0 pt-2">
                            {/* Requirements */}
                            <DetailSection
                              label="Requirements"
                              icon={
                                <svg
                                  width="8"
                                  height="8"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <polyline points="20 6 9 17 4 12" />
                                </svg>
                              }
                              items={point.requirements || []}
                              color="text-gray-600 dark:text-gray-400"
                            />

                            {/* Success Criteria */}
                            <DetailSection
                              label="Success Criteria"
                              icon={
                                <svg
                                  width="8"
                                  height="8"
                                  viewBox="0 0 24 24"
                                  fill="none"
                                  stroke="currentColor"
                                  strokeWidth="2.5"
                                >
                                  <circle cx="12" cy="12" r="10" />
                                  <circle cx="12" cy="12" r="6" />
                                  <circle cx="12" cy="12" r="2" />
                                </svg>
                              }
                              items={point.successCriteria || []}
                              color="text-green-600 dark:text-green-400"
                            />

                            {/* Constraints detail */}
                            {point.constraints && (
                              <div className="mt-1">
                                {point.constraints.doNotModify && point.constraints.doNotModify.length > 0 && (
                                  <div>
                                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                      Do not modify:
                                    </span>
                                    <ul className="mt-0.5 space-y-0.5 pl-3">
                                      {point.constraints.doNotModify.map((f, i) => (
                                        <li
                                          key={i}
                                          className="text-[10px] text-amber-600 dark:text-amber-400 font-mono"
                                        >
                                          ⊘ {f}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                                {point.constraints.additional && point.constraints.additional.length > 0 && (
                                  <div className="mt-1">
                                    <span className="text-[10px] font-medium text-amber-600 dark:text-amber-400">
                                      Additional constraints:
                                    </span>
                                    <ul className="mt-0.5 space-y-0.5 pl-3">
                                      {point.constraints.additional.map((c, i) => (
                                        <li key={i} className="text-[10px] text-amber-600 dark:text-amber-400">
                                          ⊘ {c}
                                        </li>
                                      ))}
                                    </ul>
                                  </div>
                                )}
                              </div>
                            )}
                          </div>
                        )}
                      </div>
                    );
                  })}
                </div>
              )}
            </div>

            {/* Planner notes (shown after enrichment) */}
            {!planning && signal?.plannerNotes && (
              <div className="mt-3 px-3 py-2 rounded-lg bg-blue-50 dark:bg-blue-400/10 border border-blue-200 dark:border-blue-400/20">
                <div className="flex items-center gap-1.5 text-[10px] font-semibold text-blue-600 dark:text-blue-300 uppercase tracking-wide">
                  <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <path d="M12 2l2.4 7.4H22l-6.2 4.5 2.4 7.4L12 16.8l-6.2 4.5 2.4-7.4L2 9.4h7.6z" />
                  </svg>
                  Planner Notes
                </div>
                <p className="text-[11px] text-blue-700 dark:text-blue-200 mt-1 leading-relaxed">
                  {signal.plannerNotes}
                </p>
              </div>
            )}

            {/* Enrichment badge */}
            {!planning && signal?._enriched && (
              <div className="mt-2 flex items-center gap-1 text-[10px] text-green-600 dark:text-green-400">
                <svg width="10" height="10" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                  <polyline points="20 6 9 17 4 12" />
                </svg>
                Plan enriched by dedicated planner (full Task Contracts)
              </div>
            )}

            {/* Action buttons */}
            <div className="flex items-center justify-between mt-4 pt-4 border-t border-gray-200 dark:border-gray-700">
              <button
                onClick={onReject}
                className={classNames(
                  'px-4 py-2 rounded-lg text-sm transition-colors',
                  'bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                )}
              >
                Cancel
              </button>
              <div className="flex items-center gap-2">
                <button
                  onClick={handleModify}
                  disabled={planning}
                  className={classNames(
                    'px-4 py-2 rounded-lg text-sm transition-colors',
                    'bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                    planning && 'opacity-40 cursor-not-allowed hover:bg-transparent',
                  )}
                >
                  {isEditing ? 'Submit Changes' : 'Modify'}
                </button>
                <DialogButton type="primary" onClick={onApprove} disabled={planning}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M8 5v14l11-7z" />
                  </svg>
                  Execute Plan
                </DialogButton>
              </div>
            </div>
          </div>
        </Dialog>
      </DialogRoot>
    );
  },
);
