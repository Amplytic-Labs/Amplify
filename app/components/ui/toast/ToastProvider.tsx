import { useStore } from '@nanostores/react';
import { ToastStack } from './ToastStack';
import { toastList } from './toast-store';

/*
 * ToastProvider — renders the global toast stack.
 *
 * Place this once in your root layout (replaces react-toastify's <ToastContainer>).
 * It subscribes to the nanostores `toastList` and renders the
 * premium iPhone-style stacked notifications.
 */
export function ToastProvider() {
  const toastsMap = useStore(toastList);
  const toasts = Object.values(toastsMap);

  const handleDismiss = (id: string) => {
    const current = toastList.get();
    const next = { ...current };
    delete next[id];
    toastList.set(next);
  };

  return <ToastStack toasts={toasts} onDismiss={handleDismiss} />;
}
