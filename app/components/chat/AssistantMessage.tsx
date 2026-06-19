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
import { parseThoughts, isThoughtStreaming } from '~/lib/chat/thought-parser';
import { ThoughtsPanel } from './copilot/ThoughtsPanel';
import { AnswerActions } from './copilot/AnswerActions';

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
 * Assistant message — Copilot-exact layout.
 *
 *   ┌─────────────────────────────────────────────┐
 *   │ ▾ Thought for 4s                            │  ← .chat-thinking-box
 *   │   reasoning text (muted, 12px)              │     (curved connector)
 *   │   [icon] Read file  src/index.ts            │  ← .progress-container (flat, NO card)
 *   │   [icon] Edited file  src/index.ts          │  ← .progress-container (flat, NO card)
 *   │   Working…                                  │  ← shimmer while streaming
 *   ├─────────────────────────────────────────────┤
 *   │ <final answer markdown>                     │  ← .rendered-markdown (14px, 16px p-spacing)
 *   │ 👍 👎 | 📋 ↻ 🔊              1.2k tokens    │  ← hover action bar (AnswerActions)
 *   └─────────────────────────────────────────────┘
 *
 * The thought panel pulls from TWO sources:
 *   1. `<thought>…</thought>` tags the model emits in its text response
 *      (parsed streaming-safe by `parseThoughts`).
 *   2. Native AI-SDK `reasoning` parts (for models that use a dedicated
 *      reasoning channel).
 *
 * Tool invocations (from `parts`) render as flat inline `.progress-container`
 * rows inside the panel — NO CARDS. The final answer is the text OUTSIDE the
 * thought tags, smooth-streamed with a typewriter effect.
 */
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

    /*
     * Parse `<thought>` tags out of the streamed content. The answer text
     * (everything outside the tags) feeds the typewriter + markdown body;
     * the thought text feeds the collapsible panel. Re-runs every tick
     * during streaming — cheap (a single indexOf scan).
     */
    const { thoughtText, answerText, hasThoughts } = useMemo(() => parseThoughts(content), [content]);
    const thoughtStreaming = useMemo(() => isThoughtStreaming(content), [content]);

    // Smooth-stream only the visible answer so we never animate thought chars.
    const smoothAnswer = useSmoothStream(answerText, isStreaming, 25);

    let chatSummary: string | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
      chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
    }

    let codeContext: string[] | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'codeContext')) {
      codeContext = filteredAnnotations.find((annotation) => annotation.type === 'codeContext')?.files;
    }

    // Token usage from the `usage` annotation (written by api.chat.ts on completion).
    const usageAnnotation = filteredAnnotations.find((a) => a.type === 'usage') as
      | { type: 'usage'; value?: { completionTokens?: number; promptTokens?: number; totalTokens?: number } }
      | undefined;
    const usage = usageAnnotation?.value;

    /**
     * Native reasoning + tool-invocation parts from the AI SDK. These are
     * interleaved with the `<thought>`-tag text inside the panel.
     */
    const reasoningAndToolParts = useMemo(() => {
      if (!parts) {
        return undefined;
      }

      const filtered = parts.filter((p) => p.type === 'reasoning' || p.type === 'tool-invocation');

      return filtered.length > 0 ? filtered : undefined;
    }, [parts]);

    const hasPanelContent = hasThoughts || (reasoningAndToolParts && reasoningAndToolParts.length > 0);

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
         * Copilot-exact collapsible "Thought for Ns" panel (.chat-thinking-box).
         * Sits ABOVE the final answer. Contains reasoning (from <thought> tags
         * and/or native reasoning parts) plus tool invocations rendered as
         * FLAT INLINE .progress-container rows — NO CARDS.
         */}
        {hasPanelContent && (
          <ThoughtsPanel
            thoughtText={thoughtText}
            thoughtStreaming={thoughtStreaming}
            parts={reasoningAndToolParts}
            isStreaming={isStreaming}
            addToolResult={addToolResult}
          />
        )}

        {/*
         * Final answer markdown — the user-facing response. Renders BELOW the
         * thought panel, exactly like VS Code Copilot's answer area.
         * Typography: 14px base, 16px p-spacing, 1.6 line-height (matches
         * Copilot's .rendered-markdown body-m sizing).
         */}
        <Markdown append={append} chatMode={chatMode} setChatMode={setChatMode} model={model} provider={provider} html>
          {smoothAnswer}
        </Markdown>

        {/*
         * Copilot-style hover action bar: 👍 👎 | 📋 ↻ 🔊 + token-usage pill.
         * Hidden while streaming; fades in on group-hover.
         */}
        <AnswerActions content={content} usage={usage} isStreaming={isStreaming} />
      </div>
    );
  },
);

AssistantMessage.displayName = 'AssistantMessage';
