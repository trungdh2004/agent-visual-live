"""Antigravity IDE & CLI telemetry adapter (100% read-only).

Reads:
- Live presence locks held in `/proc/*/fd/*` pointing to `~/.gemini/antigravity/presence/<id>.lock`
- Conversation metadata & subagent hierarchy from `~/.gemini/antigravity/conversation_summaries.db` (mode=ro)
- Incremental JSONL transcripts & markdown artifacts under `~/.gemini/antigravity/brain/<id>/`
"""

import contextlib
import json
import os
import re
import sqlite3
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path
from urllib.parse import unquote, urlparse

ANTIGRAVITY_DIR = Path.home() / ".gemini" / "antigravity"
DEFAULT_DB_PATH = ANTIGRAVITY_DIR / "conversation_summaries.db"
DEFAULT_BRAIN_DIR = ANTIGRAVITY_DIR / "brain"
DEFAULT_PRESENCE_DIR = ANTIGRAVITY_DIR / "presence"
RECENT_TTL_SECONDS = 7200.0

SYS_MSG_RE = re.compile(
    r"\[Message\]\s+timestamp=(?P<ts>\S+)\s+sender=(?P<sender>\S+)\s+priority=\S+\s+content=(?P<body>.*?)\s*</SYSTEM_MESSAGE>",
    re.DOTALL,
)
EXIT_CODE_RE = re.compile(r"Command exited with code\s+(-?\d+)")


def _safe_int(val, default: int = 0) -> int:
    try:
        return int(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def _unquote_arg(val) -> str:
    if val is None:
        return ""
    s = str(val).strip()
    if len(s) >= 2 and s[0] == '"' and s[-1] == '"':
        try:
            parsed = json.loads(s)
            if isinstance(parsed, str):
                return parsed
        except ValueError:
            return s[1:-1]
    return s


def _parse_iso_epoch(raw: str | None) -> float:
    if not raw or not isinstance(raw, str):
        return 0.0
    text = raw.strip()
    m = re.match(r"^(\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2})(?:\.(\d+))?(Z|[+-]\d{2}:\d{2})?$", text)
    if m:
        base, frac, tz = m.groups()
        frac_part = f".{frac[:6].ljust(6, '0')}" if frac else ""
        tz_part = "+00:00" if tz == "Z" else (tz or "+00:00")
        try:
            return datetime.fromisoformat(f"{base}{frac_part}{tz_part}").timestamp()
        except ValueError:
            pass
    try:
        return datetime.fromisoformat(text.replace("Z", "+00:00")).timestamp()
    except ValueError:
        return 0.0


def _workspace_to_cwd(workspace_uris_raw: str | None) -> str:
    if not workspace_uris_raw:
        return ""
    try:
        uris = json.loads(workspace_uris_raw)
    except (ValueError, TypeError):
        return ""
    if not isinstance(uris, list) or not uris:
        return ""
    first = str(uris[0] or "")
    if first.startswith("file://"):
        parsed = urlparse(first)
        return unquote(parsed.path)
    return first


def detect_live_locks(presence_dir: Path = DEFAULT_PRESENCE_DIR) -> set[str]:
    """Scan `/proc/[0-9]*/fd/*` symlinks for open locks in `~/.gemini/antigravity/presence/*.lock`."""
    locked_ids: set[str] = set()
    prefix = str(presence_dir) + "/"
    proc = Path("/proc")
    if not proc.is_dir():
        return locked_ids
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        fd_dir = entry / "fd"
        try:
            for fd in fd_dir.iterdir():
                try:
                    target = os.readlink(fd)
                except OSError:
                    continue
                if target.startswith(prefix) and target.endswith(".lock"):
                    cid = Path(target).stem
                    if cid:
                        locked_ids.add(cid)
        except OSError:
            continue
    return locked_ids


class _BrainTranscriptCache:
    """Incremental reader for `~/.gemini/antigravity/brain/<id>/.system_generated/logs/transcript.jsonl`."""

    def __init__(self):
        self._entries: dict[Path, dict] = {}

    def read(self, brain_folder: Path) -> dict:
        transcript_path = brain_folder / ".system_generated" / "logs" / "transcript.jsonl"
        full_transcript_path = brain_folder / ".system_generated" / "logs" / "transcript_full.jsonl"
        state = self._entries.get(transcript_path)
        try:
            size = transcript_path.stat().st_size if transcript_path.is_file() else -1
        except OSError:
            size = -1
        try:
            full_size = full_transcript_path.stat().st_size if full_transcript_path.is_file() else max(0, size)
        except OSError:
            full_size = max(0, size)

        if state is None or size < state["offset"]:
            state = {
                "offset": 0,
                "files_edited": {},
                "bash": deque(maxlen=20),
                "messages": [],
                "subagents": [],
                "last_text": "",
                "last_user_text": "",
                "waiting_question": False,
                "calls": 0,
                "input_chars": 0,
                "output_chars": 0,
            }
            self._entries[transcript_path] = state

        if size > state["offset"] and transcript_path.is_file():
            try:
                with transcript_path.open("rb") as fh:
                    fh.seek(state["offset"])
                    chunk = fh.read()
                last_nl = chunk.rfind(b"\n")
                if last_nl != -1:
                    complete = chunk[: last_nl + 1]
                    state["offset"] += last_nl + 1
                    for raw_line in complete.decode("utf-8", errors="replace").splitlines():
                        self._consume_line(state, raw_line.strip())
            except OSError:
                pass

        artifacts = []
        if brain_folder.is_dir():
            try:
                for md in sorted(brain_folder.glob("*.md")):
                    if md.is_file():
                        st = md.stat()
                        artifacts.append({
                            "name": md.name,
                            "path": str(md),
                            "updatedAt": int(st.st_mtime * 1000),
                        })
            except OSError:
                pass

        return {
            "files_edited": state["files_edited"],
            "bash": list(state["bash"]),
            "messages": list(state["messages"]),
            "subagents": list(state["subagents"]),
            "last_text": state["last_text"],
            "last_user_text": state["last_user_text"],
            "waiting_question": state["waiting_question"],
            "calls": state["calls"],
            "input_chars": state["input_chars"],
            "output_chars": state["output_chars"],
            "full_bytes": full_size,
            "artifacts": artifacts,
        }

    @staticmethod
    def _consume_line(state: dict, line: str) -> None:
        if not line:
            return
        try:
            step = json.loads(line)
        except ValueError:
            return
        if not isinstance(step, dict):
            return
        stype = str(step.get("type") or "")
        stamp = str(step.get("created_at") or "")
        content = str(step.get("content") or "")

        if stype == "SYSTEM_MESSAGE":
            state["input_chars"] += len(content)
            m = SYS_MSG_RE.search(content)
            if m:
                sender = m.group("sender").strip()
                body = m.group("body").strip()
                ts = m.group("ts").strip() or stamp
                state["messages"].append({
                    "direction": "in",
                    "peer": sender,
                    "peerSocket": "",
                    "summary": "Subagent Task Prompt",
                    "text": body,
                    "at": ts,
                })
        elif stype == "USER_INPUT":
            state["input_chars"] += len(content)
            state["waiting_question"] = False
            if content.strip():
                state["last_user_text"] = content.strip()
        elif stype == "GENERIC":
            state["input_chars"] += len(content)
            # Tool output step: check if it contains command exit code for the most recent bash command
            m = EXIT_CODE_RE.search(content)
            if m and state["bash"]:
                state["bash"][-1]["exitCode"] = _safe_int(m.group(1), 0)
        elif stype == "PLANNER_RESPONSE":
            state["calls"] += 1
            state["waiting_question"] = False
            thinking = str(step.get("thinking") or "")
            state["output_chars"] += len(content) + len(thinking) + len(line) // 3
            if content.strip() and content.strip() != "None":
                state["last_text"] = content.strip()
            for tc in step.get("tool_calls") or []:
                if not isinstance(tc, dict):
                    continue
                tname = str(tc.get("name") or "")
                args = tc.get("args") or tc.get("arguments") or {}
                if isinstance(args, str):
                    try:
                        args = json.loads(args)
                    except ValueError:
                        args = {}
                if not isinstance(args, dict):
                    args = {}

                if tname in ("edit_file", "write_file"):
                    fpath = _unquote_arg(args.get("Path") or args.get("TargetFile") or args.get("path"))
                    if fpath:
                        slot = state["files_edited"].setdefault(fpath, {"path": fpath, "edits": 0, "last": ""})
                        slot["edits"] += 1
                        slot["last"] = max(slot["last"], stamp)
                elif tname == "run_command":
                    cmd = _unquote_arg(args.get("CommandLine") or args.get("command"))
                    summary = _unquote_arg(args.get("toolSummary") or args.get("description"))
                    if cmd:
                        state["bash"].append({
                            "command": cmd,
                            "description": summary,
                            "exitCode": None,
                            "at": stamp,
                        })
                elif tname == "invoke_subagent":
                    role = _unquote_arg(args.get("Role"))
                    sub_type = _unquote_arg(args.get("TypeName")) or "subagent"
                    prompt = _unquote_arg(args.get("Prompt"))
                    state["subagents"].append({
                        "description": role or prompt[:120],
                        "type": sub_type,
                        "prompt": prompt,
                        "at": stamp,
                    })
                elif tname == "send_message":
                    recipient = _unquote_arg(args.get("Recipient"))
                    msg_body = _unquote_arg(args.get("Message"))
                    summary = _unquote_arg(args.get("toolSummary")) or "Message"
                    if recipient and msg_body:
                        state["messages"].append({
                            "direction": "out",
                            "peer": recipient,
                            "peerSocket": "",
                            "summary": summary,
                            "text": msg_body,
                            "at": stamp,
                        })
                elif tname == "ask_question":
                    state["waiting_question"] = True


_BRAIN_CACHE = _BrainTranscriptCache()


def close_subagent_tree(kept_ids: set[str], by_id: dict[str, dict], parent_field: str) -> None:
    """Expand `kept_ids` in-place to include all ancestors and descendants in `by_id`."""
    changed = True
    while changed:
        changed = False
        for sid, row in by_id.items():
            parent_id = str(row.get(parent_field) or "")
            if sid in kept_ids and parent_id and parent_id in by_id and parent_id not in kept_ids:
                kept_ids.add(parent_id)
                changed = True
            elif parent_id and parent_id in kept_ids and sid not in kept_ids:
                kept_ids.add(sid)
                changed = True


def load_sessions(
    db_path: Path = DEFAULT_DB_PATH,
    brain_dir: Path = DEFAULT_BRAIN_DIR,
    live_locks: set[str] | None = None,
    now: float | None = None,
    ttl_seconds: float = RECENT_TTL_SECONDS,
) -> list[dict]:
    """Load live and recently active Antigravity sessions (plus their subagent children)."""
    if not db_path.is_file():
        return []
    current_time = time.time() if now is None else now
    locks = detect_live_locks() if live_locks is None else live_locks

    try:
        with contextlib.closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=1.5)) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    conversation_id, title, preview, step_count, last_modified_time,
                    workspace_uris, status, agent_name, parent_conversation_id,
                    not_fully_idle, killed
                FROM conversation_summaries
                """
            )
            rows = [dict(r) for r in cur.fetchall()]
    except sqlite3.Error:
        return []

    kept_ids: set[str] = set()
    by_id: dict[str, dict] = {}
    for r in rows:
        cid = str(r.get("conversation_id") or "")
        if not cid:
            continue
        by_id[cid] = r
        mtime = _parse_iso_epoch(r.get("last_modified_time"))
        age = max(0.0, current_time - mtime) if mtime > 0 else float("inf")
        raw_status = str(r.get("status") or "")
        is_running = raw_status == "CASCADE_RUN_STATUS_RUNNING" or bool(r.get("not_fully_idle"))
        if cid in locks or is_running or age <= ttl_seconds:
            kept_ids.add(cid)

    close_subagent_tree(kept_ids, by_id, "parent_conversation_id")

    brain_data: dict[str, dict] = {}
    for cid in kept_ids:
        brain_data[cid] = _BRAIN_CACHE.read(brain_dir / cid)

    out: list[dict] = []
    for cid in kept_ids:
        r = by_id[cid]
        b = brain_data[cid]
        mtime = _parse_iso_epoch(r.get("last_modified_time"))
        age = max(0.0, current_time - mtime) if mtime > 0 else 0.0
        raw_status = str(r.get("status") or "")
        is_running = raw_status == "CASCADE_RUN_STATUS_RUNNING" or bool(r.get("not_fully_idle"))
        parent_id = str(r.get("parent_conversation_id") or "")
        is_live = (cid in locks) or is_running or (parent_id in locks)

        if is_running:
            status = "busy"
            exited = False
            blocked_on = ""
        elif b["waiting_question"] or raw_status == "CASCADE_RUN_STATUS_WAITING_FOR_USER":
            status = "waiting"
            exited = False
            blocked_on = "user input"
        elif is_live:
            status = "idle"
            exited = False
            blocked_on = ""
        else:
            status = "exited"
            exited = True
            blocked_on = ""

        title = str(r.get("title") or "").strip()
        agent_name = str(r.get("agent_name") or "").strip()
        if not title and parent_id and parent_id in brain_data:
            child_in_prompts = [
                m["text"] for m in b["messages"] if m["direction"] == "in" and m["peer"] == parent_id
            ]
            for sub in brain_data[parent_id]["subagents"]:
                if sub.get("prompt") and any(sub["prompt"][:80] in cp for cp in child_in_prompts):
                    title = sub["description"]
                    break
        name = title or agent_name or f"agy-{cid[:8]}"
        cwd = _workspace_to_cwd(r.get("workspace_uris"))
        preview = b["last_text"] or str(r.get("preview") or "") or b["last_user_text"]
        updated_ms = int(mtime * 1000) if mtime > 0 else None

        out.append({
            "id": cid,
            "provider": "antigravity",
            "providerLabel": "ANTIGRAVITY",
            "parentId": parent_id,
            "name": name,
            "pid": None,
            "cwd": cwd,
            "kind": agent_name or "ide",
            "status": status,
            "exited": exited,
            "exitedAge": age if exited else 0.0,
            "blockedOn": blocked_on,
            "waitingFor": "",
            "startedAt": updated_ms,
            "updatedAt": updated_ms,
            "tmux": "",
            "hasTmux": False,
            "model": "antigravity",
            "calls": _safe_int(r.get("step_count")) or b["calls"],
            "tokens": {
                "input": max(b["input_chars"] // 4, b["full_bytes"] // 6),
                "output": max(b["output_chars"] // 4, (_safe_int(r.get("step_count")) or b["calls"]) * 180),
                "cache_read": (_safe_int(r.get("step_count")) or b["calls"]) * 18000,
                "cache_write": b["full_bytes"] // 5,
            },
            "context": (lambda used: {
                "used": used,
                "window": 1000000,
                "percent": round(min(100.0, (used / 1000000) * 100.0), 1),
            })(min(
                1000000,
                18000
                + max(b["input_chars"] // 4, b["full_bytes"] // 5)
                + max(b["output_chars"] // 4, (_safe_int(r.get("step_count")) or b["calls"]) * 320),
            )),
            "preview": preview[:400],
            "lastUserText": b["last_user_text"][:400],
            "bash": b["bash"][-3:],
            "messages": b["messages"],
            "messageCount": len(b["messages"]),
            "mcp": [],
            "skills": [],
            "filesEdited": sorted(
                b["files_edited"].values(),
                key=lambda f: (f["last"], f["edits"]),
                reverse=True,
            )[:25],
            "todos": [],
            "subagents": b["subagents"],
            "artifacts": b["artifacts"],
        })

    out.sort(key=lambda s: s.get("updatedAt") or 0)
    return out
