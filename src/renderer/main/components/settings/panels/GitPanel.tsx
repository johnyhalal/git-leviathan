import { useEffect, useState } from 'react';
import { SettingsSection } from '../SettingsSection';
import { SettingsRow } from '../SettingsRow';

/** Git behaviour that applies to every repository (fetching, pulling, …). */
export function GitPanel() {
  const [fetchPrune, setFetchPrune] = useState(true);

  useEffect(() => {
    let alive = true;
    void window.api.app.getFetchPrune().then((enabled) => {
      if (alive) setFetchPrune(enabled);
    });
    return () => {
      alive = false;
    };
  }, []);

  const onToggleFetchPrune = (enabled: boolean) => {
    setFetchPrune(enabled);
    void window.api.app.setFetchPrune(enabled);
  };

  return (
    <SettingsSection title="Fetching">
      <SettingsRow
        label="Remove deleted remote branches when fetching"
        description="When a branch is deleted on the server (e.g. after its pull request is merged), drop it from the Remote Branches list on the next fetch or pull. Your local branches are never touched."
      >
        <input
          type="checkbox"
          checked={fetchPrune}
          onChange={(e) => onToggleFetchPrune(e.target.checked)}
        />
      </SettingsRow>
    </SettingsSection>
  );
}
