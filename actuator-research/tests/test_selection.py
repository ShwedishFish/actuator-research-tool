import math

import pytest

from backend.schemas import Actuator, SelectionIn, TransmissionSelectionIn
from backend.selection import evaluate, motor_requirement, select, select_with_transmission, theoretical_extend_force_n
from backend.store import load_seed


def _act(**kw):
    base = {"id": "t", "name": "t", "kind": "linear", "actuation": "electric", "peak_force_n": 1000}
    return Actuator(**{**base, **kw})


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
    assert all(c["actuator"]["kind"] == "rotary" for c in r["feasible"] + r["unverified"] + r["rejected"])


def test_no_load_speed_warns():
    r = evaluate(_act(max_speed_mm_s=50, speed_condition="no-load"), SelectionIn(kind="linear", speed_mm_s=20))
    assert r["status"] == "feasible"
    assert any("no-load" in w for w in r["warnings"])


def test_warned_parts_rank_after_clean_fits():
    clean = _act(id="clean", peak_force_n=2000)
    stall = _act(id="stall", peak_force_n=600, peak_basis="stall")
    r = select([clean, stall], SelectionIn(kind="linear", peak_force_n=500))
    assert [c["actuator"]["id"] for c in r["feasible"]] == ["clean", "stall"]


def test_filters_unlisted_vs_fail():
    req = SelectionIn(kind="linear", max_mass_kg=2, min_ip_rating="IP65", supply_voltage_v=24)
    assert evaluate(_act(), req)["unlisted"] == ["Mass", "Supply voltage", "IP rating"]
    failing = evaluate(_act(mass_kg=3, ip_rating="IP54", supply_voltage_v=12), req)
    assert failing["status"] == "rejected" and len(failing["issues"]) == 3
    assert evaluate(_act(mass_kg=1, ip_rating="IP66", supply_voltage_v=24), req)["status"] == "feasible"


def test_ipx_rating_parses():
    req = SelectionIn(kind="linear", min_ip_rating="IP65")
    assert evaluate(_act(ip_rating="IPX6"), req)["status"] == "rejected"
    assert evaluate(_act(ip_rating="IP69K"), req)["status"] == "feasible"


def test_inertia_ratio_check():
    motor = Actuator(id="m", name="m", kind="rotary", actuation="electric", peak_torque_nm=1, rotor_inertia_kgm2=1e-5)
    req = SelectionIn(kind="rotary", load_inertia_kgm2=2e-4, max_inertia_ratio=10)
    r = evaluate(motor, req)
    assert r["computed"]["inertia_ratio"] == pytest.approx(20)
    assert r["status"] == "rejected"


def test_cylinder_force_from_bore_and_pressure():
    cyl = Actuator(
        id="c", name="c", kind="linear", actuation="pneumatic", bore_mm=32, rod_mm=12, max_pressure_bar=10
    )
    force = theoretical_extend_force_n(32, 6)
    assert force == pytest.approx(6e5 * math.pi / 4 * 0.032**2)
    ok = evaluate(cyl, SelectionIn(kind="linear", peak_force_n=400, supply_pressure_bar=6))
    assert ok["status"] == "feasible"
    assert ok["computed"]["theoretical_extend_force_n"] == pytest.approx(force)
    over = evaluate(cyl, SelectionIn(kind="linear", peak_force_n=400, supply_pressure_bar=12))
    assert any("max 10 bar" in i for i in over["issues"])
    no_pressure = evaluate(cyl, SelectionIn(kind="linear", peak_force_n=400))
    assert no_pressure["status"] == "unverified"


def test_motor_requirement_through_screw():
    req = TransmissionSelectionIn(kind="linear", peak_force_n=1000, speed_mm_s=100, screw_efficiency=0.9)
    motor, label = motor_requirement(req, 5)
    assert motor.peak_torque_nm == pytest.approx(1000 * 0.005 / (2 * math.pi * 0.9))
    assert motor.speed_rpm == pytest.approx(1200)
    assert "5 mm lead" in label


def test_motor_requirement_through_gearbox():
    req = TransmissionSelectionIn(kind="rotary", peak_torque_nm=20, speed_rpm=30, load_inertia_kgm2=0.1)
    motor, _ = motor_requirement(req, 10)
    assert motor.peak_torque_nm == pytest.approx(20 / (10 * 0.95))
    assert motor.speed_rpm == pytest.approx(300)
    assert motor.load_inertia_kgm2 == pytest.approx(0.001)


def test_transmission_picks_best_option_per_motor():
    r = select_with_transmission(
        load_seed(), TransmissionSelectionIn(kind="rotary", peak_torque_nm=30, speed_rpm=100, gear_ratios=[1, 10, 50])
    )
    servo = next(c for c in r["feasible"] if c["actuator"]["id"] == "example-servo-400w")
    assert servo["transmission"]["option"] == 10
