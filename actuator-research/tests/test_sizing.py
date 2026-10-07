import math

import pytest

from backend.schemas import LinearSizingIn, RotarySizingIn
from backend.sizing import G, size_linear, size_rotary, trapezoidal_profile


def test_trapezoid_thirds_profile():
    # 1/3-1/3-1/3 trapezoid: v = 1.5 * d / t, a = 4.5 * d / t^2
    p = trapezoidal_profile(0.3, 1.0, 1 / 3)
    assert p.peak_velocity == pytest.approx(0.45)
    assert p.accel == pytest.approx(1.35)
    assert p.t_cruise == pytest.approx(1 / 3)


def test_triangle_profile():
    p = trapezoidal_profile(1.0, 2.0, 0.5)
    assert p.t_cruise == pytest.approx(0.0)
    assert p.peak_velocity == pytest.approx(1.0)
    assert p.accel == pytest.approx(1.0)


def test_linear_horizontal_no_friction_is_pure_inertia():
    r = size_linear(LinearSizingIn(payload_kg=10, stroke_mm=300, move_time_s=1, friction_coeff=0, safety_factor=1))
    assert r["peak_force_n"] == pytest.approx(10 * 1.35)
    # inertia force only during accel and decel (2/3 of the move), zero dwell
    assert r["rms_force_n"] == pytest.approx(13.5 * math.sqrt(2 / 3))
    assert r["peak_velocity_mm_s"] == pytest.approx(450)


def test_linear_vertical_holds_gravity_during_dwell():
    r = size_linear(
        LinearSizingIn(payload_kg=5, stroke_mm=100, move_time_s=1, incline_deg=90, dwell_time_s=1, safety_factor=2)
    )
    hold = next(s for s in r["segments"] if s["phase"] == "dwell")
    assert hold["force_n"] == pytest.approx(5 * G)
    assert r["duty_cycle_pct"] == pytest.approx(50)
    assert r["required"]["peak_force_n"] == pytest.approx(2 * r["peak_force_n"])


def test_linear_screw_torque():
    r = size_linear(
        LinearSizingIn(
            payload_kg=0, stroke_mm=100, move_time_s=1, external_force_n=1000, screw_lead_mm=5, screw_efficiency=0.9
        )
    )
    assert r["screw"]["peak_motor_torque_nm"] == pytest.approx(1000 * 0.005 / (2 * math.pi * 0.9))


def test_rotary_gear_reduction_reflects_inertia_and_torque():
    direct = size_rotary(RotarySizingIn(load_inertia_kgm2=0.1, move_angle_deg=90, move_time_s=0.5, safety_factor=1))
    geared = size_rotary(
        RotarySizingIn(load_inertia_kgm2=0.1, move_angle_deg=90, move_time_s=0.5, gear_ratio=10, safety_factor=1)
    )
    assert geared["peak_torque_nm"] == pytest.approx(direct["peak_torque_nm"] / 10)
    assert geared["peak_motor_speed_rpm"] == pytest.approx(direct["peak_motor_speed_rpm"] * 10)
    assert geared["reflected_inertia_kgm2"] == pytest.approx(0.001)
