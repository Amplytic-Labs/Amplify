import { memo, useCallback, useEffect, useState } from 'react';
import { classNames } from '~/utils/classNames';
import WithTooltip from '~/components/ui/Tooltip';

/**
 * Token usage info extracted from the `usage` message annotation written by
 * api.chat.ts on response completion.
 */
interface TokenUsage {
  completionTokens?: number;
  promptTokens?: number;
  totalTokens?: number;
}

interface AnswerActionsProps {
  /** Raw markdown of the answer (for copy). */
  content: string;

  /** Optional regenerate handler — only the last message receives this. */
  onRegenerate?: () => void;

  /** Token usage from the `usage` annotation, if present. */
  usage?: TokenUsage;

  /** Hide actions while streaming (Copilot only shows them on completion). */
  isStreaming?: boolean;
}

type Feedback = 'up' | 'down' | null;

/**
 * Copilot-style hover action bar rendered beneath the assistant answer.
 *
 * Actions (left → right):
 *   - 👍 / 👎  Thumbs up / down (local feedback state, no backend round-trip)
 *   - 📋 Copy  (copies raw markdown, shows "Copied!" for 1.5s)
 *   - ↻ Retry  (regenerate — only when onRegenerate is provided)
 *   - 🔊 Read aloud (Web Speech API; toggles stop when active)
 *
 * Plus an optional token-usage pill on the right (e.g. "1.2k tokens").
 *
 * The whole bar is hidden while streaming and fades in on group-hover or focus,
 * matching VS Code Copilot's behaviour.
 */
export const AnswerActions = memo(({ content, onRegenerate, usage, isStreaming }: AnswerActionsProps) => {
  const [copied, setCopied] = useState(false);
  const [feedback, setFeedback] = useState<Feedback>(null);
  const [speaking, setSpeaking] = useState(false);

  // Stop speech if the component unmounts (e.g. message scrolled away).
  useEffect(() => {
    return () => {
      if (typeof window !== 'undefined' && 'speechSynthesis' in window) {
        window.speechSynthesis.cancel();
      }
    };
  }, []);

  const handleCopy = useCallback(async () => {
    try {
      await navigator.clipboard.writeText(content);
      setCopied(true);
      setTimeout(() => setCopied(false), 1500);
    } catch {
      /* clipboard may be unavailable (permissions) — silently ignore */
    }
  }, [content]);

  const handleFeedback = useCallback((value: Feedback) => {
    setFeedback((prev) => (prev === value ? null : value));
  }, []);

  const handleSpeak = useCallback(() => {
    if (typeof window === 'undefined' || !('speechSynthesis' in window)) {
      return;
    }

    if (speaking) {
      window.speechSynthesis.cancel();
      setSpeaking(false);

      return;
    }

    // Strip markdown noise for cleaner speech: code fences, images, HTML tags.
    const clean = content
      .replace(/```[\s\S]*?```/g, ' code block ')
      .replace(/`[^`]+`/g, ' ')
      .replace(/!\[[^\]]*\]\([^)]*\)/g, ' ')
      .replace(/\[([^\]]+)\]\([^)]*\)/g, '$1')
      .replace(/<[^>]+>/g, ' ')
      .replace(/[#*_>~|-]/g, ' ')
      .replace(/\s+/g, ' ')
      .trim();

    const utterance = new SpeechSynthesisUtterance(clean);
    utterance.rate = 1.05;
    utterance.onend = () => setSpeaking(false);
    utterance.onerror = () => setSpeaking(false);
    window.speechSynthesis.cancel();
    window.speechSynthesis.speak(utterance);
    setSpeaking(true);
  }, [content, speaking]);

  const formatTokens = (n?: number) => {
    if (!n) {
      return null;
    }

    if (n < 1000) {
      return `${n}`;
    }

    return `${(n / 1000).toFixed(1)}k`;
  };

  const tokenLabel = usage ? formatTokens(usage.totalTokens) : null;

  return (
    <div
      className={classNames(
        'flex items-center gap-0.5 mt-2 transition-opacity duration-150',
        isStreaming
          ? 'opacity-0 pointer-events-none'
          : 'opacity-0 group-hover:opacity-100 group-focus-within:opacity-100',
      )}
    >
      {/* Thumbs up */}
      <ActionButton
        label={feedback === 'up' ? 'Helpful response' : 'Helpful response'}
        active={feedback === 'up'}
        onClick={() => handleFeedback('up')}
      >
        <span
          className={classNames('i-ph:thumbs-up text-sm', feedback === 'up' && 'text-bolt-elements-icon-success')}
        />
      </ActionButton>

      {/* Thumbs down */}
      <ActionButton
        label={feedback === 'down' ? 'Not helpful' : 'Not helpful response'}
        active={feedback === 'down'}
        onClick={() => handleFeedback('down')}
      >
        <span
          className={classNames('i-ph:thumbs-down text-sm', feedback === 'down' && 'text-bolt-elements-icon-error')}
        />
      </ActionButton>

      <Divider />

      {/* Copy */}
      <ActionButton label={copied ? 'Copied!' : 'Copy'} active={copied} onClick={handleCopy}>
        <span className={classNames(copied ? 'i-ph:check' : 'i-ph:copy', 'text-sm')} />
      </ActionButton>

      {/* Regenerate */}
      {onRegenerate && (
        <ActionButton label="Regenerate" onClick={onRegenerate}>
          <span className="i-ph:arrow-counter-clockwise text-sm" />
        </ActionButton>
      )}

      {/* Read aloud */}
      <ActionButton label={speaking ? 'Stop reading' : 'Read aloud'} active={speaking} onClick={handleSpeak}>
        <span className={classNames(speaking ? 'i-ph:stop-circle' : 'i-ph:speaker-high', 'text-sm')} />
      </ActionButton>

      {/* Token usage pill (right-aligned) */}
      {tokenLabel && (
        <>
          <div className="ml-auto" />
          <span
            className="flex items-center gap-1 text-[11px] text-bolt-elements-textTertiary px-1.5 py-0.5 rounded-md bg-bolt-elements-background-depth-2 border border-bolt-elements-borderColor/60 font-mono"
            title={`Prompt: ${usage?.promptTokens ?? 0} · Completion: ${usage?.completionTokens ?? 0}`}
          >
            <span className="i-ph:cpu text-[10px]" />
            {tokenLabel} tokens
          </span>
        </>
      )}
    </div>
  );
});

AnswerActions.displayName = 'AnswerActions';

/* ---------------------------------------------------------------- helpers */

interface ActionButtonProps {
  label: string;
  active?: boolean;
  onClick: () => void;
  children: React.ReactNode;
}

const ActionButton = memo(({ label, active, onClick, children }: ActionButtonProps) => {
  return (
    <WithTooltip tooltip={label}>
      <button
        type="button"
        onClick={onClick}
        aria-label={label}
        aria-pressed={active}
        className={classNames(
          'p-1.5 rounded-md transition-colors cursor-pointer',
          'text-bolt-elements-textTertiary hover:text-bolt-elements-textPrimary hover:bg-bolt-elements-background-depth-2',
          active && 'text-bolt-elements-textPrimary bg-bolt-elements-background-depth-2',
        )}
      >
        {children}
      </button>
    </WithTooltip>
  );
});

ActionButton.displayName = 'ActionButton';

const Divider = memo(() => <span className="w-px h-4 bg-bolt-elements-borderColor/60 mx-0.5" />);
Divider.displayName = 'Divider';
