import { useState, useEffect } from 'react';

export function useSmoothStream(text: string, isStreaming: boolean = false, speed: number = 30) {
  const [displayedText, setDisplayedText] = useState('');

  useEffect(() => {
    if (!isStreaming) {
      setDisplayedText(text);
      return;
    }

    if (text === displayedText) {
      return;
    }

    if (!text.startsWith(displayedText)) {
      setDisplayedText(text);
      return;
    }

    const diff = text.length - displayedText.length;

    // Lower speed multiplier to catch up slowly, giving a more letter-by-letter feel
    const chunkSize = Math.max(1, Math.ceil(diff / 20));

    const timer = setTimeout(() => {
      setDisplayedText((prev) => prev + text.slice(prev.length, prev.length + chunkSize));
    }, speed);

    return () => clearTimeout(timer);
  }, [text, displayedText, isStreaming, speed]);

  return displayedText;
}
