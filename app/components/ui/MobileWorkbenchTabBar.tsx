import { memo } from 'react';
import { motion } from 'framer-motion';
import { classNames } from '~/utils/classNames';
import { cubicEasingFn } from '~/utils/easings';
import type { WorkbenchViewType } from '~/lib/stores/workbench';

// ─── Tab config ────────────────────────────────────────────────────────────────

interface TabConfig {
  value: WorkbenchViewType;
  /** Phosphor icon class for the tab */
  icon: string;
  label: string;
  /** Accent colour shown when the tab is active */
  color: string;
}

const TABS: TabConfig[] = [
  { value: 'code',    icon: 'i-ph:code',    label: 'Code',    color: '#3b82f6' },
  { value: 'preview', icon: 'i-ph:eye', label: 'Preview', color: '#0698c9ff' },
];

// ─── Individual tab pill ───────────────────────────────────────────────────────

interface TabPillProps {
  tab: TabConfig;
  isActive: boolean;
  onSelect: () => void;
}

const TabPill = memo(({ tab, isActive, onSelect }: TabPillProps) => {
  return (
    <motion.button
      onClick={onSelect}
      aria-label={tab.label}
      aria-pressed={isActive}
      // Flex grows wider for the active pill
      animate={{ flex: isActive ? 2.2 : 1 }}
      transition={{ duration: 0.25, ease: cubicEasingFn }}
      className="relative flex items-center justify-center overflow-hidden rounded-full bg-bolt-elements-background-depth-1"
      style={{ minWidth: 0 }}
    >
      {/* Pill background (active only) */}
      <motion.span
        className="absolute inset-0  bg-bolt-elements-background-depth-1"
        animate={{
          
          scale: isActive ? 1 : 0.9,
        }}
        transition={{ duration: 0.15, ease: cubicEasingFn }}
      />

      {/* Inner row */}
      <motion.span
        className="relative z-10 flex items-center gap-1.5 px-2 h-full bg-bolt-elements-background-depth-1"
        animate={{ paddingLeft: isActive ? 10 : 0, paddingRight: isActive ? 10 : 0 }}
        transition={{ duration: 0.15, ease: cubicEasingFn }}
      >
        {/* Icon */}
        <motion.span
          className={classNames(tab.icon, 'text-lg shrink-0')}
          animate={{
            color: isActive ? tab.color : 'var(--bolt-elements-item-contentDefault, #94a3b8)',
           
          }}
          transition={{ duration: 0.2, ease: cubicEasingFn }}
        />

        {/* Label — only mounts when active to avoid layout leaks */}
        {isActive && (
          <motion.span
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            transition={{ delay: 0.2, duration: 0.15 }}
            className="text-xs font-bold whitespace-nowrap"
            style={{ color: tab.color }}
          >
            {tab.label}
          </motion.span>
        )}
      </motion.span>
    </motion.button>
  );
});

// ─── Container ────────────────────────────────────────────────────────────────

interface MobileWorkbenchTabBarProps {
  selected: WorkbenchViewType;
  onSelect: (view: WorkbenchViewType) => void;
  className?: string;
}

export const MobileWorkbenchTabBar = memo(
  ({ selected, onSelect, className }: MobileWorkbenchTabBarProps) => {
    return (
      <div
        className={classNames(
          'flex items-center gap-1 px-2 py-1 rounded-lg h-8 w-[130px]',
          'bg-bolt-elements-background-depth-1 backdrop-blur-sm',
          'border border-bolt-elements-borderColor/40',
          className,
        )}
      >
        {TABS.map((tab) => (
          <TabPill
            key={tab.value}
            tab={tab}
            isActive={selected === tab.value}
            onSelect={() => onSelect(tab.value)}
          />
        ))}
      </div>
    );
  },
);
