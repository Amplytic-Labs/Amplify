import { useState, useEffect, useRef } from 'react';

export function useSmoothStream(text: string, isStreaming: boolean = false, speed: number = 30) {
  const [displayedText, setDisplayedText] = useState('');
  const prevTextRef = useRef(text);

  useEffect(() => {
    /*
     * If text changed (especially from '' to content) and we're no longer
     * streaming, snap immediately — this catches the race condition where
     * isStreaming flips to false before the text content arrives in the
     * React render cycle. Without this, displayedText gets permanently
     * stuck at ''.
     */
    if (!isStreaming || !text.startsWith(displayedText)) {
      setDisplayedText(text);
      return;
    }

    if (text === displayedText) {
      return;
    }

    const diff = text.length - displayedText.length;

    // Lower speed multiplier to catch up slowly, giving a more letter-by-letter feel
    const chunkSize = Math.max(1, Math.ceil(diff / 20));

    const timer = setTimeout(() => {
      setDisplayedText((prev) => prev + text.slice(prev.length, prev.length + chunkSize));
    }, speed);

    // eslint-disable-next-line consistent-return
    return () => clearTimeout(timer);
  }, [text, displayedText, isStreaming, speed]);

  /*
   * Safety net: if text was updated (e.g. went from '' to content) but
   * displayedText is still stale, force a snap. This handles the edge case
   * where the useEffect above already ran with text='' and isStreaming=false,
   * setting displayedText='', and then text updates in a subsequent render
   * without the effect re-firing.
   */
  useEffect(() => {
    if (prevTextRef.current !== text && !isStreaming && displayedText !== text) {
      setDisplayedText(text);
    }

    prevTextRef.current = text;
  }, [text, isStreaming, displayedText]);

  return displayedText;
}
