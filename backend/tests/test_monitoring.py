import pytest

from app.audio import safe_audio_file
from app.database import HistoryStore
from app.models import MonitorConfig
from app.monitoring import bandwidth_delta, down_alert_due, should_emit_down_reminder, update_state


def config(**overrides):
    values = {
        "id": "line-a", "name": "Line A", "type": "internet",
        "gateway_ip": "192.0.2.1", "target": "198.51.100.8",
        "failure_threshold": 3, "recovery_threshold": 2,
    }
    values.update(overrides)
    return MonitorConfig.model_validate(values)


def test_config_rejects_invalid_host_and_interval():
    with pytest.raises(ValueError):
        config(target="bad host!")
    with pytest.raises(ValueError):
        config(gateway_ip="gateway.local")
    with pytest.raises(ValueError):
        config(interval_seconds=1)


def test_repeat_interval_is_configurable_and_validated():
    assert config().alert_repeat_minutes == 30
    assert config(alert_repeat_minutes=40).alert_repeat_minutes == 40
    assert config(alert_repeat_minutes=300).alert_repeat_minutes == 300
    with pytest.raises(ValueError):
        config(alert_repeat_minutes=0)
    with pytest.raises(ValueError):
        config(alert_repeat_minutes=1441)


def test_config_requires_complete_enabled_snmp_settings():
    with pytest.raises(ValueError):
        config(snmp={"enabled": True})
    configured = config(snmp={"enabled": True, "host": "192.0.2.2", "community": "readOnly", "interface_index": 2})
    assert configured.snmp.enabled


def test_reminder_audio_uses_validated_audio_filename():
    configured = config(audio_reminder="repeat.wav")
    assert configured.audio_reminder == "repeat.wav"
    with pytest.raises(ValueError):
        config(audio_reminder="..\\outside.wav")
    with pytest.raises(ValueError):
        config(audio_reminder="repeat.ogg")


def test_failure_and_recovery_threshold_transitions():
    monitor = config()
    state = {"status": "online", "failure_count": 0, "success_count": 0}
    for _ in range(2):
        state, transition = update_state(state, "upstream_down", monitor)
        assert transition is None
        assert state["status"] == "online"
    state, transition = update_state(state, "upstream_down", monitor)
    assert transition == "down"
    assert state["status"] == "down"
    state, transition = update_state(state, "online", monitor)
    assert transition is None
    assert state["status"] == "down"
    state, transition = update_state(state, "online", monitor)
    assert transition == "recovered"
    assert state["status"] == "online"


def test_failure_reason_and_alert_transition_are_deduplicated():
    state = {"status": "online", "failure_count": 0, "success_count": 0}
    for _ in range(3):
        state, transition = update_state(state, "gateway_down", config())
    assert transition == "down"
    assert state["status"] == "down"
    assert state["reason"] == "gateway_down"
    for _ in range(4):
        state, transition = update_state(state, "gateway_down", config())
        assert transition is None


def test_bandwidth_handles_counter_wrap_and_reset():
    assert bandwidth_delta(100, 300, 2, 32) == 800
    assert bandwidth_delta((1 << 32) - 20, 10, 1, 32) == 240
    assert bandwidth_delta(9000, 20, 1, 32) is None
    assert bandwidth_delta(20, 30, 0, 32) is None


def test_history_returns_gateway_and_target_reachability(tmp_path):
    store = HistoryStore(tmp_path / "history.sqlite3")
    store.save_sample({
        "monitor_id": "line-a", "checked_at": "2026-10-17T00:00:00+00:00", "status": "application_down",
        "gateway_reachable": 1, "target_reachable": 1, "gateway_latency_ms": 13.0,
        "latency_ms": 3.0, "packet_loss_pct": 0.0, "rx_bps": None, "tx_bps": None,
    })

    sample = store.recent_samples("line-a", 1)[0]

    assert sample["gateway_reachable"] == 1
    assert sample["target_reachable"] == 1
    assert sample["gateway_latency_ms"] == 13.0


def test_down_audio_reminder_interval_is_thirty_minutes():
    last_alert = "2026-10-17T00:00:00+00:00"
    assert not down_alert_due(last_alert, "2026-10-17T00:29:59+00:00", 30)
    assert down_alert_due(last_alert, "2026-10-17T00:30:00+00:00", 30)
    assert not down_alert_due(last_alert, "2026-10-17T00:39:59+00:00", 40)
    assert down_alert_due(last_alert, "2026-10-17T00:40:00+00:00", 40)
    assert down_alert_due(last_alert, "2026-10-17T05:00:00+00:00", 300)


def test_recovered_incident_does_not_repeat_down_audio():
    now = "2026-10-17T01:00:00+00:00"
    active = {"status": "down", "incident_id": 9, "last_down_alert_at": "2026-10-17T00:00:00+00:00"}
    recovered = {"status": "online", "incident_id": None, "last_down_alert_at": None}

    assert should_emit_down_reminder(active, now, 30)
    assert not should_emit_down_reminder(recovered, now, 30)


def test_reminder_persistence_does_not_add_incident_timeline_rows(tmp_path):
    store = HistoryStore(tmp_path / "history.sqlite3")
    started = "2026-10-17T00:00:00+00:00"
    reminder = "2026-10-17T00:30:00+00:00"
    incident_id = store.save_event({
        "monitor_id": "line-a", "monitor_name": "Line A", "occurred_at": started,
        "kind": "down", "detail": "UPSTREAM DOWN",
    })
    assert store.open_incident("line-a")["id"] == incident_id

    reminder_id = store.save_alert_reminder("line-a", incident_id, reminder)

    assert reminder_id > 0
    assert store.latest_reminder("line-a", started) == reminder
    assert [event["kind"] for event in store.recent_events()] == ["down"]
    store.resolve_open_event("line-a", "2026-10-17T00:35:00+00:00")
    assert store.open_incident("line-a") is None


def test_audio_path_is_confined_to_audio_folder(tmp_path):
    audio = tmp_path / "audio"
    audio.mkdir()
    clip = audio / "down.wav"
    clip.write_bytes(b"RIFF")
    assert safe_audio_file(audio, "down.wav") == clip
    with pytest.raises(ValueError):
        safe_audio_file(audio, "..\\outside.wav")
    with pytest.raises(ValueError):
        safe_audio_file(audio, "other.txt")


def test_event_identity_supports_incident_deduplication():
    announced = set()
    incident_id = "event-14"
    assert incident_id not in announced
    announced.add(incident_id)
    assert incident_id in announced