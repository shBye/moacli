# CLI event integration

Reviewed against the official documentation on 2026-09-16. The existing profile
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
| Codex `SessionStart` | ready | Clear setup attention; CLI ready |
| Codex `UserPromptSubmit` / `PostToolUse` | processing | Clear previous notification |
| Codex `PermissionRequest` | approval_required | Approval required |
| Codex `Stop` | response_completed | Response finished |
| Codex `Interrupt` | response_interrupted | Clear notification; never mark successful |
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

## Codex structured observer

Normal Codex terminals on 0.154.0+ install observer entries in the selected
account's `hooks.json` (otherwise `CODEX_HOME` / `~/.codex`). This is the tested
minimum for this adapter, not a claim about when every hook was introduced.
The installer appends missing handlers, preserves existing groups and metadata,
and leaves `config.toml` and `notify` untouched. A changed existing hooks file is
backed up before atomic replacement. Invalid JSON or hook maps are left intact;
installation failure falls back to OSC9 and is recorded in diagnostics.

On first use, open **`/hooks` in Codex and trust the MoaCLI observer entries**.
No trust-bypass flag or trust database edits are used. CLI permissions Full access
does not substitute for hook trust. Project/organization policies may prevent
non-managed hooks from running. A neutral `Status unconfirmed` header links the
diagnosis to `/hooks` through its tooltip; settings also explain this requirement.
Installing hooks does not generate an approval/attention notification. New code applies
to new or resumed terminals, not an already-running CLI process.

The stable command runs an app-owned relay under `userData/codex-observer`.
On Windows a CMD wrapper scopes `ELECTRON_RUN_AS_NODE=1` to the relay subprocess,
using MoaCLI's executable. No separately installed Node or Python is needed.
The current packaged target is Windows; the POSIX wrapper is not macOS release
validation. Commands are synchronous observers to retain event ordering, have
a three-second hook timeout and a 1.5-second relay deadline. The relay always
exits zero with neutral `{}` output; it never returns approval decisions or
continuation instructions. Without MoaCLI's session environment it is a no-op.

Only event name, session/turn identifiers, optional child identifier, start source
and tool name cross the loopback HTTP relay. Prompt, answer, transcript path, tool input
and command text are discarded. A process token plus a PTY identifier routes
events to a live registration. Released sessions, other session IDs, known child
events and mismatched/retired turn IDs cannot update the current turn. The
normalizer retains only known tool labels. Completed events are deduplicated;
continued tool activity allows a later Stop for the same turn. Stop means the
response reached a stop hook, not that all tasks succeeded: other hooks can
continue work, and subsequent tool activity returns the status to Processing.

Confirmed completion displays a check and Completed in the session header.
Opening a tab no longer clears a structured approval/input waiting status.
Codex Enter, including resume menus and slash commands, does not infer a model
turn or approve a waiting action. Structured events own these transitions;
after accepting approval, PostToolUse updates processing when the tool returns.
Interrupt returns the terminal to running with an interrupted detail, without a
success notification. OSC9 remains a generic fallback while processing; it
cannot overwrite a structured approval, completion or interruption outcome.

Diagnostics export includes a bounded 500-event in-memory attention trace:
installation, hook/OSC receipt, ignored/stale events, delivery and notification
suppression reason. It resets when MoaCLI exits and counts discarded records.
Renderer attention records reserve a bounded quota separate from output bursts;
their numeric values are ready=0, processing=1, approval=2, input=3, completed=4,
failed=5, interrupted=6 and generic attention=7. No raw OSC text is recorded.

## Codex limitations

`tui.notifications` supports event filtering, but OSC9 carries display text,
without a documented structured event discriminator. Matching English text or
guessing a turn ended from any terminal notification would misclassify approval
requests. The current adapter deliberately retains generic attention.

The external `notify` callback is not replaced. Hook receipt confirms delivery
for that hook, not that every observer entry is trusted; review all entries in
`/hooks`. This adapter does not claim structured coverage for every input prompt,
API error or external approval resolution. Remote approval additionally needs
request IDs and resolution acknowledgements; these observers are not a remote
approval protocol.

To remove the integration, close MoaCLI terminals, remove only the handlers whose
command targets `cli-agent-manager/codex-observer/observe.cmd` (or `observe.sh`)
from the relevant account's `hooks.json`, then remove that observer directory.
Preserve all other user hooks. Starting another eligible MoaCLI Codex terminal
installs missing observers again.

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

Run `node --test scripts/codex-hooks.test.cjs scripts/agent-events.test.cjs scripts/terminal-lifecycle.test.cjs scripts/terminal-diagnostics.test.cjs`,
`npm run typecheck`, and `npm run build`. HTTP tests use a real loopback server and
synthetic provider payloads and real CMD/PowerShell relay subprocesses; they do
not submit paid requests to a CLI provider. Installed CLI help was checked for
hook-trust support. Live approval/completion delivery after user hook trust must
still be verified in the installed build.
