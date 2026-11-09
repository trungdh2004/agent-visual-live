"""Group sessions into fleets by the outermost git root of their cwd.

A session in a submodule belongs to the fleet of its superproject, so
MITS-CLOUD and MITS-EDGE land in the same fleet as the superrepo that owns
them. Outside git, the cwd itself is the key.
"""

import subprocess
import time
from functools import lru_cache

GIT_TTL = 10.0
_git_cache: dict[str, tuple[float, dict]] = {}


def _git(cwd: str, *args: str, timeout: float = 5.0) -> str:
    try:
        done = subprocess.run(
            ("git", "-C", cwd, *args),
            capture_output=True, text=True, timeout=timeout,
        )
    except (OSError, subprocess.SubprocessError):
        return ""
    return done.stdout.strip() if done.returncode == 0 else ""


@lru_cache(maxsize=512)
def project_root(cwd: str) -> str:
    """Walk up through superprojects until one has none left."""
    top = _git(cwd, "rev-parse", "--show-toplevel")
    if not top:
        return cwd
    seen = set()
    while top not in seen:
        seen.add(top)
        parent = _git(top, "rev-parse", "--show-superproject-working-tree")
        if not parent:
            break
        top = parent
    return top


def git_info(cwd: str) -> dict:
    """Return branch name and dirty file count for cwd, cached for GIT_TTL seconds."""
    if not cwd:
        return {"branch": "", "dirty": False, "changedCount": 0}
    now = time.time()
    cached = _git_cache.get(cwd)
    if cached and now - cached[0] < GIT_TTL:
        return cached[1]

    raw = _git(cwd, "status", "--porcelain", "--branch", "-uall", timeout=2.0)
    if not raw:
        res = {"branch": "", "dirty": False, "changedCount": 0}
        _git_cache[cwd] = (now, res)
        return res

    lines = raw.splitlines()
    head = lines[0] if lines else ""
    branch = ""
    if head.startswith("## "):
        branch_part = head[3:].strip()
        if branch_part.startswith("No commits yet on "):
            branch = branch_part.removeprefix("No commits yet on ").strip()
        elif branch_part.startswith("HEAD (no branch)"):
            short_sha = _git(cwd, "rev-parse", "--short", "HEAD", timeout=2.0)
            branch = short_sha or "HEAD"
        else:
            branch = branch_part.split("...", 1)[0].split(" ", 1)[0].strip()
    changed_count = sum(1 for line in lines[1:] if line.strip())
    res = {
        "branch": branch,
        "dirty": changed_count > 0,
        "changedCount": changed_count,
    }
    _git_cache[cwd] = (now, res)
    return res
