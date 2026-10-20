# BEL Cyber Network Operations Status — API authorization and validation tests.
import io
import wave

from fastapi.testclient import TestClient

from app import main as main_module
from app.main import app


def wav_bytes(duration_seconds: int) -> bytes:
    output = io.BytesIO()
    with wave.open(output, "wb") as audio:
        audio.setparams((1, 2, 8000, 0, "NONE", "not compressed"))
        audio.writeframes(b"\0\0" * 8000 * duration_seconds)
    return output.getvalue()


def test_monitor_change_endpoint_requires_admin():
    with TestClient(app) as client:
        response = client.put("/api/admin/monitors", json={"monitors": []})
        assert response.status_code == 401
        assert client.get("/api/admin/session").status_code == 401


def test_monitor_save_reconfigures_engine_and_returns_applied_snapshot():
    with TestClient(app) as client:
        password = app.state.admin_password
        token = client.post("/api/admin/login", json={"password": password}).json()["token"]
        response = client.put(
            "/api/admin/monitors", headers={"Authorization": f"Bearer {token}"},
            json={"monitors": []},
        )

        assert response.status_code == 200
        assert response.json()["monitors"] == []
        assert client.get("/api/dashboard").json()["monitors"] == []


def test_admin_session_validation_and_logout():
    with TestClient(app) as client:
        password = app.state.admin_password
        token = client.post("/api/admin/login", json={"password": password}).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        assert client.get("/api/admin/session", headers=headers).json() == {"authenticated": True}
        assert client.post("/api/admin/logout", headers=headers).status_code == 200
        assert client.get("/api/admin/session", headers=headers).status_code == 401


def test_invalid_monitor_payload_is_rejected():
    with TestClient(app) as client:
        password = app.state.admin_password
        response = client.post("/api/admin/login", json={"password": password})
        assert response.status_code == 200
        token = response.json()["token"]
        response = client.put(
            "/api/admin/monitors", headers={"Authorization": f"Bearer {token}"},
            json={"monitors": [{"id": "bad", "name": "Bad", "type": "invalid", "gateway_ip": "gateway.local", "target": "bad host"}]},
        )
        assert response.status_code == 422
        assert client.get("/api/dashboard").status_code == 200


def test_loopback_health_and_audio_traversal_protection():
    with TestClient(app) as client:
        assert client.get("/api/health").json()["bind"] == "127.0.0.1"
        response = client.get("/api/audio/..%5C..%5Csecret.wav")
        assert response.status_code == 404


def test_audio_upload_requires_admin_and_persists_file(tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "AUDIO_DIR", tmp_path)
    content = wav_bytes(1)
    with TestClient(app) as client:
        assert client.put("/api/admin/audio/line-down.wav", content=content).status_code == 401
        password = app.state.admin_password
        token = client.post("/api/admin/login", json={"password": password}).json()["token"]
        headers = {"Authorization": f"Bearer {token}"}
        response = client.put("/api/admin/audio/line-down.wav", content=content, headers=headers)
        assert response.status_code == 200
        assert response.json() == {"file": "line-down.wav"}
        assert (tmp_path / "line-down.wav").read_bytes() == content
        assert client.put("/api/admin/audio/line-down.exe", content=content, headers=headers).status_code == 422


def test_audio_upload_rejects_clips_longer_than_one_minute(tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "AUDIO_DIR", tmp_path)
    with TestClient(app) as client:
        password = app.state.admin_password
        token = client.post("/api/admin/login", json={"password": password}).json()["token"]
        response = client.put(
            "/api/admin/audio/too-long.wav", content=wav_bytes(61),
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 422
        assert "60 seconds" in response.json()["detail"]
        assert not (tmp_path / "too-long.wav").exists()


def test_audio_upload_reports_invalid_media_as_validation_error(tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "AUDIO_DIR", tmp_path)
    with TestClient(app) as client:
        password = app.state.admin_password
        token = client.post("/api/admin/login", json={"password": password}).json()["token"]
        response = client.put(
            "/api/admin/audio/broken.wav", content=b"not an audio file",
            headers={"Authorization": f"Bearer {token}"},
        )

        assert response.status_code == 422
        assert "valid MP3 or WAV" in response.json()["detail"]


def test_monitor_save_rejects_overlong_mapped_audio(tmp_path, monkeypatch):
    monkeypatch.setattr(main_module, "AUDIO_DIR", tmp_path)
    (tmp_path / "too-long.wav").write_bytes(wav_bytes(61))
    (tmp_path / "short.wav").write_bytes(wav_bytes(1))
    with TestClient(app) as client:
        password = app.state.admin_password
        token = client.post("/api/admin/login", json={"password": password}).json()["token"]
        response = client.put(
            "/api/admin/monitors", headers={"Authorization": f"Bearer {token}"},
            json={"monitors": [{
                "id": "line-a", "name": "Line A", "type": "internet",
                "gateway_ip": "192.168.1.1", "target": "1.1.1.1",
                "audio_down": "too-long.wav", "audio_recovered": "short.wav",
                "audio_reminder": None,
            }]},
        )

        assert response.status_code == 422
        assert "60 seconds" in response.json()["detail"]


def test_dashboard_includes_host_resource_metrics():
    with TestClient(app) as client:
        response = client.get("/api/dashboard")

    assert response.status_code == 200
    system = response.json()["system"]
    assert set(system) == {
        "cpu_percent", "ram_used_bytes", "ram_total_bytes", "ram_percent",
        "storage_used_bytes", "storage_total_bytes", "storage_percent", "sampled_at",
    }
    for key in ("cpu_percent", "ram_percent", "storage_percent"):
        assert system[key] is None or 0 <= system[key] <= 100