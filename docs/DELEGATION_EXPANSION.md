# Four-CLI worker expansion — design proposal

Status: implemented after agreement to proceed with the recommended file-tool scope.
Reviewed: 2026-09-17.

## Agreed scope

- Support Claude, Codex, Gemini and OpenCode as delegated workers.
- Exclude external API services and local HTTP providers.
- Offer model selection for Claude, Codex and Gemini; direct model ID entry for OpenCode.
- Preserve CLI default, saved defaults for automatic approvals, and a per-task override at manual approval.
- Keep the existing task queue, approval UI, cancellation, timeout and history workflow.

## Execution contract

Each CLI adapter owns argument construction, temporary configuration and its structured event decoder. Pure decoders return progress, session ID, final output or error; the process boundary owns spawn, bounded output buffering, UTF-8 decoding, timeout, cancellation and cleanup. EOF alone does not imply success: validate the exit status and the CLI's final result. Never run another CLI as a silent fallback.

Preserve existing Claude/Codex behavior. For Gemini/OpenCode, verify a supported installed version before launch. Reject unsupported policy capabilities with an actionable error instead of dropping restrictions. Do not modify the user's persistent CLI configuration or credentials.

### Agreed permission scope

1. Recommended: Gemini/OpenCode analysis allows project read/search tools only. Disable shell execution, writes, plan-to-edit transitions, delegation, MCP and hooks. Editing adds project file-edit tools, while shell commands/tests remain with the original agent. Snapshot review receives only its supplied snapshot and has no tools. This makes the new workers useful for analysis and patches but unable to run test commands themselves.
2. Allow shell execution for editing workers too. This improves independent testing, but requires an additional agreed isolation boundary: a CLI tool permission list alone is not an OS filesystem sandbox. Implementing that boundary broadens the scope.

Option 1 is implemented. Option 2 remains future work requiring separate agreement. Existing Claude/Codex worker policies are unchanged.

## Model selection

- Codex: query the installed app-server `model/list` protocol with initialization, pagination and a bounded timeout; no conversation or generation request.
- Claude: documented stable aliases are selectable; label them as CLI aliases, not an account-specific availability lookup.
- Gemini: provide a curated list of documented CLI models, labelled as presets rather than an account availability lookup. CLI default preserves native automatic selection.
- OpenCode: validate a directly entered provider/model ID.
- Always retain CLI default and an existing saved ID even if it is absent from a refreshed list. A failed catalog lookup must not silently replace a saved model.
- Extend the existing default-model record with empty Gemini/OpenCode defaults for legacy settings. Resolve/freeze overrides at approval as today. Record the requested model; do not claim an alias proves which model ran. Actual model reporting is not added in this release.

## Verification before completion

Test model migration, saved-ID preservation, each structured event decoder, fragmented UTF-8, error/exit combinations, cancellation and timeout cleanup. Verify restrictive arguments/configuration with fixtures and installed CLI capability checks. Run typecheck/build and inspect settings plus approval dialogs. Report unavailable live CLI verification explicitly; OpenCode was not installed on PATH. A separate official 1.2.27 executable verified the effective worker configuration without a generation request. Codex model/list and installed Gemini 0.56.0 version lookup were verified live. Paid generation was not part of release verification.

## Evidence

- Gemini headless Plan Mode automatically approves plan transitions and can switch to YOLO when leaving plan mode; `--approval-mode plan` alone is not a read-only guarantee: https://geminicli.com/docs/cli/plan-mode/
- Gemini structured headless output: https://geminicli.com/docs/cli/headless/
- Gemini policy rules: https://geminicli.com/docs/reference/policy-engine/
- OpenCode permissions, agent overrides and automatic approvals require explicit restrictions: https://opencode.ai/docs/permissions/
- OpenCode headless execution: https://opencode.ai/docs/cli/
- Codex model catalog: https://developers.openai.com/codex/app-server
- Claude model aliases: https://code.claude.com/docs/en/model-config

## Public GitHub access check

Unauthenticated HEAD requests returned HTTP 200 for the repository, v0.1.33 release and latest installer on 2026-09-17:

- https://github.com/shBye/moacli
- https://github.com/shBye/moacli/releases/tag/v0.1.33
- https://github.com/shBye/moacli/releases/latest/download/MoaCLI-Setup.exe

An independent web fetch also displayed the repository as Public without signing in. No transfer is indicated by these checks. This is a point-in-time accessibility check, not a guarantee for every network.

## Compatibility and limits

- Gemini workers require 0.56.x or newer 0.x; OpenCode workers require 1.2.27 or newer 1.x. Unknown/new major versions fail before generation.
- OpenCode workers use isolated configuration with native credential storage. User/project plugins, custom agents and custom provider configuration are not imported. CLI default is resolved in that isolated worker configuration; choose an explicit provider/model to pin a model.
- Gemini restrictions are process-local system settings; native authentication remains owned by Gemini. No persistent user settings are edited.
- Tool restrictions are CLI policies, not an OS security sandbox.
- Gemini/OpenCode can be workers called by Claude/Codex; automatic parent MCP registration remains Claude/Codex-only.

OpenCode workers refuse managed configuration and remote organization login configuration because these can override worker restrictions. Native CLI sessions are unaffected.
