from __future__ import annotations

import asyncio
import http.client
import ipaddress
import re
import socket
import subprocess
import time
from collections import deque
from datetime import datetime, timezone
from typing import Any
from urllib.parse import urlparse

from .config import save_monitors
from .database import HistoryStore
from .models import MonitorConfig

DEFAULT_ALERT_REPEAT_MINUTES = 30


def utc_now() -> str:
    return datetime.now(timezone.utc).isoformat()


def down_alert_due(last_alert_at: str, now: str, repeat_minutes: int = DEFAULT_ALERT_REPEAT_MINUTES) -> bool:
    last = datetime.fromisoformat(last_alert_at)
    current = datetime.fromisoformat(now)
    return (current - last).total_seconds() >= repeat_minutes * 60


def should_emit_down_reminder(
    state: dict[str, Any], now: str, repeat_minutes: int = DEFAULT_ALERT_REPEAT_MINUTES,
) -> bool:
    return (
        state.get("status") == "down"
        and state.get("incident_id") is not None
        and bool(state.get("last_down_alert_at"))
        and down_alert_due(state["last_down_alert_at"], now, repeat_minutes)
    )


def bandwidth_delta(previous: int, current: int, elapsed_seconds: float, bits: int) -> float | None:
    if elapsed_seconds <= 0 or previous < 0 or current < 0:
        return None
    if current >= previous:
        delta = current - previous
    else:
        maximum = (1 << bits) - 1
        if previous > maximum * 0.9 and current < maximum * 0.1:
            delta = (maximum - previous) + current + 1
        else:
            return None
    return delta * 8 / elapsed_seconds


def update_state(state: dict[str, Any], raw_status: str, config: MonitorConfig) -> tuple[dict[str, Any], str | None]:
    if raw_status in ("online", "degraded"):
        state["success_count"] += 1
        state["failure_count"] = 0
        if state["status"] == "down":
            if state["success_count"] < config.recovery_threshold:
                return state, None
            state["status"] = raw_status
            state["reason"] = raw_status
            state["success_count"] = 0
            return state, "recovered"
        state["status"] = raw_status
        state["reason"] = raw_status
        return state, None
    state["reason"] = raw_status
    state["failure_count"] += 1
    state["success_count"] = 0
    if state["status"] != "down" and state["failure_count"] >= config.failure_threshold:
        state["status"] = "down"
        return state, "down"
    return state, None


async def ping(host: str, timeout_ms: int, source_ip: str | None = None) -> dict[str, Any]:
    command = ["ping", "-n", "1", "-w", str(timeout_ms)]
    if source_ip:
        command += ["-S", source_ip]
    command.append(host)
    started = time.perf_counter()
    process = None
    try:
        process = await asyncio.wait_for(
            asyncio.create_subprocess_exec(
                *command, stdout=asyncio.subprocess.PIPE, stderr=asyncio.subprocess.PIPE,
                creationflags=getattr(subprocess, "CREATE_NO_WINDOW", 0),
            ),
            timeout=timeout_ms / 1000 + 1.0,
        )
        stdout, _ = await asyncio.wait_for(process.communicate(), timeout=timeout_ms / 1000 + 1.0)
        output = stdout.decode(errors="replace")
        match = re.search(r"time(?:=|<)?\s*(?:<\s*)?(\d+(?:\.\d+)?)\s*ms", output, re.IGNORECASE)
        reachable = process.returncode == 0
        latency = float(match.group(1)) if reachable and match else (round((time.perf_counter() - started) * 1000, 2) if reachable else None)
        return {"reachable": reachable, "latency_ms": latency}
    except asyncio.CancelledError:
        if process and process.returncode is None:
            process.kill()
            await process.communicate()
        raise
    except (OSError, asyncio.TimeoutError, ValueError):
        return {"reachable": False, "latency_ms": None}


async def tcp_check(host: str, port: int, timeout_ms: int, source_ip: str | None = None) -> bool:
    try:
        local_addr = (source_ip, 0) if source_ip else None
        reader, writer = await asyncio.wait_for(asyncio.open_connection(host, port, local_addr=local_addr), timeout_ms / 1000)
        writer.close()
        await writer.wait_closed()
        return True
    except (OSError, asyncio.TimeoutError, socket.gaierror):
        return False


async def http_check(url: str, timeout_ms: int, source_ip: str | None = None) -> bool:
    def request() -> bool:
        connection = None
        try:
            parsed = urlparse(url)
            host = parsed.hostname
            if not host:
                return False
            port = parsed.port or (443 if parsed.scheme == "https" else 80)
            source_address = (source_ip, 0) if source_ip else None
            if parsed.scheme == "https":
                connection = http.client.HTTPSConnection(host, port, timeout=timeout_ms / 1000, source_address=source_address)
            else:
                connection = http.client.HTTPConnection(host, port, timeout=timeout_ms / 1000, source_address=source_address)
            path = parsed.path or "/"
            if parsed.query:
                path += f"?{parsed.query}"
            connection.request("GET", path, headers={"User-Agent": "BEL-CyberNOC/1.0"})
            response = connection.getresponse()
            return 200 <= response.status < 400
        except Exception:
            return False
        finally:
            if connection:
                connection.close()
    return await asyncio.to_thread(request)


async def snmp_counters(config: MonitorConfig) -> tuple[int, int] | None:
    if not config.snmp.enabled:
        return None
    try:
        from pysnmp.hlapi.v3arch.asyncio import (
            CommunityData, ContextData, ObjectIdentity, ObjectType, SnmpEngine,
            UdpTransportTarget, get_cmd,
        )
        engine = SnmpEngine()
        target = await UdpTransportTarget.create((config.snmp.host, config.snmp.port), timeout=config.timeout_ms / 1000, retries=0)
        interface = config.snmp.interface_index
        base = "1.3.6.1.2.1.31.1.1.1" if config.snmp.counter_bits == 64 else "1.3.6.1.2.1.2.2.1"
        in_oid = f"{base}.{6 if config.snmp.counter_bits == 64 else 10}.{interface}"
        out_oid = f"{base}.{10 if config.snmp.counter_bits == 64 else 16}.{interface}"
        result = await get_cmd(
            engine, CommunityData(config.snmp.community, mpModel=1), target, ContextData(),
            ObjectType(ObjectIdentity(in_oid)), ObjectType(ObjectIdentity(out_oid)),
        )
        error_indication, error_status, _, var_binds = result
        if error_indication or error_status:
            return None
        return int(var_binds[0][1]), int(var_binds[1][1])
    except Exception:
        return None


class MonitorEngine:
    def __init__(self, monitors: list[MonitorConfig], store: HistoryStore, publish):
        self.monitors = {monitor.id: monitor for monitor in monitors}
        self.store = store
        self.publish = publish
        self.tasks: dict[str, asyncio.Task] = {}
        self.state: dict[str, dict[str, Any]] = {}
        self.bandwidth_previous: dict[str, tuple[int, int, float]] = {}
        self.running = False

    def _initial_state(self, monitor: MonitorConfig) -> dict[str, Any]:
        previous = self.store.recent_samples(monitor.id, 1)
        status = previous[-1]["status"] if previous else "unknown"
        reason = status
        if status in ("gateway_down", "upstream_down", "application_down"):
            status = "down"
        incident = self.store.open_incident(monitor.id)
        started_at = incident["occurred_at"] if incident else None
        latest_reminder = self.store.latest_reminder(monitor.id, started_at) if started_at else None
        if incident:
            status = "down"
            reason = incident["detail"].lower().replace(" ", "_")
        return {"status": status if status != "unknown" else "unknown", "reason": reason,
                "failure_count": 0, "success_count": 0,
                "loss_window": deque(maxlen=20),
                "incident_id": incident["id"] if incident else None,
                "down_started_at": started_at,
                "last_down_alert_at": latest_reminder or started_at}

    async def start(self) -> None:
        self.running = True
        await self.reconfigure(list(self.monitors.values()))

    async def stop(self) -> None:
        self.running = False
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        self.tasks.clear()

    async def reconfigure(self, monitors: list[MonitorConfig]) -> None:
        for task in self.tasks.values():
            task.cancel()
        await asyncio.gather(*self.tasks.values(), return_exceptions=True)
        self.tasks.clear()
        self.monitors = {monitor.id: monitor for monitor in monitors}
        self.state = {key: self.state.get(key, self._initial_state(value)) for key, value in self.monitors.items()}
        if self.running:
            for monitor in self.monitors.values():
                if monitor.enabled:
                    self.tasks[monitor.id] = asyncio.create_task(self._run_monitor(monitor), name=f"monitor-{monitor.id}")

    def snapshot(self) -> dict[str, Any]:
        monitors = []
        for monitor in self.monitors.values():
            state = self.state.get(monitor.id, {})
            samples = self.store.recent_samples(monitor.id)
            latest = samples[-1] if samples else None
            visible_status = "disabled" if not monitor.enabled else (
                state.get("reason") if state.get("status") == "down" else state.get("status", "unknown")
            )
            monitors.append({
                "config": monitor.model_dump(mode="json"),
                "status": visible_status,
                "failure_count": state.get("failure_count", 0),
                "last_check": latest.get("checked_at") if latest else None,
                "gateway_reachable": latest.get("gateway_reachable") if latest else None,
                "target_reachable": latest.get("target_reachable") if latest else None,
                "gateway_latency_ms": latest.get("gateway_latency_ms") if latest else None,
                "latency_ms": latest.get("latency_ms") if latest else None,
                "packet_loss_pct": latest.get("packet_loss_pct") if latest else None,
                "rx_bps": latest.get("rx_bps") if latest else None,
                "tx_bps": latest.get("tx_bps") if latest else None,
                "uptime_pct_24h": self.store.uptime_pct(monitor.id),
                "route_strategy": "source-address" if monitor.source_ip else "windows-default-route",
                "history": samples,
            })
        return {"monitors": monitors, "events": self.store.recent_events(), "server_time": utc_now()}

    async def _run_monitor(self, monitor: MonitorConfig) -> None:
        state = self.state.setdefault(monitor.id, self._initial_state(monitor))
        while True:
            started = time.monotonic()
            try:
                gateway, target = await asyncio.gather(
                    ping(monitor.gateway_ip, monitor.timeout_ms, monitor.source_ip),
                    ping(monitor.target, monitor.timeout_ms, monitor.source_ip),
                )
                application_ok: bool | None = None
                if monitor.tcp_port:
                    application_ok = await tcp_check(monitor.target, monitor.tcp_port, monitor.timeout_ms, monitor.source_ip)
                if monitor.http_url:
                    application_ok = await http_check(monitor.http_url, monitor.timeout_ms, monitor.source_ip)
                if not gateway["reachable"]:
                    raw_status = "gateway_down"
                elif not target["reachable"]:
                    raw_status = "upstream_down"
                elif application_ok is False:
                    raw_status = "application_down"
                elif target["latency_ms"] is not None and target["latency_ms"] > monitor.latency_warning_ms:
                    raw_status = "degraded"
                else:
                    raw_status = "online"

                loss_window = state["loss_window"]
                loss_window.append(0 if target["reachable"] else 100)
                loss = sum(loss_window) / len(loss_window)
                if raw_status == "online" and loss >= monitor.packet_loss_warning_pct and loss > 0:
                    raw_status = "degraded"
                counters = await snmp_counters(monitor)
                rx_bps = tx_bps = None
                if counters:
                    now = time.monotonic()
                    previous = self.bandwidth_previous.get(monitor.id)
                    if previous:
                        prior_rx, prior_tx, prior_at = previous
                        rx_bps = bandwidth_delta(prior_rx, counters[0], now - prior_at, monitor.snmp.counter_bits)
                        tx_bps = bandwidth_delta(prior_tx, counters[1], now - prior_at, monitor.snmp.counter_bits)
                    self.bandwidth_previous[monitor.id] = (counters[0], counters[1], now)

                state, transition = update_state(state, raw_status, monitor)
                checked_at = utc_now()
                record_status = state.get("reason") if state["status"] == "down" else state["status"]
                if record_status == "unknown":
                    record_status = raw_status
                sample = {
                    "monitor_id": monitor.id, "checked_at": checked_at, "status": record_status,
                    "gateway_reachable": int(gateway["reachable"]), "target_reachable": int(target["reachable"]),
                    "gateway_latency_ms": gateway["latency_ms"], "latency_ms": target["latency_ms"],
                    "packet_loss_pct": loss, "rx_bps": rx_bps, "tx_bps": tx_bps,
                }
                self.store.save_sample(sample)
                if transition:
                    event = {
                        "monitor_id": monitor.id, "monitor_name": monitor.name, "occurred_at": checked_at,
                        "kind": transition, "detail": raw_status.replace("_", " ").upper(),
                    }
                    event["id"] = self.store.save_event(event)
                    if transition == "down":
                        state["incident_id"] = event["id"]
                        state["down_started_at"] = checked_at
                        state["last_down_alert_at"] = checked_at
                    if transition == "recovered":
                        self.store.resolve_open_event(monitor.id, checked_at)
                        state["incident_id"] = None
                        state["down_started_at"] = None
                        state["last_down_alert_at"] = None
                    await self.publish({"type": "event", "event": event})
                if should_emit_down_reminder(state, checked_at, monitor.alert_repeat_minutes):
                    reminder = {
                        "monitor_id": monitor.id,
                        "monitor_name": monitor.name,
                        "occurred_at": checked_at,
                        "kind": "alert_reminder",
                        "detail": "DOWN REMINDER",
                    }
                    reminder["id"] = self.store.save_alert_reminder(
                        monitor.id, state["incident_id"], checked_at,
                    )
                    state["last_down_alert_at"] = checked_at
                    await self.publish({"type": "alert_reminder", "event": reminder})
                await self.publish({"type": "snapshot", "data": self.snapshot()})
            except asyncio.CancelledError:
                raise
            except Exception as error:
                await self.publish({"type": "engine_error", "monitor_id": monitor.id, "message": type(error).__name__})
            delay = max(0, monitor.interval_seconds - (time.monotonic() - started))
            await asyncio.sleep(delay)