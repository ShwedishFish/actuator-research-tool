from backend.schemas import SelectionIn
from backend.selection import select
from backend.store import load_seed


def test_selection_ranks_closest_fit_first():
    r = select(load_seed(), SelectionIn(kind="linear", peak_force_n=400, stroke_mm=100, actuation="electric"))
    ids = [c["actuator"]["id"] for c in r["feasible"]]
    assert ids[0] == "example-lead-screw-500n"
    assert "example-belt-stage-300n" in [c["actuator"]["id"] for c in r["rejected"]]


def test_selection_reports_issues():
    r = select(load_seed(), SelectionIn(kind="rotary", peak_torque_nm=5, speed_rpm=3000))
    assert not any(c["actuator"]["id"] == "example-gearmotor-20nm" for c in r["feasible"])
    gear = next(c for c in r["rejected"] if c["actuator"]["id"] == "example-gearmotor-20nm")
    assert any("Speed" in issue for issue in gear["issues"])


def test_selection_filters_by_kind():
    r = select(load_seed(), SelectionIn(kind="rotary"))
    assert all(c["actuator"]["kind"] == "rotary" for c in r["feasible"] + r["rejected"])
