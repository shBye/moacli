# Terminal scroll diagnostics

Version 0.1.32 automatically records bounded diagnostic metadata to investigate intermittent CLI scroll jumps. This is instrumentation, not a confirmed fix.

## Reporting a jump

1. Use the CLI normally. No special startup procedure is required.
2. If the CLI unexpectedly jumps upward, click **Save diagnostics** in the bottom status bar as soon as practical.
3. Save the JSON file and share it with the issue report. Mention which agent was running and whether output had just finished, an approval was accepted, or a tab was switched.

Recording continues locally; nothing is uploaded automatically. The button marks the current terminal positions before opening the save dialog. Canceling the dialog does not delete local recordings. Restarting the app retains rotated logs, but saving promptly gives the best context.

## Recorded information

- Anonymous terminal UUID, agent identifier, timestamps, sequence and dropped-event counts.
- Terminal dimensions, active buffer, cursor row, buffer viewport and DOM scroll positions, focus and active-tab state.
- Output character/batch counts, generic input/navigation/pointer events, erase/reset and buffer-switch controls.
- Application resize, reveal and scroll-restoration calls; periods of quiet output.
- App, Electron, Chromium, xterm and detected CLI version numbers.

Conversation text, commands, typed characters, session titles, project paths, account details and raw terminal output are not recorded. Quiet output is only a timing observation, not an authoritative agent completion event. Upward-jump markers can also reflect intentional scrolling and must be interpreted with surrounding events.

## Retention and cost

Files live in the application's user-data `terminal-diagnostics` directory. Recent events and incident context each use two rotating files capped at 2 MiB per file (up to 8 MiB total). Large upward movements preserve recent context plus up to two seconds of subsequent events. Export also includes the latest in-memory events and storage-error/drop indicators.

Collection is rate limited, output is sampled every 250 ms, and disk writes are asynchronous and queued with a bound. Sudden process termination can lose pending events. Multiple active sessions share retention capacity. Rotation eventually replaces old incidents; export soon after a problem.

The collector observes xterm without consuming escape sequences or changing scroll behavior. Unit tests cover validation, jump detection, retention, disk errors, cleanup and observational parser behavior.
