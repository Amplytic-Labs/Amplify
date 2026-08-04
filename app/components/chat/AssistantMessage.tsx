import { memo, Fragment, useMemo, useEffect } from 'react';
import { Markdown } from './Markdown';
import type { JSONValue, UIMessage } from 'ai';
import Popover from '~/components/ui/Popover';
import { useSmoothStream } from '~/utils/useSmoothStream';
import { workbenchStore } from '~/lib/stores/workbench';
import { WORK_DIR } from '~/utils/constants';
import WithTooltip from '~/components/ui/Tooltip';
import type { ProviderInfo } from '~/types/model';
import type { TextUIPart, ReasoningUIPart, SourceUIPart, FileUIPart, StepStartUIPart } from '@ai-sdk/ui-utils';
import { isToolPart, getToolCallId } from '~/lib/chat/tool-parts';
import { parseThoughts, isThoughtStreaming } from '~/lib/chat/thought-parser';
import { stripAmplifyArtifacts, hasInjectTemplateCall } from '~/lib/chat/artifact-stripper';
import { stripChatName } from '~/lib/chat/chatname';
import { extractDocxArtifact } from '~/lib/chat/docx-artifact';
import { setDocxArtifact } from '~/lib/stores/docx-artifact';
import { setPendingDocx } from '~/lib/stores/pending-docx-artifacts';
import { chatId as chatIdAtom } from '~/lib/persistence/useChatHistory';
import { ThoughtsPanel } from './copilot/ThoughtsPanel';
import { AnswerActions } from './copilot/AnswerActions';
import { InlineToolRow } from './copilot/InlineToolRow';
import { TextSegment } from './copilot/TextSegment';
import { splitPartsIntoSegments, hasChainSegment, collectAllToolParts, getActiveChainLabel } from '~/lib/chat/chain-segments';

interface AssistantMessageProps {
  content: string;
  annotations?: JSONValue[];
  messageId?: string;
  onRewind?: (messageId: string) => void;
  onFork?: (messageId: string) => void;
  append?: (message: UIMessage) => void;

  /** Regenerate (retry) this assistant answer. Passed through to AnswerActions. */
  onRegenerate?: () => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  parts: (TextUIPart | ReasoningUIPart | SourceUIPart | FileUIPart | StepStartUIPart | any)[] | undefined;
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
    onRegenerate,
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
     * Strip the one-shot `<chatname>…</chatname>` naming tag from the
     * streamed content BEFORE any parsing/rendering. The tag is a hidden
     * signal consumed by `useChatHistory` to name the chat — the user must
     * never see it. Streaming-safe: an unclosed `<chatname>` (still
     * streaming) is also dropped so no partial name leaks to the UI.
     */
    const visibleContent = useMemo(() => stripChatName(content), [content]);

    /*
     * Parse `<thought>` tags out of the streamed content. The answer text
     * (everything outside the tags) feeds the typewriter + markdown body;
     * the thought text feeds the collapsible panel. Re-runs every tick
     * during streaming — cheap (a single indexOf scan).
     */
    const {
      thoughtText,
      answerText: rawAnswerText,
      hasThoughts,
    } = useMemo(() => parseThoughts(visibleContent), [visibleContent]);
    const thoughtStreaming = useMemo(() => isThoughtStreaming(visibleContent), [visibleContent]);

    /*
     * Native reasoning + tool-invocation parts from the AI SDK. These are
     * interleaved with the `<thought>`-tag text inside the panel.
     *
     * v7 note: tool parts have `type: 'tool-<name>'` / `'dynamic-tool'`
     * (NOT the v4 literal `'tool-invocation'`). We use the shared
     * `isToolPart` helper which accepts both v7 and legacy v4 shapes so
     * old persisted messages still render.
     */
    /*
     * Legacy flat filter — used ONLY by the legacy render path (models that
     * emit `<thought>` tags). The new segment-based render path uses
     * `segments` (computed below) instead, which preserves the position of
     * text parts so chains break correctly on intermediate text responses.
     */
    const reasoningAndToolParts = useMemo(() => {
      if (!parts) {
        return undefined;
      }

      const filtered = parts.filter((p) => p.type === 'reasoning' || isToolPart(p));

      return filtered.length > 0 ? filtered : undefined;
    }, [parts]);

    /*
     * NEW segment-based decomposition — walks `parts` in stream order and
     * splits them into chain / tools / text segments. A `text` part BREAKS
     * the current chain, so a normal response that arrives between two
     * reasoning/tool bursts renders in its correct position (between two
     * separate chain panels) instead of being concatenated below one big
     * chain.
     *
     * Only used when `hasThoughts` is false (i.e. the model is NOT using
     * `<thought>` tags). Models that use `<thought>` tags take the legacy
     * path because their reasoning is embedded in text and needs the
     * `parseThoughts` extractor — splitting text into segments would break
     * that extraction.
     */
    const segments = useMemo(() => splitPartsIntoSegments(parts), [parts]);

    /*
     * Use the new segment-based renderer when:
     *   - The model did NOT emit `<thought>` tags (`!hasThoughts`), AND
     *   - We have stream-ordered `parts` to work with (`segments` is defined).
     *
     * Otherwise fall back to the legacy single-panel + single-markdown
     * renderer (which correctly handles `<thought>`-tag models and the
     * no-parts legacy `content` string path).
     */
    const useSegmentRenderer = !hasThoughts && segments !== undefined;

    /*
     * FIX: When native reasoning parts exist (parts[].type === 'reasoning')
     * AND the answerText is empty, the model put its entire user-facing
     * response in the native reasoning channel. The <thought> tag parser
     * stripped everything, leaving no answer text. In this case, use the
     * full visibleContent as the answer — the ThoughtsPanel already
     * renders the reasoning from the native parts, so the text parts
     * should contain the actual answer, not more reasoning.
     */
    const hasNativeReasoning = reasoningAndToolParts?.some((p) => p.type === 'reasoning') ?? false;

    /*
     * SEVER the template-injected artifact trace-tree from the chat while
     * keeping AI-created artifact trace trees visible.
     *
     * Two-layer stripping:
     *   1. `stripAmplifyArtifacts` removes raw `<amplifyArtifact>…</amplifyArtifact>`
     *      XML blocks (the model's original text, still present before the
     *      message parser runs on it).
     *   2. When the message contains an `inject_template` tool call, we also
     *      strip ONLY the `<div class="__amplifyArtifact__" data-type="template">`
     *      placeholder elements. Template artifacts use `type="template"`
     *      (set in selectStarterTemplate.ts), while normal AI-created artifacts
     *      use `type="bundled"`. The parser propagates the type attribute onto
     *      the div as `data-type`, so we can selectively strip.
     *
     * Result: "Created 50 files" / "Ran 1 command" trace trees from the
     * template injection are hidden (silent scaffolding), but subsequent
     * AI-created file traces and npm start commands remain visible.
     *
     * The parser callbacks (onArtifactOpen / onActionClose) already fired
     * during `useMessageParser`, so the workbench received all files and
     * commands. The "Used inject_template" step in the thinking panel is
     * preserved (it shows what template was injected).
     */
    const isTemplateInjection = useMemo(() => hasInjectTemplateCall(parts), [parts]);

    const answerText = useMemo(() => {
      /*
       * If native reasoning parts exist and answerText is empty, the model
       * used its native reasoning channel for thinking. The <thought> tag
       * parser may have stripped the entire response. Use the full visible
       * content as the answer instead — the ThoughtsPanel already handles
       * the reasoning display from the native parts.
       */
      const effectiveRaw = !rawAnswerText && hasNativeReasoning ? visibleContent : rawAnswerText;

      const stripped = stripAmplifyArtifacts(effectiveRaw);

      if (isTemplateInjection) {
        return stripArtifactDivs(stripped);
      }

      return stripped;
    }, [rawAnswerText, hasNativeReasoning, visibleContent, isTemplateInjection]);

    /*
     * Extract a `<docxartifact>…</docxartifact>` block (if present) from the
     * answer text. The inner markdown is captured into the DocxArtifact store
     * so the Document preview panel can render it as a real .docx; the block
     * itself is stripped from the chat-visible text so it isn't shown twice.
     *
     * Streaming-safe: an unclosed `<docxartifact>` still yields its (partial)
     * inner markdown so the live preview updates as content arrives.
     */
    const {
      visibleText: docxStrippedText,
      docxMarkdown,
      streaming: docxStreaming,
      theme: docxTheme,
    } = useMemo(() => extractDocxArtifact(answerText), [answerText]);

    /*
     * Push the extracted document into the store + surface the Document panel
     * in the workbench. Latest-wins: a newer message's document replaces an
     * older one. Only acts when there's actually markdown to show.
     *
     * WORKSPACE-AWARE BEHAVIOUR:
     *   - If a workspace IS initialized for this chat (loadedProjectId is set
     *     to a real project id, not '<none>'), the docx lives alongside the
     *     project files: we open the workbench and switch to the Document
     *     view so the user sees the docx preview immediately.
     *   - If NO workspace is initialized, we DO NOT open the workbench —
     *     opening it would make the chat look like a project chat and trip
     *     workspace_guardrails. Instead, we stash the docx in the
     *     pendingDocxStore (chatId-keyed, persisted to localStorage) so it
     *     can be migrated into the workspace once one is initialized.
     *     The user can still download the docx via the answer actions /
     *     chat-level affordance — the docx artifact store is still set so
     *     a DocxPreviewPanel can be rendered on demand.
     */
    useEffect(() => {
      if (!docxMarkdown) {
        return;
      }

      /*
       * Always set the docxArtifactStore so a DocxPreviewPanel that's
       * explicitly mounted (by the user clicking a "View document" button
       * or by the workspace being opened later) has content to show.
       */
      setDocxArtifact(docxMarkdown, messageId || 'unknown', docxStreaming, docxTheme);

      const loadedProjectId = workbenchStore.loadedProjectId.get();
      const workspaceInitialized = !!loadedProjectId && loadedProjectId !== '<none>';

      if (workspaceInitialized) {
        // Workspace exists — surface the document panel immediately.
        workbenchStore.showWorkbench.set(true);
        workbenchStore.currentView.set('document');
      } else {
        /*
         * No workspace yet — park the docx in localStorage so it can be
         * migrated when a workspace is initialized in this same chat.
         */
        const currentChatId = chatIdAtom.get();

        if (currentChatId) {
          setPendingDocx(currentChatId, {
            markdown: docxMarkdown,
            messageId: messageId || 'unknown',
            theme: docxTheme,
          });
        }
      }
    }, [docxMarkdown, messageId, docxStreaming, docxTheme]);

    /*
     * Smooth-stream only the visible answer so we never animate thought chars
     * (or stripped artifact chars) — and never the docx block either.
     */
    const smoothAnswer = useSmoothStream(docxStrippedText, isStreaming, 25);

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

    /*
     * `hasPanelContent` — true when ANY chain (reasoning) segment exists.
     * In the new segment path, pure-tool segments render as inline rows
     * (NOT a panel), so they don't count toward `hasPanelContent`.
     *
     * In the legacy path, `hasThoughts` (from `<thought>` tags) OR any
     * reasoning/tool part triggers the panel.
     */
    const hasPanelContent = useSegmentRenderer
      ? hasChainSegment(segments)
      : hasThoughts || (reasoningAndToolParts && reasoningAndToolParts.length > 0);

    /*
     * Thinking is "done" when streaming has ended AND there's actual panel
     * content (reasoning text and/or tool invocations) to summarise.
     *
     * Previously this required `hasThoughts` (i.e. a closed `<thought>` tag),
     * which meant models that use NATIVE reasoning parts (no `<thought>` tag)
     * or models that only called tools never got the "Done" checkmark at the
     * end of the chain — the panel sat in the limbo "Thought process" state.
     *
     * New rule:
     *   - Not streaming (no active response)
     *   - Not mid-`<thought>` (close tag received, or no thought block at all)
     *   - Panel has content (reasoning OR tools)
     *   - All tool calls have completed (every tool part is in an output state)
     *
     * The "all tools complete" check uses the deduped parts list so a single
     * toolCallId appearing in multiple states doesn't keep the panel "active"
     * forever.
     */
    const hasPendingToolCalls = useMemo(() => {
      /*
       * In the new segment path, collect tools from ALL segments (chain +
       * standalone tools) — a pending tool in ANY segment keeps the message
       * "active".
       *
       * In the legacy path, scan `parts` directly (same as before).
       */
      const toolParts = useSegmentRenderer ? collectAllToolParts(segments) : parts;

      if (!toolParts || toolParts.length === 0) {
        return false;
      }

      /*
       * A tool call is "pending" if it's in an input state (no output yet).
       * We use the same state vocabulary as tool-parts.ts (v7 + v4 normalised).
       */
      return toolParts.some((p) => {
        if (!isToolPart(p)) {
          return false;
        }

        const state = (p as any).state || (p as any).toolInvocation?.state || '';

        return (
          state === 'input-streaming' ||
          state === 'input-available' ||
          state === 'partial' ||
          state === 'partial-call' ||
          state === 'call' ||
          state === 'approval-requested'
        );
      });
    }, [parts]);

    const thinkingDone = !isStreaming && !thoughtStreaming && hasPanelContent && !hasPendingToolCalls;

    return (
      <div className="group relative overflow-hidden w-full">
        <>
          <div className=" flex gap-2 items-center text-sm text-amplify-elements-textSecondary mb-2">
            {(codeContext || chatSummary) && (
              <Popover side="right" align="start" trigger={<div className="i-ph:info" />}>
                {chatSummary && (
                  <div className="max-w-chat">
                    <div className="summary max-h-96 flex flex-col">
                      <h2 className="border border-amplify-elements-borderColor rounded-md p4">Summary</h2>
                      <div style={{ zoom: 0.7 }} className="overflow-y-auto m4">
                        <Markdown>{chatSummary}</Markdown>
                      </div>
                    </div>
                    {codeContext && (
                      <div className="code-context flex flex-col p4 border border-amplify-elements-borderColor rounded-md">
                        <h2>Context</h2>
                        <div className="flex gap-4 mt-4 amplify" style={{ zoom: 0.6 }}>
                          {codeContext.map((x) => {
                            const normalized = normalizedFilePath(x);
                            return (
                              <Fragment key={normalized}>
                                <code
                                  className="bg-amplify-elements-artifacts-inlineCode-background text-amplify-elements-artifacts-inlineCode-text px-1.5 py-1 rounded-md text-amplify-elements-item-contentAccent hover:underline cursor-pointer"
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
                        className="bg-transparent i-ph:arrow-u-up-left text-xl text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors"
                      />
                    </WithTooltip>
                  )}
                  {onFork && (
                    <WithTooltip tooltip="Fork chat from this message">
                      <button
                        onClick={() => onFork(messageId)}
                        key="i-ph:git-fork"
                        className="bg-transparent i-ph:git-fork text-xl text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary transition-colors"
                      />
                    </WithTooltip>
                  )}
                </div>
              )}
            </div>
          </div>
        </>

        {/*
         * ====================================================================
         * RENDER PATH — segment-based (new) vs legacy single-panel
         * ====================================================================
         *
         * SEGMENT-BASED PATH (when the model did NOT emit `<thought>` tags):
         *
         *   Walks `segments` in stream order. Each segment renders in its
         *   correct position relative to the others:
         *
         *     chain  → <ThoughtsPanel> ("Thought for Ns" / "Completed with N steps"
         *              / tool-name-while-streaming collapsible). Renders for ANY
         *              consecutive non-text run (tools-only OR tools+reasoning OR
         *              reasoning-only) — UNLESS the run is sandwiched between
         *              two text segments, in which case it becomes `tools`.
         *              While streaming, the header shows the current tool's
         *              pending label (e.g. "Searching the web") via activeLabel,
         *              or "Thinking…" if only reasoning is streaming.
         *     tools  → flat list of <InlineToolRow> rows. ONLY used for runs
         *              sandwiched between two text segments. NO card, NO
         *              "Thought for Ns" header. Same visual as a tool step
         *              inside the chain, just without the chain line.
         *     text   → <TextSegment> (per-segment typewriter + Markdown)
         *
         *   A `text` segment BREAKS the chain — the next `chain`/`tools`
         *   segment starts a fresh panel/inline group, exactly like the
         *   user wanted. Intermediate chains are marked `thinkingDone=true`
         *   so they show the "Done" checkmark immediately (the model already
         *   moved on to text). Only the LAST chain segment respects the
         *   global `thinkingDone` / `isStreaming` flags.
         *
         *   Intermediate `text` segments snap immediately (their typewriter
         *   gets `isStreaming=false`); only the LAST text segment typewriters.
         *
         * LEGACY PATH (when the model uses `<thought>` tags, OR when `parts`
         * is undefined and we only have a `content` string):
         *
         *   Single <ThoughtsPanel> (with `thoughtText` from `<thought>` tags)
         *   followed by a single <Markdown> with the concatenated
         *   `smoothAnswer`. This preserves the existing behavior for
         *   `<thought>`-tag models — splitting their text into segments
         *   would break the `parseThoughts` extractor.
         * ====================================================================
         */}
        {useSegmentRenderer && segments ? (
          <SegmentRenderer
            segments={segments}
            isStreaming={isStreaming}
            thinkingDone={thinkingDone}
            addToolResult={addToolResult}
            append={append}
            chatMode={chatMode}
            setChatMode={setChatMode}
            model={model}
            provider={provider}
            isTemplateInjection={isTemplateInjection}
          />
        ) : (
          <>
            {hasPanelContent && (
              <ThoughtsPanel
                thoughtText={thoughtText}
                thoughtStreaming={thoughtStreaming}
                thinkingDone={thinkingDone}
                parts={reasoningAndToolParts}
                isStreaming={isStreaming}
                addToolResult={addToolResult}
              />
            )}

            <Markdown
              append={append}
              chatMode={chatMode}
              setChatMode={setChatMode}
              model={model}
              provider={provider}
              html
            >
              {smoothAnswer}
            </Markdown>
          </>
        )}

        {/*
         * Copilot-style hover action bar: 👍 👎 | 📋 ↻ 🔊 + token-usage pill.
         * Hidden while streaming; fades in on group-hover.
         */}
        <AnswerActions content={visibleContent} usage={usage} isStreaming={isStreaming} onRegenerate={onRegenerate} />
      </div>
    );
  },
);

AssistantMessage.displayName = 'AssistantMessage';

/**
 * Strip a `<docxartifact>…</docxartifact>` block (and the surrounding
 * amplify artifact XML) from a single text segment so it doesn't render
 * as raw markdown. The extracted markdown is captured separately by the
 * global `extractDocxArtifact(answerText)` call in AssistantMessage and
 * pushed to the docx store — this per-segment strip is purely for
 * rendering, so the user doesn't see the raw `<docxartifact>` tags inline.
 *
 * Also strips `<amplifyArtifact>` XML blocks and template-injection div
 * placeholders, mirroring the legacy `answerText` pipeline.
 */
function stripTextSegment(text: string, isTemplateInjection: boolean): string {
  if (!text) {
    return '';
  }

  let out = stripAmplifyArtifacts(text);

  if (isTemplateInjection) {
    out = stripArtifactDivs(out);
  }

  /*
   * Strip `<docxartifact>` block for rendering. The global docx store
   * update happens separately via `extractDocxArtifact(answerText)` in
   * AssistantMessage — we only need to hide the raw tags here.
   */
  const { visibleText } = extractDocxArtifact(out);

  return visibleText;
}

/**
 * Segment-based renderer — walks `segments` in stream order and renders
 * each one in its correct position.
 *
 * Extracted as a separate memoized component so:
 *   1. React can reconcile segment children efficiently across re-renders
 *      (stable keys per segment index).
 *   2. The segment map doesn't re-run when unrelated props (annotations,
 *      chatSummary, etc.) change.
 *
 * See the big comment block in AssistantMessage for the full design.
 */
interface SegmentRendererProps {
  segments: NonNullable<ReturnType<typeof splitPartsIntoSegments>>;
  isStreaming?: boolean;
  thinkingDone?: boolean;
  addToolResult: ({ toolCallId, result }: { toolCallId: string; result: any }) => void;
  append?: (message: UIMessage) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
  isTemplateInjection: boolean;
}

const SegmentRenderer = memo(
  ({
    segments,
    isStreaming,
    thinkingDone,
    addToolResult,
    append,
    chatMode,
    setChatMode,
    model,
    provider,
    isTemplateInjection,
  }: SegmentRendererProps) => {
    /*
     * Index of the last segment — used to decide which segment is "active"
     * (gets `isStreaming=true` / `thinkingDone=global`) vs "completed"
     * (gets `isStreaming=false` / `thinkingDone=true` so it shows "Done"
     * immediately).
     */
    const lastIdx = segments.length - 1;

    return (
      <>
        {segments.map((seg, idx) => {
          const isLast = idx === lastIdx;

          if (seg.kind === 'chain') {
            /*
             * Collapsible "Thought for Ns" panel — only rendered when the
             * segment contains at least one reasoning part (the splitter
             * guarantees this, but we double-check defensively).
             *
             * `thoughtText` is empty here — the new path is only used when
             * `hasThoughts` is false, so there's no `<thought>`-tag text
             * to feed the panel. Reasoning comes from native `reasoning`
             * parts in `seg.parts`.
             *
             * `activeLabel` — when this segment is the LAST one and the
             * message is still streaming, compute a context-aware label
             * (e.g. "Searching the web" if a tool is pending, "Thinking…"
             * if only reasoning is streaming). This replaces the generic
             * "Thinking…" placeholder so the user sees WHAT is happening.
             * Intermediate (already-completed) segments don't need an
             * active label — they show "Completed with N steps".
             */
            const segmentIsStreaming = isLast ? Boolean(isStreaming) : false;
            const activeLabel = getActiveChainLabel(seg, segmentIsStreaming) ?? undefined;

            return (
              <ThoughtsPanel
                key={`seg-${idx}`}
                thoughtText=""
                thoughtStreaming={false}
                thinkingDone={isLast ? thinkingDone : true}
                parts={seg.parts}
                isStreaming={isLast ? isStreaming : false}
                addToolResult={addToolResult}
                activeLabel={activeLabel}
              />
            );
          }

          if (seg.kind === 'tools') {
            /*
             * Flat inline tool rows — NO card, NO "Thought for Ns" header.
             * Each tool renders as `[tool-type-icon] [ToolProgress row]`,
             * matching the visual of a tool step inside the chain but
             * without the chain line.
             *
             * Used for: non-reasoning models (tool-only segments) AND for
             * tool calls that follow a normal text response (the user's
             * "tool usage after normal response" concern).
             */
            return (
              <div key={`seg-${idx}`} className="flex flex-col">
                {seg.parts.map((part, j) => {
                  const id = getToolCallId(part) ?? `${idx}-${j}`;
                  return <InlineToolRow key={`tool-${id}`} part={part} addToolResult={addToolResult} />;
                })}
              </div>
            );
          }

          /*
           * Text segment — per-segment typewriter via <TextSegment>.
           *
           * Intermediate segments get `isStreaming=false` so they snap
           * immediately (their text is already complete — a later segment
           * started after them). The last segment gets `isStreaming` so
           * it typewriters as new chars arrive.
           */
          const stripped = stripTextSegment(seg.text, isTemplateInjection);

          if (!stripped) {
            // Stripping removed everything (e.g. only a docxartifact block) — skip.
            return null;
          }

          return (
            <TextSegment
              key={`seg-${idx}`}
              text={stripped}
              isStreaming={isLast ? isStreaming : false}
              append={append}
              chatMode={chatMode}
              setChatMode={setChatMode}
              model={model}
              provider={provider}
            />
          );
        })}
      </>
    );
  },
);

SegmentRenderer.displayName = 'SegmentRenderer';

/**
 * Remove `<div class="__amplifyArtifact__" data-type="template" …></div>` placeholder
 * elements that the message parser inserts for template-injected artifacts.
 *
 * The parser (`StreamingMessageParser.createArtifactElement`) now propagates
 * the `<amplifyArtifact type="…">` attribute onto the div as `data-type`. Template
 * artifacts (from `inject_template`) use `type="template"`, while normal AI-
 * created artifacts use `type="bundled"`.
 *
 * We ONLY strip divs with `data-type="template"` so AI-created file trace
 * trees and shell command trace trees remain visible in the chat.
 *
 * The regex matches both self-closing and paired forms, and relies on the
 * deterministic attribute order produced by `createArtifactElement`
 * (class → messageId → artifactId → type).
 */
function stripArtifactDivs(text: string): string {
  if (!text || !text.includes('__amplifyArtifact__')) {
    return text;
  }

  // Self-closing form: <div class="__amplifyArtifact__" ... data-type="template"></div>
  let out = text.replace(/<div\s+class="__amplifyArtifact__"[^>]*data-type="template"[^>]*><\/div>/g, '');

  // Void-element form: <div class="__amplifyArtifact__" ... data-type="template" />
  out = out.replace(/<div\s+class="__amplifyArtifact__"[^>]*data-type="template"[^>]*\/>/g, '');

  // Collapse blank lines left behind.
  out = out.replace(/\n{3,}/g, '\n\n').trimEnd();

  return out;
}
