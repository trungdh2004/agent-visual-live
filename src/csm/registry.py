"""The live session registry: ~/.claude/sessions/<pid>.json, one file per session.

Claude Code writes a file here when a session registers and rewrites it on every
state change. `status` is a snapshot, not a stream, so `updatedAt` is carried
through to the UI - a busy session can sit minutes behind.
"""

import json
import time
from pathlib import Path

SESSIONS_DIR = Path.home() / ".claude" / "sessions"
EXITED_TTL_SECONDS = 7200.0

# Fields taken from the registry file. Anything missing is left out rather than
# defaulted, so a format change shows as a blank cell instead of a wrong one.
FIELDS = (
    "pid", "sessionId", "cwd", "startedAt", "version", "name", "nameSource",
    "kind", "status", "updatedAt", "statusUpdatedAt", "tmux", "waitingFor",
    "blockedOn", "messagingSocketPath",
)


def _alive(pid: int) -> bool:
    return Path(f"/proc/{pid}").exists()


def _age_seconds(raw: dict, fallback_mtime: float, now: float) -> float:
    stamp = raw.get("updatedAt") or raw.get("startedAt")
    if isinstance(stamp, (int, float)) and stamp > 0:
        return max(0.0, now - (float(stamp) / 1000.0))
    return max(0.0, now - fallback_mtime)


def read_sessions(include_exited_seconds: float = EXITED_TTL_SECONDS) -> list[dict]:
    """Every live session, plus recently exited sessions within TTL so peer
    threads remain inspectable after a worker exits."""
    out = []
    if not SESSIONS_DIR.is_dir():
        return out
    now = time.time()
    for path in SESSIONS_DIR.glob("*.json"):
        try:
            stat = path.stat()
            raw = json.loads(path.read_text())
        except (OSError, ValueError):
            continue
        if not isinstance(raw, dict):
            continue
        pid = raw.get("pid")
        if not isinstance(pid, int):
            continue
        alive = _alive(pid)
        age = _age_seconds(raw, stat.st_mtime, now)
        if not alive and age > include_exited_seconds:
            continue
        entry = {k: raw.get(k) for k in FIELDS if k in raw}
        entry["exited"] = not alive
        entry["exitedAge"] = age if not alive else 0.0
        out.append(entry)
    out.sort(key=lambda s: s.get("startedAt") if isinstance(s.get("startedAt"), (int, float)) else 0)
    return out
