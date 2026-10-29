// Contrast maths of the lab, shared by build-lab.mjs and contrast-table.mjs.
// templates/lab.html carries its own copy (it opens from file:// with no imports): keep the two in step.

export const parseHex = (h) => {
  h = String(h).trim().replace(/^#/, "");
  if (h.length === 3 || h.length === 4) h = h.split("").map((c) => c + c).join("");
  if (!/^[0-9a-f]{6}([0-9a-f]{2})?$/i.test(h)) return null;
  const n = (i) => parseInt(h.slice(i, i + 2), 16);
  return [n(0), n(2), n(4), h.length === 8 ? n(6) / 255 : 1];
};
export const toHex = ([r, g, b]) => "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("");
export const over = (t, b) => [0, 1, 2].map((i) => t[i] * t[3] + b[i] * (1 - t[3])).concat(1);
const lum = ([r, g, b]) => { const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; }; return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b); };
export const contrast = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };
export const resolve = (spec, pal) => {
  const [name, alpha] = String(spec).split("@");
  const c = parseHex(name.startsWith("#") ? name : pal[name]);
  if (!c) throw new Error(`cannot resolve ${spec}`);
  return [c[0], c[1], c[2], c[3] * (alpha ? parseFloat(alpha) : 1)];
};
export const flatten = (layers, pal) => { let a = resolve(layers[0], pal); a = [a[0], a[1], a[2], 1]; for (const l of layers.slice(1)) a = over(resolve(l, pal), a); return a; };

// kind "focus": the ring is an outline `width` px wide, `offset` px from the control's border edge (negative = inside).
// It has to stand out from what it touches: the surface outside the control, the control itself inside.
export function focusGeometry(row, pal) {
  const surface = flatten(row.bg, pal);
  const c = row.control || {};
  const fill = c.bg?.length ? flatten([...row.bg, ...c.bg], pal) : surface;
  const edge = c.border ? over(resolve(c.border, pal), fill) : fill;
  const width = row.width ?? 2, offset = row.offset ?? 2;
  // What the band is painted over, and what lies just outside and just inside it.
  const backdrops = offset >= 0 ? [surface] : offset + width <= 0 ? [fill] : [surface, fill];
  const outer = offset + width >= 0 ? surface : fill;
  const inner = offset > 0 ? surface : offset === 0 ? edge : fill;
  return { surface, fill, edge, width, offset, backdrops, neighbours: [outer, inner] };
}
function measureFocus(row, pal) {
  const g = focusGeometry(row, pal), ring = resolve(row.fg, pal);
  let worst = null;
  for (const b of g.backdrops) for (const n of g.neighbours) {
    const fg = over(ring, b), ratio = contrast(fg, n);
    if (!worst || ratio < worst.ratio) worst = { fg, bg: n, ratio };
  }
  return worst;
}

/** The pair a row is judged by, from a palette ({ token: hex }). */
export function measure(row, pal) {
  if (row.kind === "focus") return measureFocus(row, pal);
  let bg = flatten(row.bg, pal), fg = over(resolve(row.fg, pal), bg);
  if (row.opacity != null) {
    const base = flatten([row.base || row.bg[0]], pal);
    bg = over([bg[0], bg[1], bg[2], row.opacity], base);
    fg = over([fg[0], fg[1], fg[2], row.opacity], base);
  }
  return { fg, bg, ratio: contrast(fg, bg) };
}

/**
 * The Current column: what the audit measured, when the row carries it for this theme (a structural defect,
 * e.g. a focus ring the code declares but never draws); otherwise the code colours.
 * `missing`: the audit saw nothing to measure (no ring at all) — that fails whatever the threshold.
 */
export function measureCurrent(row, pal, theme) {
  const m = row.measured?.[theme];
  if (!m) return { ...measure(row, pal), measured: false };
  if (m.ratio == null) return { fg: null, bg: null, ratio: 0, measured: true, missing: true, note: m.note };
  return { fg: parseHex(m.fg), bg: parseHex(m.bg), ratio: m.ratio, measured: true, note: m.note };
}
