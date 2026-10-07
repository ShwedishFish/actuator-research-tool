import pytest
from fastapi.testclient import TestClient


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTUATOR_DATA_DIR", str(tmp_path))
    from backend.main import app

    return TestClient(app)
