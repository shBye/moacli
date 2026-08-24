[CmdletBinding()]
param(
  [string]$RepositoryRoot = (Get-Location).Path,
  [string]$InstallerRelativePath = 'out\MoaCLI-Setup.exe',
  [string]$ReleaseNotes = 'Windows installer release. This build is not code-signed.',
  [switch]$ReplaceExistingAsset,
  [switch]$VerifyOnly
)

$ErrorActionPreference = 'Stop'
Set-StrictMode -Version Latest

$root = (Resolve-Path -LiteralPath $RepositoryRoot).Path
$packagePath = Join-Path $root 'package.json'
$installerPath = Join-Path $root $InstallerRelativePath
if (-not (Test-Path -LiteralPath (Join-Path $root '.git'))) { throw "Not a Git repository: $root" }
if (-not (Test-Path -LiteralPath $packagePath)) { throw 'package.json was not found.' }
if (-not (Test-Path -LiteralPath $installerPath)) { throw "Installer was not found: $InstallerRelativePath" }

$package = Get-Content -LiteralPath $packagePath -Raw | ConvertFrom-Json
if ($package.name -ne 'moacli') { throw "Unexpected package name: $($package.name)" }
$version = [string]$package.version
$tag = "v$version"
$installer = Get-Item -LiteralPath $installerPath

$origin = (& git -C $root remote get-url origin).Trim()
if ($LASTEXITCODE -ne 0 -or -not $origin) { throw 'Unable to resolve the origin remote.' }
$match = [regex]::Match($origin, 'github\.com[/:](?<owner>[^/]+?)/(?<repo>[^/]+?)(?:\.git)?$')
if (-not $match.Success) { throw "Origin is not a supported GitHub URL: $origin" }
$owner = $match.Groups['owner'].Value
$repository = $match.Groups['repo'].Value
$repositorySlug = "$owner/$repository"

$head = (& git -C $root rev-parse HEAD).Trim()
$tagCommit = (& git -C $root rev-list -n 1 $tag 2>$null).Trim()
if ($LASTEXITCODE -ne 0 -or -not $tagCommit) { throw "Release tag does not exist: $tag" }
if ($tagCommit -ne $head) { throw "Tag $tag does not point to HEAD." }
$remoteMain = (& git -C $root rev-parse origin/main).Trim()
if ($LASTEXITCODE -ne 0 -or $remoteMain -ne $head) { throw 'HEAD has not been pushed to origin/main.' }

$credentialLines = "protocol=https`nhost=github.com`npath=$repositorySlug`n`n" | git credential fill
$credential = @{}
foreach ($line in $credentialLines) {
  $separator = $line.IndexOf('=')
  if ($separator -gt 0) {
    $credential[$line.Substring(0, $separator)] = $line.Substring($separator + 1)
  }
}
$token = $credential['password']
if (-not $token) { throw 'No GitHub credential is available from git credential fill.' }

$headers = @{
  Authorization = "Bearer $token"
  Accept = 'application/vnd.github+json'
  'X-GitHub-Api-Version' = '2022-11-28'
  'User-Agent' = 'MoaCLI-release-publisher'
}
$repositoryApi = "https://api.github.com/repos/$repositorySlug"
$release = $null
try {
  $release = Invoke-RestMethod -Method Get -Uri "$repositoryApi/releases/tags/$tag" -Headers $headers
} catch {
  $statusCode = $_.Exception.Response.StatusCode.value__
  if ($statusCode -ne 404) { throw }
}

if (-not $release -and $VerifyOnly) { throw "GitHub Release does not exist: $tag" }
if (-not $release) {
  $payload = @{
    tag_name = $tag
    target_commitish = 'main'
    name = "MoaCLI $tag"
    body = $ReleaseNotes
    draft = $false
    prerelease = $false
  } | ConvertTo-Json
  $release = Invoke-RestMethod -Method Post -Uri "$repositoryApi/releases" -Headers $headers -ContentType 'application/json' -Body $payload
}

$assetResponse = Invoke-RestMethod -Method Get -Uri "$repositoryApi/releases/$($release.id)/assets" -Headers $headers
$assets = if ($null -eq $assetResponse) { @() } else { @($assetResponse) }
$existingAsset = $assets | Where-Object {
  $null -ne $_ -and $_.PSObject.Properties.Name -contains 'name' -and $_.name -eq $installer.Name
} | Select-Object -First 1
if ($existingAsset -and [long]$existingAsset.size -eq $installer.Length) {
  [pscustomobject]@{
    Tag = $tag
    ReleaseUrl = $release.html_url
    AssetUrl = $existingAsset.browser_download_url
    Bytes = [long]$existingAsset.size
    Status = 'verified'
  }
  exit 0
}
if ($VerifyOnly) { throw 'Remote release asset is missing or its byte size differs from the local installer.' }
if ($existingAsset -and -not $ReplaceExistingAsset) {
  throw 'A release asset with the same name but different size already exists. Use -ReplaceExistingAsset only for an approved correction.'
}
if ($existingAsset) {
  Invoke-RestMethod -Method Delete -Uri "$repositoryApi/releases/assets/$($existingAsset.id)" -Headers $headers | Out-Null
}

$escapedName = [uri]::EscapeDataString($installer.Name)
$uploadUri = "https://uploads.github.com/repos/$repositorySlug/releases/$($release.id)/assets?name=$escapedName"
$uploadedAsset = Invoke-RestMethod -Method Post -Uri $uploadUri -Headers $headers -ContentType 'application/octet-stream' -InFile $installer.FullName
if ([long]$uploadedAsset.size -ne $installer.Length) { throw 'Uploaded asset size does not match the local installer.' }

[pscustomobject]@{
  Tag = $tag
  ReleaseUrl = $release.html_url
  AssetUrl = $uploadedAsset.browser_download_url
  Bytes = [long]$uploadedAsset.size
  Status = 'published'
}
