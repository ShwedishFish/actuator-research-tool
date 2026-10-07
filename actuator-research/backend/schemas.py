from __future__ import annotations

from typing import Literal

from pydantic import BaseModel, ConfigDict, Field, model_validator

Kind = Literal["linear", "rotary"]
Actuation = Literal["electric", "pneumatic", "hydraulic"]


class Actuator(BaseModel):
    """One catalog entry. Linear ratings use N and mm/s; rotary ratings use N·m and rpm.

    ``stroke_mm`` is the longest standard stroke; ``stroke_options_mm`` lists the orderable strokes
    when the manufacturer publishes a discrete set.
    """

    model_config = ConfigDict(extra="forbid")

    id: str = Field(min_length=1, max_length=100, pattern=r"^[a-z0-9][a-z0-9-]*$")
    name: str = Field(min_length=1, max_length=200)
    kind: Kind
    actuation: Actuation
    drive: str = Field(default="", max_length=80)
    manufacturer: str = Field(default="", max_length=120)
    series: str = Field(default="", max_length=120)
    part_number: str = Field(default="", max_length=120)

    peak_force_n: float | None = Field(default=None, gt=0)
    continuous_force_n: float | None = Field(default=None, gt=0)
    holding_force_n: float | None = Field(default=None, gt=0)
    max_speed_mm_s: float | None = Field(default=None, gt=0)
    stroke_mm: float | None = Field(default=None, gt=0)
    stroke_options_mm: list[float] | None = None

    peak_torque_nm: float | None = Field(default=None, gt=0)
    continuous_torque_nm: float | None = Field(default=None, gt=0)
    max_speed_rpm: float | None = Field(default=None, gt=0)

    duty_cycle_pct: float | None = Field(default=None, gt=0, le=100)
    mass_kg: float | None = Field(default=None, gt=0)
    supply_voltage_v: float | None = Field(default=None, gt=0)
    rated_current_a: float | None = Field(default=None, gt=0)
    feedback: str = Field(default="", max_length=120)
    ip_rating: str = Field(default="", max_length=10)
    price_usd: float | None = Field(default=None, ge=0)
    datasheet_url: str = Field(default="", max_length=500)
    source: str = Field(default="", max_length=300)
    retrieved_on: str = Field(default="", max_length=10)
    remarks: str = Field(default="", max_length=500)
    user_added: bool = False

    @model_validator(mode="after")
    def _ratings_match_kind(self) -> Actuator:
        if self.kind == "linear" and self.peak_force_n is None:
            raise ValueError("linear actuators need peak_force_n")
        if self.kind == "rotary" and self.peak_torque_nm is None:
            raise ValueError("rotary actuators need peak_torque_nm")
        return self


class NoteIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    text: str = Field(min_length=1, max_length=10_000)
    source_url: str = Field(default="", max_length=500)


class Note(NoteIn):
    id: str
    actuator_id: str
    created_at: str


class LinearSizingIn(BaseModel):
    """Point-to-point linear move with a symmetric trapezoidal velocity profile."""

    model_config = ConfigDict(extra="forbid")

    payload_kg: float = Field(ge=0)
    stroke_mm: float = Field(gt=0)
    move_time_s: float = Field(gt=0)
    accel_fraction: float = Field(default=1 / 3, gt=0, le=0.5)
    incline_deg: float = Field(default=0.0, ge=-90, le=90)
    friction_coeff: float = Field(default=0.0, ge=0, le=2)
    external_force_n: float = 0.0
    dwell_time_s: float = Field(default=0.0, ge=0)
    safety_factor: float = Field(default=1.5, ge=1)
    screw_lead_mm: float | None = Field(default=None, gt=0)
    screw_efficiency: float = Field(default=0.9, gt=0, le=1)


class RotarySizingIn(BaseModel):
    """Point-to-point rotary index with a symmetric trapezoidal velocity profile."""

    model_config = ConfigDict(extra="forbid")

    load_inertia_kgm2: float = Field(ge=0)
    move_angle_deg: float = Field(gt=0)
    move_time_s: float = Field(gt=0)
    accel_fraction: float = Field(default=1 / 3, gt=0, le=0.5)
    load_torque_nm: float = 0.0
    dwell_time_s: float = Field(default=0.0, ge=0)
    gear_ratio: float = Field(default=1.0, ge=1)
    gear_efficiency: float = Field(default=1.0, gt=0, le=1)
    motor_inertia_kgm2: float = Field(default=0.0, ge=0)
    safety_factor: float = Field(default=1.5, ge=1)


class SelectionIn(BaseModel):
    model_config = ConfigDict(extra="forbid")

    kind: Kind
    peak_force_n: float | None = Field(default=None, ge=0)
    continuous_force_n: float | None = Field(default=None, ge=0)
    speed_mm_s: float | None = Field(default=None, ge=0)
    stroke_mm: float | None = Field(default=None, ge=0)
    peak_torque_nm: float | None = Field(default=None, ge=0)
    continuous_torque_nm: float | None = Field(default=None, ge=0)
    speed_rpm: float | None = Field(default=None, ge=0)
    duty_cycle_pct: float | None = Field(default=None, ge=0, le=100)
    actuation: Actuation | None = None
