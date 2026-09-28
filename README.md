# GitLeviathan

GitLeviathan — a cross-platform desktop GUI for Git, built with Electron + Vite +
React + TypeScript via Electron Forge.

## Download

Grab the latest build for your platform from the
[latest release](https://github.com/johnyhalal/git-leviathan/releases/latest):

| Platform | Download |
| --- | --- |
| **macOS** | [Apple Silicon](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-macOS-arm64.dmg) · [Intel](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-macOS-x64.dmg) |
| **Windows** | [GitLeviathan-Windows-Setup.exe](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Windows-Setup.exe) |
| **Linux — Debian/Ubuntu** (`.deb`) | [x64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-x64.deb) · [arm64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-arm64.deb) |
| **Linux — Fedora/RHEL** (`.rpm`) | [x64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-x64.rpm) · [arm64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-arm64.rpm) |

### macOS

There's a separate `.dmg` per architecture — pick **Apple Silicon** for M1 or
newer Macs and **Intel** for older ones (if unsure, check  → About This
Mac). Open the `.dmg` and drag **GitLeviathan** onto the **Applications**
shortcut.

### Windows

Run the installer (**GitLeviathan-Windows-Setup.exe**). It is not yet
code-signed, so Windows SmartScreen may show a "Windows protected your PC"
warning — click **More info → Run anyway** to proceed.

### Linux

Install the package for your distribution and architecture:

```bash
# Debian/Ubuntu (x64)
sudo dpkg -i GitLeviathan-Linux-x64.deb

# Fedora/RHEL (x64)
sudo rpm -i GitLeviathan-Linux-x64.rpm
```

Swap `x64` for `arm64` on ARM machines (e.g. a Raspberry Pi or an arm64 server).

## Features

### Repository management

- **Multi-repo tabs** — open several repositories in tabs; open tabs and the
  active one are persisted and restored on launch.
- **Start screen** for empty tabs with recent repos (pinnable **favorites**),
  an open-folder picker, and a clone entry point.
- **Clone** with live progress reporting and cancellation; remembers the last
  clone directory.
- **Remotes** — add, rename, edit fetch/push URLs, and remove remotes from repo
  settings or the sidebar.
- **Worktrees** — add, remove, and lock linked worktrees.
- **Submodules** — add, init, update (incl. `--remote`), sync, deinit, and
  remove, with per-submodule status.
- **Git LFS** — view LFS status and track / untrack patterns.
- **Open in…** — open the repo or a file in your editor, terminal, or file
  manager (e.g. "Reveal in Finder"), with installed editors and terminals
  detected per platform and a custom editor option.
- **Bundled git** — ships its own git binary and falls back to the system git,
  so it works even on machines with no git installed.

### Commit graph & history

- **Commit graph** with topo-ordered lane layout and branch/tag leader lines.
- **Branch filtering** — hide branches from the graph, or show only selected
  ones; a banner above the graph says what's hidden and offers "Show all".
- **Commit search** (⌘F) across the whole history by message, author, or hash
  prefix, with a match counter and previous/next stepping.
- **Working-tree row** — a synthetic entry for uncommitted changes woven into
  the graph.
- **Stashes** woven into the graph alongside commits.
- **Commit detail panel** with metadata, changed files, and author avatars.
- **Co-authors and committers** — `Co-authored-by` trailers and a differing
  committer are shown as avatar stacks and credits in the graph, commit
  details, file history, and blame.

### Diffs & files

- **Diff viewer** for staged, unstaged, and per-commit changes, with **hunk**,
  **inline whole-file**, and **split side-by-side** layouts, ignore-whitespace
  and soft-wrap toggles, and previous/next hunk stepping.
- **Blame** (author-coloured runs, scroll-synced gutter) and a resizable
  **file history** sidebar, usable together over any file view.
- **Multi-commit range diff** — aggregate a selection of commits into one diff.
- **File content** view and commit-level file lists.

### Staging & committing

- Stage / unstage / discard changes at the **file, hunk, and line** level —
  including multi-line selections built from the gutter — and **commit** from
  a status view (⌘/Ctrl+Enter).
- **Ignore** files (write to `.gitignore`) and **delete** untracked files.
- **Reword** commits — amends in place for HEAD, scripted non-interactive
  rebase for older commits.
- **Amend**, **push-after-commit**, and a persisted **commit-message draft**.
- **Commit signing** — GPG or SSH, with in-app key generation/selection and
  passphrase handling.
- **Undo / redo** of ref-changing operations.

### Branches, merging & syncing

- **Checkout** branches or detached commits; **create**, **rename**, and
  **delete** branches (local and remote).
- **Tags** — create lightweight or **annotated** tags, push, and delete
  (local and remote).
- **Merge**, **rebase**, **rebase onto**, **interactive rebase** (with preview),
  and **fast-forward**.
- **Cherry-pick** (single, multi-commit editor, and preview) and **revert**.
- **Reset** — soft / mixed / hard, with a preview of the effect.
- **Conflict resolution** — merge-state view and a line-by-line ours / theirs /
  output editor with per-line and per-block picks, image-conflict previews,
  mark resolved (or resolved as-is), and continue / abort / skip. Merge commits
  are prefilled from git's merge message.
- **Push** / push with set-upstream / **pull** (configurable pull mode) plus a
  background **fetch**, with optional `--prune`.
- **Gitflow** — configurable feature/release/hotfix flows: start and finish.
- **Stash** push / apply / pop / drop, with variants (with message, keep index,
  staged only, tracked only) and **per-file stash**.

### Live sync

- **Working-tree watching** that auto re-syncs the UI on external edits and
  commits, plus a re-sync on app focus.
- **Live git activity** streamed to a footer log, kept per repository across
  tab switches.

### Integrations

- Connect **GitHub** and **GitLab** accounts via OAuth device flow or a
  personal access token (with a per-scope explanation of what's needed).
- **List remote repositories** and **pull requests** from connected accounts,
  and **create a pull request**.
- **Authenticated clone URLs** with secrets redacted from any output shown.
- **SSH key management** — generate (pure-Node ed25519), add, and remove keys.

### AI

Uses a locally installed `claude` CLI — no credentials are stored in the app.

- **AI-drafted commit messages** from the staged diff, with a per-file diff
  budget to keep token usage low.
- **AI-assisted conflict resolution** — "Ask Claude" per conflict block, or
  auto-resolve a whole file, using the common ancestor as context.
- **Model selection** from the models your CLI reports, and an opt-in
  `Co-Authored-By` trailer naming the model that wrote the message.

### App & UX

- **Command palette** (⌘P) and a native menu driven by one shortcut table, with
  shortcut hints in tooltips and a Keyboard Shortcuts settings panel.
- **Light/dark theme** driven by the OS preference with a persisted override.
- **Configurable date format** — system, ISO 8601, US, European, or relative.
- **Splash screen** boot sequence and an in-app **update** banner
  (check / download / install) with a configurable check interval.
- **Settings** modal (General, Appearance, Git, Commit Signing, Integrations, Shortcuts),
  collapsible sidebar sections, resizable columns, and toast notifications.
- **Hardened renderer** — strict Content-Security-Policy, sandboxed windows,
  and a single-instance lock.
- **Cross-platform** builds for Windows, macOS, and Linux (including a macOS
  universal build).
