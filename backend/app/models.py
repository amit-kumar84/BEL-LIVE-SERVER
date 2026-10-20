# BEL Cyber Network Operations Status — validated API and monitor configuration models.
from __future__ import annotations

import ipaddress
import re
from typing import Literal
from urllib.parse import urlparse
from uuid import uuid4

from pydantic import BaseModel, ConfigDict, Field, field_validator, model_validator


HOST_RE = re.compile(r"^(?=.{1,253}$)(?:[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?\.)*[a-zA-Z0-9](?:[a-zA-Z0-9-]{0,61}[a-zA-Z0-9])?$")
DEFAULT_DOWN_AUDIO = "down-default-alert.mp3"
DEFAULT_RECOVERED_AUDIO = "restored-default-alert.mp3"


def validate_host(value: str) -> str:
    value = value.strip()
    try:
        ipaddress.ip_address(value)
        return value
    except ValueError:
        if not HOST_RE.fullmatch(value):
            raise ValueError("Enter a valid IPv4/IPv6 address or hostname")
        return value


class SnmpConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    enabled: bool = False
    host: str | None = None
    port: int = Field(default=161, ge=1, le=65535)
    community: str | None = Field(default=None, min_length=1, max_length=128)
    interface_index: int | None = Field(default=None, ge=1, le=2147483647)
    counter_bits: Literal[32, 64] = 64
    client_discovery_enabled: bool = False

    @field_validator("host")
    @classmethod
    def host_is_valid(cls, value: str | None) -> str | None:
        return validate_host(value) if value else value

    @model_validator(mode="after")
    def enabled_config_is_complete(self) -> "SnmpConfig":
        if self.enabled and not all((self.host, self.community, self.interface_index)):
            raise ValueError("SNMP requires host, read-only community, and interface index")
        if self.client_discovery_enabled and not all((self.host, self.community)):
            raise ValueError("SNMP client discovery requires host and read-only community")
        return self


class MonitorConfig(BaseModel):
    model_config = ConfigDict(extra="forbid")

    id: str = Field(default_factory=lambda: str(uuid4()), pattern=r"^[a-zA-Z0-9_-]{1,64}$")
    name: str = Field(min_length=1, max_length=80)
    type: Literal["sap_intranet", "internet", "server", "other"]
    custom_type: str | None = Field(default=None, max_length=40)
    enabled: bool = True
    gateway_ip: str
    target: str
    interval_seconds: int = Field(default=5, ge=2, le=300)
    timeout_ms: int = Field(default=1200, ge=100, le=15000)
    failure_threshold: int = Field(default=3, ge=1, le=20)
    recovery_threshold: int = Field(default=2, ge=1, le=20)
    latency_warning_ms: float = Field(default=150, gt=0, le=60000)
    packet_loss_warning_pct: float = Field(default=5, ge=0, le=100)
    source_ip: str | None = None
    throughput_enabled: bool = True
    active_nodes_visible: bool = True
    tcp_port: int | None = Field(default=None, ge=1, le=65535)
    http_url: str | None = Field(default=None, max_length=2048)
    snmp: SnmpConfig = Field(default_factory=SnmpConfig)
    audio_down: str | None = Field(default=DEFAULT_DOWN_AUDIO, max_length=255)
    audio_recovered: str | None = Field(default=DEFAULT_RECOVERED_AUDIO, max_length=255)
    audio_reminder: str | None = Field(default=None, max_length=255)
    alert_repeat_minutes: int = Field(default=30, ge=1, le=1440)

    @model_validator(mode="before")
    @classmethod
    def set_default_status_audio(cls, values):
        if not isinstance(values, dict):
            return values
        values = values.copy()
        if not values.get("audio_down"):
            values["audio_down"] = DEFAULT_DOWN_AUDIO
        if not values.get("audio_recovered"):
            values["audio_recovered"] = DEFAULT_RECOVERED_AUDIO
        return values

    @field_validator("gateway_ip")
    @classmethod
    def gateway_is_ip(cls, value: str) -> str:
        try:
            return str(ipaddress.ip_address(value.strip()))
        except ValueError as error:
            raise ValueError("Gateway must be an IPv4 or IPv6 address") from error

    @field_validator("target")
    @classmethod
    def target_is_valid(cls, value: str) -> str:
        return validate_host(value)

    @field_validator("source_ip")
    @classmethod
    def source_is_ip(cls, value: str | None) -> str | None:
        if value:
            return str(ipaddress.ip_address(value))
        return value

    @field_validator("http_url")
    @classmethod
    def http_url_is_local_check(cls, value: str | None) -> str | None:
        if value:
            parsed = urlparse(value)
            if parsed.scheme not in ("http", "https") or not parsed.hostname:
                raise ValueError("HTTP check URL must use http:// or https:// and include a hostname")
            validate_host(parsed.hostname)
        return value

    @field_validator("audio_down", "audio_recovered", "audio_reminder")
    @classmethod
    def audio_name_is_plain_filename(cls, value: str | None) -> str | None:
        if value and (value != value.strip() or "/" in value or "\\" in value or value in (".", "..")):
            raise ValueError("Audio mapping must be a filename, not a path")
        if value and value.rsplit(".", 1)[-1].lower() not in ("mp3", "wav"):
            raise ValueError("Only MP3 and WAV audio files are supported")
        return value


class MonitorList(BaseModel):
    monitors: list[MonitorConfig]


class AdminLogin(BaseModel):
    password: str = Field(min_length=1, max_length=256)


class AudioTest(BaseModel):
    filename: str = Field(min_length=1, max_length=255)