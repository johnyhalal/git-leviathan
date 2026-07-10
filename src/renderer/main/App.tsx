import { useCallback, useEffect, useRef, useState } from 'react';
import { TabBar, type Tab } from './components/TabBar';
import { RepoStart, type RecentRepo } from './components/RepoStart';
import { ToastStack, type ToastData, type ToastVariant } from './components/Toast';
import { Settings } from './components/Settings';
import { CloneDialog } from './components/CloneDialog';
import { RepoView } from './components/repo/RepoView';
import { ActivityLog } from './components/repo/ActivityLog';
import { GearIcon } from '../../../assets/icons';
import type { RepoInfo, UpdateInfo, UpdateStatus } from '../../types/ipc';

let nextTabId = 2;
let nextToastId = 1;

/** Last path segment, tolerant of both POSIX and Windows separators. */
const folderName = (fullPath: string) =>
  fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;

/**
 * The status-bar update control. When the build can auto-update itself
 * (macOS/Windows, packaged + signed) it walks the click flow: download in the
 * background → "Restart to update" (swap + relaunch). Otherwise, and on any
 * download error, it falls back to opening the release page for a manual
 * download. Renders nothing when there's nothing to offer.
 */
function renderUpdateButton(update: UpdateInfo | null, status: UpdateStatus) {
  const version = update?.version ?? status.version;
  const api = window.api.update;

  // Downloaded and staged — a click swaps in the new build and relaunches.
  if (status.state === 'ready') {
    return (
      <button
        type="button"
        className="statusbar-update"
        title="Restart to finish updating"
        onClick={() => api.install()}
      >
        Restart to update{version ? ` (v${version})` : ''}
      </button>
    );
  }

  // Fetching in the background — show progress, no action.
  if (status.state === 'downloading') {
    return (
      <button type="button" className="statusbar-update" disabled title="Downloading the update">
        Downloading update{version ? ` (v${version})` : ''}…
      </button>
    );
  }

  // Nothing to offer unless a newer release was found.
  if (!update) return null;

  // Auto-update available: a click downloads it in place. Where auto-update
  // isn't supported (or a prior attempt errored), fall back to the release page.
  const canAutoUpdate = status.supported && status.state !== 'error';
  return (
    <button
      type="button"
      className="statusbar-update"
      title={canAutoUpdate ? 'Download and install the update' : 'Open the release page'}
      onClick={() => (canAutoUpdate ? api.download() : api.openRelease(update.releaseUrl))}
    >
      Update available (v{update.version})
    </button>
  );
}

export function App() {
  const isMac = window.api.platform === 'darwin';
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'tab-1', title: 'New Tab' },
  ]);
  const [activeId, setActiveId] = useState('tab-1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [settingsSection, setSettingsSection] = useState<string | undefined>();
  const [cloneOpen, setCloneOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
    supported: false,
  });
  // Gate tab persistence until the initial restore has run, so the default
  // empty tab can't overwrite the saved list before it's loaded.
  const tabsHydrated = useRef(false);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

  // Hydrate the recent list from the main process' persisted store on mount.
  useEffect(() => {
    let active = true;
    void window.api.repo.recent().then((repos) => {
      if (active) setRecentRepos(repos);
    });
    return () => {
      active = false;
    };
  }, []);

  // Check GitHub for a newer release on mount and every hour. A failed check
  // resolves null, so this quietly shows nothing when offline.
  useEffect(() => {
    let alive = true;
    const run = () =>
      void window.api.update.check().then((info) => {
        if (alive) setUpdate(info);
      });
    run();
    const id = setInterval(run, 60 * 60 * 1000);
    return () => {
      alive = false;
      clearInterval(id);
    };
  }, []);

  // Track the in-app auto-updater (download → ready → install) so the status-bar
  // button can drive it. On builds where auto-update isn't supported this stays
  // `supported: false` and the button falls back to opening the release page.
  useEffect(() => window.api.update.onStatus(setUpdateStatus), []);

  // Restore the repositories that were open as tabs last session (paths only;
  // titles are derived from the folder name).
  useEffect(() => {
    let active = true;
    void window.api.repo.openTabs().then(({ paths, activeIndex }) => {
      if (!active) return;
      if (paths.length > 0) {
        const restored: Tab[] = paths.map((path) => ({
          id: `tab-${nextTabId++}`,
          title: folderName(path),
          repoPath: path,
        }));
        setTabs(restored);
        setActiveId((restored[activeIndex] ?? restored[0]).id);
      }
      tabsHydrated.current = true;
    });
    return () => {
      active = false;
    };
  }, []);

  // Persist the open repo tabs (paths, in order) and which one is active,
  // whenever either changes.
  useEffect(() => {
    if (!tabsHydrated.current) return;
    const paths = tabs
      .map((tab) => tab.repoPath)
      .filter((path): path is string => typeof path === 'string');
    const activePath = tabs.find((tab) => tab.id === activeId)?.repoPath ?? null;
    void window.api.repo.saveOpenTabs(paths, activePath);
  }, [tabs, activeId]);

  const dismissToast = useCallback((id: string) => {
    setToasts((prev) => prev.filter((toast) => toast.id !== id));
  }, []);

  const showToast = (
    title: string,
    message?: string,
    variant: ToastVariant = 'info',
  ) => {
    setToasts((prev) => [
      ...prev,
      { id: `toast-${nextToastId++}`, title, message, variant },
    ]);
  };

  const addTab = () => {
    const id = `tab-${nextTabId++}`;
    setTabs((prev) => [...prev, { id, title: 'New Tab' }]);
    setActiveId(id);
  };

  const closeTab = (id: string) => {
    const index = tabs.findIndex((tab) => tab.id === id);
    if (index === -1) return;

    // Always keep at least one tab open. When the only tab has a repo, closing
    // it drops the repo and replaces it with a fresh empty tab; an already-empty
    // sole tab has nothing to close.
    if (tabs.length === 1) {
      if (!tabs[0].repoPath) return;
      const fresh: Tab = { id: `tab-${nextTabId++}`, title: 'New Tab' };
      setTabs([fresh]);
      setActiveId(fresh.id);
      return;
    }

    const next = tabs.filter((tab) => tab.id !== id);
    setTabs(next);
    if (id === activeId) {
      setActiveId(next[Math.min(index, next.length - 1)].id);
    }
  };

  /** Move the tab with `id` so it occupies `toIndex` in the new order. */
  const reorderTab = (id: string, toIndex: number) => {
    setTabs((prev) => {
      const from = prev.findIndex((tab) => tab.id === id);
      if (from === -1) return prev;
      const next = [...prev];
      const [moved] = next.splice(from, 1);
      // toIndex was computed against the original array; account for the
      // removed element when it sat before the drop position.
      next.splice(from < toIndex ? toIndex - 1 : toIndex, 0, moved);
      return next;
    });
  };

  /** Bind a repository to the active tab, turning it into an open-repo tab. */
  const openRepo = (repo: RepoInfo) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeId
          ? { ...tab, title: repo.name, repoPath: repo.path }
          : tab,
      ),
    );
    // Let the main process record recency (stamp the time, de-dupe, persist)
    // and drive the list off the authoritative result it returns.
    void window.api.repo.recordOpened(repo).then(setRecentRepos);
  };

  /** Drop a repository from the persisted recent list. */
  const removeRecent = (repo: RecentRepo) => {
    void window.api.repo.forget(repo.path).then(setRecentRepos);
  };

  /** Pick a folder on disk and open it as a git repository in the active tab. */
  const handleOpen = async () => {
    const result = await window.api.repo.open();
    if (result.status === 'opened') {
      openRepo(result.repo);
    } else if (result.status === 'not-a-repo') {
      // Leave the active tab on the default view and surface the reason.
      showToast(
        'Not a Git repository',
        `“${folderName(result.path)}” isn’t under version control.`,
        'error',
      );
    }
  };

  // TODO: clone/create still need native dialogs from the main process,
  // wired through window.api once their IPC channels exist.
  const notImplemented = (action: string) => {
    console.warn(`Repository "${action}" is not wired up yet.`);
  };

  // The CloneDialog runs the clone and reports the finished repo; open it in
  // the active tab (recording recency), same as opening from disk.
  const handleCloned = (repo: RepoInfo) => {
    setCloneOpen(false);
    openRepo(repo);
    showToast('Repository cloned', `“${repo.name}” is ready.`, 'info');
  };

  return (
    <div className={isMac ? 'app is-mac' : 'app'}>
      <header className="topbar">
        <TabBar
          tabs={tabs}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onAdd={addTab}
          onReorder={reorderTab}
        />
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => {
              setSettingsSection(undefined);
              setSettingsOpen(true);
            }}
          >
            <GearIcon />
          </button>
        </div>
      </header>

      <main className={activeTab.repoPath ? 'content content-repo' : 'content'}>
        {activeTab.repoPath ? (
          <RepoView
            title={activeTab.title}
            repoPath={activeTab.repoPath}
            onError={(title, message) => showToast(title, message, 'error')}
            onNotice={(title, message) => showToast(title, message, 'info')}
            onOpenSettings={(section) => {
              setSettingsSection(section);
              setSettingsOpen(true);
            }}
          />
        ) : (
          <RepoStart
            recent={recentRepos}
            onOpen={() => void handleOpen()}
            onClone={() => setCloneOpen(true)}
            onCreate={() => notImplemented('create')}
            onSelectRecent={openRepo}
            onRemoveRecent={removeRecent}
          />
        )}
      </main>

      <footer className="statusbar">
        {activeTab.repoPath && <ActivityLog repoPath={activeTab.repoPath} />}
        {renderUpdateButton(update, updateStatus)}
        <span className="statusbar-version">v{window.api.version}</span>
      </footer>

      {settingsOpen && (
        <Settings
          initialSection={settingsSection}
          onClose={() => setSettingsOpen(false)}
        />
      )}

      {cloneOpen && (
        <CloneDialog
          onCloned={handleCloned}
          onClose={() => setCloneOpen(false)}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
