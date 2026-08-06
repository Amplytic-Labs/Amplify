import React, { useEffect, useRef, useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import {
  X,
  Shield,
  Cloud,
  Database,
  Laptop,
  Bell,
  CheckCircle2,
  AlertCircle,
  Info,
  AlertTriangle,
  Loader2,
} from 'lucide-react';

/*
 * Premium iPhone-style stacked toast notification system.
 *
 * Features:
 *   - Stacked card layout with depth (fanned cards when idle, expanded on hover)
 *   - Hardware-accelerated progress bar (requestAnimationFrame, no React re-renders)
 *   - Hover-to-pause with visual indicator
 *   - Spring animations via framer-motion
 *   - Dark glass-morphic card design
 *   - Auto-dismiss with configurable duration
 *   - Dismiss on click
 */

export type ToastType = 'success' | 'error' | 'info' | 'warning' | 'loading';

export interface ToastItem {
  id: string;
  title: string;
  body?: string;
  type: ToastType;
  duration: number;
  icon?: string;
}

export interface ToastStackProps {
  toasts: ToastItem[];
  onDismiss: (id: string) => void;
  maxVisible?: number;
}

const CARD_HEIGHT = 84;
const CARD_GAP = 6;

/* ── Hardware-accelerated progress bar ── */
function ProgressBar({
  duration,
  onComplete,
  isPaused,
}: {
  duration: number;
  onComplete: () => void;
  isPaused: boolean;
}) {
  const progressRef = useRef<HTMLDivElement>(null);
  const elapsedRef = useRef(0);
  const requestRef = useRef<number | null>(null);
  const prevTimeRef = useRef<number | null>(null);

  useEffect(() => {
    if (isPaused) {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }

      prevTimeRef.current = null;

      return;
    }

    const tick = (time: number) => {
      if (prevTimeRef.current === null) {
        prevTimeRef.current = time;
      }

      const delta = time - prevTimeRef.current;
      prevTimeRef.current = time;
      elapsedRef.current += delta;

      const progress = Math.max(0, 100 - (elapsedRef.current / duration) * 100);

      if (progressRef.current) {
        progressRef.current.style.width = `${progress}%`;
      }

      if (elapsedRef.current >= duration) {
        onComplete();
      } else {
        requestRef.current = requestAnimationFrame(tick);
      }
    };

    requestRef.current = requestAnimationFrame(tick);

    // eslint-disable-next-line consistent-return
    return () => {
      if (requestRef.current) {
        cancelAnimationFrame(requestRef.current);
      }
    };
  }, [isPaused, duration, onComplete]);

  return (
    <div className="absolute bottom-0 left-0 right-0 h-[3px] bg-white/[0.04]">
      <div
        ref={progressRef}
        className={`h-full transition-colors duration-300 ${isPaused ? 'bg-amber-500/50' : 'bg-white/20'}`}
        style={{ width: '100%' }}
      />
    </div>
  );
}

/* ── Icon mapping ── */
// eslint-disable-next-line consistent-return
function getIcon(type: ToastType, customIcon?: string) {
  const iconProps = { size: 18, className: 'text-zinc-300' };

  if (customIcon) {
    switch (customIcon) {
      case 'shield':
        return <Shield {...iconProps} />;
      case 'cloud':
        return <Cloud {...iconProps} />;
      case 'database':
        return <Database {...iconProps} />;
      case 'laptop':
        return <Laptop {...iconProps} />;
      default:
        return <Bell {...iconProps} />;
    }
  }

  switch (type) {
    case 'success':
      return <CheckCircle2 size={18} className="text-emerald-400" />;
    case 'error':
      return <AlertCircle size={18} className="text-red-400" />;
    case 'warning':
      return <AlertTriangle size={18} className="text-amber-400" />;
    case 'info':
      return <Info size={18} className="text-sky-400" />;
    case 'loading':
      return <Loader2 size={18} className="text-zinc-300 animate-spin" />;
  }
}

/* ── Main toast stack component ── */
export function ToastStack({ toasts, onDismiss, maxVisible = 5 }: ToastStackProps) {
  const [isHovered, setIsHovered] = useState(false);

  const visibleToasts = toasts.slice(0, maxVisible);

  const totalHeight = isHovered
    ? visibleToasts.length * (CARD_HEIGHT + CARD_GAP)
    : CARD_HEIGHT + Math.min(3, visibleToasts.length - 1) * 12;

  return (
    <div
      className="fixed top-8 right-8 z-[1000] pointer-events-auto transition-all duration-300 ease-out"
      onMouseEnter={() => setIsHovered(true)}
      onMouseLeave={() => setIsHovered(false)}
      onTouchStart={() => setIsHovered(!isHovered)}
      style={{ width: '350px', height: `${totalHeight + 20}px` }}
    >
      {/* Invisible pointer hover shield */}
      <div className="absolute inset-0 bg-transparent rounded-[24px]" />

      <div className="relative w-full h-full">
        <AnimatePresence initial={false} mode="popLayout">
          {visibleToasts.map((item, index) => {
            const springTransition = {
              type: 'spring' as const,
              stiffness: 300,
              damping: 26,
              mass: 0.8,
            };

            const yOffset = isHovered ? index * (CARD_HEIGHT + CARD_GAP) : index * 12;
            const scaleOffset = isHovered ? 1 : 1 - index * 0.04;
            const opacityOffset = isHovered ? 1 : Math.max(0, 1 - index * 0.18);

            return (
              <motion.div
                key={item.id}
                layout
                initial={{ opacity: 0, y: -20, scale: 0.95 }}
                animate={{ y: yOffset, scale: scaleOffset, opacity: opacityOffset, zIndex: 100 - index }}
                exit={{ opacity: 0, scale: 0.85, x: -50, transition: { duration: 0.22 } }}
                transition={springTransition}
                style={{ position: 'absolute', top: 0, left: 0, width: '100%', originY: 0 }}
              >
                {/* Toast Card */}
                <div className="relative bg-[#111214] border border-white/[0.05] p-4 rounded-[22px] shadow-[0_12px_30px_rgba(0,0,0,0.4)] flex items-center justify-between gap-3.5 select-none overflow-hidden h-[84px]">
                  <div className="flex items-center gap-3.5 min-w-0 flex-1">
                    {/* Premium Circle Icon Holder */}
                    <div className="w-10 h-10 rounded-full bg-white/[0.06] flex items-center justify-center shrink-0 border border-white/[0.03]">
                      {getIcon(item.type, item.icon)}
                    </div>

                    {/* Header and Subtitle */}
                    <div className="min-w-0 flex-1">
                      <h4 className="text-[13.5px] font-bold text-white tracking-tight truncate leading-snug">
                        {item.title}
                      </h4>
                      {item.body && (
                        <p className="text-[11.5px] text-zinc-400 mt-0.5 leading-tight line-clamp-2 pr-2">
                          {item.body}
                        </p>
                      )}
                    </div>
                  </div>

                  {/* Dismiss button */}
                  <button
                    onClick={(e) => {
                      e.stopPropagation();
                      onDismiss(item.id);
                    }}
                    className="w-5 h-5 rounded-full bg-white/[0.05] hover:bg-white/15 flex items-center justify-center text-zinc-400 hover:text-white transition-all cursor-pointer shrink-0 z-10"
                    title="Dismiss"
                  >
                    <X size={10} strokeWidth={3} />
                  </button>

                  {/* Active Timer Countdown Progress Strip (top card only) */}
                  {index === 0 && item.type !== 'loading' && (
                    <ProgressBar
                      key={item.id}
                      duration={item.duration}
                      onComplete={() => onDismiss(item.id)}
                      isPaused={isHovered}
                    />
                  )}
                </div>
              </motion.div>
            );
          })}
        </AnimatePresence>
      </div>
    </div>
  );
}
