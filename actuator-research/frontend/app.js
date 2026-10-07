"use strict";

const $ = (sel, root = document) => root.querySelector(sel);
const $$ = (sel, root = document) => [...root.querySelectorAll(sel)];

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]);

const fmt = (v, digits = 3) => (v === null || v === undefined ? "—" : String(Number(Number(v).toPrecision(digits))));

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

function formData(form) {
  const out = {};
  for (const el of form.elements) {
    if (!el.name || el.value === "") continue;
    out[el.name] = el.type === "number" ? Number(el.value) : el.value;
  }
  return out;
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

// ---------- catalog ----------

let selectedId = null;

function ratingCells(a) {
  if (a.kind === "linear") {
    return [`${fmt(a.peak_force_n)} N`, `${fmt(a.continuous_force_n)} N`, `${fmt(a.max_speed_mm_s)} mm/s`, `${fmt(a.stroke_mm)} mm`];
  }
  return [`${fmt(a.peak_torque_nm)} N·m`, `${fmt(a.continuous_torque_nm)} N·m`, `${fmt(a.max_speed_rpm)} rpm`, "—"];
}

async function loadCatalog() {
  const params = new URLSearchParams();
  if ($("#catalog-kind").value) params.set("kind", $("#catalog-kind").value);
  if ($("#catalog-q").value) params.set("q", $("#catalog-q").value);
  const rows = await api(`/api/actuators?${params}`);
  $("#catalog-table tbody").innerHTML = rows
    .map(
      (a) => `<tr data-id="${esc(a.id)}">
        <td>${esc(a.name)}</td><td>${esc(a.kind)}</td><td>${esc(a.actuation)}</td><td>${esc(a.drive)}</td>
        ${ratingCells(a).map((c) => `<td>${c}</td>`).join("")}
        <td>${a.duty_cycle_pct ? `${fmt(a.duty_cycle_pct)}%` : "—"}</td>
        <td>${a.user_added ? "user" : ""}</td>
      </tr>`,
    )
    .join("");
}

const SPEC_LABELS = {
  manufacturer: "Manufacturer",
  part_number: "Part number",
  drive: "Drive",
  peak_force_n: "Peak force (N)",
  continuous_force_n: "Continuous force (N)",
  max_speed_mm_s: "Max speed (mm/s)",
  stroke_mm: "Stroke (mm)",
  peak_torque_nm: "Peak torque (N·m)",
  continuous_torque_nm: "Continuous torque (N·m)",
  max_speed_rpm: "Max speed (rpm)",
  duty_cycle_pct: "Duty cycle (%)",
  mass_kg: "Mass (kg)",
  supply_voltage_v: "Supply voltage (V)",
  ip_rating: "IP rating",
  price_usd: "Price (USD)",
  source: "Source",
};

async function showDetail(id) {
  selectedId = id;
  const a = await api(`/api/actuators/${encodeURIComponent(id)}`);
  $("#detail-title").textContent = a.name;
  const specs = Object.entries(SPEC_LABELS)
    .filter(([k]) => a[k] !== null && a[k] !== "")
    .map(([k, label]) => `<dt>${label}</dt><dd>${esc(a[k])}</dd>`);
  if (a.datasheet_url) {
    specs.push(`<dt>Datasheet</dt><dd><a href="${esc(a.datasheet_url)}" target="_blank" rel="noopener">${esc(a.datasheet_url)}</a></dd>`);
  }
  $("#detail-specs").innerHTML = specs.join("");
  $("#delete-actuator").classList.toggle("hidden", !a.user_added);
  $("#detail").classList.remove("hidden");
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

$("#catalog-table tbody").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-id]");
  if (row) showDetail(row.dataset.id);
});
$("#catalog-q").addEventListener("input", loadCatalog);
$("#catalog-kind").addEventListener("change", loadCatalog);
$("#add-actuator-toggle").addEventListener("click", () => $("#add-actuator").classList.toggle("hidden"));

$("#add-actuator").addEventListener("submit", async (e) => {
  e.preventDefault();
  try {
    await api("/api/actuators", { method: "POST", body: formData(e.target) });
    e.target.reset();
    e.target.classList.add("hidden");
    $("#add-actuator-error").textContent = "";
    await loadCatalog();
  } catch (err) {
    $("#add-actuator-error").textContent = err.message;
  }
});

$("#delete-actuator").addEventListener("click", async () => {
  if (!confirm("Delete this actuator?")) return;
  await api(`/api/actuators/${encodeURIComponent(selectedId)}`, { method: "DELETE" });
  $("#detail").classList.add("hidden");
  await loadCatalog();
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

$$('input[name="sizing-kind"]').forEach((r) =>
  r.addEventListener("change", () => {
    const linear = $('input[name="sizing-kind"]:checked').value === "linear";
    $("#sizing-linear").classList.toggle("hidden", !linear);
    $("#sizing-rotary").classList.toggle("hidden", linear);
    $("#sizing-result").classList.add("hidden");
  }),
);

function renderSegments(segments, key, unit) {
  return `<table><thead><tr><th>Phase</th><th>Duration (s)</th><th>${unit}</th></tr></thead><tbody>
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
          ["Inertia ratio", r.inertia_ratio === null ? "—" : `${fmt(r.inertia_ratio)} : 1`],
          ["Peak mechanical power", `${fmt(r.peak_mechanical_power_w)} W`],
          ["Duty cycle", `${fmt(r.duty_cycle_pct)} %`],
        ];
  const segs = req.kind === "linear" ? renderSegments(r.segments, "force_n", "Force (N)") : renderSegments(r.segments, "torque_nm", "Motor torque (N·m)");
  $("#sizing-result").innerHTML = `
    <h3>Results</h3>
    <dl>${lines.map(([k, v]) => `<dt>${k}</dt><dd>${v}</dd>`).join("")}</dl>
    <h4>Profile segments</h4>${segs}
    <button id="send-to-select" type="button">Find actuators for these requirements (with safety factor)</button>`;
  $("#sizing-result").classList.remove("hidden");
  lastRequired = req;
  $("#send-to-select").addEventListener("click", () => {
    fillSelection(lastRequired);
    showTab("select");
    $("#select-form").requestSubmit();
  });
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

function syncSelectKind() {
  const linear = $('#select-form [name="kind"]').value === "linear";
  $$(".linear-only").forEach((el) => el.classList.toggle("hidden", !linear));
  $$(".rotary-only").forEach((el) => el.classList.toggle("hidden", linear));
}
$('#select-form [name="kind"]').addEventListener("change", syncSelectKind);

function fillSelection(req) {
  const form = $("#select-form");
  for (const el of form.elements) {
    if (el.name && el.name !== "actuation") el.value = req[el.name] === undefined ? "" : el.type === "number" ? Number(Number(req[el.name]).toPrecision(4)) : req[el.name];
  }
  syncSelectKind();
}

function renderCandidate(c) {
  const a = c.actuator;
  const margins = Object.entries(c.margins)
    .map(([k, m]) => `<span class="${m !== null && m >= 1 ? "ok" : "bad"}">${k}: ${m === null ? "n/a" : `${fmt(m)}×`}</span>`)
    .join(" · ");
  return `<tr data-id="${esc(a.id)}"><td>${esc(a.name)}</td><td>${esc(a.actuation)}</td><td>${fmt(c.min_margin)}×</td><td>${margins}</td>
    <td>${c.issues.map(esc).join("<br>")}</td></tr>`;
}

$("#select-form").addEventListener("submit", async (e) => {
  e.preventDefault();
  const body = formData(e.target);
  const linear = body.kind === "linear";
  for (const el of $$(linear ? ".rotary-only input" : ".linear-only input")) delete body[el.name];
  try {
    const r = await api("/api/select", { method: "POST", body });
    const table = (rows) =>
      `<table><thead><tr><th>Name</th><th>Actuation</th><th>Min margin</th><th>Margins</th><th>Issues</th></tr></thead>
       <tbody>${rows.map(renderCandidate).join("") || "<tr><td colspan='5'>None</td></tr>"}</tbody></table>`;
    $("#select-result").innerHTML = `<h3>Feasible (${r.feasible.length})</h3>${table(r.feasible)}
      <h3>Rejected (${r.rejected.length})</h3>${table(r.rejected)}`;
  } catch (err) {
    $("#select-result").innerHTML = `<p class="error">${esc(err.message)}</p>`;
  }
});

$("#select-result").addEventListener("click", (e) => {
  const row = e.target.closest("tr[data-id]");
  if (!row) return;
  showTab("catalog");
  showDetail(row.dataset.id);
});

loadCatalog();
