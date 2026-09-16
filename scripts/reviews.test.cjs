const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { execFileSync } = require('node:child_process')
const ts = require('typescript')

function loadTs(file, mocks = {}, cache = new Map()) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const exports = {}; cache.set(file, exports)
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInThisContext('(function(require, exports) {' + source + '\n})', { filename: file })(name => {
    if (name in mocks) return mocks[name]
    if (name.startsWith('.')) return loadTs(path.resolve(path.dirname(file), name + '.ts'), mocks, cache)
    return require(name)
  }, exports)
  return exports
}

function fixture(t) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-review-test-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const git = (...args) => execFileSync('git', ['-c', 'user.name=Review Test', '-c', 'user.email=review@example.test', ...args], { cwd: directory, encoding: 'utf8', windowsHide: true })
  git('init', '--quiet')
  fs.writeFileSync(path.join(directory, 'original.txt'), 'before\n')
  git('add', '.'); git('commit', '--quiet', '-m', 'fixture')
  return { directory, git }
}

const { captureReviewSnapshot } = loadTs('electron/review-snapshot.ts')
const { buildReviewPrompt } = loadTs('electron/review-prompt.ts')
const { parseReviewReport, buildRevisionDraft } = loadTs('src/features/reviews/review-display.ts')
const { reviewWorkerArgs } = loadTs('electron/review-worker-policy.ts')
const { delegatedWorkerArgs } = loadTs('electron/delegation-policy.ts')

test('captures staged, unstaged, and Unicode untracked changes without changing the index', async t => {
  const { directory, git } = fixture(t)
  fs.writeFileSync(path.join(directory, 'original.txt'), 'staged\n'); git('add', '.')
  fs.writeFileSync(path.join(directory, 'original.txt'), 'latest\n')
  fs.writeFileSync(path.join(directory, '새 파일.txt'), 'new content\n')
  const indexBefore = git('diff', '--cached')
  const snapshot = await captureReviewSnapshot(directory)
  assert.deepEqual(snapshot.files, ['original.txt', '새 파일.txt'])
  assert(snapshot.patch.includes('+latest'))
  assert(snapshot.patch.includes('new content'))
  assert.equal(git('diff', '--cached'), indexBefore)
  const again = await captureReviewSnapshot(directory)
  assert.equal(again.digest, snapshot.digest)
  fs.writeFileSync(path.join(directory, 'original.txt'), 'later\n')
  assert.notEqual((await captureReviewSnapshot(directory)).digest, snapshot.digest)
  assert(snapshot.patch.includes('+latest'))
})

test('clean and binary worktrees fail explicitly instead of producing incomplete reviews', async t => {
  const { directory } = fixture(t)
  await assert.rejects(captureReviewSnapshot(directory), /No uncommitted changes/)
  fs.writeFileSync(path.join(directory, 'binary.dat'), Buffer.from([0, 1, 2]))
  await assert.rejects(captureReviewSnapshot(directory), /Binary files/)
})

test('non-Git folders explain the preview requirement without creating a repository', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-not-git-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  await assert.rejects(captureReviewSnapshot(directory), error => {
    assert(error.message.includes('Git changes cannot be previewed'))
    assert(error.message.includes(directory))
    assert(!error.message.includes('Command failed:'))
    return true
  })
  assert.equal(fs.existsSync(path.join(directory, '.git')), false)
})

test('malformed results remain raw; an empty valid findings list is not a parser failure', () => {
  assert.equal(parseReviewReport('{bad'), null)
  assert.equal(parseReviewReport('{"summary":"ok","findings":[{"title":"oops"}]}'), null)
  assert.deepEqual(parseReviewReport('```json\n{"summary":"No defects found","findings":[]}\n```'), { summary: 'No defects found', findings: [] })
})

test('revision drafts include only selected findings and retain their snapshot provenance', () => {
  const entry = { task: { id: 'review-1' }, review: { source: { title: 'Login fix' }, snapshot: { digest: '1234567890abcdef', head: 'abc' } }, result: JSON.stringify({ summary: 'Review', findings: [{ title: 'Selected', location: 'a.ts:2', body: 'Fix this' }, { title: 'Not selected', location: 'b.ts:3', body: 'Other' }] }) }
  assert.equal(buildRevisionDraft(entry, new Set()), '')
  const draft = buildRevisionDraft(entry, new Set([0]))
  assert(draft.includes('Selected')); assert(!draft.includes('Not selected'))
  assert(draft.includes('review-1')); assert(draft.includes('1234567890ab'))
})

test('review policies disable execution paths and preserve ordinary worker policy separation', () => {
  const claude = reviewWorkerArgs('claude')
  assert.equal(claude[claude.indexOf('--tools') + 1], '')
  assert(claude.includes('{"disableAllHooks":true}'))
  const codex = [...delegatedWorkerArgs('codex', 'analyze'), ...reviewWorkerArgs('codex')]
  assert.equal(codex[codex.indexOf('--sandbox') + 1], 'read-only')
  assert(codex.includes('--ignore-user-config')); assert(codex.includes('--ignore-rules'))
  assert(codex.includes('features.shell_tool=false'))
})

test('review start rejects changed or expired previews before creating a worker', async () => {
  const snapshot = { id: '00000000-0000-4000-8000-000000000000', root: 'C:/repo', digest: 'original', capturedAt: Date.now(), files: ['a.ts'], head: 'abc', patch: 'diff' }
  let current = snapshot
  const { ReviewService } = loadTs('electron/review-service.ts', { './review-snapshot': { captureReviewSnapshot: async () => current } })
  const service = new ReviewService()
  const preview = await service.prepare('C:/repo')
  let created = false
  const registry = { create: () => { created = true } }
  const request = { snapshotId: preview.id, source: { sessionId: 'session', historyKey: '', title: 'Task', cwd: 'C:/repo' }, agent: 'codex', instructions: '' }
  current = { ...snapshot, digest: 'changed' }
  await assert.rejects(service.start(request, registry), /project changed/)
  assert.equal(created, false)
  await assert.rejects(service.start({ ...request, snapshotId: '00000000-0000-4000-8000-000000000001' }, registry), /expired/)
})

test('review prompt bounds the reviewer to the captured material', () => {
  const prompt = buildReviewPrompt({ source: { title: 'Task' }, instructions: 'Check cancellation', snapshot: { digest: 'digest', head: 'head', files: ['a'], patch: 'snapshot data' } })
  assert(prompt.includes('Check cancellation')); assert(prompt.includes('untrusted source material'))
  assert(prompt.includes('Do not edit files')); assert(prompt.includes('snapshot data'))
})
