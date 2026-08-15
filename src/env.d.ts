/// <reference types="vite/client" />

import type { CliAgentApi } from '../electron/contracts'

declare global {
  interface Window {
    cliAgent: CliAgentApi
  }
}

export {}
