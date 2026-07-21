import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommitLogEntry,
  GitflowConfig,
  GitflowConfigResult,
  GitflowKind,
  MergeState,
  PullMode,
  RefsMutationResult,
  RepoRefs,
  UndoRedoState,
  WorkingStatus,
} from '../../../../types/ipc';
import { WORKING_TREE_HASH } from '../../../../types/ipc';
import { RepoToolbar } from './RepoToolbar';
import { RepoColumns } from './RepoColumns';
import { MergeBanner } from './MergeBanner';
import { ConflictResolver } from './ConflictResolver';
import { ConfirmProvider } from '../ConfirmBar';

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
      } else await surfaceConflictsOrError('Pull failed', result.message);
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
          onRenameBranch={(oldName, newName) => void renameBranch(oldName, newName)}
          onDeleteBranch={(branch) => void deleteBranch(branch)}
          onDeleteRemoteBranch={(remote, branch) => void deleteRemoteBranch(remote, branch)}
          onStashApply={(index) => void stashApply(index)}
          onStashPop={(index) => void stashPop(index)}
          onStashDrop={(index) => void stashDrop(index)}
          gitflowConfig={gitflowConfig}
          onGitflowSaveConfig={gitflowSaveConfig}
          onGitflowStart={(kind, name, source) => void gitflowStart(kind, name, source)}
          onGitflowFinish={() => void gitflowFinish()}
          onError={onError}
          onOpenSettings={onOpenSettings}
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
      </ConfirmProvider>
    </div>
  );
}
