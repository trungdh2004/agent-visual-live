import uvicorn

from .app import app

PORT = 4602

if __name__ == "__main__":
    print(f"claude-session-monitor → http://localhost:{PORT}")
    uvicorn.run(app, host="127.0.0.1", port=PORT, log_level="warning")
