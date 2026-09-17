const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const ts = require('typescript')

function loadTs(file, cache = new Map(), mocks = {}) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const exports = {}; cache.set(file, exports)
  const source = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true },
  }).outputText
  vm.runInThisContext('(function(require, exports) {' + source + '\n})', { filename: file })(name => {
    if (name in mocks) return mocks[name]
    if (name === './delegation-workers') return { startWorker: () => { throw new Error('Live workers are forbidden in tests') }, describeWorkerPolicy: () => 'test policy', listWorkerAgents: () => [] }
    return name.startsWith('.') ? loadTs(path.resolve(path.dirname(file), name + '.ts'), cache, mocks) : require(name)
  }, exports)
  return exports
}
const { DelegationTaskRegistry } = loadTs('electron/delegation-tasks.ts')
const { assertRootCaller, canStartDelegation, delegatedWorkerArgs, shouldAutoApproveTask } = loadTs('electron/delegation-policy.ts')
const { DelegationSessionLinks } = loadTs('electron/delegation-session-links.ts')
const { DelegationServer } = loadTs('electron/delegation-server.ts')
const { taskBelongsToSession } = loadTs('src/features/delegation/session-task-display.ts')
const tick = () => new Promise(resolve => setImmediate(resolve))

test('analysis and edit auto-approval are independent and never approve retries or snapshots', () => {
  for (const autoApprove of [false, true]) for (const autoApproveEdits of [false, true]) {
    const settings = { autoApprove, autoApproveEdits }
    assert.equal(shouldAutoApproveTask({ mode: 'analyze' }, settings), autoApprove)
    assert.equal(shouldAutoApproveTask({ mode: 'edit' }, settings), autoApproveEdits)
    assert.equal(shouldAutoApproveTask({ mode: 'edit', retryOfId: 'old' }, settings), false)
    assert.equal(shouldAutoApproveTask({ mode: 'analyze', retryOfId: 'old' }, settings), false)
    assert.equal(shouldAutoApproveTask({ reviewSource: {} }, settings), false)
  }
})

test('legacy settings keep edit approval off and persist both switches independently', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-approval-test-'))
  const configPath = path.join(directory, 'delegation-server.json')
  fs.writeFileSync(configPath, JSON.stringify({ port: 38017, token: 'test-token-not-a-live-credential', enabled: false, autoApprove: true }))
  const options = { userDataDirectory: directory, appVersion: 'test', registry: {}, onChanged: () => {} }
  const server = new DelegationServer(options)
  const reopened = new DelegationServer(options)
  t.after(() => { server.dispose(); reopened.dispose(); fs.rmSync(directory, { recursive: true, force: true }) })
  await server.start()
  assert.equal(server.autoApprove, true)
  assert.equal(server.autoApproveEdits, false)
  server.setDefaultModel('codex', 'configured-model')
  server.setDefaultModel('gemini', 'model')
  server.setDefaultModel('opencode', 'provider/model')
  assert.throws(() => server.setDefaultModel('external', 'model'))
  assert.throws(() => server.setDefaultModel('codex', 'bad;arg'))
  server.setAutoApproveEdits(true)
  server.setAutoApprove(false)
  await reopened.start()
  assert.equal(reopened.defaultModel('codex'), 'configured-model')
  assert.equal(reopened.defaultModel('claude'), '')
  assert.equal(reopened.autoApprove, false)
  assert.equal(reopened.autoApproveEdits, true)
  reopened.setAutoApproveEdits(false)
  assert.equal(JSON.parse(fs.readFileSync(configPath, 'utf8')).autoApproveEdits, false)
})

function fixture(t, resolveModel) {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-queue-test-'))
  const workers = []
  const databasePath = path.join(directory, 'tasks.sqlite')
  const registry = new DelegationTaskRegistry(databasePath, () => {}, () => {}, undefined, start => {
    let resolve, reject
    const done = new Promise((yes, no) => { resolve = yes; reject = no })
    const worker = { start, resolve, reject, cancelled: false }
    workers.push(worker)
    return { done, cancel: () => { worker.cancelled = true } }
  }, resolveModel)
  t.after(() => { registry.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  const create = (mode = 'analyze', cwd = directory) => registry.create({ agent: 'codex', prompt: 'Bounded task', cwd, mode, timeoutMs: 1000, caller: 'test' })
  return { registry, workers, create, directory, databasePath }
}

test('single-level policy rejects children and disables built-in delegation in both modes', () => {
  assert.doesNotThrow(() => assertRootCaller(0))
  for (const depth of [1, 2, -1, '0']) assert.throws(() => assertRootCaller(depth), /cannot delegate/)
  for (const mode of ['analyze', 'edit']) {
    assert(delegatedWorkerArgs('codex', mode).includes('features.multi_agent=false'))
    const args = delegatedWorkerArgs('claude', mode)
    assert(args[args.indexOf('--disallowedTools') + 1].includes('Agent,Task'))
  }
})

test('three workers run and excess approved tasks queue, then start after completion', async t => {
  const { registry, workers, create } = fixture(t)
  const tasks = Array.from({ length: 4 }, () => create())
  tasks.forEach(task => registry.approve(task.id))
  assert.equal(workers.length, 3)
  assert.equal(registry.get(tasks[3].id).status, 'queued')
  workers[0].resolve({ text: 'done', detail: 'test' }); await tick()
  assert.equal(workers.length, 4)
  assert.equal(registry.get(tasks[3].id).status, 'running')
  assert(workers[0].start.prompt.includes('never spawn agents'))
})

test('overlapping edits serialize while independent edits and analysis can run', async t => {
  const { registry, workers, create, directory } = fixture(t)
  const first = create('edit'), second = create('edit', path.join(directory, 'child'))
  registry.approve(first.id); registry.approve(second.id)
  assert.equal(workers.length, 1)
  const analysis = create(); registry.approve(analysis.id)
  assert.equal(workers.length, 2)
  assert(canStartDelegation({ mode: 'edit', cwd: directory + '-other' }, [{ mode: 'edit', cwd: directory }]))
  registry.cancel(first.id)
  assert(workers[0].cancelled)
  assert.equal(registry.get(second.id).status, 'queued')
  workers[0].reject(new Error('stopped')); await tick()
  assert.equal(registry.get(first.id).status, 'cancelled')
  assert.equal(registry.get(second.id).status, 'running')
})

test('bounded waits do not finish a task; queued cancellation never starts it', async t => {
  const { registry, workers, create } = fixture(t)
  const tasks = Array.from({ length: 4 }, () => create())
  tasks.forEach(task => registry.approve(task.id))
  assert.equal((await registry.waitForFinish(tasks[0].id, 5)).status, 'running')
  registry.cancel(tasks[3].id)
  assert.equal((await registry.waitForFinish(tasks[3].id)).status, 'cancelled')
  workers[0].resolve({ text: 'done', detail: '' }); await tick()
  assert.equal(workers.length, 3)
})

test('open-task cap, caller depth and account mismatch fail before starting workers', t => {
  const { registry, workers, create, directory } = fixture(t)
  assert.throws(() => registry.create({ callerDepth: 1 }), /cannot delegate/)
  const first = create('edit')
  assert.throws(() => registry.approve(first.id, { agentId: 'claude' }), /does not match/)
  for (let i = 1; i < 10; i++) create('analyze', directory)
  assert.throws(() => create(), /Too many/)
  assert.equal(workers.length, 0)
})

test('session credentials distinguish identical workspaces and expire on release or replacement', () => {
  const links = new DelegationSessionLinks()
  const request = { id: 'pty-a', sessionId: 'a', agentId: 'claude', cwd: 'C:/same', historyKey: '' }
  const header = args => JSON.parse(args[1]).mcpServers.moacli.headers.Authorization
  const a = header(links.prepare(request, 'http://127.0.0.1:1/mcp'))
  const b = header(links.prepare({ ...request, id: 'pty-b', sessionId: 'b' }, 'http://127.0.0.1:1/mcp'))
  assert.notEqual(a, b)
  assert.equal(links.resolve(a).sessionId, 'a')
  assert.equal(links.resolve(b).sessionId, 'b')
  links.update({ sessionId: 'a', historyKey: 'native-a', title: 'Renamed', cwd: 'C:/same' })
  assert.equal(links.resolve(a).historyKey, 'native-a')
  const copy = links.resolve(a); copy.sessionId = 'fake'
  assert.equal(links.resolve(a).sessionId, 'a')
  links.prepare(request, 'http://127.0.0.1:1/mcp')
  assert.equal(links.resolve(a), undefined)
  links.release('pty-b'); assert.equal(links.resolve(b), undefined)
  assert.deepEqual(links.prepare({ ...request, purpose: 'login' }, 'url'), [])
  assert.deepEqual(links.prepare({ ...request, agentId: 'gemini' }, 'url'), [])
  links.clear()
})

test('source metadata survives history linking, retry and database reopening without cwd guessing', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-source-test-'))
  const file = path.join(directory, 'tasks.sqlite')
  let registry = new DelegationTaskRegistry(file, () => {}, () => {})
  t.after(() => { registry.close(); fs.rmSync(directory, { recursive: true, force: true }) })
  const source = { sessionId: 'a', historyKey: '', title: 'Original', cwd: directory }
  const request = { agent: 'claude', prompt: 'test', cwd: directory, timeoutMs: 1000, caller: 'test' }
  const task = registry.create({ ...request, source })
  registry.cancel(task.id)
  const other = registry.create({ ...request, source: { ...source, sessionId: 'b' } })
  registry.cancel(other.id)
  const external = registry.create(request); registry.cancel(external.id)
  const linked = { ...source, historyKey: 'native-a' }
  assert.equal(registry.get(task.id).source.historyKey, '')
  assert.equal(registry.listSessionTasks(linked).length, 1)
  assert.equal(registry.get(task.id).source.historyKey, '', 'List must not mutate source links')
  registry.syncTaskSource(linked)
  const retry = registry.retry(task.id); registry.cancel(retry.id)
  assert.equal(retry.source.historyKey, 'native-a')
  registry.close()
  registry = new DelegationTaskRegistry(file, () => {}, () => {})
  const reopened = registry.listSessionTasks({ ...linked, sessionId: 'new-runtime' })
  assert.deepEqual(new Set(reopened.map(item => item.id)), new Set([task.id, retry.id]))
  assert.equal(registry.listSessionTasks({ ...source, sessionId: 'unrelated' }).length, 0)
  assert(taskBelongsToSession(reopened[0], { id: 'new-runtime', historyKey: 'native-a' }))
  assert(!taskBelongsToSession(reopened[0], { id: 'b', historyKey: 'native-b' }))
  assert(taskBelongsToSession({ reviewSource: source }, { id: 'a' }))
})

test('HTTP MCP assigns authenticated session source and rejects retired credentials', async t => {
  const { registry, directory } = fixture(t)
  const server = new DelegationServer({ userDataDirectory: directory, appVersion: 'test', registry, onChanged: () => {} })
  await server.start()
  t.after(() => server.dispose())
  const request = { id: 'pty-http', sessionId: 'http-a', agentId: 'claude', cwd: directory, historyKey: 'native-http' }
  const args = server.prepareSession(request)
  const authorization = JSON.parse(args[1]).mcpServers.moacli.headers.Authorization
  const call = (auth, method = 'tools/call', params = { name: 'start_task', arguments: { agent: 'claude', prompt: 'bounded test', cwd: directory } }) => fetch(server.url, {
    method: 'POST', headers: { Authorization: auth, 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  const response = await call(authorization)
  assert.equal(response.status, 200)
  const payload = await response.json()
  assert(!payload.result.isError, JSON.stringify(payload))
  const result = JSON.parse(payload.result.content[0].text)
  assert.equal(registry.get(result.task_id).source.sessionId, 'http-a')
  assert.equal(registry.get(result.task_id).source.historyKey, 'native-http')
  const external = await (await call(`Bearer ${server.status().token}`)).json()
  assert.equal(registry.get(JSON.parse(external.result.content[0].text).task_id).source, undefined)
  server.sessionLinks.release(request.id)
  assert.equal((await call(authorization)).status, 401)
})

test('installed Codex parses the session MCP override without contacting a model', t => {
  const binary = path.join(os.homedir(), '.codex', '.sandbox-bin', 'codex.exe')
  if (!fs.existsSync(binary)) { t.skip('No local Codex binary at the optional smoke-test path'); return }
  const links = new DelegationSessionLinks()
  const args = links.prepare({ id: 'smoke', sessionId: 'smoke', agentId: 'codex', cwd: process.cwd() }, 'http://127.0.0.1:1/mcp')
  const output = require('node:child_process').execFileSync(binary, [...args, 'mcp', 'get', 'moacli', '--json'], { encoding: 'utf8', windowsHide: true, timeout: 15000 })
  const config = JSON.parse(output)
  assert.equal(config.transport.url, 'http://127.0.0.1:1/mcp')
  assert(links.resolve(config.transport.http_headers.Authorization))
  links.clear()
})

test('PTY lifecycle injects connection settings and releases them on exit and startup failure', async t => {
  const { directory } = fixture(t)
  const { PtyHostClient } = loadTs('electron/pty-host-client.ts', new Map(), {
    electron: {},
    './agent-profiles': {
      getProfile: () => ({ bin: 'test-cli', args_new: [], args_resume: ['--resume', '{id}'], env: {} }),
      detectBinary: () => 'test-cli',
      executableCommand: (file, args) => ({ file, args }),
    },
  })
  const links = new DelegationSessionLinks()
  const attention = { prepare: async () => ({ args: [], env: {} }), release: () => {} }
  const host = new PtyHostClient('unused', () => null, attention, undefined, {
    prepare: request => links.prepare(request, 'http://127.0.0.1:1/mcp'), release: id => links.release(id),
  })
  const request = { id: 'pty-lifecycle', sessionId: 'session-lifecycle', agentId: 'claude', cwd: directory, cols: 80, rows: 24 }
  let authorization
  host.spawnInHost = async spec => { authorization = JSON.parse(spec.args[spec.args.indexOf('--mcp-config') + 1]).mcpServers.moacli.headers.Authorization }
  await host.start(request)
  assert.equal(links.resolve(authorization).sessionId, request.sessionId)
  host.handleHostMessage({ type: 'exit', id: request.id, exitCode: 0, intentional: true })
  assert.equal(links.resolve(authorization), undefined)
  host.spawnInHost = async spec => {
    authorization = JSON.parse(spec.args[spec.args.indexOf('--mcp-config') + 1]).mcpServers.moacli.headers.Authorization
    throw new Error('Fake spawn failure')
  }
  await assert.rejects(host.start(request), /Fake spawn failure/)
  assert.equal(links.resolve(authorization), undefined)
  await host.shutdown()
})

test('session list carries bounded summaries while result retrieval preserves full text', async t => {
  const { registry, workers, directory } = fixture(t)
  const source = { sessionId: 'large', historyKey: '', title: 'Large result', cwd: directory }
  const task = registry.create({ source, agent: 'codex', prompt: 'p'.repeat(50000), cwd: directory, timeoutMs: 1000, caller: 'test' })
  registry.approve(task.id)
  const full = 'result '.repeat(100000)
  workers[0].resolve({ text: full, detail: '' }); await tick()
  const list = registry.listSessionTasks(source)
  assert.equal(list[0].promptLength, 50000)
  assert(list[0].promptPreview.length < 4100)
  assert(list[0].resultPreview.length < 610)
  assert.equal(list[0].result, undefined)
  assert(JSON.stringify(list).length < 6000)
  assert.equal(registry.result(task.id).text, full)
})

 test('approved model is fixed for queued workers, persisted, and defaults are independent of task requests', async t => {
  let defaultModel='default-one'
  const { registry,workers,create,databasePath }=fixture(t,(_agent,_account,model)=>model??defaultModel)
  const tasks=Array.from({length:4},()=>create())
  tasks.forEach(task=>registry.approve(task.id))
  const manual=create();registry.approve(manual.id,undefined,'manual-model')
  defaultModel='default-two'
  workers[0].resolve({text:'done',detail:''});await tick()
  assert.equal(workers[3].start.model,'default-one')
  workers[1].resolve({text:'done',detail:''});await tick()
  assert.equal(workers[4].start.model,'manual-model')
  assert.equal(registry.get(manual.id).model,'manual-model')
  const Database=require('better-sqlite3');const db=new Database(databasePath)
  assert.equal(db.prepare('SELECT model FROM delegation_tasks WHERE id=?').get(manual.id).model,'manual-model');db.close()
  const bad=create();assert.throws(()=>registry.approve(bad.id,undefined,'bad;arg'))
  assert.equal(registry.get(bad.id).status,'awaiting_approval')
 })

test('Gemini and OpenCode retain their agent and requested model after database reopening', async t => {
 const {registry,workers,directory,databasePath}=fixture(t)
 const tasks=['gemini','opencode'].map(agent=>registry.create({agent,prompt:'file task',cwd:directory,mode:'analyze',timeoutMs:1000,caller:'test'}))
 tasks.forEach(task=>registry.approve(task.id,undefined,task.agent==='gemini'?'gemini-2.5-pro':'provider/model'))
 assert.deepEqual(workers.map(worker=>worker.start.agent),['gemini','opencode'])
 workers.forEach(worker=>worker.resolve({text:'done',detail:'file tools'}));await tick()
 registry.close(); registry.close=()=>{}
 const reopened=new DelegationTaskRegistry(databasePath,()=>{},()=>{})
 try {
  for(const task of tasks){assert.equal(reopened.get(task.id).agent,task.agent);assert.equal(reopened.get(task.id).status,'completed')}
 }finally{reopened.close()}
})
