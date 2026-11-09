import json
import sqlite3
import tempfile
import time
import unittest
from datetime import datetime, timezone
from pathlib import Path


class MultiAgentTelemetryTest(unittest.TestCase):
    def test_antigravity_adapter_loads_live_and_recent_sessions_with_subagents_and_transcript(self):
        from csm import antigravity

        with tempfile.TemporaryDirectory() as tmp:
            root = Path(tmp)
            db_path = root / "conversation_summaries.db"
            brain_dir = root / "brain"
            brain_dir.mkdir()

            conn = sqlite3.connect(db_path)
            conn.execute(
                """
                CREATE TABLE conversation_summaries (
                    conversation_id TEXT PRIMARY KEY,
                    title TEXT,
                    preview TEXT,
                    step_count INTEGER,
                    last_modified_time TEXT,
                    workspace_uris TEXT,
                    status TEXT,
                    source TEXT,
                    project_id TEXT,
                    agent_name TEXT,
                    parent_conversation_id TEXT,
                    nesting_depth INTEGER,
                    not_fully_idle INTEGER,
                    killed INTEGER
                )
                """
            )
            now_iso = datetime.now(timezone.utc).isoformat()
            old_iso = "2020-01-01T00:00:00+00:00"

            # 1. Parent session (live via presence lock)
            conn.execute(
                "INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "agy-parent-1",
                    "Redesign Telemetry UI",
                    "Working on phase 3",
                    42,
                    now_iso,
                    json.dumps(["file:///home/trungdh/dev/tools/claude-session-monitor"]),
                    "CASCADE_RUN_STATUS_RUNNING",
                    "ide",
                    "p1",
                    "",
                    "",
                    0,
                    1,
                    0,
                ),
            )
            # 2. Subagent child session (linked via parent_conversation_id)
            conn.execute(
                "INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "agy-child-1",
                    "",
                    "Code review done",
                    12,
                    now_iso,
                    json.dumps(["file:///home/trungdh/dev/tools/claude-session-monitor"]),
                    "CASCADE_RUN_STATUS_IDLE",
                    "ide",
                    "p1",
                    "research",
                    "agy-parent-1",
                    1,
                    0,
                    0,
                ),
            )
            # 3. Very old unrelated session (should be filtered out)
            conn.execute(
                "INSERT INTO conversation_summaries VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "agy-old-99",
                    "Ancient Session",
                    "",
                    3,
                    old_iso,
                    json.dumps(["file:///tmp"]),
                    "CASCADE_RUN_STATUS_IDLE",
                    "ide",
                    "p2",
                    "",
                    "",
                    0,
                    0,
                    0,
                ),
            )
            conn.commit()
            conn.close()

            # Create parent brain artifacts and transcript
            p_brain = brain_dir / "agy-parent-1"
            (p_brain / ".system_generated" / "logs").mkdir(parents=True)
            (p_brain / "spec_phase3.md").write_text("# Spec Phase 3")
            p_transcript = p_brain / ".system_generated" / "logs" / "transcript.jsonl"
            p_transcript.write_text(
                "\n".join([
                    json.dumps({
                        "step_index": 1,
                        "type": "USER_INPUT",
                        "created_at": "2026-11-05T10:00:00Z",
                        "content": "Hãy tích hợp Antigravity",
                    }),
                    json.dumps({
                        "step_index": 2,
                        "type": "PLANNER_RESPONSE",
                        "created_at": "2026-11-05T10:01:00Z",
                        "content": "Đang sửa fleet.py và chạy test.",
                        "tool_calls": [
                            {
                                "name": "edit_file",
                                "args": {"Path": "/home/trungdh/dev/tools/claude-session-monitor/src/csm/fleet.py"},
                            },
                            {
                                "name": "run_command",
                                "args": {"CommandLine": "pytest -q", "toolSummary": "Run unit tests"},
                            },
                            {
                                "name": "invoke_subagent",
                                "args": {
                                    "TypeName": '"research"',
                                    "Role": '"Standards Code Reviewer"',
                                    "Prompt": '"Please review src/csm/fleet.py"',
                                },
                            },
                        ],
                    }),
                ]) + "\n"
            )

            # Create child brain transcript with SYSTEM_MESSAGE from parent and send_message reply
            c_brain = brain_dir / "agy-child-1"
            (c_brain / ".system_generated" / "logs").mkdir(parents=True)
            c_transcript = c_brain / ".system_generated" / "logs" / "transcript.jsonl"
            c_transcript.write_text(
                "\n".join([
                    json.dumps({
                        "step_index": 0,
                        "type": "SYSTEM_MESSAGE",
                        "created_at": "2026-11-05T10:01:05Z",
                        "content": "<SYSTEM_MESSAGE>\n[Message] timestamp=2026-11-05T10:01:05Z sender=agy-parent-1 priority=MESSAGE_PRIORITY_HIGH content=Please review src/csm/fleet.py\n</SYSTEM_MESSAGE>",
                    }),
                    json.dumps({
                        "step_index": 1,
                        "type": "PLANNER_RESPONSE",
                        "created_at": "2026-11-05T10:02:00Z",
                        "content": "Finished review.",
                        "tool_calls": [
                            {
                                "name": "send_message",
                                "args": {
                                    "Recipient": '"agy-parent-1"',
                                    "Message": '"All standards pass with 0 violations."',
                                },
                            }
                        ],
                    }),
                ]) + "\n"
            )

            sessions = antigravity.load_sessions(
                db_path=db_path,
                brain_dir=brain_dir,
                live_locks={"agy-parent-1"},
                now=time.time(),
            )
            by_id = {s["id"]: s for s in sessions}
            self.assertIn("agy-parent-1", by_id)
            self.assertIn("agy-child-1", by_id)
            self.assertNotIn("agy-old-99", by_id)

            parent = by_id["agy-parent-1"]
            self.assertEqual(parent["provider"], "antigravity")
            self.assertEqual(parent["providerLabel"], "ANTIGRAVITY")
            self.assertEqual(parent["cwd"], "/home/trungdh/dev/tools/claude-session-monitor")
            self.assertEqual(parent["status"], "busy")
            self.assertFalse(parent["exited"])
            self.assertEqual(
                [f["path"] for f in parent["filesEdited"]],
                ["/home/trungdh/dev/tools/claude-session-monitor/src/csm/fleet.py"],
            )
            self.assertEqual(len(parent["bash"]), 1)
            self.assertEqual(parent["bash"][0]["command"], "pytest -q")
            self.assertEqual([a["name"] for a in parent["artifacts"]], ["spec_phase3.md"])

            child = by_id["agy-child-1"]
            self.assertEqual(child["parentId"], "agy-parent-1")
            self.assertEqual(child["name"], "Standards Code Reviewer")
            # Child received prompt from parent and sent report back to parent
            directions = [(m["direction"], m["peer"]) for m in child["messages"]]
            self.assertIn(("in", "agy-parent-1"), directions)
            self.assertIn(("out", "agy-parent-1"), directions)

    def test_opencode_adapter_loads_session_v2_and_session_message_telemetry(self):
        from csm import opencode

        with tempfile.TemporaryDirectory() as tmp:
            db_path = Path(tmp) / "opencode.db"
            conn = sqlite3.connect(db_path)
            conn.execute(
                """
                CREATE TABLE session_v2 (
                    id TEXT PRIMARY KEY,
                    parent_id TEXT,
                    fork_session_id TEXT,
                    slug TEXT,
                    directory TEXT,
                    title TEXT,
                    cost REAL,
                    tokens_input INTEGER,
                    tokens_output INTEGER,
                    tokens_reasoning INTEGER,
                    tokens_cache_read INTEGER,
                    tokens_cache_write INTEGER,
                    permission TEXT,
                    agent TEXT,
                    model TEXT,
                    time_created INTEGER,
                    time_updated INTEGER,
                    time_idle INTEGER,
                    idle_outcome TEXT,
                    time_archived INTEGER
                )
                """
            )
            conn.execute(
                """
                CREATE TABLE session_message (
                    id TEXT PRIMARY KEY,
                    session_id TEXT,
                    type TEXT,
                    seq INTEGER,
                    time_created INTEGER,
                    time_updated INTEGER,
                    data TEXT
                )
                """
            )

            now_ms = int(time.time() * 1000)
            # 1. Active parent session
            conn.execute(
                "INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "ses_parent_1",
                    None,
                    None,
                    "proud-garden",
                    "/home/trungdh/dev/tools/claude-session-monitor",
                    "Optimize OpenCode Adapter",
                    0.12,
                    50000,
                    2500,
                    400,
                    120000,
                    0,
                    None,
                    "build",
                    json.dumps({"id": "gpt-5.6-sol", "providerID": "openai"}),
                    now_ms - 60000,
                    now_ms - 5000,
                    now_ms - 10000,  # time_updated > time_idle -> busy
                    "succeeded",
                    None,
                ),
            )
            # 2. Subagent child session
            conn.execute(
                "INSERT INTO session_v2 VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)",
                (
                    "ses_child_1",
                    "ses_parent_1",
                    None,
                    "quick-scout",
                    "/home/trungdh/dev/tools/claude-session-monitor",
                    "Check SQLite schema",
                    0.02,
                    10000,
                    500,
                    100,
                    20000,
                    0,
                    None,
                    "explore",
                    json.dumps({"id": "gpt-5.6-sol", "providerID": "openai"}),
                    now_ms - 50000,
                    now_ms - 20000,
                    now_ms - 19000,
                    "succeeded",
                    None,
                ),
            )

            # Insert assistant message with shell, patch, and skill tools
            msg_data = {
                "time": {"created": now_ms - 6000, "completed": now_ms - 5000},
                "agent": "build",
                "content": [
                    {"type": "text", "text": "Đã cập nhật xong file fleet.py và chạy thử nghiệm."},
                    {
                        "type": "tool",
                        "name": "shell",
                        "state": {
                            "status": "completed",
                            "input": {"command": "pytest tests/test_multi_agent.py", "description": "Run tests"},
                        },
                    },
                    {
                        "type": "tool",
                        "name": "patch",
                        "state": {
                            "status": "completed",
                            "input": {
                                "patchText": "*** Begin Patch\n*** Update File: /home/trungdh/dev/tools/claude-session-monitor/src/csm/fleet.py\n@@\n"
                            },
                        },
                    },
                    {
                        "type": "tool",
                        "name": "skill",
                        "state": {"status": "completed", "input": {"id": "tdd"}},
                    },
                ],
            }
            conn.execute(
                "INSERT INTO session_message VALUES (?, ?, ?, ?, ?, ?, ?)",
                ("msg_1", "ses_parent_1", "assistant", 1, now_ms - 6000, now_ms - 5000, json.dumps(msg_data)),
            )
            conn.commit()
            conn.close()

            sessions = opencode.load_sessions(
                db_path=db_path,
                live_procs=[{"pid": 4321, "cwd": "/home/trungdh/dev/tools/claude-session-monitor", "tmux": "%9"}],
                now=now_ms / 1000.0,
            )
            by_id = {s["id"]: s for s in sessions}
            self.assertIn("ses_parent_1", by_id)
            self.assertIn("ses_child_1", by_id)

            parent = by_id["ses_parent_1"]
            self.assertEqual(parent["provider"], "opencode")
            self.assertEqual(parent["providerLabel"], "OPENCODE")
            self.assertEqual(parent["model"], "gpt-5.6-sol")
            self.assertEqual(parent["status"], "busy")
            self.assertEqual(parent["tmux"], "%9")
            self.assertTrue(parent["hasTmux"])
            self.assertEqual(parent["tokens"]["input"], 50000)
            self.assertEqual(parent["tokens"]["output"], 2500)
            self.assertEqual(parent["tokens"]["cache_read"], 120000)
            self.assertEqual(
                [f["path"] for f in parent["filesEdited"]],
                ["/home/trungdh/dev/tools/claude-session-monitor/src/csm/fleet.py"],
            )
            self.assertEqual(parent["bash"][0]["command"], "pytest tests/test_multi_agent.py")
            self.assertEqual(parent["skills"][0]["name"], "tdd")

            child = by_id["ses_child_1"]
            self.assertEqual(child["parentId"], "ses_parent_1")

    def test_fleet_unifies_claude_antigravity_and_opencode_with_subagent_wires_and_cross_agent_collisions(self):
        from unittest.mock import patch
        from csm.fleet import Fleet
        from csm.transcript import SessionTranscript

        claude_raw = [
            {
                "pid": 1111,
                "sessionId": "claude-1",
                "name": "claude-main",
                "cwd": "/home/trungdh/dev/tools/claude-session-monitor",
                "status": "busy",
                "exited": False,
                "exitedAge": 0.0,
                "tmux": "%1",
            }
        ]
        t_claude = SessionTranscript("claude-1")
        t_claude.files_edited["src/csm/fleet.py"] = {
            "path": "src/csm/fleet.py",
            "edits": 2,
            "last": "2026-11-05T10:05:00Z",
        }

        agy_cards = [
            {
                "id": "agy-parent",
                "provider": "antigravity",
                "providerLabel": "ANTIGRAVITY",
                "parentId": "",
                "name": "Antigravity Main",
                "pid": None,
                "cwd": "/home/trungdh/dev/tools/claude-session-monitor",
                "kind": "ide",
                "status": "busy",
                "exited": False,
                "exitedAge": 0.0,
                "blockedOn": "",
                "waitingFor": "",
                "startedAt": 1700000000000,
                "updatedAt": 1700000050000,
                "tmux": "",
                "hasTmux": False,
                "model": "antigravity",
                "calls": 10,
                "tokens": {"input": 0, "output": 0, "cacheRead": 0, "cacheCreate": 0},
                "context": {"used": 0, "window": 0, "percent": 0},
                "preview": "Working on fleet",
                "bash": [],
                "messages": [],
                "messageCount": 0,
                "mcp": [],
                "skills": [],
                "filesEdited": [
                    {
                        "path": "/home/trungdh/dev/tools/claude-session-monitor/src/csm/fleet.py",
                        "edits": 1,
                        "last": "2026-11-05T10:06:00Z",
                    }
                ],
                "todos": [],
                "subagents": [],
                "artifacts": [{"name": "spec_phase3.md", "path": "/tmp/spec_phase3.md"}],
            },
            {
                "id": "agy-sub-1",
                "provider": "antigravity",
                "providerLabel": "ANTIGRAVITY",
                "parentId": "agy-parent",
                "name": "Standards Reviewer",
                "pid": None,
                "cwd": "/home/trungdh/dev/tools/claude-session-monitor",
                "kind": "research",
                "status": "idle",
                "exited": False,
                "exitedAge": 0.0,
                "blockedOn": "",
                "waitingFor": "",
                "startedAt": 1700000010000,
                "updatedAt": 1700000040000,
                "tmux": "",
                "hasTmux": False,
                "model": "antigravity",
                "calls": 5,
                "tokens": {"input": 0, "output": 0, "cacheRead": 0, "cacheCreate": 0},
                "context": {"used": 0, "window": 0, "percent": 0},
                "preview": "Review complete",
                "bash": [],
                "messages": [
                    {
                        "direction": "in",
                        "peer": "agy-parent",
                        "peerSocket": "",
                        "summary": "Subagent Task Prompt",
                        "text": "Review fleet.py",
                        "at": "2026-11-05T10:01:00Z",
                    },
                    {
                        "direction": "out",
                        "peer": "agy-parent",
                        "peerSocket": "",
                        "summary": "Review Findings",
                        "text": "0 violations found.",
                        "at": "2026-11-05T10:02:00Z",
                    },
                ],
                "messageCount": 2,
                "mcp": [],
                "skills": [],
                "filesEdited": [],
                "todos": [],
                "subagents": [],
                "artifacts": [],
            },
        ]

        oc_cards = [
            {
                "id": "oc-1",
                "provider": "opencode",
                "providerLabel": "OPENCODE",
                "parentId": "",
                "name": "OpenCode Builder",
                "pid": 2222,
                "cwd": "/home/trungdh/dev/tools/claude-session-monitor",
                "kind": "build",
                "status": "idle",
                "exited": False,
                "exitedAge": 0.0,
                "blockedOn": "",
                "waitingFor": "",
                "startedAt": 1700000000000,
                "updatedAt": 1700000030000,
                "tmux": "%5",
                "hasTmux": True,
                "model": "gpt-5.6-sol",
                "calls": 4,
                "tokens": {"input": 1000, "output": 200, "cacheRead": 0, "cacheCreate": 0},
                "context": {"used": 1200, "window": 200000, "percent": 0.6},
                "preview": "Done",
                "bash": [],
                "messages": [],
                "messageCount": 0,
                "mcp": [],
                "skills": [],
                "filesEdited": [],
                "todos": [],
                "subagents": [],
                "artifacts": [],
            }
        ]

        fleet = Fleet()
        with (
            patch("csm.registry.read_sessions", return_value=claude_raw),
            patch.object(fleet._transcripts, "get", return_value=t_claude),
            patch("csm.antigravity.load_sessions", return_value=agy_cards),
            patch("csm.opencode.load_sessions", return_value=oc_cards),
        ):
            snap = fleet.snapshot()
            sessions_by_id = {s["id"]: s for s in snap["sessions"]}
            self.assertEqual(set(sessions_by_id.keys()), {"claude-1", "agy-parent", "agy-sub-1", "oc-1"})

            # 1. All 4 sessions are grouped into the same unified Git project fleet
            self.assertEqual(len(snap["groups"]), 1)
            self.assertEqual(
                set(snap["groups"][0]["sessions"]),
                {"claude-1", "agy-parent", "agy-sub-1", "oc-1"},
            )

            # 2. Cross-agent file collision detected between Claude and Antigravity on src/csm/fleet.py
            claude_conflicts = sessions_by_id["claude-1"]["conflicts"]
            agy_conflicts = sessions_by_id["agy-parent"]["conflicts"]
            self.assertEqual(len(claude_conflicts), 1)
            self.assertEqual(claude_conflicts[0]["peers"], ["Antigravity Main [ANTIGRAVITY]"])
            self.assertEqual(len(agy_conflicts), 1)
            self.assertEqual(agy_conflicts[0]["peers"], ["claude-main [CLAUDE]"])

            # 3. Directed parent -> subagent wire created between agy-parent and agy-sub-1
            edge_pairs = [(e["from"], e["to"]) for e in snap["edges"]]
            self.assertIn(("agy-parent", "agy-sub-1"), edge_pairs)
            self.assertTrue(sessions_by_id["agy-parent"]["coordinates"])
            self.assertTrue(sessions_by_id["agy-sub-1"]["receives"])
            self.assertEqual(sessions_by_id["agy-sub-1"]["tier"], 1)

            # 4. Thread between agy-parent and agy-sub-1 returns the prompt and reply
            thread_msgs = fleet.thread("agy-parent", "agy-sub-1")
            self.assertEqual(len(thread_msgs), 2)
            self.assertEqual(thread_msgs[0]["from"], "Antigravity Main")
            self.assertEqual(thread_msgs[0]["to"], "Standards Reviewer")
            self.assertEqual(thread_msgs[1]["from"], "Standards Reviewer")
            self.assertEqual(thread_msgs[1]["to"], "Antigravity Main")


if __name__ == "__main__":
    unittest.main()
