/* ===================================================================
   BYO.TextureWindow — media viewer with an interactive sample window.

   Dev-panel content (throwaway scaffolding, not site chrome). Shows a
   source (HTMLVideoElement | HTMLImageElement) fit into the panel body,
   and overlays a draggable + resizable rectangle: the "sample window".

   Each requestAnimationFrame it mirrors the source region currently under
   the rect into `instance.sampleCanvas` — a live <canvas> at ~256px
   working resolution that the text-component can hand to
   `background-clip:text` (via the canvas) or wrap in a THREE.CanvasTexture.

   Two modes (instance.setMode):
     'fixed'    — the rect is stored RELATIVE to the displayed media frame
                  (a fraction of the media box). It tracks the media: it
                  always samples the same part of the asset regardless of
                  where the panel sits or how the page scrolls. (default)
     'floating' — the rect is fixed in SCREEN (client) space over the
                  scrolling page; it samples whatever source content
                  currently scrolls under that screen region.

   The actual per-frame cover-mapped mirror is done by reusing
   BYO.ColorSampler.createSampleWindow (the shared mirror engine): we feed
   it the CLIENT-space rect each frame and copy its output, downscaled, into
   our fixed ~256 working canvas. We only own the overlay UI + mode math.

   Classic-script IIFE on window.BYO — no ES modules.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  const Sampler = BYO.ColorSampler;
  if (!Sampler) throw new Error('TextureWindow requires BYO.ColorSampler (studio/lib/color-sampler.js) loaded first');

  const WORK = 256;          // working resolution of sampleCanvas (longest edge)
  const MIN_RECT = 24;       // smallest rect side in CSS px (keeps it grabbable)
  const HANDLE = 12;         // resize-handle hit size in CSS px

  /* clamp helper */
  function clamp(v, lo, hi) { return v < lo ? lo : v > hi ? hi : v; }

  function create(panelBody, opts) {
    opts = opts || {};
    let source = opts.source || null;
    let mode = (opts.mode === 'floating') ? 'floating' : 'fixed';

    /* ---- DOM: viewer holds the media (cover-fit) + the rect overlay ----
       The viewer is position:relative so the absolutely-positioned media
       and rect lay over each other. It fills the available panel width and
       gets a fixed aspect height so the media always has a box to cover. */
    const viewer = document.createElement('div');
    {
      const s = viewer.style;
      s.position = 'relative';
      s.width = '100%';
      s.aspectRatio = '16 / 9';
      s.overflow = 'hidden';
      s.background = '#111';
      s.userSelect = 'none';
      s.touchAction = 'none';
      s.borderRadius = '3px';
    }

    // the media is moved INTO the viewer (so the panel shows it). We do not
    // create it — the caller owns the source element lifecycle.
    function _mountMedia(el) {
      if (!el) return;
      const s = el.style;
      s.position = 'absolute';
      s.left = '0'; s.top = '0';
      s.width = '100%'; s.height = '100%';
      s.objectFit = 'cover';
      s.display = 'block';
      s.pointerEvents = 'none';   // clicks belong to the rect overlay
      viewer.appendChild(el);
    }

    // the draggable / resizable rectangle overlay (the sample window)
    const rectEl = document.createElement('div');
    {
      const s = rectEl.style;
      s.position = 'absolute';
      s.boxSizing = 'border-box';
      s.border = '1.5px solid #fff';
      s.boxShadow = '0 0 0 1.5px rgba(0,0,0,.55), 0 0 0 9999px rgba(0,0,0,.28)';
      s.cursor = 'move';
      s.touchAction = 'none';
    }
    // bottom-right resize handle
    const handleEl = document.createElement('div');
    {
      const s = handleEl.style;
      s.position = 'absolute';
      s.right = '-1.5px'; s.bottom = '-1.5px';
      s.width = HANDLE + 'px'; s.height = HANDLE + 'px';
      s.background = '#fff';
      s.boxShadow = '0 0 0 1px rgba(0,0,0,.55)';
      s.cursor = 'nwse-resize';
      s.touchAction = 'none';
    }
    rectEl.appendChild(handleEl);

    // a small mode toggle (utilitarian — dev scaffolding)
    const modeBtn = document.createElement('button');
    {
      const s = modeBtn.style;
      s.position = 'absolute';
      s.left = '4px'; s.top = '4px';
      s.font = '11px system-ui, sans-serif';
      s.padding = '2px 6px';
      s.border = '0';
      s.borderRadius = '3px';
      s.background = 'rgba(255,255,255,.9)';
      s.color = '#111';
      s.cursor = 'pointer';
      s.zIndex = '2';
    }
    modeBtn.type = 'button';

    viewer.appendChild(rectEl);
    viewer.appendChild(modeBtn);
    panelBody.appendChild(viewer);

    if (source) _mountMedia(source);

    /* ---- rect geometry --------------------------------------------------
       We keep the canonical rect as a FRACTION of the media frame
       (fx,fy,fw,fh in [0,1]) in fixed mode. In floating mode the canonical
       rect is in CLIENT (viewport) px (cx,cy,cw,ch). Whatever mode, we
       resolve to the viewer-local pixel box each frame to position the
       overlay, and to a client-px box to feed the mirror engine. */
    let frac = { x: 0.3, y: 0.3, w: 0.4, h: 0.4 };  // fixed-mode store
    let clientRect = null;                          // floating-mode store {x,y,width,height}

    // viewer box in client coords this frame
    function _viewerBox() { return viewer.getBoundingClientRect(); }

    // resolve the overlay's viewer-local pixel box {x,y,w,h} for current mode
    function _localBox() {
      const vb = _viewerBox();
      if (mode === 'floating' && clientRect) {
        return {
          x: clientRect.x - vb.left,
          y: clientRect.y - vb.top,
          w: clientRect.width,
          h: clientRect.height
        };
      }
      return {
        x: frac.x * vb.width,
        y: frac.y * vb.height,
        w: frac.w * vb.width,
        h: frac.h * vb.height
      };
    }

    // client-space rect that the mirror engine reads (same in both modes,
    // derived from the overlay's current on-screen position)
    function _clientRect() {
      const vb = _viewerBox();
      const lb = _localBox();
      return { x: vb.left + lb.x, y: vb.top + lb.y, width: lb.w, height: lb.h };
    }

    // write a viewer-local pixel box back into the canonical store
    function _setLocalBox(lb) {
      const vb = _viewerBox();
      const w = Math.max(MIN_RECT, lb.w);
      const h = Math.max(MIN_RECT, lb.h);
      const x = clamp(lb.x, 0, Math.max(0, vb.width - w));
      const y = clamp(lb.y, 0, Math.max(0, vb.height - h));
      if (mode === 'floating') {
        clientRect = { x: vb.left + x, y: vb.top + y, width: w, height: h };
      } else {
        frac = {
          x: vb.width ? x / vb.width : 0,
          y: vb.height ? y / vb.height : 0,
          w: vb.width ? w / vb.width : 1,
          h: vb.height ? h / vb.height : 1
        };
      }
    }

    // paint the overlay element to match the current box
    function _positionOverlay() {
      const lb = _localBox();
      rectEl.style.left = lb.x + 'px';
      rectEl.style.top = lb.y + 'px';
      rectEl.style.width = lb.w + 'px';
      rectEl.style.height = lb.h + 'px';
    }

    /* ---- the working sample canvas (~256 longest edge) ------------------ */
    const sampleCanvas = document.createElement('canvas');
    sampleCanvas.width = WORK;
    sampleCanvas.height = WORK;
    const sampleCtx = sampleCanvas.getContext('2d', { willReadFrequently: false });

    // size sampleCanvas backing-store to match the rect aspect (longest edge
    // = WORK) so the mask the text-component derives stays proportional.
    function _sizeSampleToAspect(w, h) {
      if (!(w > 0 && h > 0)) return;
      let cw, ch;
      if (w >= h) { cw = WORK; ch = Math.max(1, Math.round(WORK * h / w)); }
      else { ch = WORK; cw = Math.max(1, Math.round(WORK * w / h)); }
      if (sampleCanvas.width !== cw) sampleCanvas.width = cw;
      if (sampleCanvas.height !== ch) sampleCanvas.height = ch;
    }

    /* ---- mirror engine (reused) -----------------------------------------
       BYO.ColorSampler.createSampleWindow mirrors a fixed CLIENT rect of the
       source into its own canvas every rAF. We re-point that rect each frame
       (so it follows our overlay) and copy its result into sampleCanvas. */
    let mirror = source ? Sampler.createSampleWindow({ source, rect: _clientRect() }) : null;

    /* ---- onUpdate subscribers ------------------------------------------ */
    const subs = [];
    function onUpdate(cb) {
      if (typeof cb === 'function' && subs.indexOf(cb) === -1) subs.push(cb);
      return function off() { const i = subs.indexOf(cb); if (i !== -1) subs.splice(i, 1); };
    }
    function _emit() { for (let i = 0; i < subs.length; i++) { try { subs[i](sampleCanvas); } catch (e) {} } }

    /* ---- per-frame loop -------------------------------------------------
       1. keep the overlay glued to its box (handles resize/scroll/mode),
       2. feed the mirror engine the current client rect,
       3. copy the mirror's canvas into our working canvas,
       4. notify subscribers. */
    let raf = 0, disposed = false;
    function _tick() {
      if (disposed) return;
      _positionOverlay();
      const cr = _clientRect();
      if (mirror) {
        mirror.setRect(cr);
        _sizeSampleToAspect(cr.width, cr.height);
        // mirror.canvas was drawn this/last frame at cr.width x cr.height;
        // downscale-copy into our fixed working canvas.
        try {
          sampleCtx.clearRect(0, 0, sampleCanvas.width, sampleCanvas.height);
          if (mirror.canvas.width > 0 && mirror.canvas.height > 0) {
            sampleCtx.drawImage(mirror.canvas, 0, 0, sampleCanvas.width, sampleCanvas.height);
          }
        } catch (e) { /* transient */ }
      }
      _emit();
      raf = requestAnimationFrame(_tick);
    }
    raf = requestAnimationFrame(_tick);

    /* ---- pointer interaction: drag body / resize from handle ------------ */
    let drag = null;   // { mode:'move'|'resize', startX, startY, box }

    function _onDown(e, kind) {
      e.preventDefault();
      e.stopPropagation();
      const lb = _localBox();
      drag = {
        kind,
        startX: e.clientX,
        startY: e.clientY,
        box: { x: lb.x, y: lb.y, w: lb.w, h: lb.h }
      };
      try { e.target.setPointerCapture(e.pointerId); } catch (_) {}
      window.addEventListener('pointermove', _onMove, true);
      window.addEventListener('pointerup', _onUp, true);
    }
    function _onMove(e) {
      if (!drag) return;
      const dx = e.clientX - drag.startX;
      const dy = e.clientY - drag.startY;
      const b = drag.box;
      if (drag.kind === 'resize') {
        _setLocalBox({ x: b.x, y: b.y, w: b.w + dx, h: b.h + dy });
      } else {
        _setLocalBox({ x: b.x + dx, y: b.y + dy, w: b.w, h: b.h });
      }
      _positionOverlay();
    }
    function _onUp() {
      drag = null;
      window.removeEventListener('pointermove', _onMove, true);
      window.removeEventListener('pointerup', _onUp, true);
    }

    const _downBody = function (e) { if (e.target === handleEl) return; _onDown(e, 'move'); };
    const _downHandle = function (e) { _onDown(e, 'resize'); };
    rectEl.addEventListener('pointerdown', _downBody, true);
    handleEl.addEventListener('pointerdown', _downHandle, true);

    /* ---- mode -----------------------------------------------------------
       Switching mode preserves the on-screen position: we snapshot the
       current overlay box, flip the mode, then write the same box back into
       the new mode's canonical store. */
    function _refreshModeBtn() { modeBtn.textContent = mode === 'fixed' ? 'fixed' : 'floating'; }
    function setMode(m) {
      m = (m === 'floating') ? 'floating' : 'fixed';
      if (m === mode) { _refreshModeBtn(); return; }
      const lb = _localBox();     // snapshot in old mode
      mode = m;
      _setLocalBox(lb);           // re-store under new mode
      _refreshModeBtn();
      _positionOverlay();
    }
    modeBtn.addEventListener('click', function (e) {
      e.preventDefault(); e.stopPropagation();
      setMode(mode === 'fixed' ? 'floating' : 'fixed');
    });
    _refreshModeBtn();

    /* ---- source swap ---------------------------------------------------- */
    function setSource(el) {
      if (el === source) return;
      // detach old media element from the viewer (caller keeps ownership)
      if (source && source.parentNode === viewer) viewer.removeChild(source);
      source = el || null;
      if (mirror) { mirror.dispose(); mirror = null; }
      if (source) {
        _mountMedia(source);
        viewer.appendChild(rectEl);   // keep overlay above the freshly added media
        viewer.appendChild(modeBtn);
        mirror = Sampler.createSampleWindow({ source, rect: _clientRect() });
      }
    }

    /* ---- public rect accessor ------------------------------------------
       Returns the canonical rect plus the resolved client box, so callers
       can persist/restore it. */
    function getRect() {
      const cr = _clientRect();
      return {
        mode,
        frac: { x: frac.x, y: frac.y, w: frac.w, h: frac.h },
        client: { x: cr.x, y: cr.y, width: cr.width, height: cr.height }
      };
    }
    function setRect(r) {
      if (!r) return;
      if (r.mode) setMode(r.mode);
      if (mode === 'floating' && r.client) {
        clientRect = { x: r.client.x, y: r.client.y, width: r.client.width, height: r.client.height };
      } else if (r.frac) {
        frac = { x: r.frac.x, y: r.frac.y, w: r.frac.w, h: r.frac.h };
      }
      _positionOverlay();
    }

    /* ---- teardown ------------------------------------------------------- */
    function dispose() {
      disposed = true;
      if (raf) cancelAnimationFrame(raf);
      raf = 0;
      if (mirror) { mirror.dispose(); mirror = null; }
      rectEl.removeEventListener('pointerdown', _downBody, true);
      handleEl.removeEventListener('pointerdown', _downHandle, true);
      window.removeEventListener('pointermove', _onMove, true);
      window.removeEventListener('pointerup', _onUp, true);
      subs.length = 0;
      if (source && source.parentNode === viewer) viewer.removeChild(source);
      if (viewer.parentNode) viewer.parentNode.removeChild(viewer);
    }

    _positionOverlay();

    return {
      el: viewer,
      sampleCanvas,
      get mode() { return mode; },
      setMode,
      getRect,
      setRect,
      setSource,
      onUpdate,
      dispose
    };
  }

  BYO.TextureWindow = { create };
})();
