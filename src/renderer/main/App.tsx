import { useCallback, useEffect, useRef, useState } from 'react';
import { TabBar, type Tab } from './components/TabBar';
import { RepoStart, type RecentRepo } from './components/RepoStart';
import {
  ToastStack,
  type ToastAction,
  type ToastData,
  type ToastVariant,
} from './components/Toast';
import { Settings } from './components/Settings';
import { CloneDialog } from './components/CloneDialog';
import { FeedbackDialog } from './components/FeedbackDialog';
import { TooltipLayer } from './components/TooltipLayer';
import { RepoView } from './components/repo/RepoView';
import { ActivityLog } from './components/repo/ActivityLog';
import { GearIcon, FeedbackIcon } from '../../../assets/icons';
import kofiLogo from '../../../assets/kofi_logo.webp';
import type { RepoInfo, UpdateInfo, UpdateStatus } from '../../types/ipc';
import { DEFAULT_UPDATE_CHECK_INTERVAL } from '../../types/ipc';

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
        className="statusbar-update tooltip-host"
        data-tooltip="Restart to finish updating"
        onClick={() => api.install()}
      >
        Restart to update{version ? ` (v${version})` : ''}
      </button>
    );
  }

  // Fetching in the background — plain text (not a button; nothing to click)
  // with an indeterminate progress bar. Squirrel's autoUpdater emits no
  // download-progress events, so we can't show a real percentage.
  if (status.state === 'downloading') {
    return (
      <span className="statusbar-download tooltip-host" data-tooltip="Downloading the update">
        <span>Downloading update{version ? ` v${version}` : ''}…</span>
        <span className="statusbar-progress" aria-hidden="true">
          <span className="statusbar-progress-bar" />
        </span>
      </span>
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
      className="statusbar-update tooltip-host"
      data-tooltip={canAutoUpdate ? 'Download and install the update' : 'Open the release page'}
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
  const [feedbackOpen, setFeedbackOpen] = useState(false);
  const [toasts, setToasts] = useState<ToastData[]>([]);
  // Bumped to ask the status-bar ActivityLog to open (e.g. from a hook-failure toast).
  const [activityLogSignal, setActivityLogSignal] = useState(0);
  const [recentRepos, setRecentRepos] = useState<RecentRepo[]>([]);
  const [update, setUpdate] = useState<UpdateInfo | null>(null);
  const [updateStatus, setUpdateStatus] = useState<UpdateStatus>({
    state: 'idle',
    supported: false,
  });
  // Auto-update check interval in minutes (0 = never), read from settings and
  // re-read whenever the Settings modal closes so a change applies live.
  const [checkIntervalMin, setCheckIntervalMin] = useState(
    DEFAULT_UPDATE_CHECK_INTERVAL,
  );
  // Gate tab persistence until the initial restore has run, so the default
  // empty tab can't overwrite the saved list before it's loaded.
  const tabsHydrated = useRef(false);
  // Cache of "is this path a linked worktree?", keyed by repo path, so each open
  // tab can show a worktree (tree) icon. Filled lazily from the main process.
  const [worktreeByPath, setWorktreeByPath] = useState<Record<string, boolean>>({});

  // Look up any open repo path we haven't classified yet. The `in` guard keeps
  // each path to a single query even as this re-runs when the cache updates.
  useEffect(() => {
    for (const path of new Set(
      tabs.map((tab) => tab.repoPath).filter((p): p is string => !!p),
    )) {
      if (path in worktreeByPath) continue;
      void window.api.repo.isWorktree(path).then((is) =>
        setWorktreeByPath((prev) => (path in prev ? prev : { ...prev, [path]: is })),
      );
    }
  }, [tabs, worktreeByPath]);

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

  // Reflect every release-check result — from the timer below, from another
  // window, or from the settings "Check now" button — in the status-bar button.
  // The main process broadcasts the outcome, so this is the single writer of
  // `update` state (a failed/offline check doesn't broadcast, so it can't clear
  // a genuine pending update).
  useEffect(() => window.api.update.onFound(setUpdate), []);

  // Trigger a GitHub check on mount and on the configured interval; the result
  // arrives via `onFound` above. An interval of 0 means "never check
  // automatically" — the mount check still runs, but no timer is scheduled.
  useEffect(() => {
    const run = () => void window.api.update.check();
    run();
    const id =
      checkIntervalMin > 0
        ? setInterval(run, checkIntervalMin * 60 * 1000)
        : undefined;
    return () => {
      if (id !== undefined) clearInterval(id);
    };
  }, [checkIntervalMin]);

  // Load the persisted check interval on mount, and re-read it each time the
  // Settings modal closes so a change there re-schedules the timer above.
  useEffect(() => {
    if (settingsOpen) return;
    let alive = true;
    void window.api.app.getUpdateCheckInterval().then((minutes) => {
      if (alive) setCheckIntervalMin(minutes);
    });
    return () => {
      alive = false;
    };
  }, [settingsOpen]);

  // Track the in-app auto-updater (download → ready → install) so the status-bar
  // button can drive it. On builds where auto-update isn't supported this stays
  // `supported: false` and the button falls back to opening the release page.
  // On the transition into `ready`, raise a persistent toast once — a downloaded
  // update is easy to miss, and it stays up until the user acts or dismisses it.
  const prevUpdateState = useRef<UpdateStatus['state']>('idle');
  useEffect(
    () =>
      window.api.update.onStatus((next) => {
        setUpdateStatus(next);
        if (prevUpdateState.current !== 'ready' && next.state === 'ready') {
          showToast(
            'Update ready',
            `Restart GitLeviathan to finish updating${
              next.version ? ` to v${next.version}` : ''
            }.`,
            'info',
            {
              persistent: true,
              action: {
                label: 'Restart',
                onClick: () => window.api.update.install(),
              },
            },
          );
        }
        prevUpdateState.current = next.state;
      }),
    [],
  );

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
    options?: { persistent?: boolean; action?: ToastAction },
  ) => {
    setToasts((prev) => [
      ...prev,
      {
        id: `toast-${nextToastId++}`,
        title,
        message,
        variant,
        persistent: options?.persistent,
        action: options?.action,
      },
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

  /**
   * Close every tab whose repo is at `path` — used when a worktree is removed, so
   * its (now-deleted) folder isn't left open. Keeps at least one tab, replacing an
   * emptied-out list with a fresh blank tab, and moves off a closed active tab.
   */
  const closeTabsForPath = (path: string) => {
    const remaining = tabs.filter((tab) => tab.repoPath !== path);
    if (remaining.length === tabs.length) return; // nothing matched
    if (remaining.length === 0) {
      const fresh: Tab = { id: `tab-${nextTabId++}`, title: 'New Tab' };
      setTabs([fresh]);
      setActiveId(fresh.id);
      return;
    }
    setTabs(remaining);
    if (!remaining.some((tab) => tab.id === activeId)) {
      setActiveId(remaining[remaining.length - 1].id);
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

  /**
   * Bind a repository to the active tab, turning it into an open-repo tab. If the
   * repo is already open in another tab, switch to that one instead of opening a
   * duplicate.
   */
  const openRepo = (repo: RepoInfo) => {
    const existing = tabs.find(
      (tab) => tab.repoPath === repo.path && tab.id !== activeId,
    );
    if (existing) {
      setActiveId(existing.id);
      return;
    }
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

  /**
   * Open a repository in a brand-new tab (e.g. a worktree's folder). If a tab for
   * that path is already open, just switch to it rather than opening a duplicate.
   */
  const openRepoInNewTab = (repo: RepoInfo) => {
    const existing = tabs.find((tab) => tab.repoPath === repo.path);
    if (existing) {
      setActiveId(existing.id);
      return;
    }
    const id = `tab-${nextTabId++}`;
    setTabs((prev) => [...prev, { id, title: repo.name, repoPath: repo.path }]);
    setActiveId(id);
    void window.api.repo.recordOpened(repo).then(setRecentRepos);
  };

  /** Drop a repository from the persisted recent list. */
  const removeRecent = (repo: RecentRepo) => {
    void window.api.repo.forget(repo.path).then(setRecentRepos);
  };

  /** Star/unstar a recent repository so it pins to the top of the list. */
  const toggleFavorite = (repo: RecentRepo) => {
    void window.api.repo
      .setFavorite(repo.path, !repo.favorite)
      .then(setRecentRepos);
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
          tabs={tabs.map((tab) =>
            tab.repoPath ? { ...tab, isWorktree: worktreeByPath[tab.repoPath] } : tab,
          )}
          activeId={activeId}
          onSelect={setActiveId}
          onClose={closeTab}
          onAdd={addTab}
          onReorder={reorderTab}
        />
        <div className="topbar-actions">
          <button
            type="button"
            className="icon-button tooltip-host"
            aria-label="Settings"
            data-tooltip="Settings"
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
            onError={(title, message, opts) =>
              showToast(
                title,
                message,
                'error',
                opts?.activityLog
                  ? {
                      action: {
                        label: 'View log',
                        onClick: () => setActivityLogSignal((n) => n + 1),
                      },
                    }
                  : undefined,
              )
            }
            onNotice={(title, message) => showToast(title, message, 'info')}
            onSuccess={(title, message) => showToast(title, message, 'green')}
            onOpenSettings={(section) => {
              setSettingsSection(section);
              setSettingsOpen(true);
            }}
            onOpenRepo={openRepo}
            onOpenRepoInNewTab={openRepoInNewTab}
            onWorktreeRemoved={closeTabsForPath}
          />
        ) : (
          <RepoStart
            recent={recentRepos}
            onOpen={() => void handleOpen()}
            onClone={() => setCloneOpen(true)}
            onCreate={() => notImplemented('create')}
            onSelectRecent={openRepo}
            onRemoveRecent={removeRecent}
            onToggleFavorite={toggleFavorite}
          />
        )}
      </main>

      <footer className="statusbar">
        {activeTab.repoPath && (
          <ActivityLog repoPath={activeTab.repoPath} openSignal={activityLogSignal} />
        )}
        {renderUpdateButton(update, updateStatus)}
        <button
            type="button"
            className="statusbar-kofi tooltip-host"
            data-tooltip="Support GitLeviathan on Ko-fi"
            aria-label="Support GitLeviathan on Ko-fi"
            onClick={() => window.api.app.openExternal('https://ko-fi.com/U7U51T7A0E')}
        >
          <img src={kofiLogo} alt="" width={16} height={13} />
        </button>
        <button
          type="button"
          className="statusbar-feedback tooltip-host"
          data-tooltip="Report a bug or request a feature"
          onClick={() => setFeedbackOpen(true)}
        >
          <FeedbackIcon size={13} />
          <span>Feedback</span>
        </button>
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

      {feedbackOpen && (
        <FeedbackDialog
          onClose={() => setFeedbackOpen(false)}
          onSubmitted={(issue) => {
            setFeedbackOpen(false);
            showToast(
              'Thanks for the feedback',
              `Opened issue #${issue.number}.`,
              'info',
              {
                action: {
                  label: 'View issue',
                  onClick: () => window.api.app.openExternal(issue.url),
                },
              },
            );
          }}
        />
      )}

      <ToastStack toasts={toasts} onDismiss={dismissToast} />
      <TooltipLayer />
    </div>
  );
}
