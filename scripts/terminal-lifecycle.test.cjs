const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')
const agentEvents = {}
vm.runInNewContext(ts.transpileModule(fs.readFileSync('src/features/sessions/agent-event.ts', 'utf8'), {
  compilerOptions: { module: ts.ModuleKind.CommonJS },
}).outputText, { exports: agentEvents })

// Run the actual launch effect with deterministic boundary doubles.
function harness() {
  const slots = [], starts = [], stops = [], resizes = [], writes = [], states = []
  let cursor = 0, effects = [], previous = [], resolveStart, rejectStart, terminal, onAttention, onInput, compareProps
  const noop = () => {}
  const disposable = () => ({ dispose: noop })
  const react = {
    memo: (value, compare) => { compareProps = compare; return value },
    useState: initial => {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], noop]
    },
    useRef: initial => {
      const index = cursor++
      return slots[index] ??= { current: initial }
    },
    useEffect: (run, deps) => effects.push({ run, deps }),
  }
  class Terminal {
    constructor(options) {
      terminal = this
      this.options = options
      this.cols = 80
      this.rows = 24
      this.parser = { registerCsiHandler: disposable }
    }
    loadAddon() {} open() {} focus() {} dispose() {}
    onData(callback) { onInput = callback; return disposable() }
    onWriteParsed() { return disposable() }
    attachCustomKeyEventHandler() {}
    write(data) { writes.push(data) }
    writeln(data) { writes.push(data) }
    paste(data) { writes.push(data) }
  }
  const api = {
    writePty: noop,
    startPty: request => { starts.push(request); return new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject }) },
    stopPty: id => stops.push(id),
    resizePty: (...args) => resizes.push(args),
    onPtyData: () => noop, onPtyExit: () => noop,
    onPtyAttention: (_id, callback) => { onAttention = callback; return noop },
  }
  const imports = {
    react,
    './terminal-output-scheduler': { terminalOutputScheduler: { register: port => ({
      enqueue: data => port.write(data, noop), noteInput: noop, wake: noop, dispose: noop,
    }) } },
    './attach-codex-redraw-follow': { attachCodexRedrawFollow: () => () => {} },
    './attach-terminal-diagnostics': { attachTerminalDiagnostics: () => ({ record: noop, output: noop, dispose: noop }) },
    'react/jsx-runtime': { jsx: noop, jsxs: noop },
    '@xterm/xterm': { Terminal },
    '@xterm/addon-fit': { FitAddon: class { fit() {} } },
    '@xterm/addon-search': { SearchAddon: class {} },
    '@xterm/addon-web-links': { WebLinksAddon: class {} },
    'lucide-react': {},
    './ime-lifecycle': { attachImeLifecycle: () => noop },
    './ime-focus': { cancelTerminalFocus: noop, requestTerminalFocus: () => noop },
    './terminal-clipboard': {},
    './terminal-options': { createTerminalOptions: () => ({}) },
    './terminal-paste': { attachTerminalPaste: () => ({ dispose: noop }) },
    '../features/sessions/agent-event': agentEvents,
  }
  const exports = {}
  const source = fs.readFileSync('src/terminal/TerminalPane.tsx', 'utf8')
  const code = ts.transpileModule(source, { compilerOptions: { module: ts.ModuleKind.CommonJS, jsx: ts.JsxEmit.ReactJSX, target: ts.ScriptTarget.ES2022 } }).outputText
  vm.runInNewContext(code, {
    exports, require: name => { if (!(name in imports)) throw Error(name); return imports[name] },
    window: { cliAgent: api }, crypto: { randomUUID: () => 'pty-test' },
    performance: { now: () => 0 }, setTimeout: () => 1, clearTimeout: noop,
    requestAnimationFrame: () => 1, cancelAnimationFrame: noop,
    ResizeObserver: class { observe() {} disconnect() {} },
  })
  return {
    starts, stops, resizes, writes, states,
    equal: (a, b) => compareProps(a, b),
    paste: () => effects[1].run(),
    render(props) {
      cursor = 0; effects = []
      exports.TerminalPane({ active: false, sessionId: 'session', agentId: 'codex', cwd: '.', title: 'New', resumeId: '', renderer: 'dom', onActivity: noop, onStateChange: state => states.push(state), ...props })
      slots[1].current = { dataset: {}, addEventListener: noop, removeEventListener: noop }
      const changed = effects.map((effect, index) => !previous[index] || effect.deps.some((dep, i) => !Object.is(dep, previous[index].deps[i])))
      previous = effects
      return changed
    },
    launch: () => effects[0].run(),
    attention: event => onAttention(event),
    input: data => onInput(data),
    activate: () => effects.find(effect => effect.deps.length === 1 && effect.deps[0] === true).run(),
    resizeGrid: () => { terminal.cols = 120; terminal.rows = 40 },
    resolve: async () => { resolveStart(); await Promise.resolve(); await Promise.resolve() },
    reject: async () => { rejectStart(Error('late failure')); await Promise.resolve(); await Promise.resolve() },
  }
}

test('memo observes paste requests and a ready terminal consumes each request only once', async () => {
  const h = harness()
  let consumed = 0
  const old = { active: true, pendingPaste: { id: 'one', text: 'old' } }
  const next = { active: true, pendingPaste: { id: 'two', text: 'hello\x00world' }, onPasteConsumed: () => consumed++ }
  assert.equal(h.equal(old, next), false)
  assert.equal(h.equal(old, { ...old, pendingPaste: { id: 'one', text: 'new' } }), false)
  assert.equal(h.equal(old, { ...old }), true)
  h.render(next)
  const dispose = h.launch()
  await h.resolve()
  h.paste(); h.paste()
  assert.deepEqual(h.writes, ['helloworld'])
  assert.equal(consumed, 1)
  dispose()
})

for (const agentId of ['codex', 'claude']) {
  test(agentId + ': first history link and rename preserve the running terminal', async () => {
    const h = harness()
    h.render({ agentId })
    const dispose = h.launch()
    await h.resolve()
    const changed = h.render({ agentId, resumeId: 'first-conversation', title: 'First question' })
    assert.equal(changed[0], false, 'must not clean up and restart the PTY')
    assert.equal(changed[1], false, 'must not recreate the WebGL renderer')
    assert.equal(h.starts.length, 1)
    assert.equal(h.stops.length, 0)
    dispose()
    const restarted = harness()
    restarted.render({ agentId, resumeId: 'first-conversation' })
    restarted.launch()
    assert.equal(restarted.starts[0].resumeId, 'first-conversation')
  })
}
test('launch completion synchronizes a grid resized while starting', async () => {
  const h = harness(); h.render({}); h.launch(); h.resizeGrid(); await h.resolve()
  assert.deepEqual(h.resizes, [['pty-test', 120, 40]])
})
test('late startup failure after disposal does not write or change UI state', async () => {
  const h = harness(); h.render({}); h.launch()(); await h.reject()
  assert.deepEqual(h.writes, [])
  assert.deepEqual(h.states, ['starting'])
})
test('late startup success stops the orphan without resizing it', async () => {
  const h = harness(); h.render({}); h.launch()(); await h.resolve()
  assert.equal(h.stops.length, 2)
  assert.deepEqual(h.resizes, [])
})

test('active pane distinguishes approval, unknown attention, and response completion', () => {
  const h = harness()
  h.render({ active: true, activityStatusEnabled: true })
  const dispose = h.launch()
  for (const kind of ['approval_required', 'attention', 'response_completed']) {
    h.attention({ kind, name: 'test', source: 'claude-http' })
  }
  assert.deepEqual(h.states, ['starting', 'needs_attention', 'needs_attention', 'running'])
  dispose()
})

test('Codex structured events own completion; viewing an approval does not acknowledge it', () => {
  const h = harness()
  h.render({ active: true, activityStatusEnabled: true })
  const dispose = h.launch()
  h.attention({ kind: 'ready', name: 'SessionStart', source: 'codex-hooks' })
  h.attention({ kind: 'processing', name: 'UserPromptSubmit', source: 'codex-hooks' })
  h.attention({ kind: 'response_completed', name: 'Stop', source: 'codex-hooks' })
  h.input('/hooks\r')
  assert.equal(h.states.at(-1), 'running') // Slash commands are not model turns.
  h.attention({ kind: 'processing', name: 'UserPromptSubmit', source: 'codex-hooks' })
  h.attention({ kind: 'approval_required', name: 'PermissionRequest', source: 'codex-hooks' })
  h.activate()
  assert.equal(h.states.at(-1), 'needs_attention')
  h.input('\x1b[B')
  assert.equal(h.states.at(-1), 'needs_attention')
  h.input('\r')
  assert.equal(h.states.at(-1), 'needs_attention')
  h.attention({ kind: 'processing', name: 'PostToolUse', source: 'codex-hooks' })
  assert.equal(h.states.at(-1), 'processing')
  h.attention({ kind: 'response_completed', name: 'Stop', source: 'codex-hooks' })
  assert.equal(h.states.at(-1), 'running')
  dispose()
})

test('Codex setup and resume-menu Enter do not fabricate approval or processing', () => {
  const h = harness()
  h.render({ active: true, activityStatusEnabled: true })
  const dispose = h.launch()
  h.attention({ kind: 'ready', name: 'HookSetupRequired', source: 'codex-hooks' })
  h.input('\r')
  h.input('/hooks\r')
  h.activate()
  assert.deepEqual(h.states, ['starting', 'running'])
  h.attention({ kind: 'processing', name: 'UserPromptSubmit', source: 'codex-hooks' })
  assert.equal(h.states.at(-1), 'processing')
  dispose()
})

for (const backend of ['conpty', 'posix']) {
  test(backend + ': resizing uses the correct scrollback restoration policy', async () => {
    const exports = {}
    const source = fs.readFileSync('src/terminal/terminal-options.ts', 'utf8')
    vm.runInNewContext(ts.transpileModule(source, {
      compilerOptions: { module: ts.ModuleKind.CommonJS },
    }).outputText, { exports })
    const { Terminal } = require('@xterm/xterm')
    const options = exports.createTerminalOptions({ fontFamily: 'monospace', fontSize: 14 }, false, backend)
    const terminal = new Terminal({ ...options, cols: 20, rows: 3 })
    try {
      await new Promise(resolve => terminal.write('one\r\ntwo\r\nthree\r\nfour\r\nfive', resolve))
      const originalBase = terminal.buffer.active.baseY
      assert.equal(originalBase, 2)
      terminal.resize(20, 5)
      assert.equal(terminal.buffer.active.baseY, backend === 'conpty' ? originalBase : 0)
      assert.equal(terminal.buffer.active.getLine(0).translateToString(true), 'one')
      assert.equal(terminal.buffer.active.getLine(4).translateToString(true), 'five')
    } finally {
      terminal.dispose()
    }
  })
}
