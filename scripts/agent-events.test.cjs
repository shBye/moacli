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
const { normalizeClaudeHook, normalizeCodexOsc9, claudeAttentionHooks } = loadTs('electron/attention-events.ts')
const { agentEventInteractionState, agentEventLabel } = loadTs('src/features/sessions/agent-event.ts')
const { parseNotificationSettings, notificationTypeEnabled } = loadTs('src/features/notifications/notification-policy.ts')
const { delegatedNotificationContent, sessionNotificationContent, desktopNotificationBody } = loadTs('electron/notification-content.ts')

test('rich delegation notifications expose bounded known details and keep desktop previews opt-in', () => {
  const task = { agent: 'claude', role: 'reviewer', mode: 'analyze', cwd: 'C:\\projects\\demo', startedAt: 1000, finishedAt: 43000, resultPreview: 'PRIVATE '.repeat(100) }
  const content = delegatedNotificationContent(task, 'completed')
  assert(content.context.includes('42s')); assert(content.context.includes('demo'))
  assert(content.context.includes('Code review')); assert(content.context.includes('Analysis'))
  assert(content.preview.length <= 201)
  assert(!desktopNotificationBody(content, false).includes('PRIVATE'))
  assert(desktopNotificationBody(content, true).includes('PRIVATE'))
  assert.equal(parseNotificationSettings({ enabled: true }).desktopPreviewEnabled, false)
  assert.equal(parseNotificationSettings({ desktopPreviewEnabled: 'true' }).desktopPreviewEnabled, false)
  const failed = delegatedNotificationContent({ ...task, error: 'PRIVATE error' }, 'failed')
  assert(!desktopNotificationBody(failed, false).includes('PRIVATE'))
  assert(desktopNotificationBody(failed, true).includes('PRIVATE error'))
})

test('session details include tool and exit code without inventing Codex completion or result text', () => {
  const request = { agentId: 'claude', cwd: '/projects/demo' }
  const permission = sessionNotificationContent(request, 'approval_required', { kind: 'approval_required', toolName: 'Bash' })
  assert(permission.body.includes('Bash')); assert(permission.actionHint.includes('permission'))
  const codex = sessionNotificationContent({ ...request, agentId: 'codex' }, 'needs_attention', normalizeCodexOsc9())
  assert.equal(codex.body, 'Session needs attention'); assert.equal(codex.preview, undefined)
  assert(sessionNotificationContent(request, 'failed', undefined, 2).body.includes('Exit code 2'))
})

test('notification snapshots preserve detail and native delivery obeys the preview preference', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-notification-detail-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const shown = []
  class NativeNotification {
    static isSupported() { return true }
    constructor(options) { this.options = options }
    once() {} close() {} show() { shown.push(this.options) }
  }
  const { NotificationCenter } = loadTs('electron/notification-center.ts', { electron: { Notification: NativeNotification } })
  const center = new NotificationCenter(path.join(directory, 'settings.json'), () => null)
  t.after(() => center.dispose())
  center.updateSettings({ enabled: true })
  const task = { id: 'task', agent: 'codex', caller: 'test', mode: 'edit', cwd: 'C:/demo', source: { title: 'Source session' }, resultPreview: 'PRIVATE result' }
  center.handleDelegation(task, 'completed')
  const notification = center.snapshot().notifications[0]
  assert.equal(notification.title, 'Source session')
  assert.equal(notification.preview, 'PRIVATE result')
  assert(notification.context.includes('File editing'))
  center.flushDesktopDelivery()
  assert(!shown[0].body.includes('PRIVATE'))
  center.updateSettings({ desktopPreviewEnabled: true })
  center.handleDelegation({ ...task, id: 'second' }, 'completed')
  center.flushDesktopDelivery()
  assert(shown[1].body.includes('PRIVATE result'))
  assert.equal(parseNotificationSettings(JSON.parse(fs.readFileSync(path.join(directory, 'settings.json'), 'utf8'))).desktopPreviewEnabled, true)
})

for (const [name, fields, kind] of [
  ['PermissionRequest', { tool_name: 'Bash' }, 'approval_required'],
  ['PermissionRequest', { tool_name: 'ExitPlanMode' }, 'approval_required'],
  ['PermissionRequest', { tool_name: 'AskUserQuestion' }, 'input_required'],
  ['Elicitation', {}, 'input_required'],
  ['UserPromptSubmit', {}, 'processing'],
  ['Stop', { stop_hook_active: true, background_tasks: [{}] }, 'response_completed'],
  ['StopFailure', { error: 'rate_limit' }, 'response_failed'],
]) test('Claude ' + name + ' ' + (fields.tool_name ?? ''), () => {
  const event = normalizeClaudeHook({ hook_event_name: name, prompt_id: 'turn-1', ...fields })
  assert.equal(event.kind, kind)
  assert.equal(event.promptId, 'turn-1')
  if (name === 'Stop') assert.equal(agentEventLabel(event), 'Response finished')
})

test('unknown and child hooks cannot end the main response', () => {
  for (const input of [null, [], {}, { hook_event_name: 'SubagentStop' }, { hook_event_name: 'Stop', agent_id: 'child' }]) {
    assert.equal(normalizeClaudeHook(input), null)
  }
})
test('free-form content is not copied into normalized events', () => {
  const event = normalizeClaudeHook({ hook_event_name: 'StopFailure', error: 'private-secret', error_details: 'private-secret', last_assistant_message: 'private-secret' })
  assert.equal(event.errorCode, 'unknown')
  assert(!JSON.stringify(event).includes('private-secret'))
})
test('Codex OSC9 is attention, never fabricated completion or approval', () => {
  const event = normalizeCodexOsc9('Approval required / complete')
  assert.equal(event.kind, 'attention')
  assert.equal(agentEventInteractionState(event), 'needs_attention')
})

test('fragmented Codex OSC9 reaches attention for another tab while the app is focused', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-codex-attention-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { scanOsc9 } = loadTs('electron/osc9-scanner.ts')
  const { AttentionBridge } = loadTs('electron/attention-bridge.ts', {
    './agent-profiles': { getVersion: async () => '0.154.0', isVersionAtLeast: () => true },
  })
  const { NotificationCenter } = loadTs('electron/notification-center.ts', {
    electron: { Notification: { isSupported: () => false } },
  })
  const window = { isDestroyed: () => false, isFocused: () => true, webContents: { send() {} } }
  const center = new NotificationCenter(path.join(directory, 'settings.json'), () => window)
  t.after(() => center.dispose())
  center.updateSettings({ enabled: true, needsAttention: true })
  center.updateContext({ activeSessionId: 'other-session', activeView: 'cli' })
  const states = []
  const bridge = new AttentionBridge(({ request, event, generation }) => {
    states.push(agentEventInteractionState(event))
    center.handleAgentEvent(request, event, generation)
  })
  t.after(() => bridge.dispose())
  const request = { id: 'codex-pty', sessionId: 'codex-session', agentId: 'codex', purpose: 'session' }
  const options = await bridge.prepare(request, {
    attention_adapter: 'codex-osc9', attention_min_version: '0.148.0',
  }, 'unused')
  assert(options.args.includes('tui.notification_condition="always"'))
  let carry = ''
  for (const data of ['output\x1b]', '9;PRIVATE approval command\x1b', '\\tail']) {
    const result = scanOsc9(data, carry)
    carry = result.carry
    for (const message of result.messages) bridge.signalOsc9(request.id, message)
  }
  assert.deepEqual(states, ['needs_attention'])
  const notifications = center.snapshot().notifications
  assert.equal(notifications.length, 1)
  assert.equal(notifications[0].sessionId, request.sessionId)
  assert.equal(notifications[0].type, 'needs_attention')
  assert(!JSON.stringify(notifications).includes('PRIVATE'))
  bridge.release(request.id)
  bridge.signalOsc9(request.id, 'late')
  assert.equal(states.length, 1)
})
test('legacy notification preferences migrate without re-enabling attention', () => {
  const settings = parseNotificationSettings({ enabled: true, needsAttention: false })
  assert.equal(notificationTypeEnabled(settings, 'approval_required'), false)
  assert.equal(notificationTypeEnabled(settings, 'input_required'), false)
  const changed = parseNotificationSettings({ ...settings, approvals: true })
  assert.equal(notificationTypeEnabled(changed, 'approval_required'), true)
  assert.equal(notificationTypeEnabled(changed, 'input_required'), false)
})

test('outcomes supersede approval alerts, including muted outcomes', t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-events-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { NotificationCenter } = loadTs('electron/notification-center.ts', { electron: { Notification: { isSupported: () => false } } })
  const center = new NotificationCenter(path.join(directory, 'settings.json'), () => null)
  t.after(() => center.dispose())
  center.updateSettings({ enabled: true })
  const request = { id: 'pty', sessionId: 'session', agentId: 'claude', purpose: 'session' }
  const event = kind => ({ kind, source: 'claude-http', name: 'test' })
  center.handleAgentEvent(request, event('approval_required'), 1)
  assert.equal(center.snapshot().notifications[0].type, 'approval_required')
  center.handleAgentEvent(request, event('response_completed'), 2)
  assert.equal(center.snapshot().notifications[0].type, 'completed')
  center.handleAgentEvent(request, event('processing'), 3)
  assert.equal(center.snapshot().notifications.length, 0)
  center.handleAgentEvent(request, event('approval_required'), 4)
  center.updateSettings({ completed: false })
  center.handleAgentEvent(request, event('response_completed'), 5)
  assert.equal(center.snapshot().notifications.length, 0)
})

test('HTTP hook delivery is neutral, deduplicated, and ignores retired prompts and released sessions', async t => {
  const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-hooks-'))
  t.after(() => fs.rmSync(directory, { recursive: true, force: true }))
  const { AttentionBridge } = loadTs('electron/attention-bridge.ts', {
    './agent-profiles': { getVersion: async () => '2.1.263', isVersionAtLeast: () => true },
  })
  const events = []
  const bridge = new AttentionBridge(event => events.push(event))
  await bridge.start(directory)
  t.after(() => bridge.dispose())
  const options = await bridge.prepare({ id: 'pty', agentId: 'claude' }, {
    attention_adapter: 'claude-http', attention_min_version: '2.1.235',
  }, 'unused')
  const settings = JSON.parse(fs.readFileSync(options.args[1], 'utf8'))
  const endpoint = settings.hooks.Stop[0].hooks[0].url
  const send = async body => {
    const response = await fetch(endpoint, { method: 'POST', body: JSON.stringify(body) })
    assert.equal(response.status, 200)
    assert.deepEqual(await response.json(), {}) // No permission decisions or turn control.
  }
  await send({ hook_event_name: 'UserPromptSubmit', prompt_id: 'p1' })
  const stop = { hook_event_name: 'Stop', prompt_id: 'p1', last_assistant_message: 'x'.repeat(100000) }
  await send(stop); await send(stop)
  assert.equal(events.length, 2)
  await send({ hook_event_name: 'UserPromptSubmit', prompt_id: 'p2' })
  await send({ hook_event_name: 'StopFailure', prompt_id: 'p1', error: 'rate_limit' })
  await send({ hook_event_name: 'FutureEvent' })
  assert.equal(events.length, 3)
  const invalid = await fetch(endpoint, { method: 'POST', body: '{' })
  assert.equal(invalid.status, 400)
  const unauthorized = await fetch(endpoint.replace('/attention/', '/attention/wrong/'), { method: 'POST', body: '{}' })
  assert.equal(unauthorized.status, 404)
  // Release after the request was accepted but before its body completes.
  await new Promise((resolve, reject) => {
    bridge.server.once('request', () => bridge.release('pty'))
    const request = http.request(endpoint, { method: 'POST' }, response => { response.resume(); response.on('end', resolve) })
    request.on('error', reject)
    request.end(JSON.stringify({ hook_event_name: 'Stop', prompt_id: 'p2' }))
  })
  assert.equal(events.length, 3)
})
