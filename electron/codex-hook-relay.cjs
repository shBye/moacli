// Standalone observer. Never print hook decisions, prompts, commands or errors.
const http = require('node:http')
const endpoint = process.env.MOACLI_CODEX_HOOK_ENDPOINT
const finish = () => { process.stdout.write('{}'); process.exit(0) }
if (!endpoint) finish()
let url
try {
  url = new URL(endpoint)
  if (url.protocol !== 'http:' || url.hostname !== '127.0.0.1' || !/^\/attention\/[a-f0-9-]+\/[a-f0-9-]+$/.test(url.pathname)) finish()
} catch { finish() }
const deadline = setTimeout(finish, 1500)
let input = ''
process.stdin.setEncoding('utf8')
process.stdin.on('error', finish)
process.stdin.on('data', chunk => {
  input += chunk
  if (input.length > 1024 * 1024) finish()
})
process.stdin.on('end', () => {
  try {
    const data = JSON.parse(input)
    if (!data || typeof data !== 'object' || Array.isArray(data)) return finish()
    const payload = {}
    for (const key of ['hook_event_name', 'session_id', 'turn_id', 'agent_id', 'tool_name', 'source']) {
      if (typeof data[key] === 'string' && data[key].length <= 256) payload[key] = data[key]
    }
    const body = JSON.stringify(payload)
    const request = http.request(url, { method: 'POST', headers: { 'Content-Type': 'application/json', 'Content-Length': Buffer.byteLength(body) } }, response => {
      response.resume()
      response.on('end', () => { clearTimeout(deadline); finish() })
      response.on('error', finish)
    })
    request.on('error', finish)
    request.end(body)
  } catch { finish() }
})
