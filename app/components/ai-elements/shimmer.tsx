import { classNames } from '~/utils/classNames';
import { memo } from 'react';

export interface ShimmerProps extends React.HTMLAttributes<HTMLDivElement> {
  duration?: number;
}

export const Shimmer = memo(({ className, children, duration = 2, ...props }: ShimmerProps) => {
  return (
    <div className={classNames('animate-pulse', className)} style={{ animationDuration: `${duration}s` }} {...props}>
      {children}
    </div>
  );
});

Shimmer.displayName = 'Shimmer';
