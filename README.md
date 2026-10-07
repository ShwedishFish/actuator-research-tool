# Actuator Research Tool

A local web app for researching and sizing actuators:

- **Catalog**: searchable list of linear and rotary actuators (electric, pneumatic, hydraulic). Add your own entries from datasheets.
- **Sizing**: trapezoidal move profiles for linear moves (payload, stroke, incline, friction, optional lead screw) and rotary moves (inertia, angle, gear ratio). The output includes peak and RMS force or torque, speed, power, and duty cycle.
- **Selection**: ranks catalog entries against requirements by margin (rating ÷ required). Sizing results can be sent straight to Selection.
- **Research notes**: per-actuator notes with source links.

The seed catalog (`actuator-research/backend/data/catalog_seed.json`) is **illustrative placeholder data only**; replace it with real datasheet values. Anything you add through the UI is stored in `actuator-research/backend/data/user/`, which is gitignored.

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
