import { WORKER_AGENTS } from '../src/features/delegation/model-policy'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import { tmpdir } from 'node:os'
import { z } from 'zod'
import { captureReviewSnapshot } from './review-snapshot'
import { buildReviewPrompt } from './review-prompt'
import type { DelegationTaskRegistry } from './delegation-tasks'
import type { ReviewSnapshot, StartReviewRequest } from './review-contracts'
import { AGENT_ROLE_IDS, agentRole } from './agent-roles'

export const reviewSourceSchema = z.object({
  sessionId: z.string().min(1).max(200), historyKey: z.string().max(2000),
  title: z.string().max(1000), cwd: z.string().min(1).max(4000),
})
const requestSchema = z.object({
  snapshotId: z.string().uuid(), source: reviewSourceSchema,
  agent: z.enum(WORKER_AGENTS), instructions: z.string().max(8000),
  role: z.enum(AGENT_ROLE_IDS).optional(),
  account: z.object({ id: z.string(), agentId: z.string(), email: z.string(), configDir: z.string(), detected: z.boolean().optional() }).optional(),
})

export class ReviewService {
  private readonly prepared = new Map<string, ReviewSnapshot>()
  async prepare(cwd: string): Promise<ReviewSnapshot> {
    const snapshot = await captureReviewSnapshot(cwd)
    this.prepared.set(snapshot.id, snapshot)
    while (this.prepared.size > 10) this.prepared.delete(this.prepared.keys().next().value!)
    return snapshot
  }

  async start(input: StartReviewRequest, registry: DelegationTaskRegistry): Promise<string> {
    const request = requestSchema.parse(input)
    const snapshot = this.prepared.get(request.snapshotId)
    if (!snapshot || Date.now() - snapshot.capturedAt > 15 * 60_000) throw new Error('The change preview expired. Refresh it before starting a review.')
    if (request.account && request.account.agentId !== request.agent) throw new Error('Choose an account for the selected reviewer.')
    const current = await captureReviewSnapshot(request.source.cwd)
    if (current.root !== snapshot.root || current.digest !== snapshot.digest) throw new Error('The project changed since the preview. Refresh the changes before starting.')
    // Run outside the project so project hooks, instructions, and MCP config are not discovered.
    const workerDirectory = join(tmpdir(), 'moacli-review-runs', snapshot.id)
    await mkdir(workerDirectory, { recursive: true })
    const review = { source: request.source, snapshot, instructions: request.instructions, role: request.role ?? 'reviewer' as const }
    this.prepared.delete(snapshot.id)
    const task = registry.create({
      agent: request.agent, cwd: workerDirectory, caller: agentRole(request.role).label,
      prompt: buildReviewPrompt(review), timeoutMs: 10 * 60_000, review,
    })
    try { registry.approve(task.id, request.account) }
    catch (error) { registry.cancel(task.id); throw error }
    return task.id
  }
}
