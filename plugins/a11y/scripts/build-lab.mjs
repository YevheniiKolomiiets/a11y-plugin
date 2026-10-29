#!/usr/bin/env node
// Validates lab.json and bakes it into the lab template, so the page opens from file:// with no fetch.
// Usage: node build-lab.mjs <lab.json> [out.html]   (out defaults to lab.html next to lab.json)
// Exit code 1 with a list of problems when the data is inconsistent.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const here = dirname(fileURLToPath(import.meta.url));
const [inPath, outArg] = process.argv.slice(2);
if (!inPath) { console.error("usage: node build-lab.mjs <lab.json> [out.html]"); process.exit(2); }
const labPath = resolve(inPath);
const outPath = resolve(outArg ?? join(dirname(labPath), "lab.html"));
const data = JSON.parse(readFileSync(labPath, "utf8"));
const problems = [];

const HEX = /^#[0-9a-f]{6}([0-9a-f]{2})?$/i;
const KINDS = new Set(["text", "tiny", "eyebrow", "display", "link", "link-icon", "btn", "edge", "chip", "badge",
  "sev", "pill", "plate", "avatar", "icon", "input", "field", "logo", "footer", "in-row", "stack"]);

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
  for (const p of r.parts || []) checkRef(`${w}.parts`, p.fg);
  for (const th of r.themes || []) if (!themes.includes(th)) problems.push(`${w}: unknown theme ${th}`);
  if (r.decision && !decisionIds.has(r.decision)) problems.push(`${w}: unknown decision ${r.decision}`);
  if (r.kind === "icon" && r.icon && !data.icons?.[r.icon]) problems.push(`${w}: unknown icon ${r.icon}`);
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
