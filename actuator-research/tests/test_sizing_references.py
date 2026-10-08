"""Sizing math checked against worked examples published by motor/drive manufacturers.

Each test feeds a published example's inputs into ``size_linear`` / ``size_rotary`` and asserts the
published intermediate or final numbers. Only the parts of each example whose assumptions match the
model in ``backend.sizing`` are reproduced; the docstrings say what was left out and why.
Tolerances follow the publisher's rounding (half a unit in the last published digit) unless noted.
"""

import pytest

from backend.schemas import LinearSizingIn, RotarySizingIn
from backend.sizing import G, size_linear, size_rotary

# Oriental Motor uses g = 9.807 and Yaskawa g = 9.8; the code uses standard gravity.
G_REL_ORIENTAL = abs(9.807 - G) / G
G_REL_YASKAWA = abs(9.8 - G) / G


def published(value: float, decimals: int, rel: float = 0.0, truncated: bool = False):
    """approx() for a value printed with `decimals` places (a full unit if the source truncates)."""
    unit = 10.0**-decimals
    return pytest.approx(value, abs=(unit if truncated else unit / 2) + abs(value) * rel)


def phases(result: dict, key: str) -> dict:
    return {s["phase"]: s[key] for s in result["segments"]}


def revs_to_deg(revs: float) -> float:
    return revs * 360.0


# --- Linear, direct drive -------------------------------------------------------------------


def test_aerotech_linear_motor_trapezoid_with_friction():
    """Aerotech, "Linear Motors Application Guide" (© 2010), worked sizing example:
    50 kg, 500 mm in 250 ms, 1/3-1/3-1/3 trapezoid, crossed-roller friction mu = 0.003, dwell 275 ms.
    Published: v = 3 m/s, a = 36 m/s^2, f_a = 1800 N, f_f = 1.47 N, f_p = 1801.47 N.
    Not checked: f_rms = 1015 N, because the guide squares |m*a + f_f| during deceleration while the
    model uses m*a - f_f (code gives 1014.2 N).
    """
    r = size_linear(
        LinearSizingIn(
            payload_kg=50, stroke_mm=500, move_time_s=0.25, friction_coeff=0.003, dwell_time_s=0.275, safety_factor=1
        )
    )
    assert r["peak_velocity_mm_s"] == pytest.approx(3000)
    assert r["acceleration_m_s2"] == pytest.approx(36)
    assert r["force_components_n"]["inertia"] == pytest.approx(1800)
    assert r["force_components_n"]["friction"] == published(1.47, 2)
    assert r["peak_force_n"] == published(1801.47, 2)


def test_beckhoff_al2000_gripper_cycle():
    """Beckhoff, "Guideline: Dimensioning of linear motors" (AL2000), Version 1.1, 2016-03-01,
    section 4.5 "The case" (pp. 18-21): M = 20 kg, X = 0.8 m, vmax = 3 m/s, a = 30 m/s^2 (ta = td = 0.1 s),
    friction Ff = 30 N while moving, 0.5 s settling/gripper dwell.
    Published: tc = 0.167 s; forces 630 / 30 / -570 / 0 N; Frms = 289 N.
    """
    move_time = 0.8 / 3 + 0.1  # X / vmax + ta
    r = size_linear(
        LinearSizingIn(
            payload_kg=20,
            stroke_mm=800,
            move_time_s=move_time,
            accel_fraction=0.1 / move_time,
            friction_coeff=30 / (20 * G),  # the guide states the friction force, not mu
            dwell_time_s=0.5,
            safety_factor=1,
        )
    )
    assert r["peak_velocity_mm_s"] == pytest.approx(3000)
    assert r["acceleration_m_s2"] == pytest.approx(30)
    durations = phases(r, "duration_s")
    assert durations["cruise"] == published(0.167, 3)
    forces = phases(r, "force_n")
    assert forces["accel"] == pytest.approx(630)
    assert forces["cruise"] == pytest.approx(30)
    assert forces["decel"] == pytest.approx(-570)
    assert forces["dwell"] == pytest.approx(0)
    assert r["peak_force_n"] == pytest.approx(630)
    assert r["rms_force_n"] == published(289, 0)


def test_faulhaber_incline_profile_and_inertia_force():
    """FAULHABER Tutorial, "Selecting the appropriate linear motor", pp. 3-4: 0.5 kg moved 20 mm in
    100 ms on a 20 deg slope, 1/3 trapezoid, mu = 0.2, 100 ms rest.
    Published: v = 0.3 m/s, a = 9 m/s^2, segment time 0.033 s, F_a = 4.5 N.
    Not checked: friction 0.94 N and slope force 1.71 N (computed with g = 10), and Fe = 2.98 N
    (averages a return stroke and applies negative static friction at rest).
    """
    r = size_linear(
        LinearSizingIn(
            payload_kg=0.5,
            stroke_mm=20,
            move_time_s=0.1,
            incline_deg=20,
            friction_coeff=0.2,
            dwell_time_s=0.1,
            safety_factor=1,
        )
    )
    assert r["peak_velocity_mm_s"] == pytest.approx(300)
    assert r["acceleration_m_s2"] == pytest.approx(9)
    assert phases(r, "duration_s")["accel"] == published(0.033, 3)
    assert r["force_components_n"]["inertia"] == pytest.approx(4.5)


# --- Screw / belt driven linear axes --------------------------------------------------------

ORIENTAL_BALL_SCREW = (
    "Oriental Motor, Selection Procedures and Calculation Formulas, "
    '"Selection Example - Ball Screw Mechanism" (web technical reference, tech/calculation/sizing-motor06)'
)


def test_oriental_vertical_ball_screw_with_gearhead():
    """ORIENTAL_BALL_SCREW, AC electromagnetic-brake motor example: 45 kg table, vertical (90 deg),
    mu = 0.05, lead 5 mm, eta = 0.9, travel 15 mm/s, gearhead i = 9 with eta_G = 0.81.
    Published: F = 441 N, N_G = 180 r/min, T_M = T_L / (i * eta_G) = 0.86 / (9 * 0.81) = 0.118 N*m.
    Not checked: T'_L = 0.426 N*m (adds a preload-nut torque term) and the brake holding torque
    T_L / i = 0.0956 N*m (the model divides by gear efficiency during dwell too, giving 0.118).
    """
    r = size_linear(
        LinearSizingIn(
            payload_kg=45,
            stroke_mm=10,  # 10 mm in 1 s with the default 1/3 profile cruises at the example's 15 mm/s
            move_time_s=1,
            incline_deg=90,
            friction_coeff=0.05,
            dwell_time_s=1,
            screw_lead_mm=5,
            screw_efficiency=0.9,
            safety_factor=1,
        )
    )
    assert r["peak_velocity_mm_s"] == pytest.approx(15)
    assert r["screw"]["motor_speed_rpm"] == pytest.approx(180)
    forces = phases(r, "force_n")
    assert forces["cruise"] == published(441, 0, rel=G_REL_ORIENTAL)
    # the example sizes the brake for the same gravitational load
    assert forces["dwell"] == published(441, 0, rel=G_REL_ORIENTAL)

    gear = size_rotary(
        RotarySizingIn(
            load_inertia_kgm2=0,
            move_angle_deg=360,
            move_time_s=1,
            load_torque_nm=0.86,
            gear_ratio=9,
            gear_efficiency=0.81,
            safety_factor=1,
        )
    )
    assert gear["peak_torque_nm"] == published(0.118, 3)


def test_oriental_stepper_ball_screw_horizontal():
    """ORIENTAL_BALL_SCREW, stepper example: 40 kg, horizontal, mu = 0.05, lead 15 mm, eta = 0.9,
    feed 180 mm in t0 = 0.8 s with t1 = 25 % (0.2 s); J_L = 2.52e-4 kg*m^2 at the motor;
    T_L = 0.0567 N*m; Sf = 2; tentative motor AZM66AC with J0 = 370e-7 kg*m^2.
    Published: f2 = 10000 Hz at 0.72 deg/pulse, i.e. N_M = 1200 r/min; F = 19.6 N;
    Ta = 628 J0 + 0.158 N*m; required torque 0.48 N*m with J0 = 370e-7; inertia ratio 6.8.
    Not checked: T_L itself (adds a preload-nut term), and the screw inertia (no model input) -
    both enter here as the published T_L and J_L.
    """
    lin = size_linear(
        LinearSizingIn(
            payload_kg=40,
            stroke_mm=180,
            move_time_s=0.8,
            accel_fraction=0.25,
            friction_coeff=0.05,
            screw_lead_mm=15,
            screw_efficiency=0.9,
            safety_factor=1,
        )
    )
    assert lin["peak_velocity_mm_s"] == pytest.approx(10000 * 0.72 / 360 * 15)
    assert lin["screw"]["motor_speed_rpm"] == pytest.approx(1200)
    assert phases(lin, "force_n")["cruise"] == published(19.6, 1, rel=G_REL_ORIENTAL)

    def motor_side(j0: float, sf: float = 1) -> dict:
        return size_rotary(
            RotarySizingIn(
                load_inertia_kgm2=2.52e-4,
                motor_inertia_kgm2=j0,
                move_angle_deg=revs_to_deg(180 / 15),
                move_time_s=0.8,
                accel_fraction=0.25,
                safety_factor=sf,
            )
        )

    ta_load = motor_side(0)["peak_torque_nm"]
    assert ta_load == published(0.158, 3)
    assert (motor_side(1e-4)["peak_torque_nm"] - ta_load) / 1e-4 == published(628, 0)

    with_load = size_rotary(
        RotarySizingIn(
            load_inertia_kgm2=2.52e-4,
            motor_inertia_kgm2=370e-7,
            load_torque_nm=0.0567,
            move_angle_deg=revs_to_deg(180 / 15),
            move_time_s=0.8,
            accel_fraction=0.25,
            safety_factor=2,
        )
    )
    assert with_load["required"]["peak_torque_nm"] == published(0.48, 2)
    assert with_load["inertia_ratio"] == published(6.8, 1)


def test_oriental_servo_ball_screw_rms():
    """ORIENTAL_BALL_SCREW, servo example: 100 kg, horizontal, F_A = 29.4 N, mu = 0.04, lead 10 mm,
    eta = 0.9, V_L = 0.2 m/s, 2.1 s move with t1 = t3 = 0.1 s, then 0.4 s stopped.
    Motor shaft: J_L = 5.56e-4, J0 = 0.162e-4 kg*m^2 (NXM620A), T_L = 0.13 N*m.
    Published: F = 68.6 N, N_M = 1200 r/min, Ta = 0.72, T = 0.85, Trms = 0.24 N*m.
    The motor-shaft part uses the published J_L and T_L because T_L includes a preload-nut term and
    J_L includes screw inertia, neither of which the linear sizer models.
    """
    lin = size_linear(
        LinearSizingIn(
            payload_kg=100,
            stroke_mm=0.2 * (2.1 - 0.1) * 1000,  # stroke implied by the speed diagram
            move_time_s=2.1,
            accel_fraction=0.1 / 2.1,
            friction_coeff=0.04,
            external_force_n=29.4,
            dwell_time_s=0.4,
            screw_lead_mm=10,
            screw_efficiency=0.9,
            safety_factor=1,
        )
    )
    assert lin["peak_velocity_mm_s"] == pytest.approx(200)
    assert lin["screw"]["motor_speed_rpm"] == pytest.approx(1200)
    assert phases(lin, "force_n")["cruise"] == published(68.6, 1, rel=G_REL_ORIENTAL)
    assert lin["cycle_time_s"] == pytest.approx(2.5)

    rot = size_rotary(
        RotarySizingIn(
            load_inertia_kgm2=5.56e-4,
            motor_inertia_kgm2=0.162e-4,
            load_torque_nm=0.13,
            move_angle_deg=revs_to_deg(1200 / 60 * (2.1 - 0.1)),
            move_time_s=2.1,
            accel_fraction=0.1 / 2.1,
            dwell_time_s=0.4,
            safety_factor=1,
        )
    )
    assert rot["peak_motor_speed_rpm"] == pytest.approx(1200)
    torques = phases(rot, "torque_nm")
    assert torques["accel"] - torques["cruise"] == published(0.72, 2)
    assert rot["peak_torque_nm"] == published(0.85, 2)
    assert torques["decel"] == published(-(0.72 - 0.13), 2)
    # The example takes 0 N*m while stopped; the model holds T_L through the dwell. Both give 0.24.
    assert rot["rms_torque_nm"] == published(0.24, 2)


def test_oriental_belt_conveyor_friction_and_gearhead_efficiency():
    """Oriental Motor, Selection Procedures and Calculation Formulas, "Selection Example - Pulley
    Mechanism" (tech/calculation/sizing-motor07), induction-motor belt conveyor: m1 = 25 kg,
    mu = 0.3, horizontal; T_L = 7.36 N*m (Sf included) through gearhead i = 36.
    Published: F = 73.6 N; T_M = 7.36 / (36 * 0.73) = 0.280 N*m and 7.36 / (36 * 0.66) = 0.31 N*m.
    Not checked: roller torque F*D/(2*eta) (no pulley drive in the model).
    """
    r = size_linear(LinearSizingIn(payload_kg=25, stroke_mm=100, move_time_s=1, friction_coeff=0.3, safety_factor=1))
    assert phases(r, "force_n")["cruise"] == published(73.6, 1, rel=G_REL_ORIENTAL)

    for eta_g, expected in ((0.73, published(0.280, 3)), (0.66, published(0.31, 2))):
        gear = size_rotary(
            RotarySizingIn(
                load_inertia_kgm2=0,
                move_angle_deg=360,
                move_time_s=1,
                load_torque_nm=7.36,
                gear_ratio=36,
                gear_efficiency=eta_g,
                safety_factor=1,
            )
        )
        assert gear["peak_torque_nm"] == expected


# --- Rotary indexing with gear reduction ----------------------------------------------------


def test_oriental_index_table_geared_stepper():
    """Oriental Motor, Selection Procedures and Calculation Formulas, "Selection Example - Index
    Mechanism" (tech/calculation/sizing-motor08): J_L = 265.44e-4 kg*m^2, 36 deg in t0 = 0.25 s with
    t1 = 0.1 s, gear ratio i = 36 (PS gear, no efficiency term), T_L = 0, Sf = 2, J0 = 30e-7 (PKE543AC).
    Published: N_M = 40 r/min at the gear output; Ta = 54282.7 J0 + 1.11 N*m (output shaft);
    T_M = 108565.4 J0 + 2.22 -> 2.55 N*m with J0 = 30e-7; inertia ratio J_L / (J0 i^2) = 6.83.
    """

    def index(j0: float, sf: float = 1) -> dict:
        return size_rotary(
            RotarySizingIn(
                load_inertia_kgm2=265.44e-4,
                motor_inertia_kgm2=j0,
                move_angle_deg=36,
                move_time_s=0.25,
                accel_fraction=0.1 / 0.25,
                gear_ratio=36,
                safety_factor=sf,
            )
        )

    i = 36
    bare = index(0)
    assert bare["peak_load_speed_rpm"] == pytest.approx(40)
    # results are at the motor shaft; the example states torques at the gear output (x i)
    assert bare["peak_torque_nm"] * i == published(1.11, 2)
    slope = (index(1e-6)["peak_torque_nm"] - bare["peak_torque_nm"]) * i / 1e-6
    # the example uses 9.55 for 60 / (2*pi), a 7.4e-5 relative difference
    assert slope == pytest.approx(54282.7, rel=1e-4)

    selected = index(30e-7, sf=2)
    assert selected["required"]["peak_torque_nm"] * i == published(2.55, 2)
    assert selected["inertia_ratio"] == published(6.83, 2)
    assert selected["reflected_inertia_kgm2"] == pytest.approx(265.44e-4 / i**2)


# --- Yaskawa servo capacity selection examples ----------------------------------------------

YASKAWA_SIGMA5 = (
    'Yaskawa America, "AC Servo Drives Sigma-V Series Product Catalog", YEA-KAEPS80000042 Rev J-1 '
    '(12/10/2012), "Servomotor Capacity Selection Examples"'
)
YASKAWA_SIGMA5_LARGE = (
    'Yaskawa, "AC Servo Drives Large-Capacity Sigma-V Series" catalog, KAEP S800000 86B (Aug 2013), '
    '"Servomotor Capacity Selection Examples"'
)


def test_yaskawa_sigma5_speed_control_example():
    """YASKAWA_SIGMA5, "Selection Example for Speed Control": 15 m/min, 0.275 m feed in tm = 1.2 s,
    ta = td = 0.1 s, 40 feeds/min (t = 1.5 s), lead 10 mm, gear R = 2.
    Motor shaft: J_L = 2.29e-4, J_M = 0.259e-4 kg*m^2 (SGMJV-02A), T_L = 0.43 N*m.
    Published: n_M = 3000 min^-1, T_P = 1.23 N*m, T_S = 0.37 N*m.
    Not checked: Trms = 0.483 N*m. The example takes zero torque while stopped; the model holds
    load_torque through the dwell (code gives 0.520 N*m).
    """
    r = size_rotary(
        RotarySizingIn(
            load_inertia_kgm2=2.29e-4,
            motor_inertia_kgm2=0.259e-4,
            load_torque_nm=0.43,
            move_angle_deg=revs_to_deg(0.275 / 0.01 * 2),
            move_time_s=1.2,
            accel_fraction=0.1 / 1.2,
            dwell_time_s=1.5 - 1.2,
            safety_factor=1,
        )
    )
    assert r["peak_motor_speed_rpm"] == pytest.approx(3000)
    assert r["cycle_time_s"] == pytest.approx(1.5)
    torques = phases(r, "torque_nm")
    assert torques["accel"] == published(1.23, 2)
    assert torques["decel"] == published(-0.37, 2)


def test_yaskawa_sigma5_position_control_example():
    """YASKAWA_SIGMA5, "Selection Example for Position Control": 80 kg, mu = 0.2, lead 5 mm,
    eta = 0.9, direct drive, 0.25 m at 15 m/min, ta = td = 0.1 s plus ts = 0.1 s settling inside
    tm = 1.2 s, 40 moves/min (t = 1.5 s).
    Motor shaft: J_L = 1.25e-4, J_M = 0.0665e-4 kg*m^2 (SGMJV-01A).
    Published: n_M = 3000 min^-1, T_L = 0.139 N*m, T_P = 0.552 N*m, T_S = 0.275 N*m.
    Not checked: Trms = 0.192 N*m (zero torque while stopped; code holds T_L and gives 0.205 N*m).
    """
    move_time = 1.2 - 0.1  # settling time counts as dwell
    lin = size_linear(
        LinearSizingIn(
            payload_kg=80,
            stroke_mm=250,
            move_time_s=move_time,
            accel_fraction=0.1 / move_time,
            friction_coeff=0.2,
            dwell_time_s=1.5 - move_time,
            screw_lead_mm=5,
            screw_efficiency=0.9,
            safety_factor=1,
        )
    )
    assert lin["screw"]["motor_speed_rpm"] == pytest.approx(3000)
    torque_per_newton = lin["screw"]["peak_motor_torque_nm"] / lin["peak_force_n"]
    assert phases(lin, "force_n")["cruise"] * torque_per_newton == published(0.139, 3, rel=G_REL_YASKAWA)

    rot = size_rotary(
        RotarySizingIn(
            load_inertia_kgm2=1.25e-4,
            motor_inertia_kgm2=0.0665e-4,
            load_torque_nm=0.139,
            move_angle_deg=revs_to_deg(0.25 / 0.005),
            move_time_s=move_time,
            accel_fraction=0.1 / move_time,
            dwell_time_s=1.5 - move_time,
            safety_factor=1,
        )
    )
    assert rot["peak_motor_speed_rpm"] == pytest.approx(3000)
    torques = phases(rot, "torque_nm")
    # the catalog's own inputs give 0.5526, printed as 0.552
    assert torques["accel"] == published(0.552, 3, truncated=True)
    assert torques["decel"] == published(-0.275, 3)


def test_yaskawa_sigma5_large_capacity_position_control_example():
    """YASKAWA_SIGMA5_LARGE, "Selection Example for Position Control": 500 kg, mu = 0.2, lead 12 mm,
    eta = 0.9, direct drive, 0.88 m at 24 m/min in tm = 2.4 s with ta = td = 0.2 s,
    10 moves/min (t = 6.0 s). Motor shaft: J_L = 1653.51e-4, J_M = 498e-4 kg*m^2 (SGMVV-3ZA).
    Published: n_M = 2000 min^-1, T_L = 2.08 N*m, T_P = 227 N*m, T_S = 223 N*m, Trms = 58.2 N*m.
    """
    lin = size_linear(
        LinearSizingIn(
            payload_kg=500,
            stroke_mm=880,
            move_time_s=2.4,
            accel_fraction=0.2 / 2.4,
            friction_coeff=0.2,
            dwell_time_s=6.0 - 2.4,
            screw_lead_mm=12,
            screw_efficiency=0.9,
            safety_factor=1,
        )
    )
    assert lin["screw"]["motor_speed_rpm"] == pytest.approx(2000)
    torque_per_newton = lin["screw"]["peak_motor_torque_nm"] / lin["peak_force_n"]
    assert phases(lin, "force_n")["cruise"] * torque_per_newton == published(2.08, 2, rel=G_REL_YASKAWA)

    rot = size_rotary(
        RotarySizingIn(
            load_inertia_kgm2=1653.51e-4,
            motor_inertia_kgm2=498e-4,
            load_torque_nm=2.08,
            move_angle_deg=revs_to_deg(0.88 / 0.012),
            move_time_s=2.4,
            accel_fraction=0.2 / 2.4,
            dwell_time_s=6.0 - 2.4,
            safety_factor=1,
        )
    )
    assert rot["peak_motor_speed_rpm"] == pytest.approx(2000)
    torques = phases(rot, "torque_nm")
    assert torques["accel"] == published(227, 0)
    assert torques["decel"] == published(-223, 0)
    # The example takes zero torque while stopped; holding T_L for 3.6 s adds < 0.05 N*m here.
    assert rot["rms_torque_nm"] == published(58.2, 1)
    assert rot["cycle_time_s"] == pytest.approx(6.0)
