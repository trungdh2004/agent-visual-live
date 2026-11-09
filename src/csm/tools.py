"""Which MCP servers and skills a session can reach, and which it has used.

Three tiers, and they cost wildly different amounts:

- configured: read from ~/.claude.json and any .mcp.json, free.
- used: counted from the transcript the dashboard already tails, free.
- connected: `claude mcp list`, which health-checks every server by starting it.
  That takes around fifteen seconds per working directory, so it runs on a
  timer in the background and never on the request path.

Server names differ between the two worlds - `claude mcp list` prints
"claude.ai Atlassian Rovo" while a tool call is named
mcp__claude_ai_Atlassian_Rovo__authenticate - so both sides are matched on a
slug rather than on the literal string.
"""

import json
import re
import subprocess
import threading
import time
from pathlib import Path

CLAUDE_JSON = Path.home() / ".claude.json"

HEALTH_INTERVAL = 300.0
HEALTH_TIMEOUT = 120

ANSI = re.compile(r"\x1b\[[0-9;]*m")
# name: target - <mark> <status>, where the name itself may contain colons
# (plugin:playwright:playwright) but never a colon followed by a space.
HEALTH_LINE = re.compile(r"^(?P<name>.+?): (?P<target>.*?) - (?P<mark>[✔!✘])\s*(?P<status>.*)$")
MARK_STATE = {"✔": "connected", "!": "auth", "✘": "failed"}


def slug(name: str) -> str:
    return re.sub(r"[^a-z0-9]+", "_", (name or "").lower()).strip("_")


def _read_json(path: Path) -> dict:
    try:
        value = json.loads(path.read_text())
    except (OSError, ValueError):
        return {}
    return value if isinstance(value, dict) else {}


def configured(cwd: str) -> list[dict]:
    """Servers a session in this directory is set up to reach.

    Project entries are keyed by the exact working directory, so a session in a
    submodule does not inherit the superrepo's servers.
    """
    found: dict[str, dict] = {}

    def note(name: str, scope: str) -> None:
        found.setdefault(slug(name), {"name": name, "slug": slug(name), "scope": scope})

    root = _read_json(CLAUDE_JSON)
    for name in (root.get("mcpServers") or {}):
        note(name, "global")
    project = (root.get("projects") or {}).get(cwd) or {}
    for name in (project.get("mcpServers") or {}):
        note(name, "project")
    for name in (_read_json(Path(cwd) / ".mcp.json").get("mcpServers") or {}):
        note(name, "project")
    return sorted(found.values(), key=lambda s: s["name"].lower())


class HealthProbe:
    """Runs `claude mcp list` per working directory on a timer.

    Starting every configured server is a real side effect, so this is kept to
    one run per directory per interval, and the directories are probed one at a
    time rather than all at once.
    """

    def __init__(self):
        self._by_cwd: dict[str, dict] = {}
        self._lock = threading.Lock()
        self._wanted: set[str] = set()
        self._wake = threading.Event()
        threading.Thread(target=self._loop, daemon=True).start()

    def track(self, cwds: set[str]) -> None:
        with self._lock:
            fresh = cwds - self._wanted
            self._wanted = set(cwds)
        if fresh:
            self._wake.set()

    def for_cwd(self, cwd: str) -> dict:
        with self._lock:
            return self._by_cwd.get(cwd) or {
                "servers": [], "checkedAt": 0, "running": False, "error": "",
            }

    def refresh_now(self) -> None:
        with self._lock:
            for entry in self._by_cwd.values():
                entry["checkedAt"] = 0
        self._wake.set()

    def _loop(self) -> None:
        while True:
            with self._lock:
                wanted = sorted(self._wanted)
            now = time.time()
            for cwd in wanted:
                with self._lock:
                    entry = self._by_cwd.get(cwd)
                if entry and now - entry["checkedAt"] < HEALTH_INTERVAL:
                    continue
                self._probe(cwd)
            self._wake.wait(timeout=30)
            self._wake.clear()

    def _probe(self, cwd: str) -> None:
        with self._lock:
            self._by_cwd.setdefault(cwd, {"servers": [], "checkedAt": 0})["running"] = True
        servers = []
        error = ""
        try:
            done = subprocess.run(
                ("claude", "mcp", "list"), cwd=cwd, capture_output=True,
                text=True, timeout=HEALTH_TIMEOUT,
            )
            if done.returncode != 0:
                error = (done.stderr or done.stdout).strip().splitlines()[-1:] or [""]
                error = f"exit {done.returncode}: {error[0][:120]}"
            for line in ANSI.sub("", done.stdout).splitlines():
                match = HEALTH_LINE.match(line.strip())
                if not match:
                    continue
                name = match.group("name")
                servers.append({
                    "name": name,
                    "slug": slug(name),
                    "target": match.group("target"),
                    "state": MARK_STATE.get(match.group("mark"), "unknown"),
                    "detail": match.group("status").strip(),
                })
        except subprocess.TimeoutExpired:
            error = f"quá {HEALTH_TIMEOUT}s"
        except (OSError, subprocess.SubprocessError) as problem:
            error = str(problem)[:120]
        # An empty list with no error means the command ran and printed nothing
        # recognisable - worth saying out loud rather than showing a blank row.
        if not servers and not error:
            error = "không đọc được dòng nào"
        with self._lock:
            self._by_cwd[cwd] = {
                "servers": servers,
                "checkedAt": time.time(),
                "running": False,
                "error": error,
            }
