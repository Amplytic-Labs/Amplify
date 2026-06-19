import { memo, Fragment, useMemo } from 'react';
import { Markdown } from './Markdown';
import type { JSONValue } from 'ai';
import Popover from '~/components/ui/Popover';
import { useSmoothStream } from '~/utils/useSmoothStream';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import WithTooltip from '~/components/ui/Tooltip';
import type { Message } from 'ai';
import type { ProviderInfo } from '~/types/model';
import type {
  TextUIPart,
  ReasoningUIPart,
  ToolInvocationUIPart,
  SourceUIPart,
  FileUIPart,
  StepStartUIPart,
} from '@ai-sdk/ui-utils';
import { ThoughtProcess } from './ThoughtProcess';

interface AssistantMessageProps {
  content: string;
  annotations?: JSONValue[];
  messageId?: string;
  onRewind?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  append?: (message: Message) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  parts:
    | (TextUIPart | ReasoningUIPart | ToolInvocationUIPart | SourceUIPart | FileUIPart | StepStartUIPart)[]
    | undefined;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  isStreaming?: boolean;
}

function openArtifactInWorkbench(filePath: string) {
  filePath = normalizedFilePath(filePath);

  if (workbenchStore.currentView.get() !== 'code') {
    workbenchStore.currentView.set('code');
  }

  workbenchStore.setSelectedFile(`${WORK_DIR}/${filePath}`);
}

function normalizedFilePath(path: string) {
  let normalizedPath = path;

  if (normalizedPath.startsWith(WORK_DIR)) {
    normalizedPath = path.replace(WORK_DIR, '');
  }

  if (normalizedPath.startsWith('/')) {
    normalizedPath = normalizedPath.slice(1);
  }

  return normalizedPath;
}

/**
 * Strip any residual `<thought>...</thought>` tags from the visible
 * markdown content. The system prompt instructs the AI to use its
 * native reasoning channel (which arrives as `parts[].type ===
 * 'reasoning'`) instead of emitting `<thought>` tags into the
 * response text — but we keep this defensive filter so a misbehaving
 * model cannot accidentally render stray thought blocks inside the
 * final answer.
 *
 * Handles three cases:
 *   1. Complete `<thought>…</thought>` blocks → removed entirely
 *   2. Streaming `<thought>…` (no closing tag yet) → removed
 *   3. Orphan `</thought>` → removed
 */
function stripResidualThoughtTags(content: string): string {
  if (!content || !content.includes('<thought>') && !content.includes('</thought>')) {
    return content;
  }

  let out = content;

  // 1. Complete blocks
  out = out.replace(/<thought>[\s\S]*?<\/thought>/g, '');

  // 2. Streaming-open block (no closing tag yet)
  out = out.replace(/<thought>[\s\S]*$/g, '');

  // 3. Orphan closing tag
  out = out.replace(/<\/thought>/g, '');

  // Tidy up any leading whitespace left behind so the first paragraph
  // of the real answer doesn't get pushed down by an empty line.
  return out.replace(/^\s+/, '');
}

export const AssistantMessage = memo(
  ({
    content,
    annotations,
    messageId,
    onRewind,
    onFork,
    append,
    chatMode,
    setChatMode,
    model,
    provider,
    parts,
    addToolResult,
    isStreaming,
  }: AssistantMessageProps) => {
    const filteredAnnotations = (annotations?.filter(
      (annotation: JSONValue) =>
        annotation && typeof annotation === 'object' && Object.keys(annotation).includes('type'),
    ) || []) as { type: string; value: any } & { [key: string]: any }[];

    // Strip residual thought tags BEFORE smooth-stream so the typewriter
    // effect doesn't waste cycles animating characters we'll hide anyway.
    const cleanedContent = useMemo(() => stripResidualThoughtTags(content), [content]);
    const smoothContent = useSmoothStream(cleanedContent, isStreaming, 25);

    let chatSummary: string | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
      chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
    }

    let codeContext: string[] | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'codeContext')) {
      codeContext = filteredAnnotations.find((annotation) => annotation.type === 'codeContext')?.files;
    }

    /**
     * Collect every "thought" part — reasoning + tool invocations —
     * for the single Copilot-style collapsible at the top. Text parts
     * are NOT included here because they belong to the final answer
     * (rendered below the collapsible).
     *
     * Tool approval is handled inline by ToolInvocationChip via
     * `addToolResult` — the legacy toolCallAnnotations flow is no
     * longer consumed by this component.
     */
    const thoughtParts = useMemo(() => {
      if (!parts) {
        return [];
      }

      return parts.filter(
        (p) => p.type === 'reasoning' || p.type === 'tool-invocation',
      ) as (ReasoningUIPart | ToolInvocationUIPart)[];
    }, [parts]);

    const hasThoughtContent = thoughtParts.length > 0;

    return (
      <div className="group relative overflow-hidden w-full">
        <>
          <div className=" flex gap-2 items-center text-sm text-bolt-elements-textSecondary mb-2">
            {(codeContext || chatSummary) && (
              <Popover side="right" align="start" trigger={<div className="i-ph:info" />}>
                {chatSummary && (
                  <div className="max-w-chat">
                    <div className="summary max-h-96 flex flex-col">
                      <h2 className="border border-bolt-elements-borderColor rounded-md p4">Summary</h2>
                      <div style={{ zoom: 0.7 }} className="overflow-y-auto m4">
                        <Markdown>{chatSummary}</Markdown>
                      </div>
                    </div>
                    {codeContext && (
                      <div className="code-context flex flex-col p4 border border-bolt-elements-borderColor rounded-md">
                        <h2>Context</h2>
                        <div className="flex gap-4 mt-4 bolt" style={{ zoom: 0.6 }}>
                          {codeContext.map((x) => {
                            const normalized = normalizedFilePath(x);
                            return (
                              <Fragment key={normalized}>
                                <code
                                  className="bg-bolt-elements-artifacts-inlineCode-background text-bolt-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-bolt-elements-item-contentAccent hover:underline cursor-pointer"
                                  onClick={(e) => {
                                    e.preventDefault();
                                    e.stopPropagation();
                                    openArtifactInWorkbench(normalized);
                                  }}
                                >
                                  {normalized}
                                </code>
                              </Fragment>
                            );
                          })}
                        </div>
                      </div>
                    )}
                  </div>
                )}
                <div className="context"></div>
              </Popover>
            )}
            <div className="flex w-full items-center justify-between">
              {(onRewind || onFork) && messageId && (
                <div className="flex gap-2 flex-col lg:flex-row ml-auto">
                  {onRewind && (
                    <WithTooltip tooltip="Revert to this message">
                      <button
                        onClick={() => onRewind(messageId)}
                        key="i-ph:arrow-u-up-left"
                        className="i-ph:arrow-u-up-left text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
                      />
                    </WithTooltip>
                  )}
                  {onFork && (
                    <WithTooltip tooltip="Fork chat from this message">
                      <button
                        onClick={() => onFork(messageId)}
                        key="i-ph:git-fork"
                        className="i-ph:git-fork text-xl text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
                      />
                    </WithTooltip>
                  )}
                </div>
              )}
            </div>
          </div>
        </>

        {/*
         * ONE single Copilot-style "Thought for Ns" collapsible.
         * Contains ALL reasoning segments + ALL tool invocations as
         * interleaved steps. Renders ABOVE the final answer markdown.
         * The collapsible auto-collapses when streaming finishes
         * (handled by the Reasoning component).
         */}
        {hasThoughtContent && (
          <ThoughtProcess
            parts={thoughtParts}
            isStreaming={isStreaming}
            addToolResult={addToolResult}
          />
        )}

        {/*
         * Final answer markdown — the user-facing response. Renders
         * BELOW the thought panel, exactly like VSCode Copilot's
         * "answer" area.
         */}
        <Markdown append={append} chatMode={chatMode} setChatMode={setChatMode} model={model} provider={provider} html>
          {smoothContent}
        </Markdown>

        <div className="flex justify-start mt-2 opacity-0 group-hover:opacity-100 transition-opacity">
          <WithTooltip tooltip="Copy raw markdown">
            <button
              onClick={() => navigator.clipboard.writeText(content)}
              className="p-1.5 rounded-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor text-bolt-elements-textSecondary hover:text-bolt-elements-textPrimary transition-colors"
            >
              <div className="i-ph:copy text-sm" />
            </button>
          </WithTooltip>
        </div>
      </div>
    );
  },
);
