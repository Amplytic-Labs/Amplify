import { useState } from 'react';
import { motion, AnimatePresence } from 'framer-motion';

const MoonIcon = ({ color = '#fff', size = 18 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill={color}
    stroke={color}
    strokeWidth="1.5"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

const SunIcon = ({ color = '#222', size = 18 }) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke={color}
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="4" fill={color} stroke="none" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

// Vertical slide transition variants for smooth icon switching
const iconVariants = {
  initial: { y: 16, opacity: 0 },
  animate: { y: 0, opacity: 1 },
  exit: { y: -16, opacity: 0 },
};

export default function ThemeToggle({ defaultTheme = 'dark', onChange }) {
  const [isDark, setIsDark] = useState(defaultTheme === 'dark');

  const handleClick = () => {
    const next = !isDark;
    setIsDark(next);
    onChange?.(next ? 'dark' : 'light');
  };

  return (
    <motion.button
      onClick={handleClick}
      whileHover={{ scale: 1.05 }}
      whileTap={{ scale: 0.95 }}
      transition={{ type: 'spring', stiffness: 400, damping: 25 }}
      className="flex items-center justify-center w-10 h-10 rounded-lg border border-amplify-elements-borderColor bg-amplify-elements-background-depth-2 text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary hover:bg-amplify-elements-background-depth-3 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-amplify-elements-focus/50"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      role="switch"
      aria-checked={isDark}
    >
      <AnimatePresence mode="wait" initial={false}>
        {isDark ? (
          <motion.div
            key="moon"
            variants={iconVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: 'spring', stiffness: 450, damping: 28 }}
            className="flex items-center justify-center"
          >
            <MoonIcon color="currentColor" size={18} />
          </motion.div>
        ) : (
          <motion.div
            key="sun"
            variants={iconVariants}
            initial="initial"
            animate="animate"
            exit="exit"
            transition={{ type: 'spring', stiffness: 450, damping: 28 }}
            className="flex items-center justify-center"
          >
            <SunIcon color="currentColor" size={18} />
          </motion.div>
        )}
      </AnimatePresence>
    </motion.button>
  );
}
