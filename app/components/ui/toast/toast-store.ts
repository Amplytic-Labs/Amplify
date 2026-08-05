import { atom, map } from 'nanostores';
import type { ToastItem, ToastType } from '~/components/ui/toast/ToastStack';

/*
 * Global toast state store using nanostores.
 *
 * This replaces react-toastify's internal state management.
 * The ToastStack component subscribes to `toastList` and renders
 * the premium iPhone-style stacked notifications.
 *
 * The `toast` object exports the same API as react-toastify's
 * `toast` function, so existing call sites can be migrated with
 * minimal changes.
 */

let _nextId = 0;

function nextId(): string {
  return `toast-${++_nextId}`;
}

export const toastList = map<Record<string, ToastItem>>({});

function addToast(type: ToastType, title: string, options?: ToastOptions): string {
  const id = options?.toastId ?? nextId();
  const duration = options?.autoClose ?? 3000;

  toastList.setKey(id, {
    id,
    title,
    body: options?.description,
    type,
    duration: typeof duration === 'number' ? duration : 3000,
    icon: options?.icon,
  });

  return id;
}

function dismissToast(id?: string) {
  if (id) {
    const current = toastList.get();

    if (current[id]) {
      const next = { ...current };
      delete next[id];
      toastList.set(next);
    }
  } else {
    // Dismiss all
    toastList.set({});
  }
}

export interface ToastOptions {
  autoClose?: number | false;
  toastId?: string;
  description?: string;
  icon?: string;
  type?: ToastType;
  position?: string; // Ignored — our stack is always top-right
  theme?: string; // Ignored — always dark
  hideProgressBar?: boolean; // Ignored — progress bar is always shown
  closeOnClick?: boolean; // Ignored — always dismissible
  pauseOnHover?: boolean; // Ignored — always pauses on hover
  draggable?: boolean; // Ignored — not applicable
  progress?: undefined; // Ignored
}

/*
 * Drop-in replacement for react-toastify's `toast` function.
 *
 * Usage:
 *   toast.success('Saved!')
 *   toast.error('Something went wrong')
 *   toast.info('FYI')
 *   toast.warning('Careful')
 *   toast.loading('Working...')
 *   toast('Default message', { type: 'info' })
 *   toast.dismiss(id)
 */
export const toast = Object.assign(
  (message: string, options?: ToastOptions) => {
    return addToast(options?.type ?? 'info', message, options);
  },
  {
    success: (message: string, options?: ToastOptions) => addToast('success', message, options),
    error: (message: string, options?: ToastOptions) => addToast('error', message, options),
    info: (message: string, options?: ToastOptions) => addToast('info', message, options),
    warning: (message: string, options?: ToastOptions) => addToast('warning', message, options),
    loading: (message: string, options?: ToastOptions) =>
      addToast('loading', message, { ...options, autoClose: options?.autoClose ?? false }),
    dismiss: dismissToast,
    isActive: (id: string) => !!toastList.get()[id],
    TYPE: {
      SUCCESS: 'success' as const,
      ERROR: 'error' as const,
      INFO: 'info' as const,
      WARNING: 'warning' as const,
      DEFAULT: 'info' as const,
    },
    POSITION: {
      TOP_RIGHT: 'top-right' as const,
      BOTTOM_RIGHT: 'bottom-right' as const,
    },
  },
);
