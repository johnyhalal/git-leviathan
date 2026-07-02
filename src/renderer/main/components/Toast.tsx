import { useEffect } from 'react';
import { CloseIcon } from '../../../../assets/icons';

export type ToastVariant = 'error' | 'info';

export interface ToastData {
  id: string;
  title: string;
  message?: string;
  variant?: ToastVariant;
}

interface ToastStackProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

/** How long a toast stays up before auto-dismissing. */
const AUTO_DISMISS_MS = 5000;

/** Bottom-left stack of transient notifications. Newest sits nearest the corner. */
export function ToastStack({ toasts, onDismiss }: ToastStackProps) {
  if (toasts.length === 0) return null;
  return (
    <div className="toast-stack" aria-live="polite">
      {toasts.map((toast) => (
        <ToastItem key={toast.id} toast={toast} onDismiss={onDismiss} />
      ))}
    </div>
  );
}

function ToastItem({
  toast,
  onDismiss,
}: {
  toast: ToastData;
  onDismiss: (id: string) => void;
}) {
  useEffect(() => {
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, onDismiss]);

  return (
    <div className={`toast toast-${toast.variant ?? 'info'}`} role="alert">
      <div className="toast-body">
        <span className="toast-title">{toast.title}</span>
        {toast.message && <span className="toast-message">{toast.message}</span>}
      </div>
      <button
        type="button"
        className="toast-close"
        aria-label="Dismiss"
        onClick={() => onDismiss(toast.id)}
      >
        <CloseIcon size={14} />
      </button>
    </div>
  );
}
