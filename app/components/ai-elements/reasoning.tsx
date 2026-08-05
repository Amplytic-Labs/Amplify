'use client';

import { classNames } from '~/utils/classNames';
import { BrainIcon, ChevronDownIcon, ChevronUpIcon } from 'lucide-react';
import type { HTMLAttributes, ReactNode } from 'react';
import { createContext, memo, useCallback, useContext, useEffect, useMemo, useRef, useState } from 'react';
import { motion, AnimatePresence, type HTMLMotionProps } from 'framer-motion';

import { Shimmer } from './shimmer';

interface ReasoningContextValue {
  isStreaming: boolean;
  isOpen: boolean;
  setIsOpen: (open: boolean) => void;
  duration: number | undefined;
}

const ReasoningContext = createContext<ReasoningContextValue | null>(null);

export const useReasoning = () => {
  const context = useContext(ReasoningContext);

  if (!context) {
    throw new Error('Reasoning components must be used within Reasoning');
  }

  return context;
};

export type ReasoningProps = HTMLAttributes<HTMLDivElement> & {
  isStreaming?: boolean;
  open?: boolean;
  defaultOpen?: boolean;
  onOpenChange?: (open: boolean) => void;
  duration?: number;
};

const AUTO_CLOSE_DELAY = 1000;
const MS_IN_S = 1000;

function useControllableState<T>({
  prop,
  defaultProp,
  onChange,
}: {
  prop?: T;
  defaultProp: T;
  onChange?: (state: T) => void;
}) {
  const [uncontrolledProp, setUncontrolledProp] = useState<T>(defaultProp);
  const isControlled = prop !== undefined;
  const value = isControlled ? prop : uncontrolledProp;

  const setValue = useCallback(
    (nextValue: T | ((prevValue: T) => T)) => {
      if (isControlled) {
        const setter = nextValue as (prevValue: T) => T;
        const newValue = typeof nextValue === 'function' ? setter(prop) : nextValue;

        if (newValue !== prop) {
          onChange?.(newValue);
        }
      } else {
        setUncontrolledProp(nextValue);

        const setter = nextValue as (prevValue: T) => T;
        const newValue = typeof nextValue === 'function' ? setter(uncontrolledProp) : nextValue;
        onChange?.(newValue);
      }
    },
    [isControlled, prop, uncontrolledProp, onChange],
  );

  return [value, setValue] as const;
}

export const Reasoning = memo(
  ({
    className,
    isStreaming = false,
    open,
    defaultOpen,
    onOpenChange,
    duration: durationProp,
    children,
    ...props
  }: ReasoningProps) => {
    const resolvedDefaultOpen = defaultOpen ?? false;

    const [isOpen, setIsOpen] = useControllableState<boolean>({
      defaultProp: resolvedDefaultOpen,
      onChange: onOpenChange,
      prop: open,
    });
    const [duration, setDuration] = useControllableState<number | undefined>({
      defaultProp: undefined,
      prop: durationProp,
    });

    const hasEverStreamedRef = useRef(isStreaming);
    const [hasAutoClosed, setHasAutoClosed] = useState(false);
    const startTimeRef = useRef<number | null>(null);

    useEffect(() => {
      if (isStreaming) {
        hasEverStreamedRef.current = true;

        if (startTimeRef.current === null) {
          startTimeRef.current = Date.now();
        }
      } else if (startTimeRef.current !== null) {
        setDuration(Math.ceil((Date.now() - startTimeRef.current) / MS_IN_S));
        startTimeRef.current = null;
      }
    }, [isStreaming, setDuration]);

    /*
     * Removed auto-open effect so the thinking box stays collapsed by default
     * and only opens when the user explicitly clicks to expand it.
     */

    useEffect(() => {
      if (hasEverStreamedRef.current && !isStreaming && isOpen && !hasAutoClosed) {
        const timer = setTimeout(() => {
          setIsOpen(false);
          setHasAutoClosed(true);
        }, AUTO_CLOSE_DELAY);

        return () => clearTimeout(timer);
      }
    }, [isStreaming, isOpen, setIsOpen, hasAutoClosed]);

    const contextValue = useMemo(
      () => ({ duration, isOpen, isStreaming, setIsOpen }),
      [duration, isOpen, isStreaming, setIsOpen],
    );

    return (
      <ReasoningContext.Provider value={contextValue}>
        <div className={classNames('flex flex-col mb-4', className)} {...props}>
          {children}
        </div>
      </ReasoningContext.Provider>
    );
  },
);

export type ReasoningTriggerProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  getThinkingMessage?: (isStreaming: boolean, duration?: number) => ReactNode;
};

const defaultGetThinkingMessage = (isStreaming: boolean, duration?: number) => {
  if (isStreaming || duration === 0) {
    return <Shimmer duration={1}>Thinking...</Shimmer>;
  }

  if (duration === undefined) {
    return <span>Thought for a few seconds</span>;
  }

  return <span>Thought for {duration} seconds</span>;
};

export const ReasoningTrigger = memo(
  ({
    className,
    children,
    getThinkingMessage = defaultGetThinkingMessage,
    onClick,
    ...props
  }: ReasoningTriggerProps) => {
    const { isStreaming, isOpen, duration, setIsOpen } = useReasoning();

    const handleClick = (e: React.MouseEvent<HTMLButtonElement>) => {
      setIsOpen(!isOpen);
      onClick?.(e);
    };

    return (
      <button
        type="button"
        onClick={handleClick}
        className={classNames(
          'flex items-center gap-2 text-amplify-elements-textTertiary text-sm transition-colors hover:text-amplify-elements-textPrimary bg-transparent border-none p-0 cursor-pointer',
          className,
        )}
        {...props}
      >
        {children ?? (
          <>
            <BrainIcon className="size-4" />
            {getThinkingMessage(isStreaming, duration)}
            {isOpen ? <ChevronUpIcon className="size-4" /> : <ChevronDownIcon className="size-4" />}
          </>
        )}
      </button>
    );
  },
);

export type ReasoningContentProps = HTMLMotionProps<'div'> & {
  children: string | ReactNode;
};

import { ReasoningMarkdown } from '~/components/chat/ReasoningMarkdown';
import styles from '~/components/chat/ReasoningMarkdown.module.scss';

export const ReasoningContent = memo(({ className, children, ...props }: ReasoningContentProps) => {
  const { isOpen, isStreaming } = useReasoning();
  const contentRef = useRef<HTMLDivElement>(null);
  const [displayedText, setDisplayedText] = useState('');

  // Smooth typewriter effect
  useEffect(() => {
    if (typeof children !== 'string') {
      return;
    }

    if (!isStreaming) {
      setDisplayedText(children);
      return;
    }

    if (children === displayedText) {
      return;
    }

    if (!children.startsWith(displayedText)) {
      setDisplayedText(children);
      return;
    }

    const diff = children.length - displayedText.length;
    const chunkSize = Math.max(1, Math.ceil(diff / 5));

    const timer = setTimeout(() => {
      setDisplayedText((prev) => prev + children.slice(prev.length, prev.length + chunkSize));
    }, 15);

    return () => clearTimeout(timer);
  }, [children, displayedText, isStreaming]);

  // Auto-scroll
  useEffect(() => {
    if (isOpen && isStreaming && contentRef.current) {
      contentRef.current.scrollTop = contentRef.current.scrollHeight;
    }
  }, [displayedText, isOpen, isStreaming]); // Depend on displayedText to scroll as it types

  const contentToRender = typeof children === 'string' ? displayedText : children;

  return (
    <AnimatePresence initial={false}>
      {isOpen && (
        <motion.div
          initial={{ height: 0, opacity: 0 }}
          animate={{
            height: 'auto',
            opacity: 1,
            transition: { type: 'spring', stiffness: 300, damping: 30 },
          }}
          exit={{
            height: 0,
            opacity: 0,
            transition: { duration: 0.25, ease: 'easeInOut' },
          }}
          style={{ overflow: 'hidden' }}
          className={classNames('mt-2 rounded-lg', className)}
          {...props}
        >
          <div
            ref={contentRef}
            className={classNames(
              'text-[13px] leading-relaxed text-amplify-elements-textSecondary outline-none max-h-96 overflow-y-auto px-4 py-3 bg-amplify-elements-background-depth-2/60 border border-amplify-elements-borderColor/50 rounded-lg',
              styles.ReasoningScrollbar,
            )}
          >
            {typeof contentToRender === 'string' ? (
              <ReasoningMarkdown html>{contentToRender}</ReasoningMarkdown>
            ) : (
              contentToRender
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
});

Reasoning.displayName = 'Reasoning';
ReasoningTrigger.displayName = 'ReasoningTrigger';
ReasoningContent.displayName = 'ReasoningContent';
