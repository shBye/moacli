const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
const { spawn } = require('node:child_process')
const http = require('node:http')
const ts = require('typescript')
function load(file, mocks = {}, cache = new Map()) {
  file = path.resolve(file)
  if (cache.has(file)) return cache.get(file)
  const exports = {}; cache.set(file, exports)
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, esModuleInterop: true } }).outputText
  vm.runInThisContext('(function(require,exports){' + code + '\n})', { filename: file })(name => {
    if (name in mocks) return mocks[name]
    if (name.endsWith('?raw')) return fs.readFileSync(path.resolve(path.dirname(file), name.slice(0, -4)), 'utf8')
    return name.startsWith('.') ? load(path.resolve(path.dirname(file), name + '.ts'), mocks, cache) : require(name)
  }, exports)
  return exports
}
const { mergeCodexObserverHooks, CODEX_OBSERVER_EVENTS } = load('electron/codex-hook-policy.ts')
const { normalizeCodexHook } = load('electron/attention-events.ts')
test('hook merge preserves existing groups and metadata, is immutable and idempotent', () => {
  const original = { description: 'user', hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-script' }] }], FutureEvent: [{ hooks: [] }] } }
  const before = JSON.stringify(original)
  const merged = mergeCodexObserverHooks(original, 'observer')
  assert.equal(JSON.stringify(original), before)
  assert.equal(merged.hooks.Stop[0].hooks[0].command, 'user-script')
  assert.equal(merged.hooks.Stop.length, 2)
  assert.deepEqual(mergeCodexObserverHooks(merged, 'observer'), merged)
  for (const name of CODEX_OBSERVER_EVENTS) assert(merged.hooks[name].length)
  for (const bad of [null, [], { hooks: [] }, { hooks: { Stop: false } }]) assert.throws(() => mergeCodexObserverHooks(bad, 'observer'))
})
test('normalization distinguishes lifecycle and rejects children, unknown events, and private content', () => {
  const payload = { session_id: 's', turn_id: 't', source: 'startup', prompt: 'PRIVATE', tool_input: { command: 'PRIVATE' }, last_assistant_message: 'PRIVATE' }
  for (const [name, kind] of [['SessionStart','ready'], ['UserPromptSubmit','processing'], ['PermissionRequest','approval_required'], ['PostToolUse','processing'], ['Stop','response_completed'], ['Interrupt','response_interrupted']]) {
    const event = normalizeCodexHook({ ...payload, hook_event_name: name })
    assert.equal(event.kind, kind)
    assert(!JSON.stringify(event).includes('PRIVATE'))
  }
  for (const extra of [{ agent_id: 'child' }, { hook_event_name: 'SubagentStop' }, { turn_id: undefined }, { session_id: undefined }]) {
    assert.equal(normalizeCodexHook({ ...payload, hook_event_name: 'Stop', ...extra }), null)
  }
  assert.equal(normalizeCodexHook({ ...payload, hook_event_name: 'SessionStart', source: 'compact' }), null)
})
test('real HTTP delivery, continuation, stale turns, OSC fallback and release', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-hook-http-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { AttentionBridge } = load('electron/attention-bridge.ts', { './agent-profiles': { getVersion: async () => '0.154.0', isVersionAtLeast: () => true } })
  const events = []
  const bridge = new AttentionBridge(signal => events.push(signal.event), () => {})
  await bridge.start(directory)
  t.after(() => bridge.dispose())
  const options = await bridge.prepare({ id: 'pty', purpose: 'session', agentId: 'codex' }, { attention_adapter: 'codex-osc9', attention_min_version: '0.148.0' }, 'unused')
  const endpoint = options.env.MOACLI_CODEX_HOOK_ENDPOINT
  assert.equal(events[0].kind, 'ready')
  assert.equal(events[0].name, 'HookSetupRequired')
  const send = async (name, turn = 'turn1', extra = {}) => {
    const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify({ session_id: 'session', turn_id: turn, hook_event_name: name, ...extra }) })
    assert.deepEqual(await response.json(), {})
  }
  await send('SessionStart', 'turn1', { source: 'startup' }); await send('UserPromptSubmit'); await send('PermissionRequest')
  assert.equal(events.at(-1).kind, 'approval_required')
  bridge.signalOsc9('pty', 'untrusted free text')
  assert.equal(events.at(-1).kind, 'approval_required')
  await send('Stop'); await send('Stop')
  const count = events.length
  assert.equal(events.at(-1).kind, 'response_completed')
  bridge.signalOsc9('pty', 'complete')
  assert.equal(events.length, count)
  await send('PostToolUse'); await send('Stop') // Another Stop hook continued the same turn.
  assert.equal(events.length, count + 2)
  await send('UserPromptSubmit', 'turn2')
  bridge.signalOsc9('pty', 'fallback')
  assert.equal(events.at(-1).kind, 'attention')
  await send('Stop', 'turn1'); await send('Stop', 'child-turn'); await send('Stop', 'turn2', { session_id: 'wrong-session' })
  assert.equal(events.at(-1).kind, 'attention')
  await send('Interrupt', 'turn2')
  assert.equal(events.at(-1).kind, 'response_interrupted')
  assert(bridge.diagnostics.snapshot().events.some(event => event.stage === 'stale'))
  bridge.release('pty')
  assert.equal((await fetch(endpoint, { method: 'POST', body: '{}' })).status, 404)
})
function run(file, args, env, input) {
  return new Promise((resolve, reject) => {
    const child = spawn(file, args, { env: { ...process.env, ...env }, windowsHide: true, windowsVerbatimArguments: file === 'cmd.exe', stdio: ['pipe', 'pipe', 'pipe'] })
    let stdout = '', stderr = ''
    const timer = setTimeout(() => { child.kill(); reject(Error('Relay timed out')) }, 6000)
    child.stdout.on('data', data => stdout += data)
    child.stderr.on('data', data => stderr += data)
    child.on('error', error => { clearTimeout(timer); reject(error) })
    child.on('exit', code => { clearTimeout(timer); resolve({ code, stdout, stderr }) })
    child.stdin.on('error', () => {})
    child.stdin.end(input)
  })
}
test('installer preserves user hooks and real wrapper relays only whitelisted fields', async t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli observer space '))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const accountDir = path.join(dir, 'account')
  fs.mkdirSync(accountDir)
  const hooksPath = path.join(accountDir, 'hooks.json')
  fs.writeFileSync(hooksPath, JSON.stringify({ hooks: { Stop: [{ hooks: [{ type: 'command', command: 'user-original' }] }] } }))
  const { installCodexHooks } = load('electron/install-codex-hooks.ts')
  const request = { account: { configDir: accountDir, detected: false } }
  const observer = path.join(dir, 'observer')
  installCodexHooks(request, observer)
  const installed = fs.readFileSync(hooksPath, 'utf8')
  installCodexHooks(request, observer)
  assert.equal(fs.readFileSync(hooksPath, 'utf8'), installed)
  assert(installed.includes('user-original'))
  assert.equal(fs.readdirSync(accountDir).filter(name => name.includes('backup')).length, 1)
  const received = []
  const server = http.createServer((req, res) => {
    let body = ''; req.on('data', chunk => body += chunk)
    req.on('end', () => { received.push(JSON.parse(body)); res.end('{}') })
  })
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve))
  t.after(() => new Promise(resolve => server.close(resolve)))
  const env = { MOACLI_CODEX_HOOK_ENDPOINT: `http://127.0.0.1:${server.address().port}/attention/11111111-1111-4111-8111-111111111111/22222222-2222-4222-8222-222222222222`, MOACLI_HOOK_EXECUTABLE: process.execPath }
  const command = JSON.parse(installed).hooks.Stop[1].hooks[0].command
  const shells = process.platform === 'win32' ? [['cmd.exe', ['/d', '/s', '/c', command]], ['powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', command]]] : [['sh', ['-c', command]]]
  for (const [file, args] of shells) {
    const result = await run(file, args, env, JSON.stringify({ session_id: 's', turn_id: 't', hook_event_name: 'Stop', last_assistant_message: 'PRIVATE' }))
    assert.equal(result.code, 0, result.stderr)
    assert.equal(result.stdout.trim(), '{}', result.stderr)
  }
  assert.equal(received.length, shells.length)
  if (process.platform === 'win32') {
    const electronResult = await run('cmd.exe', ['/d', '/s', '/c', command], { ...env, MOACLI_HOOK_EXECUTABLE: require('electron') }, JSON.stringify({ session_id: 's', turn_id: 't', hook_event_name: 'Stop' }))
    assert.equal(electronResult.code, 0, electronResult.stderr)
    assert.equal(electronResult.stdout.trim(), '{}', electronResult.stderr)
    assert.equal(received.length, shells.length + 1)
  }
  assert(!JSON.stringify(received).includes('PRIVATE'))
  const malformed = await run(process.execPath, [path.join(observer, 'relay.cjs')], env, '{bad')
  assert.equal(malformed.stdout, '{}')
  assert.equal(malformed.code, 0)
  fs.writeFileSync(hooksPath, '{invalid')
  assert.throws(() => installCodexHooks(request, observer))
  assert.equal(fs.readFileSync(hooksPath, 'utf8'), '{invalid')
})
test('attention diagnostic snapshot is bounded and detached', () => {
  const { AttentionDiagnostics } = load('electron/attention-diagnostics.ts')
  const log = new AttentionDiagnostics(() => 1)
  for (let i = 0; i < 510; i++) log.record('pty', 'delivered', 'Stop')
  const snapshot = log.snapshot()
  assert.equal(snapshot.events.length, 500); assert.equal(snapshot.dropped, 10)
  snapshot.events[0].name = 'changed'
  assert.equal(log.snapshot().events[0].name, 'Stop')
})

test('Codex approval/completion notifications and suppression reasons follow structured events', t => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-codex-notification-'))
  t.after(() => fs.rmSync(dir, { recursive: true, force: true }))
  const { NotificationCenter } = load('electron/notification-center.ts', { electron: { Notification: { isSupported: () => false } } })
  const traces = []
  const window = { isDestroyed: () => false, isFocused: () => true, webContents: { send() {} } }
  const center = new NotificationCenter(path.join(dir, 'settings.json'), () => window, (_terminal, stage) => traces.push(stage))
  t.after(() => center.dispose())
  const request = { id: 'pty', sessionId: 'session', agentId: 'codex', purpose: 'session' }
  const send = (name, generation) => center.handleAgentEvent(request, normalizeCodexHook({ session_id: 'session', turn_id: 'turn', hook_event_name: name }), generation)
  send('PermissionRequest', 1)
  assert.equal(traces.at(-1), 'notification-disabled')
  center.updateSettings({ enabled: true })
  center.updateContext({ activeSessionId: 'another', activeView: 'cli' })
  send('PermissionRequest', 2)
  assert.equal(center.snapshot().notifications[0].type, 'approval_required')
  assert.equal(traces.at(-1), 'notification-shown')
  send('Stop', 3)
  assert.equal(center.snapshot().notifications[0].type, 'completed')
  send('Interrupt', 4)
  assert.equal(center.snapshot().notifications.length, 0)
  assert.equal(traces.at(-1), 'notification-state-only')
  center.updateContext({ activeSessionId: 'session', activeView: 'cli' })
  send('PermissionRequest', 5)
  assert.equal(traces.at(-1), 'notification-viewing')
  center.setSessionMuted('session', true)
  send('Stop', 6)
  assert.equal(traces.at(-1), 'notification-muted')
})
