#!/usr/bin/env node
// Markdown tables for the decisions document, computed from lab.json with the lab's own maths,
// so contrast numbers are never worked out by hand.
//
// Usage:
//   node contrast-table.mjs <lab.json> --decision <id>        tokens + contrast of the decision's rows
//   node contrast-table.mjs <lab.json> --rows <id,id,…>       contrast of the given rows
//   options: --themes light,dark   --lang uk|en (headers; default uk)
//
// "Proposal" = current values + lab.json `proposal` + options recorded per theme in decisions,
// the same as the lab's proposal column without the viewer's browser edits.
import { readFileSync } from "node:fs";
import { measure as measureRaw, measureCurrent, toHex } from "./lab-math.mjs";

const args = process.argv.slice(2);
const opt = (name) => { const i = args.indexOf(name); return i >= 0 ? args[i + 1] : undefined; };
const lab = JSON.parse(readFileSync(args[0], "utf8"));
const decisionId = opt("--decision");
const rowIds = opt("--rows")?.split(",").map((s) => s.trim()).filter(Boolean);
// `chosen` is { theme: optionId } for the themes recorded so far; a plain string means every theme.
const recordedId = (d, theme) => (typeof d.chosen === "string" ? d.chosen : d.chosen?.[theme]) || null;
const recordedThemes = (d) => lab.themes.map((t) => t.id).filter((t) => d && recordedId(d, t));
const target = (lab.decisions || []).find((d) => d.id === decisionId);
const picked = recordedThemes(target);
// With --decision and no --themes: only the themes that decision is recorded for (the others are still open),
// or, before any record, the themes it covers.
const themes = (opt("--themes")?.split(",") ?? (picked.length ? picked : target?.themes ?? lab.themes.map((t) => t.id))).filter((t) => lab.themes.some((x) => x.id === t));
const en = opt("--lang") === "en";
const L = en
  ? { token: "Token", now: "Today", element: "Element", pair: "Pair (proposal)", current: "Current", proposal: "Proposal", need: "Threshold", exempt: "exempt", unchanged: "unchanged", new: "new", notDrawn: "not drawn" }
  : { token: "Токен", now: "Зараз", element: "Елемент", pair: "Пара (пропозиція)", current: "Зараз", proposal: "Пропозиція", need: "Поріг", exempt: "виняток", unchanged: "без змін", new: "новий", notDrawn: "не малюється" };
if (!decisionId && !rowIds) { console.error("usage: contrast-table.mjs <lab.json> --decision <id> | --rows <ids>"); process.exit(2); }

// Maths: scripts/lab-math.mjs, the same as templates/lab.html.
const measure = (row, pal) => { const m = measureRaw(row, pal); return { ...m, fg: toHex(m.fg), bg: toHex(m.bg) }; };

const current = {}, proposed = {};
for (const t of lab.themes) {
  current[t.id] = Object.fromEntries(lab.tokens.map((k) => [k.name, String(k.values[t.id]).toLowerCase()]));
  proposed[t.id] = { ...current[t.id], ...(lab.proposal?.[t.id] || {}) };
  for (const d of lab.decisions || []) {
    const id = recordedId(d, t.id);
    if (!id) continue;
    const o = d.options.find((x) => x.id === id);
    Object.assign(proposed[t.id], o?.tokens?.[t.id] || {});
  }
}
const label = (id) => lab.themes.find((t) => t.id === id)?.label || id;
const fmt = (r, need, info) => (info ? r.toFixed(2) : `${r >= need ? "" : "✗ "}${r.toFixed(2)}`);
const out = [];

const decision = decisionId && (lab.decisions || []).find((d) => d.id === decisionId);
if (decisionId && !decision) { console.error(`decision ${decisionId} not found`); process.exit(1); }

// Token table: every token any option of the decision touches, plus tokens with a proposal that its rows use.
if (decision) {
  const keys = new Set();
  for (const o of decision.options) for (const t of themes) for (const k of Object.keys(o.tokens?.[t] || {})) keys.add(k);
  const head = `| ${L.token} | ${themes.map(label).join(" | ")} | ${L.now} (${themes.map(label).join(" / ")}) |`;
  out.push(head, `| ${["---", ...themes.map(() => "---"), "---"].join(" | ")} |`);
  for (const k of keys) {
    const tok = lab.tokens.find((t) => t.name === k);
    const cells = themes.map((t) => (proposed[t][k] === current[t][k] ? `\`${proposed[t][k]}\`, ${L.unchanged}` : `\`${proposed[t][k]}\``));
    // source: one place for every theme, or { theme: "file:line" } — then each theme's place goes next to its value.
    const perTheme = tok?.source && typeof tok.source === "object";
    const now = themes.map((t) => `\`${current[t][k]}\`${perTheme && tok.source[t] ? ` (${tok.source[t]})` : ""}`).join(" / ");
    out.push(`| \`--${k}\` | ${cells.join(" | ")} | ${now}${!perTheme && tok?.source ? ` (${tok.source})` : ""} |`);
  }
  out.push("");
}

const rows = decision ? lab.rows.filter((r) => r.decision === decision.id) : lab.rows.filter((r) => rowIds.includes(r.id));
for (const id of rowIds || []) if (!lab.rows.some((r) => r.id === id)) { console.error(`row ${id} not found`); process.exit(1); }
const head = `| ${L.element} | ${L.need} | ${themes.map((t) => `${label(t)}: ${L.current} → ${L.proposal}`).join(" | ")} | ${L.pair} |`;
out.push(head, `| ${["---", "---", ...themes.map(() => "---"), "---"].join(" | ")} |`);
for (const r of rows) {
  const ts = themes.filter((t) => !r.themes || r.themes.includes(t));
  const cells = themes.map((t) => {
    if (!ts.includes(t)) return "—";
    // Current: the audit's measurement where the row has one (a structural defect), else the code colours.
    const c = measureCurrent(r, current[t], t), p = measure(r, proposed[t]);
    return `${c.missing ? `✗ ${L.notDrawn}` : fmt(c.ratio, r.need, r.info)} → ${fmt(p.ratio, r.need, r.info)}`;
  });
  const pairs = ts.map((t) => { const p = measure(r, proposed[t]); return `${label(t)}: \`${p.fg}\` / \`${p.bg}\``; }).join("; ");
  out.push(`| ${r.label} | ${r.info ? L.exempt : r.need.toFixed(1)} | ${cells.join(" | ")} | ${pairs} |`);
}
console.log(out.join("\n"));
