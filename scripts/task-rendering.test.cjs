const assert = require('node:assert/strict')
const { test } = require('node:test')
const fs = require('node:fs')
const path = require('node:path')
const vm = require('node:vm')
const ts = require('typescript')

function load(file, mocks = {}) {
  file = path.resolve(file)
  const exports = {}
  const code = ts.transpileModule(fs.readFileSync(file, 'utf8'), { compilerOptions: {
    module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2022, jsx: ts.JsxEmit.ReactJSX,
  } }).outputText
  vm.runInThisContext('(function(require, exports) {' + code + '\n})', { filename: file })(name => {
    if (name in mocks) return mocks[name]
    if (!name.startsWith('.')) return require(name)
    const base = path.resolve(path.dirname(file), name)
    return load(fs.existsSync(base + '.ts') ? base + '.ts' : base + '.tsx', mocks)
  }, exports)
  return exports
}

function hooks() {
  let cursor = 0, effects = []
  const slots = [], previous = []
  const react = {
    useState(initial) {
      const index = cursor++
      if (!(index in slots)) slots[index] = typeof initial === 'function' ? initial() : initial
      return [slots[index], next => { slots[index] = typeof next === 'function' ? next(slots[index]) : next }]
    },
    useRef(initial) { const index = cursor++; return slots[index] ??= { current: initial } },
    useCallback(fn) { cursor++; return fn },
    useEffect(run, deps) { effects.push({ index: cursor++, run, deps }) },
  }
  return { react, render(fn) {
    cursor = 0; effects = []
    const result = fn()
    for (const effect of effects) {
      const old = previous[effect.index]
      if (old && effect.deps.every((value, index) => Object.is(value, old.deps[index]))) continue
      old?.cleanup?.()
      previous[effect.index] = { deps: effect.deps, cleanup: effect.run() }
    }
    return result
  }, dispose() { for (const effect of previous) effect?.cleanup?.() } }
}
const tick = () => new Promise(resolve => setImmediate(resolve))
const source = { sessionId: 'a', historyKey: 'native-a', title: 'A', cwd: 'C:/same' }
const own = { id: 'one', source, status: 'running' }
const foreign = { id: 'other', source: { ...source, sessionId: 'b', historyKey: 'native-b' }, status: 'running' }

test('task revision changes only for the matching session and task kind', () => {
  const { sessionTaskRevision } = load('src/features/delegation/session-task-display.ts')
  const revision = sessionTaskRevision([own, foreign], source, 'mcp')
  assert.equal(revision, sessionTaskRevision([own, { ...foreign, status: 'completed' }], source, 'mcp'))
  assert.notEqual(revision, sessionTaskRevision([{ ...own, status: 'completed' }, foreign], source, 'mcp'))
  assert.equal(sessionTaskRevision([own], source, 'review'), '[]')
})

test('source synchronization deduplicates pending calls and ignores activity-only changes', async () => {
  const h = hooks()
  const { useReviewSourceLinks } = load('src/features/reviews/useReviewSourceLinks.ts', { react: h.react })
  const calls = []
  let resolve
  const api = { syncTaskSource: value => { calls.push(value); return new Promise(done => { resolve = done }) } }
  const session = { id: 'a', historyKey: 'native-a', title: 'A', cwd: 'C:/same', terminalRevision: 0, state: 'running' }
  h.render(() => useReviewSourceLinks(api, [session], { tasks: [] }))
  h.render(() => useReviewSourceLinks(api, [{ ...session, state: 'working' }], { tasks: [] }))
  assert.equal(calls.length, 1)
  resolve(); await tick()
  h.render(() => useReviewSourceLinks(api, [{ ...session }], { tasks: [foreign] }))
  assert.equal(calls.length, 1)
  h.render(() => useReviewSourceLinks(api, [{ ...session, terminalRevision: 1 }], { tasks: [] }))
  assert.equal(calls.length, 2)
  resolve(); h.dispose()
})

test('review list does not refetch for unrelated task updates', async () => {
  const h = hooks()
  const { useSessionReviews } = load('src/features/reviews/useSessionReviews.ts', { react: h.react })
  let calls = 0
  const api = { listReviews: async () => { calls++; return [] } }
  const review = { id: 'review', reviewSource: source, status: 'running' }
  h.render(() => useSessionReviews(api, source, { tasks: [review, foreign] })); await tick()
  h.render(() => useSessionReviews(api, source, { tasks: [review, { ...foreign, status: 'completed' }] }))
  assert.equal(calls, 1)
  h.render(() => useSessionReviews(api, source, { tasks: [{ ...review, status: 'completed' }, foreign] }))
  assert.equal(calls, 2)
  await tick(); h.dispose()
})

test('closed results do not fetch or mount Markdown; reopening reuses loaded text', async () => {
  const h = hooks()
  const jsx = (type, props) => ({ type, props })
  const { TaskResultDetails } = load('src/features/delegation/TaskResultDetails.tsx', {
    react: h.react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: 'Fragment' },
    '../conversation/MarkdownContent': { MarkdownContent: 'Markdown' },
  })
  let calls = 0
  const api = { getSessionTaskResult: async () => { calls++; return 'large result' }, openExternal() {}, writeTerminalClipboard() {} }
  const render = () => h.render(() => TaskResultDetails({ api, taskId: 'task' }))
  const containsMarkdown = tree => Boolean(tree && typeof tree === 'object' && (tree.type === 'Markdown'
    || (Array.isArray(tree) ? tree : [tree.props?.children]).some(containsMarkdown)))
  let tree = render()
  assert.equal(calls, 0); assert.equal(containsMarkdown(tree), false)
  tree.props.onToggle({ currentTarget: { open: true } }); tree = render()
  await tick(); tree = render()
  assert.equal(calls, 1); assert.equal(containsMarkdown(tree), true)
  tree.props.onToggle({ currentTarget: { open: false } }); tree = render()
  assert.equal(containsMarkdown(tree), false)
  tree.props.onToggle({ currentTarget: { open: true } }); tree = render()
  assert.equal(calls, 1); assert.equal(containsMarkdown(tree), true)
  h.dispose()
})
