import { useCallback } from 'react';
import { toast } from '~/components/ui/toast';

/*
 * useToast hook — drop-in replacement for the old react-toastify wrapper.
 *
 * Provides the same API as the old hook: { toast, success, error, info, warning }.
 * Under the hood it delegates to the new premium iPhone-style toast stack.
 */

interface ToastOptions {
  type?: 'success' | 'error' | 'info' | 'warning';
  duration?: number;
  autoClose?: number | false;
  toastId?: string;
  description?: string;
}

export function useToast() {
  const toastFn = useCallback((message: string, options: ToastOptions = {}) => {
    const { type = 'info', duration, autoClose, ...rest } = options;
    toast[type](message, { autoClose: autoClose ?? duration ?? 3000, ...rest });
  }, []);

  const success = useCallback(
    (message: string, options: Omit<ToastOptions, 'type'> = {}) => {
      toastFn(message, { ...options, type: 'success' });
    },
    [toastFn],
  );

  const error = useCallback(
    (message: string, options: Omit<ToastOptions, 'type'> = {}) => {
      toastFn(message, { ...options, type: 'error' });
    },
    [toastFn],
  );

  const info = useCallback(
    (message: string, options: Omit<ToastOptions, 'type'> = {}) => {
      toastFn(message, { ...options, type: 'info' });
    },
    [toastFn],
  );

  const warning = useCallback(
    (message: string, options: Omit<ToastOptions, 'type'> = {}) => {
      toastFn(message, { ...options, type: 'warning' });
    },
    [toastFn],
  );

  return { toast: toastFn, success, error, info, warning };
}

// Also export the configured toast object for direct import (backward compat)
export const configuredToast = {
  success: (message: string, options = {}) => toast.success(message, { autoClose: 3000, ...options }),
  error: (message: string, options = {}) => toast.error(message, { autoClose: 3000, ...options }),
  info: (message: string, options = {}) => toast.info(message, { autoClose: 3000, ...options }),
  warning: (message: string, options = {}) => toast.warning(message, { autoClose: 3000, ...options }),
  loading: (message: string, options = {}) => toast.loading(message, { autoClose: 3000, ...options }),
};

// Re-export the toast object for direct use
export { toast };
