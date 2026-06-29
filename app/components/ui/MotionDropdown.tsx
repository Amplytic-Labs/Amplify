import React, { useState, useEffect, useRef, useLayoutEffect } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { classNames } from '~/utils/classNames';

interface MotionDropdownProps {
  trigger: React.ReactNode;
  children: React.ReactNode;
  align?: 'start' | 'center' | 'end';
  flip?: boolean; // automatically flip if not enough space
  collisionPadding?: number; // pixels from viewport edges
  className?: string;
}

export const MotionDropdown = ({
  trigger,
  children,
  align = 'end',
  flip = true,
  collisionPadding = 8,
  className,
}: MotionDropdownProps) => {
  const [isOpen, setIsOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement>(null);
  const dropdownRef = useRef<HTMLDivElement>(null);
  const [positionStyle, setPositionStyle] = useState<React.CSSProperties>({});

  // Close on outside click
  useEffect(() => {
    const handleClickOutside = (event: MouseEvent) => {
      if (containerRef.current && !containerRef.current.contains(event.target as Node)) {
        setIsOpen(false);
      }
    };

    if (isOpen) {
      document.addEventListener('mousedown', handleClickOutside);
    }
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, [isOpen]);

  // Recalculate dropdown position when it opens, window resizes, or content changes
  useLayoutEffect(() => {
    if (!isOpen || !containerRef.current || !dropdownRef.current) return;

    const updatePosition = () => {
      if (!containerRef.current || !dropdownRef.current) return;
      const containerRect = containerRef.current.getBoundingClientRect();
      const dropdownRect = dropdownRef.current.getBoundingClientRect();
      const viewportWidth = window.innerWidth;

      const neededWidth = dropdownRect.width;
      const spaceLeft = containerRect.left - collisionPadding;
      const spaceRight = viewportWidth - containerRect.right - collisionPadding;

      let leftOffset: number | undefined;
      let rightOffset: number | undefined;

      // Determine which alignment keeps the dropdown fully inside the viewport
      if (align === 'start') {
        const overflowRight = containerRect.left + neededWidth - viewportWidth + collisionPadding;
        if (overflowRight > 0 && flip && spaceLeft >= neededWidth) {
          rightOffset = 0; // flip to right-aligned
        } else if (overflowRight > 0 && flip) {
          // Shift left to fit in viewport
          leftOffset = viewportWidth - collisionPadding - neededWidth - containerRect.left;
        } else {
          leftOffset = 0;
        }
      } else if (align === 'end') {
        const overflowLeft = containerRect.right - neededWidth - collisionPadding;
        if (overflowLeft < 0 && flip && spaceRight >= neededWidth) {
          leftOffset = 0; // flip to left-aligned
        } else if (overflowLeft < 0 && flip) {
          // Shift right to fit in viewport
          rightOffset = containerRect.right - (collisionPadding + neededWidth);
        } else {
          rightOffset = 0;
        }
      } else if (align === 'center') {
        const centerX = (containerRect.left + containerRect.right) / 2;
        let left = centerX - neededWidth / 2;
        if (left < collisionPadding) {
          left = collisionPadding;
        } else if (left + neededWidth > viewportWidth - collisionPadding) {
          left = viewportWidth - collisionPadding - neededWidth;
        }
        leftOffset = left - containerRect.left;
      }

      // Compute final inline style
      if (leftOffset !== undefined) {
        setPositionStyle({ left: leftOffset, right: 'auto' });
      } else if (rightOffset !== undefined) {
        setPositionStyle({ right: rightOffset, left: 'auto' });
      } else {
        // Use standard alignment classes (no inline overrides)
        setPositionStyle({});
      }
    };

    updatePosition();
    window.addEventListener('resize', updatePosition);
    return () => window.removeEventListener('resize', updatePosition);
  }, [isOpen, align, flip, collisionPadding, children]); // children may change dropdown size

  const alignmentClasses = {
    start: 'left-0',
    center: 'left-1/2 -translate-x-1/2',
    end: 'right-0',
  };

  return (
    <div ref={containerRef} className="relative inline-block">
      <div onClick={() => setIsOpen(!isOpen)} className="cursor-pointer">
        {trigger}
      </div>
      <AnimatePresence>
        {isOpen && (
          <motion.div
            ref={dropdownRef}
            initial={{ opacity: 0, scale: 0.95, y: -10 }}
            animate={{ opacity: 1, scale: 1, y: 0 }}
            exit={{ opacity: 0, scale: 0.95, y: -10 }}
            transition={{ duration: 0.15, ease: 'easeOut' }}
            style={positionStyle}
            className={classNames(
              'absolute top-full mt-2 z-[1000] min-w-[200px] p-2 rounded-lg shadow-lg',
              'bg-amplify-elements-background-depth-2 border border-amplify-elements-borderColor',
              // Only apply static alignment classes if we didn't compute an inline position
              Object.keys(positionStyle).length === 0 ? alignmentClasses[align] : '',
              className,
            )}
          >
            {children}
          </motion.div>
        )}
      </AnimatePresence>
    </div>
  );
};

export const MotionDropdownItem = ({
  children,
  onSelect,
  className,
}: {
  children: React.ReactNode;
  onSelect?: () => void;
  className?: string;
}) => (
  <div
    onClick={(e) => {
      e.stopPropagation();
      onSelect?.();
    }}
    className={classNames(
      'flex items-center gap-2 px-3 py-2 rounded-lg text-sm',
      'text-amplify-elements-textPrimary hover:bg-amplify-elements-background-depth-3',
      'transition-colors cursor-pointer outline-none',
      className,
    )}
  >
    {children}
  </div>
);

export const MotionDropdownSeparator = () => <div className="h-px bg-amplify-elements-borderColor my-1" />;
