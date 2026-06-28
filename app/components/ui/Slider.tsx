import type React from 'react';
import { motion, LayoutGroup } from 'framer-motion';
import { genericMemo } from '~/utils/react';
import { useSidebar } from '~/components/ui/shadcn/sidebar';

export type SliderOption<T> = { value: T; text: string; icon?: React.ComponentType<{ className?: string }> };

interface SliderProps<T> {
  selected: T;
  options: SliderOption<T>[];
  setSelected?: (selected: T) => void;
}

export const Slider = genericMemo(<T,>({ selected, options, setSelected }: SliderProps<T>) => {
  const { state } = useSidebar();
  const isSidebarOpen = state === 'expanded';

  // Slower, elegant luxury spring physics for a deliberate premium transition
  const smoothSpring = {
    type: 'spring',
    stiffness: 160,
    damping: 24,
  };

  return (
    <div className={`relative ${isSidebarOpen ? 'bottom-0.5' : 'bottom-2.5'} inline-flex items-center gap-1 p-0.5 bg-bolt-elements-background-depth-3 rounded-full border border-bolt-elements-borderColor transition-all duration-300 shadow-[inset_0_1px_2px_rgba(0,0,0,0.02)]`}>
      <LayoutGroup id="minimal-toggle-preset-two">
        {options.map((option) => {
          const isActive = option.value === selected;
          const IconComponent = option.icon;

          return (
            <button
              key={String(option.value)}
              onClick={() => setSelected?.(option.value)}
              className="relative bg-transparent flex items-center justify-center select-none rounded-full transition-colors duration-200  h-8 px-2.5 text-xs"
              style={{ WebkitTapHighlightColor: 'transparent' }}
              aria-pressed={isActive}
            >
              {/* Active Slider Indicator */}
              {isActive && (
                <motion.div
                  layoutId="activeIndicator"
                  className="absolute inset-0 bg-white dark:bg-zinc-700/50 rounded-full shadow-[0_1px_3px_rgba(0,0,0,0.06),0_1px_1px_rgba(0,0,0,0.04)]"
                  transition={smoothSpring}
                />
              )}

              {/* Component Content Wrapper */}
              <div className="relative z-10 flex items-center justify-center">
                {IconComponent && (
                  <IconComponent
                    className={`transition-colors duration-200 w-3.5 h-3.5 ${
                      isActive
                        ? 'text-bolt-elements-item-contentAccent'
                        : 'text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive'
                    }`}
                  />
                )}

                {/* Text Expand/Collapse Animation */}
                {IconComponent ? (
                  <motion.div
                    initial={false}
                    animate={{
                      width: isActive ? 'auto' : 0,
                      opacity: isActive ? 1 : 0,
                      marginLeft: isActive ? 6 : 0,
                    }}
                    transition={smoothSpring}
                    className="overflow-hidden whitespace-nowrap"
                  >
                    <span className="font-semibold tracking-wide text-bolt-elements-item-contentAccent uppercase text-[10px]">
                      {option.text}
                    </span>
                  </motion.div>
                ) : (
                  <span
                    className={`font-semibold tracking-wide uppercase text-[10px] px-1 transition-colors duration-200 ${
                      isActive
                        ? 'text-bolt-elements-item-contentAccent'
                        : 'text-bolt-elements-item-contentDefault hover:text-bolt-elements-item-contentActive'
                    }`}
                  >
                    {option.text}
                  </span>
                )}
              </div>
            </button>
          );
        })}
      </LayoutGroup>
    </div>
  );
});
