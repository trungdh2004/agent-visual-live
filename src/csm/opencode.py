"""OpenCode telemetry adapter (100% read-only).

Reads:
- SQLite `~/.local/share/opencode/opencode.db` (`session_v2` & `session_message`, opened in `mode=ro`)
- Running `opencode` CLI/TUI processes in `/proc` and their associated `tmux` panes
"""

import contextlib
import json
import os
import re
import sqlite3
import subprocess
import time
from collections import deque
from datetime import datetime, timezone
from pathlib import Path

from .antigravity import close_subagent_tree

DEFAULT_DB_PATH = Path.home() / ".local" / "share" / "opencode" / "opencode.db"
RECENT_TTL_SECONDS = 7200.0
BUSY_WINDOW_SECONDS = 60.0
PATCH_FILE_RE = re.compile(r"^\*\*\*\s+(?:Update|Add|Delete)\s+File:\s+(.+)$", re.MULTILINE)


def _safe_int(val, default: int = 0) -> int:
    try:
        return int(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def _safe_float(val, default: float = 0.0) -> float:
    try:
        return float(val) if val is not None else default
    except (ValueError, TypeError):
        return default


def _epoch_ms_to_iso(ms: int | float | None) -> str:
    val = _safe_float(ms, 0.0)
    if val <= 0:
        return ""
    try:
        return datetime.fromtimestamp(val / 1000.0, tz=timezone.utc).isoformat()
    except (OSError, ValueError):
        return ""


def _parse_model(raw: str | None) -> str:
    if not raw:
        return "opencode"
    try:
        obj = json.loads(raw)
        if isinstance(obj, dict) and obj.get("id"):
            return str(obj["id"])
    except (ValueError, TypeError):
        pass
    return str(raw)


def _tmux_pane_by_pid() -> dict[int, str]:
    """Map shell/pane PIDs to canonical `session:window.pane` targets."""
    try:
        res = subprocess.run(
            ["tmux", "list-panes", "-a", "-F", "#{pane_pid} #{session_name}:#{window_index}.#{pane_id}"],
            capture_output=True,
            text=True,
            timeout=1.5,
        )
        if res.returncode != 0:
            return {}
    except (OSError, subprocess.SubprocessError):
        return {}

    pane_roots: dict[int, str] = {}
    for line in res.stdout.splitlines():
        parts = line.split(maxsplit=1)
        if len(parts) == 2 and parts[0].isdigit():
            pane_roots[int(parts[0])] = parts[1].strip()
    return pane_roots


def _find_tmux_for_pid(pid: int, pane_roots: dict[int, str]) -> str:
    if not pane_roots:
        return ""
    curr = pid
    visited: set[int] = set()
    while curr > 1 and curr not in visited:
        if curr in pane_roots:
            return pane_roots[curr]
        visited.add(curr)
        try:
            stat = Path(f"/proc/{curr}/stat").read_text()
            rparen = stat.rfind(")")
            if rparen == -1:
                break
            fields = stat[rparen + 2 :].split()
            curr = int(fields[1])
        except (OSError, ValueError, IndexError):
            break
    return ""


def detect_live_processes() -> list[dict]:
    """Scan `/proc` for active interactive `opencode` processes (excluding background `serve --service`)."""
    proc = Path("/proc")
    if not proc.is_dir():
        return []
    pane_roots = _tmux_pane_by_pid()
    live: list[dict] = []
    for entry in proc.iterdir():
        if not entry.name.isdigit():
            continue
        pid = int(entry.name)
        try:
            cmdline_bytes = (entry / "cmdline").read_bytes()
            if not cmdline_bytes:
                continue
            args = [a.decode("utf-8", errors="replace") for a in cmdline_bytes.split(b"\x00") if a]
            if not args:
                continue
            exe = os.path.basename(args[0])
            if exe != "opencode":
                continue
            if "serve" in args and "--service" in args:
                continue
            cwd = os.readlink(entry / "cwd")
            tmux_pane = _find_tmux_for_pid(pid, pane_roots)
            live.append({"pid": pid, "cwd": cwd, "tmux": tmux_pane})
        except OSError:
            continue
    return live


def _record_file_edit(slot: dict, raw_path: str, cwd: str, stamp: str) -> None:
    fpath = raw_path.strip()
    if not fpath:
        return
    if cwd and not os.path.isabs(fpath):
        fpath = os.path.normpath(os.path.join(cwd, fpath))
    fslot = slot["files_edited"].setdefault(fpath, {"path": fpath, "edits": 0, "last": ""})
    fslot["edits"] += 1
    fslot["last"] = max(fslot["last"], stamp)


class _OpenCodeMessageCache:
    """Incremental reader for `session_message` keyed by `(db_path, session_id)` and `(last_time, last_seq)`."""

    def __init__(self):
        self._entries: dict[tuple[str, str], dict] = {}

    def read_many(
        self,
        conn: sqlite3.Connection,
        db_key: str,
        session_ids: set[str],
        cwd_by_id: dict[str, str],
    ) -> dict[str, dict]:
        out: dict[str, dict] = {}
        cur = conn.cursor()
        for sid in session_ids:
            key = (db_key, sid)
            state = self._entries.get(key)
            if state is None:
                state = {
                    "last_seq": -1,
                    "last_time": -1,
                    "files_edited": {},
                    "bash": deque(maxlen=20),
                    "skills": {},
                    "mcp": {},
                    "last_text": "",
                    "first_user_text": "",
                    "calls": 0,
                }
                self._entries[key] = state

            try:
                cur.execute(
                    """
                    SELECT seq, type, time_updated, data
                    FROM session_message
                    WHERE session_id = ?
                      AND (time_updated > ? OR (time_updated = ? AND seq > ?))
                    ORDER BY time_updated ASC, seq ASC
                    """,
                    (sid, state["last_time"], state["last_time"], state["last_seq"]),
                )
                rows = cur.fetchall()
            except sqlite3.Error:
                rows = []

            cwd = cwd_by_id.get(sid, "")
            for seq, mtype, t_updated, raw_data in rows:
                seq_i = _safe_int(seq, 0)
                t_i = _safe_int(t_updated, 0)
                if t_i > state["last_time"] or (t_i == state["last_time"] and seq_i > state["last_seq"]):
                    state["last_time"] = t_i
                    state["last_seq"] = seq_i
                self._consume_message(state, str(mtype or ""), t_i, raw_data, cwd)

            out[sid] = state
        return out

    @staticmethod
    def _consume_message(state: dict, mtype: str, t_updated: int, raw_data: str | None, cwd: str) -> None:
        if not raw_data:
            return
        try:
            data = json.loads(raw_data)
        except ValueError:
            return
        if not isinstance(data, dict):
            return

        stamp = _epoch_ms_to_iso(t_updated)

        for fitem in data.get("files") or []:
            if isinstance(fitem, str):
                _record_file_edit(state, fitem, cwd, stamp)
            elif isinstance(fitem, dict):
                _record_file_edit(
                    state,
                    str(fitem.get("path") or fitem.get("filePath") or fitem.get("file") or ""),
                    cwd,
                    stamp,
                )

        if mtype == "user":
            txt = str(data.get("text") or "").strip()
            if txt and not state["first_user_text"]:
                state["first_user_text"] = txt
        elif mtype == "assistant":
            state["calls"] += 1
            for item in data.get("content") or []:
                if not isinstance(item, dict):
                    continue
                ctype = item.get("type")
                if ctype == "text":
                    txt = str(item.get("text") or "").strip()
                    if txt:
                        state["last_text"] = txt
                elif ctype == "tool":
                    tname = str(item.get("name") or "")
                    tstate = item.get("state") or {}
                    inp = tstate.get("input") if isinstance(tstate, dict) else {}
                    if not isinstance(inp, dict):
                        inp = {}

                    if tname in ("shell", "bash"):
                        cmd = str(inp.get("command") or "").strip()
                        desc = str(inp.get("description") or "").strip()
                        if cmd:
                            state["bash"].append({"command": cmd, "description": desc, "at": stamp})
                    elif tname in ("edit", "write", "multiedit"):
                        _record_file_edit(
                            state,
                            str(inp.get("filePath") or inp.get("path") or inp.get("file_path") or ""),
                            cwd,
                            stamp,
                        )
                    elif tname == "patch":
                        patch_text = str(inp.get("patchText") or "")
                        for m in PATCH_FILE_RE.finditer(patch_text):
                            _record_file_edit(state, m.group(1), cwd, stamp)
                    elif tname == "skill":
                        sname = str(inp.get("id") or inp.get("name") or inp.get("skill") or "").strip()
                        if sname:
                            sslot = state["skills"].setdefault(sname, {"name": sname, "calls": 0, "last": ""})
                            sslot["calls"] += 1
                            sslot["last"] = max(sslot["last"], stamp)


_MSG_CACHE = _OpenCodeMessageCache()


def load_sessions(
    db_path: Path = DEFAULT_DB_PATH,
    live_procs: list[dict] | None = None,
    now: float | None = None,
    ttl_seconds: float = RECENT_TTL_SECONDS,
) -> list[dict]:
    """Load live and recently active OpenCode sessions from `opencode.db`."""
    if not db_path.is_file():
        return []
    current_time = time.time() if now is None else now
    procs = detect_live_processes() if live_procs is None else live_procs
    proc_by_cwd: dict[str, dict] = {}
    for p in procs:
        if p.get("cwd"):
            proc_by_cwd[os.path.normpath(p["cwd"])] = p

    try:
        with contextlib.closing(sqlite3.connect(f"file:{db_path}?mode=ro", uri=True, timeout=1.5)) as conn:
            conn.row_factory = sqlite3.Row
            cur = conn.cursor()
            cur.execute(
                """
                SELECT
                    id, parent_id, fork_session_id, slug, directory, title,
                    cost, tokens_input, tokens_output, tokens_reasoning,
                    tokens_cache_read, tokens_cache_write, permission,
                    agent, model, time_created, time_updated, time_idle,
                    idle_outcome, time_archived
                FROM session_v2
                WHERE time_archived IS NULL
                ORDER BY time_updated DESC
                """
            )
            rows = [dict(r) for r in cur.fetchall()]

            by_id: dict[str, dict] = {}
            kept_ids: set[str] = set()
            matched_live_cwds: set[str] = set()

            for r in rows:
                sid = str(r.get("id") or "")
                if not sid:
                    continue
                r["_parent_ref"] = str(r.get("parent_id") or r.get("fork_session_id") or "")
                by_id[sid] = r
                t_upd = _safe_float(r.get("time_updated") or r.get("time_created"), 0.0) / 1000.0
                age = max(0.0, current_time - t_upd) if t_upd > 0 else float("inf")
                cwd = os.path.normpath(str(r.get("directory") or "")) if r.get("directory") else ""

                is_live_cwd = False
                if cwd and cwd in proc_by_cwd and cwd not in matched_live_cwds:
                    matched_live_cwds.add(cwd)
                    is_live_cwd = True
                    r["_live_proc"] = proc_by_cwd[cwd]

                if is_live_cwd or age <= ttl_seconds:
                    kept_ids.add(sid)

            close_subagent_tree(kept_ids, by_id, "_parent_ref")
            cwd_by_id = {sid: str(by_id[sid].get("directory") or "") for sid in kept_ids}
            msg_tel = _MSG_CACHE.read_many(conn, str(db_path), kept_ids, cwd_by_id)
    except sqlite3.Error:
        return []

    out: list[dict] = []
    for sid in kept_ids:
        r = by_id[sid]
        tel = msg_tel[sid]
        t_upd_ms = _safe_int(r.get("time_updated") or r.get("time_created"), 0)
        t_idle_ms = _safe_int(r.get("time_idle"), 0)
        age = max(0.0, current_time - (t_upd_ms / 1000.0)) if t_upd_ms > 0 else 0.0
        live_proc = r.get("_live_proc")
        parent_id = r["_parent_ref"]
        parent_live = bool(parent_id and parent_id in by_id and by_id[parent_id].get("_live_proc"))

        is_busy = (t_upd_ms > t_idle_ms) and (age <= BUSY_WINDOW_SECONDS)
        is_waiting = bool(r.get("permission")) or str(r.get("idle_outcome") or "") == "permission"
        is_live = bool(live_proc) or is_busy or is_waiting or parent_live or (age <= 900.0)

        if is_waiting:
            status = "waiting"
            exited = False
            blocked_on = "permission prompt"
        elif is_busy:
            status = "busy"
            exited = False
            blocked_on = ""
        elif is_live:
            status = "idle"
            exited = False
            blocked_on = ""
        else:
            status = "exited"
            exited = True
            blocked_on = ""

        messages: list[dict] = []
        if parent_id and parent_id in by_id:
            stamp = _epoch_ms_to_iso(r.get("time_created") or t_upd_ms)
            if tel["first_user_text"]:
                messages.append({
                    "direction": "in",
                    "peer": parent_id,
                    "peerSocket": "",
                    "summary": str(r.get("title") or "Subagent Task"),
                    "text": tel["first_user_text"],
                    "at": stamp,
                })
            if tel["last_text"]:
                messages.append({
                    "direction": "out",
                    "peer": parent_id,
                    "peerSocket": "",
                    "summary": "Subagent Result",
                    "text": tel["last_text"],
                    "at": _epoch_ms_to_iso(t_upd_ms),
                })

        tmux_target = "" if exited else str((live_proc or {}).get("tmux") or "")
        pid = (live_proc or {}).get("pid")
        model = _parse_model(r.get("model"))
        tok_in = _safe_int(r.get("tokens_input"))
        tok_out = _safe_int(r.get("tokens_output"))
        tok_reason = _safe_int(r.get("tokens_reasoning"))
        tok_cache_r = _safe_int(r.get("tokens_cache_read"))
        tok_cache_w = _safe_int(r.get("tokens_cache_write"))
        window = 200_000
        used_ctx = tok_in + tok_out + tok_reason
        name = str(r.get("title") or r.get("slug") or sid[:10])

        out.append({
            "id": sid,
            "provider": "opencode",
            "providerLabel": "OPENCODE",
            "parentId": parent_id,
            "name": name,
            "pid": pid,
            "cwd": str(r.get("directory") or ""),
            "kind": str(r.get("agent") or "cli"),
            "status": status,
            "exited": exited,
            "exitedAge": age if exited else 0.0,
            "blockedOn": blocked_on,
            "waitingFor": "",
            "startedAt": r.get("time_created") or t_upd_ms,
            "updatedAt": t_upd_ms,
            "tmux": tmux_target,
            "hasTmux": bool(tmux_target),
            "model": model,
            "cost": _safe_float(r.get("cost"), 0.0),
            "calls": tel["calls"],
            "tokens": {
                "input": tok_in,
                "output": tok_out,
                "reasoning": tok_reason,
                "cache_read": tok_cache_r,
                "cache_write": tok_cache_w,
            },
            "context": {
                "used": used_ctx,
                "window": window,
                "percent": min(100.0, round(100.0 * used_ctx / window, 1)) if window else 0,
            },
            "preview": tel["last_text"][:400],
            "bash": list(tel["bash"])[-3:],
            "messages": messages,
            "messageCount": len(messages),
            "mcp": [],
            "skills": sorted(tel["skills"].values(), key=lambda t: -t["calls"]),
            "filesEdited": sorted(
                tel["files_edited"].values(),
                key=lambda f: (f["last"], f["edits"]),
                reverse=True,
            )[:25],
            "todos": [],
            "subagents": [],
            "artifacts": [],
        })

    out.sort(key=lambda s: s.get("updatedAt") or 0)
    return out
