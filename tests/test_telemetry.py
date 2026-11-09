"""Tests for public seams of claude-session-monitor Phase 2 telemetry."""

import json
import tempfile
import time
import unittest
from pathlib import Path
from unittest import mock

from csm import app as csm_app, fleet, panes, projects, registry, transcript


class TranscriptTelemetryTests(unittest.TestCase):
    def _make_transcript(self, lines: list[dict]) -> transcript.SessionTranscript:
        with tempfile.TemporaryDirectory() as tmp:
            proj = Path(tmp) / "slug"
            proj.mkdir(parents=True)
            sid = "sess-123"
            jsonl = proj / f"{sid}.jsonl"
            jsonl.write_text("\n".join(json.dumps(line) for line in lines) + "\n")
            with mock.patch.object(transcript, "PROJECTS_DIR", Path(tmp)):
                st = transcript.SessionTranscript(sid)
                st.refresh()
                return st

    def test_tracks_files_edited_from_write_edit_and_multiedit(self):
        lines = [
            {
                "type": "assistant",
                "timestamp": "2026-11-05T10:00:00Z",
                "message": {
                    "id": "call-1",
                    "model": "claude-sonnet-5",
                    "content": [
                        {"type": "tool_use", "name": "Edit", "input": {"file_path": "/repo/a.py"}},
                        {"type": "tool_use", "name": "Write", "input": {"file_path": "/repo/b.py"}},
                    ],
                },
            },
            {
                "type": "assistant",
                "timestamp": "2026-11-05T10:05:00Z",
                "message": {
                    "id": "call-2",
                    "content": [
                        {"type": "tool_use", "name": "MultiEdit", "input": {"file_path": "/repo/a.py"}},
                        {"type": "tool_use", "name": "NotebookEdit", "input": {"notebook_path": "/repo/nb.ipynb"}},
                    ],
                },
            },
        ]
        st = self._make_transcript(lines)
        self.assertIn("/repo/a.py", st.files_edited)
        self.assertEqual(st.files_edited["/repo/a.py"]["edits"], 2)
        self.assertEqual(st.files_edited["/repo/a.py"]["last"], "2026-11-05T10:05:00Z")
        self.assertEqual(st.files_edited["/repo/b.py"]["edits"], 1)
        self.assertEqual(st.files_edited["/repo/nb.ipynb"]["edits"], 1)

    def test_tracks_todos_and_subagents(self):
        lines = [
            {
                "type": "assistant",
                "timestamp": "2026-11-05T11:00:00Z",
                "message": {
                    "id": "call-1",
                    "content": [
                        {
                            "type": "tool_use",
                            "name": "TodoWrite",
                            "input": {
                                "todos": [
                                    {"content": "Step 1", "status": "completed"},
                                    {"content": "Step 2", "status": "in_progress"},
                                ]
                            },
                        },
                        {
                            "type": "tool_use",
                            "name": "Agent",
                            "input": {
                                "subagent_type": "research",
                                "description": "Explore codebase",
                            },
                        },
                    ],
                },
            }
        ]
        st = self._make_transcript(lines)
        self.assertEqual(len(st.todos), 2)
        self.assertEqual(st.todos[0], {"content": "Step 1", "status": "completed"})
        self.assertEqual(st.todos[1], {"content": "Step 2", "status": "in_progress"})
        self.assertEqual(len(st.subagents), 1)
        self.assertEqual(st.subagents[0]["type"], "research")
        self.assertEqual(st.subagents[0]["description"], "Explore codebase")


class GitInfoTests(unittest.TestCase):
    def setUp(self):
        projects._git_cache.clear() if hasattr(projects, "_git_cache") else None

    def test_parses_branch_and_dirty_status_from_porcelain_output(self):
        sample = "## feat/telemetry...origin/feat/telemetry\n M src/csm/app.py\n?? tickets/INDEX.md"
        with mock.patch.object(projects, "_git", return_value=sample) as m_git:
            info1 = projects.git_info("/repo/work")
            info2 = projects.git_info("/repo/work")
            self.assertEqual(info1, {
                "branch": "feat/telemetry",
                "dirty": True,
                "changedCount": 2,
            })
            self.assertEqual(info2, info1)
            m_git.assert_called_once_with("/repo/work", "status", "--porcelain", "--branch", "-uall", timeout=2.0)

    def test_resolves_short_sha_when_detached_head(self):
        def fake_git(cwd, *args, **kwargs):
            if "status" in args:
                return "## HEAD (no branch)\n"
            if "rev-parse" in args:
                return "a1b2c3d"
            return ""

        with mock.patch.object(projects, "_git", side_effect=fake_git):
            info = projects.git_info("/repo/detached")
            self.assertEqual(info, {"branch": "a1b2c3d", "dirty": False, "changedCount": 0})

    def test_returns_empty_branch_when_not_a_git_repo(self):
        with mock.patch.object(projects, "_git", return_value=""):
            info = projects.git_info("/tmp/non-git")
            self.assertEqual(info, {"branch": "", "dirty": False, "changedCount": 0})


class PanesCaptureTests(unittest.TestCase):
    def test_rejects_invalid_tmux_target(self):
        ok, detail = panes.capture("bad target; rm -rf /")
        self.assertFalse(ok)
        self.assertIn("tmux", detail)

    def test_captures_pane_text_with_valid_target(self):
        completed = mock.Mock(returncode=0, stdout="line 1\nAllow Bash command? (y/n)   \n", stderr="")
        with mock.patch("subprocess.run", return_value=completed) as m_run:
            ok, text = panes.capture("dev:1.%3", lines=40)
            self.assertTrue(ok)
            self.assertEqual(text, "line 1\nAllow Bash command? (y/n)")
            m_run.assert_called_once_with(
                ("tmux", "capture-pane", "-p", "-J", "-t", "%3", "-S", "-40"),
                capture_output=True,
                text=True,
                timeout=3,
            )


class FleetCollisionAndGhostTests(unittest.TestCase):
    def test_detects_file_collisions_only_among_live_sessions(self):
        with tempfile.TemporaryDirectory() as tmp:
            sess_dir = Path(tmp) / "sessions"
            proj_dir = Path(tmp) / "projects" / "slug"
            sess_dir.mkdir(parents=True)
            proj_dir.mkdir(parents=True)

            now_ms = int(time.time() * 1000)
            # s1 (live) and s2 (live) both edit /repo/shared.py; s3 (exited) also edited /repo/shared.py and /repo/old.py
            (sess_dir / "101.json").write_text(json.dumps({
                "pid": 101, "sessionId": "s1", "name": "coord", "cwd": "/repo",
                "status": "busy", "startedAt": now_ms - 50000, "updatedAt": now_ms,
            }))
            (sess_dir / "102.json").write_text(json.dumps({
                "pid": 102, "sessionId": "s2", "name": "worker-live", "cwd": "/repo",
                "status": "busy", "startedAt": now_ms - 40000, "updatedAt": now_ms,
            }))
            (sess_dir / "103.json").write_text(json.dumps({
                "pid": 103, "sessionId": "s3", "name": "worker-exited", "cwd": "/repo",
                "status": "idle", "startedAt": now_ms - 60000, "updatedAt": now_ms - 10000,
            }))

            # s1 sent message to s3 and edited /repo/shared.py + /repo/old.py
            (proj_dir / "s1.jsonl").write_text(json.dumps({
                "type": "assistant",
                "timestamp": "2026-11-05T12:00:00Z",
                "message": {
                    "id": "c1",
                    "content": [
                        {"type": "tool_use", "name": "SendMessage", "input": {"to": "worker-exited", "message": "do task"}},
                        {"type": "tool_use", "name": "Edit", "input": {"file_path": "/repo/shared.py"}},
                        {"type": "tool_use", "name": "Edit", "input": {"file_path": "/repo/old.py"}},
                    ],
                },
            }) + "\n")
            (proj_dir / "s2.jsonl").write_text(json.dumps({
                "type": "assistant",
                "timestamp": "2026-11-05T12:01:00Z",
                "message": {
                    "id": "c2",
                    "content": [
                        {"type": "tool_use", "name": "Write", "input": {"file_path": "/repo/shared.py"}},
                    ],
                },
            }) + "\n")
            (proj_dir / "s3.jsonl").write_text(json.dumps({
                "type": "assistant",
                "timestamp": "2026-11-05T11:59:00Z",
                "message": {
                    "id": "c3",
                    "content": [
                        {"type": "tool_use", "name": "Edit", "input": {"file_path": "/repo/old.py"}},
                    ],
                },
            }) + "\n")

            with (
                mock.patch.object(registry, "SESSIONS_DIR", sess_dir),
                mock.patch.object(registry, "_alive", side_effect=lambda pid: pid in (101, 102)),
                mock.patch.object(transcript, "PROJECTS_DIR", Path(tmp) / "projects"),
                mock.patch.object(projects, "project_root", return_value="/repo"),
                mock.patch.object(projects, "git_info", return_value={"branch": "main", "dirty": True, "changedCount": 1}),
                mock.patch.object(fleet.tools, "configured", return_value=[]),
                mock.patch.object(fleet.UsageWindows, "read", return_value={"windows": [], "stale": False, "status": ""}),
                mock.patch.object(fleet.antigravity, "load_sessions", return_value=[]),
                mock.patch.object(fleet.opencode, "load_sessions", return_value=[]),
            ):
                f = fleet.Fleet()
                snap = f.snapshot()

            by_id = {c["id"]: c for c in snap["sessions"]}
            self.assertIn("s1", by_id)
            self.assertIn("s2", by_id)
            self.assertIn("s3", by_id)
            self.assertTrue(by_id["s3"]["exited"])
            self.assertEqual(by_id["s3"]["status"], "exited")

            # Collision on /repo/shared.py between s1 and s2 (both live), but NOT on /repo/old.py (s3 is exited)
            self.assertEqual(by_id["s1"]["conflicts"], [{"path": "/repo/shared.py", "peers": ["worker-live"]}])
            self.assertEqual(by_id["s2"]["conflicts"], [{"path": "/repo/shared.py", "peers": ["coord"]}])
            self.assertEqual(by_id["s3"]["conflicts"], [])
            self.assertEqual(by_id["s1"]["git"]["branch"], "main")

    def test_capture_pane_endpoint_handles_live_and_missing_sessions(self):
        fake_sessions = {
            "s-tmux": {"id": "s-tmux", "tmux": "dev:1.%2", "exited": False},
            "s-notmux": {"id": "s-notmux", "tmux": "", "exited": False},
        }
        with (
            mock.patch.object(csm_app._fleet, "session_of", side_effect=lambda sid: fake_sessions.get(sid)),
            mock.patch.object(panes, "capture", return_value=(True, "Prompt? [y/n]")),
        ):
            res_ok = csm_app.capture_pane("s-tmux")
            self.assertEqual(res_ok, {"ok": True, "text": "Prompt? [y/n]", "detail": ""})

            res_no_tmux = csm_app.capture_pane("s-notmux")
            self.assertFalse(res_no_tmux["ok"])
            self.assertEqual(
                res_no_tmux["detail"],
                "Phiên này được khởi chạy ngoài tmux nên không thể chụp màn hình pane",
            )

            res_missing = csm_app.capture_pane("unknown")
            self.assertFalse(res_missing["ok"])


if __name__ == "__main__":
    unittest.main()
