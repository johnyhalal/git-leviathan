// Dev-only cosmetic fix. During `electron-forge start` the app runs *inside*
// node_modules' Electron.app, whose Info.plist names it "Electron" — that's the
// label macOS shows in the dock and menu bar. Packaged builds get the right
// name from `productName`, but dev doesn't, so rewrite the dev bundle's plist to
// match. `npm install`/electron upgrades restore the stock plist, which is why
// this runs from `prestart` on every launch rather than once.
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';

if (process.platform !== 'darwin') process.exit(0);

const plist = 'node_modules/electron/dist/Electron.app/Contents/Info.plist';
if (!existsSync(plist)) process.exit(0);

const { productName } = JSON.parse(readFileSync('package.json', 'utf8'));

const set = (key) => {
  const args = ['-c', `Set :${key} ${productName}`, plist];
  try {
    execFileSync('/usr/libexec/PlistBuddy', args);
  } catch {
    // Key missing on a fresh bundle — add it instead of failing.
    execFileSync('/usr/libexec/PlistBuddy', [
      '-c',
      `Add :${key} string ${productName}`,
      plist,
    ]);
  }
};

set('CFBundleName');
set('CFBundleDisplayName');

// macOS draws the dock/menu label from LaunchServices' cached bundle name, not
// the plist we just edited, so the rename is invisible until the bundle is
// re-registered. Bump the bundle mtime and force LaunchServices to re-read it.
const appPath = 'node_modules/electron/dist/Electron.app';
const lsregister =
  '/System/Library/Frameworks/CoreServices.framework/Frameworks' +
  '/LaunchServices.framework/Support/lsregister';
try {
  execFileSync('touch', [appPath]);
  execFileSync(lsregister, ['-f', appPath]);
} catch {
  // Non-fatal: worst case the dock keeps the stale name for one launch.
}
