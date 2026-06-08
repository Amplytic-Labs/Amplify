import { memo, Fragment, useMemo } from 'react';
import { Markdown } from './Markdown';
import { Reasoning, ReasoningTrigger, ReasoningContent } from '~/components/ai-elements/reasoning';
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
import { ToolInvocations } from './ToolInvocations';
import { ToolInvocationItem } from './ToolInvocationItem';
import { ToolInvocationGroup } from './ToolInvocationGroup';
import { ReasoningMarkdown } from './ReasoningMarkdown';
import type { ToolCallAnnotation } from '~/types/context';

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

    const smoothContent = useSmoothStream(content, isStreaming, 25);

    let chatSummary: string | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')) {
      chatSummary = filteredAnnotations.find((annotation) => annotation.type === 'chatSummary')?.summary;
    }

    let codeContext: string[] | undefined = undefined;

    if (filteredAnnotations.find((annotation) => annotation.type === 'codeContext')) {
      codeContext = filteredAnnotations.find((annotation) => annotation.type === 'codeContext')?.files;
    }

    const toolInvocations = parts?.filter((part) => part.type === 'tool-invocation');
    const reasoningParts = parts?.filter((part) => part.type === 'reasoning') as ReasoningUIPart[];
    const toolCallAnnotations = filteredAnnotations.filter(
      (annotation) => annotation.type === 'toolCall',
    ) as ToolCallAnnotation[];

    const groupedParts = useMemo(() => {
      if (!parts) {
        return [];
      }

      const result: any[] = [];
      let currentToolGroup: ToolInvocationUIPart[] | null = null;

      for (const part of parts) {
        if (part.type === 'tool-invocation') {
          if (currentToolGroup) {
            currentToolGroup.push(part as ToolInvocationUIPart);
          } else {
            currentToolGroup = [part as ToolInvocationUIPart];
            result.push(currentToolGroup);
          }
        } else {
          if (currentToolGroup) {
            currentToolGroup = null;
          }

          result.push(part);
        }
      }

      return result;
    }, [parts]);

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
        {groupedParts && groupedParts.length > 0 && (
          <Reasoning isStreaming={isStreaming}>
            <ReasoningTrigger />
            <ReasoningContent>
              <div className="flex flex-col gap-4">
                {groupedParts.map((part, index) => {
                  if (Array.isArray(part)) {
                    return <ToolInvocationGroup key={index} parts={part} />;
                  }

                  if ((part as any).type === 'reasoning') {
                    const reasoningPart = part as ReasoningUIPart;
                    const text = reasoningPart.details
                      ? reasoningPart.details.map((d: any) => d.text || '').join('')
                      : (reasoningPart as any).textDelta || (reasoningPart as any).text || '';

                    if (!text) {
                      return null;
                    }

                    return (
                      <div key={index} className="text-sm text-bolt-elements-textSecondary leading-relaxed">
                        <ReasoningMarkdown>{text}</ReasoningMarkdown>
                      </div>
                    );
                  }

                  return null;
                })}
              </div>
            </ReasoningContent>
          </Reasoning>
        )}
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
