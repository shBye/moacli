export function agentMonogram(agentId: string): string {
  return ({ powershell: 'PS', claude: 'C', codex: 'X', gemini: 'G', opencode: 'O' } as Record<string, string>)[agentId]
    ?? agentId.slice(0, 2).toUpperCase()
}

export function contrastColor(background: string): string {
  const channels = [1, 3, 5].map((offset) => Number.parseInt(background.slice(offset, offset + 2), 16) / 255)
  const linear = channels.map((channel) => channel <= 0.04045 ? channel / 12.92 : ((channel + 0.055) / 1.055) ** 2.4)
  const luminance = 0.2126 * linear[0] + 0.7152 * linear[1] + 0.0722 * linear[2]
  return luminance > 0.42 ? '#111418' : '#ffffff'
}
