import type { DeviceCodePrompt } from '../../../../types/ipc';

interface ConnectingPromptProps {
  prompt: DeviceCodePrompt;
  busy: boolean;
  onCancel: () => void;
}

/**
 * Device-flow instructions shown while a connect is in progress: the code the
 * user must enter, the verification URL, and a cancel action. Shared by the
 * Integrations settings panel and the clone dialog's repo source.
 */
export function ConnectingPrompt({ prompt, busy, onCancel }: ConnectingPromptProps) {
  return (
    <div className="integration-connecting">
      <p className="settings-desc">
        In the browser window that just opened, enter this code to authorize
        GitLeviathan:
      </p>
      <div className="integration-code-row">
        <code className="integration-code">{prompt.userCode}</code>
        <button
          type="button"
          className="settings-connect is-connected"
          onClick={() => {
            void navigator.clipboard?.writeText(prompt.userCode);
          }}
        >
          Copy
        </button>
      </div>
      <p className="settings-desc integration-verification">
        {prompt.verificationUri}
      </p>
      <div className="integration-connecting-actions">
        <span className="settings-desc">Waiting for authorization…</span>
        <button
          type="button"
          className="settings-connect is-connected"
          disabled={busy}
          onClick={onCancel}
        >
          Cancel
        </button>
      </div>
    </div>
  );
}
