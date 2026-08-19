# Notification Center Design

## Purpose

MoaCLI can keep up to ten CLI sessions alive at once. Notifications should help the user find a session that changed while it was not being viewed, without turning the application into a permanent activity log.

The notification model is therefore opt-in, ephemeral, and session-scoped.

## Product rules

- Global notifications are disabled by default.
- Events that occur while notifications are disabled are not stored or replayed later.
- Each runtime session can own at most one active notification.
- Selecting the related session acknowledges and removes its notification.
- Dismissing a notification does not close or modify the session.
- Closing a session does not create a completion notification.
- Raw terminal output and prompt text are never placed in notification bodies or persisted.
- Notification delivery failures must never interrupt PTY input, output, resize, or shutdown paths.

## Settings

The Settings dialog exposes:

```text
Notifications                         Off
  Desktop notifications              On
  Needs attention                    On
  Failed                             On
  Completed                          On
```

`Notifications` is the global switch and defaults to `Off`. Turning it off clears current active notifications and disables new in-app badges and Windows notifications.

`Desktop notifications` controls Windows notifications only. In-app notifications remain active when this option is disabled.

Each live session also has a mute control. A muted session does not create in-app or Windows notifications, but its normal runtime state remains visible.

## Event types and priority

```text
failed > needs_attention > account_changed > completed > info
```

The MVP produces `completed` and `failed` events from PTY lifecycle signals. Input-request detection and `account_changed` can be added later without changing the UI contract.

When a session already has an active notification:

- The same dedupe key is ignored.
- A higher-priority event replaces the current event.
- An equal-priority event refreshes the existing row only when it represents a new event generation.
- A lower-priority event is ignored.

Intentional stops use explicit reasons and do not generate notifications:

```text
user_close
idle_eviction
app_shutdown
```

Natural exit code `0` produces `completed`. A non-zero natural exit or start failure produces `failed`.

## Concurrent notifications

Concurrent events are represented at two levels.

### In the application

- The titlebar bell displays the total number of active session notifications.
- The panel displays one row per affected session.
- Rows are ordered by priority and then by newest occurrence.
- Each session row in the sidebar displays its own highest-priority notification marker.
- The maximum visible count is ten because MoaCLI supports at most ten runtime sessions.
- Multiple events from one session update its existing row instead of increasing the count.
- If start failures create more than ten distinct entries, the lowest-priority oldest row is replaced; a lower-priority incoming event is discarded instead.

Example:

```text
Bell 3

Failed          API migration       Codex
Needs attention Billing refactor    Claude Code
Completed       Test cleanup        Gemini CLI
```

### In Windows

Desktop delivery uses a short burst window to avoid several toast notifications appearing back to back.

- One event during the burst window produces one session-specific Windows notification.
- Two or more events during the burst window produce one grouped notification such as `3 sessions have new activity`.
- Clicking a session-specific notification activates that session's CLI tab.
- Clicking a grouped notification focuses MoaCLI and opens the notification panel.
- Every active event records whether desktop delivery already occurred, so it is not shown twice.

The initial burst window is 600 milliseconds.

## Active-session behavior

The renderer reports the active session and selected view to the Main process.

| State | Store active row | In-app badge | Windows notification |
| --- | :---: | :---: | :---: |
| Focused and viewing the same CLI session | No | No | No |
| Focused and viewing another session | Yes | Yes | No |
| Application is not focused | Yes | Yes | Yes |
| Desktop notifications disabled | Yes | Yes | No |
| Session muted | No | No | No |
| Global notifications disabled | No | No | No |

Activating a session switches it to the CLI view and acknowledges its active notification. Opening the notification panel alone does not acknowledge any row.

## Process ownership

The Main process is the single writer for notification state.

```text
PtyManager
  -> lifecycle event
    -> NotificationCenter
      -> active notification map
      -> renderer snapshot event
      -> Windows delivery burst queue
```

The renderer can send commands but cannot insert notification records directly:

- update settings
- dismiss one notification
- clear all notifications
- acknowledge a session
- mute or unmute a session
- update the active-session context

All renderer updates are emitted as complete, versioned snapshots. With a maximum of ten rows, snapshots are simpler and safer than reconciling partial mutations.

## Session and PTY identity

PTY IDs and runtime session IDs have different lifetimes and must remain separate.

```ts
interface StartPtyRequest {
  id: string // PTY ID
  sessionId: string
  agentId: string
  title: string
  account?: AgentAccount
  purpose?: 'session' | 'login'
}
```

The Main process keeps a runtime-only mapping from PTY ID to session metadata. Windows notification activation always routes by runtime session ID.

## State and persistence

Active notification rows remain in memory. Current MoaCLI sessions do not survive an application restart, so persisting their notification rows would produce actions that target nonexistent sessions.

Only global notification settings are persisted. Session mute state is runtime-only until session restoration introduces durable runtime session identities.

When session restoration is implemented, the notification repository can move behind the shared SQLite worker without changing the renderer API.

## Dedupe and backpressure

- PTY lifecycle callbacks enqueue small notification events and return immediately.
- Notification work is serialized independently of PTY output batching.
- The queue never stores raw PTY output.
- The active map is bounded by the ten-session runtime limit.
- A dedupe key identifies the session, event type, and event generation.
- Windows delivery drains the current burst in a single operation.

Future input-request adapters will track the last scanned PTY position and require new output after acknowledgment before raising another event.

## Failure handling

- Settings-file read failure falls back to the default disabled configuration.
- Settings-file write failure reports an IPC error but does not change PTY behavior.
- Unsupported Windows notifications leave the in-app notification intact.
- A Windows notification that targets a closed session opens the panel instead.
- Renderer reload requests a fresh snapshot from Main.
- Main-process shutdown cancels pending desktop delivery and stops PTYs without generating completion events.

## MVP acceptance criteria

- Notifications are off on first launch.
- Enabling notifications affects only future events.
- Ten sessions can exit concurrently without duplicate growth or ordering loss.
- A session contributes no more than one active row.
- Concurrent Windows events are grouped into one toast.
- A natural successful exit creates `completed` only when the session is not currently being viewed.
- A natural failed exit or start failure creates `failed`.
- User close, idle eviction, and application shutdown do not create notifications.
- Clicking a notification activates the correct CLI session and removes its row.
- Per-session mute suppresses future notifications for that session.
- Disabling the global setting clears active rows and suppresses all future delivery.
- Notification failures cannot block or terminate PTY processing.
