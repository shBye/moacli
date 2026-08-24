import { app, net, shell } from 'electron'
import type { AppUpdateInfo } from './contracts'

const RELEASE_API_URL = 'https://api.github.com/repos/shBye/moacli/releases/latest'
const RELEASE_CACHE_MS = 15 * 60 * 1000
const REQUEST_TIMEOUT_MS = 10_000

interface GitHubReleaseAsset {
  name?: unknown
  browser_download_url?: unknown
}

interface GitHubReleaseResponse {
  tag_name?: unknown
  html_url?: unknown
  published_at?: unknown
  assets?: unknown
}

let cachedUpdate: AppUpdateInfo | null = null

function normalizedVersion(value: string): string {
  return value.trim().replace(/^v/i, '').split('-')[0]
}

function versionParts(value: string): number[] | null {
  const normalized = normalizedVersion(value)
  if (!/^\d+(?:\.\d+){1,3}$/.test(normalized)) return null
  return normalized.split('.').map(Number)
}

function isNewerVersion(candidate: string, current: string): boolean {
  const candidateParts = versionParts(candidate)
  const currentParts = versionParts(current)
  if (!candidateParts || !currentParts) return false
  const length = Math.max(candidateParts.length, currentParts.length)
  for (let index = 0; index < length; index += 1) {
    const difference = (candidateParts[index] ?? 0) - (currentParts[index] ?? 0)
    if (difference !== 0) return difference > 0
  }
  return false
}

function githubUrl(value: unknown): string {
  if (typeof value !== 'string') return ''
  try {
    const url = new URL(value)
    return url.protocol === 'https:' && url.hostname === 'github.com' ? url.toString() : ''
  } catch {
    return ''
  }
}

function releaseAssets(value: unknown): GitHubReleaseAsset[] {
  if (!Array.isArray(value)) return []
  return value.filter((asset): asset is GitHubReleaseAsset => typeof asset === 'object' && asset !== null)
}

export async function checkForAppUpdate(force = false): Promise<AppUpdateInfo> {
  const currentVersion = app.getVersion()
  if (!force && cachedUpdate && Date.now() - cachedUpdate.checkedAt < RELEASE_CACHE_MS) return cachedUpdate

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
  try {
    const response = await net.fetch(RELEASE_API_URL, {
      headers: {
        Accept: 'application/vnd.github+json',
        'User-Agent': `MoaCLI/${currentVersion}`,
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: controller.signal,
    })
    if (!response.ok) throw new Error(`GitHub returned HTTP ${response.status}`)
    const release = await response.json() as GitHubReleaseResponse
    const tag = typeof release.tag_name === 'string' ? release.tag_name : ''
    const latestVersion = normalizedVersion(tag)
    if (!versionParts(latestVersion)) throw new Error('The latest GitHub release has an invalid version')

    const installerAsset = releaseAssets(release.assets).find((asset) => asset.name === 'MoaCLI-Setup.exe')
    cachedUpdate = {
      currentVersion,
      latestVersion,
      updateAvailable: isNewerVersion(latestVersion, currentVersion),
      releaseUrl: githubUrl(release.html_url),
      installerUrl: githubUrl(installerAsset?.browser_download_url),
      publishedAt: typeof release.published_at === 'string' ? release.published_at : '',
      checkedAt: Date.now(),
    }
    return cachedUpdate
  } finally {
    clearTimeout(timeout)
  }
}

export async function downloadAppUpdate(): Promise<boolean> {
  const update = await checkForAppUpdate()
  if (!update.updateAvailable) return false
  const target = update.installerUrl || update.releaseUrl
  if (!target) throw new Error('The latest release does not provide a trusted download URL')
  await shell.openExternal(target)
  return true
}
