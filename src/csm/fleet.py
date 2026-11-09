"""Assemble one snapshot: sessions, the messages between them, and the fleets
they fall into.

Nothing here is declared. A session is a coordinator because it sent a message
to another live session, and two fleets are one fleet because a message crossed
between them - so adding or renaming a session changes the picture without
touching any config.
"""

import os
import re

from . import antigravity, opencode, projects, registry, tools
from .transcript import TranscriptStore, context_window
from .usage_api import UsageWindows

# A card carries only the opening of the last assistant turn.
PREVIEW_CHARS = 400
RECENT_EXITED_SECONDS = 1800.0
PEER_TAG_SUFFIX = re.compile(r"\s+\[[0-9a-fA-F]{4,16}\]$")


class _Directory:
    """Resolves however a transcript happens to name a peer.

    SendMessage records whatever the caller passed as `to`, and an inbound
    envelope records the sender's socket path - so the same session appears as
    a name, as /run/user/1000/cc-socks/<pid>.sock, or as that path behind a
    `uds:` prefix. A name that resolves to nothing is a subagent id or a
    session that has since exited.
    """

    def __init__(self, sessions: list[dict] | None = None):
        self._ids: dict[str, str] = {}
        self._names: dict[str, str] = {}
        for raw in sessions or []:
            sid = raw.get("sessionId") or raw.get("id")
            if sid:
                self.add(
                    sid,
                    raw.get("name") or f"pid-{raw.get('pid')}",
                    raw.get("messagingSocketPath"),
                )

    def add(self, session_id: str, name: str, socket_path: str | None) -> None:
        self._names[session_id] = name
        self._ids[session_id] = session_id
        self._ids[name] = session_id
        if socket_path:
            self._ids[socket_path] = session_id
            self._ids[f"uds:{socket_path}"] = session_id

    def resolve(self, reference: str) -> str | None:
        if not reference:
            return None
        ref = reference.strip()
        found = self._ids.get(ref) or self._ids.get(ref.removeprefix("uds:"))
        if found:
            return found
        stripped = PEER_TAG_SUFFIX.sub("", ref)
        if stripped != ref:
            return self._ids.get(stripped)
        return None

    def name_of(self, session_id: str) -> str:
        return self._names.get(session_id, session_id[:8])


def _normalize_file_path(path: str, cwd: str) -> str:
    if not path:
        return ""
    if os.path.isabs(path) or not cwd:
        return os.path.normpath(path)
    return os.path.normpath(os.path.join(cwd, path))


def _normalize_files_edited(items: list[dict], cwd: str) -> list[dict]:
    normalized: dict[str, dict] = {}
    for item in items:
        norm = _normalize_file_path(item.get("path") or "", cwd)
        if not norm:
            continue
        slot = normalized.setdefault(norm, {"path": norm, "edits": 0, "last": ""})
        slot["edits"] += int(item.get("edits") or 1)
        slot["last"] = max(slot["last"], str(item.get("last") or ""))
    return sorted(
        normalized.values(),
        key=lambda f: (f["last"], f["edits"]),
        reverse=True,
    )[:25]


class Fleet:
    def __init__(self):
        self._transcripts = TranscriptStore()
        self._usage = UsageWindows()
        self._health = tools.HealthProbe()
        self._last_sessions: dict[str, dict] = {}
        self._external_messages: dict[str, list[dict]] = {}

    def session_of(self, session_id: str) -> dict | None:
        if session_id in self._last_sessions:
            return self._last_sessions[session_id]
        for s in self.snapshot()["sessions"]:
            if s["id"] == session_id:
                return s
        return None

    def snapshot(self) -> dict:
        sessions = registry.read_sessions()
        self._transcripts.forget_except({s["sessionId"] for s in sessions if s.get("sessionId")})
        directory = _Directory(sessions)
        all_cards = []
        ext_messages: dict[str, list[dict]] = {}

        for raw in sessions:
            session_id = raw.get("sessionId")
            if not session_id:
                continue
            state = self._transcripts.get(session_id)
            name = raw.get("name") or f"pid-{raw.get('pid')}"
            window = context_window(state.model)
            cwd = raw.get("cwd") or ""
            exited = bool(raw.get("exited"))
            tmux_val = "" if exited else (raw.get("tmux") or "")

            all_cards.append({
                "id": session_id,
                "provider": "claude",
                "providerLabel": "CLAUDE",
                "parentId": "",
                "name": name,
                "pid": raw.get("pid"),
                "cwd": cwd,
                "kind": raw.get("kind") or "",
                "status": "exited" if exited else (raw.get("status") or ""),
                "exited": exited,
                "exitedAge": float(raw.get("exitedAge") or 0.0),
                "blockedOn": "" if exited else (raw.get("blockedOn") or ""),
                "waitingFor": "" if exited else (raw.get("waitingFor") or ""),
                "startedAt": raw.get("startedAt"),
                "updatedAt": raw.get("updatedAt"),
                "tmux": tmux_val,
                "hasTmux": bool(tmux_val),
                "model": state.model,
                "calls": state.calls,
                "tokens": dict(state.tokens),
                "context": {
                    "used": state.context_tokens,
                    "window": window,
                    "percent": round(100 * state.context_tokens / window, 1) if window else 0,
                },
                "preview": state.last_text[:PREVIEW_CHARS],
                "bash": list(state.bash)[-3:],
                "messageCount": len(state.messages),
                "mcp": sorted(state.mcp.values(), key=lambda t: -t["calls"]),
                "skills": sorted(state.skills.values(), key=lambda t: -t["calls"]),
                "filesEdited": _normalize_files_edited(list(state.files_edited.values()), cwd),
                "todos": list(state.todos),
                "subagents": list(state.subagents),
                "artifacts": [],
                "git": projects.git_info(cwd),
                "project": projects.project_root(cwd),
            })

        for ext in antigravity.load_sessions() + opencode.load_sessions():
            sid = ext.get("id")
            if not sid:
                continue
            cwd = ext.get("cwd") or ""
            directory.add(sid, ext.get("name") or sid[:8], None)
            msgs = list(ext.get("messages") or [])
            ext_messages[sid] = msgs
            card = {
                **ext,
                "filesEdited": _normalize_files_edited(list(ext.get("filesEdited") or []), cwd),
                "git": projects.git_info(cwd),
                "project": projects.project_root(cwd),
            }
            card.pop("messages", None)
            all_cards.append(card)

        self._external_messages = ext_messages
        all_edges = self._edges(all_cards, directory, ext_messages)
        has_edge = {e["from"] for e in all_edges} | {e["to"] for e in all_edges}

        # CSM-005: Keep live sessions, plus exited sessions that either have at least
        # one edge in the fleet OR exited within the last 30 minutes (1800s).
        cards = [
            c for c in all_cards
            if not c["exited"] or c["id"] in has_edge or c["exitedAge"] <= RECENT_EXITED_SECONDS
        ]
        kept_ids = {c["id"] for c in cards}
        edges = [e for e in all_edges if e["from"] in kept_ids and e["to"] in kept_ids]

        self._attach_collisions(cards)
        groups = self._groups(cards, edges)
        self._health.track({
            c["cwd"]
            for c in cards
            if c["cwd"] and not c["exited"] and c.get("provider") == "claude"
        })
        self._attach_tools(cards, groups)
        self._last_sessions = {c["id"]: c for c in cards}
        by_provider = {"claude": 0, "antigravity": 0, "opencode": 0}
        for c in cards:
            if not c.get("exited"):
                prov = c.get("provider") or "claude"
                by_provider[prov] = by_provider.get(prov, 0) + 1
        return {
            "sessions": cards,
            "edges": edges,
            "groups": groups,
            "usage": self._usage.read(),
            "byProvider": by_provider,
        }

    def refresh_health(self) -> None:
        self._health.refresh_now()

    @staticmethod
    def _attach_collisions(cards: list[dict]) -> None:
        """Detect files edited by two or more concurrently live sessions."""
        owners_by_path: dict[str, list[dict]] = {}
        for card in cards:
            card["conflicts"] = []
            if card.get("exited"):
                continue
            for item in card.get("filesEdited") or []:
                owners_by_path.setdefault(item["path"], []).append(card)

        for path, owners in owners_by_path.items():
            if len(owners) < 2:
                continue
            for card in owners:
                my_prov = card.get("providerLabel") or "CLAUDE"
                peers = [
                    o["name"]
                    if (o.get("providerLabel") or "CLAUDE") == my_prov
                    else f"{o['name']} [{o.get('providerLabel')}]"
                    for o in owners
                    if o["id"] != card["id"]
                ]
                card["conflicts"].append({"path": path, "peers": peers})

    def _attach_tools(self, cards: list[dict], groups: list[dict]) -> None:
        """Give every fleet the tool nodes its sessions reach, and wire each
        session to the ones it has actually called.

        A server can be configured and never used, used and no longer
        configured, or configured under a name the health check spells
        differently - so the three tiers are merged on the slug and each node
        says which tiers it appeared in.
        """
        per_group: dict[str, dict[str, dict]] = {g["key"]: {} for g in groups}
        group_of = {}
        for group in groups:
            for session_id in group["sessions"]:
                group_of[session_id] = group["key"]

        for card in cards:
            bucket = per_group.get(group_of.get(card["id"], ""), None)
            if bucket is None:
                continue
            if not card.get("exited") and card.get("provider", "claude") == "claude":
                health = self._health.for_cwd(card["cwd"])
                card["healthCheckedAt"] = health["checkedAt"]
                card["healthError"] = health.get("error", "")
                by_slug = {s["slug"]: s for s in health["servers"]}

                for entry in tools.configured(card["cwd"]) + health["servers"]:
                    node = bucket.setdefault(entry["slug"], {
                        "slug": entry["slug"], "name": entry["name"], "kind": "mcp",
                        "state": "unknown", "users": [], "calls": 0,
                    })
                    checked = by_slug.get(entry["slug"])
                    if checked:
                        node["name"] = checked["name"]
                        node["state"] = checked["state"]
                        node["detail"] = checked["detail"]
            else:
                card["healthCheckedAt"] = 0
                card["healthError"] = ""

            for used in card["mcp"]:
                key = tools.slug(used["name"])
                node = bucket.setdefault(key, {
                    "slug": key, "name": used["name"], "kind": "mcp",
                    "state": "unknown", "users": [], "calls": 0,
                })
                node["users"].append({"id": card["id"], "calls": used["calls"], "last": used["last"]})
                node["calls"] += used["calls"]

            for used in card["skills"]:
                key = "skill:" + used["name"]
                node = bucket.setdefault(key, {
                    "slug": key, "name": used["name"], "kind": "skill",
                    "state": "used", "users": [], "calls": 0,
                })
                node["users"].append({"id": card["id"], "calls": used["calls"], "last": used["last"]})
                node["calls"] += used["calls"]

        for group in groups:
            nodes = list(per_group.get(group["key"], {}).values())
            nodes.sort(key=lambda n: (n["kind"], -n["calls"], n["name"].lower()))
            group["tools"] = nodes

        pretty = {n["slug"]: n["name"] for g in groups for n in g["tools"]}
        for card in cards:
            for used in card["mcp"]:
                used["name"] = pretty.get(tools.slug(used["name"]), used["name"])

    def _messages_for(self, session_id: str) -> list[dict]:
        if session_id in self._external_messages:
            return list(self._external_messages[session_id])
        return list(self._transcripts.get(session_id).messages)

    def messages(self, session_id: str) -> list[dict]:
        """One session's own record of what it sent and received, oldest first."""
        return self._messages_for(session_id)

    def thread(self, session_id: str, peer_id: str) -> list[dict]:
        """Both halves of one conversation, oldest first.

        Each message is written to both transcripts, so the thread is built
        from what each side *sent*: taking one side's record of both
        directions would list every message of the other side twice.
        """
        directory = _Directory(registry.read_sessions())
        for sid, card in self._last_sessions.items():
            directory.add(sid, card.get("name") or sid[:8], None)

        items = []
        seen_keys: set[tuple[str, str, str, str]] = set()
        for mine, theirs in ((session_id, peer_id), (peer_id, session_id)):
            sender = directory.name_of(mine)
            receiver = directory.name_of(theirs)
            for item in self._messages_for(mine):
                resolved_peer = (
                    directory.resolve(item.get("peerSocket") or "")
                    or directory.resolve(item["peer"])
                )
                if resolved_peer != theirs:
                    continue
                if item["direction"] == "out":
                    frm, to = sender, receiver
                else:
                    frm, to = receiver, sender
                dedup_key = (frm, to, str(item.get("at") or "")[:19], str(item.get("text") or "")[:120])
                if dedup_key in seen_keys:
                    continue
                seen_keys.add(dedup_key)
                items.append({**item, "from": frm, "to": to})
        items.sort(key=lambda m: m["at"] or "")
        return items

    def _edges(
        self,
        cards: list[dict],
        directory: "_Directory",
        ext_messages: dict[str, list[dict]] | None = None,
    ) -> list[dict]:
        """One wire per pair of sessions that have exchanged messages or parent-child subagent links."""
        tally: dict[tuple[str, str], dict] = {}
        seen_stamps: set[tuple[str, str, str]] = set()
        ext_map = ext_messages or {}

        def record(src_id: str, dst_id: str, at: str) -> None:
            if not src_id or not dst_id or src_id == dst_id:
                return
            entry = tally.setdefault((src_id, dst_id),
                                     {"count": 0, "first": "", "last": ""})
            if at and (src_id, dst_id, at[:19]) in seen_stamps:
                return
            if at:
                seen_stamps.add((src_id, dst_id, at[:19]))
            entry["count"] += 1
            entry["last"] = max(entry["last"], at)
            entry["first"] = min(entry["first"] or at, at) if at else entry["first"]

        card_ids = {c["id"] for c in cards}
        for card in cards:
            cid = card["id"]
            parent_id = card.get("parentId") or ""
            if parent_id and parent_id in card_ids:
                # Ensure parent -> child edge exists even if message timestamps are empty
                record(parent_id, cid, "")

            msg_list = ext_map.get(cid) if cid in ext_map else self._transcripts.get(cid).messages
            for item in msg_list:
                at = str(item["at"] or "")
                if item["direction"] == "out":
                    peer_id = directory.resolve(item["peer"])
                    if peer_id:
                        record(cid, peer_id, at)
                elif item["direction"] == "in":
                    # Fallback via socket or name in case the sender was renamed
                    # after sending or passed a suffixed handle in `SendMessage`.
                    sender_id = (
                        directory.resolve(item.get("peerSocket") or "")
                        or directory.resolve(item["peer"])
                    )
                    if sender_id:
                        record(sender_id, cid, at)

        pairs: dict[tuple[str, str], list] = {}
        for ordered, entry in tally.items():
            pairs.setdefault(tuple(sorted(ordered)), []).append((ordered, entry))

        edges = []
        for sides in pairs.values():
            sides.sort(key=lambda side: side[1]["first"] or "~")
            (source, target), _ = sides[0]
            edges.append({
                "from": source,
                "to": target,
                "count": sum(side[1]["count"] for side in sides),
                "last": max(side[1]["last"] for side in sides),
                "mutual": len(sides) > 1,
            })
        return edges

    @staticmethod
    def _groups(cards: list[dict], edges: list[dict]) -> list[dict]:
        """Fleets, each laid out in tiers: a session nobody messages sits on the
        top row, everything it messages sits below it."""
        parent = {card["id"]: card["project"] for card in cards}
        root: dict[str, str] = {}

        def find(key: str) -> str:
            while root.setdefault(key, key) != key:
                root[key] = root[root[key]]
                key = root[key]
            return key

        def union(a: str, b: str) -> None:
            ra, rb = find(a), find(b)
            if ra != rb:
                root[ra] = rb

        for key in set(parent.values()):
            find(key)
        for edge in edges:
            union(parent[edge["from"]], parent[edge["to"]])

        members: dict[str, list[dict]] = {}
        for card in cards:
            members.setdefault(find(card["project"]), []).append(card)

        out = []
        for key, group_cards in members.items():
            ids = {c["id"] for c in group_cards}
            inbound = {c["id"]: 0 for c in group_cards}
            outbound = {c["id"]: 0 for c in group_cards}
            for edge in edges:
                if edge["from"] in ids and edge["to"] in ids:
                    inbound[edge["to"]] += 1
                    outbound[edge["from"]] += 1
            tiers = _tier_by_depth(ids, edges, inbound)
            for card in group_cards:
                card["coordinates"] = outbound[card["id"]] > 0
                card["receives"] = inbound[card["id"]] > 0
                card["tier"] = tiers[card["id"]]
            label = key.rsplit("/", 1)[-1] or key
            out.append({
                "key": key,
                "label": label,
                "path": key,
                "sessions": sorted(
                    (c["id"] for c in group_cards),
                    key=lambda i: next(c["name"] for c in group_cards if c["id"] == i),
                ),
                "waiting": sum(1 for c in group_cards if c["status"] == "waiting" and not c.get("exited")),
                "tiers": max(tiers[c["id"]] for c in group_cards) + 1 if group_cards else 0,
            })
        out.sort(key=lambda g: g["label"].lower())
        return out


def _tier_by_depth(ids: set[str], edges: list[dict], inbound: dict[str, int]) -> dict[str, int]:
    """Longest path from any source, so a chain A->B->C reads as three rows."""
    tier = {i: 0 for i in ids}
    links = [(e["from"], e["to"]) for e in edges
             if e["from"] in ids and e["to"] in ids]
    sources = {i for i in ids if inbound.get(i, 0) == 0}
    for _ in range(len(ids)):
        changed = False
        for src_id, dst_id in links:
            if dst_id in sources:
                continue  # a source stays on the top row even inside a cycle
            if tier[dst_id] < tier[src_id] + 1:
                tier[dst_id] = tier[src_id] + 1
                changed = True
        if not changed:
            break
    return tier
