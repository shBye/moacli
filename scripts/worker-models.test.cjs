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

const { validateModel, workerModelArgs } = loadTs('src/features/delegation/model-policy.ts')
const { readWorkerModel } = loadTs('electron/read-worker-model.ts')
const { TerminalPermissionStore } = loadTs('electron/terminal-permission-store.ts')
const { codexPermissionArgs } = loadTs('src/features/settings/terminal-permissions.ts')
test('model IDs are single safe CLI arguments and blank means CLI default', () => {
 assert.deepEqual(workerModelArgs(''), [])
 assert.deepEqual(workerModelArgs(' model-123 '), ['--model', 'model-123'])
 assert.equal(validateModel('sonnet[1m]'), 'sonnet[1m]')
 for (const bad of ['--yolo','m;whoami','m&whoami','m%PATH%','m new','m\nnew', {}, 'a'.repeat(161)]) assert.throws(() => validateModel(bad))
})
test('Codex reads only the selected account model, including profile overrides', () => {
 const account = { agentId: 'codex', configDir: 'custom', detected: false }
 const files = new Map([[path.join('custom','config.toml'), 'model="base"\nprofile="fast"\napproval_policy="never"\n[profiles.fast]\nmodel="legacy"'],[path.join('custom','fast.config.toml'),'model="profile"']])
 const read = p => files.get(p)
 assert.equal(readWorkerModel('codex', '', account, { CODEX_HOME: 'wrong' }, 'home', read), 'profile')
 files.delete(path.join('custom','fast.config.toml'))
 assert.equal(readWorkerModel('codex', '', account, {}, 'home', read), 'legacy')
 assert.equal(readWorkerModel('codex', 'explicit', account, {}, 'home', () => { throw Error('must not read') }), 'explicit')
 assert.equal(readWorkerModel('codex', '', undefined, {}, 'home', () => undefined), '')
 assert.throws(() => readWorkerModel('codex', '', account, {}, 'home', () => 'broken = [ '), /Cannot resolve/)
})
test('Claude model setting respects selected account and model environment override', () => {
 assert.equal(readWorkerModel('claude', '', undefined, { ANTHROPIC_MODEL: 'env-model' }, 'home', () => {throw Error()}), 'env-model')
 assert.equal(readWorkerModel('claude', '', {configDir: 'account'}, {}, 'home', p => p === path.join('account','settings.json') ? '{"model":"opus"}' : undefined), 'opus')
 assert.equal(readWorkerModel('claude', '', undefined, {}, 'home', () => undefined), '')
})
test('full access persists across store instances and only affects regular Codex terminals', t => {
 const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'moacli-permissions-test-'))
 t.after(() => fs.rmSync(directory, {recursive:true,force:true}))
 const file = path.join(directory,'permissions.json')
 const store = new TerminalPermissionStore(file)
 assert.equal(store.read().codex, 'cli-default')
 store.save('full-access')
 const saved = new TerminalPermissionStore(file).read()
 assert.deepEqual(codexPermissionArgs('codex', undefined, saved), ['--dangerously-bypass-approvals-and-sandbox'])
 assert.deepEqual(codexPermissionArgs('codex', 'login', saved), [])
 assert.deepEqual(codexPermissionArgs('claude', undefined, saved), [])
 assert.throws(() => store.save('arbitrary'))
 store.save('cli-default')
 assert.deepEqual(codexPermissionArgs('codex', undefined, store.read()), [])
})
