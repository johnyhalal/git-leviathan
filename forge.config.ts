import type { ForgeConfig } from '@electron-forge/shared-types';
import { MakerSquirrel } from '@electron-forge/maker-squirrel';
import { MakerDMG } from '@electron-forge/maker-dmg';
import { MakerDeb } from '@electron-forge/maker-deb';
import { MakerRpm } from '@electron-forge/maker-rpm';
import { VitePlugin } from '@electron-forge/plugin-vite';
import { FusesPlugin } from '@electron-forge/plugin-fuses';
import { FuseV1Options, FuseVersion } from '@electron/fuses';

const config: ForgeConfig = {
  packagerConfig: {
    asar: true,
    // Base path — Packager appends .icns (macOS) / .ico (Windows) per platform.
    // Generate those from assets/icon.svg; assets/icon.png is a placeholder.
    icon: './assets/icon',
    // Re-sign on macOS *after* the FusesPlugin flips the fuses and the packager
    // rewrites Info.plist. Without this the app keeps Electron's stock ad-hoc
    // signature, which those post-signing edits invalidate — and on Apple Silicon
    // a quarantined (downloaded) app with a broken signature fails to load the
    // Electron Framework at launch. Signing also embeds the ElectronAsarIntegrity
    // hash required by the EnableEmbeddedAsarIntegrityValidation fuse.
    // `identity: '-'` = ad-hoc (no Apple Developer certificate needed); recipients
    // strip quarantine once via `xattr -cr <app>` since ad-hoc isn't notarized.
    osxSign: {
      identity: '-',
      // '-' isn't a keychain identity, so skip the `security find-identity`
      // check that would otherwise find nothing and silently skip signing.
      identityValidation: false,
      optionsForFile: () => ({ hardenedRuntime: false }),
    },
  },
  rebuildConfig: {},
  makers: [
    new MakerSquirrel({}),
    // macOS installer .dmg. maker-dmg's default window already shows the app
    // icon beside an Applications shortcut, so users drag the app onto
    // Applications to install — the standard macOS flow. To ship fully custom
    // artwork, add a `background` PNG (ideally with an @2x variant) and position
    // the two icons to match it via a `contents` function, e.g.:
    //   background: './assets/dmg-background.png',
    //   additionalDMGOptions: { window: { size: { width: 660, height: 400 } } },
    //   contents: (opts) => [
    //     { x: 180, y: 210, type: 'file', path: opts.appPath },
    //     { x: 480, y: 210, type: 'link', path: '/Applications' },
    //   ],
    new MakerDMG(
      {
        name: 'GitLeviathan',
        icon: './assets/icon.icns', // volume icon
      },
      ['darwin'],
    ),
    new MakerRpm({}),
    new MakerDeb({}),
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
      // Off deliberately. Cookie encryption stores its key in the macOS keychain
      // as "GitLeviathan Safe Storage", which an ad-hoc-signed build (no Developer
      // ID identity) can't access silently — so it prompts for the keychain
      // password on every launch. The app has no auth/session and never loads
      // remote pages as UI; the only cookies possible are incidental ones from
      // fetching public GitHub avatar images (RemoteAvatar.tsx), i.e. nothing
      // sensitive. Re-enable once the app stores secrets AND is Developer ID
      // signed (a stable signature makes the keychain grant persistent).
      [FuseV1Options.EnableCookieEncryption]: false,
      [FuseV1Options.EnableNodeOptionsEnvironmentVariable]: false,
      [FuseV1Options.EnableNodeCliInspectArguments]: false,
      [FuseV1Options.EnableEmbeddedAsarIntegrityValidation]: true,
      [FuseV1Options.OnlyLoadAppFromAsar]: true,
    }),
  ],
};

export default config;
