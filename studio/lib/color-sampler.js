/* ===================================================================
   BYO.ColorSampler — pull pixel colours out of any live source element
   (HTMLVideoElement | HTMLImageElement | HTMLCanvasElement) uniformly.

   Three tools, one shared mapping core:
     sampleAt(el, clientX, clientY)  -> '#rrggbb' | null
     createEyedropper({sources,onPick,visibility}) -> {start,stop,active}
     createSampleWindow({source, rect})            -> {canvas,setRect,dispose}

   The hard part shared by all three is mapping a *screen* point to the
   *source* pixel grid honouring the element's CSS displayed rect and
   object-fit:cover (the source is scaled to COVER its box and centre-
   cropped). We compute that mapping once in _coverMap() and reuse it.

   Pure DOM/canvas. Reuses BYO.color.rgbToHex for the hex string. No THREE
   dependency (the sample-window canvas is handed back raw for the caller
   to wrap in a CanvasTexture if they want). Classic-script IIFE on
   window.BYO — no ES modules.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  const color = BYO.color;   // hex helpers (rgbToHex); must be loaded first
  if (!color) throw new Error('ColorSampler requires BYO.color to be loaded first (projection-cube/lib/color.js)');

  /* ---- source intrinsic pixel dimensions (video|image|canvas) ---------
     Each element type exposes its native resolution differently. Returns
     null while a source has no frame yet (video metadata not loaded, image
     not decoded) so callers can bail instead of dividing by zero. */
  function _intrinsic(el) {
    if (el instanceof HTMLVideoElement) {
      return el.videoWidth && el.videoHeight ? { w: el.videoWidth, h: el.videoHeight } : null;
    }
    if (el instanceof HTMLImageElement) {
      const w = el.naturalWidth || el.width, h = el.naturalHeight || el.height;
      return w && h ? { w, h } : null;
    }
    if (el instanceof HTMLCanvasElement) {
      return el.width && el.height ? { w: el.width, h: el.height } : null;
    }
    return null;
  }

  /* ---- object-fit:cover mapping ---------------------------------------
     Given a source element, returns the transform from CLIENT coords to
     SOURCE-pixel coords under object-fit:cover. cover scales the intrinsic
     image by the LARGER of the two box/intrinsic ratios so it fills the
     box, then centre-crops the overflow. We invert that to go box->source.

       sx = (clientX - rect.left - offX) / scale
       sy = (clientY - rect.top  - offY) / scale

     where scale = max(boxW/iw, boxH/ih) and off* is the negative crop
     (centred). Also returns the box rect so callers can do hit-testing.
     null when the element has no box or no frame yet. */
  function _coverMap(el) {
    const intr = _intrinsic(el);
    if (!intr) return null;
    const rect = el.getBoundingClientRect();
    if (!rect.width || !rect.height) return null;
    const scale = Math.max(rect.width / intr.w, rect.height / intr.h);
    const drawnW = intr.w * scale, drawnH = intr.h * scale;
    const offX = (rect.width - drawnW) / 2;    // <= 0 (overflow cropped)
    const offY = (rect.height - drawnH) / 2;
    return { rect, intr, scale, offX, offY };
  }

  // is a client point inside the element's displayed box?
  function _inRect(rect, clientX, clientY) {
    return clientX >= rect.left && clientX < rect.right &&
           clientY >= rect.top  && clientY < rect.bottom;
  }

  /* module-private 1x1 scratch canvas: drawImage one source pixel into it,
     then getImageData([0,0,1,1]). Cheaper + simpler than reading a region. */
  let _scratch = null, _scratchCtx = null;
  function _scratchPixel() {
    if (!_scratch) {
      _scratch = document.createElement('canvas');
      _scratch.width = _scratch.height = 1;
      _scratchCtx = _scratch.getContext('2d', { willReadFrequently: true });
    }
    return _scratchCtx;
  }

  /* ---- sampleAt: client point -> '#rrggbb' | null ---------------------
     Maps via _coverMap, draws the single covering source pixel into the
     1x1 scratch, reads it back. Returns null when:
       - element/frame not ready
       - point outside the displayed box
       - source pixel maps outside intrinsic bounds (defensive)
       - canvas is tainted (cross-origin) -> getImageData throws SecurityError */
  function sampleAt(sourceEl, clientX, clientY) {
    const m = _coverMap(sourceEl);
    if (!m) return null;
    if (!_inRect(m.rect, clientX, clientY)) return null;

    const sx = (clientX - m.rect.left - m.offX) / m.scale;
    const sy = (clientY - m.rect.top  - m.offY) / m.scale;
    // clamp into the last valid texel; guards float drift at the very edge.
    const px = Math.min(m.intr.w - 1, Math.max(0, Math.floor(sx)));
    const py = Math.min(m.intr.h - 1, Math.max(0, Math.floor(sy)));

    const ctx = _scratchPixel();
    try {
      ctx.clearRect(0, 0, 1, 1);
      // draw exactly one source texel into the 1x1 scratch
      ctx.drawImage(sourceEl, px, py, 1, 1, 0, 0, 1, 1);
      const d = ctx.getImageData(0, 0, 1, 1).data;
      return color.rgbToHex(d[0] / 255, d[1] / 255, d[2] / 255);
    } catch (e) {
      return null;   // tainted canvas (cross-origin source) or draw failure
    }
  }

  /* ---- createEyedropper -----------------------------------------------
     Floating swatch cursor that follows the pointer over ANY of the given
     sources, fills with the live colour under the pointer, and on click
     fires onPick(hex) then stops. Esc cancels (stop without pick). The
     swatch has a CONTRASTING outline (dark ring on light colours, light
     ring on dark) so it reads against the colour it is showing.

     opts: { sources:[el,...], onPick(hex), visibility:'outline' }
       visibility is accepted per the frozen interface; 'outline' is the
       only mode and is always applied. */
  function createEyedropper(opts) {
    opts = opts || {};
    const sources = (opts.sources || []).filter(Boolean);
    const onPick = typeof opts.onPick === 'function' ? opts.onPick : function () {};

    let active = false;
    let el = null;             // the floating swatch DOM node (created on start)
    let lastHex = null;        // most recent valid colour under the pointer

    const SIZE = 28;           // swatch diameter (px)

    function _makeEl() {
      const d = document.createElement('div');
      const s = d.style;
      s.position = 'fixed';
      s.zIndex = '2147483647';   // above everything
      s.width = s.height = SIZE + 'px';
      s.borderRadius = '50%';
      s.pointerEvents = 'none'; // never eat the click we are tracking
      s.left = s.top = '-9999px';
      s.transform = 'translate(-50%, -50%)';
      s.boxSizing = 'border-box';
      s.transition = 'none';
      return d;
    }

    // luminance of a hex (sRGB-weighted) -> pick a ring that contrasts it
    function _ringFor(hex) {
      const c = BYO.color.hexToRgb(hex);
      const lum = 0.2126 * c.r + 0.7152 * c.g + 0.0722 * c.b;
      // dark ring (with a faint light halo) on light colours, and vice-versa
      return lum > 0.55
        ? '0 0 0 2px #000, 0 0 0 4px rgba(255,255,255,.55)'
        : '0 0 0 2px #fff, 0 0 0 4px rgba(0,0,0,.55)';
    }

    // top-most source under the point (later sources in the array win, so
    // pass them back-to-front; we walk from the end for that priority).
    function _hexUnder(clientX, clientY) {
      for (let i = sources.length - 1; i >= 0; i--) {
        const hex = sampleAt(sources[i], clientX, clientY);
        if (hex != null) return hex;
      }
      return null;
    }

    function _onMove(e) {
      if (!active) return;
      el.style.left = e.clientX + 'px';
      el.style.top = e.clientY + 'px';
      const hex = _hexUnder(e.clientX, e.clientY);
      if (hex != null) {
        lastHex = hex;
        el.style.background = hex;
        el.style.boxShadow = _ringFor(hex);
        el.style.opacity = '1';
      } else {
        // off all sources: dim the swatch, no colour to report
        el.style.opacity = '0.25';
      }
    }

    function _onClick(e) {
      if (!active) return;
      // capture phase: pick the colour at the click point, swallow the click
      e.preventDefault();
      e.stopPropagation();
      const hex = _hexUnder(e.clientX, e.clientY) || lastHex;
      stop();
      if (hex != null) onPick(hex);
    }

    function _onKey(e) {
      if (active && e.key === 'Escape') { e.preventDefault(); stop(); }
    }

    function start() {
      if (active) return;
      active = true;
      el = _makeEl();
      document.body.appendChild(el);
      // capture phase so we intercept the click before the source's own
      // handlers; passive:false so preventDefault on click works.
      window.addEventListener('pointermove', _onMove, true);
      window.addEventListener('click', _onClick, true);
      window.addEventListener('keydown', _onKey, true);
    }

    function stop() {
      if (!active) return;
      active = false;
      window.removeEventListener('pointermove', _onMove, true);
      window.removeEventListener('click', _onClick, true);
      window.removeEventListener('keydown', _onKey, true);
      if (el && el.parentNode) el.parentNode.removeChild(el);
      el = null;
    }

    return {
      start, stop,
      get active() { return active; }
    };
  }

  /* ---- createSampleWindow ---------------------------------------------
     A canvas that, every requestAnimationFrame, mirrors a FIXED screen
     rect of the source. "Fixed" means the rect is in viewport (client)
     coords, so as the page scrolls the mirror keeps showing whatever
     source content currently sits under that screen region (it does NOT
     scroll with the document). The returned canvas is plain 2D; hand it to
     a THREE.CanvasTexture (set needsUpdate per frame) or use as a CSS
     background-image via toDataURL / element ref.

     opts: { source: el, rect: {x,y,width,height} }   // x,y in client coords
     The canvas backing-store matches the rect size (1:1 device px for a
     crisp mirror); CSS size is left to the caller. */
  function createSampleWindow(opts) {
    opts = opts || {};
    const source = opts.source;
    let rect = Object.assign({ x: 0, y: 0, width: 1, height: 1 }, opts.rect || {});

    const canvas = document.createElement('canvas');
    const ctx = canvas.getContext('2d', { willReadFrequently: false });
    _applySize();

    let raf = 0, disposed = false;

    function _applySize() {
      const w = Math.max(1, Math.round(rect.width));
      const h = Math.max(1, Math.round(rect.height));
      if (canvas.width !== w) canvas.width = w;
      if (canvas.height !== h) canvas.height = h;
    }

    /* one frame: figure out which part of the source's cover-mapped image
       falls under the fixed screen rect, and blit just that part stretched
       to fill the mirror canvas. Clears (transparent) where the rect lies
       outside the source's displayed box. */
    function _draw() {
      const m = _coverMap(source);
      ctx.clearRect(0, 0, canvas.width, canvas.height);
      // guard scale > 0: if the source box collapsed (reflow/hidden) after
      // _coverMap, dividing by a zero/negative scale yields Infinity and
      // corrupts the blit. Skip drawing this frame but keep the rAF alive.
      if (m && m.scale > 0) {
        // screen rect -> source-pixel rect via the inverse cover transform
        const sx0 = (rect.x - m.rect.left - m.offX) / m.scale;
        const sy0 = (rect.y - m.rect.top  - m.offY) / m.scale;
        const sw = rect.width / m.scale;
        const sh = rect.height / m.scale;
        // draw the source sub-rect across the whole mirror canvas. The
        // browser clamps source coords to the image, so a rect partly off
        // the source simply mirrors the in-bounds part (good enough; the
        // overflow shows edge-stretched pixels, never throws).
        try {
          ctx.drawImage(source, sx0, sy0, sw, sh, 0, 0, canvas.width, canvas.height);
        } catch (e) { /* frame not ready / transient draw error: skip */ }
      }
      if (!disposed) raf = requestAnimationFrame(_draw);
    }

    raf = requestAnimationFrame(_draw);

    function setRect(r) {
      rect = Object.assign({}, rect, r || {});
      _applySize();
    }
    function dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
    }

    return { canvas, setRect, dispose };
  }

  BYO.ColorSampler = {
    sampleAt,
    createEyedropper,
    createSampleWindow
  };
})();
