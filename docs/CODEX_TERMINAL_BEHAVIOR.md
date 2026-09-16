# Codex terminal behavior

## Persisted permissions

Settings > CLI permissions offers CLI default and Full access. The setting is saved in the app user-data terminal-permissions.json file. The shipped default remains CLI default. Full access appends --dangerously-bypass-approvals-and-sandbox when launching or resuming a normal Codex terminal. It skips Codex sandboxing and execution approval checks; it does not override organization constraints or unrelated external service authorization.

Already-running terminals are not modified. Login processes, other CLIs, and delegated workers do not receive this flag. In-terminal /permissions changes are owned by Codex; MoaCLI does not parse the screen or automatically persist those choices. Choose the mode in MoaCLI settings to enforce it on later launches.

Full access is different from Approve for me / auto-review, which retains sandbox boundaries and delegates eligible approval decisions to a reviewer. During investigation, the matching turn_context recorded on-request, workspace-write and reviewer=user while the user reported Full access in the TUI. After ending that turn and receiving a new user message on September 16, 2026, the execution context changed to danger-full-access / never and ordinary commands succeeded without escalation. This confirms that the selection took effect by the next turn in this session. It does not establish that all Codex versions defer every permission change until the next turn. Turn-context records alone are not live permission telemetry.

## Scroll correction

Two supplied v0.1.32 diagnostics captured CSI 2J followed by CSI 3J. The normal buffer dropped from a bottom viewport above 1,000 lines to base=0/viewport=0. Redrawing restored the buffer but left the viewport at line 0 or near the top. This confirms a clear-scrollback/redraw sequence coincides with the jump; it does not assign sole responsibility to Codex or xterm.

The correction arms only for Codex CSI 3J when the active normal buffer was at the bottom. It follows the bottom during parsed output, once on the next animation frame and once after a short quiet period. A two-second hard limit bounds the correction. Wheel, pointer, touch and navigation keys cancel it. Hidden panes and users reading history do not arm it. Escape sequences are not consumed and content is not duplicated. Diagnostic events redraw-arm, redraw-follow and redraw-cancel identify the correction.

Tests cover split redraws, delayed viewport changes, reading history, user interruption, hidden panes, expiration and cleanup. A real xterm 5.5.0 Electron smoke test also replays 1,100 lines in multiple chunks.

## Approval notifications and completion status

The v0.1.32 adapter uses Codex OSC9 as generic attention, not a structured approval or completion event. The missing completion mapping is a confirmed implementation limitation. The supplied diagnostic exports contain no recorded attention events among the retained Codex events. Diagnostics are rate-limited, so this does not prove no event was emitted. A real ConPTY probe successfully passed OSC9, ruling out an unconditional transport strip in that probe only.

The launch enables tui.notifications, notification_method=osc9 and notification_condition=always. No permission override is added by this notification adapter. If no attention event reaches the renderer, Processing persists until another state transition. The user approved structured observer integration on September 16, 2026. The new implementation installs additive Codex hooks on normal terminal launch; first-use trust remains with the user in `/hooks`. See [CLI event integration](AGENT_EVENTS.md) for event mapping, installation, diagnostics and limitations.

The running Codex process was checked on September 16, 2026: all three notification overrides were present in its command line. A focused regression test feeds fragmented OSC9 through the scanner, registration bridge and notification center. It verifies that an event for a different session produces in-app attention even while the app is focused, maps to needs_attention, and does not copy the OSC message into notification content. This verifies the tested downstream path, not actual emission by Codex or delivery through every live process/IPC boundary.

The new diagnostics add a bounded process-lifetime attention trace and reserved renderer attention slots. They distinguish received hook/OSC signals, stale or suppressed signals and notification suppression decisions. The historical OSC9 disappearance has not been reproduced end to end; the structured path addresses the missing event distinction without claiming that historical transport failure is proven fixed. Live testing after installation and hook trust remains necessary.

Sources:
- https://developers.openai.com/codex/cli/reference
- https://developers.openai.com/codex/rules
- https://learn.chatgpt.com/docs/sandboxing/auto-review
