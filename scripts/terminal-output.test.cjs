const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, globals = {}, mocks = {}) {
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), {
    compilerOptions: { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022 },
  }).outputText
  vm.runInNewContext(code, { exports, process, performance, setTimeout, clearTimeout, ...globals,
    require: name => mocks[name] ?? (name.startsWith('.')
      ? load(path.resolve(path.dirname(file), name + '.ts'), globals, mocks) : require(name)),
  })
  return exports
}
function clock() {
  let time = 0, id = 0
  const jobs = new Map()
  return { now: () => time, schedule: (run, delay = 0) => { jobs.set(++id, { run, at: time + delay }); return id },
    cancel: id => jobs.delete(id), get pending() { return jobs.size },
    tick() { const job = [...jobs].sort((a, b) => a[1].at - b[1].at)[0]; if (!job) return false
      jobs.delete(job[0]); time = job[1].at; job[1].run(); return true },
    drain() { let count = 0; while (this.tick()) assert.ok(++count < 10000, 'timer must settle') },
  }
}
const { PtyOutputBuffer, PTY_OUTPUT_WINDOW } = load('electron/pty-output-buffer.ts')
const { TerminalOutputScheduler } = load('src/terminal/terminal-output-scheduler.ts')

test('cumulative credit preserves Unicode and ignores invalid or duplicate acknowledgements', () => {
  const buffer = new PtyOutputBuffer(), input = '한글😀\x1b[31m'.repeat(30000)
  for (let i = 0; i < input.length; i += 997) buffer.enqueue(input.slice(i, i + 997))
  let result = '', through = 0
  while (buffer.canSend) { const chunk = buffer.take(16384); result += chunk.data; through = chunk.through }
  assert.equal(buffer.outstanding, PTY_OUTPUT_WINDOW)
  assert.equal(buffer.take(10), undefined)
  for (const value of [-1, NaN, Infinity, through + 1, 0.5]) buffer.acknowledge(value)
  assert.equal(buffer.outstanding, PTY_OUTPUT_WINDOW)
  buffer.acknowledge(through); buffer.acknowledge(through); buffer.acknowledge(1)
  while (buffer.pending) { const chunk = buffer.take(8191); result += chunk.data; buffer.acknowledge(chunk.through) }
  assert.equal(result, input); assert.equal(buffer.backlog, 0)
})

test('scheduler bounds writes, prioritizes foreground, and fairly drains all output after parse ACK', () => {
  const timer = clock(), scheduler = new TerminalOutputScheduler(timer), writes = [], callbacks = [], acks = []
  function port(name, active) { return scheduler.register({ active: () => active,
    write: (data, done) => { writes.push({ name, data }); callbacks.push(done) },
    acknowledge: through => acks.push({ name, through }), failed: error => { throw error },
  }) }
  const bg = port('background', false), fg = port('foreground', true)
  const input = '가😀'.repeat(30000)
  bg.enqueue(input, input.length); fg.enqueue(input, input.length)
  timer.tick(); assert.equal(writes[0].name, 'foreground'); assert.equal(acks.length, 0)
  assert.equal(timer.pending, 0, 'no second write until parser callback')
  while (callbacks.length) { callbacks.shift()(); timer.tick() }
  assert.ok(writes.slice(0, 5).some(item => item.name === 'background'))
  for (const name of ['background', 'foreground']) {
    assert.equal(writes.filter(item => item.name === name).map(item => item.data).join(''), input)
    assert.equal(acks.filter(item => item.name === name).at(-1).through, input.length)
  }
  assert.ok(writes.every(item => item.data.length <= 8192))
  fg.dispose(); bg.dispose(); assert.equal(timer.pending, 0)
})

test('typing reduces background slices; disposal releases slot and ignores late parser callbacks', () => {
  const timer = clock(), scheduler = new TerminalOutputScheduler(timer), callbacks = [], writes = [], acks = []
  const register = () => scheduler.register({ active: () => false,
    write: (data, done) => { writes.push(data); callbacks.push(done) }, acknowledge: n => acks.push(n), failed: assert.fail })
  const first = register(), next = register()
  first.noteInput(); first.enqueue('x'.repeat(20000), 20000); next.enqueue('next', 4)
  timer.tick(); assert.equal(writes[0].length, 4096)
  first.dispose(); timer.tick(); callbacks[0](); assert.equal(acks.length, 0)
  callbacks[1](); assert.deepEqual(acks, [4]); next.dispose(); assert.equal(timer.pending, 0)
})

test('PTY high/low watermarks pause and resume; natural exit waits for all parsed output', () => {
  const timer = clock(), sent = [], exits = []
  let onData, onExit, pauses = 0, resumes = 0
  const fake = { pid: 1, pause: () => pauses++, resume: () => resumes++,
    onData: fn => { onData = fn }, onExit: fn => { onExit = fn }, kill: () => onExit({ exitCode: 0 }) }
  const { PtyManager } = load('electron/pty-manager.ts', { setTimeout: timer.schedule, clearTimeout: timer.cancel }, {
    'node-pty': { spawn: () => fake }, 'node:os': { constants: { priority: {} }, setPriority() {} },
  })
  const manager = new PtyManager({ data: (id, data, through) => sent.push({ data, through }),
    exit: (...args) => exits.push(args), attention() {} })
  manager.spawn({ id: 'one', file: 'fake', args: [], cols: 80, rows: 24 })
  const input = '한글😀'.repeat(100000)
  onData(input); assert.equal(pauses, 1); timer.drain()
  assert.equal(sent.reduce((n, item) => n + item.data.length, 0), PTY_OUTPUT_WINDOW)
  assert.equal(timer.pending, 0, 'no polling while credit is exhausted')
  let consumed = 0, result = ''
  while (consumed < sent.length) { const chunk = sent[consumed++]; result += chunk.data
    manager.acknowledgeOutput('one', chunk.through); timer.drain() }
  assert.equal(resumes, 1); assert.equal(result, input)
  onData('final'); onExit({ exitCode: 7 }); timer.drain(); assert.equal(exits.length, 0)
  manager.acknowledgeOutput('one', sent.at(-1).through)
  assert.deepEqual(exits, [['one', 7, false]])
  manager.stopAll(); assert.equal(timer.pending, 0)
})

test('stopping a paused PTY releases the pipe and cancels pending output', () => {
  const timer = clock(), exits = []; let onData, onExit, resumes = 0
  const { PtyManager } = load('electron/pty-manager.ts', { setTimeout: timer.schedule, clearTimeout: timer.cancel }, {
    'node-pty': { spawn: () => ({ pid: 1, pause() {}, resume: () => resumes++,
      onData: fn => { onData = fn }, onExit: fn => { onExit = fn }, kill: () => onExit({ exitCode: 0 }) }) },
    'node:os': { constants: { priority: {} }, setPriority() {} },
  })
  const manager = new PtyManager({ data: assert.fail, exit: (...args) => exits.push(args), attention() {} })
  manager.spawn({ id: 'one', file: 'fake', args: [], cols: 80, rows: 24 })
  onData('x'.repeat(300000)); manager.stopAll(); timer.drain()
  assert.equal(resumes, 1); assert.deepEqual(exits, [['one', 0, true]])
})

test('renderer port loss releases streams; late close of a replaced port cannot stop new streams', () => {
  let parentMessage, stops = 0
  const manager = { stopAll: () => stops++ }
  load('electron/pty-host.ts', { process: { parentPort: {
    postMessage() {}, on: (_, callback) => { parentMessage = callback },
  } } }, { './pty-manager': { PtyManager: class { constructor() { return manager } } } })
  const port = () => { const listeners = {}; return { listeners, on: (name, fn) => { listeners[name] = fn }, start() {}, close() {} } }
  const first = port(), second = port()
  parentMessage({ data: { type: 'renderer-port' }, ports: [first] })
  parentMessage({ data: { type: 'renderer-port' }, ports: [second] })
  assert.equal(stops, 1)
  first.listeners.close(); assert.equal(stops, 1)
  second.listeners.close(); assert.equal(stops, 2)
})

test('browser output clock cancels work and closes both ports when the final terminal is disposed', () => {
  let receive, posted = [], closed = 0, ran = 0
  const { createTerminalOutputClock } = load('src/terminal/terminal-output-clock.ts', {
    MessageChannel: class { constructor() {
      this.port1 = { set onmessage(fn) { receive = fn }, close: () => closed++ }
      this.port2 = { postMessage: id => posted.push(id), close: () => closed++ }
    } },
  })
  const clock = createTerminalOutputClock()
  const canceled = clock.schedule(() => ran++)
  clock.cancel(canceled); receive({ data: posted.shift() }); assert.equal(ran, 0)
  clock.schedule(() => ran++); receive({ data: posted.shift() }); assert.equal(ran, 1)
  clock.schedule(() => ran++); clock.dispose(); receive({ data: posted.shift() })
  assert.equal(ran, 1); assert.equal(closed, 2)
})
