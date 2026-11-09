"""HTTP surface: state snapshot, SSE stream, message threads, pane capture, and tmux jump."""

import asyncio
import json
from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from . import panes
from .fleet import Fleet

WEB_DIR = Path(__file__).resolve().parents[2] / "web"
POLL_SECONDS = 2.0

app = FastAPI(title="claude-session-monitor")
_fleet = Fleet()


@app.get("/api/state")
def state() -> dict:
    return _fleet.snapshot()


@app.get("/api/stream")
async def stream() -> StreamingResponse:
    async def frames():
        while True:
            # The snapshot touches the filesystem, so it runs off the event loop.
            payload = await asyncio.to_thread(_fleet.snapshot)
            yield f"data: {json.dumps(payload)}\n\n"
            await asyncio.sleep(POLL_SECONDS)

    return StreamingResponse(frames(), media_type="text/event-stream", headers={
        "Cache-Control": "no-store",
        "X-Accel-Buffering": "no",
    })


@app.get("/api/sessions/{session_id}/messages")
def messages(session_id: str) -> dict:
    return {"messages": _fleet.messages(session_id)}


@app.get("/api/threads/{session_id}/{peer_id}")
def thread(session_id: str, peer_id: str) -> dict:
    return {"messages": _fleet.thread(session_id, peer_id)}


@app.post("/api/sessions/{session_id}/jump")
def jump(session_id: str) -> dict:
    target = _fleet.session_of(session_id)
    if target is None or target.get("exited"):
        raise HTTPException(status_code=404, detail="session không còn chạy")
    ok, detail = panes.jump(target["tmux"])
    if not ok:
        raise HTTPException(status_code=409, detail=detail)
    return {"ok": True}


@app.get("/api/sessions/{session_id}/pane")
def capture_pane(session_id: str) -> dict:
    target = _fleet.session_of(session_id)
    if target is None:
        return {"ok": False, "text": "", "detail": "Phiên không còn trong danh sách"}
    if not target.get("tmux"):
        return {
            "ok": False,
            "text": "",
            "detail": "Phiên này được khởi chạy ngoài tmux nên không thể chụp màn hình pane",
        }
    ok, output = panes.capture(target["tmux"])
    if not ok:
        return {"ok": False, "text": "", "detail": output}
    return {"ok": True, "text": output, "detail": ""}


@app.post("/api/health/refresh")
def refresh_health() -> dict:
    """Re-run the MCP health check. It starts every configured server, so this
    is only ever triggered by hand."""
    _fleet.refresh_health()
    return {"ok": True}


@app.get("/")
def index() -> FileResponse:
    return FileResponse(WEB_DIR / "index.html")


app.mount("/static", StaticFiles(directory=WEB_DIR), name="static")
