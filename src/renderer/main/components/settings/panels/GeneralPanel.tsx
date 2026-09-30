import { useEffect, useState } from 'react';
import {
  DEFAULT_UPDATE_CHECK_INTERVAL,
  EXTERNAL_TOOL_AUTO,
  EXTERNAL_TOOL_NONE,
  type ExternalToolKind,
  type ToolOption,
  type UpdateCheckInterval,
  type UpdateInfo,
  type UpdateStatus,
} from '../../../../../types/ipc';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';
import {
  setExternalTools,
  setOpenTools,
  useExternalTools,
  useOpenTools,
} from '../../../openActions';

/**
 * Which editor and terminal the "Open in…" actions use. The lists hold only
 * what's installed; "Custom…" asks for any other app/executable.
 */
function OpenInSection() {
  const tools = useOpenTools();
  if (!tools) return null;

  const pickCustom = async () => {
    const next = await window.api.open.pickCustomEditor();
    if (next) setOpenTools(next);
  };

  const onEditorChange = (id: string) => {
    // Custom needs an app first; a cancelled pick leaves the old choice in place.
    if (id === 'custom' && !tools.customEditorPath) {
      void pickCustom();
      return;
    }
    void window.api.open.setEditor(id).then(setOpenTools);
  };

  const customName = tools.customEditorPath?.split(/[\\/]/).pop()?.replace(/\.(app|exe)$/i, '');

  return (
    <SettingsSection title="Open in">
      <SettingsRow
        label="Editor"
        description="Used by “Open in editor” on files, the diff header and the repository."
      >
        <span className="settings-inline-controls">
          <select
            className="form-input"
            value={tools.editor}
            onChange={(e) => onEditorChange(e.target.value)}
          >
            {tools.editors.map((editor) => (
              <option key={editor.id} value={editor.id}>
                {editor.name}
              </option>
            ))}
            <option value="system">System default app</option>
            <option value="custom">{customName ? `Custom — ${customName}` : 'Custom…'}</option>
          </select>
          {tools.editor === 'custom' && (
            <button type="button" className="pill-btn pill-btn-gray" onClick={() => void pickCustom()}>
              Choose…
            </button>
          )}
        </span>
      </SettingsRow>
      <SettingsRow label="Terminal" description="Used by “Open in terminal” on a repository.">
        {tools.terminals.length > 0 ? (
          <select
            className="form-input"
            value={tools.terminal}
            onChange={(e) => void window.api.open.setTerminal(e.target.value).then(setOpenTools)}
          >
            {tools.terminals.map((terminal) => (
              <option key={terminal.id} value={terminal.id}>
                {terminal.name}
              </option>
            ))}
          </select>
        ) : (
          <span className="settings-desc">No terminal app found</span>
        )}
      </SettingsRow>
    </SettingsSection>
  );
}

/**
 * Which tools `git difftool` / `git mergetool` launch from the diff header, file
 * menus and the conflict resolver. "None" (the default) hides those actions;
 * "Automatic" defers to the user's own `diff.tool` / `merge.tool` config; the
 * rest are what git can drive here.
 */
function ExternalToolsSection() {
  const tools = useExternalTools();

  // Re-probe on open, so a tool installed since launch shows up.
  useEffect(() => {
    void window.api.open.externalTools(true).then(setExternalTools);
  }, []);

  if (!tools) return null;

  const onChange = (kind: ExternalToolKind, id: string) =>
    void window.api.open.setExternalTool(kind, id).then(setExternalTools);

  const row = (kind: ExternalToolKind, options: ToolOption[], value: string, name: string | null) => (
    <select className="form-input" value={value} onChange={(e) => onChange(kind, e.target.value)}>
      <option value={EXTERNAL_TOOL_NONE}>None</option>
      <option value={EXTERNAL_TOOL_AUTO}>
        {name && value === EXTERNAL_TOOL_AUTO ? `Automatic (${name})` : 'Automatic'}
      </option>
      {options.map((tool) => (
        <option key={tool.id} value={tool.id}>
          {tool.name}
        </option>
      ))}
    </select>
  );

  return (
    <SettingsSection title="External tools">
      <SettingsRow
        label="Diff tool"
        description={
          tools.diffTool === EXTERNAL_TOOL_NONE
            ? 'Pick a tool to add “Open diff in…” to files and the diff header.'
            : tools.diffToolName
              ? '“Open diff in…” on a file or the diff header shows the change there.'
              : 'No diff tool found. Install one (Beyond Compare, Kaleidoscope, Meld…) or set diff.tool in your git config.'
        }
      >
        {row('diff', tools.diffTools, tools.diffTool, tools.diffToolName)}
      </SettingsRow>
      <SettingsRow
        label="Merge tool"
        description={
          tools.mergeTool === EXTERNAL_TOOL_NONE
            ? 'Pick a tool to resolve conflicted files in it from the conflict resolver.'
            : tools.mergeToolName
              ? 'Resolves a conflicted file from the conflict resolver.'
              : 'No merge tool found. Install one or set merge.tool in your git config.'
        }
      >
        {row('merge', tools.mergeTools, tools.mergeTool, tools.mergeToolName)}
      </SettingsRow>
    </SettingsSection>
  );
}

/** Labels for each allowed update-check interval, in dropdown order. */
const INTERVAL_OPTIONS: { value: UpdateCheckInterval; label: string }[] = [
  { value: 30, label: 'Every 30 minutes' },
  { value: 60, label: 'Hourly' },
  { value: 360, label: 'Every 6 hours' },
  { value: 1440, label: 'Daily' },
  { value: 0, label: 'Never' },
];

/** Result of a manual "Check now": pending, or the outcome of the last check. */
type CheckState =
  | { kind: 'idle' }
  | { kind: 'checking' }
  | { kind: 'up-to-date' }
  | { kind: 'available'; update: UpdateInfo };

/**
 * The "Updates" row action. Mirrors the status-bar update control: where the
 * build can auto-update itself, "Get" downloads in the background, then
 * becomes "Restart to update" once staged; otherwise (or after a download
 * error) it falls back to opening the release page.
 */
function renderUpdateAction(
  check: CheckState,
  status: UpdateStatus,
  onCheckNow: () => void,
) {
  const api = window.api.update;

  if (status.state === 'ready') {
    return (
      <button
        type="button"
        className="pill-btn pill-btn-green"
        onClick={() => api.install()}
      >
        Restart to update
      </button>
    );
  }

  if (status.state === 'downloading') {
    return (
      <button type="button" className="pill-btn pill-btn-gray" disabled>
        Downloading…
      </button>
    );
  }

  if (check.kind === 'available') {
    const canAutoUpdate = status.supported && status.state !== 'error';
    return (
      <button
        type="button"
        className="pill-btn pill-btn-green"
        onClick={() =>
          canAutoUpdate ? api.download() : api.openRelease(check.update.releaseUrl)
        }
      >
        Get v{check.update.version}
      </button>
    );
  }

  return (
    <button
      type="button"
      className="pill-btn pill-btn-gray"
      onClick={onCheckNow}
      disabled={check.kind === 'checking'}
    >
      {check.kind === 'checking' ? 'Checking…' : 'Check now'}
    </button>
  );
}

/** Description text for the "Updates" row, following the same state order. */
function updateDescription(check: CheckState, status: UpdateStatus): string {
  const version =
    status.version ?? (check.kind === 'available' ? check.update.version : undefined);
  const v = version ? `Version ${version}` : 'A new version';
  switch (status.state) {
    case 'ready':
      return `${v} is downloaded. Restart to finish updating.`;
    case 'downloading':
      return `Downloading ${version ? `version ${version}` : 'the update'}…`;
    case 'error':
      return `Automatic update failed: ${status.message ?? 'unknown error'}. Get it from the release page instead.`;
    default:
      break;
  }
  if (check.kind === 'up-to-date') return "You're on the latest version.";
  if (check.kind === 'available') return `${v} is available.`;
  return 'Look for a newer release right now.';
}

/**
 * General settings — the date/time display format, the automatic update-check
 * cadence + a manual check, and usage analytics.
 */
export function GeneralPanel() {
  const [interval, setIntervalMin] = useState<UpdateCheckInterval>(
    DEFAULT_UPDATE_CHECK_INTERVAL,
  );
  const [check, setCheck] = useState<CheckState>({ kind: 'idle' });
  // The in-app auto-updater snapshot, so the "Get" button can walk the same
  // download → ready → install flow as the status-bar control.
  const [status, setStatus] = useState<UpdateStatus>({
    state: 'idle',
    supported: false,
  });
  const [telemetry, setTelemetry] = useState(true);

  useEffect(() => window.api.update.onStatus(setStatus), []);

  useEffect(() => {
    let alive = true;
    void window.api.app.getUpdateCheckInterval().then((minutes) => {
      if (alive) setIntervalMin(minutes);
    });
    void window.api.app.getTelemetryEnabled().then((enabled) => {
      if (alive) setTelemetry(enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onToggleTelemetry = (enabled: boolean) => {
    setTelemetry(enabled);
    void window.api.app.setTelemetryEnabled(enabled);
  };

  const onChange = (value: UpdateCheckInterval) => {
    setIntervalMin(value);
    void window.api.app.setUpdateCheckInterval(value);
  };

  const onCheckNow = () => {
    setCheck({ kind: 'checking' });
    void window.api.update.check().then((info) => {
      setCheck(info ? { kind: 'available', update: info } : { kind: 'up-to-date' });
    });
  };

  return (
    <>
      <SettingsSection title="General">
        <SettingsRow
          label="Check for updates"
          description="How often GitLeviathan looks for a newer release on GitHub."
        >
          <select
            className="form-input"
            value={interval}
            onChange={(e) =>
              onChange(Number(e.target.value) as UpdateCheckInterval)
            }
          >
            {INTERVAL_OPTIONS.map((opt) => (
              <option key={opt.value} value={opt.value}>
                {opt.label}
              </option>
            ))}
          </select>
        </SettingsRow>
        <SettingsRow
          label="Updates"
          description={updateDescription(check, status)}
        >
          {renderUpdateAction(check, status, onCheckNow)}
        </SettingsRow>
        <SettingsRow
          label="Usage analytics"
          description="Send anonymous usage data (app opens, commits, update checks) to help improve GitLeviathan. No repository contents or personal data are collected."
        >
          <input
            type="checkbox"
            className="checkbox"
            checked={telemetry}
            onChange={(e) => onToggleTelemetry(e.target.checked)}
          />
        </SettingsRow>
      </SettingsSection>
      <OpenInSection />
      <ExternalToolsSection />
    </>
  );
}
