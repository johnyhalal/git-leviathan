# GitLeviathan

GitLeviathan — a cross-platform desktop GUI for Git, built with Electron + Vite +
React + TypeScript via Electron Forge.

## Download

- **macOS (Apple Silicon):** [GitLeviathan-macOS.zip](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-macOS.zip)

The link always points to the newest release. It becomes live after the first
release build has run (see [Releasing](#releasing)).

> **First launch on macOS.** The app is ad-hoc code-signed but not notarized, so
> macOS Gatekeeper will warn that it's from an unidentified developer. Right-click
> the app and choose **Open** (once), or clear the quarantine flag:
>
> ```bash
> xattr -dr com.apple.quarantine /Applications/GitLeviathan.app
> ```

## Development

```bash
npm start      # run the app in dev with Vite HMR
npm run lint   # eslint over .ts/.tsx
npm run make   # build the distributable into out/make/
```

There is no test runner configured.

## Releasing

Releases are built by the **Release (macOS)** GitHub Actions workflow, triggered
manually:

1. Open the repository's **Actions** tab.
2. Select **Release (macOS)** → **Run workflow**.
3. Optionally enter a tag (blank defaults to `v<version>` from `package.json`).

The workflow runs `npm run make` on a macOS runner and publishes the resulting
`.zip` to a GitHub Release as `GitLeviathan-macOS.zip`, which the download link
above resolves to.
