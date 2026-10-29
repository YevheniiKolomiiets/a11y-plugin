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
  ? { token: "Token", now: "Today", element: "Element", pair: "Pair (proposal)", current: "Current", proposal: "Proposal", need: "Threshold", exempt: "exempt", unchanged: "unchanged", new: "new" }
  : { token: "Токен", now: "Зараз", element: "Елемент", pair: "Пара (пропозиція)", current: "Зараз", proposal: "Пропозиція", need: "Поріг", exempt: "виняток", unchanged: "без змін", new: "новий" };
if (!decisionId && !rowIds) { console.error("usage: contrast-table.mjs <lab.json> --decision <id> | --rows <ids>"); process.exit(2); }

// ── maths (same as templates/lab.html) ──
const parseHex = (h) => {
  h = String(h).trim().replace(/^#/, "");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
};
const toHex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
const resolve = (spec, pal) => {
  const [name, alpha] = String(spec).split("@");
  const c = parseHex(name.startsWith("#") ? name : pal[name]);
  if (!c) throw new Error(`cannot resolve ${spec}`);
  return [c[0], c[1], c[2], c[3] * (alpha ? parseFloat(alpha) : 1)];
};
const flatten = (layers, pal) => { let a = resolve(layers[0], pal); a = [a[0], a[1], a[2], 1]; for (const l of layers.slice(1)) a = over(resolve(l, pal), a); return a; };
const measure = (row, pal) => {
  let bg = flatten(row.bg, pal), fg = over(resolve(row.fg, pal), bg);
  if (row.opacity != null) {
    const base = flatten([row.base || row.bg[0]], pal);
    bg = over([bg[0], bg[1], bg[2], row.opacity], base);
    fg = over([fg[0], fg[1], fg[2], row.opacity], base);
  }
  return { fg: toHex(fg), bg: toHex(bg), ratio: contrast(fg, bg) };
};

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
    const c = measure(r, current[t]), p = measure(r, proposed[t]);
    return `${fmt(c.ratio, r.need, r.info)} → ${fmt(p.ratio, r.need, r.info)}`;
  });
  const pairs = ts.map((t) => { const p = measure(r, proposed[t]); return `${label(t)}: \`${p.fg}\` / \`${p.bg}\``; }).join("; ");
  out.push(`| ${r.label} | ${r.info ? L.exempt : r.need.toFixed(1)} | ${cells.join(" | ")} | ${pairs} |`);
}
console.log(out.join("\n"));
