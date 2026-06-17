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

    ${bean.notesBodyHtml.trim() ? `<div class="section-title">Notes</div><div class="body-md">${bean.notesBodyHtml}</div>` : ""}

    ${sessions.length ? `<div class="section-title">Session history <span class="count">${sessions.length}</span></div><div class="timeline">${sessions.map(timelineItem).join("")}</div>` : ""}
  `;
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
