import { useEffect } from 'react';
import { CloseIcon } from '../../../../assets/icons';

export type ToastVariant = 'error' | 'info' | 'green';

export interface ToastAction {
  label: string;
  onClick: () => void;
}

export interface ToastData {
  id: string;
  title: string;
  message?: string;
  variant?: ToastVariant;
  /**
   * Keep the toast up until the user closes it, skipping the auto-dismiss
   * timer. For notices that must not be missed (e.g. "update ready — restart").
   */
  persistent?: boolean;
  /**
   * An optional call-to-action button rendered inside the toast (e.g.
   * "Restart" on the update-ready notice).
   */
  action?: ToastAction;
}

interface ToastStackProps {
  toasts: ToastData[];
  onDismiss: (id: string) => void;
}

/** How long a toast stays up before auto-dismissing. */
const AUTO_DISMISS_MS = 10000;

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
    // Persistent toasts stay up until the user clicks the close button.
    if (toast.persistent) return;
    const timer = setTimeout(() => onDismiss(toast.id), AUTO_DISMISS_MS);
    return () => clearTimeout(timer);
  }, [toast.id, toast.persistent, onDismiss]);

  return (
    <div className={`toast toast-${toast.variant ?? 'info'}`} role="alert">
      <div className="toast-body">
        <span className="toast-title">{toast.title}</span>
        {toast.message && <span className="toast-message">{toast.message}</span>}
        {toast.action && (
          <button
            type="button"
            className="toast-action"
            onClick={toast.action.onClick}
          >
            {toast.action.label}
          </button>
        )}
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
