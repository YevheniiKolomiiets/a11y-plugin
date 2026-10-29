async () => {
  const vis = (el) => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(el);
    return r.width > 0 && r.height > 0 && cs.visibility !== 'hidden' && cs.display !== 'none';
  };
  const desc = (el) => {
    const id = el.id ? '#' + el.id : '';
    const name = (el.getAttribute('aria-label') || el.innerText || el.value || el.getAttribute('placeholder') || '').trim().slice(0, 40);
    return `${el.tagName.toLowerCase()}${id}${el.getAttribute('role') ? '[role=' + el.getAttribute('role') + ']' : ''} "${name}"`;
  };
  const out = { url: location.pathname + location.search, title: document.title, lang: document.documentElement.lang, theme: document.documentElement.className };
  out.headings = [...document.querySelectorAll('h1,h2,h3,h4,h5,h6,[role=heading]')].filter(vis).map(h => `${h.tagName}${h.getAttribute('aria-level') || ''}: ${h.innerText.trim().slice(0, 50)}`);
  out.landmarks = [...document.querySelectorAll('main,[role=main],nav,[role=navigation],header,footer,aside,[role=banner],[role=contentinfo],[role=complementary],[role=search],form[aria-label],section[aria-label],section[aria-labelledby]')]
    .map(l => `${l.tagName.toLowerCase()}${l.getAttribute('role') ? '[' + l.getAttribute('role') + ']' : ''}${l.getAttribute('aria-label') ? ' "' + l.getAttribute('aria-label') + '"' : ''}`);
  const firstFocusable = [...document.querySelectorAll('a[href],button,input,select,textarea,[tabindex]')].find(e => e.tabIndex >= 0);
  out.skipLink = firstFocusable ? /skip|перейти|main content/i.test(firstFocusable.innerText + firstFocusable.getAttribute('aria-label')) : false;
  // inputs without accessible label
  out.unlabeledInputs = [...document.querySelectorAll('input:not([type=hidden]),select,textarea')].filter(vis).filter(i => {
    if (i.getAttribute('aria-label') || i.getAttribute('aria-labelledby') || i.title) return false;
    if (i.id && document.querySelector(`label[for="${CSS.escape(i.id)}"]`)) return false;
    if (i.closest('label')) return false;
    return true;
  }).map(desc);
  out.inputsNoAutocomplete = [...document.querySelectorAll('input[type=email],input[type=password],input[name*=name i],input[type=tel]')].filter(vis).filter(i => !i.getAttribute('autocomplete')).map(desc);
  // buttons/links without name
  out.namelessControls = [...document.querySelectorAll('button,a[href],[role=button],[role=link],[role=tab],[role=menuitem]')].filter(vis).filter(b => {
    const t = (b.innerText || '').trim();
    const al = b.getAttribute('aria-label') || '';
    const lb = b.getAttribute('aria-labelledby');
    const img = b.querySelector('img[alt]:not([alt=""])');
    const title = b.getAttribute('title');
    return !t && !al.trim() && !lb && !img && !title;
  }).map(b => b.outerHTML.slice(0, 160));
  out.imgsNoAlt = [...document.querySelectorAll('img:not([alt])')].map(i => i.src.slice(-60));
  out.svgsNotHidden = [...document.querySelectorAll('button svg:not([aria-hidden=true]), a svg:not([aria-hidden=true])')].length;
  out.positiveTabindex = [...document.querySelectorAll('[tabindex]')].filter(e => e.tabIndex > 0).map(desc);
  out.clickableDivs = [...document.querySelectorAll('div,span,li,tr,td,article')].filter(e => (e.onclick || e.getAttribute('onclick')) && e.tabIndex < 0).map(desc).slice(0, 10);
  out.ariaHiddenFocusable = [...document.querySelectorAll('[aria-hidden=true] a[href],[aria-hidden=true] button,[aria-hidden=true] input')].filter(e => e.tabIndex >= 0).map(desc);
  // small targets
  out.smallTargets = [...document.querySelectorAll('button,a[href],input[type=checkbox],input[type=radio],[role=button],[role=switch],[role=tab]')].filter(vis).filter(e => {
    const r = e.getBoundingClientRect();
    const inlineLink = e.tagName === 'A' && getComputedStyle(e).display === 'inline';
    return !inlineLink && (r.width < 24 || r.height < 24);
  }).map(e => { const r = e.getBoundingClientRect(); return `${desc(e)} ${Math.round(r.width)}x${Math.round(r.height)}`; }).slice(0, 25);
  // focus indicator check
  const focusables = [...document.querySelectorAll('a[href],button:not([disabled]),input:not([disabled]):not([type=hidden]),select,textarea,[tabindex]:not([tabindex="-1"])')].filter(vis).slice(0, 60);
  const prev = document.activeElement;
  out.noFocusIndicator = [];
  for (const el of focusables) {
    const before = getComputedStyle(el);
    const b = { o: before.outlineStyle + before.outlineWidth, s: before.boxShadow, bc: before.borderColor, bg: before.backgroundColor, td: before.textDecorationLine };
    el.focus({ focusVisible: true, preventScroll: true });
    if (document.activeElement !== el) continue;
    const a = getComputedStyle(el);
    const hasOutline = a.outlineStyle !== 'none' && parseFloat(a.outlineWidth) > 0;
    const changed = hasOutline || a.boxShadow !== b.s || a.borderColor !== b.bc || a.backgroundColor !== b.bg || a.textDecorationLine !== b.td;
    const parentRing = el.parentElement && getComputedStyle(el.parentElement).boxShadow !== 'none' && el.parentElement.matches(':focus-within');
    if (!changed && !parentRing) out.noFocusIndicator.push(desc(el));
    el.blur();
  }
  prev && prev.focus && prev.focus({ preventScroll: true });
  out.noFocusIndicator = out.noFocusIndicator.slice(0, 25);
  // reduced motion support in stylesheets
  let rm = false;
  for (const ss of document.styleSheets) { try { for (const r of ss.cssRules) { if (r.conditionText && /prefers-reduced-motion/.test(r.conditionText)) rm = true; } } catch (e) {} }
  out.reducedMotionRules = rm;
  out.animatedEls = [...document.querySelectorAll('*')].filter(e => { const c = getComputedStyle(e); return c.animationName !== 'none' && vis(e); }).length;
  out.liveRegions = [...document.querySelectorAll('[aria-live],[role=alert],[role=status]')].map(desc);
  out.dialogs = [...document.querySelectorAll('[role=dialog],dialog')].filter(vis).map(d => `${desc(d)} modal=${d.getAttribute('aria-modal')} labelled=${!!(d.getAttribute('aria-labelledby') || d.getAttribute('aria-label'))}`);
  out.hScroll = document.documentElement.scrollWidth > window.innerWidth ? `${document.documentElement.scrollWidth}>${window.innerWidth}` : false;
  return out;
}
