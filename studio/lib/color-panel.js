/* ===================================================================
   BYO.ColorPanel — a perceptual SOLID-colour picker rendered as dev-panel
   content. Built on BYO.color (OKLab math) + BYO.ColorSampler (eyedropper).

   The picker UI is OKLCH-flavoured: an OKLab vector is stored as
   { L, a, b }; we expose it to the user as an OKLCH 2D square
   (x = chroma C, y = lightness L) plus a hue (H) slider. OKLCH <-> OKLab:
       a = C * cos(H),  b = C * sin(H),   C = hypot(a,b),  H = atan2(b,a)
   We pick OKLCH because chroma/lightness/hue are the axes a human edits;
   the underlying maths (and gamut clamp) stay in OKLab via BYO.color.

   API (frozen spec, studio/_TEXTCOMPONENT_SPEC.md):
     BYO.ColorPanel.create(panelBody) -> instance
     instance.open({ hex, onChange, onCommit, sources, recent })
       - OKLCH 2D square + hue slider, draggable marker
       - LIVE: drag/click fires onChange(hex) continuously
       - re-click repositions the marker (re-pick)
       - HEX + R/G/B inputs -> onChange
       - recent swatches (hex[], newest first) -> onChange + move marker
       - one-time eyedropper (BYO.ColorSampler) -> onChange + onCommit + stop
       - onCommit(hex) on release / enter / swatch / eyedropper-pick
     instance.setRecent(arr); instance.setColor(hex)

   The panel does NOT own recents — app state does; we only render + report.
   Classic-script IIFE on window.BYO. No ES modules.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  const color = BYO.color;
  if (!color) throw new Error('ColorPanel requires BYO.color (projection-cube/lib/color.js) loaded first');
  const Sampler = BYO.ColorSampler; // optional at create-time; used by eyedropper

  /* ---- OKLCH domain -----------------------------------------------------
     The 2D square maps:  x (0..1) -> chroma C in [0, C_MAX]
                          y (0..1, top=1) -> lightness L in [0, 1]
     The hue slider maps: 0..1 -> H in [0, 2*PI).
     C_MAX is a display ceiling; out-of-gamut OKLCH values are clamped back
     into sRGB by BYO.color.oklabToRgb (its srgb() clamps each channel), so
     the square is allowed to show the clamped (gamut-mapped) colour. */
  const C_MAX = 0.4;          // generous chroma ceiling for the square's x axis
  const TAU = Math.PI * 2;

  function oklabToLch(o) {
    const C = Math.hypot(o.a, o.b);
    let H = Math.atan2(o.b, o.a);
    if (H < 0) H += TAU;
    return { L: o.L, C: C, H: H };
  }
  function lchToOklab(lch) {
    return { L: lch.L, a: lch.C * Math.cos(lch.H), b: lch.C * Math.sin(lch.H) };
  }
  function lchToHex(lch) {
    const rgb = color.oklabToRgb(lchToOklab(lch));
    return color.rgbToHex(rgb.r, rgb.g, rgb.b);
  }
  function hexToLch(hex) {
    const c = color.hexToRgb(hex);
    return oklabToLch(color.rgbToOklab(c.r, c.g, c.b));
  }
  function clamp01(v) { return v < 0 ? 0 : v > 1 ? 1 : v; }

  /* validate / canonicalise a hex-ish string -> '#rrggbb' | null */
  function parseHex(str) {
    if (str == null) return null;
    let s = String(str).trim().replace(/^#/, '');
    if (/^[0-9a-fA-F]{3}$/.test(s)) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];
    if (!/^[0-9a-fA-F]{6}$/.test(s)) return null;
    return '#' + s.toLowerCase();
  }
  function clampByte(v) { v = Math.round(v); return v < 0 ? 0 : v > 255 ? 255 : v; }

  function create(panelBody) {
    if (!panelBody) throw new Error('ColorPanel.create needs a panel body element');

    /* live callbacks + state for the currently-open session */
    let onChange = function () {};
    let onCommit = function () {};
    let sources = [];
    let recent = [];
    let eyedropper = null;       // active BYO.ColorSampler eyedropper, if any

    // current colour in OKLCH; the marker + slider derive from this.
    let lch = { L: 0.7, C: 0.1, H: 0 };

    /* ---- DOM scaffold (utilitarian; no theming) ---------------------- */
    const root = document.createElement('div');
    root.className = 'byo-colorpanel';
    const S = root.style;
    S.font = '11px system-ui, sans-serif';
    S.color = '#222';
    S.userSelect = 'none';

    // 2D square: chroma (x) x lightness (y). Painted per-frame-of-change on a canvas.
    const SQ = 160;
    const square = document.createElement('canvas');
    square.width = SQ; square.height = SQ;
    const sqS = square.style;
    sqS.width = '100%'; sqS.height = 'auto'; sqS.display = 'block';
    sqS.borderRadius = '3px'; sqS.cursor = 'crosshair'; sqS.touchAction = 'none';
    const sqCtx = square.getContext('2d', { willReadFrequently: false });

    // wrapper holds the square + an absolutely-positioned marker
    const sqWrap = document.createElement('div');
    sqWrap.style.position = 'relative';
    sqWrap.appendChild(square);
    const marker = document.createElement('div');
    const mS = marker.style;
    mS.position = 'absolute'; mS.width = mS.height = '12px';
    mS.marginLeft = mS.marginTop = '-6px';
    mS.borderRadius = '50%'; mS.border = '2px solid #fff';
    mS.boxShadow = '0 0 0 1px rgba(0,0,0,.5)';
    mS.pointerEvents = 'none'; mS.boxSizing = 'border-box';
    sqWrap.appendChild(marker);
    root.appendChild(sqWrap);

    // hue slider (native range; track painted via gradient background)
    const hue = document.createElement('input');
    hue.type = 'range'; hue.min = '0'; hue.max = '360'; hue.step = '1';
    hue.style.width = '100%'; hue.style.margin = '8px 0 6px';
    // a perceptual hue strip (OKLCH at mid L, fixed C) as the track background
    hue.style.background = _hueGradient();
    hue.style.height = '14px';
    hue.style.borderRadius = '7px';
    hue.style.appearance = 'none';
    hue.style.webkitAppearance = 'none';
    root.appendChild(hue);

    // inputs row: HEX + R/G/B
    const inputs = document.createElement('div');
    inputs.style.display = 'grid';
    inputs.style.gridTemplateColumns = '1.6fr 1fr 1fr 1fr';
    inputs.style.gap = '4px';
    inputs.style.margin = '2px 0 8px';
    const hexInput = _mkInput('hex', '#rrggbb');
    const rInput = _mkInput('r', 'R'); rInput.maxLength = 3;
    const gInput = _mkInput('g', 'G'); gInput.maxLength = 3;
    const bInput = _mkInput('b', 'B'); bInput.maxLength = 3;
    [hexInput, rInput, gInput, bInput].forEach((el) => inputs.appendChild(el.wrap));
    root.appendChild(inputs);

    // eyedropper button
    const eyeBtn = document.createElement('button');
    eyeBtn.type = 'button';
    eyeBtn.textContent = 'Eyedropper';
    eyeBtn.style.cssText = 'width:100%;margin-bottom:8px;padding:4px;font:inherit;cursor:pointer;';
    root.appendChild(eyeBtn);

    // recent swatches
    const recentLabel = document.createElement('div');
    recentLabel.textContent = 'Recent';
    recentLabel.style.cssText = 'font-size:10px;opacity:.6;margin-bottom:3px;';
    root.appendChild(recentLabel);
    const recentRow = document.createElement('div');
    recentRow.style.cssText = 'display:flex;flex-wrap:wrap;gap:4px;';
    root.appendChild(recentRow);

    panelBody.appendChild(root);

    /* ---- helpers ----------------------------------------------------- */
    function _mkInput(name, ph) {
      const wrap = document.createElement('div');
      const el = document.createElement('input');
      el.type = 'text'; el.placeholder = ph; el.dataset.field = name;
      el.style.cssText = 'width:100%;box-sizing:border-box;padding:3px 4px;font:inherit;' +
        'border:1px solid #ccc;border-radius:3px;text-align:center;';
      wrap.appendChild(el);
      return { wrap, el, value: () => el.value, set: (v) => { el.value = v; } };
    }

    // a static OKLCH hue ramp for the slider track (sample 0..360 at mid L/C)
    function _hueGradient() {
      const stops = [];
      for (let i = 0; i <= 12; i++) {
        const H = (i / 12) * TAU;
        stops.push(lchToHex({ L: 0.65, C: 0.13, H }) + ' ' + Math.round((i / 12) * 100) + '%');
      }
      return 'linear-gradient(to right,' + stops.join(',') + ')';
    }

    // repaint the chroma x lightness square at the current hue
    function _paintSquare() {
      const H = lch.H;
      const img = sqCtx.createImageData(SQ, SQ);
      const px = img.data;
      for (let y = 0; y < SQ; y++) {
        const L = 1 - y / (SQ - 1);          // top = bright
        for (let x = 0; x < SQ; x++) {
          const C = (x / (SQ - 1)) * C_MAX;  // left = grey, right = saturated
          const rgb = color.oklabToRgb(lchToOklab({ L, C, H }));
          const i = (y * SQ + x) * 4;
          px[i] = Math.round(rgb.r * 255);
          px[i + 1] = Math.round(rgb.g * 255);
          px[i + 2] = Math.round(rgb.b * 255);
          px[i + 3] = 255;
        }
      }
      sqCtx.putImageData(img, 0, 0);
    }

    // place the marker from the current lch (in % of the square box)
    function _positionMarker() {
      const xPct = clamp01(lch.C / C_MAX) * 100;
      const yPct = (1 - clamp01(lch.L)) * 100;
      mS.left = xPct + '%';
      mS.top = yPct + '%';
      mS.background = lchToHex(lch);
    }

    // sync the text inputs + hue slider to the current colour
    function _syncControls() {
      const hex = lchToHex(lch);
      hexInput.set(hex);
      const c = color.hexToRgb(hex);
      rInput.set(String(Math.round(c.r * 255)));
      gInput.set(String(Math.round(c.g * 255)));
      bInput.set(String(Math.round(c.b * 255)));
      hue.value = String(Math.round((lch.H / TAU) * 360) % 360);
    }

    // full UI refresh from `lch` (no callback)
    function _render() {
      _paintSquare();
      _positionMarker();
      _syncControls();
    }

    // adopt a hex -> lch, refresh UI. Returns the canonical hex.
    function _adoptHex(hex) {
      lch = hexToLch(hex);
      _render();
      return lchToHex(lch);
    }

    // fire live change with the current colour
    function _emitChange() { onChange(lchToHex(lch)); }
    function _emitCommit() { onCommit(lchToHex(lch)); }

    /* ---- square pointer interaction (drag + click + re-click) -------- */
    function _squarePick(clientX, clientY) {
      const r = square.getBoundingClientRect();
      const u = clamp01((clientX - r.left) / r.width);
      const v = clamp01((clientY - r.top) / r.height);
      lch.C = u * C_MAX;
      lch.L = 1 - v;
      _positionMarker();
      _syncControls();
      _emitChange();
    }
    let sqDragging = false;
    square.addEventListener('pointerdown', (e) => {
      sqDragging = true;
      try { square.setPointerCapture(e.pointerId); } catch (_) {}
      _squarePick(e.clientX, e.clientY);
      e.preventDefault();
    });
    square.addEventListener('pointermove', (e) => {
      if (!sqDragging) return;
      _squarePick(e.clientX, e.clientY);
    });
    function _endSquare() {
      if (!sqDragging) return;
      sqDragging = false;
      _emitCommit();
    }
    square.addEventListener('pointerup', _endSquare);
    square.addEventListener('pointercancel', _endSquare);

    /* ---- hue slider -------------------------------------------------- */
    hue.addEventListener('input', () => {
      lch.H = (parseFloat(hue.value) / 360) * TAU;
      _paintSquare();
      _positionMarker();
      // keep text inputs in sync without committing yet
      const hex = lchToHex(lch);
      hexInput.set(hex);
      const c = color.hexToRgb(hex);
      rInput.set(String(Math.round(c.r * 255)));
      gInput.set(String(Math.round(c.g * 255)));
      bInput.set(String(Math.round(c.b * 255)));
      _emitChange();
    });
    hue.addEventListener('change', _emitCommit);

    /* ---- HEX input --------------------------------------------------- */
    function _applyHexInput(commit) {
      const hex = parseHex(hexInput.value());
      if (!hex) return false;
      _adoptHex(hex);
      _emitChange();
      if (commit) _emitCommit();
      return true;
    }
    hexInput.el.addEventListener('input', () => { _applyHexInput(false); });
    hexInput.el.addEventListener('change', () => { _applyHexInput(true); });
    hexInput.el.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') { if (_applyHexInput(true)) hexInput.el.blur(); }
    });

    /* ---- R/G/B inputs ------------------------------------------------ */
    function _readRgb() {
      const r = parseInt(rInput.value(), 10);
      const g = parseInt(gInput.value(), 10);
      const b = parseInt(bInput.value(), 10);
      if (Number.isNaN(r) || Number.isNaN(g) || Number.isNaN(b)) return null;
      return color.rgbToHex(clampByte(r) / 255, clampByte(g) / 255, clampByte(b) / 255);
    }
    function _applyRgbInput(commit) {
      const hex = _readRgb();
      if (!hex) return false;
      _adoptHex(hex);
      _emitChange();
      if (commit) _emitCommit();
      return true;
    }
    [rInput, gInput, bInput].forEach((inp) => {
      inp.el.addEventListener('input', () => { _applyRgbInput(false); });
      inp.el.addEventListener('change', () => { _applyRgbInput(true); });
      inp.el.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') { if (_applyRgbInput(true)) inp.el.blur(); }
      });
    });

    /* ---- recent swatches --------------------------------------------- */
    function _renderRecent() {
      recentRow.textContent = '';
      const list = recent || [];
      if (!list.length) {
        const empty = document.createElement('span');
        empty.textContent = '(none)';
        empty.style.cssText = 'font-size:10px;opacity:.4;';
        recentRow.appendChild(empty);
        return;
      }
      list.forEach((hx) => {
        const canon = parseHex(hx);
        if (!canon) return;
        const sw = document.createElement('button');
        sw.type = 'button';
        sw.title = canon;
        sw.style.cssText = 'width:18px;height:18px;padding:0;border:1px solid rgba(0,0,0,.25);' +
          'border-radius:3px;cursor:pointer;background:' + canon + ';';
        sw.addEventListener('click', () => {
          _adoptHex(canon);
          _emitChange();
          _emitCommit();   // swatch pick is a commit
        });
        recentRow.appendChild(sw);
      });
    }

    /* ---- eyedropper (one-time) --------------------------------------- */
    function _stopEyedropper() {
      if (eyedropper) { eyedropper.stop(); eyedropper = null; }
      eyeBtn.textContent = 'Eyedropper';
    }
    eyeBtn.addEventListener('click', () => {
      if (eyedropper) { _stopEyedropper(); return; }   // toggle off if already armed
      if (!Sampler || typeof Sampler.createEyedropper !== 'function') return;
      eyeBtn.textContent = 'Pick… (Esc)';
      eyedropper = Sampler.createEyedropper({
        sources: sources,
        onPick: (hex) => {
          eyedropper = null;             // sampler already stopped itself on pick
          eyeBtn.textContent = 'Eyedropper';
          const canon = parseHex(hex);
          if (!canon) return;
          _adoptHex(canon);
          _emitChange();
          _emitCommit();                 // eyedropper pick commits
        }
      });
      eyedropper.start();
      // If the sampler stopped itself (Esc) without a pick, reflect the button
      // label lazily on next interaction; an explicit poll keeps it tidy.
      const poll = setInterval(() => {
        if (!eyedropper) { clearInterval(poll); return; }
        if (!eyedropper.active) {
          clearInterval(poll);
          eyedropper = null;
          eyeBtn.textContent = 'Eyedropper';
        }
      }, 120);
    });

    /* ---- public API -------------------------------------------------- */
    const instance = {
      el: root,

      open(opts) {
        opts = opts || {};
        onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};
        onCommit = typeof opts.onCommit === 'function' ? opts.onCommit : function () {};
        sources = (opts.sources || []).filter(Boolean);
        recent = Array.isArray(opts.recent) ? opts.recent.slice() : [];
        _stopEyedropper();
        const hex = parseHex(opts.hex) || '#888888';
        lch = hexToLch(hex);
        _render();
        _renderRecent();
        return instance;
      },

      setRecent(arr) {
        recent = Array.isArray(arr) ? arr.slice() : [];
        _renderRecent();
        return instance;
      },

      // adopt a colour externally (no callbacks fired)
      setColor(hex) {
        const canon = parseHex(hex);
        if (!canon) return instance;
        lch = hexToLch(canon);
        _render();
        return instance;
      },

      // current colour as canonical hex
      getColor() { return lchToHex(lch); },

      destroy() {
        _stopEyedropper();
        if (root.parentNode) root.parentNode.removeChild(root);
      }
    };

    // initial paint so the panel isn't blank before open()
    _render();
    _renderRecent();

    return instance;
  }

  BYO.ColorPanel = { create };
})();
