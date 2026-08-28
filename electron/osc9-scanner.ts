const MAX_OSC_CARRY_LENGTH = 4 * 1024
const OSC9_PREFIX = '\x1b]9;'

export interface Osc9ScanResult {
  messages: string[]
  carry: string
}

function partialOscPrefix(value: string): string {
  const maximum = Math.min(value.length, OSC9_PREFIX.length - 1)
  for (let length = maximum; length > 0; length -= 1) {
    const suffix = value.slice(-length)
    if (OSC9_PREFIX.startsWith(suffix)) return suffix
  }
  return ''
}

export function scanOsc9(data: string, previousCarry = ''): Osc9ScanResult {
  const combined = `${previousCarry}${data}`
  const messages: string[] = []
  let carry = ''
  let cursor = 0

  while (cursor < combined.length) {
    const start = combined.indexOf(OSC9_PREFIX, cursor)
    if (start < 0) {
      carry = partialOscPrefix(combined.slice(cursor))
      break
    }

    const bodyStart = start + OSC9_PREFIX.length
    const bellEnd = combined.indexOf('\x07', bodyStart)
    const stringEnd = combined.indexOf('\x1b\\', bodyStart)
    const end = bellEnd < 0 ? stringEnd : stringEnd < 0 ? bellEnd : Math.min(bellEnd, stringEnd)
    if (end < 0) {
      const partial = combined.slice(start)
      carry = partial.length <= MAX_OSC_CARRY_LENGTH ? partial : ''
      break
    }

    messages.push(combined.slice(bodyStart, end).trim() || 'terminal-notification')
    cursor = end + (end === bellEnd ? 1 : 2)
  }

  return { messages, carry }
}
