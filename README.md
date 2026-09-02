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
- **Worktrees** — add, remove, and lock linked worktrees.
- **Submodules** — add, init, update (incl. `--remote`), sync, deinit, and
  remove, with per-submodule status.
- **Git LFS** — view LFS status and track / untrack patterns.
- **Bundled git** — ships its own git binary and falls back to the system git,
  so it works even on machines with no git installed.

### Commit graph & history

- **Commit graph** with topo-ordered lane layout and branch/tag leader lines.
- **Working-tree row** — a synthetic entry for uncommitted changes woven into
  the graph.
- **Stashes** woven into the graph alongside commits.
- **Commit detail panel** with metadata, changed files, and author avatars.

### Diffs & files

- **Diff viewer** for staged, unstaged, and per-commit changes.
- **Multi-commit range diff** — aggregate a selection of commits into one diff.
- **File content** view and commit-level file lists.

### Staging & committing

- Stage / unstage / discard changes at the **file and hunk** level, and
  **commit** from a status view.
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
- **Conflict resolution** — merge-state view, per-file conflict resolving, mark
  resolved, and continue / abort / skip.
- **Push** / push with set-upstream / **pull** (configurable pull mode) plus a
  background **fetch**.
- **Gitflow** — configurable feature/release/hotfix flows: start and finish.
- **Stash** push / apply / pop / drop.

### Live sync

- **Working-tree watching** that auto re-syncs the UI on external edits and
  commits, plus a re-sync on app focus.
- **Live git activity** streamed to a footer log.

### Integrations

- Connect **GitHub** and **GitLab** accounts via OAuth device flow.
- **List remote repositories** and **pull requests** from connected accounts,
  and **create a pull request**.
- **Authenticated clone URLs** with secrets redacted from any output shown.
- **SSH key management** — generate (pure-Node ed25519), add, and remove keys.

### AI

- **AI-drafted commit messages** via a locally installed `claude` CLI, using the
  staged diff — no credentials stored in the app.

### App & UX

- **Light/dark theme** driven by the OS preference with a persisted override.
- **Splash screen** boot sequence and an in-app **update** banner
  (check / download / install) with a configurable check interval.
- **Settings** modal, collapsible sidebar sections, resizable columns, and toast
  notifications.
- **Cross-platform** builds for Windows, macOS, and Linux (including a macOS
  universal build).
