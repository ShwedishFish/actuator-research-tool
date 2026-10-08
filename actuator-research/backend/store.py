"""JSON-file persistence for the catalog, user-added actuators and research notes.

The shipped catalog is every ``*.json`` file in ``$ACTUATOR_CATALOG_DIR`` (default
``backend/data/catalog``), one file per manufacturer. Anything the user adds goes to
``$ACTUATOR_DATA_DIR`` (default ``backend/data/user``), which is gitignored.
"""

from __future__ import annotations

import json
import os
import threading
import uuid
from datetime import UTC, datetime
from functools import lru_cache
from pathlib import Path

from backend.schemas import Actuator, Note, NoteIn, Project, ProjectIn

_lock = threading.Lock()


def catalog_dir() -> Path:
    return Path(os.environ.get("ACTUATOR_CATALOG_DIR", Path(__file__).parent / "data" / "catalog"))


def data_dir() -> Path:
    path = Path(os.environ.get("ACTUATOR_DATA_DIR", Path(__file__).parent / "data" / "user"))
    path.mkdir(parents=True, exist_ok=True)
    return path


def _read(path: Path) -> list[dict]:
    if not path.exists():
        return []
    return json.loads(path.read_text(encoding="utf-8"))


def _write(path: Path, rows: list[dict]) -> None:
    tmp = path.with_suffix(".tmp")
    tmp.write_text(json.dumps(rows, indent=2), encoding="utf-8")
    tmp.replace(path)


def _user_actuators_path() -> Path:
    return data_dir() / "actuators.json"


def _notes_path() -> Path:
    return data_dir() / "notes.json"


def load_seed() -> list[Actuator]:
    paths = sorted(catalog_dir().glob("*.json"))
    return list(_load_catalog(tuple((str(p), p.stat().st_mtime_ns) for p in paths)))


@lru_cache(maxsize=4)
def _load_catalog(files: tuple[tuple[str, int], ...]) -> tuple[Actuator, ...]:
    rows: list[Actuator] = []
    for path, _mtime in files:
        rows.extend(Actuator(**row) for row in json.loads(Path(path).read_text(encoding="utf-8")))
    return tuple(rows)


def list_actuators() -> list[Actuator]:
    user = [Actuator(**row) for row in _read(_user_actuators_path())]
    return load_seed() + user


def get_actuator(actuator_id: str) -> Actuator | None:
    return next((a for a in list_actuators() if a.id == actuator_id), None)


def add_actuator(actuator: Actuator) -> Actuator:
    with _lock:
        if get_actuator(actuator.id) is not None:
            raise KeyError(actuator.id)
        saved = actuator.model_copy(update={"user_added": True})
        rows = _read(_user_actuators_path())
        rows.append(saved.model_dump())
        _write(_user_actuators_path(), rows)
        return saved


def delete_actuator(actuator_id: str) -> bool:
    with _lock:
        rows = _read(_user_actuators_path())
        kept = [r for r in rows if r["id"] != actuator_id]
        if len(kept) == len(rows):
            return False
        _write(_user_actuators_path(), kept)
        return True


def list_notes(actuator_id: str) -> list[Note]:
    return [Note(**r) for r in _read(_notes_path()) if r["actuator_id"] == actuator_id]


def add_note(actuator_id: str, note: NoteIn) -> Note:
    saved = Note(
        id=uuid.uuid4().hex[:12],
        actuator_id=actuator_id,
        created_at=datetime.now(UTC).isoformat(timespec="seconds"),
        **note.model_dump(),
    )
    with _lock:
        rows = _read(_notes_path())
        rows.append(saved.model_dump())
        _write(_notes_path(), rows)
    return saved


def _projects_path() -> Path:
    return data_dir() / "projects.json"


def _now() -> str:
    return datetime.now(UTC).isoformat(timespec="seconds")


def list_projects() -> list[Project]:
    return [Project(**r) for r in _read(_projects_path())]


def get_project(project_id: str) -> Project | None:
    return next((p for p in list_projects() if p.id == project_id), None)


def save_project(project: ProjectIn, project_id: str | None = None) -> Project | None:
    with _lock:
        rows = _read(_projects_path())
        if project_id is None:
            now = _now()
            saved = Project(id=uuid.uuid4().hex[:12], created_at=now, updated_at=now, **project.model_dump())
            rows.append(saved.model_dump())
        else:
            idx = next((i for i, r in enumerate(rows) if r["id"] == project_id), None)
            if idx is None:
                return None
            saved = Project(
                id=project_id, created_at=rows[idx]["created_at"], updated_at=_now(), **project.model_dump()
            )
            rows[idx] = saved.model_dump()
        _write(_projects_path(), rows)
        return saved


def delete_project(project_id: str) -> bool:
    with _lock:
        rows = _read(_projects_path())
        kept = [r for r in rows if r["id"] != project_id]
        if len(kept) == len(rows):
            return False
        _write(_projects_path(), kept)
        return True


def delete_note(note_id: str) -> bool:
    with _lock:
        rows = _read(_notes_path())
        kept = [r for r in rows if r["id"] != note_id]
        if len(kept) == len(rows):
            return False
        _write(_notes_path(), kept)
        return True
