/* ===================================================================
   BYO.WordEffects — word-replacement effects for the text component.

   A single selected word becomes an "interactive replace" slot that cycles
   through a list of replacement words (each with its own colour). Two effect
   types, ported from the BYO prototypes:
     - scrub     (root index.html): horizontal pointer movement over the word
                  steps through the replacements (isHorizontal + 45px threshold)
     - autocycle (root codepen.html): Perlin-modulated auto-advance with a
                  ramp + pause-on-hover

   An effect lives on its anchor `.byo-word` span (marked data-fx="<id>") and in
   component.effects[id] = { type, params, replacements:[{text,color}], idx }.
   replacements[0] is the base word (so cycling includes the original); the
   span's visible text is replacements[idx]. The controller below drives every
   active effect for one component (one rAF + delegated pointer handling).

   Classic-script IIFE on window.BYO — no ES modules.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  /* ---- Perlin-ish 1D value noise (verbatim from codepen.html) ---- */
  function fade(t) { return t * t * (3 - 2 * t); }
  function hash(i) { const x = Math.sin(i * 127.1) * 43758.5453; return x - Math.floor(x); }
  function noise1D(x) { const i = Math.floor(x), f = x - i, a = hash(i), b = hash(i + 1); return a + (b - a) * fade(f); }

  /* ---- SDG palette + contrasting pick (from index.html) ---- */
  const sdgColors = [
    '#E5233D', '#DDA73A', '#4CA146', '#C5192D', '#EF402C', '#27BFE6',
    '#FBC412', '#A31C44', '#F26A2D', '#E01483', '#F89D2A', '#BF8D2C',
    '#407F46', '#1F97D4', '#59BA48', '#126A9F', '#13496B'
  ];
  function getContrastingColor(exclude) {
    const avail = sdgColors.filter(function (c) { return c.toLowerCase() !== String(exclude || '').toLowerCase(); });
    return avail[Math.floor(Math.random() * avail.length)];
  }

  // movement gesture (from index.html): mostly-horizontal beyond a threshold
  const SCRUB_THRESHOLD = 45;
  function isHorizontal(dx, dy) { return Math.abs(dx) > SCRUB_THRESHOLD && Math.abs(dx) > Math.abs(dy); }

  // default autocycle params (from codepen.html)
  function defaultParams() {
    return { changeRate: 2.0, noiseAmount: 0.6, noiseSpeed: 0.5, rampDuration: 2.5, rampCurve: 2.0 };
  }

  /* ---- per-component controller: runs all of its effects ---- */
  function create(component) {
    const ed = component.editable;
    let raf = 0;
    let lastT = performance.now();
    // per-effect runtime state (timing/ramp/scrub anchor), keyed by fx id
    const rt = {};
    function state(id) { return rt[id] || (rt[id] = { acc: 0, noiseT: Math.random() * 1000, ramp: 0, hover: false, sx: 0 }); }

    function spanFor(id) { return ed.querySelector('.byo-word[data-fx="' + id + '"]'); }

    // apply the current replacement (text + colour) to the anchor span
    function paint(span, fx) {
      const rep = fx.replacements[fx.idx % fx.replacements.length];
      if (!rep) return;
      if (span.textContent !== rep.text) span.textContent = rep.text;
      if (rep.color) { span.dataset.color = rep.color; span.style.color = rep.color; }
      if (component.isWarped) component._rasterizeIntoWarp();
    }

    function step(fx, dir) {
      const n = fx.replacements.length;
      if (n <= 1) return;
      fx.idx = ((fx.idx + (dir || 1)) % n + n) % n;
      const sp = spanFor(fx.id);
      if (sp) paint(sp, fx);
    }

    /* --- scrub: horizontal movement over the word advances it --- */
    function onMove(e) {
      const target = e.target;
      const span = target && target.closest ? target.closest('.byo-word[data-fx]') : null;
      if (!span) return;
      const id = span.getAttribute('data-fx');
      const fx = component.effects[id];
      if (!fx || !fx.active || fx.type !== 'scrub') return;
      const st = state(id);
      if (st.sx === 0) { st.sx = e.clientX; st.sy = e.clientY; return; }
      if (isHorizontal(e.clientX - st.sx, e.clientY - st.sy)) {
        step(fx, e.clientX > st.sx ? 1 : -1);
        st.sx = e.clientX; st.sy = e.clientY;
      }
    }
    function onOver(e) {
      const span = e.target && e.target.closest ? e.target.closest('.byo-word[data-fx]') : null;
      if (!span) return;
      const id = span.getAttribute('data-fx');
      state(id).hover = true; state(id).sx = 0;
    }
    function onOut(e) {
      const span = e.target && e.target.closest ? e.target.closest('.byo-word[data-fx]') : null;
      if (!span) return;
      state(span.getAttribute('data-fx')).hover = false;
    }
    ed.addEventListener('mousemove', onMove);
    ed.addEventListener('mouseover', onOver);
    ed.addEventListener('mouseout', onOut);

    /* --- autocycle: Perlin-modulated auto-advance, pause on hover --- */
    function frame(now) {
      const dt = Math.min(0.1, (now - lastT) / 1000);
      lastT = now;
      const fxs = component.effects;
      Object.keys(fxs).forEach(function (id) {
        const fx = fxs[id];
        if (!fx.active || fx.type !== 'autocycle') return;
        const sp = spanFor(id);
        if (!sp) return;
        const p = fx.params || defaultParams();
        const st = state(id);
        const paused = st.hover;
        let speed;
        if (paused) { st.ramp = 0; speed = 0; }
        else { st.ramp += dt; const r = Math.min(1, st.ramp / Math.max(0.0001, p.rampDuration)); speed = Math.pow(r, p.rampCurve); }
        st.noiseT += dt * p.noiseSpeed;
        const n = (noise1D(st.noiseT) - 0.5) * 2;
        const rate = Math.max(0, p.changeRate * (1 + p.noiseAmount * n) * speed);
        st.acc += rate * dt;
        while (st.acc >= 1) { st.acc -= 1; step(fx, 1); }
      });
      raf = requestAnimationFrame(frame);
    }
    raf = requestAnimationFrame(frame);

    return {
      // re-apply base text for all effects (e.g. after a re-wrap rebuilds spans)
      refresh: function () {
        Object.keys(component.effects).forEach(function (id) {
          const sp = spanFor(id); const fx = component.effects[id];
          if (sp && fx) paint(sp, fx);
        });
      },
      destroy: function () {
        if (raf) cancelAnimationFrame(raf);
        ed.removeEventListener('mousemove', onMove);
        ed.removeEventListener('mouseover', onOver);
        ed.removeEventListener('mouseout', onOut);
      }
    };
  }

  BYO.WordEffects = {
    create: create,
    noise1D: noise1D,
    sdgColors: sdgColors,
    getContrastingColor: getContrastingColor,
    isHorizontal: isHorizontal,
    defaultParams: defaultParams
  };
})();
