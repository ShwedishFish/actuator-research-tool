"""Motion-profile sizing for linear and rotary point-to-point moves.

Both sizers use a symmetric trapezoidal velocity profile: accelerate for ``accel_fraction`` of
the move time, cruise, then decelerate for the same time. RMS values are taken over the full
cycle (move + dwell), which is what continuous ratings are compared against.
"""

from __future__ import annotations

import math
from dataclasses import dataclass

from backend.schemas import LinearSizingIn, RotarySizingIn

G = 9.80665


@dataclass(frozen=True)
class Profile:
    t_accel: float
    t_cruise: float
    peak_velocity: float
    accel: float


def trapezoidal_profile(distance: float, move_time: float, accel_fraction: float) -> Profile:
    t_a = accel_fraction * move_time
    t_c = move_time - 2 * t_a
    v = distance / (move_time - t_a)
    return Profile(t_accel=t_a, t_cruise=t_c, peak_velocity=v, accel=v / t_a)


def _segments(profile: Profile, dwell: float, f_accel: float, f_cruise: float, f_decel: float, f_hold: float):
    return [
        {"phase": "accel", "duration_s": profile.t_accel, "value": f_accel},
        {"phase": "cruise", "duration_s": profile.t_cruise, "value": f_cruise},
        {"phase": "decel", "duration_s": profile.t_accel, "value": f_decel},
        {"phase": "dwell", "duration_s": dwell, "value": f_hold},
    ]


def _rename_value(segments: list[dict], key: str) -> list[dict]:
    return [{"phase": s["phase"], "duration_s": s["duration_s"], key: s["value"]} for s in segments]


def _rms(segments: list[dict]) -> float:
    total = sum(s["duration_s"] for s in segments)
    return math.sqrt(sum(s["value"] ** 2 * s["duration_s"] for s in segments) / total)


def _peak(segments: list[dict]) -> float:
    return max(abs(s["value"]) for s in segments if s["duration_s"] > 0)


def size_linear(inp: LinearSizingIn) -> dict:
    stroke_m = inp.stroke_mm / 1000
    p = trapezoidal_profile(stroke_m, inp.move_time_s, inp.accel_fraction)
    theta = math.radians(inp.incline_deg)
    m = inp.payload_kg

    f_gravity = m * G * math.sin(theta)
    f_friction = inp.friction_coeff * m * G * math.cos(theta)
    f_inertia = m * p.accel
    f_steady = f_gravity + f_friction + inp.external_force_n

    segments = _segments(
        p,
        inp.dwell_time_s,
        f_accel=f_steady + f_inertia,
        f_cruise=f_steady,
        f_decel=f_steady - f_inertia,
        f_hold=f_gravity + inp.external_force_n,
    )
    peak = _peak(segments)
    rms = _rms(segments)
    cycle = inp.move_time_s + inp.dwell_time_s
    sf = inp.safety_factor

    result = {
        "peak_velocity_mm_s": p.peak_velocity * 1000,
        "acceleration_m_s2": p.accel,
        "cycle_time_s": cycle,
        "duty_cycle_pct": 100 * inp.move_time_s / cycle,
        "force_components_n": {
            "gravity": f_gravity,
            "friction": f_friction,
            "inertia": f_inertia,
            "external": inp.external_force_n,
        },
        "segments": _rename_value(segments, "force_n"),
        "peak_force_n": peak,
        "rms_force_n": rms,
        "peak_mechanical_power_w": (abs(f_steady) + f_inertia) * p.peak_velocity,
        "required": {
            "kind": "linear",
            "peak_force_n": peak * sf,
            "continuous_force_n": rms * sf,
            "speed_mm_s": p.peak_velocity * 1000,
            "stroke_mm": inp.stroke_mm,
            "duty_cycle_pct": 100 * inp.move_time_s / cycle,
        },
    }

    if inp.screw_lead_mm is not None:
        lead_m = inp.screw_lead_mm / 1000
        k = lead_m / (2 * math.pi * inp.screw_efficiency)
        result["screw"] = {
            "motor_speed_rpm": p.peak_velocity / lead_m * 60,
            "peak_motor_torque_nm": peak * k,
            "rms_motor_torque_nm": rms * k,
        }
    return result


def size_rotary(inp: RotarySizingIn) -> dict:
    angle_rad = math.radians(inp.move_angle_deg)
    p = trapezoidal_profile(angle_rad, inp.move_time_s, inp.accel_fraction)
    n = inp.gear_ratio
    eta = inp.gear_efficiency

    alpha_motor = p.accel * n
    t_load_inertia = inp.load_inertia_kgm2 * p.accel
    t_motor_inertia = inp.motor_inertia_kgm2 * alpha_motor

    def at_motor(load_side: float, motor_side: float) -> float:
        return motor_side + load_side / (n * eta)

    segments = _segments(
        p,
        inp.dwell_time_s,
        f_accel=at_motor(t_load_inertia + inp.load_torque_nm, t_motor_inertia),
        f_cruise=at_motor(inp.load_torque_nm, 0.0),
        f_decel=at_motor(-t_load_inertia + inp.load_torque_nm, -t_motor_inertia),
        f_hold=at_motor(inp.load_torque_nm, 0.0),
    )
    peak = _peak(segments)
    rms = _rms(segments)
    cycle = inp.move_time_s + inp.dwell_time_s
    sf = inp.safety_factor
    motor_speed_rpm = p.peak_velocity * n * 60 / (2 * math.pi)
    reflected_inertia = inp.load_inertia_kgm2 / n**2

    return {
        "peak_load_speed_rpm": p.peak_velocity * 60 / (2 * math.pi),
        "peak_motor_speed_rpm": motor_speed_rpm,
        "load_acceleration_rad_s2": p.accel,
        "reflected_inertia_kgm2": reflected_inertia,
        "inertia_ratio": reflected_inertia / inp.motor_inertia_kgm2 if inp.motor_inertia_kgm2 > 0 else None,
        "cycle_time_s": cycle,
        "duty_cycle_pct": 100 * inp.move_time_s / cycle,
        "segments": _rename_value(segments, "torque_nm"),
        "peak_torque_nm": peak,
        "rms_torque_nm": rms,
        "peak_mechanical_power_w": peak * p.peak_velocity * n,
        "required": {
            "kind": "rotary",
            "peak_torque_nm": peak * sf,
            "continuous_torque_nm": rms * sf,
            "speed_rpm": motor_speed_rpm,
            "duty_cycle_pct": 100 * inp.move_time_s / cycle,
        },
    }
