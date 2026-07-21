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
asdf
asdfgsdfg
ertzerzz
45674567

tzuitzuitzitz
tzuitzui

### Repository management

- **Multi-repo tabs** — open multiple repositories in tabs; open tabs and the
  active one are persisted and restored on launch.
- **Start screen** for empty tabs with recent repos, an open-folder picker, and
  a clone entry point.
- **Clone** with live progress reporting and cancellation; remembers the last
  clone directory.
- **Bundled git** — ships its own git binary and falls back to the system git,
  so it works even on machines with no git installed.

### Commit graph & history

- **Commit graph** with lane layout (topo-ordered) and branch/tag leader lines.
- **Working-tree row** — a synthetic entry for uncommitted changes woven into
  the graph.
- **Stashes** woven into the graph alongside commits.
- **Commit detail panel** with metadata, changed files, and author avatars.

### Diffs & files

- **Diff viewer** for staged, unstaged, and per-commit changes.
- **File content** view and commit-level file lists.

### Staging & committing

- Stage / unstage / discard changes and **commit** from a status view.
- **Reword** commits — amends in place for HEAD, scripted non-interactive
  rebase for older commits.
- **Amend** and **push-after-commit**.
- **Undo / redo** of ref-changing operations.

### Branches, merging & syncing

- **Checkout**, **create**, and **delete** branches (local and remote).
- **Merge** and **rebase**.
- **Push** / push with set-upstream / **pull** (with a configurable pull mode).
- **Gitflow** — start and finish flows.
- **Stash** push / pop / drop.

### Live sync

- **Working-tree watching** that auto re-syncs the UI on external edits and
  commits, plus a re-sync on app focus.
- **Live git activity** streamed to a footer log.

### Integrations

- Connect **GitHub** and **GitLab** accounts via OAuth device flow.
- **List remote repositories** from connected accounts.
- **Authenticated clone URLs** with secrets redacted from any output shown.
- **SSH key management** — generate (pure-Node ed25519), add, and remove keys.

### AI

- **AI-drafted commit messages** via a locally installed `claude` CLI, using the
  staged diff — no credentials stored in the app.

### App & UX

- **Light/dark theme** driven by the OS preference with a persisted override.
- **Splash screen** boot sequence and an in-app **update** banner
  (check / download / install).
- **Settings** modal, collapsible sidebar sections, resizable columns, and toast
  notifications.
- **Cross-platform** builds for Windows, macOS, and Linux (including a macOS
  universal build).
