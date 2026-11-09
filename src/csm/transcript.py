"""Incremental reader for ~/.claude/projects/<slug>/<sessionId>.jsonl.

Transcripts grow without bound (tens of MB for a long session), so each file is
read once from the start and then tailed from the stored byte offset. All the
cost is in the first pass.

The format is Claude Code's own and carries no compatibility promise. Every
field access here tolerates absence: a shape change must leave a field blank,
never raise.
"""

import json
import os
import re
from collections import deque
from pathlib import Path

PROJECTS_DIR = Path.home() / ".claude" / "projects"

# These line types repeat the content of the assistant/user lines verbatim.
# Counting them would double every message and every token total.
DUPLICATE_TYPES = {"api-request", "api-request-blob", "api-request-shape"}

# Inbound messages arrive as a user line wrapped in one of two envelopes: a
# peer session uses <cross-session-message>, a subagent hand-back uses
# <agent-message>. The peer envelope carries the socket path in `from` and the
# readable name in `from-name`, so the name is preferred where it exists.
PEER_ENVELOPE = re.compile(
    r'<(?:cross-session|agent)-message from="([^"]+)"(?:[^>]*?from-name="([^"]+)")?')

MESSAGE_LIMIT = 300
BASH_LIMIT = 25
SUBAGENT_LIMIT = 20
FILE_MUTATION_TOOLS = {"Edit", "Write", "MultiEdit", "NotebookEdit"}
SUBAGENT_TOOLS = {"Agent", "Task"}

# An MCP tool is named mcp__<server>__<tool>; the server part is what the
# health check and the config files both refer to.
MCP_TOOL = re.compile(r"^mcp__([^_].*?)__")

# Context window per model. Not present in the transcript, so it is stated here;
# an unknown model falls back to the smaller window rather than overstating room.
CONTEXT_WINDOWS = (
    ("opus-5", 1_000_000),
    ("sonnet-5", 1_000_000),
    ("fable-5", 1_000_000),
    ("haiku-5", 1_000_000),
)
DEFAULT_WINDOW = 200_000


def context_window(model: str) -> int:
    for needle, size in CONTEXT_WINDOWS:
        if needle in (model or ""):
            return size
    return DEFAULT_WINDOW


def _text_of(content) -> str:
    if isinstance(content, str):
        return content
    if isinstance(content, list):
        parts = [b.get("text", "") for b in content
                 if isinstance(b, dict) and b.get("type") == "text"]
        return "\n".join(p for p in parts if p)
    return ""


class SessionTranscript:
    """Accumulated state for one session's transcript."""

    def __init__(self, session_id: str):
        self.session_id = session_id
        self.path: Path | None = None
        self.inode: int | None = None
        self.offset = 0
        self.model = ""
        self.calls = 0
        self.tokens = {"input": 0, "cache_write": 0, "cache_read": 0, "output": 0}
        self.context_tokens = 0
        self.seen_call_ids: set[str] = set()
        self.messages: deque = deque(maxlen=MESSAGE_LIMIT)
        self.bash: deque = deque(maxlen=BASH_LIMIT)
        self.last_text = ""
        self.mcp: dict[str, dict] = {}
        self.skills: dict[str, dict] = {}
        self.files_edited: dict[str, dict] = {}
        self.todos: list[dict] = []
        self.subagents: deque = deque(maxlen=SUBAGENT_LIMIT)

    def _locate(self) -> Path | None:
        if self.path and self.path.exists():
            return self.path
        for candidate in PROJECTS_DIR.glob(f"*/{self.session_id}.jsonl"):
            self.path = candidate
            return candidate
        return None

    def refresh(self) -> None:
        path = self._locate()
        if path is None:
            return
        try:
            stat = path.stat()
        except OSError:
            return
        # A rotated or truncated file invalidates the offset; start over.
        if self.inode is not None and (stat.st_ino != self.inode or stat.st_size < self.offset):
            self.__init__(self.session_id)
            path = self._locate()
            if path is None:
                return
        self.inode = stat.st_ino
        if stat.st_size == self.offset:
            return
        try:
            with path.open("r", encoding="utf-8", errors="replace") as fh:
                fh.seek(self.offset)
                for line in fh:
                    if not line.endswith("\n"):
                        break  # a half-written line; re-read it next pass
                    self.offset += len(line.encode("utf-8", errors="replace"))
                    self._consume(line)
        except OSError:
            return

    def _consume(self, line: str) -> None:
        try:
            entry = json.loads(line)
        except ValueError:
            return
        if not isinstance(entry, dict):
            return
        kind = entry.get("type")
        if kind in DUPLICATE_TYPES:
            return
        message = entry.get("message")
        message = message if isinstance(message, dict) else {}
        raw_stamp = entry.get("timestamp")
        stamp = str(raw_stamp) if raw_stamp is not None else ""
        if kind == "assistant":
            self._assistant(message, stamp)
        elif kind == "user":
            self._user(message, stamp)

    def _assistant(self, message: dict, stamp: str) -> None:
        self.model = str(message.get("model") or self.model)
        usage = message.get("usage")
        call_id = message.get("id")
        # One API call is written as several assistant lines; the id is what
        # makes the totals a count of calls rather than of lines.
        if isinstance(usage, dict) and call_id and call_id not in self.seen_call_ids:
            self.seen_call_ids.add(str(call_id))
            self.calls += 1
            got = lambda k: int(usage.get(k) or 0) if isinstance(usage.get(k), (int, float)) else 0
            self.tokens["input"] += got("input_tokens")
            self.tokens["cache_write"] += got("cache_creation_input_tokens")
            self.tokens["cache_read"] += got("cache_read_input_tokens")
            self.tokens["output"] += got("output_tokens")
            self.context_tokens = (
                got("input_tokens")
                + got("cache_creation_input_tokens")
                + got("cache_read_input_tokens")
            )
        content = message.get("content")
        if not isinstance(content, list):
            return
        for block in content:
            if not isinstance(block, dict):
                continue
            if block.get("type") == "text" and block.get("text"):
                self.last_text = str(block["text"])
            elif block.get("type") == "tool_use":
                self._tool_use(block, stamp)

    def _tool_use(self, block: dict, stamp: str) -> None:
        name = block.get("name")
        args = block.get("input")
        args = args if isinstance(args, dict) else {}
        served = MCP_TOOL.match(name or "")
        if served:
            self._tally(self.mcp, served.group(1), stamp)
        elif name == "Skill" and args.get("skill"):
            self._tally(self.skills, str(args["skill"]), stamp)
        if name == "SendMessage":
            self.messages.append({
                "direction": "out",
                "peer": str(args.get("to") or ""),
                "summary": str(args.get("summary") or ""),
                "text": str(args.get("message") or ""),
                "at": stamp,
            })
        elif name == "Bash":
            self.bash.append({
                "command": str(args.get("command") or ""),
                "description": str(args.get("description") or ""),
                "at": stamp,
            })
        elif name in FILE_MUTATION_TOOLS:
            raw_path = args.get("file_path") or args.get("notebook_path") or args.get("path")
            if raw_path:
                norm_path = os.path.normpath(str(raw_path))
                self._tally_file(norm_path, stamp)
        elif name == "TodoWrite":
            raw_todos = args.get("todos")
            if isinstance(raw_todos, list):
                self.todos = [
                    {
                        "content": str(t.get("content") or ""),
                        "status": str(t.get("status") or "pending"),
                    }
                    for t in raw_todos
                    if isinstance(t, dict) and t.get("content")
                ]
        elif name in SUBAGENT_TOOLS:
            desc = args.get("description") or args.get("prompt") or ""
            self.subagents.append({
                "type": str(args.get("subagent_type") or args.get("name") or "subagent"),
                "description": str(desc)[:160],
                "at": stamp,
            })

    def _tally_file(self, path_str: str, stamp: str) -> None:
        entry = self.files_edited.setdefault(
            path_str, {"path": path_str, "edits": 0, "last": ""}
        )
        entry["edits"] += 1
        entry["last"] = max(entry["last"], str(stamp or ""))

    @staticmethod
    def _tally(into: dict[str, dict], key: str, stamp: str) -> None:
        entry = into.setdefault(key, {"name": key, "calls": 0, "last": ""})
        entry["calls"] += 1
        entry["last"] = max(entry["last"], str(stamp or ""))

    def _user(self, message: dict, stamp: str) -> None:
        text = _text_of(message.get("content"))
        if not text:
            return
        found = PEER_ENVELOPE.search(text)
        if found:
            self.messages.append({
                "direction": "in",
                "peer": found.group(2) or found.group(1),
                "peerSocket": found.group(1),
                "summary": "",
                "text": text,
                "at": stamp,
            })


class TranscriptStore:
    """Keeps one SessionTranscript per session id across polls."""

    def __init__(self):
        self._by_session: dict[str, SessionTranscript] = {}

    def get(self, session_id: str) -> SessionTranscript:
        state = self._by_session.get(session_id)
        if state is None:
            state = SessionTranscript(session_id)
            self._by_session[session_id] = state
        state.refresh()
        return state

    def forget_except(self, session_ids: set[str]) -> None:
        for gone in set(self._by_session) - session_ids:
            del self._by_session[gone]
