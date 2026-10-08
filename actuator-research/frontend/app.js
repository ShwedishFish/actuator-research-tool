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

// ---------- tabs ----------

$$(".tab").forEach((btn) =>
  btn.addEventListener("click", () => {
    $$(".tab").forEach((b) => b.classList.toggle("active", b === btn));
    $$(".panel").forEach((p) => p.classList.toggle("active", p.id === btn.dataset.tab));
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

const CATALOG_RENDER_LIMIT = 300;
let catalogRows = [];
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

function renderCatalog() {
  const rows = sortedRows(catalogRows);
  $("#catalog-count").textContent =
    rows.length > CATALOG_RENDER_LIMIT
      ? `${rows.length} matches; showing the first ${CATALOG_RENDER_LIMIT}. Narrow the search, filter, or sort to see others.`
      : `${rows.length} matches`;
  $("#catalog-table tbody").innerHTML = rows
    .slice(0, CATALOG_RENDER_LIMIT)
    .map(
      (a) => `<tr data-id="${esc(a.id)}">${checkCell(a.id)}
        <td>${esc(a.name)}${a.user_added ? tag("user") : ""}</td><td>${esc(a.manufacturer) || UNLISTED}</td>
        <td>${esc(a.kind)}</td><td>${esc(a.actuation)}</td>
        ${ratingCells(a).map((c) => `<td>${c}</td>`).join("")}
        <td>${withUnit(a.mass_kg, "kg")}</td><td>${isMissing(a.price_usd) ? UNLISTED : `$${fmt(a.price_usd, 6)}`}</td>
      </tr>`,
    )
    .join("");
  $$("#catalog-table th[data-sort]").forEach((th) => {
    th.classList.toggle("sorted", th.dataset.sort === sortKey);
    th.dataset.dir = th.dataset.sort === sortKey ? (sortDir > 0 ? "▲" : "▼") : "";
  });
}

async function loadManufacturers() {
  const list = await api("/api/manufacturers");
  const select = $("#catalog-manufacturer");
  const current = select.value;
  select.innerHTML =
    `<option value="">All manufacturers</option>` +
    list.map((m) => `<option value="${esc(m.name)}">${esc(m.name)} (${m.count})</option>`).join("");
  select.value = current;
}

async function loadCatalog() {
  const params = new URLSearchParams();
  if ($("#catalog-kind").value) params.set("kind", $("#catalog-kind").value);
  if ($("#catalog-manufacturer").value) params.set("manufacturer", $("#catalog-manufacturer").value);
  if ($("#catalog-q").value) params.set("q", $("#catalog-q").value);
  const request = ++catalogRequest;
  let rows = await api(`/api/actuators?${params}`);
  if (request !== catalogRequest) return;
  const actuation = $("#catalog-actuation").value;
  if (actuation) rows = rows.filter((a) => a.actuation === actuation);
  remember(rows);
  catalogRows = rows;
  renderCatalog();
}

$$("#catalog-table th[data-sort]").forEach((th) =>
  th.addEventListener("click", () => {
    if (sortKey === th.dataset.sort) sortDir = -sortDir;
    else {
      sortKey = th.dataset.sort;
      sortDir = 1;
    }
    renderCatalog();
  }),
);

function rowClick(e) {
  if (e.target.closest("input, button, a")) return;
  const row = e.target.closest("tr[data-id]");
  if (row) showDetail(row.dataset.id);
}

$("#catalog-table tbody").addEventListener("click", rowClick);
$("#catalog-q").addEventListener("input", loadCatalog);
$("#catalog-kind").addEventListener("change", loadCatalog);
$("#catalog-actuation").addEventListener("change", loadCatalog);
$("#catalog-manufacturer").addEventListener("change", loadCatalog);
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

// ---------- detail + notes ----------

function specValue(a, key) {
  const v = displayValue(a, key);
  if (isMissing(v)) return '<span class="unlisted">unlisted</span>';
  if (key === "datasheet_url") return `<a href="${esc(v)}" target="_blank" rel="noopener">${esc(v)}</a>`;
  return esc(v);
}

async function showDetail(id) {
  selectedId = id;
  const a = await getActuator(id);
  $("#detail-title").textContent = a.name;
  $("#detail-specs").innerHTML = FIELDS.filter(([k, , scope]) => fieldApplies(a, scope))
    .filter(([k]) => !(OPTIONAL_TEXT.has(k) && isMissing(a[k])))
    .map(([k, label]) => `<dt>${label}</dt><dd>${specValue(a, k)}</dd>`)
    .join("");
  $("#delete-actuator").classList.toggle("hidden", !a.user_added);
  $("#detail").classList.remove("hidden");
  $("#detail").scrollIntoView({ behavior: "smooth", block: "start" });
  await loadNotes();
}

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

$("#detail-close").addEventListener("click", () => $("#detail").classList.add("hidden"));
$("#detail-shortlist").addEventListener("click", () => addToShortlist([selectedId]));
$("#detail-compare").addEventListener("click", () => addToCompare([selectedId]));

$("#delete-actuator").addEventListener("click", async () => {
  if (!confirm("Delete this actuator?")) return;
  await api(`/api/actuators/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
  cache.delete(selectedId);
  $("#detail").classList.add("hidden");
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
    $("#sizing-result").classList.add("hidden");
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

for (const kind of ["linear", "rotary"]) {
  $(`#sizing-${kind}`).addEventListener("submit", async (e) => {
    e.preventDefault();
    try {
      renderSizing(await api(`/api/sizing/${kind}`, { method: "POST", body: formData(e.target) }));
    } catch (err) {
      $("#sizing-result").innerHTML = `<p class="error">${esc(err.message)}</p>`;
      $("#sizing-result").classList.remove("hidden");
    }
  });
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

function resultTable(rows, limit, withTransmission) {
  const head = `<tr><th></th><th>Name</th><th>Manufacturer</th>${withTransmission ? "<th>Transmission</th>" : ""}
    <th>Min margin</th><th>Margins</th><th>Issues, unlisted specs, warnings</th></tr>`;
  const body = rows.slice(0, limit).map(renderCandidate).join("") || `<tr><td colspan="7">None</td></tr>`;
  const more = rows.length > limit ? `<p class="note-meta">Showing ${limit} of ${rows.length}.</p>` : "";
  return `<table class="data"><thead>${head}</thead><tbody>${body}</tbody></table>${more}`;
}

$("#select-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const transmission = selectMode() === "transmission";
  const body = formData(e.target, { visibleOnly: true });
  for (const key of ["screw_leads_mm", "gear_ratios"]) if (key in body) body[key] = parseList(body[key]);
  try {
    const r = await api(transmission ? "/api/select/transmission" : "/api/select", { method: "POST", body });
    lastSelection = [...r.feasible, ...r.unverified, ...r.rejected];
    remember(lastSelection.map((c) => c.actuator));
    $("#select-result").innerHTML = `
      <h3>Feasible (${r.feasible.length})</h3>${resultTable(r.feasible, 100, transmission)}
      <h3>Unverified: nothing fails, but a needed spec is unlisted (${r.unverified.length})</h3>${resultTable(r.unverified, 50, transmission)}
      <h3>Rejected, closest first (${r.rejected.length})</h3>${resultTable(r.rejected, 25, transmission)}`;
  } catch (err) {
    $("#select-result").innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
});

$("#select-result").addEventListener("click", rowClick);
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
  }
  if (d.selection) {
    $(`input[name="select-mode"][value="${d.selection.mode}"]`).checked = true;
    fillForm($("#select-form"), d.selection.form ?? {});
    syncSelectForm();
  }
  persist();
  renderShortlist();
  renderCompare();
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

restore();
$("#project-name-input").value = state.projectName;
persist();
syncSelectForm();
loadManufacturers();
loadCatalog();
loadProjects();
renderShortlist();
renderCompare();
