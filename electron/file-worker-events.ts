export interface FileWorkerState { text: string; completed: boolean; error?: string; sessionId?: string }
export interface FileWorkerUpdate { state: FileWorkerState; progress?: string }
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' ? value as Record<string, unknown> : {}

export function decodeFileWorkerEvent(agent: 'gemini' | 'opencode', previous: FileWorkerState, event: Record<string, unknown>): FileWorkerUpdate {
  const state = { ...previous }
  const part = object(event.part)
  const sessionId = agent === 'gemini' ? event.session_id : event.sessionID
  if (typeof sessionId === 'string') state.sessionId = sessionId
  let progress: string | undefined
  if (agent === 'gemini') {
    if (event.type === 'message' && event.role === 'assistant' && typeof event.content === 'string') {
      state.text = event.delta === true ? state.text + event.content : event.content
      progress = event.content
    }
    if (event.type === 'result') {
      state.completed = event.status === 'success'
      if (!state.completed) state.error = String(object(event.error).message ?? 'Gemini did not finish successfully')
    }
    if (event.type === 'error' && event.severity !== 'warning') state.error = String(event.message ?? object(event.error).message ?? 'Gemini error')
    if (event.type === 'tool_use') progress = `[${String(event.tool_name ?? 'tool')}]`
  } else {
    if (event.type === 'text' && typeof part.text === 'string') { state.text += part.text; progress = part.text }
    if (event.type === 'step_finish') state.completed = part.reason === 'stop'
    if (event.type === 'error') state.error = String(object(object(event.error).data).message ?? object(event.error).name ?? 'OpenCode error')
    if (event.type === 'tool_use') progress = `[${String(part.tool ?? 'tool')}]`
  }
  if (state.text.length > 2_000_000) state.error = 'Worker result exceeds the 2 MB limit'
  state.text = state.text.slice(0, 2_000_000)
  return { state, progress }
}
