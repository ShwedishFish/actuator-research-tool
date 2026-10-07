from pathlib import Path

import pytest
from fastapi.testclient import TestClient

FIXTURE_CATALOG = Path(__file__).parent / "fixtures" / "catalog"


@pytest.fixture(autouse=True)
def fixture_catalog(monkeypatch):
    monkeypatch.setenv("ACTUATOR_CATALOG_DIR", str(FIXTURE_CATALOG))


@pytest.fixture
def client(tmp_path, monkeypatch):
    monkeypatch.setenv("ACTUATOR_DATA_DIR", str(tmp_path))
    from backend.main import app

    return TestClient(app)
