"""The 5-hour and 7-day rate-limit windows.

These exist only in the account, not on disk, so they come from the same
endpoint the Waybar module uses: the OAuth token in ~/.claude/.credentials.json
against api.anthropic.com. The token is read, sent there, and never logged.

The endpoint rate-limits its own callers, so a result is cached for a minute and
a 429 backs off for the retry-after it asks for.
"""

import json
import time
import urllib.error
import urllib.request
from pathlib import Path

CREDENTIALS = Path.home() / ".claude" / ".credentials.json"
CACHE = Path.home() / ".cache" / "claude-session-monitor" / "usage.json"
STALE_AFTER = 1800.0
ENDPOINT = "https://api.anthropic.com/api/oauth/usage"
WINDOWS = (("five_hour", "5 giờ"), ("seven_day", "7 ngày"))
CACHE_SECONDS = 60


class UsageWindows:
    def __init__(self):
        self._limits: list[dict] = []
        self._fetched_at = 0.0
        self._retry_after = 0.0
        self._status = ""
        self._load()

    def _load(self) -> None:
        try:
            saved = json.loads(CACHE.read_text())
        except (OSError, ValueError):
            return
        if time.time() - float(saved.get("fetchedAt") or 0) < STALE_AFTER:
            self._limits = saved.get("windows") or []
            self._fetched_at = 0.0  # cached for display, still due a refresh

    def _save(self) -> None:
        try:
            CACHE.parent.mkdir(parents=True, exist_ok=True)
            CACHE.write_text(json.dumps({"windows": self._limits,
                                         "fetchedAt": self._fetched_at}))
        except OSError:
            pass

    def read(self) -> dict:
        now = time.time()
        if now < self._retry_after or now - self._fetched_at < CACHE_SECONDS:
            return self._snapshot(stale=bool(self._limits) and now < self._retry_after)
        token, expires = self._credentials()
        if not token:
            self._status = "chưa đăng nhập"
            return self._snapshot(stale=False)
        if expires and expires < now * 1000:
            self._status = "token hết hạn"
            return self._snapshot(stale=bool(self._limits))
        try:
            payload = self._fetch(token)
        except urllib.error.HTTPError as error:
            wait = 60
            try:
                wait = max(1, int(error.headers.get("retry-after", wait)))
            except (TypeError, ValueError, AttributeError):
                pass
            if error.code == 429:
                self._retry_after = now + wait
            self._status = f"API lỗi {error.code}"
            return self._snapshot(stale=bool(self._limits))
        except (OSError, ValueError, urllib.error.URLError):
            self._status = "không gọi được API"
            return self._snapshot(stale=bool(self._limits))
        limits = []
        for key, label in WINDOWS:
            bucket = payload.get(key)
            if isinstance(bucket, dict) and bucket.get("utilization") is not None:
                limits.append({
                    "label": label,
                    "percent": max(0.0, min(100.0, float(bucket["utilization"]))),
                    "resets_at": str(bucket.get("resets_at") or ""),
                })
        self._limits = limits
        self._fetched_at = now
        self._status = ""
        self._save()
        return self._snapshot(stale=False)

    def _snapshot(self, stale: bool) -> dict:
        return {"windows": self._limits, "stale": stale, "status": self._status}

    @staticmethod
    def _credentials() -> tuple[str, int]:
        try:
            raw = json.loads(CREDENTIALS.read_text())
        except (OSError, ValueError):
            return "", 0
        oauth = raw.get("claudeAiOauth")
        if not isinstance(oauth, dict):
            return "", 0
        return str(oauth.get("accessToken") or ""), int(oauth.get("expiresAt") or 0)

    @staticmethod
    def _fetch(token: str) -> dict:
        request = urllib.request.Request(ENDPOINT, headers={
            "Authorization": f"Bearer {token}",
            "anthropic-beta": "oauth-2025-04-20",
            "Accept": "application/json",
        })
        with urllib.request.urlopen(request, timeout=4) as response:
            payload = json.load(response)
        return payload if isinstance(payload, dict) else {}
