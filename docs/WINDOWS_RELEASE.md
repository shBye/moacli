# Windows Release Guide

This guide is the verified process for producing and publishing the MoaCLI Windows installer.

The process was last verified on Windows 11 on August 19, 2026. The generated installer was installed and launched successfully.

## Release outputs

`npm.cmd run package` produces:

| Path | Purpose |
| --- | --- |
| `out/MoaCLI-Setup.exe` | x64 NSIS installer distributed to users |
| `out/MoaCLI-Setup.exe.blockmap` | Update metadata reserved for future auto-update support |
| `out/win-unpacked/MoaCLI.exe` | Unpacked executable used for a startup smoke test |
| `out/latest.yml` | electron-builder release metadata |

The installer filename must remain `MoaCLI-Setup.exe`. The README download URL relies on that stable asset name.

## Prerequisites

- Windows 10 or Windows 11 x64
- Node.js and npm
- Git
- A clean checkout of `main`
- `build/icon.ico`
- Write access to `%LOCALAPPDATA%\electron-builder` and `%USERPROFILE%\.electron-gyp`
- GitHub CLI only when publishing from the command line

The current `node-pty` dependency includes Windows x64 prebuilt binaries. Confirm they are present after installing dependencies:

```powershell
Test-Path .\node_modules\node-pty\prebuilds\win32-x64\pty.node
Test-Path .\node_modules\node-pty\prebuilds\win32-x64\conpty.node
```

Both commands must return `True`.

## 1. Prepare the version

Start from an up-to-date and clean `main` branch:

```powershell
git switch main
git pull --ff-only origin main
git status --short
npm.cmd ci
```

For a new version, update `package.json` and `package-lock.json` together. Replace the example version as needed:

```powershell
npm.cmd version 0.1.1 --no-git-tag-version
```

The package version becomes the installer file and product version.

## 2. Validate the source

```powershell
npm.cmd run typecheck
npm.cmd run build
```

Do not continue when either command fails.

## 3. Build the installer

```powershell
npm.cmd run package
```

The package script builds the application and invokes electron-builder without publishing. Its behavior is defined by `electron-builder.yml`:

- x64 NSIS installer
- per-user installation
- selectable installation directory
- desktop and Start menu shortcuts
- MoaCLI icons for the application, installer, and uninstaller
- English installer UI
- output under `out/`

`npmRebuild` is intentionally disabled. `node-pty@1.1.0` already provides the required Windows x64 Electron-compatible binaries, while forcing a native rebuild adds a Python and Visual Studio toolchain dependency.

## 4. Verify the package

Inspect the artifact, metadata, and checksum:

```powershell
$installer = Get-Item .\out\MoaCLI-Setup.exe
$installer | Select-Object FullName, Length, LastWriteTime
$installer.VersionInfo | Select-Object ProductName, FileDescription, FileVersion, ProductVersion
Get-FileHash -Algorithm SHA256 $installer.FullName
```

Expected metadata:

- Product name: `MoaCLI`
- File description: the description from `package.json`
- File and product version: the current package version

Run the unpacked application before testing the installer:

```powershell
Start-Process .\out\win-unpacked\MoaCLI.exe
```

Confirm that the main window opens, agent versions load, and a PowerShell terminal can be started. Close the smoke-test application before running the installer.

Run the installer and verify the installed application:

```powershell
Start-Process .\out\MoaCLI-Setup.exe
```

Installation checklist:

- The installer displays the MoaCLI icon.
- A custom installation directory can be selected.
- Desktop and Start menu shortcuts are created.
- The installed application opens successfully.
- The Windows taskbar displays the MoaCLI icon.
- Existing MoaCLI settings and account-directory references remain available.
- Uninstall is available from Windows Installed apps.

The application is currently unsigned. Windows SmartScreen may therefore show `Unknown publisher`; this is expected until a code-signing certificate is configured.

## 5. Publish a GitHub Release

Commit and push the release source before creating the tag:

```powershell
git add package.json package-lock.json electron-builder.yml README.md docs/WINDOWS_RELEASE.md
git commit -m "Prepare MoaCLI v0.1.1"
git push origin main
git tag -a v0.1.1 -m "MoaCLI v0.1.1"
git push origin v0.1.1
```

With GitHub CLI installed and authenticated:

```powershell
gh release create v0.1.1 .\out\MoaCLI-Setup.exe `
  --repo shBye/moacli `
  --title "MoaCLI v0.1.1" `
  --notes "Windows installer release. This build is not code-signed."
```

Alternatively, create a non-draft, non-prerelease GitHub Release from the repository website and attach `out/MoaCLI-Setup.exe`.

Verify the stable README URL after publishing:

```powershell
$response = Invoke-WebRequest `
  -Method Head `
  -Uri 'https://github.com/shBye/moacli/releases/latest/download/MoaCLI-Setup.exe' `
  -UseBasicParsing
$response.StatusCode
$response.Headers['Content-Length']
```

The status must be `200`, and the content length must match the local installer.

## Failure recovery

### Native rebuild fails with `No module named 'distutils'`

Cause: electron-builder attempted to rebuild `node-pty` through `node-gyp`, but the selected Python environment did not provide the required packaging modules.

Current resolution:

1. Keep `npmRebuild: false` in `electron-builder.yml`.
2. Confirm the `node-pty` Windows x64 prebuilds exist.
3. Run `npm.cmd run package` again.

If a future Electron or `node-pty` upgrade no longer supplies compatible prebuilds, install the supported Python and Visual Studio C++ build tools, then explicitly rebuild and test `node-pty`. Do not silently keep `npmRebuild: false` after changing the ABI combination.

### Cache write fails under `.electron-gyp`

Cause: the build was started from a restricted process that could not write to the normal user cache.

Resolution: run the package command from a normal local PowerShell process with write access to `%USERPROFILE%\.electron-gyp`. Do not redirect the cache into the repository or commit generated cache files.

### `winCodeSign` extraction fails with `Cannot create symbolic link`

Cause: the electron-builder archive contains macOS library symlinks. Windows can reject their creation when Developer Mode is disabled and the process does not have symlink permission. The Windows signing-resource files may still have extracted correctly.

Preferred resolution:

1. Enable Windows Developer Mode or run the build from an elevated PowerShell window.
2. Run `npm.cmd run package` again.

Verified fallback for `winCodeSign-2.6.0`:

```powershell
$cache = Join-Path $env:LOCALAPPDATA 'electron-builder\Cache\winCodeSign'
$target = Join-Path $cache 'winCodeSign-2.6.0'
$source = Get-ChildItem -LiteralPath $cache -Directory |
  Where-Object {
    $_.Name -match '^\d+$' -and
    (Test-Path (Join-Path $_.FullName 'rcedit-x64.exe')) -and
    (Test-Path (Join-Path $_.FullName 'windows-10\x64\signtool.exe'))
  } |
  Sort-Object LastWriteTime -Descending |
  Select-Object -First 1

if (-not $source) {
  throw 'No complete Windows winCodeSign extraction was found.'
}

New-Item -ItemType Directory -Path $target -Force | Out-Null
Copy-Item -Path (Join-Path $source.FullName '*') -Destination $target -Recurse -Force

Get-Item `
  (Join-Path $target 'rcedit-x64.exe'), `
  (Join-Path $target 'windows-10\x64\signtool.exe')
```

Run `npm.cmd run package` again after both files are confirmed. This fallback is limited to the current tool version and is safe here because the failed symlinks are macOS-only libraries that are not used for a Windows x64 package. Re-evaluate the directory name and archive contents after upgrading electron-builder.

## Release checklist

- [ ] Version updated in both package files
- [ ] Typecheck passed
- [ ] Production build passed
- [ ] NSIS package completed
- [ ] Product metadata and embedded icon verified
- [ ] SHA-256 recorded
- [ ] Unpacked application smoke test passed
- [ ] Installer and uninstall flow passed
- [ ] Source committed and pushed before tagging
- [ ] Annotated version tag pushed
- [ ] `MoaCLI-Setup.exe` uploaded to a public, non-prerelease GitHub Release
- [ ] README latest-download URL returned HTTP 200
