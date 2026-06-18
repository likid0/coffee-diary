const METHOD_LABELS = {
  espresso: "Espresso",
  v60: "V60",
  "hario-switch": "Switch",
  filter: "Filter",
};
const METHOD_ORDER = ["espresso", "v60", "hario-switch", "filter"];

const STATUS_LABELS = {
  dialling_in: "Dialling in",
  resting: "Resting",
  dialed: "Dialed in",
  not_started: "Not started",
  finished: "Finished",
};
const STATUS_ICON = {
  dialling_in: "🟡",
  resting: "🛌",
  dialed: "✅",
  not_started: "⚪",
  finished: "🏁",
};
const STATUS_SECTION_ORDER = ["dialling_in", "resting", "dialed", "not_started", "finished"];

const FIELD_LABELS = {
  grind_clicks: "Grind",
  dose_g: "Dose",
  dose_in_g: "Dose in",
  dose_out_g: "Dose out",
  yield_g: "Yield",
  water_g: "Water",
  water_ml: "Water",
  ratio: "Ratio",
  temp_c: "Temp",
  pre_infusion_s: "Pre-infusion",
  pre_infusion: "Pre-infusion",
  brew_time_s: "Brew time",
  extraction_time_s: "Extraction",
  drawdown_time: "Drawdown",
  technique: "Technique",
  americano_ratio: "Americano ratio",
  americano_water_ml: "Americano water",
};
const FIELD_UNITS = {
  grind_clicks: "",
  dose_g: "g",
  dose_in_g: "g",
  dose_out_g: "g",
  yield_g: "g",
  water_g: "g",
  water_ml: "ml",
  temp_c: "°C",
  pre_infusion_s: "s",
  brew_time_s: "s",
  extraction_time_s: "s",
};

let DATA = null;
const state = { query: "", method: "all", status: "active" };

// ---------------- Brew Helper ----------------

function ratioToNumber(ratioStr) {
  if (ratioStr === undefined || ratioStr === null) return null;
  const m = String(ratioStr).match(/1\s*:\s*(\d+\.?\d*)/);
  return m ? parseFloat(m[1]) : null;
}

function ratioPresetsFor(method) {
  return method === "espresso" ? [1.8, 2, 2.2, 2.5] : [14, 15, 16, 17];
}

function processTypeForBean(bean) {
  const processing = (bean.frontmatter.processing || "").toLowerCase();
  const origin = (bean.frontmatter.origin || "").toLowerCase();
  const altitude = parseFloat(String(bean.frontmatter.altitude_masl || "").split(/[-~]/)[0]) || 0;
  if (/anaerobic/.test(processing)) return "Anaerobic natural";
  if (origin === "ethiopia" && altitude >= 1700) return "High altitude Ethiopian";
  if (origin === "brazil" && /natural/.test(processing)) return "Brazilian natural";
  if (origin === "rwanda" && /natural/.test(processing)) return "Natural Rwandan";
  if (/natural/.test(processing)) return "Natural light roast";
  if (/washed/.test(processing)) return "Washed light roast";
  return null;
}

function scaleQToComandante(qVal, multiplier) {
  const str = String(qVal);
  if (str.includes("-")) {
    const [a, b] = str.split("-").map(Number);
    return `${Math.round(a / multiplier)}-${Math.round(b / multiplier)}`;
  }
  const n = Number(str.replace(/[^0-9.]/g, ""));
  return Math.round(n / multiplier);
}

function grindRecommendation(bean, method) {
  const gc = DATA.grinderConversion;
  if (!gc) return null;
  const recipe = bean.recipes[method];
  if (recipe && recipe.params && recipe.params.grind_clicks !== undefined) {
    const q = recipe.params.grind_clicks;
    return {
      source: recipe.source,
      q,
      comandante: scaleQToComandante(q, gc.multiplier),
    };
  }
  const process = processTypeForBean(bean);
  const row = gc.processStartingPoints.find((p) => p.process === process);
  if (row) {
    return { source: "process-type", process, q: row.q, comandante: row.comandante, notes: row.notes };
  }
  return null;
}

function buildCumulative(steps) {
  let running = 0;
  for (const s of steps) {
    if (s.g) {
      running += s.g;
      s.cumulative = running;
    }
  }
  return steps;
}

function kasuyaRecipe({ totalWaterG, body }) {
  const phase1 = totalWaterG * 0.4;
  const phase2 = totalWaterG * 0.6;
  const p1a = Math.round(phase1 / 2);
  const p1b = Math.round(phase1 - p1a);
  const steps = [
    { time: "0:00", action: "Pour 1", g: p1a },
    { time: "0:45", action: "Pour 2 (bed should be flattening)", g: p1b },
  ];
  if (body === "full") {
    const each = Math.round(phase2 / 3);
    steps.push({ time: "1:30", action: "Pour 3", g: each });
    steps.push({ time: "2:00", action: "Pour 4", g: each });
    steps.push({ time: "2:30", action: "Pour 5", g: phase2 - each * 2 });
    steps.push({ time: "~4:00", action: "Target drawdown complete", g: 0 });
  } else {
    const each = Math.round(phase2 / 2);
    steps.push({ time: "1:30", action: "Pour 3", g: each });
    steps.push({ time: "2:15", action: "Pour 4", g: phase2 - each });
    steps.push({ time: "~3:30", action: "Target drawdown complete", g: 0 });
  }
  return buildCumulative(steps);
}

function switchHybridRecipe({ totalWaterG, variant }) {
  if (variant === "no-bloom") {
    const half = Math.round(totalWaterG / 2);
    return buildCumulative([
      { time: "0:00", action: "Pour directly (no bloom), switch OPEN", g: half },
      { time: "0:45–0:50", action: "CLOSE switch, pour remaining", g: totalWaterG - half },
      { time: "~1:15", action: "Immersion begins (switch closed)", g: 0 },
      { time: "2:00–2:05", action: "OPEN switch → drawdown", g: 0 },
      { time: "~2:45–2:50", action: "Target drawdown complete", g: 0 },
    ]);
  }
  const bloom = Math.round(totalWaterG * (50 / 300));
  const secondTarget = Math.round(totalWaterG * (115 / 300));
  const secondPour = secondTarget - bloom;
  const remainder = totalWaterG - secondTarget;
  return buildCumulative([
    { time: "0:00", action: "Bloom pour, switch OPEN", g: bloom },
    { time: "0:45", action: "Pour (still open / percolating)", g: secondPour },
    { time: "1:15", action: "CLOSE switch, pour remainder (immersion begins)", g: remainder },
    { time: "2:00–2:30", action: "Immersion closed — extend toward 2:30 for more development", g: 0 },
    { time: "2:00–2:30", action: "OPEN switch → drawdown", g: 0 },
    { time: "~3:15–3:40", action: "Target drawdown complete", g: 0 },
  ]);
}

function grindPanelHtml(grind) {
  if (!grind) {
    return `<div class="bh-grind">No grind data yet for this process type — use judgement, Comandante 25–27 is a generic light-roast starting point.</div>`;
  }
  const labels = {
    dialed: "🏆 Your dialed-in setting",
    "latest-session": "Your latest attempt",
    "process-type": `Suggested by process type${grind.process ? ` (${grind.process})` : ""}`,
  };
  return `<div class="bh-grind"><b>${labels[grind.source]}:</b> 1Zpresso Q <b>${grind.q}</b> clicks · Comandante ≈ <b>${grind.comandante}</b> clicks${grind.notes ? ` — ${escapeHtml(grind.notes)}` : ""}</div>`;
}

function pourScheduleHtml(steps) {
  const rows = steps
    .map((s) => `<tr><td>${s.time}</td><td>${escapeHtml(s.action)}</td><td>${s.g ? `+${s.g}g` : ""}</td><td>${s.cumulative ? `${s.cumulative}g` : ""}</td></tr>`)
    .join("");
  return `
    <table class="bh-schedule">
      <thead><tr><th>Time</th><th>Action</th><th>Pour</th><th>Total</th></tr></thead>
      <tbody>${rows}</tbody>
    </table>
    <div class="bh-hint">Pour when the bed flattens / runs dry rather than strictly by the clock — times are a guide.</div>`;
}

function renderBrewHelper(bean) {
  const defaultMethod = METHOD_ORDER.find((m) => bean.recipes[m]) || "v60";
  return `
    <div class="section-title">🧮 Brew helper</div>
    <div class="brew-helper" id="brew-helper">
      <div class="bh-controls">
        <label>Method
          <select id="bh-method">
            ${METHOD_ORDER.map((m) => `<option value="${m}" ${m === defaultMethod ? "selected" : ""}>${METHOD_LABELS[m]}</option>`).join("")}
          </select>
        </label>
        <label>Dose (g) <input id="bh-dose" type="number" step="0.1" min="1" /></label>
        <label>Ratio
          <select id="bh-ratio"></select>
        </label>
        <label id="bh-ratio-custom-wrap" class="hidden">Custom ratio <input id="bh-ratio-custom" type="number" step="0.1" min="1" placeholder="e.g. 16.5" /></label>
        <label>Temp (°C) <input id="bh-temp" type="number" step="0.5" /></label>
      </div>
      <div class="bh-controls" id="bh-template-wrap">
        <label>Recipe
          <select id="bh-template">
            <option value="kasuya">Tetsu Kasuya 4:6</option>
            <option value="switch-bloom">Switch Hybrid (with bloom)</option>
            <option value="switch-nobloom">Switch Hybrid (no bloom)</option>
          </select>
        </label>
        <label id="bh-body-wrap">Body
          <select id="bh-body">
            <option value="light">Light (2 pours)</option>
            <option value="full">Full (3 pours)</option>
          </select>
        </label>
      </div>
      <div id="bh-output"></div>
    </div>`;
}

function initBrewHelper(bean) {
  const root = document.getElementById("brew-helper");
  if (!root) return;
  const els = {
    method: root.querySelector("#bh-method"),
    dose: root.querySelector("#bh-dose"),
    ratio: root.querySelector("#bh-ratio"),
    ratioCustomWrap: root.querySelector("#bh-ratio-custom-wrap"),
    ratioCustom: root.querySelector("#bh-ratio-custom"),
    template: root.querySelector("#bh-template"),
    templateWrap: root.querySelector("#bh-template-wrap"),
    body: root.querySelector("#bh-body"),
    bodyWrap: root.querySelector("#bh-body-wrap"),
    temp: root.querySelector("#bh-temp"),
    output: root.querySelector("#bh-output"),
  };

  function populateRatioOptions(method, selectedRatio) {
    const presets = ratioPresetsFor(method);
    const matched = selectedRatio && presets.includes(selectedRatio);
    els.ratio.innerHTML =
      presets.map((r) => `<option value="${r}" ${r === selectedRatio ? "selected" : ""}>1:${r}</option>`).join("") +
      `<option value="custom" ${!matched && selectedRatio ? "selected" : ""}>Custom</option>`;
    if (!matched && selectedRatio) {
      els.ratioCustom.value = selectedRatio;
      els.ratioCustomWrap.classList.remove("hidden");
    } else {
      els.ratioCustomWrap.classList.add("hidden");
    }
  }

  function applyDefaultsForMethod(method) {
    const recipe = bean.recipes[method];
    let dose = method === "espresso" ? 20 : 20;
    let ratio = method === "espresso" ? 2.2 : 15;
    let temp = method === "espresso" ? 93 : 92;
    if (recipe && recipe.params) {
      dose = recipe.params.dose_g ?? recipe.params.dose_in_g ?? dose;
      temp = recipe.params.temp_c ?? temp;
      const rFromField = ratioToNumber(recipe.params.ratio);
      if (rFromField) {
        ratio = rFromField;
      } else if (method === "espresso" && recipe.params.dose_in_g && recipe.params.dose_out_g) {
        ratio = Math.round((recipe.params.dose_out_g / recipe.params.dose_in_g) * 100) / 100;
      }
    }
    els.dose.value = dose;
    els.temp.value = temp;
    populateRatioOptions(method, ratio);
  }

  function toggleMethodSpecificControls() {
    const isEspresso = els.method.value === "espresso";
    els.templateWrap.style.display = isEspresso ? "none" : "";
  }

  function currentRatio() {
    return els.ratio.value === "custom" ? parseFloat(els.ratioCustom.value || "0") : parseFloat(els.ratio.value);
  }

  function recompute() {
    const method = els.method.value;
    const dose = parseFloat(els.dose.value) || 0;
    const ratio = currentRatio();
    const grind = grindRecommendation(bean, method);
    let html = grindPanelHtml(grind);
    if (method === "espresso") {
      const yieldG = Math.round(dose * ratio * 10) / 10;
      html += `<div class="bh-result"><b>${dose}g</b> in → <b>${yieldG}g</b> out (1:${ratio}) at ${els.temp.value}°C</div>`;
    } else {
      const waterG = Math.round(dose * ratio);
      html += `<div class="bh-result"><b>${dose}g</b> dose · <b>${waterG}g</b> water (1:${ratio}) at ${els.temp.value}°C</div>`;
      const steps =
        els.template.value === "kasuya"
          ? kasuyaRecipe({ totalWaterG: waterG, body: els.body.value })
          : switchHybridRecipe({ totalWaterG: waterG, variant: els.template.value === "switch-nobloom" ? "no-bloom" : "bloom" });
      html += pourScheduleHtml(steps);
    }
    els.output.innerHTML = html;
  }

  els.method.addEventListener("change", () => {
    applyDefaultsForMethod(els.method.value);
    toggleMethodSpecificControls();
    recompute();
  });
  els.ratio.addEventListener("change", () => {
    els.ratioCustomWrap.classList.toggle("hidden", els.ratio.value !== "custom");
    recompute();
  });
  [els.dose, els.ratioCustom, els.template, els.body, els.temp].forEach((el) => el.addEventListener("input", recompute));

  applyDefaultsForMethod(els.method.value);
  toggleMethodSpecificControls();
  recompute();
}

function fmtVal(key, val) {
  if (val === undefined || val === null) return "";
  const unit = FIELD_UNITS[key] || "";
  return `${val}${unit}`;
}

function daysSince(dateStr) {
  if (!dateStr) return null;
  const then = new Date(dateStr + "T00:00:00");
  const now = new Date();
  return Math.round((now - then) / 86400000);
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

function beanPhotoEl(bean, cls) {
  if (bean.photo) return `<img src="${bean.photo}" alt="${escapeHtml(bean.name)}" loading="lazy" />`;
  const initial = (bean.name || "?").trim()[0]?.toUpperCase() || "?";
  return initial;
}

function recipeSnippetLine(method, recipe) {
  if (!recipe) return "";
  if (recipe.source === "starting-params") {
    return `<div><b>${METHOD_LABELS[method]}:</b> not yet brewed — starting point set</div>`;
  }
  const order = ["grind_clicks", "temp_c", "dose_g", "dose_in_g", "dose_out_g", "yield_g", "water_g", "water_ml", "ratio", "brew_time_s", "drawdown_time"];
  const parts = [];
  for (const k of order) {
    if (recipe.params[k] !== undefined) parts.push(fmtVal(k, recipe.params[k]));
  }
  const tag = recipe.source === "dialed" ? " 🏆" : "";
  return `<div><b>${METHOD_LABELS[method]}${tag}:</b> ${parts.join(" · ")}</div>`;
}

function beanCard(bean) {
  const days = daysSince(bean.frontmatter.roast_date);
  const methods = Object.keys(bean.recipes || {});
  const snippets = METHOD_ORDER.filter((m) => bean.recipes[m]).map((m) => recipeSnippetLine(m, bean.recipes[m])).join("");
  const metaParts = [bean.frontmatter.origin, bean.frontmatter.processing].filter(Boolean);
  return `
  <a class="card" href="#/bean/${bean.slug}">
    <div class="card-photo">${beanPhotoEl(bean)}</div>
    <div class="card-body">
      <div class="card-name">${escapeHtml(bean.name)}</div>
      <div class="card-roaster">${escapeHtml(bean.frontmatter.roaster || "")}</div>
      <div class="card-meta">${escapeHtml(metaParts.join(" · "))}${days !== null ? ` · day ${days}` : ""}</div>
      <div class="badges">
        <span class="badge ${bean.rotationStatus}">${STATUS_ICON[bean.rotationStatus]} ${STATUS_LABELS[bean.rotationStatus]}</span>
        ${methods.map((m) => `<span class="badge method">${METHOD_LABELS[m]}</span>`).join("")}
      </div>
      ${snippets ? `<div class="recipe-snippet">${snippets}</div>` : ""}
    </div>
  </a>`;
}

function matchesFilters(bean) {
  if (state.method !== "all" && !bean.recipes[state.method]) return false;
  if (state.status === "active" && bean.rotationStatus === "finished") {
    if (!state.query) return false;
  }
  if (state.status !== "all" && state.status !== "active" && bean.rotationStatus !== state.status) return false;
  if (state.query) {
    const q = state.query.toLowerCase();
    const hay = [
      bean.name,
      bean.frontmatter.roaster,
      bean.frontmatter.origin,
      bean.frontmatter.region,
      bean.frontmatter.processing,
      bean.frontmatter.variety,
      bean.frontmatter.tasting_notes,
      bean.frontmatter.tasting_profile,
    ]
      .filter(Boolean)
      .join(" ")
      .toLowerCase();
    if (!hay.includes(q)) return false;
  }
  return true;
}

function renderFilters() {
  const el = document.getElementById("filters");
  const statusOpts = [
    ["active", "Active"],
    ["dialling_in", "Dialling in"],
    ["resting", "Resting"],
    ["dialed", "Dialed in"],
    ["not_started", "Not started"],
    ["finished", "Finished"],
    ["all", "All"],
  ];
  const methodOpts = [["all", "All methods"], ...METHOD_ORDER.map((m) => [m, METHOD_LABELS[m]])];
  el.innerHTML = `
    <div class="chip-group">
      <span class="chip-group-label">Status</span>
      ${statusOpts.map(([k, label]) => `<button class="chip ${state.status === k ? "active" : ""}" data-kind="status" data-val="${k}">${label}</button>`).join("")}
    </div>
    <div class="chip-group">
      <span class="chip-group-label">Method</span>
      ${methodOpts.map(([k, label]) => `<button class="chip ${state.method === k ? "active" : ""}" data-kind="method" data-val="${k}">${label}</button>`).join("")}
    </div>
  `;
  el.querySelectorAll(".chip").forEach((btn) => {
    btn.addEventListener("click", () => {
      state[btn.dataset.kind] = btn.dataset.val;
      renderFilters();
      renderHome();
    });
  });
}

function renderHome() {
  const app = document.getElementById("app");
  const beans = DATA.beans.filter(matchesFilters);
  if (beans.length === 0) {
    app.innerHTML = `<div class="empty-state">No beans match. Try clearing filters or search.</div>`;
    return;
  }
  const sections = STATUS_SECTION_ORDER.map((status) => {
    const group = beans.filter((b) => b.rotationStatus === status);
    if (group.length === 0) return "";
    group.sort((a, b) => (a.frontmatter.roast_date < b.frontmatter.roast_date ? 1 : -1));
    return `
      <div class="section-title">${STATUS_ICON[status]} ${STATUS_LABELS[status]} <span class="count">${group.length}</span></div>
      <div class="grid">${group.map(beanCard).join("")}</div>
    `;
  }).join("");
  app.innerHTML = sections;
}

function recipeCard(method, recipe) {
  if (recipe.source === "starting-params") {
    return `
      <div class="recipe-card">
        <h3>${METHOD_LABELS[method]}</h3>
        <div class="body-md-inline">${recipe.bodyHtml}</div>
        <div class="source-tag">Starting point — not yet brewed</div>
      </div>`;
  }
  const rows = Object.entries(recipe.params)
    .map(([k, v]) => `<div><span class="k">${FIELD_LABELS[k] || k}</span><span>${escapeHtml(fmtVal(k, v))}</span></div>`)
    .join("");
  const tag = recipe.source === "dialed" ? `🏆 Dialed in (${recipe.dialedTag})` : `Latest attempt · ${recipe.date}`;
  return `
    <div class="recipe-card">
      <h3>${METHOD_LABELS[method]} ${recipe.source === "dialed" ? "🏆" : ""}</h3>
      <div class="params">${rows}</div>
      ${recipe.result ? `<div class="source-tag">Result: ${escapeHtml(recipe.result)}</div>` : ""}
      <div class="source-tag">${escapeHtml(tag)}</div>
    </div>`;
}

function timelineItem(session) {
  const resultClass = /dialed|dialled/i.test(session.frontmatter.result || "")
    ? "result-dialed"
    : /fail|over_extracted|not-optimal/i.test(session.frontmatter.result || "")
    ? "result-bad"
    : "";
  const order = ["grind_clicks", "temp_c", "dose_g", "dose_in_g", "dose_out_g", "yield_g", "water_g", "water_ml", "ratio", "brew_time_s", "drawdown_time", "extraction_time_s"];
  const parts = order.filter((k) => session.frontmatter[k] !== undefined).map((k) => `${FIELD_LABELS[k] || k}: ${fmtVal(k, session.frontmatter[k])}`);
  const id = `tl-${session.sourceFile.replace(/[^a-z0-9]/gi, "-")}`;
  return `
    <div class="tl-item ${resultClass}">
      <div class="tl-head">
        <span class="tl-date">${session.date || "—"} · ${METHOD_LABELS[session.method]}${session.dialedTag ? " 🏆" : ""}</span>
        <span class="tl-result">${escapeHtml(session.frontmatter.result || "")}</span>
      </div>
      <div class="tl-params">${parts.join(" · ")}</div>
      <span class="tl-toggle" onclick="document.getElementById('${id}').classList.toggle('hidden')">notes ▾</span>
      <div id="${id}" class="tl-body hidden">${session.bodyHtml}</div>
    </div>`;
}

function renderBeanDetail(slug) {
  const app = document.getElementById("app");
  const bean = DATA.beans.find((b) => b.slug === slug);
  if (!bean) {
    app.innerHTML = `<div class="empty-state">Bean not found.</div>`;
    return;
  }
  const days = daysSince(bean.frontmatter.roast_date);
  const sessions = DATA.sessions.filter((s) => s.beanSlug === bean.slug).slice().reverse();
  const fm = bean.frontmatter;
  const infoRows = [
    ["Roaster", fm.roaster],
    ["Origin", [fm.origin, fm.region].filter(Boolean).join(", ")],
    ["Processing", fm.processing],
    ["Variety", fm.variety],
    ["Altitude", fm.altitude_masl && fm.altitude_masl !== "~" ? `${fm.altitude_masl} masl` : null],
    ["Producer", fm.producer && fm.producer !== "~" ? fm.producer : null],
    ["SCA score", fm.sca_score && fm.sca_score !== "~" ? fm.sca_score : null],
    ["Roast date", fm.roast_date],
    ["Age", days !== null ? `${days} days` : null],
    ["Bag finished", fm.bag_finished],
    ["Tasting notes", fm.tasting_notes || fm.tasting_profile],
  ].filter(([, v]) => v);

  const recipeCards = METHOD_ORDER.filter((m) => bean.recipes[m])
    .map((m) => recipeCard(m, bean.recipes[m]))
    .join("");

  app.innerHTML = `
    <a class="detail-back" href="#/">← Back to rotation</a>
    <div class="detail-hero">
      <div class="detail-photo">${beanPhotoEl(bean)}</div>
      <div class="detail-info">
        <h1>${escapeHtml(bean.name)}</h1>
        <div class="detail-sub">
          <span class="badge ${bean.rotationStatus}">${STATUS_ICON[bean.rotationStatus]} ${STATUS_LABELS[bean.rotationStatus]}</span>
          ${bean.dialedTags.map((t) => `<span class="badge dialed">🏆 ${t.tag.replace("dialed/", "")}</span>`).join("")}
        </div>
        <table class="detail-table">
          ${infoRows.map(([k, v]) => `<tr><td>${k}</td><td>${escapeHtml(String(v))}</td></tr>`).join("")}
        </table>
      </div>
    </div>

    ${recipeCards ? `<div class="section-title">Current recipe</div><div class="recipe-cards">${recipeCards}</div>` : ""}

    ${renderBrewHelper(bean)}

    ${bean.notesBodyHtml.trim() ? `<div class="section-title">Notes</div><div class="body-md">${bean.notesBodyHtml}</div>` : ""}

    ${sessions.length ? `<div class="section-title">Session history <span class="count">${sessions.length}</span></div><div class="timeline">${sessions.map(timelineItem).join("")}</div>` : ""}
  `;
  initBrewHelper(bean);
}

function renderNotesList() {
  const app = document.getElementById("app");
  app.innerHTML = `
    <div class="section-title">Reference notes</div>
    <div class="grid">
      ${DATA.notes
        .map(
          (n) => `
        <a class="card" href="#/notes/${n.slug}">
          <div class="card-body">
            <div class="card-name">${escapeHtml(n.slug.replace(/-/g, " "))}</div>
            <div class="card-meta">${escapeHtml(n.frontmatter.date || "")}</div>
          </div>
        </a>`
        )
        .join("")}
    </div>
  `;
}

function renderNoteDetail(slug) {
  const app = document.getElementById("app");
  const note = DATA.notes.find((n) => n.slug === slug);
  if (!note) {
    app.innerHTML = `<div class="empty-state">Note not found.</div>`;
    return;
  }
  app.innerHTML = `
    <a class="detail-back" href="#/notes">← Back to notes</a>
    <div class="section-title">${escapeHtml(slug.replace(/-/g, " "))}</div>
    <div class="body-md">${note.bodyHtml}</div>
  `;
}

function route() {
  const hash = location.hash.replace(/^#/, "") || "/";
  const beanMatch = hash.match(/^\/bean\/(.+)$/);
  const noteMatch = hash.match(/^\/notes\/(.+)$/);
  const isHome = hash === "/" || hash === "";
  document.getElementById("filters").style.display = isHome ? "" : "none";
  if (beanMatch) {
    renderBeanDetail(decodeURIComponent(beanMatch[1]));
  } else if (noteMatch) {
    renderNoteDetail(decodeURIComponent(noteMatch[1]));
  } else if (hash === "/notes") {
    renderNotesList();
  } else {
    renderHome();
  }
  window.scrollTo(0, 0);
}

function init() {
  fetch("data.json")
    .then((r) => r.json())
    .then((data) => {
      DATA = data;
      renderFilters();
      route();
      document.getElementById("footer-meta").textContent = `${data.beans.length} beans · ${data.sessions.length} sessions · data generated ${new Date(data.generatedAt).toLocaleString()}`;
    });

  document.getElementById("search").addEventListener("input", (e) => {
    state.query = e.target.value.trim();
    if (location.hash && location.hash !== "#/") location.hash = "#/";
    else renderHome();
  });

  window.addEventListener("hashchange", route);
}

init();
