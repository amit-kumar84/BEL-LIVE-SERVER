# BEL Cyber Network Operations Status — API authorization and validation tests.
from fastapi.testclient import TestClient

from app.main import app


def test_monitor_change_endpoint_requires_admin():
    with TestClient(app) as client:
        response = client.put("/api/admin/monitors", json={"monitors": []})
        assert response.status_code == 401
        assert client.get("/api/admin/session").status_code == 401


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