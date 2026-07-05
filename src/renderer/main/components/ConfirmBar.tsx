import {
  createContext,
  useCallback,
  useContext,
  useState,
  type ReactNode,
} from 'react';

/** Button color, chosen per action by the caller (the bar itself is neutral). */
export type ConfirmTone = 'default' | 'primary' | 'danger';

/** One action button in the confirm bar; a request may carry several. */
export interface ConfirmAction {
  /** Button label. */
  label: string;
  /** Button color; defaults to a neutral button. */
  tone?: ConfirmTone;
  /** Label shown on this button while its `onClick` is in flight. */
  busyLabel?: string;
  /**
   * Run when this button is pressed; awaited, and the bar closes once it
   * resolves. Throwing leaves the bar open so the failure stays visible.
   */
  onClick: () => void | Promise<void>;
}

/** A pending confirmation, raised by any descendant via {@link useConfirm}. */
export interface ConfirmRequest {
  /** The prompt shown in the bar (e.g. "Discard all changes? This can't be undone."). */
  message: string;
  /** Label for the dismiss button (default "Cancel"). */
  cancelLabel?: string;
  /** The action buttons, each independently colored via its own `tone`. */
  actions: ConfirmAction[];
}

const ConfirmContext = createContext<(request: ConfirmRequest) => void>(() => {
  throw new Error('useConfirm must be used within a ConfirmProvider');
});

/** Request a confirmation over the toolbar; the bar handles the busy/close cycle. */
export const useConfirm = () => useContext(ConfirmContext);

/**
 * Provides {@link useConfirm} to its subtree and renders the single confirmation
 * bar that overlays the toolbar. Reusable for any confirm — the caller supplies
 * the message plus one or more action buttons, coloring each button through its
 * own `tone`. Place it inside the relatively positioned container whose top
 * strip (the toolbar) the bar should cover.
 */
export function ConfirmProvider({ children }: { children: ReactNode }) {
  const [request, setRequest] = useState<ConfirmRequest | null>(null);
  // Index of the action currently running (disables the whole bar), or null.
  const [busyIndex, setBusyIndex] = useState<number | null>(null);

  const close = useCallback(() => {
    setRequest(null);
    setBusyIndex(null);
  }, []);

  const run = useCallback(
    async (action: ConfirmAction, index: number) => {
      setBusyIndex(index);
      try {
        await action.onClick();
        close();
      } catch {
        // Leave the bar open so the failure is visible and retryable.
        setBusyIndex(null);
      }
    },
    [close],
  );

  const busy = busyIndex !== null;

  return (
    <ConfirmContext.Provider value={setRequest}>
      {children}
      {request && (
        <div className="confirm-bar" role="alertdialog" aria-label="Confirm action">
          <span className="confirm-bar-text">{request.message}</span>
          <div className="confirm-bar-actions">
            <button
              type="button"
              className="confirm-bar-btn confirm-bar-btn-default"
              onClick={close}
              disabled={busy}
            >
              {request.cancelLabel ?? 'Cancel'}
            </button>
            {request.actions.map((action, index) => (
              <button
                key={action.label}
                type="button"
                className={`confirm-bar-btn confirm-bar-btn-${action.tone ?? 'default'}`}
                onClick={() => void run(action, index)}
                disabled={busy}
              >
                {busyIndex === index ? action.busyLabel ?? 'Working…' : action.label}
              </button>
            ))}
          </div>
        </div>
      )}
    </ConfirmContext.Provider>
  );
}
