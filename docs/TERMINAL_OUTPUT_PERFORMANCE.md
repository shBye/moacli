# Terminal output and Korean input responsiveness

## Agreed scope

Optimize the existing shared Electron renderer before considering separate
renderer processes. CLI/PTY processes remain in the PTY utility process. Keep
the existing xterm Korean composition commit patch; this change reduces work
competing with input rather than changing the committed text.

## Output path

`PTY → PtyOutputBuffer → MessagePort → TerminalOutputScheduler → xterm.write`

After xterm's write callback reports parsing complete, the renderer acknowledges
the cumulative stream offset over the same port. Both ends count **UTF-16 code
units**, not UTF-8 bytes. Partial acknowledgements correspond to the exact prefix
parsed. Duplicate, stale, non-integer and beyond-sent acknowledgements are ignored.

- Each PTY can have at most 64 Ki code units sent but unacknowledged. Host batches
  remain at most 16 Ki, with an 8 ms host flush interval.
- At a total queued plus unacknowledged backlog of 256 Ki, pause that PTY's output
  socket. Resume at 64 Ki or below. This is backpressure, not output truncation.
  A single incoming chunk can overshoot the high watermark; OS/CLI buffers are
  outside this accounting. Sustained overload can slow the producing CLI.
- One bounded xterm write is pending across mounted terminals. The active terminal
  gets priority; after four foreground slices, service a waiting background
  terminal. Background terminals rotate fairly.
- Slices are at most 8 Ki code units, reduced to 4 Ki for background terminals
  during the 120 ms after keyboard/composition activity. A tab activation wakes
  scheduling without flushing its entire backlog at once.
- A MessageChannel task separates each slice, allowing input and rendering tasks
  to run between parses. This avoids nested timer clamping that made an initial
  setTimeout-based prototype excessively slow. The channel closes when the last
  terminal is disposed and is created lazily if another terminal opens.
- Normal process exit is delivered after all preceding output is acknowledged.
  Explicit stop discards that stopped terminal's remaining queue and releases a
  paused socket before killing it. Late callbacks cannot acknowledge another
  terminal's data.
- A closed/replaced renderer port stops its old PTYs: their xterm buffers no
  longer exist and cannot acknowledge output. Transparent renderer reload and
  live-terminal reattachment are not implemented by this change.

## Input and diagnostics

Keyboard/composition events inform the output scheduler. The IME composition
commit implementation in `scripts/patch-xterm-ime.cjs` is unchanged.

The post-composition repaint covers the visible cursor row and adjacent rows,
instead of the whole viewport. Hidden terminals do not request that repaint or
startup scroll-to-bottom updates.

Diagnostic key, scroll and ANSI parser callbacks use cached DOM geometry. Only
the visible viewport samples geometry at the existing 250 ms diagnostic interval.
Buffer positions are still read when recording an event; cached DOM geometry may
lag by one interval. Diagnostics continue to exclude typed text and raw output.

## Verification (2026-09-17)

- 48 focused tests pass across terminal output/lifecycle/diagnostics, agent events
  and Codex hooks. Coverage includes Unicode preservation, exact cumulative
  offsets, credit exhaustion, pause/resume, fairness, parser callback ordering,
  stop/disposal, renderer port loss, and absence of geometry reads in input/parser
  callbacks.
- Typecheck and production build pass.
- A real Windows PTY smoke run emitted 1,128,040 code units. Received and parsed
  counts matched, the final marker was present, and the child exited with code 0.
- An isolated Electron 33.3.1 / xterm 5.5.0 synthetic comparison used one visible
  terminal and four hidden terminals, each receiving 150,000 lines. A 16 ms timer
  represented competing UI events; it continued briefly after output completion
  to include the final blocking interval. Two baseline/new pairs measured:

  | Mode | Total output time | Maximum timer lateness |
  | --- | ---: | ---: |
  | Prior bulk writes, run 1 | 1,816 ms | 1,547 ms |
  | Bounded shared scheduler, run 1 | 4,046 ms | 118 ms |
  | Prior bulk writes, run 2 | 3,086 ms | 2,826 ms |
  | Bounded shared scheduler, run 2 | 5,006 ms | 92 ms |

  All four terminal final markers survived every run. This intentionally extreme
  output workload demonstrates the throughput/responsiveness tradeoff, not a
  guaranteed latency target. It measures event-loop availability, not Windows IME
  keystroke-to-pixel latency; it does not reproduce all app/CLI/hook workloads.

For user validation, keep one or more sessions generating output and type Korean
in another terminal; also switch tabs, submit a long composition, stop a streaming
session, and check the final output. Remaining delay can come from CPU saturation,
active CLI redraws, other renderer work, or Windows IME itself. Separate renderer
processes remain a future design decision if measured residual contention warrants
their memory and focus-management costs.

Reference: [xterm flow control guidance](https://xtermjs.org/docs/guides/flowcontrol/).
