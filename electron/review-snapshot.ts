import { execFile } from 'node:child_process'
import { createHash, randomUUID } from 'node:crypto'
import { lstat, readFile, realpath } from 'node:fs/promises'
import { isAbsolute, relative, resolve } from 'node:path'
import { promisify } from 'node:util'
import type { ReviewSnapshot } from './review-contracts'

const exec = promisify(execFile)
const MAX_PATCH_BYTES = 180_000
const MAX_FILES = 100

async function git(cwd: string, args: string[]): Promise<string> {
  const { stdout } = await exec('git', ['--no-optional-locks', '-c', 'core.quotePath=false', ...args], {
    cwd, windowsHide: true, encoding: 'utf8', timeout: 15_000, maxBuffer: 2 * 1024 * 1024,
  })
  return stdout
}

// No checkout, index writes, external diff drivers, or text-conversion commands.
// Capture twice to reject a moving worktree instead of labelling mixed data as a snapshot.
async function capture(cwd: string): Promise<Omit<ReviewSnapshot, 'id' | 'capturedAt'>> {
  let root: string
  try { root = (await git(cwd, ['rev-parse', '--show-toplevel'])).trim() }
  catch (error) {
    const detail = String(error)
    if (/not a git repository|must be run in a work tree/i.test(detail)) {
      throw new Error(`Git changes cannot be previewed in this folder: ${cwd}\nOpen a session in the project's Git repository, then preview again. This action only analyzes uncommitted Git changes; it does not run a general task.`)
    }
    throw error
  }
  let head: string
  try { head = (await git(root, ['rev-parse', '--verify', 'HEAD'])).trim() }
  catch { throw new Error('Make an initial Git commit before requesting a review.') }
  const files = (await git(root, ['diff', '--name-only', '-z', head, '--'])).split('\0').filter(Boolean)
  const untracked = (await git(root, ['ls-files', '--others', '--exclude-standard', '-z'])).split('\0').filter(Boolean)
  if (files.length + untracked.length > MAX_FILES) throw new Error('Too many changed files. Review up to 100 files at a time.')
  let patch = await git(root, ['diff', '--no-ext-diff', '--no-textconv', '--no-renames', '--unified=8', head, '--'])
  for (const file of untracked) {
    const path = resolve(root, file)
    const actual = await realpath(path)
    const rel = relative(await realpath(root), actual)
    if (isAbsolute(rel) || rel === '..' || rel.startsWith('..\\') || rel.startsWith('../')) throw new Error(`Cannot capture a file outside the repository: ${file}`)
    const stat = await lstat(path)
    if (!stat.isFile() || stat.isSymbolicLink()) throw new Error(`Only regular text files can be reviewed: ${file}`)
    if (stat.size > MAX_PATCH_BYTES) throw new Error(`File is too large for a snapshot review: ${file}`)
    const bytes = await readFile(path)
    if (bytes.includes(0)) throw new Error(`Binary files are not supported in snapshot reviews: ${file}`)
    patch += `\n--- New file: ${JSON.stringify(file)} ---\n${bytes.toString('utf8')}\n`
  }
  if (!files.length && !untracked.length) throw new Error('No uncommitted changes found in this repository.')
  if (/^Binary files .* differ$/m.test(patch) || /^GIT binary patch$/m.test(patch)) throw new Error('Binary changes cannot be reviewed. Commit or remove them from this review first.')
  if (Buffer.byteLength(patch) > MAX_PATCH_BYTES) throw new Error('The changes exceed the review size limit (180 KB). Split them into smaller changes.')
  const allFiles = [...new Set([...files, ...untracked])].sort()
  const digest = createHash('sha256').update(JSON.stringify({ head, files: allFiles, patch })).digest('hex')
  return { root, head, files: allFiles, patch, digest }
}

export async function captureReviewSnapshot(cwd: string): Promise<ReviewSnapshot> {
  if (typeof cwd !== 'string' || !isAbsolute(cwd)) throw new Error('Select a valid project directory.')
  const first = await capture(cwd)
  const second = await capture(cwd)
  if (first.digest !== second.digest) throw new Error('Files changed while preparing the review. Wait for the current edit to finish and refresh.')
  return { ...second, id: randomUUID(), capturedAt: Date.now() }
}
