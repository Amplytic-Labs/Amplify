import React, { memo, useCallback, useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import { Dialog, DialogRoot, DialogTitle, DialogDescription, DialogButton } from '~/components/ui/Dialog';

interface PlanPointInput {
  title: string;
  description: string;
  expectedFiles?: string[];
  verificationRules?: string[];
}

interface PlanApprovalDialogProps {
  open: boolean;
  signal: {
    taskDescription: string;
    planPoints: PlanPointInput[];
  } | null;
  onApprove: () => void;
  onReject: () => void;
  onModify: (points: Array<{ title: string; description: string }>) => void;
}

export const PlanApprovalDialog = memo(function PlanApprovalDialog({
  open,
  signal,
  onApprove,
  onReject,
  onModify,
}: PlanApprovalDialogProps) {
  const [isEditing, setIsEditing] = useState(false);
  const [editedPoints, setEditedPoints] = useState<Array<{ title: string; description: string }>>([]);

  // Reset editing state when signal changes
  useEffect(() => {
    if (signal) {
      setEditedPoints(
        signal.planPoints.map((p) => ({ title: p.title, description: p.description })),
      );
      setIsEditing(false);
    }
  }, [signal]);

  const handleModify = useCallback(() => {
    if (!signal) return;
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

  if (!signal) return null;

  // Use original signal points for display (with expectedFiles), edited points only when editing
  const displayPoints: Array<{ title: string; description: string; expectedFiles?: string[] }> = isEditing
    ? editedPoints
    : signal.planPoints.map((p) => ({ title: p.title, description: p.description, expectedFiles: p.expectedFiles }));

  return (
    <DialogRoot
      open={open}
      onOpenChange={(isOpen) => {
        if (!isOpen) {
          onReject();
        }
      }}
    >
      <Dialog className="w-[560px] max-h-[80vh] flex flex-col" showCloseButton={false}>
        <div className="p-6 bg-white dark:bg-gray-950 relative z-10 flex flex-col max-h-[80vh]">
          <DialogTitle className="flex items-center gap-2">
            <div className="i-ph:list-checks h-5 w-5 text-amplify-elements-buttonPrimaryColor" />
            Review Plan
          </DialogTitle>
          <DialogDescription className="mt-1 line-clamp-2">{signal.taskDescription}</DialogDescription>

          {/* Plan points list */}
          <div className="mt-4 flex-1 overflow-y-auto scrollbar-thin scrollbar-thumb-rounded scrollbar-thumb-amplify-elements-bg-depth-3 pr-1">
            <div className="space-y-3">
              {displayPoints.map((point, index) => (
                <div
                  key={index}
                  className="rounded-lg border border-amplify-elements-borderColor bg-amplify-elements-background-depth-2 p-3"
                >
                  <div className="flex items-start gap-2.5">
                    {/* Step number */}
                    <div className="flex-shrink-0 flex items-center justify-center w-6 h-6 rounded-full bg-amplify-elements-item-backgroundAccent text-amplify-elements-item-contentAccent text-xs font-bold mt-0.5">
                      {index + 1}
                    </div>

                    <div className="flex-1 min-w-0 space-y-1.5">
                      {isEditing ? (
                        <>
                          <input
                            type="text"
                            value={point.title}
                            onChange={(e) => handlePointTitleChange(index, e.target.value)}
                            className="w-full text-sm font-medium bg-transparent border border-amplify-elements-borderColor rounded px-2 py-1 text-gray-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-amplify-elements-buttonPrimaryColor"
                            placeholder="Step title"
                          />
                          <textarea
                            value={point.description}
                            onChange={(e) => handlePointDescriptionChange(index, e.target.value)}
                            rows={2}
                            className="w-full text-xs bg-transparent border border-amplify-elements-borderColor rounded px-2 py-1 text-gray-700 dark:text-gray-300 focus:outline-none focus:ring-1 focus:ring-amplify-elements-buttonPrimaryColor resize-none"
                            placeholder="Step description"
                          />
                        </>
                      ) : (
                        <>
                          <div className="text-sm font-medium text-gray-900 dark:text-white">
                            {point.title}
                          </div>
                          <p className="text-xs text-gray-600 dark:text-gray-400 leading-relaxed">
                            {point.description}
                          </p>
                          {point.expectedFiles && point.expectedFiles.length > 0 && (
                            <div className="flex flex-wrap gap-1 mt-1.5">
                              {point.expectedFiles.map((file) => (
                                <span
                                  key={file}
                                  className="inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-mono bg-gray-100 dark:bg-gray-800 text-gray-500 dark:text-gray-400"
                                >
                                  <div className="i-ph:file h-3 w-3" />
                                  {file}
                                </span>
                              ))}
                            </div>
                          )}
                        </>
                      )}
                    </div>
                  </div>
                </div>
              ))}
            </div>
          </div>

          {/* Action buttons */}
          <div className="flex items-center justify-between mt-4 pt-4 border-t border-amplify-elements-borderColor">
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
                className={classNames(
                  'px-4 py-2 rounded-lg text-sm transition-colors',
                  'bg-transparent text-gray-600 dark:text-gray-400 hover:bg-gray-100 dark:hover:bg-gray-800 hover:text-gray-900 dark:hover:text-gray-100',
                )}
              >
                {isEditing ? 'Submit Changes' : 'Modify'}
              </button>
              <DialogButton type="primary" onClick={onApprove}>
                <div className="i-ph:play h-4 w-4" />
                Execute Plan
              </DialogButton>
            </div>
          </div>
        </div>
      </Dialog>
    </DialogRoot>
  );
});