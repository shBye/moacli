---
name: moacli-windows-release
description: Build, validate, push, and publish the MoaCLI Windows NSIS installer. Use when Codex needs to bump a MoaCLI version, package or verify MoaCLI-Setup.exe, commit and push release source, create a version tag, or upload the installer to a GitHub Release without GitHub CLI.
---

# MoaCLI Windows Release

Produce a reproducible Windows installer without committing build output, credentials, or machine-specific data.

## Prepare

1. Read `docs/WINDOWS_RELEASE.md`, `package.json`, and `electron-builder.yml`.
2. Resolve the repository from the current working directory. Never hardcode a username, home directory, email address, GitHub owner, token, or absolute checkout path.
3. Inspect `git status --short` and preserve unrelated user changes.
4. Release from `main` unless the user explicitly approves tagging another branch.
5. Derive the repository with `git remote get-url origin`; do not embed its value in this skill or generated scripts.

## Build

1. Choose the version with the user. When the current version is already published and the user requests a new installer or release without naming a version, increment only the patch segment.
2. Update both package files with `npm.cmd version <version> --no-git-tag-version`.
3. Run `npm.cmd ci` when dependencies are absent or lockfile fidelity must be re-established.
4. Confirm both `node-pty` Windows x64 prebuilds and the Electron-compatible `better-sqlite3` binary documented in the release guide exist.
5. Run `npm.cmd run typecheck`, then `npm.cmd run package`. Stop on failure.
6. Confirm the packaged `better_sqlite3.node` exists under `out/win-unpacked/resources/app.asar.unpacked`.
7. Keep the stable asset name `out/MoaCLI-Setup.exe`.

## Verify

Run the deterministic verifier from the repository root:

```powershell
powershell -ExecutionPolicy Bypass -File .codex\skills\moacli-windows-release\scripts\verify-release.ps1
```

Record the version, byte size, SHA-256, and packaged SQLite path it reports. Treat any privacy-scan match as a release blocker until reviewed.

Start `out\win-unpacked\MoaCLI.exe` and verify the window opens, profiles load, and a PowerShell session starts. Stop only the exact smoke-test executable after checking its resolved path. Run the NSIS installer when the user requests installation-flow verification.

## Push and Publish

Respect the requested stopping point:

- For "make an installer", stop after verification.
- For "commit and push", commit only intended source and version files, then push `main`; do not infer permission to tag or publish.
- For "upload/publish a release", push the verified source first, create and push annotated tag `v<version>`, then publish.

Publish without GitHub CLI by running the repository-derived API helper from the repository root. Pass concise notes that describe the actual release:

```powershell
powershell -ExecutionPolicy Bypass -File .codex\skills\moacli-windows-release\scripts\publish-release.ps1 -ReleaseNotes $notes
```

The helper obtains the existing GitHub credential through `git credential fill`, keeps it only in process memory, derives the owner and repository from `origin`, and never prints the credential. If no credential is available, stop and offer to open the signed-in GitHub release page instead of introducing GitHub CLI.

After publishing, run the helper with `-VerifyOnly` and confirm the remote asset byte size equals the local installer. Publish a non-draft, non-prerelease release unless the user says otherwise.

## Safety Rules

- Do not commit `out/`, caches, logs, generated screenshots, account directories, or local CLI configuration.
- Do not add a GitHub token, credential-helper output, local email, or personal absolute path to commands saved in the repository.
- Do not overwrite an existing release asset with different bytes unless the user explicitly requests a correction; the publisher requires `-ReplaceExistingAsset` for that case.
- Do not claim code signing. The current build is unsigned.
- Do not tag or publish when typecheck, package, verifier, or smoke testing fails.
