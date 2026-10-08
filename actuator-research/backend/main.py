from __future__ import annotations

import os
from pathlib import Path
from typing import Literal

from fastapi import Depends, FastAPI, HTTPException
from fastapi.staticfiles import StaticFiles

from backend import store
from backend.schemas import (
    Actuator,
    Kind,
    LinearSizingIn,
    Note,
    NoteIn,
    Project,
    ProjectIn,
    RotarySizingIn,
    SelectionIn,
    TransmissionSelectionIn,
)
from backend.selection import select, select_with_transmission
from backend.sizing import size_linear, size_rotary

FRONTEND_DIR = Path(__file__).resolve().parent.parent / "frontend"

app = FastAPI(title="Actuator Research Tool")


def read_only() -> bool:
    return os.environ.get("ACTUATOR_READ_ONLY", "") == "1"


def require_writable() -> None:
    if read_only():
        raise HTTPException(403, "this deployment is read-only")


@app.get("/healthz")
def healthz() -> dict:
    return {"status": "ok"}


@app.get("/api/config")
def config() -> dict:
    return {"read_only": read_only()}


@app.get("/api/actuators")
def list_actuators(
    kind: Kind | None = None,
    q: str = "",
    manufacturer: str = "",
    lead_time: Literal["", "listed"] = "",
    max_lead_time_days: float | None = None,
) -> list[Actuator]:
    terms = q.lower().split()
    rows = store.list_actuators()
    if kind:
        rows = [a for a in rows if a.kind == kind]
    if manufacturer:
        rows = [a for a in rows if a.manufacturer == manufacturer]
    if lead_time == "listed":
        rows = [a for a in rows if a.lead_time or a.lead_time_days is not None]
    if max_lead_time_days is not None:
        rows = [a for a in rows if a.lead_time_days is not None and a.lead_time_days <= max_lead_time_days]
    if terms:
        rows = [
            a
            for a in rows
            if all(
                t
                in " ".join(
                    [a.id, a.name, a.drive, a.manufacturer, a.series, a.part_number, a.actuation, a.lead_time]
                ).lower()
                for t in terms
            )
        ]
    return rows


@app.get("/api/manufacturers")
def list_manufacturers() -> list[dict]:
    counts: dict[str, int] = {}
    for a in store.list_actuators():
        counts[a.manufacturer or "(unspecified)"] = counts.get(a.manufacturer or "(unspecified)", 0) + 1
    directory = {m.name: m.model_dump() for m in store.list_manufacturers()}
    return [
        {**directory.get(name, {}), "name": name, "count": n}
        for name, n in sorted(counts.items(), key=lambda kv: kv[0].lower())
    ]


@app.get("/api/actuators/{actuator_id}")
def get_actuator(actuator_id: str) -> Actuator:
    actuator = store.get_actuator(actuator_id)
    if actuator is None:
        raise HTTPException(404, "actuator not found")
    return actuator


@app.post("/api/actuators", status_code=201, dependencies=[Depends(require_writable)])
def add_actuator(actuator: Actuator) -> Actuator:
    try:
        return store.add_actuator(actuator)
    except KeyError:
        raise HTTPException(409, f"id '{actuator.id}' already exists") from None


@app.delete("/api/actuators/{actuator_id}", status_code=204, dependencies=[Depends(require_writable)])
def delete_actuator(actuator_id: str) -> None:
    if not store.delete_actuator(actuator_id):
        raise HTTPException(404, "user-added actuator not found (seed entries cannot be deleted)")


@app.get("/api/actuators/{actuator_id}/notes")
def list_notes(actuator_id: str) -> list[Note]:
    get_actuator(actuator_id)
    return store.list_notes(actuator_id)


@app.post("/api/actuators/{actuator_id}/notes", status_code=201, dependencies=[Depends(require_writable)])
def add_note(actuator_id: str, note: NoteIn) -> Note:
    get_actuator(actuator_id)
    return store.add_note(actuator_id, note)


@app.delete("/api/notes/{note_id}", status_code=204, dependencies=[Depends(require_writable)])
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


@app.post("/api/select/transmission")
def selection_with_transmission(req: TransmissionSelectionIn) -> dict:
    try:
        return select_with_transmission(store.list_actuators(), req)
    except ValueError as exc:
        raise HTTPException(422, str(exc)) from None


@app.get("/api/projects")
def list_projects() -> list[Project]:
    return sorted(store.list_projects(), key=lambda p: p.updated_at, reverse=True)


@app.get("/api/projects/{project_id}")
def get_project(project_id: str) -> Project:
    project = store.get_project(project_id)
    if project is None:
        raise HTTPException(404, "project not found")
    return project


@app.post("/api/projects", status_code=201, dependencies=[Depends(require_writable)])
def create_project(project: ProjectIn) -> Project:
    return store.save_project(project)


@app.put("/api/projects/{project_id}", dependencies=[Depends(require_writable)])
def update_project(project_id: str, project: ProjectIn) -> Project:
    saved = store.save_project(project, project_id)
    if saved is None:
        raise HTTPException(404, "project not found")
    return saved


@app.delete("/api/projects/{project_id}", status_code=204, dependencies=[Depends(require_writable)])
def delete_project(project_id: str) -> None:
    if not store.delete_project(project_id):
        raise HTTPException(404, "project not found")


app.mount("/", StaticFiles(directory=FRONTEND_DIR, html=True), name="frontend")
