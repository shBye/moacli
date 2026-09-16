import type { AgentAccount, DelegationTask } from './contracts'

export interface ReviewSource {
  sessionId: string
  historyKey: string
  title: string
  cwd: string
}

export interface ReviewSnapshot {
  id: string
  root: string
  head: string
  capturedAt: number
  files: string[]
  patch: string
  digest: string
}

export interface ReviewMetadata {
  role?: import('./agent-roles').AgentRoleId
  source: ReviewSource
  snapshot: ReviewSnapshot
  instructions: string
}

export interface StartReviewRequest {
  role?: import('./agent-roles').AgentRoleId
  snapshotId: string
  source: ReviewSource
  agent: 'claude' | 'codex'
  account?: AgentAccount
  instructions: string
}

export interface ReviewEntry {
  task: DelegationTask
  review: ReviewMetadata
  result: string
}

export interface ReviewFinding {
  title: string
  location: string
  body: string
}

export interface ReviewReport {
  summary: string
  findings: ReviewFinding[]
}
