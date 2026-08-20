[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Get-Location).Path,
  [string]$InstallerRelativePath = 'out\MoaCLI-Setup.exe'
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$packagePath = Join-Path $root 'package.json'
$latestPath = Join-Path $root 'out\latest.yml'
$installerPath = Join-Path $root $InstallerRelativePath

if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) {
  throw "Not a Git repository: $root"
}
if (-not (Test-Path -LiteralPath $packagePath)) {
  throw 'package.json was not found.'
}

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.name -ne 'moacli') {
  throw "Unexpected package name: $($package.name)"
}

$expectedVersion = [string]$package.version
$prebuilds = @(
  'node_modules\node-pty\prebuilds\win32-x64\pty.node',
  'node_modules\node-pty\prebuilds\win32-x64\conpty.node'
)
foreach ($relativePath in $prebuilds) {
  if (-not (Test-Path -LiteralPath (Join-Path $root $relativePath))) {
    throw "Required node-pty prebuild is missing: $relativePath"
  }
}

if (-not (Test-Path -LiteralPath $installerPath)) {
  throw "Installer was not found: $InstallerRelativePath"
}
if (-not (Test-Path -LiteralPath $latestPath)) {
  throw 'out\latest.yml was not found.'
}

$installer = Get-Item -LiteralPath $installerPath
$productVersion = [string]$installer.VersionInfo.ProductVersion
if (-not $productVersion.StartsWith($expectedVersion)) {
  throw "Installer version $productVersion does not match package version $expectedVersion."
}

$latest = Get-Content -LiteralPath $latestPath -Raw
if ($latest -notmatch "(?m)^version:\s+$([regex]::Escape($expectedVersion))\s*$") {
  throw "latest.yml does not declare version $expectedVersion."
}

$privacyPattern = 'C:\\Users\\[^\\\s]+|/Users/[^/\s]+|github_pat_[A-Za-z0-9_]+|ghp_[A-Za-z0-9]+|sk-[A-Za-z0-9]{20,}|Bearer\s+[A-Za-z0-9._-]{20,}'
$privacyMatches = & git -C $root grep -n -I -E $privacyPattern -- . ':(exclude).codex/skills/moacli-windows-release/scripts/verify-release.ps1' 2>$null
if ($LASTEXITCODE -eq 0 -and $privacyMatches) {
  throw "Tracked personal path or credential-like text found:`n$($privacyMatches -join [Environment]::NewLine)"
}
if ($LASTEXITCODE -notin @(0, 1)) {
  throw 'The tracked-file privacy scan failed to run.'
}

$hash = Get-FileHash -LiteralPath $installer.FullName -Algorithm SHA256
[pscustomobject]@{
  ProductName = $installer.VersionInfo.ProductName
  Version = $expectedVersion
  Installer = $installer.FullName
  Bytes = $installer.Length
  SHA256 = $hash.Hash
  LatestMetadata = $latestPath
  PrivacyScan = 'passed'
}
