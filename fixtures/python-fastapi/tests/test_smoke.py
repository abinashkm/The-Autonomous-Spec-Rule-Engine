from fastapi.testclient import TestClient

from app.main import app


def test_health() -> None:
    """Smoke test for M3+ fixture use."""
    client = TestClient(app)
    response = client.get("/health")
    assert response.status_code == 200
    assert response.json() == {"ok": True}
