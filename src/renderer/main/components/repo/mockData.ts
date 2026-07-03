// Remaining mock data for the repository view. Branches, tags, commit history
// and working-tree status now come from the real repo. Pull requests still need
// a connected GitHub/GitLab account, so they stay mock for now.

export type PullRequestState = 'open' | 'draft' | 'merged' | 'closed';

export interface PullRequest {
  number: number;
  title: string;
  author: string;
  state: PullRequestState;
}

export const MOCK_PULL_REQUESTS: PullRequest[] = [
  { number: 18, title: 'Sidebar branch & PR lists', author: 'janos', state: 'draft' },
  { number: 15, title: 'Resizable three-column layout', author: 'ada', state: 'open' },
  { number: 12, title: 'Fix chevron rotation transition', author: 'grace', state: 'merged' },
  { number: 9, title: 'Spike: nodegit vs git CLI', author: 'janos', state: 'closed' },
];
