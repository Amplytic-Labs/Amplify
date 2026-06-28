import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MoonIcon = ({ color = '#fff', size = 16 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    stroke={color}
    strokeWidth="1"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SunIcon = ({ color = '#222', size = 20 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
  >
    <circle cx="12" cy="12" r="4" fill={color} stroke="none" />
    {[0, 45, 90, 135, 180, 225, 270, 315].map((deg, i) => {
      const rad = (deg * Math.PI) / 180;
      const x1 = 12 + 7 * Math.cos(rad);
      const y1 = 12 + 7 * Math.sin(rad);
      const x2 = 12 + 9.5 * Math.cos(rad);
      const y2 = 12 + 9.5 * Math.sin(rad);
      return <line key={i} x1={x1} y1={y1} x2={x2} y2={y2} />;
    })}
  </svg>
);

const iconVariants = {
  initial: (isDark) => ({
    opacity: 0,
    rotate: isDark ? -60 : 60,
    scale: 0.5,
  }),
  animate: {
    opacity: 1,
    rotate: 0,
    scale: 1,
    transition: { duration: 0.25, ease: 'easeOut' },
  },
  exit: (isDark) => ({
    opacity: 0,
    rotate: isDark ? 60 : -60,
    scale: 0.5,
    transition: { duration: 0.2, ease: 'easeIn' },
  }),
};

export default function ThemeToggle({ defaultTheme = 'dark', onChange }) {
  const [isDark, setIsDark] = useState(defaultTheme === 'dark');

  const handleClick = () => {
    const next = !isDark;
    setIsDark(next);
    onChange?.(next ? 'dark' : 'light');
  };

  return (
    <motion.div
      onClick={handleClick}
      role="switch"
      aria-checked={isDark}
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      tabIndex={0}
      onKeyDown={(e) => (e.key === 'Enter' || e.key === ' ') && handleClick()}
      animate={{
        backgroundColor: isDark ? 'rgb(26,28,29)' : 'rgb(220,220,220)',
        boxShadow: isDark
          ? 'rgba(255,255,255,0.05) 0px 1px 0px 0px inset, rgba(0,0,0,0.1) 0px -1px 0px 0px'
          : 'rgba(0,0,0,0.08) 0px 1px 3px 0px inset',
      }}
      transition={{ duration: 0.4, ease: 'easeInOut' }}
      style={{
        width: 72,
        height: 40,
        borderRadius: 96,
        position: 'relative',
        cursor: 'pointer',
        outline: 'none',
        flexShrink: 0,
      }}
    >
      <motion.div
        animate={{
          x: isDark ? 0 : 32,
          backgroundColor: isDark ? 'rgb(51,55,58)' : 'rgb(255,255,255)',
          boxShadow: isDark
            ? 'rgba(0,0,0,0.15) 0px 4px 16px 0px, rgba(255,255,255,0.05) 0px 1px 0px 0px inset'
            : 'rgba(0,0,0,0.15) 0px 4px 16px 0px',
        }}
        transition={{ type: 'spring', stiffness: 350, damping: 28 }}
        style={{
          position: 'absolute',
          top: 4,
          left: 4,
          width: 32,
          height: 32,
          borderRadius: '50%',
          display: 'flex',
          alignItems: 'center',
          justifyContent: 'center',
          overflow: 'hidden',
        }}
      >
        <AnimatePresence mode="wait" initial={false} custom={isDark}>
          {isDark ? (
            <motion.div
              key="moon"
              custom={isDark}
              variants={iconVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute' }}
            >
              <MoonIcon color="#fff" size={16} />
            </motion.div>
          ) : (
            <motion.div
              key="sun"
              custom={isDark}
              variants={iconVariants}
              initial="initial"
              animate="animate"
              exit="exit"
              style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', position: 'absolute' }}
            >
              <SunIcon color="#333" size={18} />
            </motion.div>
          )}
        </AnimatePresence>
      </motion.div>
    </motion.div>
  );
}
