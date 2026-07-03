import { useCallback, useEffect, useState } from 'react';
import { TabBar, type Tab } from './components/TabBar';
import { RepoStart, type RecentRepo } from './components/RepoStart';
import { ToastStack, type ToastData, type ToastVariant } from './components/Toast';
import { Settings } from './components/Settings';
import { CloneDialog } from './components/CloneDialog';
import { GearIcon } from '../../../assets/icons';
import type { RepoInfo } from '../../types/ipc';

let nextTabId = 2;
let nextToastId = 1;

/** Last path segment, tolerant of both POSIX and Windows separators. */
const folderName = (fullPath: string) =>
  fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;

export function App() {
  const isMac = window.api.platform === 'darwin';
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'tab-1', title: 'New Tab' },
  ]);
  const [activeId, setActiveId] = useState('tab-1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [cloneOpen, setCloneOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);

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
        />
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button"
            aria-label="Settings"
            title="Settings"
            onClick={() => setSettingsOpen(true)}
          >
            <GearIcon />
          </button>
        </div>
      </header>

      <main className="content">
        {activeTab.repoPath ? (
          <>
            <h1>{activeTab.title}</h1>
            <p className="subtitle">{activeTab.repoPath}</p>
          </>
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

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

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
