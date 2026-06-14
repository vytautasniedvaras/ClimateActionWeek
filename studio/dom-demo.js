/* ===================================================================
   dom-demo.js — DOM RICH-TEXT studio demo.

   Real, selectable HTML text in 2+ stacked editable boxes. Every word is
   wrapped in <span class="word"> so it can be individually coloured and
   individually filled. A persistent media panel holds the sampling sources
   (<video> + <img>). Three toolbar actions, all driven by the FROZEN shared
   modules in studio/lib/:

     1. Warp this box  -> rasterize the selected box (words + their colours)
                          onto a 2D canvas and feed it to a BYO.WarpBox so the
                          cube WARPS that text; the gizmo transforms it.
     2. Eyedropper     -> BYO.ColorSampler.createEyedropper over [video,img];
                          click sets the SELECTED word span's colour.
     3. Texture fill   -> BYO.ColorSampler.createSampleWindow over the video;
                          the selected word is filled with the moving video via
                          a CSS-masked live canvas overlay (outline when empty).

   Classic script. Globals: THREE, window.BYO (color/Stage/Motion/Gizmo/
   WarpSurface/ColorSampler/WarpBox). No ES modules.
   =================================================================== */
(function () {
  'use strict';

  const BYO = window.BYO;

  /* ---- element handles ---- */
  const editor      = document.getElementById('editor');
  const video       = document.getElementById('srcVideo');
  const img         = document.getElementById('srcImg');
  const playBtn     = document.getElementById('playBtn');
  const status      = document.getElementById('status');
  const warpHost    = document.getElementById('warpHost');

  const btnWarp     = document.getElementById('btnWarp');
  const btnEye      = document.getElementById('btnEye');
  const btnTexture  = document.getElementById('btnTexture');
  const btnClearWarp= document.getElementById('btnClearWarp');

  function say(msg) { if (status) status.textContent = msg; }

  /* =================================================================
     SELECTION TRACKING
     The "selected box" is the contenteditable .box the caret is in.
     The "selected word" is the <span class="word"> the caret/selection
     sits inside. We keep the last known values so a toolbar-button click
     (which moves focus out of the editable) still acts on them.
     ================================================================= */
  let selectedBox = null;
  let selectedWord = null;

  function markSelectedBox(box) {
    if (selectedBox === box) return;
    if (selectedBox) selectedBox.classList.remove('box--selected');
    selectedBox = box;
    if (selectedBox) selectedBox.classList.add('box--selected');
  }
  function markSelectedWord(word) {
    if (selectedWord === word) return;
    if (selectedWord) selectedWord.classList.remove('word--selected');
    selectedWord = word;
    if (selectedWord) selectedWord.classList.add('word--selected');
  }

  // walk up from a node to the nearest .word span / .box element
  function closest(node, cls) {
    while (node && node !== editor) {
      if (node.nodeType === 1 && node.classList && node.classList.contains(cls)) return node;
      node = node.parentNode;
    }
    return null;
  }

  function refreshSelectionFromCaret() {
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return;
    let node = sel.anchorNode;
    if (node && node.nodeType === 3) node = node.parentNode;     // text node -> element
    const box = closest(node, 'box');
    const word = closest(node, 'word');
    if (box) markSelectedBox(box);
    if (word) markSelectedWord(word);
  }

  document.addEventListener('selectionchange', refreshSelectionFromCaret);
  editor.addEventListener('click', refreshSelectionFromCaret);
  editor.addEventListener('keyup', () => { reWrapWords(selectedBox); refreshSelectionFromCaret(); });

  /* =================================================================
     PER-WORD WRAPPING
     Each .box holds .line rows; every whitespace-separated token in a line
     is wrapped in <span class="word">. As the user types we re-wrap the
     line being edited so new words also become individually styleable,
     preserving the caret position by character offset.
     ================================================================= */
  function wrapLine(line) {
    // capture caret offset within this line (so typing is not disrupted)
    const sel = window.getSelection();
    let caretOffset = -1;
    if (sel && sel.rangeCount && line.contains(sel.anchorNode)) {
      caretOffset = textOffsetWithin(line, sel.anchorNode, sel.anchorOffset);
    }

    const text = line.textContent;
    // preserve existing per-word colours by token index where possible. We
    // carry the EXACT hex (data-color, set by the eyedropper) when present so
    // re-wrapping never loses precision; otherwise fall back to inline color.
    const prevColors = [];
    line.querySelectorAll('.word').forEach(w => prevColors.push(w.dataset.color || w.style.color || ''));

    const tokens = text.split(/(\s+)/);   // keep the whitespace tokens
    let html = '';
    let wordIdx = 0;
    for (const tok of tokens) {
      if (tok.length === 0) continue;
      if (/^\s+$/.test(tok)) { html += tok.replace(/ /g, '&nbsp;'); continue; }
      const c = prevColors[wordIdx];
      const col = c ? ` style="color:${c}" data-color="${c}"` : '';
      html += `<span class="word"${col}>${escapeHtml(tok)}</span>`;
      wordIdx++;
    }
    if (html === '') html = '<br>';
    line.innerHTML = html;

    if (caretOffset >= 0) restoreCaretWithin(line, caretOffset);
  }

  function reWrapWords(box) {
    if (!box) return;
    box.querySelectorAll('.line').forEach(wrapLine);
  }

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  // character offset of (node,offset) measured from the start of `root` text
  function textOffsetWithin(root, node, offset) {
    let total = 0;
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n;
    while ((n = walker.nextNode())) {
      if (n === node) return total + offset;
      total += n.textContent.length;
    }
    return total;
  }

  // place the caret at character `offset` from the start of `root`
  function restoreCaretWithin(root, offset) {
    const walker = document.createTreeWalker(root, NodeFilter.SHOW_TEXT, null);
    let n, acc = 0, target = null, targetOff = 0;
    while ((n = walker.nextNode())) {
      const len = n.textContent.length;
      if (acc + len >= offset) { target = n; targetOff = offset - acc; break; }
      acc += len;
    }
    if (!target) return;
    const sel = window.getSelection();
    const range = document.createRange();
    range.setStart(target, Math.min(targetOff, target.textContent.length));
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
  }

  /* =================================================================
     RASTERIZE A BOX -> 2D CANVAS  (for "Warp this box")
     Mirrors the projected-cube TextLayer approach: transparent canvas,
     draw each word at its colour, fit lines to width. Reads the live DOM
     words + their computed colours so what you typed is what gets warped.
     ================================================================= */
  // Normalize a computed CSS colour ('rgb(...)' / 'rgba(...)') to a '#rrggbb'
  // hex. getComputedStyle ALWAYS returns the rgb()/rgba() form even when an
  // inline hex was set, so we round-trip via BYO.color.rgbToHex to keep what
  // gets warped consistent with what the eyedropper stored.
  function cssColorToHex(css) {
    if (!css) return '#111111';
    if (css[0] === '#') return css;                       // already hex
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(css);
    if (!m) return '#111111';
    return BYO.color.rgbToHex(+m[1] / 255, +m[2] / 255, +m[3] / 255);
  }

  function rasterizeBox(box) {
    const aspect = 16 / 9;
    const W = 1024, H = Math.round(W / aspect);
    const cv = document.createElement('canvas');
    cv.width = W; cv.height = H;
    const ctx = cv.getContext('2d');
    ctx.clearRect(0, 0, W, H);                  // transparent: only glyphs show
    ctx.textBaseline = 'middle';
    ctx.textAlign = 'left';

    // collect the lines: array of [ [text,color], ... ]
    const lines = [];
    box.querySelectorAll('.line').forEach(line => {
      const segs = [];
      line.querySelectorAll('.word').forEach(w => {
        const t = w.textContent;
        if (!t.trim()) return;
        // prefer the exact hex stored by the eyedropper (no rgb<->hex loss);
        // otherwise normalize the computed rgb() colour to hex.
        const col = w.dataset.color || cssColorToHex(getComputedStyle(w).color);
        segs.push([t, col]);
      });
      if (segs.length) lines.push(segs);
    });
    if (!lines.length) lines.push([['(empty)', '#999999']]);

    const margin = W * 0.06, avail = W - margin * 2;
    const base = Math.round(H * 0.16);
    const lineH = base * 1.18;
    const setFont = px => { ctx.font = `800 ${px}px Inter, Arial, sans-serif`; };
    const SP = () => ctx.measureText(' ').width;

    let y = (H - lineH * lines.length) / 2 + lineH / 2;
    for (const segs of lines) {
      setFont(base);
      const w = segs.reduce((acc, s) => acc + ctx.measureText(s[0]).width, 0) + SP() * (segs.length - 1);
      const px = w > avail ? Math.floor(base * avail / w) : base;
      setFont(px);
      let x = margin;
      for (const [t, c] of segs) {
        ctx.fillStyle = c;
        ctx.fillText(t, x, y);
        x += ctx.measureText(t).width + ctx.measureText(' ').width;
      }
      y += lineH;
    }
    return cv;
  }

  /* =================================================================
     WARP THIS BOX
     Lazily build ONE WarpBox over a full-viewport overlay host (so the
     cube + gizmo live in screen space, where the gizmo's window-bound
     pointer listeners operate). Re-rasterize the selected box each time
     and on edits, keeping the warped text in sync with what you type.
     ================================================================= */
  let warpBox = null;
  let warpSourceBox = null;       // which .box is currently warped
  let warpCanvas = null;          // the 2D canvas WarpBox samples

  function ensureWarpBox() {
    if (warpBox) return warpBox;
    warpHost.classList.add('warp-host--active');
    warpBox = new BYO.WarpBox(warpHost, {
      projection: 0.45,           // mid projection: clearly 3D yet readable
      facingCut: 0.12,
      renderScale: 1.25
    });
    warpBox.start();
    return warpBox;
  }

  function blitInto(targetCanvas, srcCanvas) {
    // 1:1 blit — callers guarantee identical dimensions (see warpSelectedBox /
    // input handler / syncWarpAfterEdit), so no destination size is given and
    // no stretch can be introduced.
    const ctx = targetCanvas.getContext('2d');
    ctx.clearRect(0, 0, targetCanvas.width, targetCanvas.height);
    ctx.drawImage(srcCanvas, 0, 0);
  }

  function warpSelectedBox() {
    if (!selectedBox) { say('Click into a text box first, then Warp this box.'); return; }
    const wb = ensureWarpBox();
    warpSourceBox = selectedBox;

    // build (or reuse) a stable canvas, then draw the box into it. We keep a
    // persistent canvas so WarpBox's CanvasTexture (needsUpdate each frame)
    // always points at the same backing store; we just repaint it on edits.
    const fresh = rasterizeBox(warpSourceBox);
    if (!warpCanvas || warpCanvas.width !== fresh.width || warpCanvas.height !== fresh.height) {
      warpCanvas = document.createElement('canvas');
      warpCanvas.width = fresh.width; warpCanvas.height = fresh.height;
      blitInto(warpCanvas, fresh);
      wb.setSourceCanvas(warpCanvas);
    } else {
      blitInto(warpCanvas, fresh);
    }
    wb.setVisible(true);
    say('Warping "' + (warpSourceBox.dataset.name || 'box') + '". Hover the cube for the gizmo; drag arrows/arcs/faces to transform.');
  }

  // keep the warped text live as you edit the source box
  editor.addEventListener('input', () => {
    reWrapWords(selectedBox);
    if (warpBox && warpSourceBox && warpCanvas) {
      const fresh = rasterizeBox(warpSourceBox);
      if (fresh.width === warpCanvas.width && fresh.height === warpCanvas.height) {
        blitInto(warpCanvas, fresh);   // CanvasTexture.needsUpdate is flagged in WarpBox loop
      }
    }
  });

  function clearWarp() {
    if (warpBox) { warpBox.setVisible(false); }
    warpHost.classList.remove('warp-host--active');
    say('Warp cleared.');
  }

  /* =================================================================
     EYEDROPPER  -> set the selected word's colour
     ================================================================= */
  let eyedropper = null;

  function startEyedropper() {
    if (!selectedWord) { say('Click a word first, then Eyedropper, then pick a colour from the media.'); return; }
    if (eyedropper && eyedropper.active) { eyedropper.stop(); }
    const target = selectedWord;     // capture: focus leaves the editable on click
    eyedropper = BYO.ColorSampler.createEyedropper({
      sources: [img, video],         // later sources win priority; video on top
      visibility: 'outline',
      onPick: (hex) => {
        target.style.color = hex;
        target.dataset.color = hex;   // exact hex for rasterizeBox (avoid rgb round-trip loss)
        // if this word is currently texture-filled, picking a colour reverts it
        unfillWord(target);
        say('Set "' + target.textContent + '" to ' + hex + '. If it was warped, the cube updates live.');
        syncWarpAfterEdit();
      }
    });
    eyedropper.start();
    say('Eyedropper active: move over the video/image, click to set "' + target.textContent + '". Esc cancels.');
  }

  /* =================================================================
     TEXTURE FILL  -> fill the selected word with the moving video
     The live sample-window canvas (a fixed-screen mirror of the video that
     redraws every rAF) is overlaid exactly over the word. A CSS mask built
     from the word's EXACT text + font (as an inline SVG data URL) clips the
     overlay to the glyph shapes, so the moving video shows only inside the
     letters. The canvas animates; the SVG mask is rebuilt only when the
     word's text/font/size changes. "outline when empty": a word with no
     glyphs gets a dashed-outline placeholder mask instead.
     ================================================================= */
  const fills = new Map();   // word span -> { sampleWin, overlay, stop, sig }

  function unfillWord(word) {
    const f = fills.get(word);
    if (!f) return;
    if (f.stop) f.stop();
    f.sampleWin.dispose();
    if (f.overlay && f.overlay.parentNode) f.overlay.parentNode.removeChild(f.overlay);
    fills.delete(word);
    word.classList.remove('word--filled');
  }

  // inline-SVG text-mask data URL: white glyphs (=show) on transparent (=hide),
  // matched to the word's font + size so the mask lines up over the canvas.
  function textMaskUrl(text, w, h, cs) {
    // Keep the px UNIT on font-size: computed fontSize is e.g. '18.5px'. SVG
    // user units are NOT guaranteed to equal CSS px when the data URL is
    // scaled, so an explicit 'px' keeps the mask glyphs aligned to the canvas.
    const fontSize = (parseFloat(cs.fontSize) || 16) + 'px';
    const fontFamily = (cs.fontFamily || 'sans-serif').replace(/"/g, "'");
    const weight = cs.fontWeight || '800';
    // letter-spacing: preserve the computed value WITH its unit ('0px',
    // '0.92px'...). SVG treats unitless '0' differently from '0px'; never
    // strip the unit. 'normal' -> '0px'.
    const ls = (cs.letterSpacing && cs.letterSpacing !== 'normal') ? cs.letterSpacing : '0px';
    const t = text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
    const svg =
      `<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">` +
      `<text x="0" y="${h * 0.5}" dominant-baseline="central" ` +
      `font-family="${fontFamily}" font-weight="${weight}" font-size="${fontSize}" ` +
      `letter-spacing="${ls}" fill="#fff" xml:space="preserve">${t}</text></svg>`;
    return 'url("data:image/svg+xml;utf8,' + encodeURIComponent(svg) + '")';
  }

  // A sample-window mirrors a FIXED SCREEN region of its source — so the rect
  // must overlap the VIDEO's on-screen box to contain any video pixels (a word
  // elsewhere on the page has no video under it). We sample a sub-rect INSIDE
  // the video element, matching the word's aspect ratio (centred), so the
  // mirrored canvas is a sensible crop of the live video to mask onto the word.
  function videoSampleRect(aspect) {
    const vr = video.getBoundingClientRect();
    if (!vr.width || !vr.height) return { x: 0, y: 0, width: 1, height: 1 };
    let w = vr.width, h = w / aspect;
    if (h > vr.height) { h = vr.height; w = h * aspect; }
    return { x: vr.left + (vr.width - w) / 2, y: vr.top + (vr.height - h) / 2, width: w, height: h };
  }

  function textureFillSelectedWord() {
    if (!selectedWord) { say('Click a word first, then Texture fill.'); return; }
    const word = selectedWord;
    if (fills.has(word)) { unfillWord(word); say('Cleared texture fill.'); syncWarpAfterEdit(); return; }  // toggle off

    const rect = word.getBoundingClientRect();
    if (!rect.width || !rect.height) { say('Nothing to fill there.'); return; }

    // live mirror of a region INSIDE the video (so the canvas holds real video)
    const aspect0 = rect.width / rect.height;
    const sampleWin = BYO.ColorSampler.createSampleWindow({
      source: video, rect: videoSampleRect(aspect0)
    });
    const cnv = sampleWin.canvas;

    // overlay the mirror canvas exactly on the word, masked by the word text.
    // The CSS mask is applied to the CANVAS itself (not the wrapper div): masks
    // on a container do NOT clip child <canvas> elements in all engines (Safari),
    // so the canvas would otherwise paint the full video across the word box.
    const overlay = document.createElement('div');
    overlay.className = 'fill-overlay';
    Object.assign(cnv.style, {
      width: '100%', height: '100%', display: 'block',
      // inherit the same no-repeat / 100% sizing the .fill-overlay CSS uses,
      // but on the canvas where the mask actually clips the glyph shapes.
      webkitMaskRepeat: 'no-repeat', maskRepeat: 'no-repeat',
      webkitMaskPosition: '0 0', maskPosition: '0 0',
      webkitMaskSize: '100% 100%', maskSize: '100% 100%'
    });
    overlay.appendChild(cnv);
    document.body.appendChild(overlay);

    // hide the word's own glyphs (kept selectable/measurable); the masked
    // overlay paints the moving video into the same glyph shapes on top.
    word.classList.add('word--filled');

    let sig = '';   // text|w|h|fontSize|fontFamily signature — rebuild the mask only on change
    let raf = 0;
    const place = () => {
      const r = word.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      // sample inside the video (matched to the word's current aspect), and
      // stretch that live crop across the word's box via the masked canvas
      // below. We size the mirror canvas to the WORD's aspect (see
      // videoSampleRect) so the live crop is not skewed when it fills the box.
      sampleWin.setRect(videoSampleRect(w / h));
      Object.assign(overlay.style, {
        left: r.left + 'px', top: r.top + 'px', width: w + 'px', height: h + 'px'
      });
      const cs = getComputedStyle(word);
      const empty = !word.textContent.trim();
      // hash only the inputs the mask depends on (text, rounded box, rounded
      // font-size, font-family) — NOT the full cs.font shorthand, whose width/
      // stretch descriptors can jitter and rebuild the mask every frame.
      const fontKey = (parseFloat(cs.fontSize) || 0) + '|' + cs.fontFamily + '|' + cs.fontWeight + '|' + cs.letterSpacing;
      const newSig = (empty ? '—empty' : word.textContent) + '|' + w + '|' + h + '|' + fontKey;
      if (newSig !== sig) {
        sig = newSig;
        if (empty) {
          cnv.style.webkitMaskImage = cnv.style.maskImage = 'none';
          overlay.classList.add('fill-overlay--empty');   // dashed outline placeholder
        } else {
          overlay.classList.remove('fill-overlay--empty');
          const url = textMaskUrl(word.textContent, w, h, cs);
          cnv.style.webkitMaskImage = cnv.style.maskImage = url;   // mask the CANVAS, not the wrapper
        }
      }
      raf = requestAnimationFrame(place);
    };
    place();

    fills.set(word, { sampleWin, overlay, stop: () => cancelAnimationFrame(raf), sig });
    say('Filled "' + (word.textContent || 'word') + '" with live video. Texture fill again to clear.');
  }

  /* When a colour/edit changes a warped word, repaint the warp canvas. */
  function syncWarpAfterEdit() {
    if (warpBox && warpSourceBox && warpCanvas) {
      const fresh = rasterizeBox(warpSourceBox);
      if (fresh.width === warpCanvas.width && fresh.height === warpCanvas.height) {
        blitInto(warpCanvas, fresh);
      }
    }
  }

  /* =================================================================
     MEDIA: video autoplay with a play-button fallback (iOS/Android)
     ================================================================= */
  function initMedia() {
    const tryPlay = () => {
      const p = video.play();
      if (p && typeof p.then === 'function') {
        p.then(() => { playBtn.style.display = 'none'; })
         .catch(() => { playBtn.style.display = 'block'; });
      }
    };
    video.addEventListener('loadeddata', tryPlay, { once: true });
    tryPlay();
    playBtn.addEventListener('click', () => { video.play(); playBtn.style.display = 'none'; });
  }

  /* =================================================================
     WIRE TOOLBAR
     ================================================================= */
  btnWarp.addEventListener('click', warpSelectedBox);
  btnEye.addEventListener('click', startEyedropper);
  btnTexture.addEventListener('click', textureFillSelectedWord);
  btnClearWarp.addEventListener('click', clearWarp);   // guaranteed in dom.html

  /* initial: wrap all boxes, select the first, start media */
  document.querySelectorAll('.box').forEach(reWrapWords);
  markSelectedBox(document.querySelector('.box'));
  const firstWord = document.querySelector('.word');
  if (firstWord) markSelectedWord(firstWord);
  initMedia();

  say('Ready. Click into a box / on a word, then use the toolbar.');
})();
