// Load .env so build-time secrets (Apple notarization creds, OAuth client IDs)
// are on process.env regardless of how forge is invoked (npm script, CI, bare
// electron-forge). .env is gitignored — never commit it.
import 'dotenv/config';
import { execFileSync } from 'node:child_process';
import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerZIP } from '@electron-forge/maker-zip';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

// The bundled git shipped as `extraResource` (see src/git.ts). Single-arch
// platforms ship dugite's own `git` folder as `resources/git`. The macOS
// universal build can't use a single-arch git, so its workflow prepares
// per-arch copies and sets MAC_UNIVERSAL_GIT — we then ship both as
// `resources/git-arm64` + `resources/git-x64` and pick by arch at runtime.
const bundledGit = process.env.MAC_UNIVERSAL_GIT
  ? ['./.git-bundle/git-arm64', './.git-bundle/git-x64']
  : ['./node_modules/dugite/git'];

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Ship a self-contained git so the app runs on machines with no git
    // installed. This is dugite's platform build (~140MB/arch); Packager copies
    // it into `resources/`, where src/git.ts points `LOCAL_GIT_DIRECTORY` at
    // runtime. dugite's postinstall only fetches the *host* platform's git, so
    // each platform's distributable must be built on (or cross-fetched for) that
    // platform — the release CI runs a job per OS/arch. If the folder is absent
    // the app falls back to the system git on PATH.
    extraResource: bundledGit,
    // Universal (x64+arm64) stitching: @electron/universal lipo-merges Mach-O
    // binaries that differ per arch, but errors on a Mach-O file that's
    // byte-identical in both builds unless it's declared single-arch. We ship
    // BOTH per-arch gits (git-arm64 + git-x64) in every build and pick by arch
    // at runtime (see src/git.ts), so each git folder's binaries are identical
    // across the x64 and arm64 builds — declare them here so stitching accepts
    // them instead of failing with "not covered by the x64ArchFiles rule".
    osxUniversal: {
      x64ArchFiles: '**/git-{arm64,x64}/**',
    },
    // Base path — Packager appends .icns (macOS) / .ico (Windows) per platform.
    // Generate those from assets/icon.svg; assets/icon.png is a placeholder.
    icon: './assets/icon',
    // Re-sign on macOS *after* the FusesPlugin flips the fuses and the packager
    // rewrites Info.plist. Without this the app keeps Electron's stock ad-hoc
    // signature, which those post-signing edits invalidate — and on Apple Silicon
    // a quarantined (downloaded) app with a broken signature fails to load the
    // Electron Framework at launch. Signing also embeds the ElectronAsarIntegrity
    // hash required by the EnableEmbeddedAsarIntegrityValidation fuse.
    //
    // Signed with the company Developer ID + hardened runtime; entitlements.plist
    // grants back the JIT / unsigned-executable-memory / library-validation that
    // hardened runtime blocks but Electron (V8) needs. Paired with osxNotarize
    // below so Gatekeeper accepts a downloaded build with no `xattr -cr`.
    osxSign: {
      identity: 'Developer ID Application: Designatives Ltd. (CNPU2N4697)',
      optionsForFile: () => ({
        hardenedRuntime: true,
        entitlements: 'entitlements.plist',
      }),
    },
    // Notarization uploads the signed app to Apple's notary service and staples
    // the ticket. Credentials come from the environment — never commit them:
    //   APPLE_ID                     Apple Developer account email
    //   APPLE_APP_SPECIFIC_PASSWORD  app-specific password from appleid.apple.com
    //   APPLE_TEAM_ID                CNPU2N4697
    osxNotarize: {
      appleId: process.env.APPLE_ID!,
      appleIdPassword: process.env.APPLE_APP_SPECIFIC_PASSWORD!,
      teamId: process.env.APPLE_TEAM_ID!,
    },
  },
  rebuildConfig: {},
  hooks: {
    // osxNotarize above notarizes+staples the .app *inside* the DMG, but not the
    // DMG file itself — so a freshly made .dmg has no ticket of its own and only
    // validates online. Submit the DMG to the notary service and staple it here
    // so it validates offline too. Runs only on macOS and only when creds exist,
    // so Linux/Windows makes and credential-less local builds still succeed.
    postMake: async (_forgeConfig, makeResults) => {
      if (process.platform !== 'darwin') return makeResults;
      const { APPLE_ID, APPLE_APP_SPECIFIC_PASSWORD, APPLE_TEAM_ID } = process.env;
      if (!APPLE_ID || !APPLE_APP_SPECIFIC_PASSWORD || !APPLE_TEAM_ID) {
        console.warn('[postMake] Apple creds missing — skipping DMG notarization.');
        return makeResults;
      }
      const dmgs = makeResults.flatMap((r) => r.artifacts).filter((a) => a.endsWith('.dmg'));
      for (const dmg of dmgs) {
        execFileSync(
          'xcrun',
          ['notarytool', 'submit', dmg,
            '--apple-id', APPLE_ID,
            '--password', APPLE_APP_SPECIFIC_PASSWORD,
            '--team-id', APPLE_TEAM_ID,
            '--wait'],
          { stdio: 'inherit' },
        );
        execFileSync('xcrun', ['stapler', 'staple', dmg], { stdio: 'inherit' });
      }
      return makeResults;
    },
  },
  makers: [
    new MakerSquirrel({}),
    // macOS installer .dmg. Custom artwork: assets/dmg-background.png (with an
    // @2x retina variant beside it, which appdmg picks up automatically) is a
    // white background with a bold slate (#263548, the marketing site's bg tone)
    // arrow drawn in the gap between the two icons. The window size must match the
    // 1x background (660x400); the icons sit at y=210 with the app on the left and
    // the Applications drop target on the right, so users drag across to install
    // and the arrow points the way — the standard macOS flow.
    new MakerDMG(
      {
        name: 'GitLeviathan',
        icon: './assets/icon.icns', // volume icon
        background: './assets/dmg-background.png',
        additionalDMGOptions: { window: { size: { width: 660, height: 400 } } },
        contents: (opts) => [
          { x: 180, y: 210, type: 'file', path: opts.appPath },
          { x: 480, y: 210, type: 'link', path: '/Applications' },
        ],
      },
      ['darwin'],
    ),
    // macOS in-app auto-update payload. Electron's `autoUpdater` (Squirrel.Mac)
    // updates from a **.zip** of the signed .app, not the .dmg — the dmg is the
    // first-install image, the zip is what update.electronjs.org serves to
    // running apps. The release CI uploads this zip alongside the dmg, named so
    // the hosted feed can match it to platform+arch. macOS-only: Windows updates
    // through Squirrel's own .nupkg/RELEASES (MakerSquirrel) and Linux through
    // its deb/rpm repos.
    new MakerZIP({}, ['darwin']),
    // `bin` must match the packaged executable's name. Packager names the Linux
    // binary after productName ("GitLeviathan"), but these makers otherwise look
    // for one named after package.json's `name` ("gitleviathan") and fail with
    // "could not find the Electron app binary". Point them at the real name
    // rather than renaming the binary globally (which would touch the signed
    // macOS build and the Windows .exe).
    new MakerRpm({ options: { bin: 'GitLeviathan' } }),
    new MakerDeb({ options: { bin: 'GitLeviathan' } }),
  ],
  plugins: [
    new VitePlugin({
      // `build` can specify multiple entry builds, which can be Main process, Preload scripts, Worker process, etc.
      // If you are familiar with Vite configuration, it will look really familiar.
      build: [
        {
          // `entry` is just an alias for `build.lib.entry` in the corresponding file of `config`.
          entry: 'src/main.ts',
          config: 'vite.main.config.ts',
          target: 'main',
        },
        {
          entry: 'src/preload.ts',
          config: 'vite.preload.config.ts',
          target: 'preload',
        },
      ],
      renderer: [
        {
          name: 'main_window',
          config: 'vite.renderer.main.config.ts',
        },
        {
          name: 'splash_window',
          config: 'vite.renderer.splash.config.ts',
        },
      ],
    }),
    // Fuses are used to enable/disable various Electron functionality
    // at package time, before code signing the application
    new FusesPlugin({
      version: FuseVersion.V1,
      [FuseV1Options.RunAsNode]: false,
      // On now that the app ships Developer ID signed. Cookie encryption stores
      // its key in the macOS keychain as "GitLeviathan Safe Storage"; a stable
      // Developer ID signature makes the keychain grant persistent, so it no
      // longer prompts for the keychain password on every launch the way the old
      // ad-hoc build did.
      [FuseV1Options.EnableCookieEncryption]: true,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
