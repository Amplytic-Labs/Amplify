import { memo } from 'react';
import { useSmoothStream } from '~/utils/useSmoothStream';
import { Markdown } from '~/components/chat/Markdown';
import type { UIMessage } from 'ai';
import type { ProviderInfo } from '~/types/model';

/**
 * Per-segment typewriter wrapper for a single `text` segment.
 *
 * WHY THIS EXISTS
 * --------------
 * Before the chain-segment refactor, AssistantMessage built ONE concatenated
 * `answerText` string from ALL text parts and ran a single `useSmoothStream`
 * over it. That meant the typewriter animated the WHOLE response as one
 * monolithic block — fine when the model emits one text block at the end,
 * but broken when text is interleaved with reasoning/tools:
 *
 *   [reasoning₁, tool₁, "partial answer", reasoning₂, tool₂, "rest"]
 *
 * The old renderer glued "partial answer" + "rest" into one string and
 * animated it as one block BELOW the single chain panel — so "partial
 * answer" appeared out of order (after the whole chain finished) and the
 * typewriter restarted from scratch every time "rest" arrived.
 *
 * With segments, each `text` segment gets its OWN typewriter instance via
 * this component. Each text block animates independently, in its correct
 * position relative to the chain/tools segments around it.
 *
 * WHY A SUB-COMPONENT
 * -------------------
 * React hooks can't be called inside a `.map()` callback. To give each
 * text segment its own `useSmoothStream` state, we need a real component
 * (not an inline arrow function) so the hook is called at the top level of
 * a component body.
 *
 * STREAMING SEMANTICS
 * -------------------
 * `isStreaming` here means "the OVERALL message is still streaming". The
 * typewriter keeps animating the LAST text segment as more chars arrive;
 * earlier text segments have already received their full text and snap
 * immediately (useSmoothStream handles this via its `text.startsWith(prev)`
 * check — when the new text doesn't start with the old, it snaps).
 */
interface TextSegmentProps {
  text: string;
  isStreaming?: boolean;
  append?: (message: UIMessage) => void;
  chatMode?: 'discuss' | 'build';
  setChatMode?: (mode: 'discuss' | 'build') => void;
  model?: string;
  provider?: ProviderInfo;
}

export const TextSegment = memo(
  ({ text, isStreaming, append, chatMode, setChatMode, model, provider }: TextSegmentProps) => {
    const smoothText = useSmoothStream(text, isStreaming, 25);

    return (
      <Markdown append={append} chatMode={chatMode} setChatMode={setChatMode} model={model} provider={provider} html>
        {smoothText}
      </Markdown>
    );
  },
);

TextSegment.displayName = 'TextSegment';
