/* ===================================================================
   webgl-demo.js — the ALL-WEBGL text demo (visual comparison piece).

   The DOM demo paints text with HTML/CSS; this one keeps EVERYTHING in
   the WebGL pipeline: text is drawn to a single 2D canvas (BYO display
   style) which is the one source of truth, then:
     - shown flat on the page (the "before"), and
     - warped onto the mouse-driven cube via BYO.WarpBox (the "after"),
       which uploads that same canvas as a CanvasTexture each frame.

   Colour comes from the shared studio media (video / image) through
   BYO.ColorSampler:
     - Eyedropper  (sampleAt)          -> recolour the text (solid fill)
     - Sample window (createSampleWindow) -> live media patch used as the
       glyph FILL (drawImage clipped to the glyph shapes each frame).

   Deliberately simpler than the DOM demo: no word cycling, no dat.gui,
   one editable line of text. Its job is to contrast the unified-WebGL
   approach against the DOM one.

   Classic script. Globals: THREE, window.BYO (color / Stage / Motion /
   Gizmo / WarpSurface / WarpBox / ColorSampler). No ES modules.
   =================================================================== */
(function () {
  'use strict';

  const BYO = window.BYO;

  /* ---- DOM handles --------------------------------------------------- */
  const textCanvas = document.getElementById('textCanvas');   // flat BYO text (shown)
  const stageHost  = document.getElementById('stageHost');    // WarpBox overlay host
  const video      = document.getElementById('media');        // sample.mp4/webm
  const image      = document.getElementById('mediaImg');     // texture.png
  const textInput  = document.getElementById('textInput');
  const btnWarp    = document.getElementById('btnWarp');
  const btnEyedrop = document.getElementById('btnEyedrop');
  const btnSampleWin = document.getElementById('btnSampleWin');
  const btnSolid   = document.getElementById('btnSolid');
  const playBtn    = document.getElementById('playBtn');
  const srcRadios  = Array.from(document.querySelectorAll('input[name="src"]'));
  const status     = document.getElementById('status');

  /* ---- text-canvas state (the single source of truth) ---------------- */
  // 2D context obtained in init() (not at module load) so this script is safe
  // to evaluate before #textCanvas is guaranteed parsed.
  let ctx = null;
  const state = {
    text: 'CLIMATE ACTION',
    fill: '#E5233D',          // solid colour fill (eyedropper target)
    fillMode: 'solid',        // 'solid' | 'sample'
    sampleWin: null           // {canvas,setRect,dispose} when fillMode === 'sample'
  };

  /* current sampling source element (video or image), driven by radios */
  function currentSource() {
    const sel = srcRadios.find(r => r.checked);
    return (sel && sel.value === 'image') ? image : video;
  }

  /* draw the BYO-style text onto textCanvas. The fill is either a solid
     colour or a live media patch clipped to the glyph shapes. Returns
     the rendered glyph bounding box (client coords) so the sample window
     can be aimed at the same screen region the glyphs occupy. */
  function drawText() {
    const W = textCanvas.width, H = textCanvas.height;
    ctx.clearRect(0, 0, W, H);
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'center';

    // fit a single line: shrink font until it fits with margins
    const margin = W * 0.06;
    const avail = W - margin * 2;
    let px = Math.round(H * 0.42);
    const setFont = p => { ctx.font = `800 ${p}px Inter, Arial, sans-serif`; };
    setFont(px);
    let w = ctx.measureText(state.text).width || 1;
    if (w > avail) { px = Math.floor(px * avail / w); setFont(px); }

    const cx = W / 2, cy = H / 2;

    if (state.fillMode === 'sample' && state.sampleWin) {
      // live media patch clipped to the glyph shapes: clip to text, then
      // stretch the mirror canvas over the whole text canvas.
      ctx.save();
      ctx.beginPath();
      // build glyph path via clip: draw text into the clip region
      ctx.fillStyle = '#000';
      ctx.fillText(state.text, cx, cy);          // (paints; overwritten by clip blit)
      ctx.globalCompositeOperation = 'source-in';
      try {
        ctx.drawImage(state.sampleWin.canvas, 0, 0, W, H);
      } catch (e) { /* mirror not ready: leave the solid text */ }
      ctx.globalCompositeOperation = 'source-over';
      ctx.restore();
    } else {
      ctx.fillStyle = state.fill;
      ctx.fillText(state.text, cx, cy);
    }
  }

  /* size the text canvas backing store to its displayed box (crisp) */
  function sizeTextCanvas() {
    const r = textCanvas.getBoundingClientRect();
    const dpr = Math.min(devicePixelRatio || 1, 2);
    const w = Math.max(1, Math.round(r.width * dpr));
    const h = Math.max(1, Math.round(r.height * dpr));
    if (textCanvas.width !== w || textCanvas.height !== h) {
      textCanvas.width = w;
      textCanvas.height = h;
    }
    drawText();
  }

  /* ---- WarpBox (created lazily on first Warp) ------------------------- */
  let warp = null;
  let warping = false;

  function ensureWarp() {
    if (warp) return warp;
    warp = new BYO.WarpBox(stageHost, { projection: 0.5, facingCut: 0.15 });
    warp.setSourceCanvas(textCanvas);   // the same single text canvas
    return warp;
  }

  function setWarping(on) {
    warping = on;
    ensureWarp();
    if (on) {
      stageHost.classList.add('active');
      textCanvas.classList.add('hidden');
      warp.setVisible(true);
      warp.start();
      btnWarp.textContent = 'Stop warp';
      setStatus('Warping — move the mouse to spin, hover to stop, drag the gizmo to pose.');
    } else {
      warp.stop();
      warp.setVisible(false);
      stageHost.classList.remove('active');
      textCanvas.classList.remove('hidden');
      btnWarp.textContent = 'Warp';
      setStatus('Flat text. The same canvas feeds the warp.');
    }
  }

  /* ---- colour sampling ----------------------------------------------- */
  let eyedropper = null;

  function startEyedropper() {
    if (eyedropper && eyedropper.active) { eyedropper.stop(); return; }
    eyedropper = BYO.ColorSampler.createEyedropper({
      sources: [currentSource()],
      visibility: 'outline',
      onPick: (hex) => {
        state.fill = hex;
        state.fillMode = 'solid';
        teardownSampleWin();
        drawText();
        setStatus('Picked ' + hex + ' — text recoloured (solid fill).');
      }
    });
    eyedropper.start();
    setStatus('Eyedropper active — click a colour on the media, Esc to cancel.');
  }

  /* createSampleWindow -> use the live mirror canvas as the glyph fill.
     We aim the fixed screen rect at the source element's displayed box so
     the patch is representative media content. */
  function useSampleWindowFill() {
    teardownSampleWin();
    const src = currentSource();
    const r = src.getBoundingClientRect();
    state.sampleWin = BYO.ColorSampler.createSampleWindow({
      source: src,
      rect: { x: r.left, y: r.top, width: r.width, height: r.height }
    });
    state.fillMode = 'sample';
    // keep the sample rect glued to the source as it moves/resizes
    refitSampleWin();
    setStatus('Sample-window fill — live media clipped to the glyphs.');
  }

  function refitSampleWin() {
    if (state.fillMode !== 'sample' || !state.sampleWin) return;
    const r = currentSource().getBoundingClientRect();
    state.sampleWin.setRect({ x: r.left, y: r.top, width: r.width, height: r.height });
  }

  function teardownSampleWin() {
    if (state.sampleWin) { state.sampleWin.dispose(); state.sampleWin = null; }
  }

  function useSolidFill() {
    teardownSampleWin();
    state.fillMode = 'solid';
    drawText();
    setStatus('Solid fill (' + state.fill + ').');
  }

  function setStatus(msg) { if (status) status.textContent = msg; }

  /* ---- rAF: keep the text canvas live ------------------------------- */
  // When the fill is a live sample window (or the source is animated video),
  // the text canvas must be re-rendered each frame; WarpBox already flags
  // the CanvasTexture needsUpdate every frame, so the warp tracks it.
  function tick() {
    requestAnimationFrame(tick);
    // only a sample-window fill changes the text canvas each frame; the
    // mirror canvas is repainted by ColorSampler on its own rAF, so we just
    // re-blit it through the glyph clip. Solid fill is static (no redraw).
    if (state.fillMode === 'sample' && state.sampleWin) {
      refitSampleWin();
      drawText();
    }
  }

  /* ---- video autoplay with mobile fallback --------------------------- */
  function tryPlay() {
    const p = video.play();
    if (p && typeof p.then === 'function') {
      p.then(() => { playBtn.style.display = 'none'; })
       .catch(() => { playBtn.style.display = ''; });   // iOS/Android: needs a tap
    }
  }

  /* ---- wiring -------------------------------------------------------- */
  function init() {
    ctx = textCanvas.getContext('2d');   // canvas guaranteed parsed by now
    sizeTextCanvas();
    addEventListener('resize', () => { sizeTextCanvas(); refitSampleWin(); });
    addEventListener('scroll', refitSampleWin, true);

    textInput.value = state.text;
    textInput.addEventListener('input', () => {
      state.text = (textInput.value || '').toUpperCase() || ' ';
      drawText();
    });

    btnWarp.addEventListener('click', () => setWarping(!warping));
    btnEyedrop.addEventListener('click', startEyedropper);
    btnSampleWin.addEventListener('click', useSampleWindowFill);
    btnSolid.addEventListener('click', useSolidFill);

    srcRadios.forEach(r => r.addEventListener('change', () => {
      // re-aim any active sample window / eyedropper at the new source
      if (state.fillMode === 'sample') useSampleWindowFill();
      if (eyedropper && eyedropper.active) { eyedropper.stop(); startEyedropper(); }
    }));

    playBtn.addEventListener('click', () => { tryPlay(); });
    video.addEventListener('playing', () => { playBtn.style.display = 'none'; });

    tryPlay();
    tick();
    setStatus('Flat text. Pick a colour or warp it onto the cube.');
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
