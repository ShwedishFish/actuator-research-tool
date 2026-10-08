"""Integrity checks for the shipped catalog in backend/data/catalog/."""

import json
import re
from collections import Counter
from pathlib import Path

import pytest

from backend.schemas import Actuator, Manufacturer

CATALOG_DIR = Path(__file__).resolve().parent.parent / "backend" / "data" / "catalog"
FILES = sorted(CATALOG_DIR.glob("*.json"))
ROWS = [(path.name, row) for path in FILES for row in json.loads(path.read_text(encoding="utf-8"))]


def test_catalog_has_entries():
    assert ROWS


@pytest.mark.parametrize(("file", "row"), ROWS, ids=[f"{f}:{r.get('id')}" for f, r in ROWS])
def test_entry_is_valid_and_sourced(file, row):
    a = Actuator(**row)
    assert a.manufacturer, "manufacturer required"
    assert a.datasheet_url.startswith("https://"), "official https datasheet/product URL required"
    assert a.source, "source citation required"
    assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.retrieved_on), "retrieved_on must be YYYY-MM-DD"
    assert not a.user_added
    if a.continuous_force_n and a.peak_force_n:
        assert a.continuous_force_n <= a.peak_force_n
    if a.continuous_torque_nm and a.peak_torque_nm:
        assert a.continuous_torque_nm <= a.peak_torque_nm
    if a.stroke_options_mm:
        assert a.stroke_mm == max(a.stroke_options_mm)
    if a.lead_time or a.lead_time_days is not None:
        assert a.lead_time, "lead_time_days needs the published lead_time statement"
        assert a.lead_time_url.startswith("https://"), "lead time needs the https page it was read from"
        assert re.fullmatch(r"\d{4}-\d{2}-\d{2}", a.lead_time_retrieved_on), "lead_time_retrieved_on must be YYYY-MM-DD"


FILLED_IN_MARKERS = re.compile(
    r"lower bound|upper bound|holds the published|\(conservative\)|peak = 2x|max_speed is rated|assum|estimated value",
    re.IGNORECASE,
)


@pytest.mark.parametrize(("file", "row"), ROWS, ids=[f"{f}:{r.get('id')}" for f, r in ROWS])
def test_no_filled_in_specs(file, row):
    """Unpublished specs must be left out (shown as unlisted), never inferred from bounds or other fields."""
    assert not FILLED_IN_MARKERS.search(row.get("remarks", "")), row.get("remarks")
    if row.get("peak_force_n") and row.get("continuous_force_n"):
        assert not (row["peak_force_n"] == row["continuous_force_n"] and "No stall/peak" in row.get("remarks", ""))


def test_ids_unique_across_files():
    dupes = [i for i, n in Counter(r["id"] for _, r in ROWS).items() if n > 1]
    assert not dupes


MANUFACTURERS_FILE = CATALOG_DIR.parent / "manufacturers.json"
DIRECTORY = json.loads(MANUFACTURERS_FILE.read_text(encoding="utf-8")) if MANUFACTURERS_FILE.exists() else []


@pytest.mark.parametrize("entry", DIRECTORY, ids=[m.get("name") for m in DIRECTORY])
def test_manufacturer_directory_entry(entry):
    m = Manufacturer(**entry)
    assert m.name in {r.get("manufacturer") for _, r in ROWS}, "directory name must match catalog manufacturer"
    for url in (m.website, m.contact_url, m.store_url, m.distributor_url, m.lead_time_url):
        assert not url or url.startswith("https://")
    assert m.source and re.fullmatch(r"\d{4}-\d{2}-\d{2}", m.retrieved_on)
    assert not m.sales_email or re.fullmatch(r"[^@\s]+@[^@\s]+\.[a-z]{2,}", m.sales_email)


def test_manufacturer_directory_names_unique():
    assert len({m["name"] for m in DIRECTORY}) == len(DIRECTORY)
