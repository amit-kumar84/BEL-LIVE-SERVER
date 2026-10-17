from __future__ import annotations

import asyncio
import hmac
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse

from .audio import list_audio_files, safe_audio_file
from .config import AUDIO_DIR, CONFIG_PATH, DATA_DIR, DATABASE_PATH, ensure_admin_password, load_monitors, save_monitors
from .database import HistoryStore
from .models import AdminLogin, AudioTest, MonitorConfig, MonitorList
from .monitoring import MonitorEngine


class LocalBus:
    def __init__(self):
        self.clients: set[asyncio.Queue] = set()

    async def publish(self, message: dict):
        for queue in tuple(self.clients):
            if queue.full():
                try:
                    queue.get_nowait()
                except asyncio.QueueEmpty:
                    pass
            try:
                queue.put_nowait(message)
            except asyncio.QueueFull:
                pass


@asynccontextmanager
async def lifespan(app: FastAPI):
    password = ensure_admin_password()
    app.state.admin_password = password
    app.state.sessions = set()
    app.state.login_attempts = {}
    app.state.bus = LocalBus()
    app.state.store = HistoryStore(DATABASE_PATH)
    app.state.engine = MonitorEngine(load_monitors(), app.state.store, app.state.bus.publish)
    await app.state.engine.start()
    print(f"BEL CyberNOC API ready on loopback. Monitor config: {CONFIG_PATH}")
    if not Path(".env").exists():
        print(f"Admin password is stored in {DATA_DIR / 'admin.password'}; keep this file private.")
    yield
    await app.state.engine.stop()


app = FastAPI(title="BEL CyberNOC Local API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)


def require_loopback(request: Request) -> None:
    if not request.client or request.client.host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(status_code=403, detail="Loopback clients only")


async def require_admin(request: Request, authorization: str | None = Header(default=None)) -> str:
    require_loopback(request)
    token = authorization.removeprefix("Bearer ") if authorization else ""
    if not token or token not in request.app.state.sessions:
        raise HTTPException(status_code=401, detail="Admin sign-in required")
    return token


@app.get("/api/health")
async def health(request: Request):
    require_loopback(request)
    return {"ok": True, "mode": "live", "bind": "127.0.0.1"}


@app.post("/api/admin/login")
async def login(payload: AdminLogin, request: Request):
    require_loopback(request)
    attempts = request.app.state.login_attempts.setdefault(request.client.host, deque())
    now = time.monotonic()
    while attempts and now - attempts[0] > 60:
        attempts.popleft()
    if len(attempts) >= 5:
        raise HTTPException(status_code=429, detail="Too many sign-in attempts; retry in one minute")
    if not hmac.compare_digest(payload.password, request.app.state.admin_password):
        attempts.append(now)
        raise HTTPException(status_code=401, detail="Incorrect admin password")
    attempts.clear()
    token = secrets.token_urlsafe(32)
    request.app.state.sessions.add(token)
    return {"token": token}


@app.get("/api/admin/session")
async def admin_session(_: str = Depends(require_admin)):
    return {"authenticated": True}


@app.post("/api/admin/logout")
async def logout(request: Request, token: str = Depends(require_admin)):
    request.app.state.sessions.discard(token)
    return {"ok": True}


@app.get("/api/dashboard")
async def dashboard(request: Request):
    require_loopback(request)
    return request.app.state.engine.snapshot()


@app.get("/api/audio/files")
async def audio_files(request: Request):
    require_loopback(request)
    return {"files": list_audio_files(AUDIO_DIR)}


@app.get("/api/audio/{filename}")
async def audio_file(filename: str, request: Request):
    require_loopback(request)
    try:
        path = safe_audio_file(AUDIO_DIR, filename)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(path, media_type="audio/mpeg" if path.suffix.lower() == ".mp3" else "audio/wav", filename=path.name)


@app.post("/api/admin/audio-test")
async def audio_test(payload: AudioTest, request: Request, _: str = Depends(require_admin)):
    try:
        path = safe_audio_file(AUDIO_DIR, payload.filename)
    except (ValueError, FileNotFoundError):
        raise HTTPException(status_code=404, detail="Audio file not found")
    return FileResponse(path, media_type="audio/mpeg" if path.suffix.lower() == ".mp3" else "audio/wav")


@app.put("/api/admin/monitors")
async def replace_monitors(payload: MonitorList, request: Request, _: str = Depends(require_admin)):
    ids = [monitor.id for monitor in payload.monitors]
    if len(ids) != len(set(ids)):
        raise HTTPException(status_code=422, detail="Monitor IDs must be unique")
    save_monitors(payload.monitors)
    await request.app.state.engine.reconfigure(payload.monitors)
    return {"monitors": [item.model_dump(mode="json") for item in payload.monitors]}


@app.websocket("/api/ws")
async def websocket_feed(websocket: WebSocket):
    host = websocket.headers.get("host", "").split(":", 1)[0].strip("[]").lower()
    origin = websocket.headers.get("origin")
    origin_host = urlparse(origin).hostname if origin else None
    valid_host = host in ("127.0.0.1", "localhost", "::1")
    valid_origin = origin in ("http://127.0.0.1:5173", "http://localhost:5173") if origin else valid_host
    if not valid_host or not valid_origin:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    bus = websocket.app.state.bus
    queue: asyncio.Queue = asyncio.Queue(maxsize=5)
    bus.clients.add(queue)
    try:
        await websocket.send_json({"type": "snapshot", "data": websocket.app.state.engine.snapshot()})
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        bus.clients.discard(queue)