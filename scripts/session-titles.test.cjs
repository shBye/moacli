const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const http = require('node:http')
const ts = require('typescript')

function loadTs(file, mocks = {}, cache = new Map()) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const exports = {}
  cache.set(file, exports)
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
const { parseCustomTitles, collectCustomTitles, resolveHistoryTitle, syncSessionTitles } = loadTs('src/features/sessions/session-title.ts')
const { parseCodexSessionTitles } = loadTs('electron/codex-session-titles.ts')
const { CodexSessionTitleReader } = loadTs('electron/read-codex-session-titles.ts')

for (const agentId of ['claude', 'codex', 'gemini']) {
  test(agentId + ': custom title survives linking, CLI rename and reopening', () => {
    const session = { id: 'runtime', agentId, title: 'My title', customTitle: 'My title', historyKey: '' }
    const empty = Object.freeze({})
    assert.equal(collectCustomTitles(empty, [session]), empty)
    const linked = { ...session, historyKey: agentId + ':account:session' }
    const saved = collectCustomTitles(empty, [linked])
    const reloaded = parseCustomTitles(JSON.stringify(saved))
    const history = { key: linked.historyKey, title: 'CLI renamed it' }
    assert.equal(resolveHistoryTitle(history, reloaded), 'My title')
    assert.equal(syncSessionTitles([linked], [history], reloaded)[0].title, 'My title')
    assert.equal(resolveHistoryTitle({ ...history, key: agentId + ':other-account:session' }, reloaded), 'CLI renamed it')
    assert.equal(collectCustomTitles(saved, [linked]), saved)
  })
  test(agentId + ': automatic title follows delayed history and subsequent updates without replacing terminal identity', () => {
    const pending = { id: 'runtime', agentId, title: 'Temporary', historyKey: '', terminalRevision: 0, resumeId: '' }
    const sessions = [pending]
    assert.equal(syncSessionTitles(sessions, [], {}), sessions)
    const linked = { ...pending, historyKey: 'history', resumeId: 'cli-session' }
    const next = syncSessionTitles([linked], [{ key: 'history', title: 'Generated title' }], {})
    assert.equal(next[0].title, 'Generated title')
    assert.equal(next[0].id, linked.id)
    assert.equal(next[0].terminalRevision, 0)
    assert.equal(next[0].resumeId, linked.resumeId)
    assert.equal(linked.title, 'Temporary')
    assert.equal(syncSessionTitles(next, [{ key: 'history', title: 'Later title' }], {})[0].title, 'Later title')
    assert.equal(syncSessionTitles(next, [], {}), next)
  })
}

test('invalid stored preferences do not break history or restore invalid titles', () => {
  for (const raw of [null, 'broken', '[]', 'null', '2']) assert.deepEqual(parseCustomTitles(raw), {})
  assert.deepEqual(parseCustomTitles(JSON.stringify({ a: 'Valid', b: '', c: 1, d: 'x'.repeat(41) })), { a: 'Valid' })
})
test('Codex index uses latest complete name and tolerates interrupted appends', () => {
  const text = [JSON.stringify({ id: 'one', thread_name: 'Initial' }), 'broken', JSON.stringify({ id: 'one', thread_name: 'Renamed' }), JSON.stringify({ id: 'two', thread_name: 4 }), '{'].join('\n')
  assert.deepEqual([...parseCodexSessionTitles(text)], [['one', 'Renamed']])
})
test('Codex index cache observes title-only changes and missing index fallback', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-title-test-'))
  try {
    const reader = new CodexSessionTitleReader()
    assert.equal(reader.read(dir).size, 0)
    const file = path.join(dir, 'session_index.jsonl')
    fs.writeFileSync(file, JSON.stringify({ id: 'one', thread_name: 'Initial' }) + '\n')
    const first = reader.read(dir)
    assert.equal(reader.read(dir), first)
    fs.appendFileSync(file, JSON.stringify({ id: 'one', thread_name: 'Updated title' }) + '\n')
    assert.equal(reader.read(dir).get('one'), 'Updated title')
  } finally { fs.rmSync(dir, { recursive: true, force: true }) }
})

const { claudeSessionTitle } = loadTs('electron/claude-session-title.ts')
test('Claude follows latest generated title while preserving explicit CLI name priority', () => {
  const records = [{ type: 'ai-title', aiTitle: 'First' }, { type: 'ai-title', aiTitle: 'Plan title' }]
  assert.equal(claudeSessionTitle(records), 'Plan title')
  assert.equal(claudeSessionTitle([{ type: 'custom-title', customTitle: 'User name' }, ...records]), 'User name')
  assert.equal(claudeSessionTitle([]), '')
})

const { initialSessionTitle, resumedSessionTitle } = loadTs('src/features/sessions/session-title.ts')
test('switching back to automatic ignores a previously typed custom draft', () => {
  assert.deepEqual(initialSessionTitle('auto', 'Draft', 'Temporary'), { title: 'Temporary', customTitle: undefined })
  assert.deepEqual(initialSessionTitle('custom', '  Work  ', 'Temporary'), { title: 'Work', customTitle: 'Work' })
  assert.deepEqual(resumedSessionTitle({ key: 'one', title: 'CLI title' }, { one: 'My name' }), { title: 'My name', customTitle: 'My name' })
  assert.deepEqual(resumedSessionTitle({ key: 'two', title: 'CLI title' }, {}), { title: 'CLI title', customTitle: undefined })
})
