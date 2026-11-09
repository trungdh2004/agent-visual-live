# claude-session-monitor

Live dashboard for the Claude Code sessions running on this machine. Reads only;
the one thing it can change is which tmux pane your terminal shows.

```sh
./run.sh          # http://localhost:4602 , Ctrl-C stops it
```

## What it shows

| | |
|---|---|
| Fleets | sessions grouped by the outermost git root of their cwd; a submodule joins its superrepo |
| Rows | a session nobody messages sits on the top row, everything it messages sits below |
| Wires | one per pair that exchanged messages; direction is who opened the conversation, not who spoke last |
| `điều phối` | this session has sent to another live session |
| Red card | `status: waiting` - the session is blocked on a prompt only you can answer (updates tab title/favicon and triggers optional audio/desktop alert) |
| Ghost card (`Đã đóng`) | recently exited session (within 30m or connected by a message wire) kept so its conversation threads remain inspectable |
| Click a card | resizable split-view inspector: Overview (Git branch/dirty, Todos, Context & Tokens, Edited files & Collision warnings, Subagents, MCP/Skills), Live Terminal (`tmux capture-pane`), Messages, and recent Bash calls |
| Click a wire | the full thread, both halves, newest first |
| Chips on a card | Git branch (`⎇`), TodoWrite progress (`☑`), MCP/Skill summary, and concurrent file-edit collision warnings (`⚠`) |
| `công cụ` toggle | a row of every MCP server and skill the fleet reaches, wired to the sessions that called it |
| Tool state | `đang kết nối` / `cần đăng nhập` / `hỏng`, from `claude mcp list` |
| Top bar | 5-hour and 7-day rate-limit windows, and `kiểm tra MCP` to re-run the health check |

## Where the data comes from

| Shown | Source |
|---|---|
| Sessions, status, `blockedOn`, tmux pane | `~/.claude/sessions/<pid>.json`, polled every 2s |
| Tokens, context, messages, Bash calls | `~/.claude/projects/<slug>/<sessionId>.jsonl`, tailed from a byte offset |
| Rate-limit windows | `api.anthropic.com/api/oauth/usage` with the token in `~/.claude/.credentials.json` |
| Fleet grouping | `git rev-parse --show-superproject-working-tree`, walked to the top |
| Jump to pane | `tmux select-window` / `select-pane` / `switch-client` |
| MCP configured | `~/.claude.json` global and per-cwd `mcpServers`, plus any `.mcp.json` |
| MCP/skill used | `tool_use` names in the transcript: `mcp__<server>__<tool>` and `Skill` |
| MCP connected | `claude mcp list`, run per working directory every 5 minutes |

The transcript format is Claude Code's own and carries no compatibility promise,
so every field is read defensively: a shape change leaves a cell blank rather
than raising.

## Limits

- Runs as the user who owns the sessions; the files are mode 600.
- A session that has exited is retained as a dashed Ghost Node (`Đã đóng`) if it exited within the last 30 minutes or exchanged messages with another session within the 2-hour registry TTL; older exited sessions disappear from the graph even though their transcripts remain on disk.
- `status` is a snapshot written on state changes, not a stream. The panel shows
  how old it is.
- The jump button needs the session to have started inside tmux; the registry
  records the pane only then.
- Approving a permission prompt still happens in the session's own window. This
  dashboard points you at it and stops there.
- The MCP health check starts every configured server, so it runs on a timer
  (5 minutes per working directory) and never on a page load. A server whose
  name the check has not reported yet shows as `chưa kiểm tra`.
- The rate-limit endpoint rate-limits its own callers. On a 429 the last good
  reading is shown, cached in `~/.cache/claude-session-monitor/usage.json`.
# agent-visual-live
