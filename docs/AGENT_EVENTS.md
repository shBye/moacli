# CLI event integration

Reviewed against the official documentation on 2026-09-08. The existing profile
gates remain Claude Code 2.1.235+ and Codex 0.148.0+; not every feature in the
latest documentation is available through the current terminal transport.

## Implemented mapping

| Provider input | Normalized event | Notification |
| --- | --- | --- |
| Claude `UserPromptSubmit` | processing | Clear the previous notification |
| Claude `PermissionRequest` | approval_required | Approval required; identify plan approval via `ExitPlanMode` |
| Claude `PermissionRequest` with `AskUserQuestion` | input_required | Your answer is needed |
| Claude `Elicitation` | input_required | Your answer is needed |
| Claude `Stop` | response_completed | Response finished |
| Claude `StopFailure` | response_failed | Response failed, with a recognized API error code |
| Codex OSC9 | attention | Session needs attention |
| PTY process exit | completed / failed | Process outcome, separate from response completion |

Claude's `Stop` means the main agent finished responding, not that all requested
work or background tasks succeeded. Other Stop hooks may continue the agent.
It does not represent a user interrupt. `StopFailure` reports API errors, not
every failed shell command. Tool failures can be recovered within the same turn.

The observer returns an empty JSON object. It never approves, rejects, rewrites,
or blocks requests. It does not copy command arguments, prompts, full answers,
or arbitrary error details into notifications. Unknown errors display as
`unknown`; unknown hook events and child-agent hooks are ignored.

`prompt_id` associates Claude events with user prompts. Completed/failed events
are deduplicated per prompt and outcome; events for recently retired prompts
and released PTYs cannot change current state. The recent-prompt window is
bounded to 32 IDs. Events without a prompt ID cannot provide that ordering
guarantee. Approval events without a stable request ID are not guessed to be
duplicates: two similar commands can be separate approval requests.

Approvals and input requests have separate settings. Older settings inherit
their existing `needsAttention` preference during migration. A new outcome
replaces a previous higher-priority alert for the same session, including when
the new category is disabled. Display priority orders different sessions; it
does not freeze stale state within one session.

## Codex limitations and next integration step

`tui.notifications` supports event filtering, but OSC9 carries display text,
without a documented structured event discriminator. Matching English text or
guessing a turn ended from any terminal notification would misclassify approval
requests. The current adapter deliberately retains generic attention.

The documented external `notify` callback supplies structured JSON for
`agent-turn-complete` only. Adding it requires a relay and deliberate composition
with any existing user `notify` command; silently replacing it would discard the
user's integration. Native Codex hooks offer `PermissionRequest`, `Stop`,
`UserPromptSubmit`, and `Interrupt`, but non-managed hook definitions must be
reviewed and trusted. This change does not install or auto-trust Codex hooks.

An opt-in structured Codex adapter should verify the installed version, preserve
existing hooks/notify commands, expose whether its hooks are trusted, and retain
OSC9 as a fallback. Remote approval additionally needs request IDs and resolution
acknowledgements; these attention signals are not an approval protocol.

## Sources

- [Claude Code hooks reference](https://code.claude.com/docs/en/hooks):
  common fields, PermissionRequest, Elicitation, Stop, StopFailure, HTTP responses.
- [Codex advanced configuration](https://developers.openai.com/codex/config-advanced):
  `notify` JSON and its distinction from TUI notifications.
- [Codex configuration reference](https://developers.openai.com/codex/config-reference):
  terminal notification settings.
- [Codex hooks](https://developers.openai.com/codex/hooks): supported events,
  configuration discovery, hook trust, and execution semantics.

## Verification

Run `node --test scripts/agent-events.test.cjs scripts/terminal-lifecycle.test.cjs`,
`npm run typecheck`, and `npm run build`. HTTP tests use a real loopback server and
synthetic provider payloads; they do not submit paid requests to a CLI provider.
