/* ===================================================================
   BYO.Fonts — font catalogue + DOM application helper for the text
   component. Two curated lists:
     DISPLAY   — Helvetica-family display stacks (+ Inter variable)
     PARAGRAPH — modern Arial-like grotesks for body (+ Roboto Flex
                 variable, + system grotesk)
   Each entry is { label, stack, variable? }, where `variable` declares
   the available variable-font axis ranges so the format panel can show
   axis sliders only when the picked stack actually supports them.

   apply(els, opts) writes the relevant CSS onto one element or a list:
     fontFamily, fontWeight, letterSpacing (px), wordSpacing (px) and
     fontVariationSettings (from a {wght,wdth,slnt,opsz} variation map).

   isVariable(stack) -> the catalogue entry whose stack matches (so the
   panel knows which axes to expose), or null.

   Pure DOM. No THREE. Classic-script IIFE on window.BYO — no ES modules.
   The actual variable web fonts (Inter, Roboto Flex) are loaded by the
   harness <head>; this module only references them by family name and
   degrades to the rest of the stack when they are absent.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  /* ---- catalogues ---------------------------------------------------
     `variable.wght` etc. are [min,max] axis ranges. Only entries that
     name a variable web font (Inter, Roboto Flex) carry a `variable`
     block; the pure system stacks are static and omit it. opsz/wdth/slnt
     ranges follow each font's published axis spec. */
  const DISPLAY = [
    {
      label: 'Helvetica Neue',
      stack: '"Helvetica Neue", Helvetica, Arial, sans-serif'
    },
    {
      label: 'Helvetica',
      stack: 'Helvetica, "Helvetica Neue", Arial, sans-serif'
    },
    {
      label: 'Arial',
      stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif'
    },
    {
      label: 'Inter (variable)',
      stack: '"Inter", "Helvetica Neue", Helvetica, Arial, sans-serif',
      variable: { wght: [100, 900], opsz: [14, 32], slnt: [-10, 0] }
    }
  ];

  const PARAGRAPH = [
    {
      label: 'Inter (variable)',
      stack: '"Inter", Arial, "Helvetica Neue", Helvetica, sans-serif',
      variable: { wght: [100, 900], opsz: [14, 32], slnt: [-10, 0] }
    },
    {
      label: 'Roboto Flex (variable)',
      stack: '"Roboto Flex", Arial, "Helvetica Neue", Helvetica, sans-serif',
      variable: { wght: [100, 1000], opsz: [8, 144], wdth: [25, 151], slnt: [-10, 0] }
    },
    {
      label: 'System grotesk',
      stack: 'system-ui, -apple-system, "Segoe UI", Roboto, Arial, sans-serif'
    },
    {
      label: 'Arial',
      stack: 'Arial, "Helvetica Neue", Helvetica, sans-serif'
    }
  ];

  /* ---- helpers ------------------------------------------------------ */

  // Normalise a font stack string for comparison (collapse whitespace,
  // strip quotes, lowercase) so 'Inter' and '"Inter"' compare equal and
  // a stack typed with different spacing still matches the catalogue.
  function _norm(stack) {
    return String(stack == null ? '' : stack)
      .replace(/["']/g, '')
      .replace(/\s+/g, ' ')
      .trim()
      .toLowerCase();
  }

  // Build the `font-variation-settings` value from a {wght,wdth,slnt,opsz}
  // map. Only numeric axes present are emitted, in a stable axis order.
  // Returns '' when nothing usable was supplied (caller clears the prop).
  const _AXIS_ORDER = ['wght', 'wdth', 'slnt', 'opsz'];
  function variationToCss(variation) {
    if (!variation || typeof variation !== 'object') return '';
    const parts = [];
    for (let i = 0; i < _AXIS_ORDER.length; i++) {
      const axis = _AXIS_ORDER[i];
      const v = variation[axis];
      if (v == null) continue;
      const n = Number(v);
      if (!isFinite(n)) continue;
      parts.push("'" + axis + "' " + n);
    }
    return parts.join(', ');
  }

  // Coerce a px-ish value to a CSS length string, or null to skip.
  function _px(v) {
    if (v == null || v === '') return null;
    const n = Number(v);
    if (!isFinite(n)) return null;
    return n + 'px';
  }

  /* ---- public API --------------------------------------------------- */

  // isVariable(stack) -> the catalogue entry (with .variable axis ranges)
  // matching this stack, or null for static stacks / unknown input.
  // Matches against DISPLAY then PARAGRAPH; only returns entries that
  // actually declare variable axes.
  function isVariable(stack) {
    const want = _norm(stack);
    if (!want) return null;
    const all = DISPLAY.concat(PARAGRAPH);
    for (let i = 0; i < all.length; i++) {
      const entry = all[i];
      if (!entry.variable) continue;
      if (_norm(entry.stack) === want) return entry;
    }
    return null;
  }

  // apply(els, { family, weight, letterSpacing, wordSpacing, variation })
  // els: a single Element or an array/NodeList of Elements. Each provided
  // option is written; omitted options are left untouched. Passing an
  // explicit empty string ('' / null) for a property clears it so the
  // element falls back to inherited/default styling.
  function apply(els, opts) {
    opts = opts || {};
    const list = _toList(els);
    if (!list.length) return;

    const hasFamily = ('family' in opts);
    const hasWeight = ('weight' in opts);
    const hasLetter = ('letterSpacing' in opts);
    const hasWord = ('wordSpacing' in opts);
    const hasVar = ('variation' in opts);

    const family = opts.family;
    const weight = opts.weight;
    const letterCss = hasLetter ? _px(opts.letterSpacing) : null;
    const wordCss = hasWord ? _px(opts.wordSpacing) : null;
    const variationCss = hasVar ? variationToCss(opts.variation) : '';

    for (let i = 0; i < list.length; i++) {
      const el = list[i];
      if (!el || !el.style) continue;
      const s = el.style;

      if (hasFamily) s.fontFamily = (family == null || family === '') ? '' : String(family);

      if (hasWeight) {
        if (weight == null || weight === '') s.fontWeight = '';
        else s.fontWeight = String(weight);
      }

      if (hasLetter) s.letterSpacing = letterCss == null ? '' : letterCss;
      if (hasWord) s.wordSpacing = wordCss == null ? '' : wordCss;

      if (hasVar) s.fontVariationSettings = variationCss ? variationCss : '';
    }
  }

  // Normalise an Element | array | NodeList into a plain array.
  function _toList(els) {
    if (!els) return [];
    if (els.nodeType === 1) return [els];          // single Element
    if (typeof els.length === 'number') {           // Array | NodeList | HTMLCollection
      const out = [];
      for (let i = 0; i < els.length; i++) out.push(els[i]);
      return out;
    }
    return [];
  }

  BYO.Fonts = {
    DISPLAY: DISPLAY,
    PARAGRAPH: PARAGRAPH,
    apply: apply,
    isVariable: isVariable,
    variationToCss: variationToCss
  };
})();
