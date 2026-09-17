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


const { parseDelegationModels } = loadTs('src/features/delegation/model-policy.ts')
const { modelOptionsWithSaved, parseCodexModels, presetModelCatalog } = loadTs('src/features/delegation/model-catalog.ts')
const { decodeFileWorkerEvent } = loadTs('electron/file-worker-events.ts')
const { geminiWorkerSettings, openCodeWorkerSettings, assertFileWorkerVersion } = loadTs('electron/file-worker-policy.ts')
const empty = () => ({text:'',completed:false})
test('legacy model defaults extend without replacing saved values',()=>{
 assert.deepEqual(parseDelegationModels({claude:'opus',codex:'saved'}),{claude:'opus',codex:'saved',gemini:'',opencode:''})
 assert.deepEqual(modelOptionsWithSaved([], 'old-model'),[{value:'old-model',label:'old-model (saved)'}])
 assert.deepEqual(parseCodexModels([{id:'legacy',model:'actual',displayName:'Actual'},{id:'hidden',hidden:true},{model:'bad;arg'}]),[{value:'actual',label:'Actual'}])
 assert.ok(presetModelCatalog('claude').options.some(x=>x.value==='sonnet'))
})
test('Gemini only completes on successful final result and preserves Unicode chunks',()=>{
 let state=decodeFileWorkerEvent('gemini',empty(),{type:'init',session_id:'session'}).state
 for(const content of ['??','???']) state=decodeFileWorkerEvent('gemini',state,{type:'message',role:'assistant',delta:true,content}).state
 assert.equal(state.text,'?????');assert.equal(state.completed,false);assert.equal(state.sessionId,'session')
 const next=decodeFileWorkerEvent('gemini',state,{type:'result',status:'success'}).state
 assert.equal(next.completed,true);assert.equal(state.completed,false)
 assert.ok(decodeFileWorkerEvent('gemini',state,{type:'result',status:'error',error:{message:'quota'}}).state.error)
})
test('OpenCode tool step is not a final answer and errors survive final events',()=>{
 let state=decodeFileWorkerEvent('opencode',empty(),{type:'step_finish',part:{reason:'tool-calls'}}).state
 assert.equal(state.completed,false)
 state=decodeFileWorkerEvent('opencode',state,{type:'text',sessionID:'s',part:{text:'answer'}}).state
 state=decodeFileWorkerEvent('opencode',state,{type:'step_finish',part:{reason:'stop'}}).state
 assert.equal(state.completed,true); assert.equal(state.text,'answer');assert.equal(state.sessionId,'s')
 state=decodeFileWorkerEvent('opencode',state,{type:'error',error:{data:{message:'failed'}}}).state
 assert.equal(state.error,'failed')
})
test('new worker policies do not expose shell/delegation and snapshot reviews have no tools',()=>{
 for(const mode of ['analyze','edit']) {
  const gemini=geminiWorkerSettings(mode,false)
  assert.equal(gemini.admin.mcp.enabled,false); assert.equal(gemini.hooksConfig.enabled,false)
  assert.ok(!gemini.tools.core.includes('run_shell_command'));assert.ok(!gemini.tools.core.includes('enter_plan_mode'));assert.ok(!gemini.tools.core.includes('agent'))
  assert.equal(gemini.tools.core.includes('write_file'),mode==='edit')
  const opencode=openCodeWorkerSettings(mode,false)
  assert.equal(opencode.permission['*'],'deny');assert.equal(opencode.permission.bash,undefined)
  assert.equal(opencode.permission.edit,mode==='edit'?'allow':undefined)
 }
 assert.deepEqual(geminiWorkerSettings('edit',true).tools.core,[])
 assert.equal(openCodeWorkerSettings('edit',true).permission.edit,undefined)
 assertFileWorkerVersion('gemini','0.56.0');assertFileWorkerVersion('opencode','1.2.27')
 for(const [agent,version] of [['gemini','0.25.0'],['gemini','1.0.0'],['opencode','2.0.0'],['opencode','unknown']]) assert.throws(()=>assertFileWorkerVersion(agent,version))
})
test('file worker waits for probe, sends policy via environment, and rejects missing final result',async()=>{
 for(const agent of ['gemini','opencode']) {
  const calls=[]
  const {startFileWorker}=loadTs('electron/start-file-worker.ts',new Map(),{
   './agent-profiles':{detectBinary:()=> 'fixture'},
   './run-worker-process':{runWorkerProcess:(binary,args,start,onLine,env)=>{
    calls.push({args,env,prompt:start.prompt})
    if(args[0]==='--version') return {outcome:Promise.resolve({stdout:agent==='gemini'?'0.56.0':'1.2.27',exitCode:0}),cancel(){}}
    onLine(JSON.stringify(agent==='gemini'?{type:'message',role:'assistant',content:'text'}:{type:'text',part:{text:'text'}}))
    return {outcome:Promise.resolve({exitCode:0,stderr:''}),cancel(){}}
   }}
  })
  await assert.rejects(startFileWorker({agent,prompt:'test',cwd:os.tmpdir(),timeoutMs:5000,onProgress(){}}).done,/successful final answer/)
  assert.equal(calls.length,2);assert.equal(calls[0].prompt,'');assert.equal(calls[1].prompt,'test')
  assert.ok(agent==='gemini'?calls[1].env.GEMINI_CLI_SYSTEM_SETTINGS_PATH:calls[1].env.OPENCODE_CONFIG_CONTENT)
 }
})
test('cancellation during version probe never starts generation',async()=>{
 let finish,calls=0,cancels=0
 const {startFileWorker}=loadTs('electron/start-file-worker.ts',new Map(),{
  './agent-profiles':{detectBinary:()=> 'fixture'},
  './run-worker-process':{runWorkerProcess:()=>{calls++;return{outcome:new Promise(resolve=>finish=resolve),cancel(){cancels++}}}}
 })
 const handle=startFileWorker({agent:'gemini',prompt:'test',cwd:os.tmpdir(),timeoutMs:5000,onProgress(){}})
 handle.cancel();finish({stdout:'0.56.0',exitCode:0})
 await assert.rejects(handle.done,/cancelled/);assert.equal(calls,1);assert.equal(cancels,1)
})

test('process transport decodes split UTF-8, preserves final unterminated line and bounds tails',async()=>{
 const {runWorkerProcess}=loadTs('electron/run-worker-process.ts',new Map(),{'./agent-profiles':{executableCommand:(_binary,args)=>({file:process.execPath,args,shell:false})}})
 const lines=[]
 const script="const b=Buffer.from('??\\nlast');process.stdout.write(b.subarray(0,2));setTimeout(()=>process.stdout.write(b.subarray(2)),10);process.stderr.write('x'.repeat(70000));"
 const processRun=runWorkerProcess('node',['-e',script],{agent:'gemini',prompt:'',cwd:os.tmpdir(),timeoutMs:5000},line=>lines.push(line))
 const result=await processRun.outcome
 assert.equal(result.exitCode,0);assert.deepEqual(lines,['??','last']);assert.equal(result.stderr.length,64000)
 processRun.cancel() // already-finished children cannot be killed again
})
test('successful final events return an answer while nonzero exit always wins',async()=>{
 for(const agent of ['gemini','opencode']) for(const exitCode of [0,1]) {
  const {startFileWorker}=loadTs('electron/start-file-worker.ts',new Map(),{
   './agent-profiles':{detectBinary:()=> 'fixture'},
   './run-worker-process':{runWorkerProcess:(binary,args,start,onLine)=>{
    if(args[0]==='--version') return{outcome:Promise.resolve({stdout:agent==='gemini'?'0.56.0':'1.2.27',exitCode:0}),cancel(){}}
    const events=agent==='gemini'?[{type:'message',role:'assistant',content:'answer'},{type:'result',status:'success'}]:[{type:'text',part:{text:'answer'}},{type:'step_finish',part:{reason:'stop'}}]
    events.forEach(event=>onLine(JSON.stringify(event)))
    return{outcome:Promise.resolve({exitCode,stderr:'failure'}),cancel(){}}
   }}
  })
  const handle=startFileWorker({agent,prompt:'test',cwd:os.tmpdir(),timeoutMs:5000,onProgress(){}})
  if(exitCode) await assert.rejects(handle.done,/code 1/)
  else assert.equal((await handle.done).text,'answer')
 }
})
