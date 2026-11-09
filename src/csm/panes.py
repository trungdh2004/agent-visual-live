"""Move the user's terminal to a session's tmux pane.

The registry stores the pane as `session:window.pane` (see
registry.py FIELDS), written once at registration and only when the session
started inside tmux. It is the one control this dashboard has: it moves the
operator to the window, it never acts on the session.
"""

import re
import subprocess

TARGET = re.compile(r"^([A-Za-z0-9_.-]{1,64}):(@?\d{1,6})\.(%?\d{1,6})$")
PANE_ONLY = re.compile(r"^(%\d{1,6})$")


def jump(tmux_target: str) -> tuple[bool, str]:
    target = (tmux_target or "").strip()
    match = TARGET.match(target)
    if match:
        session, window, pane = match.groups()
        steps: tuple[tuple[str, ...], ...] = (
            ("select-window", "-t", f"{session}:{window}"),
            ("select-pane", "-t", pane),
            ("switch-client", "-t", session),
        )
    elif PANE_ONLY.match(target):
        pane = target
        steps = (("select-pane", "-t", pane),)
    else:
        return False, "session không chạy trong tmux"

    for step in steps:
        try:
            done = subprocess.run(("tmux", *step), capture_output=True,
                                  text=True, timeout=5)
        except (OSError, subprocess.SubprocessError) as error:
            return False, str(error)
        if done.returncode != 0:
            return False, done.stderr.strip() or f"tmux {step[0]} thất bại"
    return True, ""


def capture(tmux_target: str, lines: int = 45) -> tuple[bool, str]:
    """Read the visible text and recent scrollback from a tmux pane (read-only)."""
    target = (tmux_target or "").strip()
    match = TARGET.match(target)
    if match:
        _, _, pane = match.groups()
    elif PANE_ONLY.match(target):
        pane = target
    else:
        return False, "session không chạy trong tmux"
    try:
        done = subprocess.run(
            ("tmux", "capture-pane", "-p", "-J", "-t", pane, "-S", f"-{int(lines)}"),
            capture_output=True,
            text=True,
            timeout=3,
        )
    except (OSError, subprocess.SubprocessError) as error:
        return False, str(error)
    if done.returncode != 0:
        return False, done.stderr.strip() or "tmux capture-pane thất bại"
    return True, done.stdout.rstrip()
