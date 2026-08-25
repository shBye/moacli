export interface ConversationTimestamp {
  dateTime: string
  label: string
}

const pad = (value: number): string => String(value).padStart(2, '0')

export function formatConversationTimestamp(timestamp: number | undefined): ConversationTimestamp | null {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return null
  const date = new Date(timestamp)
  if (Number.isNaN(date.getTime())) return null
  return {
    dateTime: date.toISOString(),
    label: `${date.getFullYear()}.${pad(date.getMonth() + 1)}.${pad(date.getDate())} ${pad(date.getHours())}:${pad(date.getMinutes())}`,
  }
}

export function normalizeExternalConversationUrl(value: string | undefined): string | null {
  if (!value) return null
  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.href : null
  } catch {
    return null
  }
}
