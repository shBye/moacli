/// <reference types="vite/client" />

import type { CliAgentApi } from '../electron/contracts'

declare global {
  interface LocalFontData {
    family: string
    fullName: string
    postscriptName: string
    style: string
  }

  interface Window {
    cliAgent: CliAgentApi
    queryLocalFonts?: () => Promise<LocalFontData[]>
  }
}

export {}
