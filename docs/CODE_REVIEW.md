# Session code review

Open a coding session's **Tasks** tab, choose **Preview Git changes**, select a role and agent/account, add an optional focus, and choose **Run analysis**. The displayed session folder must be a Git repository; changing directories inside the terminal does not change this stored folder. This is a user-triggered run using the installed CLI's account; it may consume that account's usage allowance. This snapshot UI is analysis-only; general MCP tasks separately support editing under the user's approval settings. See [AGENT_TASKS.md](AGENT_TASKS.md) for direction and reasons.

The first version reviews all staged, unstaged, and untracked text changes across the Git repository against HEAD. It requires an initial commit. Binary changes, more than 100 files, and snapshots over 180 KB are rejected explicitly. The exact patch is shown before submission. Untracked files are included, so inspect the preview before sending it.

Preparation captures twice to detect concurrent edits. Start validates the preview again. After start, subsequent edits do not alter the saved snapshot. This detects common concurrent-edit races, but is not an atomic filesystem snapshot.

Workers receive the patch, filenames, task title and focus, not the original conversation or the full repository. The UI and prompt describe this limitation. Snapshot workers run in a separate temporary directory. Claude has built-in tools and MCP disabled and hooks disabled; Codex explicitly uses read-only sandboxing, ignores user configuration and rules, and disables shell execution and web search. This can differ from the model/provider preferences used in ordinary sessions. Unsupported CLI flags fail the task instead of falling back to broader permissions.

Review metadata and full results are stored in the existing delegation SQLite database. A review retains its runtime session ID and links to the native conversation ID when available. Reopening that native conversation restores associated reviews. Sessions that never obtain a native history ID cannot be associated automatically after an app restart. The view shows the latest 30 reviews per source. A new review captures new changes rather than retrying an old snapshot silently.

Structured findings can be selected to create an editable revision request. **Insert into CLI** pastes into the original running coding session without sending Enter. It is disabled while the CLI is stopped, starting, processing or requesting attention. Users can always copy the draft. Unstructured responses remain readable and can be used as a draft. Findings are never automatically marked resolved.

Verification: `node --test scripts/reviews.test.cjs` plus the existing event, terminal lifecycle, title and folder tests; `npm run typecheck`; `npm run build`. Live paid model reviews are not part of automated tests.
