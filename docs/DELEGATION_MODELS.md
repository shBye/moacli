# Delegation model selection

Settings > Delegation contains independent Claude and Codex default worker models. Choose CLI default or enter an explicit model ID. Changes apply to subsequent approvals. Automatic approvals and automatic fallback retries use this setting; MCP callers cannot supply their own model override.

The manual approval dialog shows the resolved default for the selected account and allows a model change for that task only. A concrete model ID is fixed at approval time, passed with --model, and retained in task history. Changing the default while a worker is queued does not replace that ID. Blank CLI defaults are resolved by the CLI at startup. Displayed model IDs are requested models, not proof of the model ultimately selected by provider policy or aliases.

Codex workers still ignore general user configuration. Only the model is read from the selected CODEX_HOME/config.toml, including the selected legacy inline profile or modern profile file. No permissions, hooks, providers or MCP definitions are copied. Custom provider configuration is outside this feature. Invalid/unreadable model configuration stops approval with an error instead of silently choosing another model. An explicit model avoids config lookup.

Claude defaults check ANTHROPIC_MODEL and the selected account's user settings.json model. If absent, Claude resolves its own default, environment defaults and managed settings at startup. Explicit model IDs are passed through to the CLI; availability is not guessed or guaranteed.

Tests: scripts/worker-models.test.cjs and scripts/delegation-tasks.test.cjs. The latter runs under Electron's Node mode to match the SQLite ABI.

Sources checked September 16, 2026:
- https://developers.openai.com/codex/config-reference
- https://developers.openai.com/codex/cli/reference
- https://code.claude.com/docs/en/model-config
