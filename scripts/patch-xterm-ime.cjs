const fs = require('node:fs')
const path = require('node:path')

const packageRoot = path.dirname(require.resolve('@xterm/xterm/package.json'))
const packageMetadata = JSON.parse(fs.readFileSync(path.join(packageRoot, 'package.json'), 'utf8'))
const runtimePath = path.join(packageRoot, 'lib', 'xterm.js')

if (packageMetadata.version !== '5.5.0') {
  throw new Error('Review the MoaCLI IME patch before using @xterm/xterm ' + packageMetadata.version)
}

// Each upgrade names its final form plus every earlier form it may replace,
// so the patch applies to a fresh install and to previously patched runtimes.
const upgrades = [
  { label: "compositionend listener passes the event", to: "\"compositionend\",(e=>this._compositionHelper.compositionend(e))", from: ["\"compositionend\",(()=>this._compositionHelper.compositionend())"] },
  { label: "compositionend records the committed text", to: "compositionend(e){this._lastCommitData=e&&\"string\"==typeof e.data?e.data:void 0,this._finalizeComposition(!0)}", from: ["compositionend(){this._finalizeComposition(!0)}"] },
  { label: "composition send bookkeeping fields", to: "this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=\"\",this._pendingCompositionSends=[],this._sentCompositionUpTo=0", from: ["this._isComposing=!1,this._isSendingComposition=!1,this._compositionPosition={start:0,end:0},this._dataAlreadySent=\"\""] },
  { label: "compositionstart clamps the sent offset", to: "compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._sentCompositionUpTo=Math.min(this._sentCompositionUpTo,this._compositionPosition.start),this._compositionView.textContent=\"\",this._dataAlreadySent=\"\",this._compositionView.classList.add(\"active\")}", from: ["compositionstart(){this._isComposing=!0,this._compositionPosition.start=this._textarea.value.length,this._compositionView.textContent=\"\",this._dataAlreadySent=\"\",this._compositionView.classList.add(\"active\")}"] },
  { label: "finalize prefers the IME-committed text", to: "_finalizeComposition(e){if(this._compositionView.classList.remove(\"active\"),this._isComposing=!1,e){const e={start:this._compositionPosition.start,end:this._compositionPosition.end},t=this._dataAlreadySent,c=this._lastCommitData;this._lastCommitData=void 0;const i=()=>{const s=this._pendingCompositionSends.indexOf(i);s>=0&&this._pendingCompositionSends.splice(s,1),e.start+=t.length;const r=this._compositionPosition.start>e.start?e.end:this._textarea.value.length,n=Math.max(e.start,this._sentCompositionUpTo),o=Math.max(n,r);let h=this._textarea.value.substring(n,o);this._sentCompositionUpTo=Math.max(this._sentCompositionUpTo,o),void 0!==c&&c!==h&&(h=c,this._sentCompositionUpTo=Math.max(this._sentCompositionUpTo,n+c.length)),this._isSendingComposition=this._pendingCompositionSends.length>0,h.length>0&&this._coreService.triggerDataEvent(h,!0)};this._pendingCompositionSends.push(i),this._isSendingComposition=!0,setTimeout((()=>{this._pendingCompositionSends.includes(i)&&i()}),0)}else{for(const e of this._pendingCompositionSends.splice(0,this._pendingCompositionSends.length))e();this._isSendingComposition=!1;const e=this._textarea.value,t=Math.max(this._compositionPosition.end,this._textarea.selectionEnd??this._compositionPosition.end),i=Math.max(this._compositionPosition.start,this._sentCompositionUpTo),s=Math.max(i,t),r=e.substring(i,s);this._sentCompositionUpTo=Math.max(this._sentCompositionUpTo,s),r.length>0&&this._coreService.triggerDataEvent(r,!0)}}_handleAnyTextareaChanges(){const e=this._textarea.value;setTimeout((()=>{if(!this._isComposing){const t=this._textarea.value;let i=0;for(;i<e.length&&i<t.length&&e[i]===t[i];)i++;let s=0;for(;s<e.length-i&&s<t.length-i&&e[e.length-1-s]===t[t.length-1-s];)s++;const r=e.slice(i,e.length-s),n=t.slice(i,t.length-s);this._dataAlreadySent=n;const o=a.C0.DEL.repeat(Array.from(r).length)+n;o.length>0&&this._coreService.triggerDataEvent(o,!0)}}),0)}", from: ["_finalizeComposition(e){if(this._compositionView.classList.remove(\"active\"),this._isComposing=!1,e){const e={start:this._compositionPosition.start,end:this._compositionPosition.end},t=this._dataAlreadySent,i=()=>{const s=this._pendingCompositionSends.indexOf(i);s>=0&&this._pendingCompositionSends.splice(s,1),e.start+=t.length;const r=this._compositionPosition.start>e.start?e.end:this._textarea.value.length,n=Math.max(e.start,this._sentCompositionUpTo),o=Math.max(n,r),h=this._textarea.value.substring(n,o);this._sentCompositionUpTo=Math.max(this._sentCompositionUpTo,o),this._isSendingComposition=this._pendingCompositionSends.length>0,h.length>0&&this._coreService.triggerDataEvent(h,!0)};this._pendingCompositionSends.push(i),this._isSendingComposition=!0,setTimeout((()=>{this._pendingCompositionSends.includes(i)&&i()}),0)}else{for(const e of this._pendingCompositionSends.splice(0,this._pendingCompositionSends.length))e();this._isSendingComposition=!1;const e=this._textarea.value,t=Math.max(this._compositionPosition.end,this._textarea.selectionEnd??this._compositionPosition.end),i=Math.max(this._compositionPosition.start,this._sentCompositionUpTo),s=Math.max(i,t),r=e.substring(i,s);this._sentCompositionUpTo=Math.max(this._sentCompositionUpTo,s),r.length>0&&this._coreService.triggerDataEvent(r,!0)}}_handleAnyTextareaChanges(){const e=this._textarea.value;setTimeout((()=>{if(!this._isComposing){const t=this._textarea.value;let i=0;for(;i<e.length&&i<t.length&&e[i]===t[i];)i++;let s=0;for(;s<e.length-i&&s<t.length-i&&e[e.length-1-s]===t[t.length-1-s];)s++;const r=e.slice(i,e.length-s),n=t.slice(i,t.length-s);this._dataAlreadySent=n;const o=a.C0.DEL.repeat(Array.from(r).length)+n;o.length>0&&this._coreService.triggerDataEvent(o,!0)}}),0)}", "_finalizeComposition(e){if(this._compositionView.classList.remove(\"active\"),this._isComposing=!1,e){const e={start:this._compositionPosition.start,end:this._compositionPosition.end};this._isSendingComposition=!0,setTimeout((()=>{if(this._isSendingComposition){let t;this._isSendingComposition=!1,e.start+=this._dataAlreadySent.length,t=this._isComposing?this._textarea.value.substring(e.start,e.end):this._textarea.value.substring(e.start),t.length>0&&this._coreService.triggerDataEvent(t,!0)}}),0)}else{this._isSendingComposition=!1;const e=this._textarea.value.substring(this._compositionPosition.start,this._compositionPosition.end);this._coreService.triggerDataEvent(e,!0)}}_handleAnyTextareaChanges(){const e=this._textarea.value;setTimeout((()=>{if(!this._isComposing){const t=this._textarea.value,i=t.replace(e,\"\");this._dataAlreadySent=i,t.length>e.length?this._coreService.triggerDataEvent(i,!0):t.length<e.length?this._coreService.triggerDataEvent(`${a.C0.DEL}`,!0):t.length===e.length&&t!==e&&this._coreService.triggerDataEvent(t,!0)}}),0)}"] },
]

let runtime = fs.readFileSync(runtimePath, 'utf8')
let changed = false

for (const { label, to, from } of upgrades) {
  if (runtime.includes(to)) continue
  const source = from.find((candidate) => runtime.includes(candidate))
  if (!source) throw new Error('IME patch step no longer matches the runtime: ' + label)
  runtime = runtime.replace(source, to)
  changed = true
}

if (changed) {
  fs.writeFileSync(runtimePath, runtime)
  console.log('Applied MoaCLI Korean IME reliability patch (v2) to @xterm/xterm 5.5.0')
} else {
  console.log('MoaCLI Korean IME reliability patch (v2) is already applied')
}
