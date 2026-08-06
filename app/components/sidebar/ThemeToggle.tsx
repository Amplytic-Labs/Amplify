import { useStore } from '@nanostores/react';
import { themeStore, toggleTheme, type Theme } from '~/lib/stores/theme';

interface MoonIconProps {
  size?: number;
}

const MoonIcon = ({ size = 18 }: MoonIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z" />
  </svg>
);

interface SunIconProps {
  size?: number;
}

const SunIcon = ({ size = 18 }: SunIconProps) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    width={size}
    height={size}
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth="2"
    strokeLinecap="round"
    strokeLinejoin="round"
  >
    <circle cx="12" cy="12" r="4" />
    <path d="M12 2v2M12 20v2M4.93 4.93l1.41 1.41M17.66 17.66l1.41 1.41M2 12h2M20 12h2M6.34 17.66l-1.41 1.41M19.07 4.93l-1.41 1.41" />
  </svg>
);

interface ThemeToggleProps {
  defaultTheme?: Theme;
  onChange?: (theme: Theme) => void;
}

export default function ThemeToggle({ defaultTheme: _defaultTheme = 'dark', onChange }: ThemeToggleProps) {
  const theme = useStore(themeStore);
  const isDark = theme === 'dark';

  const handleClick = () => {
    toggleTheme();
    onChange?.(isDark ? 'light' : 'dark');
  };

  return (
    <button
      onClick={handleClick}
      className="flex items-center justify-center w-10 h-10 rounded-lg border border-amplify-elements-borderColor bg-amplify-elements-background-depth-2 text-amplify-elements-textSecondary hover:text-amplify-elements-textPrimary hover:bg-amplify-elements-background-depth-3 transition-colors duration-200 focus:outline-none focus:ring-2 focus:ring-sidebar-primary/50"
      aria-label={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
      title={isDark ? 'Switch to light mode' : 'Switch to dark mode'}
    >
      {isDark ? <MoonIcon size={18} /> : <SunIcon size={18} />}
    </button>
  );
}
