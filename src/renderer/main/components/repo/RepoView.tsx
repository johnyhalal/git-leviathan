import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommitLogEntry,
  GitflowKind,
  PullMode,
  RefsMutationResult,
  RepoRefs,
  UndoRedoState,
  WorkingStatus,
} from '../../../../types/ipc';
import { WORKING_TREE_HASH } from '../../../../types/ipc';
import { RepoToolbar } from './RepoToolbar';
import { RepoColumns } from './RepoColumns';
import { ActivityLog } from './ActivityLog';
import { ConfirmProvider } from '../ConfirmBar';

interface RepoViewProps {
  title: string;
  repoPath: string;
  /** Surface a failure (e.g. a checkout or commit that couldn't complete). */
  onError?: (title: string, message: string) => void;
  /** Surface an informational note (e.g. a merge that was already up to date). */
  onNotice?: (title: string, message: string) => void;
  /** Open the settings modal, optionally to a specific section id. */
  onOpenSettings?: (section?: string) => void;
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
  onOpenSettings,
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
  // True while a push is in flight, to disable the toolbar button.
  const [pushing, setPushing] = useState(false);
  // True while a pull/fetch is in flight, to disable the toolbar button.
  const [pulling, setPulling] = useState(false);
  // True while the inline "new branch" input is shown at the HEAD commit.
  const [creatingBranch, setCreatingBranch] = useState(false);
  // Labels for the next undo/redo (from the reflog), or null when unavailable.
  // Refetched alongside refs/log so it tracks every HEAD move.
  const [undoRedo, setUndoRedo] = useState<UndoRedoState>({ undo: null, redo: null });

  // A typed-but-uncommitted message belongs to one repo; drop it when the tab
  // switches to another (this view is reused across repos, not remounted).
  useEffect(() => {
    setCommitMessage('');
    setCreatingBranch(false);
  }, [repoPath]);

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
    ]).then(([nextRefs, nextCommits, status, undo]) => {
      if (!live) return;
      setRefs(nextRefs);
      setCommits(nextCommits);
      setWorkingStatus(status);
      setUndoRedo(undo);
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
      const [nextRefs, nextCommits, status, undo] = await Promise.all([
        window.api.repo.listRefs(repoPath),
        window.api.repo.log(repoPath, count),
        window.api.repo.status(repoPath),
        window.api.repo.undoState(repoPath),
      ]);
      setRefs(nextRefs);
      setCommits(nextCommits);
      setWorkingStatus(status);
      setUndoRedo(undo);
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

  // Re-sync the view whenever the OS window regains focus, so edits made in an
  // editor or commits made from a terminal show up without a manual action.
  // The main process detects window focus and broadcasts it (renderer-side
  // `window` focus events are unreliable in Electron).
  useEffect(
    () => window.api.app.onWindowFocus(() => void refreshRef.current()),
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
    if (result.status === 'ok') reload();
    else if (result.status === 'needs-upstream')
      return { remote: result.remote, branch: result.branch };
    else onError?.('Push failed', result.message);
    return null;
  }, [pushing, repoPath, reload, onError]);

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
        reload();
        return;
      }
      onError?.('Push failed', result.message);
      throw new Error(result.message);
    },
    [repoPath, reload, onError],
  );

  // Pull/fetch the current branch; reload on success (HEAD, log and ahead/behind
  // all move), surface git's message on failure.
  const pull = useCallback(
    async (mode: PullMode) => {
      if (pulling) return;
      setPulling(true);
      const result = await window.api.repo.pull(repoPath, mode);
      setPulling(false);
      if (result.status === 'ok') reload();
      else onError?.('Pull failed', result.message);
    },
    [pulling, repoPath, reload, onError],
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

  // Stash / gitflow / branch deletion all mutate the repo and hand back fresh
  // refs; on success we just reload, on failure we surface git's message via the
  // toast channel.
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
      } else onError?.(failureTitle, result.message);
    },
    [onError, onNotice, reload],
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

  const stashPush = useCallback(
    () =>
      runMutation('Stash failed', () => window.api.repo.stashPush(repoPath)),
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

  const gitflowStart = useCallback(
    (kind: GitflowKind, name: string) =>
      runMutation('Gitflow start failed', () =>
        window.api.repo.gitflowStart(repoPath, kind, name),
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
        />
        <RepoColumns
          repoPath={repoPath}
          branch={currentBranch}
          refs={refs}
          commits={displayCommits}
          workingStatus={workingStatus}
          onWorkingStatusChange={setWorkingStatus}
          commitMessage={commitMessage}
          onCommitMessageChange={setCommitMessage}
          loadingMore={loadingMore}
          onLoadMore={() => void loadMore()}
          onCommitted={reload}
          onCheckout={(branch, remote) => void checkout(branch, remote)}
          creatingBranch={creatingBranch}
          onCreateBranch={(name) => void createBranch(name)}
          onCancelCreateBranch={() => setCreatingBranch(false)}
          onMergeBranch={(source, target) => void mergeBranch(source, target)}
          onRebaseBranch={(source, target) => void rebaseBranch(source, target)}
          onDeleteBranch={(branch) => void deleteBranch(branch)}
          onDeleteRemoteBranch={(remote, branch) => void deleteRemoteBranch(remote, branch)}
          onStashPop={(index) => void stashPop(index)}
          onStashDrop={(index) => void stashDrop(index)}
          onGitflowStart={(kind, name) => void gitflowStart(kind, name)}
          onGitflowFinish={() => void gitflowFinish()}
          onError={onError}
          onOpenSettings={onOpenSettings}
        />
      </ConfirmProvider>
      <ActivityLog repoPath={repoPath} />
    </div>
  );
}
