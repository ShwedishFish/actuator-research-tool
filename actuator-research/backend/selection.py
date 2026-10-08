"""Rank catalog actuators against a set of requirements.

Each requirement compares a catalog rating to a required value; margin = rating / required.
A candidate is feasible when every specified requirement has margin >= 1. Feasible candidates
are ranked by their smallest margin (closest fit first), so the least-oversized part leads.
"""

from __future__ import annotations

from backend.schemas import Actuator, SelectionIn

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


def evaluate(actuator: Actuator, req: SelectionIn) -> dict:
    checks = _LINEAR_CHECKS if req.kind == "linear" else _ROTARY_CHECKS
    margins: dict[str, float | None] = {}
    issues: list[str] = []
    for req_field, rating_field, label in checks:
        required = getattr(req, req_field)
        if not required:
            continue
        rating = getattr(actuator, rating_field)
        if rating is None:
            margins[req_field] = None
            issues.append(f"{label}: unlisted")
            continue
        margin = rating / required
        margins[req_field] = margin
        if margin < 1:
            issues.append(f"{label}: {rating:g} < required {required:g}")
    known = [m for m in margins.values() if m is not None]
    return {
        "actuator": actuator.model_dump(),
        "feasible": not issues,
        "margins": margins,
        "min_margin": min(known) if known else None,
        "issues": issues,
    }


def select(catalog: list[Actuator], req: SelectionIn) -> dict:
    pool = [a for a in catalog if a.kind == req.kind and (req.actuation is None or a.actuation == req.actuation)]
    results = [evaluate(a, req) for a in pool]
    feasible = sorted(
        (r for r in results if r["feasible"]),
        key=lambda r: (r["min_margin"] is None, r["min_margin"] or 0),
    )
    rejected = sorted(
        (r for r in results if not r["feasible"]),
        key=lambda r: -(r["min_margin"] or 0),
    )
    return {"feasible": feasible, "rejected": rejected}
