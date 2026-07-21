# GitKraken Desktop — Feature Research & GitLeviathan Gap Analysis

> Deep research on GitKraken Desktop's feature set (2024–2026), cross-referenced against
> GitLeviathan's current IPC surface. All GitKraken claims below passed 3-vote adversarial
> verification (25/25 confirmed) against primary sources — almost entirely GitKraken's own
> current documentation (help.gitkraken.com / gitkraken.com).

---

## 1. Where GitLeviathan already has parity

| Capability | GitKraken | GitLeviathan |
|---|---|---|
| Interactive commit graph (color-coded DAG, lane layout) | ✅ | ✅ `repo:log` + `graph.ts` |
| Staging incl. **hunk-level** | ✅ | ✅ `stage-hunk` / `unstage-hunk` |
| Two-part commit message (summary + body) | ✅ | ✅ commit + drafts |
| Reword (HEAD + older commits) | ✅ (label "Reword") | ✅ `repo:reword` |
| Branch create/delete/rename/checkout | ✅ | ✅ |
| Merge + conflict resolution flow | ✅ | ✅ `merge`, `mark-resolved`, `resolve-file` |
| Rebase | ✅ | ✅ `repo:rebase` (basic) |
| Stash push/pop/apply/drop | ✅ | ✅ |
| Push/pull (+ set-upstream, pull modes) | ✅ | ✅ |
| Clone (with progress) | ✅ | ✅ |
| GitFlow (per-repo config) | ✅ | ✅ |
| Diff view | ✅ | ✅ |
| Discard / ignore / delete file | ✅ | ✅ |
| Undo/redo git actions | ✅ | ✅ |
| GitHub/GitLab OAuth + **create PR** | ✅ | ✅ (create + list only) |
| SSH key management | ✅ | ✅ add/remove |
| AI commit messages | ✅ (paid) | ✅ (local Claude CLI, **free**) |
| Themes, auto-update, tabs, recents | ✅ | ✅ |

**GitLeviathan advantage:** AI commit messages run against the user's own local Claude CLI for
free, whereas GitKraken's AI suite is paywalled.

---

## 2. What GitKraken has that GitLeviathan doesn't

### Advanced Git primitives (largest gap — each has a dedicated GitKraken UI)
- **Worktrees** — create / switch / lock / remove parallel working trees (10.5.0+).
- **Submodules** — add / init / update, manages `.gitmodules`.
- **Git LFS** — init via Preferences > LFS, auto LFS pull after clone.
- **Commit/tag signing (GPG & SSH)** — including in-app GPG key *generation*
  (Preferences > Commit Signing; SSH via GPG Format = SSH). GitLeviathan manages SSH keys
  for auth only, not signing.
- **Interactive rebase editor** — drag-to-reorder + four ops: pick / reword / squash / drop
  (P/R/S/D). GitLeviathan has `repo:rebase` but no interactive reordering surface.
- **Cherry-pick** — single + multi-commit (with reorder/squash/reword/drop).
- **Revert.**
- **Reset** (soft / mixed / hard to a commit). GitLeviathan has `checkout` but no explicit reset.
- **Tag create / delete / push** — GitLeviathan displays tags via `list-refs` but cannot
  create/delete them.

### Merge / diff depth
- **Visual 3-way merge conflict editor** — current (left) | target (right) | output (bottom),
  line selection via checkboxes/`+`. *The in-app conflict output editor requires a paid license.*
  GitLeviathan resolves conflicts at file level, not via a side-by-side editor.
- **File Blame** and **File History** — color-coded by author, step through revisions;
  "Edit in working directory" from the diff.

### Integrations breadth
- **Bitbucket + Azure DevOps** hosting (GitLeviathan: GitHub/GitLab only).
- **Self-hosted**: GitHub Enterprise Server, GitLab Self-Managed, Bitbucket Data Center.
- **Issue trackers**: Jira (Cloud + Data Center), Trello, GitHub Issues, GitLab Issues.
- **In-app PR review** — view by status, comment, approve, merge (GitLeviathan: create + list only).

### Cross-cutting / workflow
- **Workspaces** — group repos, multi-repo actions, review PRs across a repo group.
- **Launchpad / Focus View** — unified dashboard of PRs/issues/WIPs across repos with
  suggested next actions.
- **Built-in terminal** (incl. per-worktree sessions).
- **Profiles** — per-profile tab persistence.
- **Command Palette** (Cmd/Ctrl+P).
- **"Agents" view (v12.0)** — organizes worktrees around coding-agent sessions
  (Claude Code, Codex CLI, Copilot CLI, Gemini CLI, OpenCode).

### AI suite (beyond commit messages)
- Explain commit / **Explain Branch Changes** (base→HEAD, natural language).
- **AI stash messages.**
- **AI PR title/description drafting** (GA; defaults to Google Gemini).
- **AI merge-conflict auto-resolution** — context-aware fixes, per-hunk explanations,
  confidence levels (v11.2, Preview).
- **AI Commit Composer** — compose/recompose history into cleaner commits (Preview).

---

## 3. Recommended additions (ranked)

Fits GitLeviathan's minimal-deps, CLI-shelling philosophy and fills the sharpest gaps:

1. **Cherry-pick, revert, reset, tag create/delete** — cheapest wins. Each is a single git
   command + one IPC handler via the existing `mutateRepo` pattern. Most glaring
   "table-stakes GUI" gap.
2. **Interactive rebase editor** — high value; the non-interactive rebase plumbing and the
   `GIT_SEQUENCE_EDITOR` scripting trick (already used for reword) are in place.
3. **Blame / file history** — pure reads (`git blame`, `git log --follow`) that slot into
   `runGit`; big usability lift, low risk.
4. **Worktrees** — natural fit for the tab model and the direction GitKraken is betting on
   (Agents view).
5. **Visual 3-way conflict editor** — higher effort (real UI), but it's GitKraken's headline
   *free* feature and GitLeviathan's current flow is weakest here.
6. **AI "explain" + AI PR descriptions** — the local-Claude bridge already exists; extending
   it beyond commit messages is mostly prompt + wiring, and stays free vs. GitKraken's paywall.

**Lower priority for a lean client:** Workspaces, Launchpad, profiles, terminal,
Bitbucket/Azure/Jira integrations — heavy, and serve GitKraken's team/enterprise
monetization more than a focused solo-dev tool.

---

## 4. Caveats & open questions

- **"Cloud patches," "snapshots," and a standalone `gk` CLI** could not be confirmed for
  *Desktop* — they may be GitLens / cloud-only. Treat as out of scope.
- **Tier lines shift fast.** GitKraken's merge-conflict *output editor* and most AI features
  require a paid subscription — GitLeviathan's opening is to offer these free.
- **Interactive rebase surface is narrower than git's** even in GitKraken: only
  pick/reword/squash/drop (no edit/fixup); "reword" is GitKraken's label for editing the
  message, not a git-style edit stop.
- Sources are overwhelmingly GitKraken's own docs — authoritative for *what exists*, not for
  quality or comparative performance.
