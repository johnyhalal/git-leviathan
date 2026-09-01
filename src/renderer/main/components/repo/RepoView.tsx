import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommitLogEntry,
  GitflowConfig,
  GitflowConfigResult,
  GitflowKind,
  MergeState,
  PullMode,
  RebaseCommitInfo,
  RebaseTodoEntry,
  RefsMutationResult,
  RepoConfig,
  RepoInfo,
  RepoRefs,
  ResetMode,
  UndoRedoState,
  WorkingStatus,
} from '../../../../types/ipc';
import { WORKING_TREE_HASH } from '../../../../types/ipc';
import { RepoToolbar } from './RepoToolbar';
import { RepoSettingsDialog, type RepoSettingsTabId } from './RepoSettingsDialog';
import { RepoColumns } from './RepoColumns';
import { MergeBanner } from './MergeBanner';
import { ConflictResolver } from './ConflictResolver';
import { CommitPlanEditor } from './CommitPlanEditor';
import { ConfirmProvider } from '../ConfirmBar';
import type { WorktreeRemoveOutcome } from './WorktreeContextMenu';
import type { SubmoduleDeinitOutcome } from './SubmoduleContextMenu';

interface RepoViewProps {
  title: string;
  repoPath: string;
  /** Surface a failure (e.g. a checkout or commit that couldn't complete). */
  onError?: (title: string, message: string, opts?: { activityLog?: boolean }) => void;
  /** Surface an informational note (e.g. a merge that was already up to date). */
  onNotice?: (title: string, message: string) => void;
  /** Surface a success (e.g. a completed push/pull) as a green toast. */
  onSuccess?: (title: string, message: string) => void;
  /** Open the settings modal, optionally to a specific section id. */
  onOpenSettings?: (section?: string) => void;
  /** Open a repository (e.g. a worktree's folder) in the current tab. */
  onOpenRepo?: (repo: RepoInfo) => void;
  /** Open a repository (e.g. a worktree's folder) in a new tab. */
  onOpenRepoInNewTab?: (repo: RepoInfo) => void;
  /**
   * A worktree at `path` was removed: close any tabs open on that folder. When a
   * closed tab was the active one, prefer switching to `originalRepoPath` (the
   * worktree's parent repo) if a tab for it is open.
   */
  onWorktreeRemoved?: (path: string, originalRepoPath?: string) => void;
}

/**
 * Top-level view for an open repository: a repo toolbar over a resizable
 * three-column body. Loads the repo's refs and commit history once (re-loading
 * on a checkout), and shares them with the toolbar, sidebar and commit list.
 */
/** How many commits to fetch per page (initial load and each "load more"). */
const PAGE_SIZE = 500;

export function RepoView({
  title,
  repoPath,
  onError,
  onNotice,
  onSuccess,
  onOpenSettings,
  onOpenRepo,
  onOpenRepoInNewTab,
  onWorktreeRemoved,
}: RepoViewProps) {
  void title;

  const [refs, setRefs] = useState<RepoRefs | null>(null);
  const [commits, setCommits] = useState<CommitLogEntry[] | null>(null);
  // The working-tree status, shared so both the synthetic top-of-list
  // "uncommitted" row and the commit panel reflect the same staged/unstaged set.
  const [workingStatus, setWorkingStatus] = useState<WorkingStatus | null>(null);
  // The commit message, lifted here so the working row's inline input and the
  // commit panel's textarea are two views of one value (edits mirror both ways).
  const [commitMessage, setCommitMessage] = useState('');
  // Whether another page might exist, and whether one is being fetched now.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // How many commits we've requested so far — the running `--max-count` cap.
  const loadedCountRef = useRef(0);
  // Guards the focus-driven refresh so overlapping focus events can't fire
  // concurrent re-reads.
  const refreshingRef = useRef(false);
  // Bumped after a checkout to re-run the loader with the new HEAD.
  const [reloadToken, setReloadToken] = useState(0);
  // Bumped after a push/pull lands so RepoColumns closes any open diff (a pull
  // can rewrite the file it was showing).
  const [closeDiffToken, setCloseDiffToken] = useState(0);
  const closeDiff = useCallback(() => setCloseDiffToken((token) => token + 1), []);
  // True while a push is in flight, to disable the toolbar button.
  const [pushing, setPushing] = useState(false);
  // True while a pull/fetch is in flight, to disable the toolbar button.
  const [pulling, setPulling] = useState(false);
  // True while the inline "new branch" input is shown at the HEAD commit.
  const [creatingBranch, setCreatingBranch] = useState(false);
  // The commit a tag is being created at via the inline name input (with whether
  // it's annotated), or null when not tagging.
  const [taggingAt, setTaggingAt] = useState<{ hash: string; annotated: boolean } | null>(null);
  // The tag names already present on the tag remote (from `git ls-remote`), so
  // the tag menu can hide "Push" for pushed tags and "Delete on remote" for
  // unpushed ones. `null` means it couldn't be determined (no remote, or the
  // remote was unreachable) — the menu then shows both actions.
  const [pushedTags, setPushedTags] = useState<Set<string> | null>(null);
  // Labels for the next undo/redo (from the reflog), or null when unavailable.
  // Refetched alongside refs/log so it tracks every HEAD move.
  const [undoRedo, setUndoRedo] = useState<UndoRedoState>({ undo: null, redo: null });
  // The in-progress merge/rebase/etc. conflict state, or null when the tree is
  // clean. Refreshed alongside refs/status; drives the banner and resolver.
  const [mergeState, setMergeState] = useState<MergeState | null>(null);
  // Whether the full-screen conflict resolver is open.
  const [resolverOpen, setResolverOpen] = useState(false);
  // The conflicted file to pre-select when the resolver opens (null = first).
  const [resolverFile, setResolverFile] = useState<string | null>(null);

  // The interactive-rebase editor's data (base commit + the commits it edits),
  // or null when it's closed.
  const [rebaseEditor, setRebaseEditor] = useState<{
    baseHash: string;
    commits: RebaseCommitInfo[];
  } | null>(null);
  // The multi-commit cherry-pick editor's data (the selected commits, oldest
  // first), or null when it's closed. Shares the editor UI with rebase above.
  const [cherryPickEditor, setCherryPickEditor] = useState<{
    commits: RebaseCommitInfo[];
  } | null>(null);
  // True while a continue/abort/skip is in flight, to disable the banner buttons.
  const [mergeBusy, setMergeBusy] = useState(false);
  // Whether the last read saw an in-progress operation, so we auto-open the
  // resolver only on the transition into conflicts (not on every refresh).
  const hadMergeRef = useRef(false);

  // Swap in a fresh merge state, opening the resolver the moment a repo first
  // enters a conflicted operation and closing it once everything is resolved.
  const applyMergeState = useCallback((next: MergeState | null) => {
    const was = hadMergeRef.current;
    hadMergeRef.current = next !== null;
    setMergeState(next);
    if (next && !was) {
      setResolverOpen(true);
      onNotice?.('Conflicts', `${next.description} — resolve the conflicts to continue.`);
    }
    if (!next) setResolverOpen(false);
  }, [onNotice]);
  const applyMergeRef = useRef(applyMergeState);
  applyMergeRef.current = applyMergeState;

  // Which repo's draft `commitMessage` currently reflects. Guards the save
  // effect below so the empty value shown while a draft loads can't clobber the
  // stored draft (the load is async).
  const draftLoadedFor = useRef<string | null>(null);

  // A typed-but-uncommitted message belongs to one repo. Load its persisted
  // draft when the tab switches to another repo (this view is reused across
  // repos, not remounted), so a message survives restarts like staged files do.
  useEffect(() => {
    let live = true;
    draftLoadedFor.current = null;
    setCommitMessage('');
    setCreatingBranch(false);
    setTaggingAt(null);
    setResolverOpen(false);
    hadMergeRef.current = false;
    void window.api.repo.commitDraft(repoPath).then((draft) => {
      if (!live) return;
      setCommitMessage(draft);
      draftLoadedFor.current = repoPath;
    });
    return () => {
      live = false;
    };
  }, [repoPath]);

  // Persist the draft (debounced) so it survives a restart. Skipped until the
  // draft for this repo has loaded, so the initial empty value can't wipe it.
  useEffect(() => {
    if (draftLoadedFor.current !== repoPath) return;
    const handle = window.setTimeout(() => {
      void window.api.repo.setCommitDraft(repoPath, commitMessage);
    }, 400);
    return () => window.clearTimeout(handle);
  }, [repoPath, commitMessage]);

  useEffect(() => {
    let live = true;
    setRefs(null);
    setCommits(null);
    setWorkingStatus(null);
    setHasMore(false);
    loadedCountRef.current = 0;
    void Promise.all([
      window.api.repo.listRefs(repoPath),
      window.api.repo.log(repoPath, PAGE_SIZE),
      window.api.repo.status(repoPath),
      window.api.repo.undoState(repoPath),
      window.api.repo.mergeState(repoPath),
    ]).then(([nextRefs, nextCommits, status, undo, merge]) => {
      if (!live) return;
      setRefs(nextRefs);
      setCommits(nextCommits);
      setWorkingStatus(status);
      setUndoRedo(undo);
      applyMergeRef.current(merge);
      loadedCountRef.current = PAGE_SIZE;
      // A full page back means there may be more; a short page is the end. Stash
      // rows are woven in on top of the real commits, so the count can exceed the
      // page size — compare with >= rather than exact equality.
      setHasMore(nextCommits.length >= PAGE_SIZE);
    });
    return () => {
      live = false;
    };
  }, [repoPath, reloadToken]);

  // Fetch the next page by growing the cap and re-reading the log. Re-reading
  // the whole range (rather than appending a slice) keeps the commit graph's
  // lane layout correct, since it's computed across the entire set at once.
  const loadMore = useCallback(async () => {
    if (loadingMore || !hasMore) return;
    setLoadingMore(true);
    const nextLimit = loadedCountRef.current + PAGE_SIZE;
    const nextCommits = await window.api.repo.log(repoPath, nextLimit);
    loadedCountRef.current = nextLimit;
    setCommits(nextCommits);
    setHasMore(nextCommits.length >= nextLimit);
    setLoadingMore(false);
  }, [repoPath, hasMore, loadingMore]);

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  // A failing merge/rebase/pull/stash-pop leaves the tree conflicted rather than
  // truly erroring. On any mutation failure, re-read the merge state first: if an
  // operation is now in progress, open the resolver (and reload) instead of
  // surfacing git's raw stderr as a scary toast; otherwise it's a real error.
  const surfaceConflictsOrError = useCallback(
    async (failureTitle: string, message: string) => {
      const merge = await window.api.repo.mergeState(repoPath);
      if (merge) {
        applyMergeRef.current(merge);
        reload();
      } else {
        onError?.(failureTitle, message);
      }
    },
    [repoPath, reload, onError],
  );

  // A seamless re-sync used when the window regains focus: re-read refs, the
  // commit log and the working status at the current page cap and swap them in
  // place — no nulling of state, so there's no loading flash and the scroll
  // position and selected commit survive. Unlike `reload()` this doesn't reset
  // pagination. Skipped while the initial load hasn't finished (`refs === null`),
  // while a page fetch is in flight (would race `loadedCountRef`/`commits`), or
  // while a prior refresh is still running.
  const refresh = useCallback(async () => {
    if (refs === null || loadingMore || refreshingRef.current) return;
    refreshingRef.current = true;
    try {
      const count = loadedCountRef.current || PAGE_SIZE;
      const [nextRefs, nextCommits, status, undo, merge] = await Promise.all([
        window.api.repo.listRefs(repoPath),
        window.api.repo.log(repoPath, count),
        window.api.repo.status(repoPath),
        window.api.repo.undoState(repoPath),
        window.api.repo.mergeState(repoPath),
      ]);
      setRefs(nextRefs);
      setCommits(nextCommits);
      setWorkingStatus(status);
      setUndoRedo(undo);
      applyMergeRef.current(merge);
      setHasMore(nextCommits.length >= count);
    } finally {
      refreshingRef.current = false;
    }
  }, [refs, loadingMore, repoPath]);

  // Always call the latest `refresh` from the long-lived subscriptions below
  // without re-subscribing on every render (refresh's identity changes each
  // time it swaps in new refs).
  const refreshRef = useRef(refresh);
  refreshRef.current = refresh;

  // Bring the remote-tracking refs up to date in the background, then re-sync if
  // the fetch actually ran — so ahead/behind counts and remote branches reflect
  // the server without the user pressing anything. The main process throttles
  // and dedupes the underlying `git fetch --all` and reports failures silently,
  // so this is safe to fire on every focus event.
  const backgroundFetch = useCallback(async () => {
    const result = await window.api.repo.backgroundFetch(repoPath);
    if (result.status === 'ok') void refreshRef.current();
  }, [repoPath]);

  const backgroundFetchRef = useRef(backgroundFetch);
  backgroundFetchRef.current = backgroundFetch;

  // Fetch when this repo becomes the tab on screen (RepoView renders only the
  // active tab, so a new `repoPath` means the user just focused that repo).
  useEffect(() => {
    void backgroundFetch();
  }, [backgroundFetch]);

  // Re-sync the view whenever the OS window regains focus, so edits made in an
  // editor or commits made from a terminal show up without a manual action, and
  // fetch so remote-side changes land too. The main process detects window focus
  // and broadcasts it (renderer-side `window` focus events are unreliable in
  // Electron).
  useEffect(
    () =>
      window.api.app.onWindowFocus(() => {
        void refreshRef.current();
        void backgroundFetchRef.current();
      }),
    [],
  );

  // Watch the working tree so external edits refresh the view the moment they
  // hit disk. This closes the gap left by focus alone: editors that write on
  // blur save the file just as the window gains focus, so the focus refresh can
  // read the pre-save state — the watcher then catches the write that follows.
  useEffect(() => {
    window.api.repo.watch(repoPath);
    const unsubscribe = window.api.repo.onRepoChanged((changed) => {
      if (changed === repoPath) void refreshRef.current();
    });
    return () => {
      unsubscribe();
      window.api.repo.watch(null);
    };
  }, [repoPath]);

  // Push the current branch to its upstream; on success reload so the branch's
  // ahead/behind counts refresh, on failure surface git's message via a toast.
  // When the branch has no upstream yet, resolve the pending remote/branch so the
  // toolbar can raise a confirm before publishing it (handled in `publishBranch`).
  const push = useCallback(async (): Promise<{ remote: string; branch: string } | null> => {
    if (pushing) return null;
    setPushing(true);
    const result = await window.api.repo.push(repoPath);
    setPushing(false);
    if (result.status === 'ok') {
      closeDiff();
      reload();
      const head = refs?.localBranches.find((b) => b.current);
      onSuccess?.(
        'Pushed successfully',
        head?.upstream
          ? `“${head.name}” pushed to “${head.upstream}”.`
          : 'Changes pushed to the remote.',
      );
    } else if (result.status === 'needs-upstream')
      return { remote: result.remote, branch: result.branch };
    else onError?.('Push failed', result.message);
    return null;
  }, [pushing, repoPath, reload, closeDiff, onError, onSuccess, refs]);

  // Publish a branch that has no upstream to `remote`, setting it as the upstream.
  // Runs after the user confirms the toolbar's "publish branch" bar. Reloads on
  // success; on failure surfaces git's message and throws so the confirm bar stays
  // open (its contract: a throwing action keeps the bar visible for a retry).
  const publishBranch = useCallback(
    async (remote: string, branch: string, remoteBranch: string) => {
      setPushing(true);
      const result = await window.api.repo.pushSetUpstream(repoPath, remote, branch, remoteBranch);
      setPushing(false);
      if (result.status === 'ok') {
        closeDiff();
        reload();
        onSuccess?.('Branch published', `“${branch}” published to “${remote}/${remoteBranch}”.`);
        return;
      }
      onError?.('Push failed', result.message);
      throw new Error(result.message);
    },
    [repoPath, reload, closeDiff, onError, onSuccess],
  );

  // Pull/fetch the current branch; reload on success (HEAD, log and ahead/behind
  // all move), surface git's message on failure.
  const pull = useCallback(
    async (mode: PullMode) => {
      if (pulling) return;
      setPulling(true);
      const result = await window.api.repo.pull(repoPath, mode);
      setPulling(false);
      if (result.status === 'ok') {
        closeDiff();
        reload();
        const head = refs?.localBranches.find((b) => b.current);
        if (mode === 'fetch-all') onSuccess?.('Fetched', 'Fetched all remotes.');
        else
          onSuccess?.(
            'Pulled successfully',
            head?.upstream
              ? `“${head.name}” updated from “${head.upstream}”.`
              : 'Pulled from the remote.',
          );
      } else {
        // A failed pull can still have moved things — the auto-stash of local
        // changes may have been left behind — so re-sync before reporting.
        reload();
        await surfaceConflictsOrError('Pull failed', result.message);
      }
    },
    [pulling, repoPath, reload, closeDiff, surfaceConflictsOrError, onSuccess, refs],
  );

  const checkout = useCallback(
    async (branch: string, remote?: string) => {
      const result = await window.api.repo.checkout(repoPath, branch, remote);
      if (result.status === 'ok') reload();
      else onError?.('Checkout failed', result.message);
    },
    [repoPath, onError, reload],
  );

  // Create a branch at HEAD from the inline toolbar input and check it out; on
  // success close the input and reload so the new branch becomes HEAD, on failure
  // keep the input open and surface git's message.
  const createBranch = useCallback(
    async (name: string) => {
      const result = await window.api.repo.createBranch(repoPath, name);
      if (result.status === 'ok') {
        setCreatingBranch(false);
        reload();
      } else onError?.('Branch failed', result.message);
    },
    [repoPath, reload, onError],
  );

  // Begin the inline tag flow at a specific commit (from a commit row's menu).
  const startTag = useCallback(
    (hash: string, annotated: boolean) => setTaggingAt({ hash, annotated }),
    [],
  );

  // Begin the inline tag flow at a branch's tip (from a sidebar branch menu),
  // resolving the tip's hash from the loaded commits — the tip carries the
  // branch's decoration — so the name input rides that commit's row.
  const startTagAtBranch = useCallback(
    (branch: string, annotated: boolean) => {
      const tip = commits?.find((commit) =>
        commit.refs.some((ref) => ref.label === branch),
      );
      if (tip) setTaggingAt({ hash: tip.hash, annotated });
      else onError?.('Tag failed', `Couldn't locate “${branch}” in the loaded history.`);
    },
    [commits, onError],
  );

  // Create a lightweight tag at `hash`; on success clear the inline input and
  // reload so the new tag badge appears, on failure surface git's message.
  const createTag = useCallback(
    async (hash: string, name: string) => {
      const result = await window.api.repo.createTag(repoPath, name, hash, null);
      if (result.status === 'ok') {
        setTaggingAt(null);
        reload();
      } else onError?.('Tag failed', result.message);
    },
    [repoPath, reload, onError],
  );

  // Create an annotated tag at `hash` with `message` (collected in the confirm
  // bar after the inline name step). Same success/failure handling as above.
  const createAnnotatedTag = useCallback(
    async (hash: string, name: string, message: string) => {
      const result = await window.api.repo.createTag(repoPath, name, hash, message);
      if (result.status === 'ok') {
        setTaggingAt(null);
        reload();
      } else onError?.('Tag failed', result.message);
    },
    [repoPath, reload, onError],
  );

  // Stash / gitflow / branch deletion all mutate the repo and hand back fresh
  // refs; on success we just reload, on failure we surface git's message via the
  // toast channel (or the conflict resolver, when the failure left conflicts).
  const runMutation = useCallback(
    async (
      failureTitle: string,
      run: () => Promise<RefsMutationResult>,
    ) => {
      const result = await run();
      if (result.status === 'ok') {
        reload();
        // A successful-but-no-op mutation (e.g. an already-up-to-date merge)
        // carries a note so the user isn't left wondering what happened.
        if (result.notice) onNotice?.('Nothing to do', result.notice);
      } else await surfaceConflictsOrError(failureTitle, result.message);
      return result;
    },
    [onNotice, reload, surfaceConflictsOrError],
  );

  // Undo/redo the last HEAD-moving action; both reload on success (HEAD, log and
  // refs all move) and surface git's message — e.g. the "commit or stash first"
  // guard — on failure, like every other mutation.
  const undo = useCallback(
    () => runMutation('Undo failed', () => window.api.repo.undo(repoPath)),
    [repoPath, runMutation],
  );
  const redo = useCallback(
    () => runMutation('Redo failed', () => window.api.repo.redo(repoPath)),
    [repoPath, runMutation],
  );

  // Keyboard shortcuts for the toolbar's undo/redo: Cmd/Ctrl+Z undoes,
  // Cmd/Ctrl+R (and the conventional Cmd/Ctrl+Shift+Z / Ctrl+Y) redoes. Typing
  // in a field keeps its native text undo — git history is only touched when
  // focus is outside an editor. The reload accelerator is dropped from the app
  // menu in the main process so Cmd/Ctrl+R reaches the page at all.
  useEffect(() => {
    const isEditable = (node: EventTarget | null) => {
      const el = node as HTMLElement | null;
      if (!el || typeof el.closest !== 'function') return false;
      return Boolean(el.closest('input, textarea, select, [contenteditable=""], [contenteditable="true"]'));
    };
    const onKeyDown = (event: KeyboardEvent) => {
      if (!(event.metaKey || event.ctrlKey) || event.altKey) return;
      if (event.repeat || isEditable(event.target)) return;
      const key = event.key.toLowerCase();
      const wantsUndo = key === 'z' && !event.shiftKey;
      const wantsRedo = (key === 'z' && event.shiftKey) || key === 'r' || key === 'y';
      if (!wantsUndo && !wantsRedo) return;
      event.preventDefault();
      if (wantsUndo && undoRedo.undo) void undo();
      else if (wantsRedo && undoRedo.redo) void redo();
    };
    window.addEventListener('keydown', onKeyDown);
    return () => window.removeEventListener('keydown', onKeyDown);
  }, [undo, redo, undoRedo.undo, undoRedo.redo]);

  const stashPush = useCallback(
    () =>
      runMutation('Stash failed', () => window.api.repo.stashPush(repoPath)),
    [repoPath, runMutation],
  );

  const stashApply = useCallback(
    (index: number) =>
      runMutation('Stash apply failed', () =>
        window.api.repo.stashApply(repoPath, index),
      ),
    [repoPath, runMutation],
  );

  const stashPop = useCallback(
    (index: number) =>
      runMutation('Stash pop failed', () =>
        window.api.repo.stashPop(repoPath, index),
      ),
    [repoPath, runMutation],
  );

  const stashDrop = useCallback(
    (index: number) =>
      runMutation('Stash drop failed', () =>
        window.api.repo.stashDrop(repoPath, index),
      ),
    [repoPath, runMutation],
  );

  const worktreeRemove = useCallback(
    async (
      path: string,
      force: boolean,
      deleteBranch: boolean,
    ): Promise<WorktreeRemoveOutcome> => {
      const result = await window.api.repo.worktreeRemove(repoPath, path, {
        force,
        deleteBranch,
      });
      if (result.status === 'ok') {
        // The worktree's parent repo — its main worktree, listed from any worktree
        // — so a closed tab can fall back to the original repo's tab if it's open.
        const originalRepo = refs?.worktrees.find((tree) => tree.isMain)?.path;
        reload();
        // Close any tabs still open on the now-removed worktree folder.
        onWorktreeRemoved?.(path, originalRepo);
        return 'ok';
      }
      // git refuses to delete a worktree with uncommitted/untracked changes (or a
      // locked one) unless --force is given — its message says "use --force". Let
      // the caller offer to force rather than surfacing that as a dead-end error.
      if (!force && /--force/.test(result.message)) return 'needs-force';
      onError?.('Remove worktree failed', result.message);
      return 'error';
    },
    [repoPath, refs, reload, onWorktreeRemoved, onError],
  );

  // --- Submodules -----------------------------------------------------------
  // Every one goes through `runMutation`, so a success reloads the repo and the
  // main process' `notice` (e.g. "committed to record it") surfaces as an info
  // toast. Passing no path means "every submodule" — what the section header's
  // "update all" button does.

  const submoduleInit = useCallback(
    (path?: string) =>
      runMutation('Initialize submodule failed', () =>
        window.api.repo.submoduleInit(repoPath, path),
      ),
    [repoPath, runMutation],
  );

  const submoduleUpdate = useCallback(
    (path?: string) =>
      runMutation('Update submodule failed', () =>
        window.api.repo.submoduleUpdate(repoPath, path),
      ),
    [repoPath, runMutation],
  );

  const submoduleUpdateRemote = useCallback(
    (path: string) =>
      runMutation('Update submodule failed', () =>
        window.api.repo.submoduleUpdateRemote(repoPath, path),
      ),
    [repoPath, runMutation],
  );

  const submoduleSync = useCallback(
    (path: string) =>
      runMutation('Sync submodule failed', () =>
        window.api.repo.submoduleSync(repoPath, path),
      ),
    [repoPath, runMutation],
  );

  const submoduleDeinit = useCallback(
    async (path: string, force: boolean): Promise<SubmoduleDeinitOutcome> => {
      const result = await window.api.repo.submoduleDeinit(repoPath, path, force);
      if (result.status === 'ok') {
        reload();
        return 'ok';
      }
      // git refuses to deinit a submodule with local modifications unless --force
      // is given — its message says so. Let the caller offer to force rather than
      // surfacing that as a dead-end error.
      if (!force && /--force|-f\b/.test(result.message)) return 'needs-force';
      onError?.('Deinitialize submodule failed', result.message);
      return 'error';
    },
    [repoPath, reload, onError],
  );

  const submoduleRemove = useCallback(
    (path: string) =>
      runMutation('Remove submodule failed', () =>
        window.api.repo.submoduleRemove(repoPath, path),
      ),
    [repoPath, runMutation],
  );

  const worktreeLock = useCallback(
    (path: string, lock: boolean, reason?: string) =>
      runMutation(lock ? 'Lock worktree failed' : 'Unlock worktree failed', () =>
        window.api.repo.worktreeLock(repoPath, path, lock, reason),
      ),
    [repoPath, runMutation],
  );

  // A worktree's folder opened as a repository — in this tab or a new one. The
  // folder name is the tab title, matching how repos open elsewhere.
  const worktreeRepo = (path: string): RepoInfo => ({
    name: path.replace(/[/\\]+$/, '').split(/[/\\]/).pop() || path,
    path,
  });
  const openWorktreeHere = useCallback(
    (path: string) => onOpenRepo?.(worktreeRepo(path)),
    [onOpenRepo],
  );
  const openWorktreeInNewTab = useCallback(
    (path: string) => onOpenRepoInNewTab?.(worktreeRepo(path)),
    [onOpenRepoInNewTab],
  );

  // The repo's gitflow config (branch names + prefixes), or null when it hasn't
  // been configured yet — which makes the sidebar's `+` open the settings dialog
  // rather than the actions popover. Loaded per repo.
  const [gitflowConfig, setGitflowConfig] = useState<GitflowConfig | null>(null);
  useEffect(() => {
    let live = true;
    setGitflowConfig(null);
    void window.api.repo.gitflowConfig(repoPath).then((config) => {
      if (live) setGitflowConfig(config);
    });
    return () => {
      live = false;
    };
  }, [repoPath]);

  const gitflowSaveConfig = useCallback(
    async (config: GitflowConfig): Promise<GitflowConfigResult> => {
      const result = await window.api.repo.gitflowSaveConfig(repoPath, config);
      if (result.status === 'ok') setGitflowConfig(result.config);
      return result;
    },
    [repoPath],
  );

  // Per-repository settings dialog (commit identity + remotes + gitflow + LFS).
  // The identity is fetched fresh each time the dialog opens; `null` while it
  // loads. `repoSettingsTab` picks the tab to open on (e.g. deep-linked from the
  // gitflow start dialog's settings gear).
  const [repoSettingsOpen, setRepoSettingsOpen] = useState(false);
  const [repoSettingsTab, setRepoSettingsTab] = useState<RepoSettingsTabId>('general');
  const [repoConfig, setRepoConfig] = useState<RepoConfig | null>(null);
  const openRepoSettings = useCallback((tab: RepoSettingsTabId = 'general') => {
    setRepoSettingsTab(tab);
    setRepoSettingsOpen(true);
  }, []);
  useEffect(() => {
    if (!repoSettingsOpen) return;
    let live = true;
    setRepoConfig(null);
    void window.api.repo.repoConfig(repoPath).then((config) => {
      if (live) setRepoConfig(config);
    });
    return () => {
      live = false;
    };
  }, [repoSettingsOpen, repoPath]);

  const gitflowStart = useCallback(
    (kind: GitflowKind, name: string, source: string) =>
      runMutation('Gitflow start failed', () =>
        window.api.repo.gitflowStart(repoPath, kind, name, source),
      ),
    [repoPath, runMutation],
  );

  const gitflowFinish = useCallback(
    () =>
      runMutation('Gitflow finish failed', () =>
        window.api.repo.gitflowFinish(repoPath),
      ),
    [repoPath, runMutation],
  );

  // Dragging one branch badge onto another integrates the dragged (source)
  // branch into the drop target: both check out the target first, then merge /
  // rebase the source into it.
  const mergeBranch = useCallback(
    (source: string, target: string) =>
      runMutation('Merge failed', () =>
        window.api.repo.merge(repoPath, source, target),
      ),
    [repoPath, runMutation],
  );

  const rebaseBranch = useCallback(
    (source: string, target: string) =>
      runMutation('Rebase failed', () =>
        window.api.repo.rebase(repoPath, source, target),
      ),
    [repoPath, runMutation],
  );

  // Fast-forward the local branch `target` to `source` (dragging a branch onto
  // another in the sidebar). Same mutation shape as merge/rebase.
  const fastForward = useCallback(
    (source: string, target: string) =>
      runMutation('Fast-forward failed', () =>
        window.api.repo.fastForward(repoPath, source, target),
      ),
    [repoPath, runMutation],
  );

  // Cherry-pick a commit onto the checked-out branch (from a commit's context
  // menu). Conflicts surface the resolver, like merge/rebase.
  const cherryPick = useCallback(
    (hash: string) =>
      runMutation('Cherry-pick failed', () =>
        window.api.repo.cherryPick(repoPath, hash),
      ),
    [repoPath, runMutation],
  );

  // Open the multi-commit cherry-pick editor for a set of selected commits. The
  // preview resolves them to full info (with messages), rejects merges, and
  // orders them oldest-first; an error (e.g. a merge in the set) surfaces as a
  // toast. A single selection falls back to the plain one-shot cherry-pick.
  const openCherryPick = useCallback(
    async (hashes: string[]) => {
      if (hashes.length <= 1) {
        if (hashes[0]) void cherryPick(hashes[0]);
        return;
      }
      const preview = await window.api.repo.cherryPickPreview(repoPath, hashes);
      if (preview.error || preview.commits.length === 0) {
        onError?.('Cherry-pick', preview.error ?? 'Nothing to cherry-pick.');
        return;
      }
      setCherryPickEditor({ commits: preview.commits });
    },
    [repoPath, cherryPick, onError],
  );

  // Run the editor's compiled cherry-pick plan onto HEAD. Same mutation shape as
  // the single cherry-pick: conflicts leave it in progress and surface the resolver.
  const runCherryPickMulti = useCallback(
    (todo: RebaseTodoEntry[]) =>
      runMutation('Cherry-pick failed', () =>
        window.api.repo.cherryPickMulti(repoPath, todo),
      ).then(() => undefined),
    [repoPath, runMutation],
  );

  // Rebase the checked-out branch onto a commit (from a commit's context menu),
  // replaying its commits on top. Conflicts surface the resolver, like a branch
  // rebase.
  const rebaseOnto = useCallback(
    (hash: string) =>
      runMutation('Rebase failed', () =>
        window.api.repo.rebaseOnto(repoPath, hash),
      ),
    [repoPath, runMutation],
  );

  // Open the interactive-rebase editor for `hash`'s children (the commits on top
  // of it up to HEAD). The preview does the reachability/merge checks in main; an
  // error (e.g. the commit isn't on the current branch) surfaces as a toast.
  const openInteractiveRebase = useCallback(
    async (hash: string) => {
      const preview = await window.api.repo.rebaseInteractivePreview(repoPath, hash);
      if (preview.error || preview.commits.length === 0) {
        onError?.('Interactive rebase', preview.error ?? 'Nothing to rebase from this commit.');
        return;
      }
      setRebaseEditor({ baseHash: preview.baseHash, commits: preview.commits });
    },
    [repoPath, onError],
  );

  // Run the editor's compiled plan. Same mutation shape as the other rebases:
  // conflicts leave the rebase in progress and surface the resolver/banner.
  const runInteractiveRebase = useCallback(
    (baseHash: string, todo: RebaseTodoEntry[]) =>
      runMutation('Interactive rebase failed', () =>
        window.api.repo.rebaseInteractive(repoPath, baseHash, todo),
      ).then(() => undefined),
    [repoPath, runMutation],
  );

  // Revert a commit (from a commit's context menu), recording a new commit that
  // undoes it on the checked-out branch. Conflicts surface the resolver, like
  // cherry-pick.
  const revert = useCallback(
    (hash: string) =>
      runMutation('Revert failed', () =>
        window.api.repo.revert(repoPath, hash),
      ),
    [repoPath, runMutation],
  );

  // Check out a commit itself (from a commit's context menu), which detaches HEAD
  // from whatever branch it was on. Same mutation shape as a branch checkout.
  const checkoutCommit = useCallback(
    (hash: string) =>
      runMutation('Checkout failed', () =>
        window.api.repo.checkoutCommit(repoPath, hash),
      ),
    [repoPath, runMutation],
  );

  // Move the checked-out branch back to `hash`. The reset lands in the reflog, so
  // the toolbar's Undo can take it back — the work a `hard` reset discards is gone
  // for good, which is why the menu confirms that mode before calling in.
  const resetTo = useCallback(
    (hash: string, mode: ResetMode) =>
      runMutation('Reset failed', () => window.api.repo.reset(repoPath, hash, mode)),
    [repoPath, runMutation],
  );

  const resetPreview = useCallback(
    (hash: string) => window.api.repo.resetPreview(repoPath, hash),
    [repoPath],
  );

  // Push a local branch to a specific remote branch (dragging a local branch onto
  // a remote one). Reloads the ahead/behind counts on success and resolves whether
  // it succeeded, so a follow-up "start a pull request" only opens once the branch
  // reached the remote.
  const pushBranch = useCallback(
    async (remote: string, localBranch: string, remoteBranch: string): Promise<boolean> => {
      const result = await window.api.repo.pushBranch(repoPath, remote, localBranch, remoteBranch);
      if (result.status === 'ok') {
        closeDiff();
        reload();
        onSuccess?.('Pushed successfully', `“${localBranch}” pushed to “${remote}/${remoteBranch}”.`);
        return true;
      }
      onError?.('Push failed', result.message);
      return false;
    },
    [repoPath, reload, closeDiff, onError, onSuccess],
  );

  const renameBranch = useCallback(
    (oldName: string, newName: string) =>
      runMutation('Rename failed', () =>
        window.api.repo.renameBranch(repoPath, oldName, newName),
      ),
    [repoPath, runMutation],
  );

  const deleteBranch = useCallback(
    (branch: string) =>
      runMutation('Delete failed', () => window.api.repo.deleteBranch(repoPath, branch)),
    [repoPath, runMutation],
  );

  const deleteRemoteBranch = useCallback(
    (remote: string, branch: string) =>
      runMutation('Delete failed', () =>
        window.api.repo.deleteRemoteBranch(repoPath, remote, branch),
      ),
    [repoPath, runMutation],
  );

  // Re-create an existing (lightweight) tag as annotated, carrying the message
  // entered in the tags-section confirm bar; reloads so the badge refreshes.
  const annotateTag = useCallback(
    (name: string, message: string) =>
      runMutation('Annotate tag failed', () =>
        window.api.repo.annotateTag(repoPath, name, message),
      ),
    [repoPath, runMutation],
  );

  // The remote tags target: prefer `origin`, else the sole remote; undefined when
  // there's no remote or several without an `origin`. Drives both the tag menu's
  // push/delete target and which remote's tags we list to mark "already pushed".
  const tagRemote = useMemo(() => {
    const names = refs?.remotes.map((remote) => remote.name) ?? [];
    if (names.includes('origin')) return 'origin';
    return names.length === 1 ? names[0] : undefined;
  }, [refs]);

  // Re-read the remote's tag list (best-effort, network) so the tag menu knows
  // which tags are already pushed. Called on repo/remote change and after a tag
  // push or remote-delete — not on ordinary reloads, to keep network calls rare.
  const refreshPushedTags = useCallback(() => {
    if (!tagRemote) {
      setPushedTags(null);
      return;
    }
    void window.api.repo.remoteTags(repoPath, tagRemote).then((tags) => {
      setPushedTags(tags === null ? null : new Set(tags));
    });
  }, [repoPath, tagRemote]);

  useEffect(() => {
    setPushedTags(null);
    if (!tagRemote) return;
    let live = true;
    void window.api.repo.remoteTags(repoPath, tagRemote).then((tags) => {
      if (live) setPushedTags(tags === null ? null : new Set(tags));
    });
    return () => {
      live = false;
    };
  }, [repoPath, tagRemote]);

  // Delete a local tag (`git tag -d`); reloads so its badge/row disappears. Any
  // copy on a remote is untouched, so the pushed-tags set needn't refresh.
  const deleteTag = useCallback(
    (name: string) =>
      runMutation('Delete tag failed', () => window.api.repo.deleteTag(repoPath, name)),
    [repoPath, runMutation],
  );

  // Push a single tag to a remote — a normal push never carries tags, so this is
  // the explicit way to publish one. Success/failure land as toasts; no reload
  // is needed since the local refs don't change.
  const pushTag = useCallback(
    async (name: string, remote: string) => {
      const result = await window.api.repo.pushTag(repoPath, name, remote);
      if (result.status === 'ok') {
        onSuccess?.('Tag pushed', `“${name}” pushed to “${remote}”.`);
        refreshPushedTags();
      } else onError?.('Push failed', result.message);
    },
    [repoPath, onSuccess, onError, refreshPushedTags],
  );

  // Delete a tag on a remote (the local tag is kept). Toast the outcome.
  const deleteRemoteTag = useCallback(
    async (name: string, remote: string) => {
      const result = await window.api.repo.deleteRemoteTag(repoPath, name, remote);
      if (result.status === 'ok') {
        onSuccess?.('Tag deleted', `“${name}” deleted from “${remote}”.`);
        refreshPushedTags();
      } else onError?.('Delete failed', result.message);
    },
    [repoPath, onSuccess, onError, refreshPushedTags],
  );

  // Continue / abort / skip the in-progress operation. Each runs through the
  // same mutation shape (fresh refs or an error), then a reload re-reads the
  // merge state so the banner and resolver clear once the operation finishes.
  const runMergeAction = useCallback(
    async (failureTitle: string, run: () => Promise<RefsMutationResult>) => {
      if (mergeBusy) return;
      setMergeBusy(true);
      const result = await run();
      setMergeBusy(false);
      if (result.status === 'ok') reload();
      else onError?.(failureTitle, result.message);
    },
    [mergeBusy, reload, onError],
  );

  const mergeContinue = useCallback(
    () => runMergeAction('Continue failed', () => window.api.repo.mergeContinue(repoPath)),
    [repoPath, runMergeAction],
  );
  const mergeAbort = useCallback(
    () => runMergeAction('Abort failed', () => window.api.repo.mergeAbort(repoPath)),
    [repoPath, runMergeAction],
  );
  const rebaseSkip = useCallback(
    () => runMergeAction('Skip failed', () => window.api.repo.rebaseSkip(repoPath)),
    [repoPath, runMergeAction],
  );

  // Mark conflict(s) resolved from the commit panel (stage them as-is). Updates
  // both the working lists and the merge state so the conflict section clears
  // and the banner's "Continue" unlocks once the last conflict is gone.
  const markResolved = useCallback(
    async (file: string | null) => {
      const result = await window.api.repo.markResolved(repoPath, file);
      setWorkingStatus(result.status);
      applyMergeRef.current(result.merge);
    },
    [repoPath],
  );

  // Open the full-screen resolver, optionally pre-selecting a file (clicking a
  // conflicted file in the commit panel jumps straight to it).
  const openResolver = useCallback((file: string | null) => {
    setResolverFile(file);
    setResolverOpen(true);
  }, []);

  const hasChanges =
    (workingStatus?.staged.length ?? 0) + (workingStatus?.unstaged.length ?? 0) > 0;

  // The list handed to the UI: when the working tree is dirty, a synthetic row
  // for the uncommitted changes rides on top, parented to HEAD so the graph
  // connects it to the current tip. It carries no author/avatar/message — the
  // graph draws it as an empty, dotted-ring node.
  const displayCommits = useMemo(() => {
    if (!hasChanges || commits === null) return commits;
    const headHash = commits.find((commit) =>
      commit.refs.some((ref) => ref.kind === 'head'),
    )?.hash;
    const workingRow: CommitLogEntry = {
      hash: WORKING_TREE_HASH,
      shortHash: '',
      parents: headHash ? [headHash] : [],
      author: '',
      authorEmail: '',
      authorAvatarUrl: '',
      date: '',
      subject: '',
      refs: [],
      working: true,
    };
    return [workingRow, ...commits];
  }, [commits, hasChanges]);

  const currentBranch = refs?.localBranches.find((branch) => branch.current)?.name;
  const branchNames = useMemo(
    () => refs?.localBranches.map((branch) => branch.name) ?? [],
    [refs],
  );

  const branchLabel =
    refs === null ? 'Loading…' : currentBranch ?? 'HEAD (detached)';

  return (
    <div className="repo-view">
      {/* Scoped here so its confirm bar can overlay the toolbar below. */}
      <ConfirmProvider>
        <RepoToolbar
          branch={branchLabel}
          branches={branchNames}
          onCheckout={(branch) => void checkout(branch)}
          onPush={push}
          onPublishBranch={publishBranch}
          pushing={pushing}
          onPull={(mode) => void pull(mode)}
          pulling={pulling}
          onStash={() => void stashPush()}
          canStash={hasChanges}
          hasStash={(refs?.stashes.length ?? 0) > 0}
          onPop={() => void stashPop(0)}
          onBranch={() => setCreatingBranch((on) => !on)}
          branching={creatingBranch}
          onUndo={() => void undo()}
          onRedo={() => void redo()}
          undoLabel={undoRedo.undo}
          redoLabel={undoRedo.redo}
          onOpenRepoSettings={() => openRepoSettings()}
        />
        {mergeState && (
          <MergeBanner
            state={mergeState}
            busy={mergeBusy}
            onResolve={() => openResolver(null)}
            onContinue={() => void mergeContinue()}
            onAbort={() => void mergeAbort()}
            onSkip={() => void rebaseSkip()}
          />
        )}
        <RepoColumns
          repoPath={repoPath}
          branch={currentBranch}
          refs={refs}
          commits={displayCommits}
          workingStatus={workingStatus}
          onWorkingStatusChange={setWorkingStatus}
          conflicts={mergeState?.conflicts ?? []}
          onMarkResolved={(file) => void markResolved(file)}
          onOpenConflict={(file) => openResolver(file)}
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          onCommitted={reload}
          closeDiffToken={closeDiffToken}
          onCheckout={(branch, remote) => void checkout(branch, remote)}
          creatingBranch={creatingBranch}
          onCreateBranch={(name) => void createBranch(name)}
          onCancelCreateBranch={() => setCreatingBranch(false)}
          onMergeBranch={(source, target) => void mergeBranch(source, target)}
          onRebaseBranch={(source, target) => void rebaseBranch(source, target)}
          onFastForward={(source, target) => void fastForward(source, target)}
          onCherryPick={(hash) => void cherryPick(hash)}
          onCherryPickSelection={(hashes) => void openCherryPick(hashes)}
          onRevert={(hash) => void revert(hash)}
          onRebaseOnto={(hash) => void rebaseOnto(hash)}
          onInteractiveRebase={(hash) => void openInteractiveRebase(hash)}
          onCheckoutCommit={(hash) => void checkoutCommit(hash)}
          onReset={(hash, mode) => void resetTo(hash, mode)}
          onResetPreview={resetPreview}
          onPushBranch={pushBranch}
          onRenameBranch={(oldName, newName) => void renameBranch(oldName, newName)}
          onDeleteBranch={(branch) => void deleteBranch(branch)}
          onDeleteRemoteBranch={(remote, branch) => void deleteRemoteBranch(remote, branch)}
          taggingAt={taggingAt}
          onStartTag={startTag}
          onStartTagAtBranch={startTagAtBranch}
          onCreateTag={(hash, name) => void createTag(hash, name)}
          onCreateAnnotatedTag={(hash, name, message) => void createAnnotatedTag(hash, name, message)}
          onCancelTag={() => setTaggingAt(null)}
          onAnnotateTag={(name, message) => void annotateTag(name, message)}
          tagRemote={tagRemote}
          pushedTags={pushedTags}
          onPushTag={(name, remote) => void pushTag(name, remote)}
          onDeleteRemoteTag={(name, remote) => void deleteRemoteTag(name, remote)}
          onDeleteTag={(name) => void deleteTag(name)}
          onStashApply={(index) => void stashApply(index)}
          onStashPop={(index) => void stashPop(index)}
          onStashDrop={(index) => void stashDrop(index)}
          onWorktreeAdded={reload}
          onWorktreeRemove={worktreeRemove}
          onWorktreeLock={(path, lock, reason) => void worktreeLock(path, lock, reason)}
          onOpenWorktreeHere={openWorktreeHere}
          onOpenWorktreeInNewTab={openWorktreeInNewTab}
          onSubmoduleAdded={reload}
          onSubmoduleInit={(path) => void submoduleInit(path)}
          onSubmoduleUpdate={(path) => void submoduleUpdate(path)}
          onSubmoduleUpdateRemote={(path) => void submoduleUpdateRemote(path)}
          onSubmoduleSync={(path) => void submoduleSync(path)}
          onSubmoduleDeinit={submoduleDeinit}
          onSubmoduleRemove={(path) => void submoduleRemove(path)}
          gitflowConfig={gitflowConfig}
          onGitflowStart={(kind, name, source) => void gitflowStart(kind, name, source)}
          onGitflowFinish={() => void gitflowFinish()}
          onError={onError}
          onOpenSettings={onOpenSettings}
          onOpenRepoSettings={openRepoSettings}
        />
        {resolverOpen && mergeState && (
          <ConflictResolver
            repoPath={repoPath}
            mergeState={mergeState}
            initialFile={resolverFile}
            onResolved={(next) => applyMergeRef.current(next)}
            onClose={() => setResolverOpen(false)}
          />
        )}
        {rebaseEditor && (
          <CommitPlanEditor
            title="Interactive rebase"
            intro={
              <>
                Reorder commits by dragging, and set each one’s action. The list
                runs oldest&nbsp;→&nbsp;newest, the same order git replays them.
              </>
            }
            commits={rebaseEditor.commits}
            submitLabel="Start rebase"
            busyLabel="Rebasing…"
            requireChange
            onSubmit={(todo) => runInteractiveRebase(rebaseEditor.baseHash, todo)}
            onClose={() => setRebaseEditor(null)}
          />
        )}
        {cherryPickEditor && (
          <CommitPlanEditor
            title="Cherry-pick commits"
            intro={
              <>
                Reorder the selected commits by dragging, and set each one’s
                action. They’re applied onto the current branch
                oldest&nbsp;→&nbsp;newest.
              </>
            }
            commits={cherryPickEditor.commits}
            submitLabel="Cherry-pick"
            busyLabel="Cherry-picking…"
            onSubmit={runCherryPickMulti}
            onClose={() => setCherryPickEditor(null)}
          />
        )}
        {repoSettingsOpen && (
          <RepoSettingsDialog
            repoPath={repoPath}
            config={repoConfig}
            remotes={refs?.remotes ?? []}
            onSave={(config) => window.api.repo.repoSaveConfig(repoPath, config)}
            gitflowConfig={gitflowConfig}
            onGitflowSaveConfig={gitflowSaveConfig}
            initialTab={repoSettingsTab}
            onClose={() => setRepoSettingsOpen(false)}
          />
        )}
      </ConfirmProvider>
    </div>
  );
}
