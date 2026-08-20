# Local Conversation Search

MoaCLI indexes local Claude Code and Codex conversation messages so `Ctrl+K` can search message content instead of only filtering session metadata.

## User flow

1. MoaCLI discovers conversations from connected account configuration directories.
2. The main process incrementally indexes changed Claude and Codex files.
3. Typing at least two characters in the sidebar search box opens unified results.
4. Selecting a result opens the conversation and scrolls to the matching message.
5. The CLI remains stopped until the user explicitly selects the CLI tab.

## Storage

The index is stored at `conversation-search.sqlite` inside Electron's MoaCLI user-data directory. It contains:

- source identity, agent, account label, title, cwd, timestamps, and resume ID;
- user and assistant message text required for FTS5 search;
- file modification time and size used for incremental indexing.

The database uses WAL mode, schema versioning, transactions, and an FTS5 virtual table. Changed files are replaced atomically. Sources that disappear from the current history scan are removed from the index.

## Privacy and ownership

- Conversation source files are read-only; MoaCLI never edits or deletes them.
- OAuth tokens, API keys, passwords, and agent credential files are not indexed.
- The SQLite database stays on the local machine and is not uploaded by MoaCLI.
- Removing the search database does not affect original CLI conversations.

## Runtime behavior

Indexing runs in the Electron main process, parses JSONL sources in bounded UTF-8 chunks, and yields between source files so PTY and renderer events can continue. The UI reports discovered and processed file counts and provides a manual rebuild command.

The current MVP indexes the 30 most recent Claude conversations and 30 most recent Codex conversations per connected account, matching the existing Recent discovery limit. Gemini and OpenCode message indexing remain follow-up work.

## Native module packaging

`better-sqlite3` is rebuilt specifically for the Electron ABI during `npm install` and unpacked from ASAR in Windows packages. `node-pty` continues using its existing prebuilt binaries and is excluded from the forced rebuild target.
