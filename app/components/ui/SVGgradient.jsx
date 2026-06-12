import React from 'react';
import { motion } from 'framer-motion';

export default function SvgGradientText({
  children,
  className = '',
  colors = ['#5227FF', '#FF9FFC', '#B19EEF'],
  animationSpeed = 5,
  direction = 'horizontal',
  fontSize = '2rem',
  fontWeight = 'bold',
  fontFamily = 'inherit',
  viewBox = '0 0 300 100',
  preserveAspectRatio = 'xMidYMid meet',
}) {
  const gradientId = React.useId();
  const maskId = React.useId();

  // Calculate rotation based on direction
  const rotation = direction === 'horizontal' ? 0 : direction === 'vertical' ? 90 : 45;

  return (
    <div className={`relative ${className}`}>
      <svg
        width="100%"
        height="100%"
        viewBox={viewBox}
        preserveAspectRatio={preserveAspectRatio}
        style={{ overflow: 'visible' }}
        xmlns="http://www.w3.org/2000/svg"
      >
        <defs>
          <mask id={maskId}>
            {typeof children === 'string' ? (
              <text
                x="50%"
                y="50%"
                textAnchor="middle"
                dominantBaseline="middle"
                fill="white"
                style={{
                  fontSize,
                  fontWeight,
                  fontFamily,
                }}
              >
                {children}
              </text>
            ) : (
              <g fill="white">{children}</g>
            )}
          </mask>

          <motion.linearGradient
            id={`${gradientId}-animated`}
            gradientUnits="objectBoundingBox"
            spreadMethod="repeat"
            x1="0%"
            y1="0%"
            x2="100%"
            y2="0%"
            animate={{
              gradientTransform: [`rotate(${rotation}) translate(0, 0)`, `rotate(${rotation}) translate(1, 0)`],
            }}
            transition={{
              duration: animationSpeed,
              repeat: Infinity,
              ease: 'linear',
            }}
          >
            {/* Add the first color at the end to close the loop seamlessly */}
            {[...colors, colors[0]].map((color, i, arr) => (
              <stop key={i} offset={`${(i / (arr.length - 1)) * 100}%`} stopColor={color} />
            ))}
          </motion.linearGradient>
        </defs>

        <rect x="0" y="0" width="100%" height="100%" fill={`url(#${gradientId}-animated)`} mask={`url(#${maskId})`} />
      </svg>
    </div>
  );
}
