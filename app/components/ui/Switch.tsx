import { memo } from 'react';
import * as SwitchPrimitive from '@radix-ui/react-switch';
import { classNames } from '~/utils/classNames';

interface SwitchProps {
  className?: string;
  checked?: boolean;
  onCheckedChange?: (event: boolean) => void;
}

/**
 * Theme-aware toggle switch with HIGH-CONTRAST ON / OFF states.
 *
 * Why the explicit colors instead of `bg-amplify-elements-button-primary-background`
 * / `bg-amplify-elements-item-contentAccent`?
 *
 *   Both of those tokens resolve to `var(--primary)`, which is NEAR-BLACK
 *   in light mode and NEAR-WHITE in dark mode. Using the same color for
 *   BOTH the off-track and the on-track made the toggle look identical in
 *   both states — the user could not tell whether it was on or off, and
 *   against the `bg-amplify-elements-background-depth-3` (`var(--muted)`)
 *   container the off-track blended in completely. This is the
 *   "toggle is not quite visible" bug from the screenshot report.
 *
 * Fix:
 *   - OFF track: a neutral mid-gray (`var(--muted-foreground)` at 40%
 *     opacity over the container) — clearly distinct from the white knob
 *     and from the ON state, but still subdued so it doesn't compete
 *     with the ON state for attention.
 *   - ON track: the Amplify brand accent (`var(--accent-500, #FF2056)`)
 *     — vibrant, recognizable, and maximally distinct from the OFF gray.
 *   - Knob: pure white in both states for consistency, with a soft shadow
 *     so it lifts off the track.
 */
export const Switch = memo(({ className, onCheckedChange, checked }: SwitchProps) => {
  return (
    <SwitchPrimitive.Root
      className={classNames(
        'relative h-6 w-11 cursor-pointer rounded-full',
        // OFF state: neutral mid-gray, clearly visible against any container.
        'bg-amplify-elements-textTertiary/40',
        // ON state: brand accent pink — maximally distinct from the OFF gray.
        'data-[state=checked]:bg-accent-500',
        'transition-colors duration-200 ease-in-out',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent-500/60 focus-visible:ring-offset-2',
        'disabled:cursor-not-allowed disabled:opacity-50',
        className,
      )}
      checked={checked}
      onCheckedChange={(e) => onCheckedChange?.(e)}
    >
      <SwitchPrimitive.Thumb
        className={classNames(
          'block h-5 w-5 rounded-full bg-white',
          'shadow-lg shadow-black/20',
          'transition-transform duration-200 ease-in-out',
          'translate-x-0.5',
          'data-[state=checked]:translate-x-[1.375rem]',
          'will-change-transform',
        )}
      />
    </SwitchPrimitive.Root>
  );
});
