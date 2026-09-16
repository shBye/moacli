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

const { attachCodexRedrawFollow } = loadTs('src/terminal/attach-codex-redraw-follow.ts')
function harness() {
 const handlers = new Map(), listeners = new Map(), timers = new Map(), frames = new Map()
 let now=0, id=0, active=true, follows=0, parsed, disposed=0
 const buffer={type:'normal',baseY:1000,viewportY:1000}
 const terminal={buffer:{active:buffer},scrollToBottom:()=>{follows++;buffer.viewportY=buffer.baseY},
  parser:{registerCsiHandler:(key,fn)=>{handlers.set((key.prefix||'')+key.final,fn);return {dispose:()=>disposed++}}},
  onWriteParsed:fn=>{parsed=fn;return {dispose:()=>disposed++}}}
 const container={addEventListener:(key,fn)=>listeners.set(key,fn),removeEventListener:key=>listeners.delete(key)}
 const clock={now:()=>now,frame:fn=>{frames.set(++id,fn);return id},cancelFrame:id=>frames.delete(id),timeout:(fn,ms)=>{timers.set(++id,{fn,at:now+ms});return id},clearTimeout:id=>timers.delete(id)}
 const records=[]
 const dispose=attachCodexRedrawFollow(terminal,container,{active:()=>active,record:r=>records.push(r)},clock)
 return {buffer,records,dispose, listeners, frames,timers, get follows(){return follows},get disposed(){return disposed},
  csi:(key,params)=>handlers.get(key)(params),parsed:()=>parsed(),active:v=>active=v,
  frame:()=>{for(const [key,fn] of [...frames]){frames.delete(key);fn()}},
  advance:ms=>{now+=ms;for(const [key,timer]of [...timers])if(timer.at<=now){timers.delete(key);timer.fn()}}}
}
test('clear-scrollback redraw retains bottom across split output and delayed DOM updates', () => {
 const h=harness()
 assert.equal(h.csi('J',[3]),false)
 h.csi('?h',[2026]);h.buffer.baseY=0;h.buffer.viewportY=0
 h.buffer.baseY=642;h.parsed();assert.equal(h.buffer.viewportY,642)
 h.buffer.baseY=1128;h.buffer.viewportY=0;h.csi('?l',[2026]);h.parsed()
 h.buffer.viewportY=0;h.frame();assert.equal(h.buffer.viewportY,1128)
 h.buffer.viewportY=0;h.advance(120);assert.equal(h.buffer.viewportY,1128)
 const count=h.follows;h.parsed();assert.equal(h.follows,count)
 h.dispose();assert.equal(h.disposed,4);assert.equal(h.listeners.size,0);assert.equal(h.timers.size,0)
})
test('reading history, hidden panes and non-clearing output never enable bottom-follow', () => {
 const h=harness();h.buffer.viewportY=50;h.csi('J',[3]);h.parsed();assert.equal(h.follows,0)
 h.buffer.viewportY=1000;h.active(false);h.csi('J',[3]);h.parsed();assert.equal(h.follows,0)
 h.active(true);h.csi('J',[2]);h.parsed();assert.equal(h.follows,0);h.dispose()
})
test('user navigation, hidden panes and hard deadline cancel every pending restoration', () => {
 for(const key of ['wheel','pointerdown','keydown','touchstart']){
  const h=harness();h.csi('J',[3]);h.parsed();h.listeners.get(key)({key:'PageUp'});const count=h.follows
  h.frame();h.advance(3000);h.parsed();assert.equal(h.follows,count);assert(h.records.includes('redraw-cancel'));h.dispose()
 }
 const h=harness();h.csi('J',[3]);h.active(false);h.parsed();assert.equal(h.follows,0);h.dispose()
 const timed=harness();timed.csi('J',[3]);timed.advance(2000);timed.parsed();assert.equal(timed.follows,0);timed.dispose()
})
