# BEL Cyber Network Operations Status — SQLite history and incident persistence.
from __future__ import annotations

import sqlite3
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any


class HistoryStore:
    def __init__(self, path: Path):
        self.path = path
        self.path.parent.mkdir(parents=True, exist_ok=True)
        with self.connect() as connection:
            connection.executescript(
                """
                CREATE TABLE IF NOT EXISTS samples (
                    id INTEGER PRIMARY KEY,
                    monitor_id TEXT NOT NULL,
                    checked_at TEXT NOT NULL,
                    status TEXT NOT NULL,
                    gateway_reachable INTEGER,
                    target_reachable INTEGER,
                    gateway_latency_ms REAL,
                    latency_ms REAL,
                    packet_loss_pct REAL,
                    rx_bps REAL,
                    tx_bps REAL
                );
                CREATE INDEX IF NOT EXISTS samples_monitor_time ON samples(monitor_id, checked_at);
                CREATE TABLE IF NOT EXISTS events (
                    id INTEGER PRIMARY KEY,
                    monitor_id TEXT NOT NULL,
                    monitor_name TEXT NOT NULL,
                    occurred_at TEXT NOT NULL,
                    kind TEXT NOT NULL,
                    detail TEXT NOT NULL,
                    resolved_at TEXT
                );
                CREATE INDEX IF NOT EXISTS events_time ON events(occurred_at DESC);
                CREATE TABLE IF NOT EXISTS alert_reminders (
                    id INTEGER PRIMARY KEY,
                    monitor_id TEXT NOT NULL,
                    incident_id INTEGER NOT NULL,
                    occurred_at TEXT NOT NULL
                );
                CREATE INDEX IF NOT EXISTS reminders_monitor_incident ON alert_reminders(monitor_id, incident_id, occurred_at DESC);
                """
            )

    def connect(self) -> sqlite3.Connection:
        connection = sqlite3.connect(self.path, timeout=5)
        connection.row_factory = sqlite3.Row
        return connection

    def save_sample(self, sample: dict[str, Any]) -> None:
        with self.connect() as connection:
            connection.execute(
                """INSERT INTO samples (monitor_id, checked_at, status, gateway_reachable,
                   target_reachable, gateway_latency_ms, latency_ms, packet_loss_pct, rx_bps, tx_bps)
                   VALUES (:monitor_id, :checked_at, :status, :gateway_reachable,
                   :target_reachable, :gateway_latency_ms, :latency_ms, :packet_loss_pct, :rx_bps, :tx_bps)""",
                sample,
            )

    def save_event(self, event: dict[str, Any]) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO events (monitor_id, monitor_name, occurred_at, kind, detail) VALUES (?, ?, ?, ?, ?)",
                (event["monitor_id"], event["monitor_name"], event["occurred_at"], event["kind"], event["detail"]),
            )
            return int(cursor.lastrowid)

    def resolve_open_event(self, monitor_id: str, at: str) -> None:
        with self.connect() as connection:
            connection.execute(
                "UPDATE events SET resolved_at = ? WHERE id = (SELECT id FROM events WHERE monitor_id = ? AND kind = 'down' AND resolved_at IS NULL ORDER BY id DESC LIMIT 1)",
                (at, monitor_id),
            )

    def open_incident(self, monitor_id: str) -> dict[str, Any] | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT id, occurred_at, detail FROM events WHERE monitor_id = ? AND kind = 'down' AND resolved_at IS NULL ORDER BY id DESC LIMIT 1",
                (monitor_id,),
            ).fetchone()
        return dict(row) if row else None

    def latest_reminder(self, monitor_id: str, incident_started_at: str) -> str | None:
        with self.connect() as connection:
            row = connection.execute(
                "SELECT occurred_at FROM alert_reminders WHERE monitor_id = ? AND occurred_at >= ? ORDER BY id DESC LIMIT 1",
                (monitor_id, incident_started_at),
            ).fetchone()
        return row["occurred_at"] if row else None

    def save_alert_reminder(self, monitor_id: str, incident_id: int, occurred_at: str) -> int:
        with self.connect() as connection:
            cursor = connection.execute(
                "INSERT INTO alert_reminders (monitor_id, incident_id, occurred_at) VALUES (?, ?, ?)",
                (monitor_id, incident_id, occurred_at),
            )
            return int(cursor.lastrowid)

    def recent_samples(self, monitor_id: str, limit: int = 40) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT checked_at, status, gateway_reachable, target_reachable, gateway_latency_ms, latency_ms, packet_loss_pct, rx_bps, tx_bps FROM samples WHERE monitor_id = ? ORDER BY id DESC LIMIT ?",
                (monitor_id, limit),
            ).fetchall()
        return [dict(row) for row in reversed(rows)]

    def recent_events(self, limit: int = 20) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT id, monitor_id, monitor_name, occurred_at, kind, detail, resolved_at FROM events ORDER BY id DESC LIMIT ?",
                (limit,),
            ).fetchall()
        return [dict(row) for row in rows]

    def events_between(self, start: str, end: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT id, monitor_id, monitor_name, occurred_at, kind, detail, resolved_at "
                "FROM events WHERE occurred_at >= ? AND occurred_at < ? ORDER BY occurred_at ASC, id ASC",
                (start, end),
            ).fetchall()
        return [dict(row) for row in rows]

    def incident_rows_between(self, start: str, end: str) -> list[dict[str, Any]]:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT id, monitor_name, occurred_at, detail, resolved_at FROM events "
                "WHERE kind = 'down' AND occurred_at >= ? AND occurred_at < ? "
                "ORDER BY occurred_at ASC, id ASC",
                (start, end),
            ).fetchall()
        return [dict(row) for row in rows]

    def daily_uptime_pct(self, monitor_id: str, day_start: str, now: str) -> float | None:
        with self.connect() as connection:
            rows = connection.execute(
                "SELECT checked_at, target_reachable FROM samples "
                "WHERE monitor_id = ? AND checked_at >= ? AND checked_at <= ? ORDER BY checked_at ASC",
                (monitor_id, day_start, now),
            ).fetchall()
        if not rows:
            return None
        end_time = datetime.fromisoformat(now)
        total_seconds = 0.0
        online_seconds = 0.0
        for index, row in enumerate(rows):
            checked_at = datetime.fromisoformat(row["checked_at"])
            next_time = datetime.fromisoformat(rows[index + 1]["checked_at"]) if index + 1 < len(rows) else end_time
            seconds = max(0.0, (next_time - checked_at).total_seconds())
            total_seconds += seconds
            if row["target_reachable"] == 1:
                online_seconds += seconds
        return round(online_seconds / total_seconds * 100, 2) if total_seconds else None