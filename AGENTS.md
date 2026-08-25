# MoaCLI engineering rules

These rules apply to the entire repository.

## Architecture

- Organize code by feature. Keep app composition in `src/app`, reusable UI in `src/components`, domain features in `src/features`, external integrations in `electron` or explicit adapter modules, and cross-feature utilities in `src/shared`.
- Keep `App.tsx` as a composition root. It must not accumulate feature implementation, domain parsing, storage validation, drag calculations, or animation mechanics.
- Prefer a functional core and an imperative shell. Parsing, validation, sorting, mapping, state transitions, labels, and calculations must be pure functions. DOM, timers, storage, clipboard, IPC, PTY, filesystem, and notification work must live in clearly named boundary modules or hooks.
- An effectful module must own one kind of effect, expose the smallest useful interface, accept dependencies through parameters when practical, and return cleanup for every listener, timer, observer, animation, or subscription it creates.
- Do not hide mutable shared state in general-purpose helpers. If state is required, expose it through a narrowly scoped controller, hook, or store with explicit commands and immutable snapshots.

## Reuse and module design

- Extract shared policy and repeated behavior, not arbitrary one-line wrappers. A shared abstraction must have one stable responsibility and a name based on the behavior it provides.
- Keep domain types next to their feature and export only the types needed by consumers. Avoid duplicating structurally equivalent types across components.
- UI components receive data and callbacks through typed props. They must not read unrelated globals, local storage, Electron APIs, or another feature's refs directly.
- Prefer immutable inputs and return new values from state transition helpers. Do not mutate caller-owned arrays, maps, objects, or React state.
- Separate pure conversion functions from framework adapters so the pure functions can be tested without React, Electron, DOM, clocks, or random IDs.
- Keep files cohesive. Split a file when it owns more than one feature, contains reusable UI plus orchestration, or grows enough that its state/effects cannot be understood independently.

## Side effects

- Side effects are allowed only at system boundaries; they cannot be eliminated from an interactive terminal app. Make every boundary explicit with names such as `read`, `write`, `attach`, `start`, `stop`, `save`, or `notify`.
- Keep event registration and removal together. Async effects must ignore or cancel late results after disposal.
- Inject time, random ID generation, storage, and transport dependencies into logic that needs deterministic tests.
- Do not combine unrelated effects in one handler. Compose focused adapters at the feature or app boundary.

## Components and performance

- Components should render one coherent UI responsibility. Move business rules to pure feature modules and lifecycle behavior to focused hooks or adapters.
- Memoize only at measured or obvious boundaries. Keep props stable for expensive children such as terminals and long lists.
- Avoid layout reads followed by layout writes in loops. Batch measurements before writes, or use the shared layout-animation primitive.
- Animate `transform` and `opacity` on hot paths. Avoid continuous animation of layout properties such as width, height, top, or left.
- Never animate or transform the xterm surface during typing, IME composition, terminal resize, or streaming output.
- Long lists must use bounded rendering, memoized rows, or virtualization when their observed size warrants it.

## Motion

- Use the shared Motion provider, motion tokens, and reusable motion components. Do not add component-local duration/easing values when a shared token fits.
- Respect the operating system's reduced-motion preference globally.
- Use layout animations for discrete list reordering and mounting changes, not for live terminal output or window/sidebar resize.
- Prefer interruptible, transform-based animations. Keep interaction feedback short and subtle; perpetual animation is reserved for real progress/status indicators.
- Every animation must preserve keyboard behavior, focus, pointer interaction, and screen-reader semantics.

## Verification

- Add focused tests for extracted pure functions and state transitions when a test harness exists. Until then, keep their inputs/outputs serializable and independently callable.
- Run `npm run typecheck` and `npm run build` after structural or animation changes.
- Preserve unrelated user files and worktree changes. Do not stage the untracked `Microsoft/` directory.
