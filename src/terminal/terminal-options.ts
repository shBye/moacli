import type { ITerminalOptions } from '@xterm/xterm'

const TERMINAL_SCROLLBACK = 10000

export interface TerminalAppearance {
  background: string
  cursorColor: string
  fontFamily: string
  fontSize: number
  foreground: string
}

export function createTerminalOptions(
  appearance: Readonly<TerminalAppearance>,
  cursorBlink: boolean,
): ITerminalOptions {
  return {
    cursorBlink,
    cursorStyle: 'bar',
    fontFamily: appearance.fontFamily,
    fontSize: appearance.fontSize,
    lineHeight: 1.3,
    scrollback: TERMINAL_SCROLLBACK,
    allowTransparency: false,
    allowProposedApi: false,
    theme: {
      background: appearance.background,
      foreground: appearance.foreground,
      cursor: appearance.cursorColor,
      cursorAccent: '#111315',
      selectionBackground: '#36515E',
      black: '#111315',
      red: '#F87171',
      green: '#6EE7B7',
      yellow: '#FBBF24',
      blue: '#7DD3FC',
      magenta: '#C4B5FD',
      cyan: '#67E8F9',
      white: '#E7E9EA',
    },
  }
}
