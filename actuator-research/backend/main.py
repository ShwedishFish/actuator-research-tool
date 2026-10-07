from __future__ import annotations

from pathlib import Path

from fastapi import FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from backend import store
from backend.schemas import Actuator, Kind, LinearSizingIn, Note, NoteIn, RotarySizingIn, SelectionIn
from backend.selection import select
from backend.sizing import size_linear, size_rotary

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Actuator Research Tool")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/actuators")
def list_actuators(kind: Kind | None = None, q: str = "", manufacturer: str = "") -> list[Actuator]:
    terms = q.lower().split()
    rows = store.list_actuators()
    if kind:
        rows = [a for a in rows if a.kind == kind]
    if manufacturer:
        rows = [a for a in rows if a.manufacturer == manufacturer]
    if terms:
        rows = [
            a
            for a in rows
            if all(
                t in " ".join([a.id, a.name, a.drive, a.manufacturer, a.series, a.part_number, a.actuation]).lower()
                for t in terms
            )
        ]
    return rows


@app.get("/api/manufacturers")
def list_manufacturers() -> list[dict]:
    counts: dict[str, int] = {}
    for a in store.list_actuators():
        counts[a.manufacturer or "(unspecified)"] = counts.get(a.manufacturer or "(unspecified)", 0) + 1
    return [{"name": name, "count": n} for name, n in sorted(counts.items(), key=lambda kv: kv[0].lower())]


@app.get("/api/actuators/{actuator_id}")
def get_actuator(actuator_id: str) -> Actuator:
    actuator = store.get_actuator(actuator_id)
    if actuator is None:
        raise HTTPException(404, "actuator not found")
    return actuator


@app.post("/api/actuators", status_code=201)
def add_actuator(actuator: Actuator) -> Actuator:
    try:
        return store.add_actuator(actuator)
    except KeyError:
        raise HTTPException(409, f"id '{actuator.id}' already exists") from None


@app.delete("/api/actuators/{actuator_id}", status_code=204)
def delete_actuator(actuator_id: str) -> None:
    if not store.delete_actuator(actuator_id):
        raise HTTPException(404, "user-added actuator not found (seed entries cannot be deleted)")


@app.get("/api/actuators/{actuator_id}/notes")
def list_notes(actuator_id: str) -> list[Note]:
    get_actuator(actuator_id)
    return store.list_notes(actuator_id)


@app.post("/api/actuators/{actuator_id}/notes", status_code=201)
def add_note(actuator_id: str, note: NoteIn) -> Note:
    get_actuator(actuator_id)
    return store.add_note(actuator_id, note)


@app.delete("/api/notes/{note_id}", status_code=204)
def delete_note(note_id: str) -> None:
    if not store.delete_note(note_id):
        raise HTTPException(404, "note not found")


@app.post("/api/sizing/linear")
def sizing_linear(inp: LinearSizingIn) -> dict:
    return size_linear(inp)


@app.post("/api/sizing/rotary")
def sizing_rotary(inp: RotarySizingIn) -> dict:
    return size_rotary(inp)


@app.post("/api/select")
def selection(req: SelectionIn) -> dict:
    return select(store.list_actuators(), req)


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
