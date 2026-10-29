#!/usr/bin/env node
// Self-check of an /a11y:audit report before it is handed over.
// Usage: node check-report.mjs <report.md> [--screenshots <dir>]   (dir defaults to "screenshots" next to the report)
// Exit code 1 and a list of problems when anything fails.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import { dirname, join, relative, resolve } from "node:path";

const args = process.argv.slice(2);
const reportPath = resolve(args[0] ?? "README.md");
const shotsArg = args.indexOf("--screenshots");
const reportDir = dirname(reportPath);
const shotsDir = resolve(reportDir, shotsArg >= 0 ? args[shotsArg + 1] : "screenshots");
const md = readFileSync(reportPath, "utf8");
const problems = [];

// Code blocks never count as links or headings.
const text = md.replace(/```[\s\S]*?```/g, "");

// 1. Every local link points to an existing file.
const links = [...text.matchAll(/\[[^\]]*\]\(([^)\s]+)(?:\s+"[^"]*")?\)/g)].map((m) => m[1]);
const local = links.filter((l) => !/^(https?:|mailto:|#)/.test(l));
for (const l of local) {
  const file = decodeURIComponent(l.split("#")[0]);
  if (file && !existsSync(resolve(reportDir, file))) problems.push(`broken link: ${l}`);
}

// 2. Every screenshot is referenced at least once (no orphans).
const IMG = /\.(png|jpe?g|webp|gif)$/i;
// Only the screenshots folder itself: subfolders belong to other reports (e.g. a re-run).
const walk = (dir) => readdirSync(dir).map((n) => join(dir, n)).filter((p) => statSync(p).isFile());
if (existsSync(shotsDir)) {
  const linked = new Set(local.map((l) => resolve(reportDir, decodeURIComponent(l.split("#")[0]))));
  for (const f of walk(shotsDir).filter((p) => IMG.test(p))) {
    if (!linked.has(f)) problems.push(`screenshot not referenced: ${relative(reportDir, f)}`);
  }
}

// 3. No screenshot file names outside link targets ("see 03-login.png" instead of a link).
const withoutTargets = text.replace(/\]\([^)]*\)/g, "]()");
for (const m of withoutTargets.matchAll(/\b[\w.-]+\.(png|jpe?g|webp|gif)\b/gi)) {
  problems.push(`bare screenshot name (not a link): ${m[0]}`);
}

// 4. Every in-page anchor matches a heading (GitHub-style slugs, Unicode letters kept).
const slug = (h) =>
  h
    .trim()
    .toLowerCase()
    .replace(/<[^>]+>/g, "")
    .replace(/[^\p{L}\p{N}\s_-]/gu, "")
    .replace(/\s/g, "-");
const counts = new Map();
const anchors = new Set();
for (const m of text.matchAll(/^#{1,6}\s+(.+?)\s*#*\s*$/gm)) {
  const base = slug(m[1].replace(/`/g, ""));
  const n = counts.get(base) ?? 0;
  counts.set(base, n + 1);
  anchors.add(n ? `${base}-${n}` : base);
}
for (const l of links.filter((l) => l.startsWith("#"))) {
  if (!anchors.has(decodeURIComponent(l.slice(1)))) problems.push(`anchor without heading: ${l}`);
}

// 5. Tables with a screenshots column: no empty cells there (use "—" when there is no shot).
const lines = text.split("\n");
for (let i = 0; i < lines.length; i++) {
  if (!/^\s*\|/.test(lines[i]) || !/^\s*\|[\s:|-]+\|\s*$/.test(lines[i + 1] ?? "")) continue;
  const header = lines[i].split("|").slice(1, -1).map((c) => c.trim());
  const shotCols = header.map((h, k) => (/скріншот|screenshot/i.test(h) ? k : -1)).filter((k) => k >= 0);
  for (let j = i + 2; j < lines.length && /^\s*\|/.test(lines[j]); j++) {
    const cells = lines[j].split("|").slice(1, -1).map((c) => c.trim());
    for (const k of shotCols) if (!cells[k]) problems.push(`empty screenshot cell, line ${j + 1}: ${cells[0]}`);
  }
}

if (problems.length) {
  console.error(`report check failed (${problems.length}):`);
  for (const p of problems) console.error(" - " + p);
  process.exit(1);
}
console.log(`report check passed: ${local.length} local links, ${anchors.size} headings`);
