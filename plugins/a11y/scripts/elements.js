// Collects every visible text element, icon and control border on the current page with the colours
// the browser actually renders: computed text colour, the stack of backgrounds behind it, opacity, font.
// Run through Chrome DevTools MCP `evaluate_script`; save the result as JSON for /a11y:lab.
// Colours go through a canvas, so oklch(), color(), hsl() and rgba() all come back as sRGB.
async () => {
  const canvas = document.createElement("canvas");
  canvas.width = canvas.height = 1;
  const ctx = canvas.getContext("2d", { willReadFrequently: true });
  const rgba = (css) => {
    ctx.clearRect(0, 0, 1, 1);
    ctx.fillStyle = "#000";
    ctx.fillStyle = css;
    ctx.fillRect(0, 0, 1, 1);
    const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
    return [r, g, b, a / 255];
  };
  const hex = ([r, g, b, a]) =>
    "#" + [r, g, b].map((v) => Math.round(v).toString(16).padStart(2, "0")).join("") +
    (a < 1 ? Math.round(a * 255).toString(16).padStart(2, "0") : "");
  const over = (top, base) => [0, 1, 2].map((i) => top[i] * top[3] + base[i] * (1 - top[3])).concat(1);
  const lum = ([r, g, b]) => {
    const f = (v) => { v /= 255; return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4; };
    return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
  };
  const ratio = (a, b) => { const x = lum(a), y = lum(b); return (Math.max(x, y) + 0.05) / (Math.min(x, y) + 0.05); };

  // opacity 0 on the element or any ancestor hides it as surely as display: none (faded-out menus,
  // tooltips, filtered rows). aria-hidden and inert do not: decorative icons are aria-hidden yet seen.
  const visible = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== "hidden" && cs.display !== "none" && opacityFrom(el) > 0;
  };
  const selector = (el) => {
    const parts = [];
    for (let n = el; n && n.nodeType === 1 && parts.length < 4; n = n.parentElement) {
      let s = n.tagName.toLowerCase();
      if (n.id) { parts.unshift(`${s}#${CSS.escape(n.id)}`); break; }
      const cls = [...n.classList].slice(0, 2).map((c) => "." + CSS.escape(c)).join("");
      parts.unshift(s + cls);
    }
    return parts.join(" > ");
  };

  // `opacity` on a node fades its whole subtree, own background included, so every layer is scaled
  // by the opacity of its own node and of all nodes above it.
  const opacityFrom = (n) => {
    let o = 1;
    for (; n; n = n.parentElement) o *= parseFloat(getComputedStyle(n).opacity || "1");
    return o;
  };
  // Background layers from the element up to the first opaque one; image or gradient is flagged,
  // because the real pixel under the text is then unknown. Anything left translucent sits on the
  // page background (or white).
  const backgrounds = (el) => {
    const layers = [];
    let image = false;
    for (let n = el; n; n = n.parentElement) {
      const cs = getComputedStyle(n);
      if (cs.backgroundImage && cs.backgroundImage !== "none") image = true;
      const c = rgba(cs.backgroundColor);
      if (c[3] > 0) {
        layers.unshift([c[0], c[1], c[2], c[3] * opacityFrom(n)]);
        if (c[3] >= 1) break;
      }
    }
    const page = rgba(getComputedStyle(document.documentElement).backgroundColor);
    const base = page[3] > 0 ? page : rgba(getComputedStyle(document.body).backgroundColor);
    layers.unshift(base[3] > 0 ? [...base.slice(0, 3), 1] : [255, 255, 255, 1]);
    let bg = layers[0];
    for (const l of layers.slice(1)) bg = over(l, bg);
    return { layers, bg, image };
  };

  const measure = (el, kind) => {
    const cs = getComputedStyle(el);
    const colorProp = kind === "icon" ? (cs.stroke !== "none" && cs.stroke ? cs.stroke : cs.color) : cs.color;
    const { layers, bg, image } = backgrounds(el);
    const op = opacityFrom(el);
    const fgRaw = rgba(colorProp);
    const fg = over([fgRaw[0], fgRaw[1], fgRaw[2], fgRaw[3] * op], bg);
    const size = parseFloat(cs.fontSize);
    const weight = parseInt(cs.fontWeight, 10) || 400;
    const large = size >= 24 || (size >= 18.66 && weight >= 700);
    const r = el.getBoundingClientRect();
    const disabled = !!el.closest(":disabled, [aria-disabled=true]");
    return {
      kind,
      selector: selector(el),
      text: kind === "text" ? el.textContent.trim().replace(/\s+/g, " ").slice(0, 60) : (el.closest("[aria-label]")?.getAttribute("aria-label") || ""),
      classes: (el.getAttribute("class") || "").slice(0, 300),
      fg: hex(fg), fgRaw: hex(fgRaw), bg: hex(bg), bgLayers: layers.map(hex), bgImage: image, opacity: +op.toFixed(3),
      font: cs.fontFamily.split(",")[0].replace(/["']/g, "").trim(), size, weight,
      need: kind === "icon" || large ? 3 : 4.5,
      ratio: +ratio(fg, bg).toFixed(2),
      disabled,
      rect: [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)],
    };
  };

  const out = [];
  const seen = new Set();
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT, {
    acceptNode: (t) => (t.textContent.trim() ? NodeFilter.FILTER_ACCEPT : NodeFilter.FILTER_REJECT),
  });
  for (let t = walker.nextNode(); t; t = walker.nextNode()) {
    const el = t.parentElement;
    if (!el || seen.has(el) || !visible(el) || el.closest("script,style,noscript,[aria-hidden=true] svg")) continue;
    seen.add(el);
    out.push(measure(el, "text"));
  }
  // Placeholders are text too.
  for (const el of document.querySelectorAll("input[placeholder],textarea[placeholder]")) {
    if (!visible(el) || el.value) continue;
    const cs = getComputedStyle(el, "::placeholder");
    const m = measure(el, "text");
    const { bg } = backgrounds(el);
    const raw = rgba(cs.color);
    const fg = over([raw[0], raw[1], raw[2], raw[3] * opacityFrom(el)], bg);
    out.push({ ...m, kind: "placeholder", text: el.getAttribute("placeholder").slice(0, 60), fg: hex(fg), fgRaw: hex(rgba(cs.color)), ratio: +ratio(fg, bg).toFixed(2), need: 4.5 });
  }
  for (const el of document.querySelectorAll("svg")) {
    if (!visible(el) || seen.has(el)) continue;
    seen.add(el);
    out.push(measure(el, "icon"));
  }
  // Borders of controls (1.4.11): the widest side, painted over the control's own fill (default
  // background-clip) and compared with the background outside the control. A border is not needed
  // when the fill alone already stands out from the outside by 3:1, so `fillRatio` is kept too.
  const controls = "input:not([type=hidden]),textarea,select,button,[role=button],[role=checkbox],[role=radio],[role=switch],[role=combobox],[role=textbox],[role=tab],[role=slider]";
  for (const el of document.querySelectorAll(controls)) {
    if (!visible(el)) continue;
    const cs = getComputedStyle(el);
    const side = ["Top", "Right", "Bottom", "Left"]
      .map((s) => ({ s, w: parseFloat(cs[`border${s}Width`]) || 0, style: cs[`border${s}Style`], color: rgba(cs[`border${s}Color`]) }))
      .filter((b) => b.w > 0 && b.style !== "none" && b.style !== "hidden" && b.color[3] > 0)
      .sort((a, b) => b.w - a.w)[0];
    if (!side) continue;
    const outer = el.parentElement ? backgrounds(el.parentElement) : backgrounds(el);
    const own = backgrounds(el).bg;
    const op = opacityFrom(el);
    const under = cs.backgroundClip === "border-box" ? own : outer.bg;
    const fg = over([side.color[0], side.color[1], side.color[2], side.color[3] * op], under);
    const r = el.getBoundingClientRect();
    out.push({
      kind: "border",
      selector: selector(el),
      text: el.getAttribute("aria-label") || el.getAttribute("placeholder") || el.textContent.trim().replace(/\s+/g, " ").slice(0, 60),
      classes: (el.getAttribute("class") || "").slice(0, 300),
      fg: hex(fg), fgRaw: hex(side.color), bg: hex(outer.bg), bgLayers: outer.layers.map(hex), bgImage: outer.image, opacity: +op.toFixed(3),
      font: "", size: 0, weight: 0,
      need: 3,
      ratio: +ratio(fg, outer.bg).toFixed(2),
      fill: hex(own), fillRatio: +ratio(own, outer.bg).toFixed(2),
      side: side.s.toLowerCase(), width: side.w,
      disabled: !!el.closest(":disabled, [aria-disabled=true]"),
      rect: [Math.round(r.x), Math.round(r.y + window.scrollY), Math.round(r.width), Math.round(r.height)],
    });
  }

  // Same colours + font + classes = one row for the lab; keep up to three example selectors.
  const groups = new Map();
  for (const e of out) {
    const key = [e.kind, e.fg, e.bg, e.size, e.weight, e.classes].join("|");
    const g = groups.get(key);
    if (g) { g.count++; if (g.examples.length < 3) g.examples.push({ selector: e.selector, text: e.text, rect: e.rect }); }
    else groups.set(key, { ...e, count: 1, examples: [{ selector: e.selector, text: e.text, rect: e.rect }] });
  }
  const rows = [...groups.values()].map(({ selector, text, rect, ...g }) => ({
    ...g,
    fails: !g.disabled && g.ratio < g.need && !(g.kind === "border" && g.fillRatio >= 3),
  }));
  return {
    url: location.pathname + location.search,
    title: document.title,
    theme: document.documentElement.getAttribute("data-theme") || document.documentElement.className || "",
    viewport: [window.innerWidth, window.innerHeight],
    collectedAt: new Date().toISOString(),
    rows,
  };
}
