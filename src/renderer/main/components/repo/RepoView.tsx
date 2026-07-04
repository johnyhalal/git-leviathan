import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import type {
  CommitLogEntry,
  GitflowKind,
  RefsMutationResult,
  RepoRefs,
} from '../../../../types/ipc';
import { RepoToolbar } from './RepoToolbar';
import { RepoColumns } from './RepoColumns';

interface RepoViewProps {
  title: string;
  repoPath: string;
  /** Surface a failure (e.g. a checkout or commit that couldn't complete). */
  onError?: (title: string, message: string) => void;
}

/**
 * Top-level view for an open repository: a repo toolbar over a resizable
 * three-column body. Loads the repo's refs and commit history once (re-loading
 * on a checkout), and shares them with the toolbar, sidebar and commit list.
 */
/** How many commits to fetch per page (initial load and each "load more"). */
const PAGE_SIZE = 200;

export function RepoView({ title, repoPath, onError }: RepoViewProps) {
  void title;

  const [refs, setRefs] = useState<RepoRefs | null>(null);
  const [commits, setCommits] = useState<CommitLogEntry[] | null>(null);
  // Whether another page might exist, and whether one is being fetched now.
  const [hasMore, setHasMore] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  // How many commits we've requested so far — the running `--max-count` cap.
  const loadedCountRef = useRef(0);
  // Bumped after a checkout to re-run the loader with the new HEAD.
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    let live = true;
    setRefs(null);
    setCommits(null);
    setHasMore(false);
    loadedCountRef.current = 0;
    void Promise.all([
      window.api.repo.listRefs(repoPath),
      window.api.repo.log(repoPath, PAGE_SIZE),
    ]).then(([nextRefs, nextCommits]) => {
      if (!live) return;
      setRefs(nextRefs);
      setCommits(nextCommits);
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

  const checkout = useCallback(
    async (branch: string, remote?: string) => {
      const result = await window.api.repo.checkout(repoPath, branch, remote);
      if (result.status === 'ok') reload();
      else onError?.('Checkout failed', result.message);
    },
    [repoPath, onError, reload],
  );

  // Stash / gitflow all mutate the repo and hand back fresh refs; on success we
  // just reload, on failure we surface git's message via the toast channel.
  const runMutation = useCallback(
    async (
      failureTitle: string,
      run: () => Promise<RefsMutationResult>,
    ) => {
      const result = await run();
      if (result.status === 'ok') reload();
      else onError?.(failureTitle, result.message);
    },
    [onError, reload],
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

  const currentBranch = refs?.localBranches.find((branch) => branch.current)?.name;
  const branchNames = useMemo(
    () => refs?.localBranches.map((branch) => branch.name) ?? [],
    [refs],
  );

  const branchLabel =
    refs === null ? 'Loading…' : currentBranch ?? 'HEAD (detached)';

  return (
    <div className="repo-view">
      <RepoToolbar
        branch={branchLabel}
        branches={branchNames}
        onCheckout={(branch) => void checkout(branch)}
      />
      <RepoColumns
        repoPath={repoPath}
        refs={refs}
        commits={commits}
        loadingMore={loadingMore}
        onLoadMore={() => void loadMore()}
        onCommitted={reload}
        onCheckout={(branch, remote) => void checkout(branch, remote)}
        onStashPop={(index) => void stashPop(index)}
        onStashDrop={(index) => void stashDrop(index)}
        onGitflowStart={(kind, name) => void gitflowStart(kind, name)}
        onGitflowFinish={() => void gitflowFinish()}
        onError={onError}
      />
    </div>
  );
}
