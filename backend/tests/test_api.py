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