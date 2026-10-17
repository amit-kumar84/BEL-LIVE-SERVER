from __future__ import annotations

import asyncio
from datetime import datetime, timezone
from pathlib import Path
from typing import Any

import psutil


class SystemMetrics:
    def __init__(self, data_path: Path):
        self.data_path = data_path
        self._task: asyncio.Task | None = None
        self._values: dict[str, Any] = {
            "cpu_percent": None,
            "ram_used_bytes": None,
            "ram_total_bytes": None,
            "ram_percent": None,
            "storage_used_bytes": None,
            "storage_total_bytes": None,
            "storage_percent": None,
            "sampled_at": None,
        }

    async def start(self) -> None:
        self._task = asyncio.create_task(self._sample_loop(), name="system-metrics")

    async def stop(self) -> None:
        if self._task:
            self._task.cancel()
            await asyncio.gather(self._task, return_exceptions=True)
            self._task = None

    def snapshot(self) -> dict[str, Any]:
        return dict(self._values)

    async def _sample_loop(self) -> None:
        while True:
            try:
                cpu_percent = await asyncio.to_thread(psutil.cpu_percent, 1.0)
                memory = psutil.virtual_memory()
                storage = psutil.disk_usage(str(self.data_path))
                self._values = {
                    "cpu_percent": cpu_percent,
                    "ram_used_bytes": memory.used,
                    "ram_total_bytes": memory.total,
                    "ram_percent": memory.percent,
                    "storage_used_bytes": storage.used,
                    "storage_total_bytes": storage.total,
                    "storage_percent": storage.percent,
                    "sampled_at": datetime.now(timezone.utc).isoformat(),
                }
            except asyncio.CancelledError:
                raise
            except (OSError, RuntimeError, ValueError):
                self._values = {
                    "cpu_percent": None,
                    "ram_used_bytes": None,
                    "ram_total_bytes": None,
                    "ram_percent": None,
                    "storage_used_bytes": None,
                    "storage_total_bytes": None,
                    "storage_percent": None,
                    "sampled_at": datetime.now(timezone.utc).isoformat(),
                }
            await asyncio.sleep(2)