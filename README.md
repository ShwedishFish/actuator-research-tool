# Actuator Research Tool

A local web app for researching and sizing actuators:

- **Catalog**: searchable list of linear and rotary actuators (electric, pneumatic, hydraulic). Add your own entries from datasheets.
- **Sizing**: trapezoidal move profiles for linear moves (payload, stroke, incline, friction, optional lead screw) and rotary moves (inertia, angle, gear ratio). The output includes peak and RMS force or torque, speed, power, and duty cycle.
- **Selection**: ranks catalog entries against requirements by margin (rating ÷ required). Sizing results can be sent straight to Selection.
- **Research notes**: per-actuator notes with source links.

The shipped catalog lives in `actuator-research/backend/data/catalog/`, one JSON file per manufacturer. Every entry records only published specification numbers, plus the official datasheet or product URL, a source citation, and the retrieval date; `tests/test_catalog_data.py` enforces this. Datasheet conditions vary (for example no-load vs. full-load speed, or stall vs. rated torque), so check each entry's `remarks` before relying on a match. Anything you add through the UI is stored in `actuator-research/backend/data/user/`, which is gitignored.

## Setup

```bash
cd actuator-research
python3.12 -m venv .venv
.venv/bin/pip install -r requirements-dev.txt
```

## Run

```bash
bash actuator-research/scripts/dev.sh   # http://127.0.0.1:8001/
```

## Deploy (Render)

[`render.yaml`](render.yaml) is a [Render Blueprint](https://render.com/docs/blueprint-spec): in the Render dashboard choose **New → Blueprint** and select this repo. Render auto-deploys `main` on every push. The public service sets `ACTUATOR_READ_ONLY=1`, which disables adding or deleting actuators and notes (the free plan's disk is not persistent, and those routes have no auth).

## Check (lint + tests)

```bash
bash actuator-research/scripts/check.sh
```

## Sizing assumptions

- Symmetric trapezoidal velocity profile; `accel_fraction` is the share of move time spent accelerating (1/3 gives the classic 1/3–1/3–1/3 profile, 0.5 gives a triangle).
- RMS is taken over the full cycle (move + dwell) and compared against continuous ratings.
- Linear dwell holds gravity and external force; friction is assumed zero at rest.
- Rotary: load-side torques are reflected through `gear_ratio` and `gear_efficiency`; motor rotor inertia is added on the motor side.
- The safety factor multiplies peak and continuous requirements; speed and stroke are passed through unchanged.
