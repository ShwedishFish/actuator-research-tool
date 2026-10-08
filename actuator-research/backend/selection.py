"""Rank catalog actuators against a set of requirements.

Each requirement compares a catalog rating to a required value; margin = rating / required.
Results fall into three buckets:

- feasible: every requested check passes with published data;
- unverified: nothing fails, but at least one needed spec is unlisted in the catalog;
- rejected: at least one check fails.

Feasible candidates are ranked by their smallest margin (closest fit first). Warnings flag ratings
whose published basis makes the comparison optimistic (no-load speed, stall or holding torque).
"""

from __future__ import annotations

import math
import re

from backend.schemas import Actuator, SelectionIn, TransmissionSelectionIn

_LINEAR_CHECKS = [
    ("peak_force_n", "peak_force_n", "Peak force"),
    ("continuous_force_n", "continuous_force_n", "Continuous force"),
    ("speed_mm_s", "max_speed_mm_s", "Speed"),
    ("stroke_mm", "stroke_mm", "Stroke"),
    ("duty_cycle_pct", "duty_cycle_pct", "Duty cycle"),
]
_ROTARY_CHECKS = [
    ("peak_torque_nm", "peak_torque_nm", "Peak torque"),
    ("continuous_torque_nm", "continuous_torque_nm", "Continuous torque"),
    ("speed_rpm", "max_speed_rpm", "Speed"),
    ("duty_cycle_pct", "duty_cycle_pct", "Duty cycle"),
]
_SPEED_FIELDS = {"max_speed_mm_s", "max_speed_rpm"}
_PEAK_FIELDS = {"peak_force_n", "peak_torque_nm"}

_SPEED_WARNINGS = {
    "no-load": "speed is the no-load figure; speed under load is lower",
    "unstated": "source does not state the speed condition",
    "": "speed condition not recorded",
}
_PEAK_WARNINGS = {
    "holding": "peak is holding torque at standstill; usable torque falls with speed",
    "stall": "peak is stall torque; not a usable running torque",
}
_STATUS_RANK = {"feasible": 0, "unverified": 1, "rejected": 2}


def theoretical_extend_force_n(bore_mm: float, pressure_bar: float) -> float:
    return pressure_bar * 1e5 * math.pi / 4 * (bore_mm / 1000) ** 2


def _ip_digits(code: str) -> tuple[int, int] | None:
    m = re.fullmatch(r"IP([0-6X])([0-9X])K?", code.strip().upper())
    if not m:
        return None
    solid, liquid = (0 if c == "X" else int(c) for c in m.groups())
    return solid, liquid


def evaluate(actuator: Actuator, req: SelectionIn) -> dict:
    a = actuator
    checks = _LINEAR_CHECKS if req.kind == "linear" else _ROTARY_CHECKS
    ratings = {field: getattr(a, field) for _, field, _ in checks}
    margins: dict[str, float | None] = {}
    issues: list[str] = []
    unlisted: list[str] = []
    warnings: list[str] = []
    computed: dict[str, float] = {}

    if req.kind == "linear" and a.bore_mm and a.peak_force_n is None and a.continuous_force_n is None:
        if req.supply_pressure_bar:
            force = theoretical_extend_force_n(a.bore_mm, req.supply_pressure_bar)
            ratings["peak_force_n"] = ratings["continuous_force_n"] = force
            computed["theoretical_extend_force_n"] = force
            warnings.append(
                f"force computed from bore at {req.supply_pressure_bar:g} bar (theoretical, before friction losses)"
            )
        else:
            warnings.append("enter a supply pressure to compute cylinder force")
    if req.supply_pressure_bar and a.actuation != "electric":
        if a.max_pressure_bar is None:
            unlisted.append("Max pressure")
        elif req.supply_pressure_bar > a.max_pressure_bar:
            issues.append(f"Supply pressure {req.supply_pressure_bar:g} bar > max {a.max_pressure_bar:g} bar")

    for req_field, rating_field, label in checks:
        required = getattr(req, req_field)
        if not required:
            continue
        rating = ratings[rating_field]
        if rating is None:
            margins[req_field] = None
            unlisted.append(label)
            continue
        margin = rating / required
        margins[req_field] = margin
        if margin < 1:
            issues.append(f"{label}: {rating:.4g} < required {required:.4g}")
        elif rating_field in _SPEED_FIELDS and a.speed_condition in _SPEED_WARNINGS:
            warnings.append(_SPEED_WARNINGS[a.speed_condition])
        elif rating_field in _PEAK_FIELDS and a.peak_basis in _PEAK_WARNINGS:
            warnings.append(_PEAK_WARNINGS[a.peak_basis])

    if req.kind == "rotary" and req.load_inertia_kgm2 and req.max_inertia_ratio:
        if a.rotor_inertia_kgm2 is None:
            unlisted.append("Rotor inertia")
        else:
            ratio = req.load_inertia_kgm2 / a.rotor_inertia_kgm2
            computed["inertia_ratio"] = ratio
            if ratio > req.max_inertia_ratio:
                issues.append(f"Inertia ratio {ratio:.3g}:1 > max {req.max_inertia_ratio:g}:1")

    if req.max_mass_kg:
        if a.mass_kg is None:
            unlisted.append("Mass")
        elif a.mass_kg > req.max_mass_kg:
            issues.append(f"Mass {a.mass_kg:g} kg > max {req.max_mass_kg:g} kg")
    if req.max_price_usd:
        if a.price_usd is None:
            unlisted.append("Price")
        elif a.price_usd > req.max_price_usd:
            issues.append(f"Price ${a.price_usd:g} > max ${req.max_price_usd:g}")
    if req.supply_voltage_v:
        if a.supply_voltage_v is None:
            unlisted.append("Supply voltage")
        elif a.supply_voltage_v != req.supply_voltage_v:
            issues.append(f"Supply voltage {a.supply_voltage_v:g} V ≠ {req.supply_voltage_v:g} V")
    if req.feedback_contains:
        if not a.feedback:
            unlisted.append("Feedback")
        elif req.feedback_contains.lower() not in a.feedback.lower():
            issues.append(f"Feedback '{a.feedback}' lacks '{req.feedback_contains}'")
    if req.min_ip_rating:
        need = _ip_digits(req.min_ip_rating)
        have = _ip_digits(a.ip_rating) if a.ip_rating else None
        if have is None:
            unlisted.append("IP rating")
        elif need and (have[0] < need[0] or have[1] < need[1]):
            issues.append(f"{a.ip_rating} below {req.min_ip_rating}")

    known = [m for m in margins.values() if m is not None]
    status = "rejected" if issues else "unverified" if unlisted else "feasible"
    return {
        "actuator": a.model_dump(),
        "status": status,
        "feasible": status == "feasible",
        "margins": margins,
        "min_margin": min(known) if known else None,
        "issues": issues,
        "unlisted": unlisted,
        "warnings": list(dict.fromkeys(warnings)),
        "computed": computed,
    }


def _bucket(results: list[dict]) -> dict:
    def fit_key(r: dict):
        return (bool(r["warnings"]), r["min_margin"] is None, r["min_margin"] or 0)

    return {
        "feasible": sorted((r for r in results if r["status"] == "feasible"), key=fit_key),
        "unverified": sorted((r for r in results if r["status"] == "unverified"), key=fit_key),
        "rejected": sorted((r for r in results if r["status"] == "rejected"), key=lambda r: -(r["min_margin"] or 0)),
    }


def select(catalog: list[Actuator], req: SelectionIn) -> dict:
    pool = [a for a in catalog if a.kind == req.kind and (req.actuation is None or a.actuation == req.actuation)]
    return _bucket([evaluate(a, req) for a in pool])


_FILTER_FIELDS = (
    "duty_cycle_pct",
    "max_mass_kg",
    "max_price_usd",
    "supply_voltage_v",
    "feedback_contains",
    "min_ip_rating",
    "max_inertia_ratio",
)


def motor_requirement(req: TransmissionSelectionIn, option: float) -> tuple[SelectionIn, str]:
    """Translate output requirements into motor-shaft requirements through one transmission option."""
    filters = {f: getattr(req, f) for f in _FILTER_FIELDS}
    if req.kind == "linear":
        lead_m = option / 1000
        k = lead_m / (2 * math.pi * req.screw_efficiency)
        motor = SelectionIn(
            kind="rotary",
            peak_torque_nm=req.peak_force_n * k if req.peak_force_n else None,
            continuous_torque_nm=req.continuous_force_n * k if req.continuous_force_n else None,
            speed_rpm=req.speed_mm_s / option * 60 if req.speed_mm_s else None,
            load_inertia_kgm2=req.load_inertia_kgm2,
            **filters,
        )
        return motor, f"{option:g} mm lead screw, efficiency {req.screw_efficiency:g}"
    k = 1 / (option * req.gear_efficiency)
    motor = SelectionIn(
        kind="rotary",
        peak_torque_nm=req.peak_torque_nm * k if req.peak_torque_nm else None,
        continuous_torque_nm=req.continuous_torque_nm * k if req.continuous_torque_nm else None,
        speed_rpm=req.speed_rpm * option if req.speed_rpm else None,
        load_inertia_kgm2=req.load_inertia_kgm2 / option**2 if req.load_inertia_kgm2 else None,
        **filters,
    )
    return motor, f"{option:g}:1 gear reduction, efficiency {req.gear_efficiency:g}"


def select_with_transmission(catalog: list[Actuator], req: TransmissionSelectionIn) -> dict:
    options = req.screw_leads_mm if req.kind == "linear" else req.gear_ratios
    if not options:
        raise ValueError("give at least one screw lead (linear) or gear ratio (rotary)")
    motor_reqs = [motor_requirement(req, opt) for opt in options]
    results = []
    for a in catalog:
        if a.kind != "rotary" or a.actuation != "electric":
            continue
        best = None
        for (mreq, label), opt in zip(motor_reqs, options, strict=True):
            r = evaluate(a, mreq)
            r["transmission"] = {"option": opt, "label": label}
            r["motor_requirement"] = mreq.model_dump(exclude_none=True, exclude_defaults=True)
            key = (_STATUS_RANK[r["status"]], -(r["min_margin"] or 0))
            if best is None or key < best[0]:
                best = (key, r)
        results.append(best[1])
    return _bucket(results)
