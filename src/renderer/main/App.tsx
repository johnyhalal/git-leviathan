import { useCallback, useState } from 'react';
import { TabBar, type Tab } from './components/TabBar';
import { RepoStart, type RecentRepo } from './components/RepoStart';
import { ToastStack, type ToastData, type ToastVariant } from './components/Toast';
import { Settings } from './components/Settings';
import { GearIcon } from '../../../assets/icons';

let nextTabId = 2;
let nextToastId = 1;

/** Last path segment, tolerant of both POSIX and Windows separators. */
const folderName = (fullPath: string) =>
  fullPath.split(/[\\/]/).filter(Boolean).pop() ?? fullPath;

// TODO: replace with repositories persisted by the main process (needs an IPC
// channel in src/types/ipc.ts). Placeholder data until that lands.
const RECENT_REPOS: RecentRepo[] = [];

export function App() {
  const isMac = window.api.platform === 'darwin';
  const [tabs, setTabs] = useState<Tab[]>([
    { id: 'tab-1', title: 'New Tab' },
  ]);
  const [activeId, setActiveId] = useState('tab-1');
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);

  const activeTab = tabs.find((tab) => tab.id === activeId) ?? tabs[0];

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
  const openRepo = (repo: RecentRepo) => {
    setTabs((prev) =>
      prev.map((tab) =>
        tab.id === activeId
          ? { ...tab, title: repo.name, repoPath: repo.path }
          : tab,
      ),
    );
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
            recent={RECENT_REPOS}
            onOpen={() => void handleOpen()}
            onClone={() => notImplemented('clone')}
            onCreate={() => notImplemented('create')}
            onSelectRecent={openRepo}
          />
        )}
      </main>

      {settingsOpen && <Settings onClose={() => setSettingsOpen(false)} />}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
    </div>
  );
}
