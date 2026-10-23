# BEL Cyber Network Operations Status — local configuration and runtime paths.
from __future__ import annotations

import json
import os
from pathlib import Path

from dotenv import load_dotenv

from .models import MonitorConfig, MonitorList


ROOT = Path(__file__).resolve().parents[2]
load_dotenv(ROOT / ".env")
DATA_DIR = Path(os.getenv("CYBERNOC_DATA_DIR", str(ROOT / "data"))).resolve()
CONFIG_PATH = Path(os.getenv("CYBERNOC_CONFIG", str(DATA_DIR / "monitors.json"))).resolve()
DATABASE_PATH = Path(os.getenv("CYBERNOC_DATABASE", str(DATA_DIR / "cybernoc.sqlite3"))).resolve()
AUDIO_DIR = Path(os.getenv("CYBERNOC_AUDIO_DIR", r"C:\CyberNOC\audio")).resolve()
ADMIN_PASSWORD_PATH = DATA_DIR / "admin.password"
DEFAULT_ADMIN_PASSWORD = "hactor@3200"


def ensure_admin_password() -> str:
    configured = os.getenv("CYBERNOC_ADMIN_PASSWORD")
    if configured:
        return configured
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not ADMIN_PASSWORD_PATH.exists():
        ADMIN_PASSWORD_PATH.write_text(DEFAULT_ADMIN_PASSWORD, encoding="utf-8")
    return ADMIN_PASSWORD_PATH.read_text(encoding="utf-8").strip()


def load_monitors() -> list[MonitorConfig]:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    if not CONFIG_PATH.exists():
        example = ROOT / "config" / "monitors.example.json"
        if not example.exists():
            CONFIG_PATH.write_text('{"monitors": []}\n', encoding="utf-8")
        else:
            CONFIG_PATH.write_text(example.read_text(encoding="utf-8"), encoding="utf-8")
    payload = json.loads(CONFIG_PATH.read_text(encoding="utf-8"))
    monitors = MonitorList.model_validate({"monitors": payload.get("monitors", [])}).monitors
    ids = [monitor.id for monitor in monitors]
    if len(ids) != len(set(ids)):
        raise ValueError("Monitor IDs must be unique")
    return monitors


def save_monitors(monitors: list[MonitorConfig]) -> None:
    DATA_DIR.mkdir(parents=True, exist_ok=True)
    temporary = CONFIG_PATH.with_suffix(CONFIG_PATH.suffix + ".tmp")
    content = json.dumps({"monitors": [item.model_dump(mode="json") for item in monitors]}, indent=2) + "\n"
    temporary.write_text(content, encoding="utf-8")
    temporary.replace(CONFIG_PATH)