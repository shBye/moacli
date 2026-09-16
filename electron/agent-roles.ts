export const AGENT_ROLE_IDS = ['reviewer', 'investigator', 'planner', 'designer'] as const
export type AgentRoleId = typeof AGENT_ROLE_IDS[number]

export const AGENT_ROLES: readonly { id: AgentRoleId; label: string; description: string; instruction: string }[] = [
  { id: 'reviewer', label: 'Code review', description: 'Find actionable defects and regressions.', instruction: 'Review correctness, regressions, and missing error handling. Report concrete defects with triggers and impact; avoid speculative issues.' },
  { id: 'investigator', label: 'Investigate', description: 'Trace a problem and explain its likely cause.', instruction: 'Investigate the reported behavior. Separate observations from hypotheses, trace likely causes, and propose the smallest checks that distinguish them. Do not claim a cause is proven without evidence.' },
  { id: 'planner', label: 'Plan changes', description: 'Identify what to change, where, and how to verify it.', instruction: 'Create a focused implementation plan. Identify affected files and responsibilities, ordered changes, dependencies, and concrete verification steps. Flag missing context instead of inventing APIs.' },
  { id: 'designer', label: 'UI feedback', description: 'Suggest concrete improvements to layout and interaction.', instruction: 'Assess UI structure, clarity, accessibility, and interaction using the supplied material. Propose specific component and style changes and explain their user benefit. Do not claim to have seen a screen when only source code is provided.' },
]

export function agentRole(id: AgentRoleId = 'reviewer') {
  return AGENT_ROLES.find((role) => role.id === id) ?? AGENT_ROLES[0]
}

export function roleTaskPrompt(prompt: string, role?: AgentRoleId): string {
  if (!role) return prompt
  return `Role: ${agentRole(role).label}\n${agentRole(role).instruction}\n\nTask:\n${prompt}`
}
