# BEL Cyber Network Operations Status — FastAPI application and local API routes.
from __future__ import annotations

import asyncio
import csv
import hmac
import io
import os
import secrets
import time
from collections import deque
from contextlib import asynccontextmanager
from datetime import date, datetime, timedelta, timezone
from pathlib import Path
from urllib.parse import urlparse

from fastapi import Depends, FastAPI, Header, HTTPException, Request, WebSocket, WebSocketDisconnect
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import FileResponse, StreamingResponse
from fastapi.staticfiles import StaticFiles

from .audio import audio_upload_path, list_audio_files, safe_audio_file, validate_audio_duration
from .config import AUDIO_DIR, CONFIG_PATH, DATA_DIR, DATABASE_PATH, ensure_admin_password, load_monitors, save_monitors
from .database import HistoryStore
from .models import AdminLogin, AudioTest, MonitorConfig, MonitorList
from .monitoring import MonitorEngine
from .system_metrics import SystemMetrics


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
    app.state.system_metrics = SystemMetrics(DATA_DIR)
    await app.state.system_metrics.start()

    async def publish(message: dict):
        if message.get("type") == "snapshot":
            message["data"]["system"] = app.state.system_metrics.snapshot()
        await app.state.bus.publish(message)

    app.state.engine = MonitorEngine(load_monitors(), app.state.store, publish)
    await app.state.engine.start()
    print(f"BEL CyberNOC API ready on loopback. Monitor config: {CONFIG_PATH}")
    if not Path(".env").exists():
        print(f"Admin password is stored in {DATA_DIR / 'admin.password'}; keep this file private.")
    yield
    await app.state.engine.stop()
    await app.state.system_metrics.stop()


app = FastAPI(title="BEL CyberNOC Local API", version="1.0.0", lifespan=lifespan)
app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://127.0.0.1:5173", "http://localhost:5173", "http://127.0.0.1:8000"],
    allow_credentials=False,
    allow_methods=["GET", "POST", "PUT", "DELETE"],
    allow_headers=["Content-Type", "Authorization"],
)

MAX_AUDIO_UPLOAD_BYTES = 20 * 1024 * 1024


def require_loopback(request: Request) -> None:
    if not request.client or request.client.host not in ("127.0.0.1", "::1", "localhost", "testclient"):
        raise HTTPException(status_code=403, detail="Loopback clients only")


def dashboard_snapshot(application: FastAPI) -> dict:
    snapshot = application.state.engine.snapshot()
    snapshot["system"] = application.state.system_metrics.snapshot()
    return snapshot


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
    return dashboard_snapshot(request.app)


@app.get("/api/audio/files")
async def audio_files(request: Request):
    require_loopback(request)
    return {"files": list_audio_files(AUDIO_DIR)}


@app.put("/api/admin/audio/{filename}")
async def upload_audio(filename: str, request: Request, _: str = Depends(require_admin)):
    try:
        destination = audio_upload_path(AUDIO_DIR, filename)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    content = bytearray()
    async for chunk in request.stream():
        content.extend(chunk)
        if len(content) > MAX_AUDIO_UPLOAD_BYTES:
            raise HTTPException(status_code=413, detail="Audio file exceeds the 20 MB upload limit")
    if not content:
        raise HTTPException(status_code=422, detail="Audio file is empty")
    try:
        validate_audio_duration(bytes(content), filename)
    except ValueError as error:
        raise HTTPException(status_code=422, detail=str(error)) from error

    AUDIO_DIR.mkdir(parents=True, exist_ok=True)
    temporary = AUDIO_DIR / f".upload-{secrets.token_hex(8)}.tmp"
    try:
        temporary.write_bytes(content)
        temporary.replace(destination)
    finally:
        temporary.unlink(missing_ok=True)
    return {"file": filename}


@app.get("/api/admin/incidents/export")
async def export_incidents(
    request: Request,
    start: date,
    end: date,
    _: str = Depends(require_admin),
):
    if end < start:
        raise HTTPException(status_code=422, detail="End date must not be before start date")
    if (end - start).days > 366:
        raise HTTPException(status_code=422, detail="Export range cannot exceed 366 days")
    ist = timezone(timedelta(hours=5, minutes=30), name="IST")
    start_at = datetime.combine(start, datetime.min.time(), tzinfo=ist).astimezone(timezone.utc).isoformat()
    end_at = datetime.combine(end + timedelta(days=1), datetime.min.time(), tzinfo=ist).astimezone(timezone.utc).isoformat()
    rows = request.app.state.store.incident_rows_between(start_at, end_at)
    output = io.StringIO(newline="")
    writer = csv.DictWriter(
        output,
        fieldnames=["Incident ID", "Monitor", "Down At (IST)", "Recovered At (IST)", "Total Downtime", "Detail"],
    )
    writer.writeheader()
    for row in rows:
        down_at = datetime.fromisoformat(row["occurred_at"]).astimezone(ist)
        recovered_at = datetime.fromisoformat(row["resolved_at"]).astimezone(ist) if row["resolved_at"] else None
        duration = "ONGOING"
        if recovered_at:
            seconds = max(0, int((recovered_at - down_at).total_seconds()))
            duration = f"{seconds // 3600:02d}:{(seconds % 3600) // 60:02d}:{seconds % 60:02d}"
        writer.writerow({
            "Incident ID": row["id"],
            "Monitor": row["monitor_name"],
            "Down At (IST)": down_at.strftime("%d-%m-%Y %I:%M:%S %p"),
            "Recovered At (IST)": recovered_at.strftime("%d-%m-%Y %I:%M:%S %p") if recovered_at else "—",
            "Total Downtime": duration,
            "Detail": row["detail"],
        })
    content = "\ufeff" + output.getvalue()
    output.seek(0)
    return StreamingResponse(
        iter([content]),
        media_type="text/csv",
        headers={"Content-Disposition": f'attachment; filename="cybernoc-incidents-{start.isoformat()}-to-{end.isoformat()}.csv"'},
    )


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
    for monitor in payload.monitors:
        for filename in (monitor.audio_down, monitor.audio_recovered, monitor.audio_reminder):
            if not filename:
                continue
            try:
                audio_path = safe_audio_file(AUDIO_DIR, filename)
                validate_audio_duration(audio_path)
            except (FileNotFoundError, ValueError) as error:
                raise HTTPException(status_code=422, detail=str(error)) from error
    save_monitors(payload.monitors)
    await request.app.state.engine.reconfigure(payload.monitors)
    result = [item.model_dump(mode="json") for item in payload.monitors]
    await request.app.state.bus.publish({"type": "snapshot", "data": dashboard_snapshot(request.app)})
    return {"monitors": result}


@app.websocket("/api/ws")
async def websocket_feed(websocket: WebSocket):
    host = websocket.headers.get("host", "").split(":", 1)[0].strip("[]").lower()
    origin = websocket.headers.get("origin")
    origin_host = urlparse(origin).hostname if origin else None
    valid_host = host in ("127.0.0.1", "localhost", "::1")
    valid_origin = origin in (
        "http://127.0.0.1:5173",
        "http://localhost:5173",
        "http://127.0.0.1:8000",
    ) if origin else valid_host
    if not valid_host or not valid_origin:
        await websocket.close(code=1008)
        return
    await websocket.accept()
    bus = websocket.app.state.bus
    queue: asyncio.Queue = asyncio.Queue(maxsize=5)
    bus.clients.add(queue)
    try:
        await websocket.send_json({"type": "snapshot", "data": dashboard_snapshot(websocket.app)})
        while True:
            message = await queue.get()
            await websocket.send_json(message)
    except WebSocketDisconnect:
        pass
    finally:
        bus.clients.discard(queue)


WEB_ROOT = Path(os.getenv("CYBERNOC_WEB_DIR", str(Path(__file__).resolve().parents[2] / "dist"))).resolve()
if (WEB_ROOT / "index.html").is_file():
    app.mount("/", StaticFiles(directory=WEB_ROOT, html=True), name="frontend")