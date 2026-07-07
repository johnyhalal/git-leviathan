# GitLeviathan

GitLeviathan — a cross-platform desktop GUI for Git, built with Electron + Vite +
React + TypeScript via Electron Forge.

## Download

Grab the latest build for your platform from the
[latest release](https://github.com/johnyhalal/git-leviathan/releases/latest):

| Platform | Download |
| --- | --- |
| **macOS** (Intel & Apple Silicon) | [GitLeviathan-macOS.dmg](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-macOS.dmg) |
| **Windows** | [GitLeviathan-Windows-Setup.exe](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Windows-Setup.exe) |
| **Linux — Debian/Ubuntu** (`.deb`) | [x64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-x64.deb) · [arm64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-arm64.deb) |
| **Linux — Fedora/RHEL** (`.rpm`) | [x64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-x64.rpm) · [arm64](https://github.com/johnyhalal/git-leviathan/releases/latest/download/GitLeviathan-Linux-arm64.rpm) |

### macOS

The `.dmg` is a single universal build that runs natively on both Intel and
Apple Silicon. Open it and drag **GitLeviathan** onto the **Applications**
shortcut. The app is Developer ID signed and notarized by Apple, so it launches
without any Gatekeeper warnings — no `xattr` workaround needed.

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
