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
const { changeFolderExpansion, toggleAllFolders, folderRevealScrollDelta } = loadTs('src/features/folders/folder-expansion.ts')
const folders = [{ id: 'a' }, { id: 'b' }, { id: 'locked', locked: true }]
test('tab reveal preserves other open folders without mutating input', () => {
 const state = Object.freeze({ open: Object.freeze(['a']), previous: [] })
 const next = changeFolderExpansion(state, folders, 'b', 'open')
 assert.deepEqual(next.open, ['a', 'b'])
 assert.deepEqual(state.open, ['a'])
 assert.deepEqual(changeFolderExpansion(next, folders, 'b', 'open').open, ['a', 'b'])
})
test('locked and missing folders stay closed', () => {
 for (const id of ['locked', 'missing']) assert.deepEqual(changeFolderExpansion({open:['a'],previous:[]}, folders, id, 'open').open, ['a'])
})
test('manual collapse is local and collapse all restores the prior group', () => {
 const state = { open: ['a','b'], previous: [] }
 assert.deepEqual(changeFolderExpansion(state, folders, 'a', 'toggle').open, ['b'])
 assert.deepEqual(toggleAllFolders(toggleAllFolders(state, folders), folders).open, ['a','b'])
})
test('restore excludes removed and locked folders', () => {
 const state = { open: [], previous: ['a','b'] }
 assert.deepEqual(toggleAllFolders(state, [{id:'a',locked:true},{id:'b'}]).open, ['b'])
 assert.deepEqual(toggleAllFolders(state, []).open, [])
})
test('scroll is minimal and visible rows do not move', () => {
 assert.equal(folderRevealScrollDelta(20,40,0,100),0)
 assert.equal(folderRevealScrollDelta(-10,20,0,100),-10)
 assert.equal(folderRevealScrollDelta(80,110,0,100),10)
 assert.equal(folderRevealScrollDelta(-10,110,0,100),0)
})
