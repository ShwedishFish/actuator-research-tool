NEW = {
    "id": "my-test-actuator",
    "name": "Test actuator",
    "kind": "linear",
    "actuation": "electric",
    "peak_force_n": 800,
}


def test_healthz_and_index(client):
    assert client.get("/healthz").json() == {"status": "ok"}
    assert "Actuator Research Tool" in client.get("/").text


def test_catalog_filter(client):
    rotary = client.get("/api/actuators", params={"kind": "rotary"}).json()
    assert rotary and all(a["kind"] == "rotary" for a in rotary)
    assert [a["id"] for a in client.get("/api/actuators", params={"q": "nema"}).json()] == ["example-stepper-nema23"]
    assert [a["id"] for a in client.get("/api/actuators", params={"q": "stepper nema"}).json()] == [
        "example-stepper-nema23"
    ]


def test_manufacturer_filter(client):
    client.post("/api/actuators", json={**NEW, "manufacturer": "Acme"})
    assert {"name": "Acme", "count": 1} in client.get("/api/manufacturers").json()
    assert [a["id"] for a in client.get("/api/actuators", params={"manufacturer": "Acme"}).json()] == [NEW["id"]]


def test_add_and_delete_user_actuator(client):
    assert client.post("/api/actuators", json=NEW).status_code == 201
    assert client.get(f"/api/actuators/{NEW['id']}").json()["user_added"] is True
    assert client.post("/api/actuators", json=NEW).status_code == 409
    assert client.delete(f"/api/actuators/{NEW['id']}").status_code == 204
    assert client.get(f"/api/actuators/{NEW['id']}").status_code == 404


def test_seed_actuators_cannot_be_deleted(client):
    assert client.delete("/api/actuators/example-servo-400w").status_code == 404


def test_linear_actuator_requires_force(client):
    bad = {**NEW, "peak_force_n": None}
    assert client.post("/api/actuators", json=bad).status_code == 422
    continuous_only = {**NEW, "id": "continuous-only", "peak_force_n": None, "continuous_force_n": 500}
    assert client.post("/api/actuators", json=continuous_only).status_code == 201


def test_unlisted_rating_is_unverified_not_feasible(client):
    client.post("/api/actuators", json={**NEW, "id": "cont-only", "peak_force_n": None, "continuous_force_n": 5000})
    result = client.post("/api/select", json={"kind": "linear", "peak_force_n": 100}).json()
    assert all(c["actuator"]["id"] != "cont-only" for c in result["feasible"])
    entry = next(c for c in result["unverified"] if c["actuator"]["id"] == "cont-only")
    assert entry["unlisted"] == ["Peak force"]
    assert entry["issues"] == []


def test_projects_crud(client):
    created = client.post("/api/projects", json={"name": "Lift axis", "data": {"shortlist": ["a"]}}).json()
    assert client.get("/api/projects").json()[0]["id"] == created["id"]
    updated = client.put(f"/api/projects/{created['id']}", json={"name": "Lift axis v2", "data": {}}).json()
    assert updated["name"] == "Lift axis v2"
    assert updated["created_at"] == created["created_at"]
    assert client.delete(f"/api/projects/{created['id']}").status_code == 204
    assert client.get(f"/api/projects/{created['id']}").status_code == 404


def test_transmission_selection_requires_options(client):
    assert client.post("/api/select/transmission", json={"kind": "linear", "peak_force_n": 100}).status_code == 422
    r = client.post(
        "/api/select/transmission", json={"kind": "linear", "peak_force_n": 1000, "screw_leads_mm": [5, 10]}
    ).json()
    best = r["feasible"][0]
    assert best["actuator"]["kind"] == "rotary"
    assert best["transmission"]["option"] in (5, 10)


def test_notes_roundtrip(client):
    url = "/api/actuators/example-servo-400w/notes"
    note = client.post(url, json={"text": "Quoted lead time 6 weeks"}).json()
    assert [n["text"] for n in client.get(url).json()] == ["Quoted lead time 6 weeks"]
    assert client.delete(f"/api/notes/{note['id']}").status_code == 204
    assert client.get(url).json() == []
    assert client.post("/api/actuators/nope/notes", json={"text": "x"}).status_code == 404


def test_sizing_feeds_selection(client):
    sized = client.post(
        "/api/sizing/linear", json={"payload_kg": 20, "stroke_mm": 200, "move_time_s": 2, "friction_coeff": 0.1}
    ).json()
    result = client.post("/api/select", json=sized["required"]).json()
    assert result["feasible"], result


def test_read_only_blocks_writes_but_not_sizing(client, monkeypatch):
    assert client.get("/api/config").json() == {"read_only": False}
    monkeypatch.setenv("ACTUATOR_READ_ONLY", "1")
    assert client.get("/api/config").json() == {"read_only": True}
    assert client.post("/api/actuators", json=NEW).status_code == 403
    assert client.delete("/api/actuators/example-servo-400w").status_code == 403
    assert client.post("/api/actuators/example-servo-400w/notes", json={"text": "x"}).status_code == 403
    assert client.delete("/api/notes/anything").status_code == 403
    assert client.post("/api/select", json={"kind": "linear", "peak_force_n": 100}).status_code == 200
