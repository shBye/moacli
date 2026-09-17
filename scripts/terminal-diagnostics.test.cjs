const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const os = require('node:os')
const vm = require('node:vm')
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

const { isUpwardJump, diagnosticEventSchema } = loadTs('src/shared/terminal-diagnostics.ts')
const { TerminalDiagnosticStore } = loadTs('electron/terminal-diagnostic-store.ts')
const position = { base: 100, viewport: 100, cursor: 23, rows: 24, cols: 80, buffer: 'normal', active: true, focused: true, scrollTop: 2000, scrollHeight: 2480, clientHeight: 480 }
const event = (overrides = {}) => ({ terminal: '11111111-1111-4111-8111-111111111111', agent: 'codex', reason: 'sample', at: 1000, elapsed: 1000, sequence: 1, position, jump: false, outputChars: 10, outputBatches: 1, dropped: 0, ...overrides })
test('export IPC validates sender, supports cancellation, and exports only approved metadata', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-diagnostic-test-'))
 const handlers = new Map()
 const sender = {}
 let canceled = true
 const destination = path.join(dir, 'export.json')
 const { attachTerminalDiagnosticsIpc } = loadTs('electron/terminal-diagnostics-ipc.ts', {
  electron: {
   ipcMain: { on: (key, fn) => handlers.set(key, fn), handle: (key, fn) => handlers.set(key, fn), removeListener: key => handlers.delete(key), removeHandler: key => handlers.delete(key) },
   dialog: { showSaveDialog: async () => ({ canceled, filePath: destination }) },
  },
 })
 const stop = attachTerminalDiagnosticsIpc({ directory: dir, version: '0.1.32', window: () => ({ webContents: sender }), versions: async () => [{ id: 'codex', version: 'codex 1.2.3 PRIVATE PATH' }, { id: 'PRIVATE', version: '1.2.3' }] })
 try {
  const record = handlers.get('terminal-diagnostics:record')
  const save = handlers.get('terminal-diagnostics:export')
  record({ sender: {} }, [event({ sequence: 999 })])
  record({ sender }, [event({ reason: 'user-mark' })])
  await assert.rejects(save({ sender: {} }), /Invalid diagnostics caller/)
  assert.equal(await save({ sender }), false)
  assert.equal(fs.existsSync(destination), false)
  canceled = false
  assert.equal(await save({ sender }), true)
  const text = fs.readFileSync(destination, 'utf8')
  const result = JSON.parse(text)
  assert.deepEqual(result.versions, [{ agent: 'codex', version: '1.2.3' }])
  assert.equal(result.diagnostics.files.recent.length, 1)
  assert.equal(result.diagnostics.memoryRecent[0].reason, 'user-mark')
  assert.ok(!text.includes('PRIVATE'))
 } finally { await stop(); assert.equal(handlers.size, 0); cleanup(dir) }
})
function cleanup(dir) {
 assert.equal(path.dirname(dir), os.tmpdir())
 assert.ok(path.basename(dir).startsWith('moacli-diagnostic-test-'))
 fs.rmSync(dir, { recursive: true, force: true })
}

test('detect buffer and DOM-only jumps, without flagging output growth or hidden sessions', () => {
 assert.equal(isUpwardJump(position, { ...position, viewport: 0 }), true)
 assert.equal(isUpwardJump(position, { ...position, scrollTop: 0 }), true)
 assert.equal(isUpwardJump(position, { ...position, viewport: 110, base: 110 }), false)
 assert.equal(isUpwardJump(position, { ...position, viewport: 0, active: false }), false)
 assert.equal(isUpwardJump(undefined, position), false)
})
test('IPC whitelist strips arbitrary text and rejects nonfinite positions and unapproved reasons', () => {
 assert.equal(diagnosticEventSchema.safeParse(event({ at: Date.now() })).success, true)
 const parsed = diagnosticEventSchema.parse(event({ rawOutput: 'PRIVATE CONTENT', email: 'PRIVATE EMAIL', position: { ...position, path: 'PRIVATE PATH' } }))
 assert.ok(!JSON.stringify(parsed).includes('PRIVATE'))
 assert.equal(diagnosticEventSchema.safeParse(event({ position: { ...position, base: Infinity } })).success, false)
 assert.equal(diagnosticEventSchema.safeParse(event({ reason: 'PRIVATE COMMAND' })).success, false)
})
test('disk logs survive restart, preserve incident context, and do not retain raw output', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-diagnostic-test-'))
 try {
  const store = new TerminalDiagnosticStore(dir, () => 123)
  store.accept([event({ rawOutput: 'PRIVATE' })])
  store.accept([event({ sequence: 2, jump: true, reason: 'scroll', previous: position, position: { ...position, viewport: 0 } })])
  store.accept([event({ sequence: 3, reason: 'output-settled' })])
  await store.close()
  const next = new TerminalDiagnosticStore(dir)
  const data = await next.snapshot()
  assert.equal(data.files.recent.length, 3)
  assert.equal(data.files.incidents[0].events.length, 3)
  assert.ok(!JSON.stringify(data).includes('PRIVATE'))
  assert.equal(data.writeFailed, false)
  await next.close()
 } finally { cleanup(dir) }
})
test('rotation limits disk usage and malformed batches are ignored', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-diagnostic-test-'))
 try {
  const store = new TerminalDiagnosticStore(dir)
  store.accept('PRIVATE'); store.accept(Array.from({length:101}, () => event()))
  for(let i=0;i<100;i++) {
   store.accept(Array.from({length:100}, (_,j)=>event({sequence:i*100+j})))
   if(i%10===0) await store.close()
  }
  await store.close()
  const files = fs.readdirSync(dir)
  assert.ok(files.includes('recent.previous.jsonl'))
  for(const name of files) assert.ok(fs.statSync(path.join(dir,name)).size <= 2*1024*1024)
  const snapshot = await store.snapshot()
  assert.equal(snapshot.lostBatches, 0)
 } finally { cleanup(dir) }
})
test('read/write failure is reported and latest memory events remain exportable', async () => {
 const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-diagnostic-test-'))
 try {
  const blocked = path.join(dir, 'not-a-directory'); fs.writeFileSync(blocked, '')
  const store = new TerminalDiagnosticStore(blocked)
  store.accept([event()])
  const snapshot = await store.snapshot()
  assert.equal(snapshot.writeFailed, true)
  assert.equal(snapshot.memoryRecent.length, 1)
 } finally { cleanup(dir) }
})
test('collector is observational, batches output, removes listeners, and never records typed content', async () => {
 const { attachTerminalDiagnostics } = loadTs('src/terminal/attach-terminal-diagnostics.ts')
 const listeners = new Map(); const parsers=[]; const sent=[]; let disposed=0; let marked; let scrolled; let parsed; let changed
 const viewport = { scrollTop: 2000, scrollHeight: 2480, clientHeight: 480, addEventListener: (n,cb)=>listeners.set('v'+n,cb), removeEventListener: n=>listeners.delete('v'+n) }
 let layoutReads = 0
 for (const key of ['scrollTop', 'scrollHeight', 'clientHeight']) {
  const value = viewport[key]
  Object.defineProperty(viewport, key, { get: () => { layoutReads++; return value } })
 }
 const container = { querySelector: ()=>viewport, addEventListener:(n,cb)=>listeners.set(n,cb), removeEventListener:n=>listeners.delete(n) }
 const subscription = cb => { parsers.push(cb); return {dispose:()=>disposed++} }
 const terminal = { rows:24, cols:80, textarea:{}, buffer:{ active:{baseY:100,viewportY:100,cursorY:23,type:'normal'}, onBufferChange: cb=>{changed=cb;return {dispose:()=>disposed++}} },
  onScroll: cb=>{scrolled=cb;return {dispose:()=>disposed++}}, onWriteParsed:cb=>{parsed=cb;return {dispose:()=>disposed++}},
  parser:{ registerCsiHandler:(_,cb)=>subscription(cb), registerEscHandler:(_,cb)=>subscription(cb) } }
 const original = global.document; global.document = {activeElement:terminal.textarea}
 let collector
 try {
  collector=attachTerminalDiagnostics(terminal,container,{id:event().terminal,agent:'codex',active:()=>true,send:batch=>sent.push(...batch)})
  listeners.get('keydown')({key:'PRIVATE CHARACTER'})
  collector.output(45); parsed()
  for (let i = 0; i < 50; i++) collector.record('scroll')
  collector.record('attention', 4)
  for(const parser of parsers) assert.equal(parser([3,1049,2026]),false)
  terminal.buffer.active.viewportY=0;scrolled()
  assert.equal(layoutReads, 0, 'input, parser and scroll callbacks must not force layout')
  await new Promise(r=>setTimeout(r,300))
  assert.equal(layoutReads, 3, 'visible geometry is sampled once at the diagnostic cadence')
  collector.dispose()
  assert.equal(listeners.size,0)
  assert.equal(disposed,7)
  assert.ok(sent.some(e=>e.jump))
  assert.ok(sent.some(e=>e.outputChars===45))
  assert.ok(sent.some(e=>e.reason==='attention' && e.value===4))
  assert.ok(!JSON.stringify(sent).includes('PRIVATE'))
  const count=sent.length; collector.record('sample');assert.equal(sent.length,count)
 } finally { if(collector && listeners.size)collector.dispose();global.document=original }
})
