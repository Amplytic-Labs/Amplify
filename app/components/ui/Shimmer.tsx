import React, { useState, useEffect } from 'react';
import { motion } from 'framer-motion';

/*
 * ------------------------------------------------------------
 * Types
 * ------------------------------------------------------------
 */
type ShinyTextProps = {
  /** The text to display */
  text?: string;

  /** Whether to show the shimmer animation (loading state) */
  loading?: boolean;

  /** Text alignment */
  textAlign?: 'left' | 'center' | 'right';

  /** Whether text should wrap onto multiple lines */
  wrap?: boolean;

  /** Direction of the shimmer sweep */
  sweepDirection?: 'leftToRight' | 'rightToLeft' | 'topToBottom' | 'bottomToTop';

  /** Base (dull) colour of the text – used both for static and the base of shimmer */
  baseColor?: string;

  /** Colour of the shiny highlight */
  shineColor?: string;

  /** Enable multi‑colour gradient shine */
  multiColorShine?: boolean;

  /** Second shine colour (if multi‑colour) */
  shineColor2?: string;

  /** Third shine colour (if multi‑colour) */
  shineColor3?: string;

  /** Speed multiplier (1 = normal) */
  shimmerSpeed?: number;

  /** Delay between animation loops (seconds) */
  shimmerWait?: number;

  /** Optional link URL */
  link?: string;

  /** Open link in new tab */
  openInNewTab?: boolean;

  /** Custom font settings (size, weight, line height, letter spacing) */
  font?: {
    fontSize?: number;
    fontWeight?: number;
    lineHeight?: number;
    letterSpacing?: number;
  };

  /** Additional inline styles for the outer container */
  style?: React.CSSProperties;
};

/*
 * ------------------------------------------------------------
 * Helpers
 * ------------------------------------------------------------
 */
const BASE_SHIMMER_DURATION = 2.2;

const SWEEP_CONFIG = {
  leftToRight: { angle: 105, size: '200% 100%', axis: 'X', from: '-50%', to: '150%' },
  rightToLeft: { angle: 105, size: '200% 100%', axis: 'X', from: '150%', to: '-50%' },
  topToBottom: { angle: 195, size: '100% 200%', axis: 'Y', from: '-50%', to: '150%' },
  bottomToTop: { angle: 195, size: '100% 200%', axis: 'Y', from: '150%', to: '-50%' },
} as const;

// Hook to respect system motion preferences
function usePrefersReducedMotion() {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined') {
      return false;
    }

    return window.matchMedia?.('(prefers-reduced-motion: reduce)').matches === true;
  });

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) {
      return;
    }

    const mq = window.matchMedia('(prefers-reduced-motion: reduce)');
    const update = () => setReduced(mq.matches);
    update();
    mq.addEventListener?.('change', update);

    // eslint-disable-next-line consistent-return
    return () => mq.removeEventListener?.('change', update);
  }, []);

  return reduced;
}

/*
 * ------------------------------------------------------------
 * Main Component
 * ------------------------------------------------------------
 */
export function ShinyText({
  text = 'Thinking',
  loading = false,
  textAlign = 'left',
  wrap = false,
  sweepDirection = 'leftToRight',
  baseColor = 'rgba(184, 181, 181, 0.55)',
  shineColor = '#bfbaba',
  multiColorShine = false,
  shineColor2 = '#555555',
  shineColor3 = '#999999',
  shimmerSpeed = 1,
  shimmerWait = 0,
  link,
  openInNewTab = false,
  font = {
    fontSize: 18,
    fontWeight: 500,
    lineHeight: 1.3,
    letterSpacing: -0.1,
  },
  style = {},
}: ShinyTextProps) {
  const duration = BASE_SHIMMER_DURATION / Math.max(0.1, shimmerSpeed);
  const repeatDelay = Math.max(0, shimmerWait);
  const prefersReducedMotion = usePrefersReducedMotion();

  const sweep = SWEEP_CONFIG[sweepDirection];
  const hasText = typeof text === 'string' && text.trim().length > 0;
  const hasLink = hasText && typeof link === 'string' && link.trim().length > 0;

  const OuterTag = hasLink ? 'a' : 'span';
  const outerProps = hasLink
    ? {
        href: link,
        target: openInNewTab ? '_blank' : undefined,
        rel: openInNewTab ? 'noopener noreferrer' : undefined,
      }
    : {};

  // Base text style (dull colour) – used for static rendering and as the base layer
  const baseTextStyle: React.CSSProperties = {
    ...font,
    display: wrap ? 'block' : 'inline-block',
    whiteSpace: wrap ? 'normal' : 'nowrap',
    width: wrap ? '100%' : undefined,
    color: baseColor,
  };

  // Outer container style (alignment, cursor, etc.)
  const outerStyle: React.CSSProperties = {
    display: 'block',
    width: '100%',
    textAlign,
    textDecoration: 'none',
    color: 'inherit',
    cursor: hasLink ? 'pointer' : undefined,
    ...style,
  };

  // Inner wrapper (keeps overlay positioned correctly)
  const innerWrapperStyle: React.CSSProperties = {
    position: 'relative',
    display: wrap ? 'block' : 'inline-block',
  };

  // ----- If not loading, render plain text -----
  if (!loading) {
    return (
      <OuterTag style={outerStyle} {...outerProps}>
        <span style={innerWrapperStyle}>
          <span style={baseTextStyle}>{text}</span>
        </span>
      </OuterTag>
    );
  }

  /*
   * ----- Loading: show shimmer -----
   * Static (frozen) gradient for reduced‑motion fallback
   */
  const frozenStops = multiColorShine
    ? `${baseColor} 0%, ${baseColor} 15%, ${shineColor} 35%, ${shineColor2} 50%, ${shineColor3} 65%, ${baseColor} 85%, ${baseColor} 100%`
    : `${baseColor} 0%, ${baseColor} 20%, ${shineColor} 50%, ${baseColor} 80%, ${baseColor} 100%`;

  // Animated gradient (only the shiny part moves)
  const shineStops = multiColorShine
    ? `transparent 0%, transparent 25%, ${shineColor} 35%, ${shineColor2} 50%, ${shineColor3} 65%, transparent 75%, transparent 100%`
    : `transparent 0%, transparent 35%, ${shineColor} 50%, transparent 65%, transparent 100%`;

  const shineGradient = `linear-gradient(${sweep.angle}deg, ${shineStops})`;

  // Shared font styles for the overlay
  const overlayFontStyle: React.CSSProperties = {
    ...font,
    position: 'absolute',
    top: 0,
    left: 0,
    width: wrap ? '100%' : undefined,
    whiteSpace: wrap ? 'normal' : 'nowrap',
    backgroundImage: shineGradient,
    backgroundSize: sweep.size,
    backgroundRepeat: 'no-repeat',
    WebkitBackgroundClip: 'text',
    backgroundClip: 'text',
    WebkitTextFillColor: 'transparent',
    color: 'transparent',
    willChange: 'background-position',
    pointerEvents: 'none',
  };

  // If reduced motion is enabled, render static gradient
  if (prefersReducedMotion) {
    const frozenGradient = `linear-gradient(${sweep.angle}deg, ${frozenStops})`;
    return (
      <OuterTag style={outerStyle} {...outerProps}>
        <span style={innerWrapperStyle}>
          <span
            style={{
              ...baseTextStyle,
              backgroundImage: frozenGradient,
              backgroundSize: sweep.size,
              backgroundPosition: '50% 50%',
              backgroundRepeat: 'no-repeat',
              WebkitBackgroundClip: 'text',
              backgroundClip: 'text',
              WebkitTextFillColor: 'transparent',
              color: 'transparent',
            }}
          >
            {text}
          </span>
        </span>
      </OuterTag>
    );
  }

  // ---- Animated version ----
  const animate =
    sweep.axis === 'X'
      ? { backgroundPositionX: [sweep.from, sweep.to], backgroundPositionY: '0%' }
      : { backgroundPositionX: '0%', backgroundPositionY: [sweep.from, sweep.to] };

  return (
    <OuterTag style={outerStyle} {...outerProps}>
      <span style={innerWrapperStyle}>
        {/* Base (dull) text */}
        <span style={baseTextStyle}>{text}</span>

        {/* Shimmer overlay (animated) */}
        <motion.span
          aria-hidden="true"
          style={overlayFontStyle}
          animate={animate}
          transition={{
            duration,
            repeat: Infinity,
            repeatDelay,
            ease: 'linear',
          }}
        >
          {text}
        </motion.span>
      </span>
    </OuterTag>
  );
}

export default ShinyText;
