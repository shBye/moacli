const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const vm = require('node:vm')
const ts = require('typescript')

// Run the actual launch effect with deterministic boundary doubles.
function harness() {
  const slots = [], starts = [], stops = [], resizes = [], writes = [], states = []
  let cursor = 0, effects = [], previous = [], resolveStart, rejectStart, terminal
  const noop = () => {}
  const disposable = () => ({ dispose: noop })
  const react = {
    memo: value => value,
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
    onData() { return disposable() }
    onWriteParsed() { return disposable() }
    attachCustomKeyEventHandler() {}
    write(data) { writes.push(data) }
    writeln(data) { writes.push(data) }
  }
  const api = {
    startPty: request => { starts.push(request); return new Promise((resolve, reject) => { resolveStart = resolve; rejectStart = reject }) },
    stopPty: id => stops.push(id),
    resizePty: (...args) => resizes.push(args),
    onPtyData: () => noop, onPtyExit: () => noop, onPtyAttention: () => noop,
  }
  const imports = {
    react,
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
    render(props) {
      cursor = 0; effects = []
      exports.TerminalPane({ active: false, sessionId: 'session', agentId: 'codex', cwd: '.', title: 'New', resumeId: '', renderer: 'dom', onActivity: noop, onStateChange: state => states.push(state), ...props })
      slots[1].current = { dataset: {}, addEventListener: noop, removeEventListener: noop }
      const changed = effects.map((effect, index) => !previous[index] || effect.deps.some((dep, i) => !Object.is(dep, previous[index].deps[i])))
      previous = effects
      return changed
    },
    launch: () => effects[0].run(),
    resizeGrid: () => { terminal.cols = 120; terminal.rows = 40 },
    resolve: async () => { resolveStart(); await Promise.resolve(); await Promise.resolve() },
    reject: async () => { rejectStart(Error('late failure')); await Promise.resolve(); await Promise.resolve() },
  }
}

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
