---
name: moacli-windows-release
description: Build, validate, and publish the MoaCLI Windows NSIS installer. Use when Codex needs to bump a MoaCLI release version, run packaging, verify installer metadata and checksums, smoke-test the unpacked app, check tracked files for credentials or personal paths, create a version tag, or upload MoaCLI-Setup.exe to a GitHub Release.
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

1. Choose the version with the user or infer only an unambiguous requested patch version.
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

## Publish

1. Commit and push release source before tagging, only when requested.
2. Create an annotated `v<version>` tag on the verified commit and push it.
3. Prefer authenticated GitHub CLI publishing while deriving the repository dynamically:

```powershell
$repo = gh repo view --json nameWithOwner --jq .nameWithOwner
gh release create "v$version" .\out\MoaCLI-Setup.exe --repo $repo --title "MoaCLI v$version" --notes "Windows installer release. This build is not code-signed."
```

4. If `gh` is unavailable, use the signed-in GitHub UI. Never extract, print, store, or commit a credential to publish a release.
5. Publish a non-draft, non-prerelease release unless the user says otherwise.
6. Verify `releases/latest/download/MoaCLI-Setup.exe` returns HTTP 200 and its content length matches the local file.

## Safety Rules

- Do not commit `out/`, caches, logs, generated screenshots, account directories, or local CLI configuration.
- Do not add a GitHub token, credential-helper output, local email, or personal absolute path to commands saved in the repository.
- Do not overwrite an existing release asset without confirming it belongs to the same version. Replace it only when the user explicitly requests an upgrade or correction.
- Do not claim code signing. The current build is unsigned.
- Do not tag or publish when typecheck, package, verifier, or smoke testing fails.
