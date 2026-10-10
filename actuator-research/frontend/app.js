"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const UNLISTED = "-";
const isMissing = (v) => v === null || v === undefined || v === "";
const fmt = (v, digits = 3) => (isMissing(v) ? UNLISTED : String(Number(Number(v).toPrecision(digits))));
const withUnit = (v, unit) => (isMissing(v) ? UNLISTED : `${fmt(v)} ${unit}`);

async function api(path, options = {}) {
  const res = await fetch(path, {
    headers: { "Content-Type": "application/json" },
    ...options,
    body: options.body ? JSON.stringify(options.body) : undefined,
  });
  if (res.status === 204) return null;
  const data = await res.json();
  if (!res.ok) {
    const detail = Array.isArray(data.detail) ? data.detail.map((d) => `${d.loc.at(-1)}: ${d.msg}`).join("; ") : data.detail;
    throw new Error(detail || res.statusText);
  }
  return data;
}

function formData(form, { visibleOnly = false } = {}) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.value === "" || el.type === "radio") continue;
    if (visibleOnly && el.closest(".hidden")) continue;
    out[el.name] = el.type === "number" ? Number(el.value) : el.value;
  }
  return out;
}

function debounce(fn, ms) {
  let timer;
  return (...args) => {
    clearTimeout(timer);
    timer = setTimeout(() => fn(...args), ms);
  };
}

function fillForm(form, values) {
  for (const el of form.elements) {
    if (!el.name || el.type === "radio" || !(el.name in values)) continue;
    el.value = values[el.name] ?? "";
  }
}

// ---------- field definitions ----------

const BASIS_TAGS = { stall: "stall", holding: "holding", "max-push": "max push" };
const SPEED_TAGS = { "no-load": "no-load", "full-load": "full load", rated: "rated", max: "max", unstated: "condition unstated" };

const FIELDS = [
  ["manufacturer", "Manufacturer"],
  ["series", "Series"],
  ["part_number", "Part number"],
  ["kind", "Kind"],
  ["actuation", "Actuation"],
  ["drive", "Drive"],
  ["peak_force_n", "Peak force (N)", "linear"],
  ["continuous_force_n", "Continuous force (N)", "linear"],
  ["holding_force_n", "Holding force (N)", "linear"],
  ["max_speed_mm_s", "Max speed (mm/s)", "linear"],
  ["stroke_mm", "Max stroke (mm)", "linear"],
  ["stroke_options_mm", "Stroke options (mm)", "linear"],
  ["peak_torque_nm", "Peak torque (N·m)", "rotary"],
  ["continuous_torque_nm", "Continuous torque (N·m)", "rotary"],
  ["max_speed_rpm", "Max speed (rpm)", "rotary"],
  ["rotor_inertia_kgm2", "Rotor inertia (kg·m²)", "rotary"],
  ["peak_basis", "Peak rating basis"],
  ["continuous_basis", "Continuous rating basis"],
  ["speed_condition", "Speed condition"],
  ["bore_mm", "Bore (mm)", "fluid"],
  ["rod_mm", "Rod (mm)", "fluid"],
  ["max_pressure_bar", "Max pressure (bar)", "fluid"],
  ["duty_cycle_pct", "Duty cycle (%)"],
  ["mass_kg", "Mass (kg)"],
  ["supply_voltage_v", "Supply voltage (V)", "electric"],
  ["rated_current_a", "Current (A)", "electric"],
  ["current_condition", "Current condition", "electric"],
  ["feedback", "Feedback"],
  ["ip_rating", "IP rating"],
  ["price_usd", "Price (USD)"],
  ["lead_time", "Lead time (published)"],
  ["lead_time_days", "Lead time, upper end (calendar days)"],
  ["lead_time_url", "Lead time source"],
  ["lead_time_retrieved_on", "Lead time checked"],
  ["remarks", "Remarks"],
  ["source", "Source"],
  ["retrieved_on", "Retrieved"],
  ["datasheet_url", "Datasheet"],
];
const OPTIONAL_TEXT = new Set(["series", "part_number", "remarks"]);

function fieldApplies(a, scope) {
  if (!scope) return true;
  if (scope === "linear" || scope === "rotary") return a.kind === scope;
  if (scope === "fluid") return a.actuation !== "electric";
  if (scope === "electric") return a.actuation === "electric";
  return true;
}

function displayValue(a, key) {
  const v = a[key];
  if (Array.isArray(v)) return v.join(", ");
  return v;
}

// ---------- state ----------

const cache = new Map();
const checked = new Set();
const LS_KEY = "actuator-research-state";
const state = { shortlist: [], compare: [], projectId: null, projectName: "" };

function remember(rows) {
  for (const a of rows) cache.set(a.id, a);
}

async function getActuator(id) {
  if (!cache.has(id)) cache.set(id, await api(`/api/actuators/${encodeURIComponent(id)}`));
  return cache.get(id);
}

function persist() {
  localStorage.setItem(LS_KEY, JSON.stringify(state));
  $("#shortlist-count").textContent = state.shortlist.length || "";
  $("#compare-count").textContent = state.compare.length || "";
  $("#project-name").textContent = state.projectName ? `Project: ${state.projectName}` : "";
  $("#project-name").classList.toggle("hidden", !state.projectName);
}

function restore() {
  try {
    Object.assign(state, JSON.parse(localStorage.getItem(LS_KEY) || "{}"));
  } catch {
    // ignore corrupt local state
  }
}

function addToShortlist(ids) {
  for (const id of ids) if (!state.shortlist.includes(id)) state.shortlist.push(id);
  persist();
  renderShortlist();
}

function addToCompare(ids) {
  for (const id of ids) if (!state.compare.includes(id)) state.compare.push(id);
  state.compare = state.compare.slice(-6);
  persist();
  renderCompare();
}

// ---------- theme ----------

const THEME_KEY = "actuator-research-theme";
const THEMES = ["light", "dark", "system"];

function applyTheme(mode) {
  if (!THEMES.includes(mode)) mode = "system";
  document.documentElement.dataset.theme = mode;
  try {
    localStorage.setItem(THEME_KEY, mode);
  } catch {
    // storage unavailable; theme still applies for this page
  }
  for (const btn of $$("#theme-mode .seg-btn")) {
    const on = btn.dataset.themeMode === mode;
    btn.classList.toggle("is-active", on);
    btn.setAttribute("aria-pressed", String(on));
  }
}

$("#theme-mode").addEventListener("click", (e) => {
  const btn = e.target.closest(".seg-btn[data-theme-mode]");
  if (btn) applyTheme(btn.dataset.themeMode);
});

// ---------- tabs ----------

$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
    if (btn.dataset.tab === "select" && !selectionRan) runSelection();
    if (btn.dataset.tab === "sizing" && !sizingRan) runSizing();
    syncUrl();
  }),
);

function showTab(id) {
  $(`.tab[data-tab="${id}"]`).click();
}

$$(".act-compare").forEach((b) =>
  b.addEventListener("click", () => {
    addToCompare([...checked]);
    showTab("compare");
  }),
);
$$(".act-shortlist").forEach((b) => b.addEventListener("click", () => addToShortlist([...checked])));
$$(".act-clear").forEach((b) =>
  b.addEventListener("click", () => {
    checked.clear();
    $$("input.row-check").forEach((c) => (c.checked = false));
  }),
);

document.addEventListener("change", (e) => {
  if (!e.target.classList.contains("row-check")) return;
  const id = e.target.dataset.id;
  if (e.target.checked) checked.add(id);
  else checked.delete(id);
});

// ---------- CSV ----------

const CSV_FIELDS = ["id", "name", ...FIELDS.map(([k]) => k)];

function downloadCsv(filename, rows, extra = []) {
  const cols = [...extra.map(([k]) => k), ...CSV_FIELDS];
  const cell = (v) => {
    const s = Array.isArray(v) ? v.join(" ") : isMissing(v) ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const lines = [cols.join(",")];
  for (const r of rows) {
    const extras = Object.fromEntries(extra.map(([k, fn]) => [k, fn(r)]));
    const a = r.actuator ?? r;
    lines.push(cols.map((c) => cell(c in extras ? extras[c] : a[c])).join(","));
  }
  const url = URL.createObjectURL(new Blob([lines.join("\n")], { type: "text/csv" }));
  const link = Object.assign(document.createElement("a"), { href: url, download: filename });
  link.click();
  URL.revokeObjectURL(url);
}

// ---------- catalog ----------

const CATALOG_PAGE = 300;
let catalogLimit = CATALOG_PAGE;
let catalogBase = [];
let catalogRows = [];
let hiddenUnlisted = 0;
let catalogRequest = 0;
let sortKey = "";
let sortDir = 1;
let selectedId = null;

const peakOf = (a) => (a.kind === "linear" ? a.peak_force_n : a.peak_torque_nm);
const contOf = (a) => (a.kind === "linear" ? a.continuous_force_n : a.continuous_torque_nm);
const speedOf = (a) => (a.kind === "linear" ? a.max_speed_mm_s : a.max_speed_rpm);
const SORTERS = { peak: peakOf, continuous: contOf, speed: speedOf };

function tag(text) {
  return text ? ` <span class="tag">${esc(text)}</span>` : "";
}

function pill(value) {
  return value ? `<span class="pill pill-${esc(value)}">${esc(value)}</span>` : UNLISTED;
}

function ratingCells(a) {
  if (a.kind === "linear") {
    const peak =
      a.peak_force_n == null && a.bore_mm
        ? `bore ${fmt(a.bore_mm)} mm`
        : withUnit(a.peak_force_n, "N") + (a.peak_force_n != null ? tag(BASIS_TAGS[a.peak_basis]) : "");
    return [
      peak,
      withUnit(a.continuous_force_n, "N"),
      withUnit(a.max_speed_mm_s, "mm/s") + (a.max_speed_mm_s != null ? tag(SPEED_TAGS[a.speed_condition]) : ""),
      withUnit(a.stroke_mm, "mm"),
    ];
  }
  return [
    withUnit(a.peak_torque_nm, "N·m") + (a.peak_torque_nm != null ? tag(BASIS_TAGS[a.peak_basis]) : ""),
    withUnit(a.continuous_torque_nm, "N·m"),
    withUnit(a.max_speed_rpm, "rpm") + (a.max_speed_rpm != null ? tag(SPEED_TAGS[a.speed_condition]) : ""),
    "n/a",
  ];
}

function checkCell(id) {
  return `<td><input type="checkbox" class="row-check" data-id="${esc(id)}" ${checked.has(id) ? "checked" : ""}></td>`;
}

function sortedRows(rows) {
  if (!sortKey) return rows;
  const get = SORTERS[sortKey] ?? ((a) => a[sortKey]);
  return [...rows].sort((x, y) => {
    const a = get(x);
    const b = get(y);
    if (isMissing(a) && isMissing(b)) return 0;
    if (isMissing(a)) return 1;
    if (isMissing(b)) return -1;
    return (typeof a === "number" ? a - b : String(a).localeCompare(String(b))) * sortDir;
  });
}

const unitCell = (key, unit) => (a) => withUnit(a[key], unit);
const textCell = (key) => (a) => esc(a[key]) || UNLISTED;
const COLUMNS = [
  { id: "name", label: "Name", wrap: true, fixed: true, cell: (a) => `${esc(a.name)}${a.user_added ? tag("user") : ""}` },
  { id: "manufacturer", label: "Manufacturer", wrap: true, def: true, cell: textCell("manufacturer") },
  { id: "series", label: "Series", cell: textCell("series") },
  { id: "part_number", label: "Part number", cell: textCell("part_number") },
  { id: "kind", label: "Kind", def: true, cell: (a) => pill(a.kind) },
  { id: "actuation", label: "Actuation", def: true, cell: (a) => pill(a.actuation) },
  { id: "drive", label: "Drive", wrap: true, cell: textCell("drive") },
  { id: "peak", label: "Peak", def: true, cell: (a) => ratingCells(a)[0] },
  { id: "continuous", label: "Continuous", def: true, cell: (a) => ratingCells(a)[1] },
  { id: "holding_force_n", label: "Holding force", cell: unitCell("holding_force_n", "N") },
  { id: "speed", label: "Speed", def: true, cell: (a) => ratingCells(a)[2] },
  { id: "stroke_mm", label: "Stroke", def: true, cell: (a) => ratingCells(a)[3] },
  { id: "rotor_inertia_kgm2", label: "Rotor inertia", cell: unitCell("rotor_inertia_kgm2", "kg·m²") },
  { id: "bore_mm", label: "Bore", cell: unitCell("bore_mm", "mm") },
  { id: "max_pressure_bar", label: "Max pressure", cell: unitCell("max_pressure_bar", "bar") },
  { id: "duty_cycle_pct", label: "Duty cycle", cell: unitCell("duty_cycle_pct", "%") },
  { id: "mass_kg", label: "Mass", def: true, cell: unitCell("mass_kg", "kg") },
  { id: "supply_voltage_v", label: "Voltage", cell: unitCell("supply_voltage_v", "V") },
  { id: "rated_current_a", label: "Current", cell: unitCell("rated_current_a", "A") },
  { id: "feedback", label: "Feedback", wrap: true, cell: textCell("feedback") },
  { id: "ip_rating", label: "IP rating", cell: textCell("ip_rating") },
  { id: "price_usd", label: "Price", def: true, cell: (a) => (isMissing(a.price_usd) ? UNLISTED : `$${fmt(a.price_usd, 6)}`) },
  { id: "lead_time_days", label: "Lead time", def: true, cell: leadTimeCell },
  { id: "source", label: "Source", wrap: true, cell: textCell("source") },
];
const COLS_KEY = "actuator-research-columns";
const DEFAULT_COLS = COLUMNS.filter((c) => c.fixed || c.def).map((c) => c.id);
let visibleCols = loadColumns();

function loadColumns() {
  try {
    const saved = JSON.parse(localStorage.getItem(COLS_KEY));
    if (Array.isArray(saved)) return new Set(["name", ...saved.filter((id) => COLUMNS.some((c) => c.id === id))]);
  } catch {
    // fall back to defaults
  }
  return new Set(DEFAULT_COLS);
}

function setColumns(ids) {
  visibleCols = new Set(["name", ...ids]);
  try {
    localStorage.setItem(COLS_KEY, JSON.stringify([...visibleCols]));
  } catch {
    // preference just won't persist
  }
  renderColumnChooser();
  renderCatalog();
}

function renderColumnChooser() {
  $("#col-options").innerHTML = COLUMNS.filter((c) => !c.fixed)
    .map((c) => `<label><input type="checkbox" value="${c.id}" ${visibleCols.has(c.id) ? "checked" : ""}> ${esc(c.label)}</label>`)
    .join("");
  const extra = visibleCols.size - DEFAULT_COLS.length;
  $("#col-chooser > summary").textContent = `Columns (${visibleCols.size})`;
  $("#col-reset").disabled = !extra && DEFAULT_COLS.every((id) => visibleCols.has(id));
}

$("#col-options").addEventListener("change", () =>
  setColumns($$("#col-options input:checked").map((el) => el.value)),
);
$("#col-reset").addEventListener("click", () => setColumns(DEFAULT_COLS));
document.addEventListener("click", (e) => {
  const chooser = $("#col-chooser");
  if (chooser.open && !chooser.contains(e.target)) chooser.open = false;
});

function renderCatalog() {
  const rows = sortedRows(catalogRows);
  const cols = COLUMNS.filter((c) => visibleCols.has(c.id));
  const shown = Math.min(rows.length, catalogLimit);
  const unlistedNote = hiddenUnlisted ? ` ${hiddenUnlisted} more hidden because a filtered spec is unlisted.` : "";
  $("#catalog-count").textContent =
    (rows.length > shown ? `${rows.length} matches; showing ${shown}.` : `${rows.length} matches.`) + unlistedNote;
  const more = $("#catalog-more");
  more.classList.toggle("hidden", rows.length <= shown);
  more.textContent = `Show ${Math.min(CATALOG_PAGE, rows.length - shown)} more (${rows.length - shown} not shown)`;
  $("#catalog-table thead").innerHTML = `<tr><th></th>${cols
    .map((c) => {
      const dir = c.id === sortKey ? (sortDir > 0 ? "▲" : "▼") : "";
      return `<th data-sort="${c.id}" data-dir="${dir}" class="${dir ? "sorted" : ""}">${esc(c.label)}</th>`;
    })
    .join("")}</tr>`;
  $("#catalog-table tbody").innerHTML = rows
    .slice(0, shown)
    .map(
      (a) => `<tr data-id="${esc(a.id)}">${checkCell(a.id)}${cols
        .map((c) => `<td${c.wrap ? "" : ' class="nowrap"'}>${c.cell(a)}</td>`)
        .join("")}</tr>`,
    )
    .join("");
  markSelected();
}

function leadTimeCell(a) {
  if (!a.lead_time && isMissing(a.lead_time_days)) return UNLISTED;
  const label = isMissing(a.lead_time_days) ? "status only" : `≤ ${fmt(a.lead_time_days)} d`;
  return `<span class="lead-time" title="${esc(a.lead_time)}${a.lead_time_retrieved_on ? ` (checked ${esc(a.lead_time_retrieved_on)})` : ""}">${label}</span>`;
}

let suppliers = [];

async function loadManufacturers() {
  const list = await api("/api/manufacturers");
  suppliers = list;
  renderSuppliers();
  const select = $("#catalog-manufacturer");
  const current = select.value || pendingManufacturer;
  select.innerHTML =
    `<option value="">All manufacturers</option>` +
    list.map((m) => `<option value="${esc(m.name)}">${esc(m.name)} (${m.count})</option>`).join("");
  select.value = current;
  pendingManufacturer = "";
  syncCatalogFilters();
}

async function loadCatalog() {
  const params = new URLSearchParams();
  if ($("#catalog-kind").value) params.set("kind", $("#catalog-kind").value);
  const manufacturer = $("#catalog-manufacturer").value || pendingManufacturer;
  if (manufacturer) params.set("manufacturer", manufacturer);
  if ($("#catalog-q").value) params.set("q", $("#catalog-q").value);
  const lead = $("#catalog-leadtime").value;
  if (lead === "listed") params.set("lead_time", "listed");
  else if (lead) params.set("max_lead_time_days", lead);
  const request = ++catalogRequest;
  const rows = await api(`/api/actuators?${params}`);
  if (request !== catalogRequest) return;
  remember(rows);
  catalogBase = rows;
  applyCatalogFilters();
}

function activeRangeFilters() {
  return $$(".cat-num").filter((el) => el.value !== "" && !el.closest(".hidden") && el.checkValidity());
}

function applyCatalogFilters() {
  const actuation = $("#catalog-actuation").value;
  const ranges = activeRangeFilters().map((el) => [el.dataset.key, el.dataset.op, Number(el.value)]);
  let rows = actuation ? catalogBase.filter((a) => a.actuation === actuation) : catalogBase;
  const unlisted = rows.filter((a) => ranges.some(([k]) => isMissing(a[k]))).length;
  rows = rows.filter((a) =>
    ranges.every(([k, op, v]) => !isMissing(a[k]) && (op === "min" ? a[k] >= v : a[k] <= v)),
  );
  hiddenUnlisted = unlisted;
  catalogRows = rows;
  catalogLimit = CATALOG_PAGE;
  renderCatalog();
  renderChart();
}

$("#catalog-table thead").addEventListener("click", (e) => {
  const th = e.target.closest("th[data-sort]");
  if (!th) return;
  if (sortKey !== th.dataset.sort) {
    sortKey = th.dataset.sort;
    sortDir = 1;
  } else if (sortDir > 0) sortDir = -1;
  else sortKey = "";
  renderCatalog();
  syncUrl();
});
$("#catalog-more").addEventListener("click", () => {
  catalogLimit += CATALOG_PAGE;
  renderCatalog();
});

function rowClick(e) {
  if (e.target.closest("input, button, a")) return;
  const row = e.target.closest("tr[data-id]");
  if (row) showDetail(row.dataset.id);
}

$("#catalog-table tbody").addEventListener("click", rowClick);
const CATALOG_FILTERS = ["#catalog-q", "#catalog-kind", "#catalog-actuation", "#catalog-manufacturer", "#catalog-leadtime"];

function syncCatalogFilters() {
  const kind = $("#catalog-kind").value;
  for (const label of $$(".range-filters label[data-kind]")) label.classList.toggle("hidden", label.dataset.kind !== kind);
  $("#range-hint").classList.toggle("hidden", Boolean(kind));
  const inputs = [...CATALOG_FILTERS.map((sel) => $(sel)), ...$$(".cat-num")];
  for (const el of inputs) el.classList.toggle("is-set", el.value !== "");
  $("#catalog-reset").disabled = inputs.every((el) => el.value === "");
}

const loadCatalogSoon = debounce(loadCatalog, 150);
const applyCatalogFiltersSoon = debounce(applyCatalogFilters, 200);
$("#catalog-q").addEventListener("input", () => {
  syncCatalogFilters();
  loadCatalogSoon();
  syncUrl();
});
for (const sel of ["#catalog-kind", "#catalog-manufacturer", "#catalog-leadtime"]) {
  $(sel).addEventListener("change", () => {
    syncCatalogFilters();
    loadCatalog();
    syncUrl();
  });
}
$("#catalog-actuation").addEventListener("change", () => {
  syncCatalogFilters();
  applyCatalogFilters();
  syncUrl();
});
for (const el of $$(".cat-num")) {
  el.addEventListener("input", () => {
    syncCatalogFilters();
    applyCatalogFiltersSoon();
    syncUrl();
  });
}
$("#catalog-reset").addEventListener("click", () => {
  for (const sel of CATALOG_FILTERS) $(sel).value = "";
  for (const el of $$(".cat-num")) el.value = "";
  syncCatalogFilters();
  loadCatalog();
  syncUrl();
});

// ---------- shareable URL state ----------

const URL_SELECTS = { q: "#catalog-q", kind: "#catalog-kind", actuation: "#catalog-actuation", mfr: "#catalog-manufacturer", lead: "#catalog-leadtime" };
let pendingManufacturer = "";

function syncUrl() {
  const p = new URLSearchParams();
  const tab = $(".tab.active")?.dataset.tab;
  if (tab && tab !== "catalog") p.set("tab", tab);
  for (const [key, sel] of Object.entries(URL_SELECTS)) {
    const v = key === "mfr" ? $(sel).value || pendingManufacturer : $(sel).value;
    if (v) p.set(key, v);
  }
  for (const el of $$(".cat-num")) if (el.value !== "" && !el.closest(".hidden")) p.set(el.dataset.key, el.value);
  if ($("#chart-panel").open) p.set("chart", $("#chart-pair").value || pairId(CHART_PAIRS[0]));
  if ($("#chart-panel").open && !$("#chart-log").checked) p.set("scale", "linear");
  if (sortKey) p.set("sort", `${sortKey}:${sortDir > 0 ? "asc" : "desc"}`);
  if (selectedId && !$("#detail").classList.contains("hidden")) p.set("id", selectedId);
  if (selectMode() !== "complete") p.set("s.mode", selectMode());
  for (const el of changedSelectFields()) p.set(`s.${el.name}`, el.value);
  const qs = p.toString();
  history.replaceState(null, "", qs ? `?${qs}` : location.pathname);
}

function changedSelectFields() {
  return [...$("#select-form").elements].filter((el) => {
    if (!el.name || el.type === "radio" || el.closest(".hidden")) return false;
    if (el instanceof HTMLSelectElement) return el.selectedIndex !== Math.max(0, [...el.options].findIndex((o) => o.defaultSelected));
    return el.value !== el.defaultValue;
  });
}

function readUrl() {
  const p = new URLSearchParams(location.search);
  for (const [key, sel] of Object.entries(URL_SELECTS)) {
    const v = p.get(key) ?? "";
    if (key === "mfr") pendingManufacturer = v;
    else if (v) $(sel).value = v;
  }
  for (const el of $$(".cat-num")) if (p.has(el.dataset.key)) el.value = p.get(el.dataset.key);
  const form = $("#select-form");
  const mode = $(`input[name="select-mode"][value="${CSS.escape(p.get("s.mode") ?? "complete")}"]`);
  if (mode) mode.checked = true;
  for (const [key, value] of p) {
    const el = key.startsWith("s.") && form.elements[key.slice(2)];
    if (el instanceof HTMLInputElement || el instanceof HTMLSelectElement) el.value = value;
  }
  const [key, dir] = (p.get("sort") ?? "").split(":");
  if (key && COLUMNS.some((c) => c.id === key)) {
    sortKey = key;
    sortDir = dir === "desc" ? -1 : 1;
  }
  if (p.has("chart")) {
    $("#chart-log").checked = p.get("scale") !== "linear";
    fillChartPairs();
    if ([...$("#chart-pair").options].some((o) => o.value === p.get("chart"))) $("#chart-pair").value = p.get("chart");
    $("#chart-panel").open = true;
  }
  return { tab: p.get("tab"), id: p.get("id") };
}

for (const btn of $$(".copy-link")) {
  btn.addEventListener("click", async () => {
    syncUrl();
    try {
      await navigator.clipboard.writeText(location.href);
      btn.textContent = "Link copied";
    } catch {
      btn.textContent = "Copy failed; use the address bar";
    }
    setTimeout(() => (btn.textContent = "Copy link"), 1800);
  });
}
$("#add-actuator-toggle").addEventListener("click", () => $("#add-actuator").classList.toggle("hidden"));
$("#catalog-csv").addEventListener("click", () => downloadCsv("catalog.csv", sortedRows(catalogRows)));

$("#add-actuator").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/actuators", { method: "POST", body: formData(e.target) });
    e.target.reset();
    e.target.classList.add("hidden");
    $("#add-actuator-error").textContent = "";
    await Promise.all([loadCatalog(), loadManufacturers()]);
  } catch (err) {
    $("#add-actuator-error").textContent = err.message;
  }
});

// ---------- chart ----------

const AXES = {
  peak_force_n: ["Peak force", "N", "peak_force_n"],
  continuous_force_n: ["Continuous force", "N", "continuous_force_n"],
  max_speed_mm_s: ["Max speed", "mm/s", "speed_mm_s"],
  stroke_mm: ["Max stroke", "mm", "stroke_mm"],
  peak_torque_nm: ["Peak torque", "N·m", "peak_torque_nm"],
  continuous_torque_nm: ["Continuous torque", "N·m", "continuous_torque_nm"],
  max_speed_rpm: ["Max speed", "rpm", "speed_rpm"],
  mass_kg: ["Mass", "kg", null],
  price_usd: ["Price", "USD", null],
};
const CHART_PAIRS = [
  ["linear", "max_speed_mm_s", "peak_force_n"],
  ["linear", "max_speed_mm_s", "continuous_force_n"],
  ["linear", "stroke_mm", "peak_force_n"],
  ["linear", "mass_kg", "peak_force_n"],
  ["linear", "price_usd", "peak_force_n"],
  ["rotary", "max_speed_rpm", "peak_torque_nm"],
  ["rotary", "max_speed_rpm", "continuous_torque_nm"],
  ["rotary", "mass_kg", "peak_torque_nm"],
  ["rotary", "price_usd", "peak_torque_nm"],
];
const pairId = ([kind, x, y]) => `${kind}:${x}:${y}`;
const axisLabel = (key) => `${AXES[key][0]} (${AXES[key][1]})`;
const SVG_NS = "http://www.w3.org/2000/svg";

function fillChartPairs() {
  const select = $("#chart-pair");
  const current = select.value;
  const kind = $("#catalog-kind").value;
  const group = (k) =>
    `<optgroup label="${k === "linear" ? "Linear" : "Rotary"}">${CHART_PAIRS.filter((p) => p[0] === k)
      .map((p) => `<option value="${pairId(p)}">${AXES[p[2]][0]} vs ${AXES[p[1]][0].toLowerCase()}</option>`)
      .join("")}</optgroup>`;
  select.innerHTML = (kind ? [kind] : ["linear", "rotary"]).map(group).join("");
  if ([...select.options].some((o) => o.value === current)) select.value = current;
}

function chartRequirement(kind) {
  const form = $("#select-form");
  if (form.elements.kind.value === kind) {
    const fromSelection = {};
    for (const [, , reqKey] of Object.values(AXES)) {
      const el = reqKey && form.elements[reqKey];
      if (el && el.value !== "" && !el.closest(".hidden")) fromSelection[reqKey] = Number(el.value);
    }
    if (Object.keys(fromSelection).length) return { values: fromSelection, label: "Selection requirement" };
  }
  if (lastRequired?.kind === kind) return { values: lastRequired, label: "Sizing requirement (incl. safety factor)" };
  return null;
}

function niceTicks(min, max) {
  const step0 = (max - min || 1) / 6;
  const mag = 10 ** Math.floor(Math.log10(step0));
  const step = [1, 2, 5, 10].map((m) => m * mag).find((s) => s >= step0);
  const ticks = [];
  for (let v = Math.ceil(min / step) * step; v <= max * (1 + 1e-9); v += step) ticks.push(Number(v.toPrecision(12)));
  return ticks;
}

function makeScale(values, log, extra) {
  const all = [...values, ...extra];
  if (log) {
    const lo = Math.floor(Math.log10(Math.min(...all)));
    let hi = Math.ceil(Math.log10(Math.max(...all)));
    if (hi === lo) hi += 1;
    const ticks = [];
    for (let e = lo; e <= hi; e++) {
      ticks.push(10 ** e);
      if (hi - lo <= 2 && e < hi) ticks.push(2 * 10 ** e, 5 * 10 ** e);
    }
    return { f: (v) => (Math.log10(v) - lo) / (hi - lo), ticks };
  }
  const max = Math.max(...all) * 1.05 || 1;
  return { f: (v) => v / max, ticks: niceTicks(0, max) };
}

const tickLabel = (v) => (v >= 1e6 ? `${fmt(v / 1e6)}M` : v >= 1e3 ? `${fmt(v / 1e3)}k` : fmt(v));

function svgEl(tag, attrs = {}, text) {
  const el = document.createElementNS(SVG_NS, tag);
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
  if (text !== undefined) el.textContent = text;
  return el;
}

function renderChart() {
  if (!$("#chart-panel").open) return;
  fillChartPairs();
  const pair = CHART_PAIRS.find((p) => pairId(p) === $("#chart-pair").value) ?? CHART_PAIRS[0];
  const [kind, xKey, yKey] = pair;
  const log = $("#chart-log").checked;
  const rows = catalogRows.filter((a) => a.kind === kind);
  const plottable = (v) => !isMissing(v) && (!log || v > 0);
  const points = rows.filter((a) => plottable(a[xKey]) && plottable(a[yKey]));
  const missing = rows.length - points.length;
  $("#chart-count").textContent =
    `${points.length} plotted` + (missing ? ` · ${missing} not plotted because ${AXES[xKey][0].toLowerCase()} or ${AXES[yKey][0].toLowerCase()} is unlisted${log ? " or zero" : ""}` : "");

  const box = $("#chart");
  box.innerHTML = "";
  if (!points.length) {
    box.innerHTML = `<p class="note-meta">No ${kind} parts in the current filter have both values published.</p>`;
    $("#chart-legend").innerHTML = "";
    return;
  }

  const req = chartRequirement(kind);
  const rx = req && AXES[xKey][2] ? req.values[AXES[xKey][2]] : null;
  const ry = req && AXES[yKey][2] ? req.values[AXES[yKey][2]] : null;
  const reqX = plottable(rx) ? rx : null;
  const reqY = plottable(ry) ? ry : null;

  const W = Math.max(320, box.clientWidth);
  const H = Math.round(Math.min(420, Math.max(260, W * 0.45)));
  const m = { l: 62, r: 16, t: 14, b: 44 };
  const pw = W - m.l - m.r;
  const ph = H - m.t - m.b;
  const sx = makeScale(points.map((a) => a[xKey]), log, reqX ? [reqX] : []);
  const sy = makeScale(points.map((a) => a[yKey]), log, reqY ? [reqY] : []);
  const X = (v) => m.l + sx.f(v) * pw;
  const Y = (v) => m.t + ph - sy.f(v) * ph;

  const svg = svgEl("svg", { viewBox: `0 0 ${W} ${H}`, width: W, height: H, role: "img", "aria-label": `${axisLabel(yKey)} vs ${axisLabel(xKey)}` });
  const grid = svgEl("g", { class: "chart-grid" });
  for (const t of sx.ticks) {
    grid.append(svgEl("line", { x1: X(t), x2: X(t), y1: m.t, y2: m.t + ph }));
    grid.append(svgEl("text", { x: X(t), y: m.t + ph + 16, "text-anchor": "middle" }, tickLabel(t)));
  }
  for (const t of sy.ticks) {
    grid.append(svgEl("line", { x1: m.l, x2: m.l + pw, y1: Y(t), y2: Y(t) }));
    grid.append(svgEl("text", { x: m.l - 6, y: Y(t) + 4, "text-anchor": "end" }, tickLabel(t)));
  }
  grid.append(svgEl("text", { class: "axis-title", x: m.l + pw / 2, y: H - 6, "text-anchor": "middle" }, axisLabel(xKey)));
  grid.append(svgEl("text", { class: "axis-title", x: 14, y: m.t + ph / 2, "text-anchor": "middle", transform: `rotate(-90 14 ${m.t + ph / 2})` }, axisLabel(yKey)));
  svg.append(grid);

  if (reqX !== null || reqY !== null) {
    const g = svgEl("g", { class: "chart-req" });
    const x0 = reqX !== null ? X(reqX) : m.l;
    const y0 = reqY !== null ? Y(reqY) : m.t + ph;
    g.append(svgEl("rect", { class: "req-zone", x: x0, y: m.t, width: m.l + pw - x0, height: y0 - m.t }));
    if (reqX !== null) g.append(svgEl("line", { x1: x0, x2: x0, y1: m.t, y2: m.t + ph }));
    if (reqY !== null) g.append(svgEl("line", { x1: m.l, x2: m.l + pw, y1: y0, y2: y0 }));
    if (reqX !== null && reqY !== null) g.append(svgEl("circle", { class: "req-point", cx: x0, cy: y0, r: 6 }));
    svg.append(g);
  }

  const open = $("#detail").classList.contains("hidden") ? null : selectedId;
  const dots = svgEl("g", { class: "chart-points" });
  for (const a of [...points].sort((p, q) => (p.id === open) - (q.id === open))) {
    const c = svgEl("circle", {
      cx: X(a[xKey]).toFixed(1),
      cy: Y(a[yKey]).toFixed(1),
      r: a.id === open ? 7 : 3.5,
      class: `pt pt-${a.actuation}${a.id === open ? " pt-selected" : ""}`,
      "data-id": a.id,
    });
    c.append(svgEl("title", {}, `${a.name}\n${axisLabel(xKey)}: ${fmt(a[xKey])}\n${axisLabel(yKey)}: ${fmt(a[yKey])}`));
    dots.append(c);
  }
  svg.append(dots);
  box.append(svg);

  const acts = [...new Set(points.map((a) => a.actuation))];
  $("#chart-legend").innerHTML =
    acts.map((act) => `<span><i class="swatch pt-${esc(act)}"></i>${esc(act)}</span>`).join("") +
    (req && (reqX !== null || reqY !== null)
      ? `<span><i class="swatch req"></i>${esc(req.label)}; shaded area meets it</span>`
      : `<span class="note-meta">Run Sizing or enter Selection requirements to overlay the operating point.</span>`);
}

const renderChartSoon = debounce(renderChart, 150);
$("#chart-panel").addEventListener("toggle", () => {
  renderChart();
  syncUrl();
});
$("#chart-pair").addEventListener("change", () => {
  renderChart();
  syncUrl();
});
$("#chart-log").addEventListener("change", () => {
  renderChart();
  syncUrl();
});
$("#chart").addEventListener("click", (e) => {
  const id = e.target.dataset?.id;
  if (id) showDetail(id);
});
window.addEventListener("resize", renderChartSoon);

// ---------- suppliers ----------

const link = (url, text) => (url ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(text)}</a>` : "");
const SUPPLIER_LINKS = [
  ["website", "Website"],
  ["contact_url", "Contact"],
  ["store_url", "Store"],
  ["distributor_url", "Where to buy"],
];

function supplierLinks(m) {
  return SUPPLIER_LINKS.filter(([k]) => m[k]).map(([k, label]) => link(m[k], label)).join(" · ") || UNLISTED;
}

function phoneHtml(phone) {
  if (!phone) return "";
  return phone
    .split(";")
    .map((part) => {
      const number = part.replace(/\(.*?\)/g, "").replace(/[^+\d]/g, "");
      return number.length >= 7 ? `<a href="tel:${esc(number)}">${esc(part.trim())}</a>` : esc(part.trim());
    })
    .join("<br>");
}

const orUnlisted = (v) => (isMissing(v) ? '<span class="unlisted">unlisted</span>' : v);

function renderSupplierCard(a) {
  const m = suppliers.find((s) => s.name === a.manufacturer) ?? {};
  const lead = a.lead_time
    ? `${esc(a.lead_time)}${isMissing(a.lead_time_days) ? "" : ` <span class="tag">≤ ${fmt(a.lead_time_days)} calendar days</span>`}
       <div class="note-meta">${link(a.lead_time_url, "lead-time source")}${a.lead_time_retrieved_on ? ` · checked ${esc(a.lead_time_retrieved_on)}` : ""}</div>`
    : '<span class="unlisted">unlisted</span>: no published lead time for this part. Ask the supplier below.';
  return `<dl>
    <dt>Lead time</dt><dd>${lead}</dd>
    <dt>Supplier</dt><dd>${esc(a.manufacturer) || UNLISTED}</dd>
    <dt>Links</dt><dd>${supplierLinks(m)}</dd>
    <dt>Phone</dt><dd>${orUnlisted(phoneHtml(m.phone))}</dd>
    <dt>Email</dt><dd>${orUnlisted(m.sales_email ? `<a href="mailto:${esc(m.sales_email)}">${esc(m.sales_email)}</a>` : "")}</dd>
    <dt>Address</dt><dd>${orUnlisted(esc(m.address ?? ""))}</dd>
    <dt>Supplier lead-time policy</dt><dd>${orUnlisted(esc(m.lead_time_note ?? ""))}${m.lead_time_url ? ` ${link(m.lead_time_url, "source")}` : ""}</dd>
  </dl>`;
}

const SUPPLIER_TEXT = ["name", "website", "phone", "sales_email", "address", "lead_time_note"];

function filteredSuppliers() {
  const terms = $("#suppliers-q").value.toLowerCase().split(/\s+/).filter(Boolean);
  return suppliers.filter((m) => {
    const hay = SUPPLIER_TEXT.map((k) => m[k] ?? "").join(" ").toLowerCase();
    return terms.every((t) => hay.includes(t));
  });
}

function renderSuppliers() {
  const rows = filteredSuppliers();
  $("#suppliers-count").textContent = `${rows.length} of ${suppliers.length} suppliers`;
  $("#suppliers-table tbody").innerHTML = rows
    .map(
      (m) => `<tr>
        <td><button class="link" data-supplier="${esc(m.name)}" title="Show this supplier's parts in Catalog">${esc(m.name)}</button></td>
        <td>${m.count}</td><td>${supplierLinks(m)}</td>
        <td>${orUnlisted(phoneHtml(m.phone))}</td>
        <td>${orUnlisted(m.sales_email ? `<a href="mailto:${esc(m.sales_email)}">${esc(m.sales_email)}</a>` : "")}</td>
        <td>${orUnlisted(esc(m.address ?? ""))}</td>
        <td>${orUnlisted(esc(m.lead_time_note ?? ""))}${m.lead_time_url ? ` ${link(m.lead_time_url, "source")}` : ""}
          ${m.retrieved_on ? `<div class="note-meta">checked ${esc(m.retrieved_on)}</div>` : ""}</td>
      </tr>`,
    )
    .join("");
}

$("#suppliers-q").addEventListener("input", renderSuppliers);
$("#suppliers-table tbody").addEventListener("click", (e) => {
  const name = e.target.dataset.supplier;
  if (!name) return;
  $("#catalog-manufacturer").value = name;
  syncCatalogFilters();
  loadCatalog();
  showTab("catalog");
});
$("#suppliers-csv").addEventListener("click", () => {
  const cols = ["name", "count", "website", "contact_url", "store_url", "distributor_url", "phone", "sales_email", "address", "lead_time_note", "lead_time_url", "source", "retrieved_on"];
  const cell = (v) => {
    const s = isMissing(v) ? "" : String(v);
    return /[",\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
  };
  const csv = [cols.join(","), ...filteredSuppliers().map((m) => cols.map((c) => cell(m[c])).join(","))].join("\n");
  const url = URL.createObjectURL(new Blob([csv], { type: "text/csv" }));
  Object.assign(document.createElement("a"), { href: url, download: "suppliers.csv" }).click();
  URL.revokeObjectURL(url);
});

// ---------- detail + notes ----------

function specValue(a, key) {
  const v = displayValue(a, key);
  if (isMissing(v)) return '<span class="unlisted">unlisted</span>';
  if (key === "datasheet_url" || key === "lead_time_url") return link(v, v);
  return esc(v);
}

async function showDetail(id) {
  selectedId = id;
  const a = await getActuator(id);
  $("#detail-title").textContent = a.name;
  $("#detail-supplier").innerHTML = renderSupplierCard(a);
  $("#detail-specs").innerHTML = FIELDS.filter(([k, , scope]) => fieldApplies(a, scope) && !k.startsWith("lead_time"))
    .filter(([k]) => !(OPTIONAL_TEXT.has(k) && isMissing(a[k])))
    .map(([k, label]) => `<dt>${label}</dt><dd>${specValue(a, k)}</dd>`)
    .join("");
  $("#delete-actuator").classList.toggle("hidden", !a.user_added);
  $("#detail").classList.remove("hidden");
  $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
  markSelected();
  renderChart();
  syncUrl();
  await loadNotes();
}

function markSelected() {
  const open = !$("#detail").classList.contains("hidden");
  for (const tr of $$("tr[data-id]")) tr.classList.toggle("selected", open && tr.dataset.id === selectedId);
}

function closeDetail() {
  $("#detail").classList.add("hidden");
  markSelected();
  renderChart();
  syncUrl();
}

document.addEventListener("keydown", (e) => {
  const typing = e.target instanceof Element && e.target.closest("input, textarea, select");
  if (e.key === "Escape" && !typing && !$("#detail").classList.contains("hidden")) closeDetail();
});

async function loadNotes() {
  const notes = await api(`/api/actuators/${encodeURIComponent(selectedId)}/notes`);
  $("#notes-list").innerHTML =
    notes
      .map(
        (n) => `<li>${esc(n.text)}
          <div class="note-meta">${esc(n.created_at)}
            ${n.source_url ? ` · <a href="${esc(n.source_url)}" target="_blank" rel="noopener">source</a>` : ""}
            · <button class="link" data-note="${esc(n.id)}">delete</button></div></li>`,
      )
      .join("") || "<li class='note-meta'>No notes yet.</li>";
}

$("#detail-close").addEventListener("click", closeDetail);
$("#detail-shortlist").addEventListener("click", () => addToShortlist([selectedId]));
$("#detail-compare").addEventListener("click", () => addToCompare([selectedId]));

$("#delete-actuator").addEventListener("click", async () => {
  if (!confirm("Delete this actuator?")) return;
  await api(`/api/actuators/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
  cache.delete(selectedId);
  closeDetail();
  await Promise.all([loadCatalog(), loadManufacturers()]);
});

$("#note-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  await api(`/api/actuators/${encodeURIComponent(selectedId)}/notes`, { method: "POST", body: formData(e.target) });
  e.target.reset();
  await loadNotes();
});

$("#notes-list").addEventListener("click", async (e) => {
  const id = e.target.dataset.note;
  if (!id) return;
  await api(`/api/notes/${encodeURIComponent(id)}`, { method: "DELETE" });
  await loadNotes();
});

// ---------- sizing ----------

let lastRequired = null;

function sizingKind() {
  return $('input[name="sizing-kind"]:checked').value;
}

function syncSizingKind() {
  const linear = sizingKind() === "linear";
  $("#sizing-linear").classList.toggle("hidden", !linear);
  $("#sizing-rotary").classList.toggle("hidden", linear);
}

$$('input[name="sizing-kind"]').forEach((r) =>
  r.addEventListener("change", () => {
    syncSizingKind();
    runSizing();
  }),
);

function renderSegments(segments, key, unit) {
  return `<table class="data"><thead><tr><th>Phase</th><th>Duration (s)</th><th>${unit}</th></tr></thead><tbody>
    ${segments.map((s) => `<tr><td>${s.phase}</td><td>${fmt(s.duration_s)}</td><td>${fmt(s[key])}</td></tr>`).join("")}
  </tbody></table>`;
}

function renderSizing(r) {
  const req = r.required;
  const lines =
    req.kind === "linear"
      ? [
          ["Peak velocity", `${fmt(r.peak_velocity_mm_s)} mm/s`],
          ["Acceleration", `${fmt(r.acceleration_m_s2)} m/s²`],
          ["Peak force", `${fmt(r.peak_force_n)} N`],
          ["RMS force", `${fmt(r.rms_force_n)} N`],
          ["Peak mechanical power", `${fmt(r.peak_mechanical_power_w)} W`],
          ["Duty cycle", `${fmt(r.duty_cycle_pct)} %`],
          ...(r.screw
            ? [
                ["Motor speed (screw)", `${fmt(r.screw.motor_speed_rpm)} rpm`],
                ["Peak motor torque (screw)", `${fmt(r.screw.peak_motor_torque_nm)} N·m`],
                ["RMS motor torque (screw)", `${fmt(r.screw.rms_motor_torque_nm)} N·m`],
              ]
            : []),
        ]
      : [
          ["Peak load speed", `${fmt(r.peak_load_speed_rpm)} rpm`],
          ["Peak motor speed", `${fmt(r.peak_motor_speed_rpm)} rpm`],
          ["Peak motor torque", `${fmt(r.peak_torque_nm)} N·m`],
          ["RMS motor torque", `${fmt(r.rms_torque_nm)} N·m`],
          ["Reflected inertia", `${fmt(r.reflected_inertia_kgm2)} kg·m²`],
          ["Inertia ratio", r.inertia_ratio === null ? UNLISTED : `${fmt(r.inertia_ratio)} : 1`],
          ["Peak mechanical power", `${fmt(r.peak_mechanical_power_w)} W`],
          ["Duty cycle", `${fmt(r.duty_cycle_pct)} %`],
        ];
  const segs =
    req.kind === "linear"
      ? renderSegments(r.segments, "force_n", "Force (N)")
      : renderSegments(r.segments, "torque_nm", "Motor torque (N·m)");
  $("#sizing-result").innerHTML = `
    <h3>Results</h3>
    <dl>${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <h4>Profile segments</h4>${segs}
    <button id="send-to-select" type="button">Find complete actuators (with safety factor)</button>
    ${req.kind === "linear" ? '<button id="send-to-transmission" type="button">Find motor + lead screw</button>' : ""}`;
  $("#sizing-result").classList.remove("hidden");
  lastRequired = req;
  $("#send-to-select").addEventListener("click", () => sendToSelection("complete"));
  $("#send-to-transmission")?.addEventListener("click", () => sendToSelection("transmission"));
}

function sendToSelection(mode) {
  $(`input[name="select-mode"][value="${mode}"]`).checked = true;
  const form = $("#select-form");
  for (const name of ["peak_force_n", "continuous_force_n", "speed_mm_s", "stroke_mm", "peak_torque_nm",
    "continuous_torque_nm", "speed_rpm", "duty_cycle_pct", "load_inertia_kgm2"]) {
    const v = lastRequired[name];
    form.elements[name].value = isMissing(v) ? "" : Number(Number(v).toPrecision(4));
  }
  form.elements.kind.value = lastRequired.kind;
  syncSelectForm();
  showTab("select");
  form.requestSubmit();
}

let sizingRan = false;
let sizingRequest = 0;

async function runSizing() {
  const kind = sizingKind();
  const form = $(`#sizing-${kind}`);
  const status = $(".sizing-status", form);
  const invalid = $$("input", form).find((el) => !el.checkValidity());
  if (invalid) {
    status.textContent = `Fix "${invalid.closest("label")?.firstChild.textContent.trim() ?? invalid.name}" to update results.`;
    return;
  }
  sizingRan = true;
  const request = ++sizingRequest;
  status.textContent = "Updating…";
  try {
    const r = await api(`/api/sizing/${kind}`, { method: "POST", body: formData(form) });
    if (request !== sizingRequest) return;
    renderSizing(r);
    renderChartSoon();
    status.textContent = "Results update as you edit.";
  } catch (err) {
    if (request !== sizingRequest) return;
    $("#sizing-result").innerHTML = `<p class="error">${esc(err.message)}</p>`;
    $("#sizing-result").classList.remove("hidden");
    status.textContent = "";
  }
}

const runSizingSoon = debounce(runSizing, 300);
for (const kind of ["linear", "rotary"]) {
  const form = $(`#sizing-${kind}`);
  form.addEventListener("submit", (e) => {
    e.preventDefault();
    runSizing();
  });
  form.addEventListener("input", runSizingSoon);
}

// ---------- selection ----------

let lastSelection = [];

function selectMode() {
  return $('input[name="select-mode"]:checked').value;
}

function syncSelectForm() {
  const form = $("#select-form");
  const linear = form.elements.kind.value === "linear";
  const transmission = selectMode() === "transmission";
  for (const el of $$(".linear-only, .rotary-only, .transmission-only, .complete-only, .inertia-field", form)) {
    const c = el.classList;
    const hide =
      (c.contains("linear-only") && !linear) ||
      (c.contains("rotary-only") && linear) ||
      (c.contains("transmission-only") && !transmission) ||
      (c.contains("complete-only") && transmission) ||
      (c.contains("inertia-field") && linear && !transmission);
    c.toggle("hidden", hide);
  }
}
$('#select-form [name="kind"]').addEventListener("change", syncSelectForm);
$$('input[name="select-mode"]').forEach((r) => r.addEventListener("change", syncSelectForm));

const parseList = (s) =>
  String(s ?? "")
    .split(/[,\s]+/)
    .filter(Boolean)
    .map(Number);

function renderCandidate(c) {
  const a = c.actuator;
  const margins = Object.entries(c.margins)
    .map(([k, m]) => `<span class="${m !== null && m >= 1 ? "ok" : "bad"}">${k}: ${m === null ? "unlisted" : `${fmt(m)}×`}</span>`)
    .join(" · ");
  const computed = Object.entries(c.computed ?? {})
    .map(([k, v]) => `${k.replaceAll("_", " ")}: ${fmt(v)}`)
    .join("<br>");
  const notes = [
    ...c.issues.map((i) => `<span class="bad">${esc(i)}</span>`),
    ...c.unlisted.map((u) => `<span class="unlisted">${esc(u)}: unlisted</span>`),
    ...c.warnings.map((w) => `<span class="warn">${esc(w)}</span>`),
  ].join("<br>");
  return `<tr data-id="${esc(a.id)}">${checkCell(a.id)}<td>${esc(a.name)}</td><td>${esc(a.manufacturer) || UNLISTED}</td>
    ${c.transmission ? `<td>${esc(c.transmission.label)}</td>` : ""}
    <td>${isMissing(c.min_margin) ? UNLISTED : `${fmt(c.min_margin)}×`}</td><td>${margins}${computed ? `<br>${computed}` : ""}</td>
    <td>${notes}</td></tr>`;
}

function resultTable(group, rows, limit, withTransmission) {
  const head = `<tr><th></th><th>Name</th><th>Manufacturer</th>${withTransmission ? "<th>Transmission</th>" : ""}
    <th>Min margin</th><th>Margins</th><th>Issues, unlisted specs, warnings</th></tr>`;
  const body = rows.slice(0, limit).map(renderCandidate).join("") || `<tr><td colspan="7">None</td></tr>`;
  const more =
    rows.length > limit
      ? `<button type="button" class="more" data-more="${group}">Show ${Math.min(RESULT_PAGE[group], rows.length - limit)} more (${rows.length - limit} not shown)</button>`
      : "";
  return `<div class="table-scroll"><table class="data"><thead>${head}</thead><tbody>${body}</tbody></table></div>${more}`;
}

let selectionRan = false;
let selectRequest = 0;
const RESULT_PAGE = { feasible: 100, unverified: 50, rejected: 25 };
const RESULT_GROUPS = [
  ["feasible", "group-ok", "Feasible"],
  ["unverified", "group-warn", "Unverified: nothing fails, but a needed spec is unlisted"],
  ["rejected", "group-bad", "Rejected, closest first"],
];
let lastResult = null;
let resultLimits = { ...RESULT_PAGE };

function renderSelectionResult() {
  const { r, transmission } = lastResult;
  $("#select-result").innerHTML = RESULT_GROUPS.map(
    ([group, cls, title]) => `<section class="result-group ${cls}"><h3>${title} <span class="count">${r[group].length}</span></h3>
      ${resultTable(group, r[group], resultLimits[group], transmission)}</section>`,
  ).join("");
  markSelected();
}

async function runSelection() {
  const form = $("#select-form");
  const invalid = $$("input, select", form).find((el) => !el.closest(".hidden") && !el.checkValidity());
  if (invalid) {
    $("#select-status").textContent = `Fix "${invalid.closest("label")?.firstChild.textContent.trim() ?? invalid.name}" to update results.`;
    return;
  }
  selectionRan = true;
  syncUrl();
  renderChartSoon();
  const transmission = selectMode() === "transmission";
  const body = formData(form, { visibleOnly: true });
  for (const key of ["screw_leads_mm", "gear_ratios"]) if (key in body) body[key] = parseList(body[key]);
  const request = ++selectRequest;
  $("#select-status").textContent = "Updating…";
  try {
    const r = await api(transmission ? "/api/select/transmission" : "/api/select", { method: "POST", body });
    if (request !== selectRequest) return;
    lastSelection = [...r.feasible, ...r.unverified, ...r.rejected];
    remember(lastSelection.map((c) => c.actuator));
    $("#select-summary").innerHTML = `<span class="chip ok-chip">${r.feasible.length} feasible</span>
      <span class="chip warn-chip">${r.unverified.length} unverified</span>
      <span class="chip bad-chip">${r.rejected.length} rejected</span>`;
    lastResult = { r, transmission };
    resultLimits = { ...RESULT_PAGE };
    renderSelectionResult();
    $("#select-status").textContent = "Results update as you edit.";
  } catch (err) {
    if (request !== selectRequest) return;
    $("#select-summary").innerHTML = "";
    $("#select-result").innerHTML = `<p class="error">${esc(err.message)}</p>`;
    $("#select-status").textContent = "";
  }
}

const runSelectionSoon = debounce(runSelection, 250);
$("#select-form").addEventListener("submit", (e) => {
  e.preventDefault();
  runSelection();
});
$("#select-form").addEventListener("input", (e) => {
  if (e.target.type !== "radio" && e.target.tagName !== "SELECT") runSelectionSoon();
});
$("#select-form").addEventListener("change", (e) => {
  if (e.target.type === "radio" || e.target.tagName === "SELECT") runSelection();
});
$("#select-reset").addEventListener("click", () => {
  const form = $("#select-form");
  const kind = form.elements.kind.value;
  const mode = selectMode();
  form.reset();
  form.elements.kind.value = kind;
  $(`input[name="select-mode"][value="${mode}"]`).checked = true;
  syncSelectForm();
  runSelection();
});

$("#select-result").addEventListener("click", (e) => {
  const group = e.target.dataset.more;
  if (group) {
    resultLimits[group] += RESULT_PAGE[group];
    renderSelectionResult();
    return;
  }
  rowClick(e);
});
$("#select-csv").addEventListener("click", () =>
  downloadCsv("selection.csv", lastSelection, [
    ["status", (c) => c.status],
    ["transmission", (c) => c.transmission?.label ?? ""],
    ["min_margin", (c) => c.min_margin],
    ["issues", (c) => c.issues.join("; ")],
    ["unlisted", (c) => c.unlisted.join("; ")],
    ["warnings", (c) => c.warnings.join("; ")],
  ]),
);

// ---------- compare ----------

async function renderCompare() {
  const list = await Promise.all(state.compare.map(getActuator));
  if (!list.length) {
    $("#compare-table").innerHTML = "<p class='note-meta'>Nothing to compare yet.</p>";
    return;
  }
  const rows = FIELDS.filter(([, , scope]) => list.some((a) => fieldApplies(a, scope))).map(([k, label]) => {
    const values = list.map((a) => displayValue(a, k));
    const differs = new Set(values.map((v) => JSON.stringify(v ?? ""))).size > 1;
    return `<tr class="${differs ? "differs" : ""}"><th>${label}</th>${list.map((a) => `<td>${specValue(a, k)}</td>`).join("")}</tr>`;
  });
  $("#compare-table").innerHTML = `<table class="data compare"><thead><tr><th></th>${list
    .map((a) => `<th>${esc(a.name)}<br><button class="link" data-remove="${esc(a.id)}">remove</button></th>`)
    .join("")}</tr></thead><tbody>${rows.join("")}</tbody></table>`;
}

$("#compare-table").addEventListener("click", (e) => {
  const id = e.target.dataset.remove;
  if (!id) return;
  state.compare = state.compare.filter((x) => x !== id);
  persist();
  renderCompare();
});
$("#compare-clear").addEventListener("click", () => {
  state.compare = [];
  persist();
  renderCompare();
});
$("#compare-csv").addEventListener("click", async () =>
  downloadCsv("compare.csv", await Promise.all(state.compare.map(getActuator))),
);

// ---------- shortlist + projects ----------

async function renderShortlist() {
  const list = await Promise.all(state.shortlist.map(getActuator));
  $("#shortlist-body").innerHTML =
    list
      .map(
        (a) => `<tr data-id="${esc(a.id)}"><td>${esc(a.name)}</td><td>${esc(a.manufacturer) || UNLISTED}</td>
        <td>${ratingCells(a).slice(0, 3).join(" · ")}</td>
        <td><button class="link" data-unshort="${esc(a.id)}">remove</button></td></tr>`,
      )
      .join("") || "<tr><td class='note-meta'>Shortlist is empty. Add parts from Catalog, Selection or the detail panel.</td></tr>";
}

$("#shortlist-body").addEventListener("click", (e) => {
  const id = e.target.dataset.unshort;
  if (id) {
    state.shortlist = state.shortlist.filter((x) => x !== id);
    persist();
    renderShortlist();
    return;
  }
  rowClick(e);
});
$("#shortlist-compare").addEventListener("click", () => {
  addToCompare(state.shortlist);
  showTab("compare");
});
$("#shortlist-csv").addEventListener("click", async () =>
  downloadCsv("shortlist.csv", await Promise.all(state.shortlist.map(getActuator))),
);

function projectData() {
  return {
    shortlist: state.shortlist,
    compare: state.compare,
    notes: $("#project-notes").value,
    sizing: { kind: sizingKind(), linear: formData($("#sizing-linear")), rotary: formData($("#sizing-rotary")) },
    selection: { mode: selectMode(), form: formData($("#select-form")) },
  };
}

function applyProject(p) {
  const d = p.data ?? {};
  state.projectId = p.id;
  state.projectName = p.name;
  state.shortlist = d.shortlist ?? [];
  state.compare = d.compare ?? [];
  $("#project-name-input").value = p.name;
  $("#project-notes").value = d.notes ?? "";
  if (d.sizing) {
    $(`input[name="sizing-kind"][value="${d.sizing.kind}"]`).checked = true;
    fillForm($("#sizing-linear"), d.sizing.linear ?? {});
    fillForm($("#sizing-rotary"), d.sizing.rotary ?? {});
    syncSizingKind();
    if ($("#sizing").classList.contains("active")) runSizing();
    else sizingRan = false;
  }
  if (d.selection) {
    $(`input[name="select-mode"][value="${d.selection.mode}"]`).checked = true;
    fillForm($("#select-form"), d.selection.form ?? {});
    syncSelectForm();
    if ($("#select").classList.contains("active")) runSelection();
    else selectionRan = false;
  }
  persist();
  renderShortlist();
  renderCompare();
  syncUrl();
}

async function loadProjects() {
  const projects = await api("/api/projects");
  $("#projects-body").innerHTML =
    projects
      .map(
        (p) => `<tr><td>${esc(p.name)}</td><td class="note-meta">updated ${esc(p.updated_at)}</td>
        <td>${(p.data?.shortlist ?? []).length} shortlisted</td>
        <td><button class="link" data-open="${esc(p.id)}">open</button> · <button class="link" data-del="${esc(p.id)}">delete</button></td></tr>`,
      )
      .join("") || "<tr><td class='note-meta'>No saved projects.</td></tr>";
}

async function saveProject(asNew) {
  const name = $("#project-name-input").value.trim() || "Untitled project";
  const body = { name, data: projectData() };
  const saved =
    state.projectId && !asNew
      ? await api(`/api/projects/${state.projectId}`, { method: "PUT", body })
      : await api("/api/projects", { method: "POST", body });
  state.projectId = saved.id;
  state.projectName = saved.name;
  persist();
  await loadProjects();
}

$("#project-save").addEventListener("click", () => saveProject(false));
$("#project-save-new").addEventListener("click", () => saveProject(true));
$("#project-new").addEventListener("click", () => {
  state.projectId = null;
  state.projectName = "";
  state.shortlist = [];
  state.compare = [];
  $("#project-name-input").value = "";
  $("#project-notes").value = "";
  persist();
  renderShortlist();
  renderCompare();
});
$("#projects-body").addEventListener("click", async (e) => {
  const { open, del } = e.target.dataset;
  if (open) applyProject(await api(`/api/projects/${open}`));
  if (del && confirm("Delete this project?")) {
    await api(`/api/projects/${del}`, { method: "DELETE" });
    if (state.projectId === del) {
      state.projectId = null;
      state.projectName = "";
      persist();
    }
    await loadProjects();
  }
});

// ---------- init ----------

applyTheme(document.documentElement.dataset.theme);
const initial = readUrl();
renderColumnChooser();
syncCatalogFilters();
restore();
$("#project-name-input").value = state.projectName;
persist();
syncSelectForm();
api("/api/config").then((cfg) => {
  document.body.classList.toggle("read-only", cfg.read_only);
  if (!cfg.read_only) loadProjects();
});
loadManufacturers();
loadCatalog();
renderShortlist();
renderCompare();
if (initial.tab && $(`.tab[data-tab="${CSS.escape(initial.tab)}"]`)) showTab(initial.tab);
if (initial.id) showDetail(initial.id).catch(() => syncUrl());
