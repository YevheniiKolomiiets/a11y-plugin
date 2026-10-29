#!/usr/bin/env node
// Validates lab.json and bakes it into the lab template, so the page opens from file:// with no fetch.
// Usage: node build-lab.mjs <lab.json> [out.html]   (out defaults to lab.html next to lab.json)
// Exit code 1 with a list of problems when the data is inconsistent.
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { basename, dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { measure, measureCurrent } from "./lab-math.mjs";

const here = dirname(fileURLToPath(import.meta.url));
const [inPath, outArg] = process.argv.slice(2);
if (!inPath) { console.error("usage: node build-lab.mjs <lab.json> [out.html]"); process.exit(2); }
const labPath = resolve(inPath);
const outPath = resolve(outArg ?? join(dirname(labPath), "lab.html"));
const data = JSON.parse(readFileSync(labPath, "utf8"));
const problems = [];

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const KINDS = new Set(["text", "tiny", "eyebrow", "display", "link", "link-icon", "btn", "edge", "chip", "badge",
  "sev", "pill", "plate", "avatar", "icon", "input", "field", "logo", "footer", "in-row", "stack", "focus"]);
const SHAPES = new Set(["btn", "item", "icon", "toggle"]);

if (data.version !== 1) problems.push(`version must be 1, got ${data.version}`);
if (!data.meta?.id) problems.push("meta.id is required (key for saved browser edits)");
const themes = (data.themes || []).map((t) => t.id);
if (!themes.length) problems.push("themes: at least one theme");

const tokenNames = new Set();
for (const t of data.tokens || []) {
  if (tokenNames.has(t.name)) problems.push(`token ${t.name}: duplicate`);
  tokenNames.add(t.name);
  for (const th of themes) {
    if (!HEX.test(t.values?.[th] ?? "")) problems.push(`token ${t.name}: value for theme ${th} is not #rrggbb[aa]`);
  }
  // source: "file:line" for every theme, or { theme: "file:line" } when each theme is declared in its own place.
  if (t.source != null && typeof t.source === "object") {
    for (const th of Object.keys(t.source)) if (!themes.includes(th)) problems.push(`token ${t.name}.source: unknown theme ${th}`);
  } else if (t.source != null && typeof t.source !== "string") problems.push(`token ${t.name}.source: must be a string or { theme: "file:line" }`);
}
const checkRef = (where, spec) => {
  if (spec == null) return;
  const [name, alpha] = String(spec).split("@");
  if (name.startsWith("#")) { if (!HEX.test(name)) problems.push(`${where}: bad colour ${spec}`); }
  else if (!tokenNames.has(name)) problems.push(`${where}: unknown token ${name}`);
  if (alpha != null && !(parseFloat(alpha) >= 0 && parseFloat(alpha) <= 1)) problems.push(`${where}: bad alpha in ${spec}`);
};
const checkTokenMap = (where, map) => {
  for (const [th, vals] of Object.entries(map || {})) {
    if (!themes.includes(th)) problems.push(`${where}: unknown theme ${th}`);
    for (const [k, v] of Object.entries(vals || {})) {
      if (!tokenNames.has(k)) problems.push(`${where}.${th}: unknown token ${k}`);
      if (!HEX.test(v)) problems.push(`${where}.${th}.${k}: not #rrggbb[aa]`);
    }
  }
};
checkTokenMap("proposal", data.proposal);

// shot: { theme: { file, rect: [x, y, w, h], dpr?, pad? } } — the element on the audit's screenshot of that theme.
// file is relative to lab.html (the page crops it with CSS); rect in CSS px, the image in device px (dpr, default 1).
// The image's size goes into the page as shot.size, so the crop can stop at its edges.
const pngSize = (file) => {
  const b = readFileSync(file);
  if (b.length < 24 || b.toString("latin1", 1, 4) !== "PNG") return null;
  return [b.readUInt32BE(16), b.readUInt32BE(20)];
};
// The audit names a state's screenshot and its elements file alike: screenshots/07-chat-empty-light.png ↔ elements/07-chat-empty-light.json.
const viewportOf = (img) => {
  const f = join(dirname(img), "..", "elements", basename(img).replace(/\.png$/i, ".json"));
  if (!existsSync(f)) return null;
  try { return JSON.parse(readFileSync(f, "utf8")).viewport || null; } catch { return null; }
};
const missingShots = new Map();
function checkShot(w, r) {
  for (const th of themes) {
    if (r.themes && !r.themes.includes(th)) continue;
    if (!r.shot?.[th]) missingShots.set(th, [...(missingShots.get(th) || []), r.id]);
  }
  for (const [th, s] of Object.entries(r.shot || {})) {
    const at = `${w}.shot.${th}`;
    if (!themes.includes(th)) { problems.push(`${at}: unknown theme`); continue; }
    if (r.themes && !r.themes.includes(th)) problems.push(`${at}: the row is not shown in ${th}`);
    if (typeof s.file !== "string" || !s.file) { problems.push(`${at}.file: a path relative to lab.html`); continue; }
    if (!Array.isArray(s.rect) || s.rect.length !== 4 || !s.rect.every((v) => typeof v === "number") || !(s.rect[2] > 0 && s.rect[3] > 0)) {
      problems.push(`${at}.rect: [x, y, width, height] in CSS px, width and height > 0`); continue;
    }
    for (const k of ["dpr", "pad"]) if (s[k] != null && !(typeof s[k] === "number" && s[k] >= (k === "dpr" ? 0.1 : 0))) problems.push(`${at}.${k}: a number`);
    const img = resolve(dirname(outPath), s.file);
    if (!existsSync(img)) { problems.push(`${at}.file: ${s.file} not found next to ${basename(outPath)} (${img})`); continue; }
    const size = pngSize(img);
    if (!size) { problems.push(`${at}.file: ${s.file} is not a PNG`); continue; }
    const dpr = s.dpr ?? 1, [x, y, rw, rh] = s.rect;
    if (x < 0 || y < 0 || (x + rw) * dpr > size[0] + 1 || (y + rh) * dpr > size[1] + 1) {
      problems.push(`${at}.rect: [${s.rect}] at dpr ${dpr} falls outside ${s.file} (${size[0]}×${size[1]}) — wrong file, dpr or scroll`);
    }
    const vp = viewportOf(img);
    if (vp && (Math.abs(vp[0] * dpr - size[0]) > 1 || Math.abs(vp[1] * dpr - size[1]) > 1)) {
      problems.push(`${at}: ${s.file} is ${size[0]}×${size[1]}, but its elements file has viewport ${vp[0]}×${vp[1]} at dpr ${dpr} — the screenshot is not of the same view, or dpr is wrong`);
    }
    s.size = size;
  }
}

const decisionIds = new Set((data.decisions || []).map((d) => d.id));
const rowIds = new Set();
for (const r of data.rows || []) {
  const w = `row ${r.id}`;
  if (!r.id) problems.push("row without id");
  if (rowIds.has(r.id)) problems.push(`${w}: duplicate id`);
  rowIds.add(r.id);
  if (!KINDS.has(r.kind)) problems.push(`${w}: unknown kind ${r.kind}`);
  if (!(r.need > 0) && !r.info) problems.push(`${w}: need must be > 0 (or info: true)`);
  if (!Array.isArray(r.bg) || !r.bg.length) problems.push(`${w}: bg must be a non-empty list`);
  checkRef(`${w}.fg`, r.fg);
  for (const b of r.bg || []) checkRef(`${w}.bg`, b);
  for (const s of r.stage || []) checkRef(`${w}.stage`, s);
  checkRef(`${w}.border`, r.border);
  checkRef(`${w}.inner`, r.inner);
  checkRef(`${w}.base`, r.base);
  checkShot(w, r);
  if (r.noDecision != null && (typeof r.noDecision !== "string" || !r.noDecision.trim())) problems.push(`${w}.noDecision: say why no colour choice fixes it`);
  if (r.noDecision && r.decision) problems.push(`${w}: decision and noDecision together`);
  for (const p of r.parts || []) checkRef(`${w}.parts`, p.fg);
  for (const th of r.themes || []) if (!themes.includes(th)) problems.push(`${w}: unknown theme ${th}`);
  if (r.decision && !decisionIds.has(r.decision)) problems.push(`${w}: unknown decision ${r.decision}`);
  if ((r.kind === "icon" || r.control?.shape === "icon") && r.icon && !data.icons?.[r.icon]) problems.push(`${w}: unknown icon ${r.icon}`);
  if (r.kind === "focus") {
    const c = r.control || {};
    if (c.shape && !SHAPES.has(c.shape)) problems.push(`${w}.control.shape: one of ${[...SHAPES].join(" | ")}`);
    checkRef(`${w}.control.fg`, c.fg);
    for (const b of c.bg || []) checkRef(`${w}.control.bg`, b);
    checkRef(`${w}.control.border`, c.border);
    checkRef(`${w}.control.groupBorder`, c.groupBorder);
    for (const k of ["offset", "width"]) if (r[k] != null && typeof r[k] !== "number") problems.push(`${w}.${k}: a number of px`);
  } else if (r.control) problems.push(`${w}: control is only for kind focus`);
  // measured: { theme: { ratio, fg, bg, note } } from the audit; no ratio = nothing drawn to measure.
  for (const [th, m] of Object.entries(r.measured || {})) {
    if (!themes.includes(th)) problems.push(`${w}.measured: unknown theme ${th}`);
    if (m.ratio != null && !(typeof m.ratio === "number" && HEX.test(m.fg ?? "") && HEX.test(m.bg ?? ""))) problems.push(`${w}.measured.${th}: ratio needs fg and bg as #rrggbb`);
    if (m.ratio == null && !m.note) problems.push(`${w}.measured.${th}: without a ratio, say in note what the audit saw`);
  }
}
for (const d of data.decisions || []) {
  const w = `decision ${d.id}`;
  if (!["open", "recorded"].includes(d.status)) problems.push(`${w}: status must be open | recorded`);
  if (!d.options?.length) problems.push(`${w}: no options`);
  // chosen: { theme: optionId } for recorded themes (a plain string = every theme); recorded = every theme has one.
  const chosen = typeof d.chosen === "string" ? Object.fromEntries(themes.map((t) => [t, d.chosen])) : d.chosen || {};
  for (const [t, id] of Object.entries(chosen)) {
    if (!themes.includes(t)) problems.push(`${w}.chosen: unknown theme ${t}`);
    if (!d.options?.some((o) => o.id === id)) problems.push(`${w}.chosen.${t}: no option ${id}`);
  }
  // themes: the decision covers only these themes (e.g. a dark-only fix); recorded = each of them has a choice.
  for (const th of d.themes || []) if (!themes.includes(th)) problems.push(`${w}.themes: unknown theme ${th}`);
  const covered = d.themes?.length ? d.themes : themes;
  for (const t of Object.keys(chosen)) if (!covered.includes(t)) problems.push(`${w}.chosen.${t}: the decision does not cover this theme`);
  const complete = covered.every((t) => chosen[t]);
  if (d.status === "recorded" && !complete) problems.push(`${w}: status recorded, but not every theme has a chosen option (keep it open)`);
  if (d.status === "open" && complete) problems.push(`${w}: every theme has a chosen option, status should be recorded`);
  for (const o of d.options || []) checkTokenMap(`${w}.option ${o.id}.tokens`, o.tokens);
  if (!(data.rows || []).some((r) => r.decision === d.id)) problems.push(`${w}: no rows point to it`);
}

// Reconciliation with the audit: what the lab calls failing now must be what the audit found failing.
// meta.auditFails: { theme: { finding: count } } — the failing pairs of each finding's tables in the report.
// Rows carry `finding` (the report's id, e.g. "С2"); rows whose src is not the audit (code, ticket) are not reconciled.
const nowFailing = {};
if (!problems.length) {
  for (const th of themes) {
    const pal = Object.fromEntries(data.tokens.map((t) => [t.name, t.values[th]]));
    nowFailing[th] = [];
    for (const r of data.rows) {
      if (r.info || (r.themes && !r.themes.includes(th))) continue;
      const m = measureCurrent(r, pal, th);
      if (m.missing || m.ratio < r.need) nowFailing[th].push({ row: r, ratio: m.missing ? null : m.ratio });
    }
  }
  const fromAudit = (r) => String(r.src || "").startsWith("аудит") || String(r.src || "").startsWith("audit");
  const audit = data.meta.auditFails;
  if (!audit) console.warn("warning: meta.auditFails is missing, the lab is not reconciled with the audit");
  for (const th of themes) {
    const fails = nowFailing[th];
    console.log(`${th}: failing now ${fails.length} — ${fails.map((f) => `${f.row.id}${f.row.finding ? ` [${f.row.finding}]` : ""} ${f.ratio == null ? "not drawn" : f.ratio.toFixed(2)}`).join(", ") || "none"}`);
    if (!audit) continue;
    const want = audit[th] || {};
    for (const [finding, n] of Object.entries(want)) {
      const got = fails.filter((f) => f.row.finding === finding).length;
      if (n > 0 && !got) problems.push(`${th}: the audit has ${n} failing for ${finding}, the lab has none failing now — a row is missing or modelled wrong (background, opacity, measured)`);
      else if (got !== n) console.warn(`warning: ${th} ${finding}: audit ${n}, lab ${got} failing now — fine only if the rows group the report's pairs differently`);
    }
    for (const f of fails) {
      if (!fromAudit(f.row)) continue;
      if (!f.row.finding) problems.push(`row ${f.row.id}: fails now in ${th} and comes from the audit, but names no finding`);
      else if (!want[f.row.finding]) problems.push(`row ${f.row.id}: fails now in ${th} (${f.ratio == null ? "not drawn" : f.ratio.toFixed(2)}), but the audit has no failure for ${f.row.finding} in ${th} — model it as measured, or mark it src "код" if it is a finding of the lab's own`);
    }
  }
}

// Decisions: the palette the Proposal column shows (code + proposal + recorded choices), and the same with one option on top.
const recordedOption = (d, th) => {
  const id = typeof d.chosen === "string" ? d.chosen : d.chosen?.[th];
  return id ? d.options.find((o) => o.id === id) : null;
};
const covers = (d, th) => !d.themes?.length || d.themes.includes(th);
const proposalPalette = (th, skip) => {
  const pal = Object.fromEntries(data.tokens.map((t) => [t.name, t.values[th]]));
  Object.assign(pal, data.proposal?.[th] || {});
  for (const d of data.decisions || []) if (d !== skip && covers(d, th)) Object.assign(pal, recordedOption(d, th)?.tokens?.[th] || {});
  return pal;
};
const appliesTo = (r, th) => !r.info && (!r.themes || r.themes.includes(th));
const fmt = (m) => m.ratio.toFixed(2);

if (!problems.length) {
  // Every option must fix every row of its decision, in every theme it gives values for:
  // an option that leaves its own rows failing is not a way out, whatever its note says.
  for (const d of data.decisions || []) {
    const rows = data.rows.filter((r) => r.decision === d.id);
    for (const o of d.options) {
      for (const th of Object.keys(o.tokens || {})) {
        if (!covers(d, th)) { problems.push(`decision ${d.id}.option ${o.id}: gives values for ${th}, which the decision does not cover`); continue; }
        const pal = { ...proposalPalette(th, d), ...o.tokens[th] };
        for (const r of rows.filter((x) => appliesTo(x, th))) {
          const m = measure(r, pal);
          if (m.ratio < r.need) problems.push(`decision ${d.id}.option ${o.id} (${th}): row ${r.id} still fails, ${fmt(m)} < ${r.need}`);
        }
      }
    }
  }

  // Coverage: a row failing in the Proposal column is either in a decision for that theme, or says why no colour
  // choice fixes it (noDecision). Groups are worked one at a time, so this is a list of what is left, not an error.
  for (const th of themes) {
    const pal = proposalPalette(th);
    const left = new Map();
    for (const r of data.rows) {
      if (!appliesTo(r, th) || r.noDecision) continue;
      const d = r.decision && (data.decisions || []).find((x) => x.id === r.decision);
      if (d && covers(d, th)) continue;
      const m = measure(r, pal);
      if (m.ratio >= r.need) continue;
      const g = r.group || "(no group)";
      left.set(g, [...(left.get(g) || []), `${r.id} ${fmt(m)}`]);
    }
    for (const [g, ids] of left) console.warn(`warning: ${th}: «${g}» fails with no decision for this theme — ${ids.join(", ")}`);
  }
}

for (const [th, ids] of missingShots) console.warn(`warning: ${th}: ${ids.length} row(s) without a screenshot — ${ids.join(", ")}`);

if (problems.length) {
  console.error(`lab.json check failed (${problems.length}):`);
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}

const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));
const fontLinks = (data.meta.font?.css || []).map((href) => `<link href="${esc(href)}" rel="stylesheet">`).join("\n");
// "</" inside the JSON would close the script tag.
const json = JSON.stringify(data).replace(/<\//g, "<\\/");
const html = readFileSync(join(here, "..", "templates", "lab.html"), "utf8")
  .replace("__TITLE__", esc(data.meta.title || "Contrast Lab"))
  .replace("<!--FONT_LINKS-->", fontLinks)
  .replace("/*LAB_DATA*/", () => json);
writeFileSync(outPath, html);
console.log(`lab built: ${outPath} (${data.tokens.length} tokens, ${data.rows.length} rows, ${(data.decisions || []).length} decisions, ${themes.length} themes)`);
