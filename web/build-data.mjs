import { execSync } from "node:child_process";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import matter from "gray-matter";
import { marked } from "marked";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const repoRoot = path.resolve(__dirname, "..");

function slugify(s) {
  return s
    .toLowerCase()
    .normalize("NFD")
    .replace(/[̀-ͯ]/g, "")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

// js-yaml auto-parses unquoted YAML dates into Date objects; flatten them back
// to plain YYYY-MM-DD strings so JSON.stringify doesn't turn them into full
// ISO timestamps (which broke client-side "days since roast" math).
function sanitizeDates(value) {
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (Array.isArray(value)) return value.map(sanitizeDates);
  if (value && typeof value === "object") {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, sanitizeDates(v)]));
  }
  return value;
}

function readMd(absPath) {
  const raw = fs.readFileSync(absPath, "utf8");
  const { data, content } = matter(raw);
  return { frontmatter: sanitizeDates(data), bodyMd: content.trim(), bodyHtml: marked.parse(content.trim()) };
}

function listMdFiles(dir) {
  const abs = path.join(repoRoot, dir);
  if (!fs.existsSync(abs)) return [];
  return fs
    .readdirSync(abs)
    .filter((f) => f.endsWith(".md") && f !== "_template.md")
    .map((f) => path.join(dir, f));
}

// ---- beans ----
const beanFiles = listMdFiles("beans");
const beans = beanFiles.map((relPath) => {
  const abs = path.join(repoRoot, relPath);
  const { frontmatter, bodyMd, bodyHtml } = readMd(abs);
  const slug = path.basename(relPath, ".md");
  return {
    slug,
    name: frontmatter.name || slug,
    frontmatter,
    bodyMd,
    bodyHtml,
    sourceFile: relPath,
    photo: fs.existsSync(path.join(__dirname, "public/assets/beans", `${slug}.jpg`))
      ? `assets/beans/${slug}.jpg`
      : null,
  };
});

function findBeanSlug(beanName) {
  if (!beanName) return null;
  const norm = (s) => slugify(s);
  const target = norm(beanName);
  let hit = beans.find((b) => norm(b.name) === target);
  if (hit) return hit.slug;
  // loose contains-match fallback (e.g. "Ethiopia Guji" vs "Ethiopia Guji (DeEspecialidad)")
  hit = beans.find((b) => norm(b.name).includes(target) || target.includes(norm(b.name)));
  return hit ? hit.slug : null;
}

// ---- sessions ----
const methodDirs = {
  espresso: "sessions/espresso",
  v60: "sessions/v60",
  "hario-switch": "sessions/hario-switch",
  filter: "sessions/filter",
};

const sessions = [];
for (const [method, dir] of Object.entries(methodDirs)) {
  for (const relPath of listMdFiles(dir)) {
    const abs = path.join(repoRoot, relPath);
    const { frontmatter, bodyMd, bodyHtml } = readMd(abs);
    const fname = path.basename(relPath, ".md");
    const dateMatch = fname.match(/^(\d{4}-\d{2}-\d{2})_/);
    const date = dateMatch ? dateMatch[1] : null;
    sessions.push({
      method,
      date,
      planned: frontmatter.result === "planned",
      bean: frontmatter.bean || null,
      beanSlug: findBeanSlug(frontmatter.bean),
      frontmatter,
      bodyMd,
      bodyHtml,
      sourceFile: relPath,
    });
  }
}
sessions.sort((a, b) => (a.date && b.date ? a.date.localeCompare(b.date) : 0));

// ---- notes ----
function parseMarkdownTables(bodyMd) {
  const lines = bodyMd.split("\n");
  const tables = [];
  for (let i = 0; i < lines.length - 1; i++) {
    const headerLine = lines[i].trim();
    const sepLine = lines[i + 1].trim();
    if (!headerLine.startsWith("|") || !/^\|?[\s:|-]+\|?$/.test(sepLine) || !sepLine.includes("-")) continue;
    const headers = headerLine.split("|").map((c) => c.trim()).filter((c) => c !== "");
    const rows = [];
    let j = i + 2;
    for (; j < lines.length; j++) {
      const rowLine = lines[j].trim();
      if (!rowLine.startsWith("|")) break;
      const cells = rowLine.split("|").map((c) => c.trim()).filter((_, idx, arr) => !(idx === 0 && arr[0] === "") && !(idx === arr.length - 1 && arr[arr.length - 1] === ""));
      const row = {};
      headers.forEach((h, idx) => (row[h] = cells[idx] ?? ""));
      rows.push(row);
    }
    tables.push({ headers, rows });
    i = j;
  }
  return tables;
}

function parseGrinderConversion(frontmatter, bodyMd) {
  if (frontmatter.multiplier === undefined) return null;
  const tables = parseMarkdownTables(bodyMd);
  const conversionTable = (tables[0]?.rows || []).map((r) => ({
    comandante: Number(r["Comandante"]),
    q: Number(String(r["1Zpresso Q"]).replace(/[^0-9.]/g, "")),
    calibration: /calibration/i.test(r["1Zpresso Q"] || ""),
  }));
  const processStartingPoints = (tables[1]?.rows || []).map((r) => ({
    process: r["Process"],
    comandante: r["Comandante"],
    q: r["1Zpresso Q"],
    notes: r["Notes"],
  }));
  return {
    multiplier: frontmatter.multiplier,
    calibrationPoint: frontmatter.calibration_point,
    conversionTable,
    processStartingPoints,
  };
}

const notes = listMdFiles("notes").map((relPath) => {
  const abs = path.join(repoRoot, relPath);
  const { frontmatter, bodyMd, bodyHtml } = readMd(abs);
  return {
    slug: path.basename(relPath, ".md"),
    frontmatter,
    bodyMd,
    bodyHtml,
    sourceFile: relPath,
    grinderConversion: parseGrinderConversion(frontmatter, bodyMd),
  };
});
const grinderConversion = notes.find((n) => n.grinderConversion)?.grinderConversion || null;

// ---- dialed tags -> resolve to tagged session file ----
let tagNames = [];
try {
  tagNames = execSync("git tag --list 'dialed/*'", { cwd: repoRoot }).toString().trim().split("\n").filter(Boolean);
} catch {
  tagNames = [];
}

const dialedTags = [];
for (const tag of tagNames) {
  let files = [];
  try {
    files = execSync(`git diff-tree --no-commit-id --name-only -r "${tag}"`, { cwd: repoRoot })
      .toString()
      .trim()
      .split("\n")
      .filter((f) => f.startsWith("sessions/"));
  } catch {
    files = [];
  }
  const sessionFile = files[0] || null;
  const session = sessionFile ? sessions.find((s) => s.sourceFile === sessionFile) : null;
  dialedTags.push({
    tag,
    sessionFile,
    method: session ? session.method : null,
    bean: session ? session.bean : null,
    beanSlug: session ? session.beanSlug : null,
  });
  if (session) session.dialedTag = tag;
}

// attach dialed tags to bean records
for (const bean of beans) {
  bean.dialedTags = dialedTags.filter((t) => t.beanSlug === bean.slug);
}

// ---- starting-params sections parsed from bean body (for beans not yet brewed) ----
function extractStartingParams(bodyMd) {
  const sections = [];
  const re = /^##\s*Starting parameters\s*\(([^)]+)\)\s*$/gim;
  let match;
  const headings = [];
  while ((match = re.exec(bodyMd))) {
    headings.push({ label: match[1].trim(), index: match.index, headingLength: match[0].length });
  }
  for (let i = 0; i < headings.length; i++) {
    const start = headings[i].index + headings[i].headingLength;
    const end = i + 1 < headings.length ? headings[i + 1].index : bodyMd.length;
    const chunk = bodyMd.slice(start, end).trim();
    sections.push({ label: headings[i].label, bodyMd: chunk, bodyHtml: marked.parse(chunk) });
  }
  return sections;
}
function stripStartingParams(bodyMd) {
  const re = /^##\s*Starting parameters\s*\([^)]+\)\s*$/gim;
  let match;
  const ranges = [];
  const headingRe = /^##\s.*$/gim;
  const allHeadings = [];
  while ((match = headingRe.exec(bodyMd))) allHeadings.push(match.index);
  re.lastIndex = 0;
  while ((match = re.exec(bodyMd))) {
    const nextHeadingIdx = allHeadings.find((idx) => idx > match.index);
    ranges.push([match.index, nextHeadingIdx !== undefined ? nextHeadingIdx : bodyMd.length]);
  }
  let out = bodyMd;
  for (const [start, end] of ranges.slice().reverse()) {
    out = out.slice(0, start) + out.slice(end);
  }
  return out.trim();
}
for (const bean of beans) {
  bean.startingParamsSections = extractStartingParams(bean.bodyMd);
  bean.notesBodyHtml = marked.parse(stripStartingParams(bean.bodyMd));
}

// ---- current recipe per method (latest session, or dialed session if more recent tag exists, or starting params fallback) ----
const KEY_RECIPE_FIELDS = [
  "grind_clicks",
  "dose_g",
  "dose_in_g",
  "dose_out_g",
  "yield_g",
  "water_g",
  "water_ml",
  "ratio",
  "temp_c",
  "pre_infusion_s",
  "pre_infusion",
  "brew_time_s",
  "extraction_time_s",
  "drawdown_time",
  "technique",
  "americano_ratio",
  "americano_water_ml",
];
function pickRecipeFields(frontmatter) {
  const out = {};
  for (const k of KEY_RECIPE_FIELDS) {
    if (frontmatter[k] !== undefined && frontmatter[k] !== null && frontmatter[k] !== "~") out[k] = frontmatter[k];
  }
  return out;
}

for (const bean of beans) {
  const beanSessions = sessions.filter((s) => s.beanSlug === bean.slug && !s.planned);
  const byMethod = {};
  for (const s of beanSessions) {
    if (!byMethod[s.method] || (s.date && byMethod[s.method].date && s.date > byMethod[s.method].date)) {
      byMethod[s.method] = s;
    } else if (!byMethod[s.method]) {
      byMethod[s.method] = s;
    }
  }
  bean.recipes = {};
  for (const [method, session] of Object.entries(byMethod)) {
    bean.recipes[method] = {
      source: session.dialedTag ? "dialed" : "latest-session",
      date: session.date,
      result: session.frontmatter.result || null,
      dialedTag: session.dialedTag || null,
      params: pickRecipeFields(session.frontmatter),
      sessionFile: session.sourceFile,
    };
  }
  // fallback to starting-params sections for methods with no session yet
  for (const section of bean.startingParamsSections) {
    const methodKey = section.label.toLowerCase();
    let normMethod = null;
    if (/espresso/.test(methodKey)) normMethod = "espresso";
    else if (/switch/.test(methodKey)) normMethod = "hario-switch";
    else if (/filter/.test(methodKey)) normMethod = "filter";
    else if (/v60/.test(methodKey)) normMethod = "v60";
    if (normMethod && !bean.recipes[normMethod]) {
      bean.recipes[normMethod] = { source: "starting-params", label: section.label, bodyHtml: section.bodyHtml };
    }
  }
}

// ---- rotation status per bean ----
const STATUS_MAP = {
  dialling_in: "dialling_in",
  "dialing-in": "dialling_in",
  resting: "resting",
  not_dialled_in: "not_started",
  dialed: "dialed",
  ready: "dialed",
};
for (const bean of beans) {
  const beanSessions = sessions.filter((s) => s.beanSlug === bean.slug);
  let status;
  if (bean.frontmatter.bag_finished) {
    status = "finished";
  } else if (bean.frontmatter.status && STATUS_MAP[bean.frontmatter.status]) {
    status = STATUS_MAP[bean.frontmatter.status];
  } else if (beanSessions.length === 0) {
    status = "not_started";
  } else if (bean.dialedTags.length > 0) {
    status = "dialed";
  } else {
    status = "dialling_in";
  }
  bean.rotationStatus = status;
}

const data = {
  generatedAt: new Date().toISOString(),
  beans,
  sessions,
  notes,
  dialedTags,
  grinderConversion,
};

fs.mkdirSync(path.join(__dirname, "public"), { recursive: true });
fs.writeFileSync(path.join(__dirname, "public/data.json"), JSON.stringify(data, null, 2));

const unresolved = sessions.filter((s) => s.bean && !s.beanSlug);
console.log(`Beans: ${beans.length}, Sessions: ${sessions.length}, Notes: ${notes.length}, Dialed tags: ${dialedTags.length}`);
if (unresolved.length) {
  console.log("WARNING: sessions with unresolved bean link:");
  for (const s of unresolved) console.log(`  ${s.sourceFile} -> bean="${s.bean}"`);
}
const noFileTags = dialedTags.filter((t) => !t.sessionFile);
if (noFileTags.length) {
  console.log("WARNING: dialed tags with no resolved session file:");
  for (const t of noFileTags) console.log(`  ${t.tag}`);
}
