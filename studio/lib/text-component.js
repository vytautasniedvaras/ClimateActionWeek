/* ===================================================================
   BYO.TextComponent — THE product. A self-contained, droppable rich-text
   component that lands on an EMPTY WHITE PAGE. Composes BYO.WarpBox for the
   warp effect; knows nothing about the dev panels (it exposes an API they
   drive). Scene-agnostic.

   Composition (all FROZEN libs, read before called):
     - BYO.color        : exact hex <-> rgb (no precision loss on re-wrap/raster)
     - BYO.Fonts        : apply(els, {...}) formatting contract
     - BYO.WarpBox      : the warp overlay (built over THIS component's rect);
                          fed a HIGH-DPI rasterization via setSourceCanvas;
                          re-rasterized on edit + on resize (wb.resize()).

   The rasterization is done HERE (the caller, per the WARP CONTRACT) at
   rect * devicePixelRatio * SS with the font scaled to match, so the warped
   cube text is crisp (kills pixelation). While warped, the flat DOM words are
   visibility:hidden so only the cube projection shows (kills the disconnect).

   Layout: leftPct / rightPct percent insets from the page's left/right
   (default 0/0 = full width). Height is AUTO from content. Visible drag
   handles on the left + right edges update leftPct/rightPct live.

   Classic script on window.BYO — NO ES modules. Globals: window.BYO.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  const SS = 2;            // warp raster supersample (rect * dpr * SS) — kills pixelation
  let _seq = 0;            // unique id per component (for scoped styles / ids)
  let _stylesInjected = false;

  /* ---- one shared <style> for the component's structural CSS. The editing
     UI lives elsewhere (dev panels); this is only the component itself. ---- */
  function injectStyles() {
    if (_stylesInjected) return;
    _stylesInjected = true;
    const css = `
.byo-textcomp {
  position: relative;
  box-sizing: border-box;
  margin: 0;
}
.byo-textcomp__editable {
  outline: none;
  box-sizing: border-box;
  width: 100%;
  /* readable defaults; overridden live by applyFormat */
  font-family: "Helvetica Neue", Helvetica, Arial, sans-serif;
  font-weight: 800;
  font-size: 6vw;
  line-height: 1.05;
  color: #111111;
  word-break: break-word;
}
.byo-textcomp__line { display: block; min-height: 1em; }
.byo-word { color: inherit; }
/* inline formatting as per-word attributes (warp-safe: getComputedStyle(word)
   reflects these, so the rasterizer picks them up). */
.byo-word[data-bold="1"] { font-weight: 700; }
.byo-word[data-italic="1"] { font-style: italic; }
.byo-word[data-href] { text-decoration: underline; }
.byo-textcomp--preview .byo-word[data-href] { cursor: pointer; }
.byo-word--selected {
  /* selection marker — utilitarian, not a site visual */
  background: rgba(64, 120, 255, 0.22);
  border-radius: 2px;
}
.byo-word--filled {
  /* texture fill paints into the glyphs via background-clip:text */
  -webkit-background-clip: text;
  background-clip: text;
  -webkit-text-fill-color: transparent;
  color: transparent;
  background-repeat: no-repeat;
}
.byo-word--filled.byo-word--empty {
  -webkit-text-fill-color: currentColor;
  color: inherit;
  outline: 1px dashed rgba(0,0,0,0.4);
}
.byo-textcomp__handle {
  position: absolute;
  top: 0;
  width: 10px;
  height: 100%;
  cursor: ew-resize;
  z-index: 5;
  background: transparent;
}
.byo-textcomp__handle::before {
  content: "";
  position: absolute;
  top: 50%; transform: translateY(-50%);
  left: 3px;
  width: 4px; height: 36px;
  border-radius: 2px;
  background: rgba(0,0,0,0.18);
}
.byo-textcomp__handle:hover::before { background: rgba(0,0,0,0.4); }
.byo-textcomp__handle--left { left: 0; }
.byo-textcomp__handle--right { right: 0; }
.byo-textcomp__handle--right::before { left: auto; right: 3px; }
.byo-textcomp.byo-textcomp--warped .byo-word { visibility: hidden; }
.byo-textcomp__warphost {
  position: fixed;
  z-index: 40;
  pointer-events: none;   /* gizmo binds window listeners; overlay never eats clicks */
}
`;
    const el = document.createElement('style');
    el.id = 'byo-textcomp-styles';
    el.textContent = css;
    document.head.appendChild(el);
  }

  /* ---------- small DOM / text helpers (mirrors dom-demo, scoped here) ---------- */

  function escapeHtml(s) {
    return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
  }

  function escapeAttr(s) {
    return String(s).replace(/&/g, '&amp;').replace(/"/g, '&quot;');
  }

  // computed rgb()/rgba() -> '#rrggbb' (getComputedStyle never returns the hex)
  function cssColorToHex(css) {
    if (!css) return '#111111';
    if (css[0] === '#') return css;
    const m = /rgba?\(\s*(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/i.exec(css);
    if (!m) return '#111111';
    return BYO.color.rgbToHex(+m[1] / 255, +m[2] / 255, +m[3] / 255);
  }

  // char offset of (node,offset) from the start of root's text
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

  // place the caret at char `offset` from the start of root
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

  function closest(node, cls, root) {
    while (node && node !== root) {
      if (node.nodeType === 1 && node.classList && node.classList.contains(cls)) return node;
      node = node.parentNode;
    }
    return null;
  }

  /* =================================================================
     TextComponent instance
     ================================================================= */
  class TextComponent {
    constructor(opts) {
      injectStyles();
      opts = opts || {};
      this.id = ++_seq;
      this.mount = opts.mount || document.body;

      // layout state
      this.leftPct = 0;
      this.rightPct = 0;
      this.topPx = opts.top != null ? opts.top : null;  // null = normal flow

      // semantic + format state
      this.tag = 'untagged';
      this.format = {};                 // last applyFormat payload (for serialize)

      // warp state
      this.warp = null;                 // the BYO.WarpBox (exposed for the Warp panel)
      this.isWarped = false;
      this._warpHost = null;
      this._warpCanvas = null;          // persistent backing store fed to setSourceCanvas

      // selection state (array of word spans) — AUTHORITATIVE, decoupled from
      // the live DOM Selection. Only deliberate in-editable gestures change it;
      // panel focus never collapses it (see _refreshSelectionFromCaret).
      this._selection = [];
      this._selectionSnapshot = [];     // last non-empty selection before focusout
      this._anchorWord = null;          // for shift-range extension
      this._dragging = false;           // pointer drag across words
      this._dragAnchor = null;

      // texture fills: word span -> { sampleCanvas, sig }
      this._fills = new Map();

      this._buildDom();

      // inline-formatting + plain-text paste helper (owns no DOM; formats the
      // per-word spans). Re-wrap after a paste keeps the word model coherent.
      this.editor = (BYO.Editor && BYO.Editor.create)
        ? BYO.Editor.create(this.editable, {
            onChange: () => { this._reWrapAll(); this._pruneSelection(); if (this.isWarped) this._rasterizeIntoWarp(); }
          })
        : null;

      this._bindEvents();

      if (opts.state) this.deserialize(opts.state);
      else this._reWrapAll();

      this._applyLayout();
    }

    /* ---------------- DOM ---------------- */
    _buildDom() {
      const root = document.createElement('div');
      root.className = 'byo-textcomp';
      root.dataset.byoComp = String(this.id);

      const ed = document.createElement('div');
      ed.className = 'byo-textcomp__editable';
      ed.setAttribute('contenteditable', 'true');
      ed.setAttribute('spellcheck', 'false');
      ed.dataset.tag = this.tag;

      // seed one line
      const line = document.createElement('div');
      line.className = 'byo-textcomp__line';
      line.appendChild(document.createTextNode('Edit me'));
      ed.appendChild(line);

      const hL = document.createElement('div');
      hL.className = 'byo-textcomp__handle byo-textcomp__handle--left';
      const hR = document.createElement('div');
      hR.className = 'byo-textcomp__handle byo-textcomp__handle--right';

      root.appendChild(hL);
      root.appendChild(hR);
      root.appendChild(ed);
      this.mount.appendChild(root);

      this.el = root;
      this.editable = ed;
      this.handleLeft = hL;
      this.handleRight = hR;
    }

    /* ---------------- events ---------------- */
    _bindEvents() {
      const ed = this.editable;

      // caret-preserving re-wrap + warp sync on edit. A re-wrap rebuilds the
      // word spans, so we only PRUNE detached entries here — never re-pick the
      // selection from the caret (that would collapse a multi-word selection
      // mid-edit). Caret-driven narrowing happens on real key navigation only.
      ed.addEventListener('input', () => {
        this._reWrapAll();
        this._pruneSelection();
        if (this.isWarped) this._rasterizeIntoWarp();
      });
      ed.addEventListener('keyup', () => this._refreshSelectionFromCaret());

      // multi-word selection: click / shift+click / drag
      ed.addEventListener('mousedown', (e) => this._onWordMouseDown(e));
      ed.addEventListener('mousemove', (e) => this._onWordMouseMove(e));
      window.addEventListener('mouseup', () => { this._dragging = false; });

      // snapshot the selection when focus leaves the editable (e.g. the user
      // clicks a dev panel's number / hex input). Panel ops call
      // restoreSelection() so they still target the words that were selected.
      ed.addEventListener('focusout', () => {
        if (this._selection.length) this._selectionSnapshot = this._selection.slice();
      });

      // mark this component active for the dev UI's getActive()
      ed.addEventListener('focus', () => { TextComponent._active = this; });
      this.el.addEventListener('mousedown', () => { TextComponent._active = this; });

      // drag handles -> live leftPct / rightPct
      this._bindHandle(this.handleLeft, 'left');
      this._bindHandle(this.handleRight, 'right');

      // resize: reposition warp overlay + re-rasterize (fixes shader-resize bug)
      this._onResize = () => {
        if (this.isWarped) {
          this._positionWarpHost();
          if (this.warp && this.warp.resize) this.warp.resize();
          this._rasterizeIntoWarp();
        }
        this._repositionFills();
      };
      window.addEventListener('resize', this._onResize);
    }

    _bindHandle(handle, side) {
      handle.addEventListener('mousedown', (e) => {
        e.preventDefault();
        TextComponent._active = this;
        const mountRect = this.mount.getBoundingClientRect();
        const mountW = Math.max(1, mountRect.width);
        const onMove = (ev) => {
          const x = ev.clientX - mountRect.left;
          if (side === 'left') {
            let pct = (x / mountW) * 100;
            pct = Math.max(0, Math.min(pct, 100 - this.rightPct - 5));
            this.leftPct = pct;
          } else {
            let pct = ((mountW - x) / mountW) * 100;
            pct = Math.max(0, Math.min(pct, 100 - this.leftPct - 5));
            this.rightPct = pct;
          }
          this._applyLayout();
          if (this._onLayoutChange) this._onLayoutChange(this.leftPct, this.rightPct);
          if (this.isWarped) {
            this._positionWarpHost();
            if (this.warp && this.warp.resize) this.warp.resize();
            this._rasterizeIntoWarp();
          }
          this._repositionFills();
        };
        const onUp = () => {
          window.removeEventListener('mousemove', onMove);
          window.removeEventListener('mouseup', onUp);
        };
        window.addEventListener('mousemove', onMove);
        window.addEventListener('mouseup', onUp);
      });
    }

    // app/dev-ui hook to reflect handle drags into number inputs
    onLayoutChange(cb) { this._onLayoutChange = cb; }

    /* ---------------- layout ---------------- */
    _applyLayout() {
      const s = this.el.style;
      s.marginLeft = this.leftPct + '%';
      s.marginRight = this.rightPct + '%';
      s.width = 'auto';      // margins inset both edges; height stays auto (content)
      if (this.topPx != null) {
        s.position = 'absolute';
        s.left = this.leftPct + '%';
        s.right = this.rightPct + '%';
        s.top = this.topPx + 'px';
        s.marginLeft = s.marginRight = '0';
        s.width = 'auto';
      }
    }

    setLayout(leftPct, rightPct) {
      if (leftPct != null) this.leftPct = Math.max(0, Math.min(95, leftPct));
      if (rightPct != null) this.rightPct = Math.max(0, Math.min(95, rightPct));
      // prevent the two insets from summing past the width (negative/collapsed
      // component). The handle-drag path already clamps; this guards the
      // number-input path. Trim whichever value was just set.
      if (this.leftPct + this.rightPct > 95) {
        if (rightPct != null) this.rightPct = Math.max(0, 95 - this.leftPct);
        else this.leftPct = Math.max(0, 95 - this.rightPct);
      }
      this._applyLayout();
      if (this.isWarped) {
        this._positionWarpHost();
        if (this.warp && this.warp.resize) this.warp.resize();
        this._rasterizeIntoWarp();
      }
    }

    /* ---------------- per-word wrapping (caret + data-color preserving) ---------------- */
    _reWrapAll() {
      const lines = this.editable.querySelectorAll('.byo-textcomp__line');
      if (lines.length === 0) {
        // contenteditable may have collapsed lines into bare text/<div>; normalize
        this._normalizeLines();
      }
      this.editable.querySelectorAll('.byo-textcomp__line').forEach((l) => this._wrapLine(l));
    }

    // ensure direct children of editable are .byo-textcomp__line wrappers
    _normalizeLines() {
      const ed = this.editable;
      const kids = Array.from(ed.childNodes);
      // if there is loose text or <div>/<br> created by the browser, rebuild lines
      const hasLineWrappers = ed.querySelector('.byo-textcomp__line');
      if (hasLineWrappers && kids.every((k) =>
        k.nodeType === 1 && k.classList && k.classList.contains('byo-textcomp__line'))) return;

      // collect text per visual line
      const texts = [];
      let cur = '';
      let started = false;
      const flush = () => { texts.push(cur); cur = ''; started = false; };
      kids.forEach((k) => {
        if (k.nodeType === 1 && (k.tagName === 'DIV' || k.tagName === 'P')) {
          if (started) flush();
          cur = k.textContent;
          flush();
        } else if (k.nodeType === 1 && k.tagName === 'BR') {
          flush();
        } else {
          cur += k.textContent || '';
          started = true;
        }
      });
      if (started) flush();
      if (texts.length === 0) texts.push('');

      ed.innerHTML = '';
      texts.forEach((t) => {
        const line = document.createElement('div');
        line.className = 'byo-textcomp__line';
        line.appendChild(document.createTextNode(t));
        ed.appendChild(line);
      });
    }

    _wrapLine(line) {
      const sel = window.getSelection();
      let caretOffset = -1;
      if (sel && sel.rangeCount && line.contains(sel.anchorNode)) {
        caretOffset = textOffsetWithin(line, sel.anchorNode, sel.anchorOffset);
      }

      const text = line.textContent;
      // preserve per-word colour + fill flag by token index (EXACT hex via data-color)
      const prev = [];
      line.querySelectorAll('.byo-word').forEach((w) => {
        prev.push({
          color: w.dataset.color || '',
          filled: w.classList.contains('byo-word--filled'),
          bold: w.getAttribute('data-bold') === '1',
          italic: w.getAttribute('data-italic') === '1',
          href: w.getAttribute('data-href') || ''
        });
      });

      const tokens = text.split(/(\s+)/);
      let html = '';
      let wordIdx = 0;
      for (const tok of tokens) {
        if (tok.length === 0) continue;
        if (/^\s+$/.test(tok)) { html += tok.replace(/ /g, '&nbsp;'); continue; }
        const p = prev[wordIdx] || {};
        const colAttr = p.color
          ? ` data-color="${escapeAttr(p.color)}" style="color:${escapeAttr(p.color)}"`
          : ' data-color=""';
        const fmtAttr = (p.bold ? ' data-bold="1"' : '') +
          (p.italic ? ' data-italic="1"' : '') +
          (p.href ? ` data-href="${escapeAttr(p.href)}"` : '');
        html += `<span class="byo-word"${colAttr}${fmtAttr}>${escapeHtml(tok)}</span>`;
        wordIdx++;
      }
      if (html === '') html = '<br>';
      line.innerHTML = html;

      // restore fills that survived (by index) — re-attach the live canvas
      const newWords = line.querySelectorAll('.byo-word');
      newWords.forEach((w, i) => {
        if (prev[i] && prev[i].filled) w.classList.add('byo-word--filled');
      });

      if (caretOffset >= 0) restoreCaretWithin(line, caretOffset);
    }

    /* ---------------- multi-word selection ---------------- */
    _wordAt(node) { return closest(node, 'byo-word', this.editable); }

    _allWords() {
      return Array.from(this.editable.querySelectorAll('.byo-word'));
    }

    _setSelection(words) {
      // clear old markers
      this._selection.forEach((w) => w.classList.remove('byo-word--selected'));
      this._selection = words.filter(Boolean);
      this._selection.forEach((w) => w.classList.add('byo-word--selected'));
    }

    _rangeBetween(a, b) {
      const all = this._allWords();
      const ia = all.indexOf(a), ib = all.indexOf(b);
      if (ia < 0 || ib < 0) return [a].filter(Boolean);
      const lo = Math.min(ia, ib), hi = Math.max(ia, ib);
      return all.slice(lo, hi + 1);
    }

    _onWordMouseDown(e) {
      TextComponent._active = this;
      const word = this._wordAt(e.target);
      if (!word) return;
      if (e.shiftKey && this._anchorWord) {
        this._setSelection(this._rangeBetween(this._anchorWord, word));
      } else {
        this._anchorWord = word;
        this._dragAnchor = word;
        this._dragging = true;
        this._setSelection([word]);
      }
    }

    _onWordMouseMove(e) {
      if (!this._dragging || !this._dragAnchor) return;
      const word = this._wordAt(e.target);
      if (!word) return;
      this._setSelection(this._rangeBetween(this._dragAnchor, word));
    }

    // drop selection entries whose spans were destroyed by a re-wrap
    // (innerHTML rebuild) so we never operate on detached, unrendered nodes.
    _pruneSelection() {
      const valid = this._selection.filter((w) => this.editable.contains(w));
      if (valid.length !== this._selection.length) {
        this._selection.forEach((w) => { if (!this.editable.contains(w)) w.classList.remove('byo-word--selected'); });
        this._selection = valid;
      }
    }

    // keep selection coherent when the caret moves (typing / arrow keys). Prune
    // detached spans, then follow the caret word — but ONLY when the current
    // selection is a single word (or empty). A deliberate multi-word selection
    // is preserved: a stray keyup must never collapse it down to one word.
    _refreshSelectionFromCaret() {
      this._pruneSelection();
      if (this._selection.length > 1) return;
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      let node = sel.anchorNode;
      if (node && node.nodeType === 3) node = node.parentNode;
      if (!this.editable.contains(node)) return;
      const word = this._wordAt(node);
      if (word && this._selection.indexOf(word) === -1) {
        this._anchorWord = word;
        this._setSelection([word]);
      }
    }

    // restore the pre-focusout selection if the live one was lost. Panel ops
    // (setColor/applyFormat/fill) call this so editing via a focus-stealing
    // control (number / hex input) still targets the intended words.
    restoreSelection() {
      if (this._selection.length || !this._selectionSnapshot.length) return;
      const valid = this._selectionSnapshot.filter((w) => this.editable.contains(w));
      if (valid.length) this._setSelection(valid);
    }

    getSelection() { return this._selection.slice(); }

    /* ---------------- per-word colour ---------------- */
    setColor(hex) {
      if (!hex) return;
      this.restoreSelection();
      const words = this._selection.length ? this._selection : this._allWords();
      words.forEach((w) => {
        w.dataset.color = hex;                 // authoritative exact hex
        w.style.color = hex;
        // colouring overrides a texture fill
        if (w.classList.contains('byo-word--filled')) this._unfillWord(w);
      });
      if (this.isWarped) this._rasterizeIntoWarp();
    }

    /* ---------------- texture fill (background-clip:text per word) ---------------- */
    fillWithTexture(sampleCanvas) {
      if (!sampleCanvas) return;
      this.restoreSelection();
      const words = this._selection.length ? this._selection : this._allWords();
      words.forEach((w) => this._fillWord(w, sampleCanvas));
      if (this.isWarped) this._rasterizeIntoWarp();
    }

    _fillWord(word, sampleCanvas) {
      const empty = !word.textContent.trim();
      word.classList.add('byo-word--filled');
      if (empty) { word.classList.add('byo-word--empty'); }
      else { word.classList.remove('byo-word--empty'); }
      // store the live canvas; a rAF refreshes the background image so the
      // moving media shows inside the glyphs via background-clip:text.
      this._fills.set(word, { canvas: sampleCanvas });
      this._ensureFillLoop();
      this._paintFill(word);
    }

    _paintFill(word) {
      const f = this._fills.get(word);
      if (!f) return;
      try {
        const url = f.canvas.toDataURL();
        const r = word.getBoundingClientRect();
        word.style.backgroundImage = 'url("' + url + '")';
        word.style.backgroundSize = Math.max(1, Math.round(r.width)) + 'px ' +
          Math.max(1, Math.round(r.height)) + 'px';
        word.style.backgroundPosition = '0 0';
      } catch (err) { /* tainted canvas / not ready: skip this frame */ }
    }

    _ensureFillLoop() {
      if (this._fillRaf) return;
      const tick = () => {
        // prune words detached by a re-wrap (innerHTML rebuild) so the loop
        // never paints orphaned nodes or spins forever on dead keys.
        this._fills.forEach((f, word) => {
          if (!this.editable.contains(word)) this._fills.delete(word);
        });
        if (this._fills.size === 0) { this._fillRaf = 0; return; }
        this._fills.forEach((f, word) => this._paintFill(word));
        this._fillRaf = requestAnimationFrame(tick);
      };
      this._fillRaf = requestAnimationFrame(tick);
    }

    _repositionFills() {
      this._fills.forEach((f, word) => this._paintFill(word));
    }

    _unfillWord(word) {
      this._fills.delete(word);
      word.classList.remove('byo-word--filled', 'byo-word--empty');
      word.style.backgroundImage = '';
      word.style.backgroundSize = '';
      word.style.backgroundPosition = '';
    }

    clearFill() {
      this.restoreSelection();
      const words = this._selection.length ? this._selection : this._allWords();
      words.forEach((w) => this._unfillWord(w));
      if (this.isWarped) this._rasterizeIntoWarp();
    }

    /* ---------------- formatting ---------------- */
    applyFormat(fmt) {
      fmt = fmt || {};
      this.restoreSelection();
      this.format = Object.assign({}, this.format, fmt);
      // format applies to the whole component's editable (font family/weight/
      // spacing/axes are block-level here); BYO.Fonts.apply is the contract.
      const targets = this._selection.length ? this._selection : [this.editable];
      if (BYO.Fonts && BYO.Fonts.apply) {
        BYO.Fonts.apply(targets, fmt);
      } else {
        // graceful no-op if Fonts not yet loaded (other agent's module)
        targets.forEach((t) => {
          if (fmt.family) t.style.fontFamily = fmt.family;
          if (fmt.weight != null) t.style.fontWeight = fmt.weight;
          if (fmt.letterSpacing != null) t.style.letterSpacing = fmt.letterSpacing + 'px';
          if (fmt.wordSpacing != null) t.style.wordSpacing = fmt.wordSpacing + 'px';
          if (fmt.variation) {
            t.style.fontVariationSettings = Object.keys(fmt.variation)
              .map((k) => `'${k}' ${fmt.variation[k]}`).join(', ');
          }
        });
      }
      if (this.isWarped) {
        this._positionWarpHost();
        if (this.warp && this.warp.resize) this.warp.resize();
        this._rasterizeIntoWarp();
      }
    }

    setTag(tag) {
      this.tag = tag || 'untagged';
      this.editable.dataset.tag = this.tag;
    }

    /* ---------------- inline formatting (per-word, via BYO.Editor) ----------------
       Bold / italic / link are stored as per-word attributes on the selected
       spans so the warp raster (computed-style per word) honours them. Each
       toggles across the WHOLE selection; re-raster if warped. */
    _fmtSpans() {
      this.restoreSelection();
      return this._selection.length ? this._selection : this._allWords();
    }
    toggleBold() { if (this.editor) { const on = this.editor.bold(this._fmtSpans()); if (this.isWarped) this._rasterizeIntoWarp(); return on; } }
    toggleItalic() { if (this.editor) { const on = this.editor.italic(this._fmtSpans()); if (this.isWarped) this._rasterizeIntoWarp(); return on; } }
    setLink(url) { if (this.editor) { this.editor.link(this._fmtSpans(), url); if (this.isWarped) this._rasterizeIntoWarp(); } }
    clearLink() { if (this.editor) { this.editor.unlink(this._fmtSpans()); if (this.isWarped) this._rasterizeIntoWarp(); } }
    removeInlineFormat() { if (this.editor) { this.editor.removeFormat(this._fmtSpans()); if (this.isWarped) this._rasterizeIntoWarp(); } }
    // current inline-format state of the selection (for the dev-ui buttons)
    inlineState() {
      const spans = this._selection.length ? this._selection : [];
      return this.editor
        ? { bold: this.editor.isBold(spans), italic: this.editor.isItalic(spans), href: this.editor.linkOf(spans) }
        : { bold: false, italic: false, href: '' };
    }

    /* =================================================================
       WARP — build a WarpBox over THIS component's rect, feed a HIGH-DPI
       rasterization, hide the flat DOM text while warped.
       ================================================================= */
    attachWarp(opts) {
      if (this.isWarped) return this.warp;
      opts = opts || {};

      const host = document.createElement('div');
      host.className = 'byo-textcomp__warphost';
      document.body.appendChild(host);
      this._warpHost = host;
      this._positionWarpHost();

      this.warp = new BYO.WarpBox(host, {
        projection: opts.projection != null ? opts.projection : 0.45,
        facingCut: opts.facingCut != null ? opts.facingCut : 0.12,
        renderScale: opts.renderScale != null ? opts.renderScale : 1.25,
        motion: opts.motion
      });
      this.warp.start();

      this.isWarped = true;
      this.el.classList.add('byo-textcomp--warped');   // hides flat words

      this._rasterizeIntoWarp();
      this.warp.setVisible(true);
      return this.warp;
    }

    detachWarp() {
      if (!this.isWarped) return;
      this.el.classList.remove('byo-textcomp--warped');
      if (this.warp) { this.warp.dispose(); this.warp = null; }
      if (this._warpHost && this._warpHost.parentNode) {
        this._warpHost.parentNode.removeChild(this._warpHost);
      }
      this._warpHost = null;
      this._warpCanvas = null;
      this.isWarped = false;
    }

    // size + position the fixed overlay host EXACTLY over the component rect
    _positionWarpHost() {
      if (!this._warpHost) return;
      const r = this.el.getBoundingClientRect();
      // round to whole CSS px so the overlay aligns pixel-perfect with the flat
      // component (getBoundingClientRect returns floats -> 0.5-1px drift otherwise)
      Object.assign(this._warpHost.style, {
        left: Math.round(r.left) + 'px',
        top: Math.round(r.top) + 'px',
        width: Math.max(1, Math.round(r.width)) + 'px',
        height: Math.max(1, Math.round(r.height)) + 'px'
      });
    }

    /* HIGH-DPI rasterization of THIS component's text:
       canvas = rect * devicePixelRatio * SS, font scaled to match -> crisp warp.
       Persistent backing canvas so the WarpBox CanvasTexture (needsUpdate each
       frame) always points at the same store; we just repaint it. */
    _rasterizeIntoWarp() {
      if (!this.warp) return;
      const r = this.el.getBoundingClientRect();
      const dpr = window.devicePixelRatio || 1;
      const scale = dpr * SS;
      const W = Math.max(1, Math.round(r.width * scale));
      const H = Math.max(1, Math.round(r.height * scale));

      let cv = this._warpCanvas;
      const fresh = !cv || cv.width !== W || cv.height !== H;
      if (fresh) {
        cv = document.createElement('canvas');
        cv.width = W; cv.height = H;
        this._warpCanvas = cv;
      }
      const ctx = cv.getContext('2d', { willReadFrequently: false });  // write-only target
      ctx.setTransform(1, 0, 0, 1, 0, 0);
      ctx.clearRect(0, 0, W, H);
      ctx.scale(scale, scale);               // draw in CSS px units; backing is hi-dpi

      // draw each word at its position relative to the component, in its colour,
      // matching the live computed font so the warp matches the flat layout.
      const compRect = r;
      const words = this._allWords();
      words.forEach((w) => {
        const t = w.textContent;
        if (!t.trim()) return;
        const wr = w.getBoundingClientRect();
        const cs = getComputedStyle(w);
        const fontSize = cs.fontSize || '16px';
        const fontFamily = cs.fontFamily || 'sans-serif';
        const fontWeight = cs.fontWeight || '800';
        const fontStyle = cs.fontStyle && cs.fontStyle !== 'normal' ? cs.fontStyle + ' ' : '';
        // include style (italic) + weight (bold) so per-word data-bold/italic
        // render correctly on the warped cube as well as the flat DOM text.
        ctx.font = `${fontStyle}${fontWeight} ${fontSize} ${fontFamily}`;
        // NOTE: canvas 2D fillText() does not honour letterSpacing/wordSpacing
        // (those are DOM-only properties), so the warped raster matches the flat
        // text minus any letter/word spacing applied via applyFormat. Known,
        // accepted limitation; we position each word by its DOM rect, so word
        // spacing is implicitly preserved but intra-word letter spacing is not.
        ctx.textBaseline = 'alphabetic';
        ctx.textAlign = 'left';
        // exact hex (no rgb round-trip loss) when set; else normalized computed
        const col = w.dataset.color || cssColorToHex(cs.color);
        ctx.fillStyle = col;
        const x = wr.left - compRect.left;
        // approximate baseline: top + ascent (~0.8 of font-size)
        const fs = parseFloat(fontSize) || 16;
        const y = (wr.top - compRect.top) + fs * 0.8;
        ctx.fillText(t, x, y);
      });

      this.warp.setSourceCanvas(cv);   // WARP CONTRACT: caller hands in the hi-dpi raster
    }

    /* ---------------- serialize / deserialize ---------------- */
    serialize() {
      const lines = [];
      this.editable.querySelectorAll('.byo-textcomp__line').forEach((line) => {
        const words = [];
        line.querySelectorAll('.byo-word').forEach((w) => {
          const text = w.textContent;
          // keep ALL words (including whitespace-only) so line/word structure
          // round-trips exactly; flag empties so deserialize can restore them.
          const entry = {
            text: text,
            color: w.dataset.color || cssColorToHex(getComputedStyle(w).color)
          };
          if (!text.trim()) entry.empty = true;
          if (w.classList.contains('byo-word--filled')) entry.fill = true;
          if (w.getAttribute('data-bold') === '1') entry.bold = true;
          if (w.getAttribute('data-italic') === '1') entry.italic = true;
          if (w.getAttribute('data-href')) entry.href = w.getAttribute('data-href');
          words.push(entry);
        });
        lines.push({ words });
      });

      const out = {
        leftPct: this.leftPct,
        rightPct: this.rightPct,
        tag: this.tag,
        lines: lines,
        format: Object.assign({}, this.format),
        warp: {
          enabled: this.isWarped,
          // surfaceOpts (projection/facingCut) is the warp GEOMETRY config and
          // must round-trip; if warped but the box is gone, fall back to the
          // attachWarp() defaults rather than {} (which would reset to 0/0).
          surfaceOpts: (this.isWarped && this.warp && this.warp.surfaceOpts)
            ? Object.assign({}, this.warp.surfaceOpts)
            : (this.isWarped ? { projection: 0.45, facingCut: 0.12 } : null),
          config: this.warp ? Object.assign({}, this.warp.config) : null,
          model: this.warp ? this._serializeModel(this.warp.model) : null
        }
      };
      return out;
    }

    _serializeModel(model) {
      if (!model) return null;
      return {
        position: { x: model.position.x, y: model.position.y, z: model.position.z },
        quaternion: { x: model.quaternion.x, y: model.quaternion.y, z: model.quaternion.z, w: model.quaternion.w },
        faceOffset: Object.assign({}, model.faceOffset)
      };
    }

    deserialize(state) {
      state = state || {};
      this.leftPct = state.leftPct != null ? state.leftPct : 0;
      this.rightPct = state.rightPct != null ? state.rightPct : 0;
      this.tag = state.tag || 'untagged';
      this.editable.dataset.tag = this.tag;

      // rebuild lines/words with exact colours
      const ed = this.editable;
      ed.innerHTML = '';
      const lines = (state.lines && state.lines.length) ? state.lines : [{ words: [{ text: 'Edit me', color: '' }] }];
      lines.forEach((ln) => {
        const line = document.createElement('div');
        line.className = 'byo-textcomp__line';
        const words = ln.words || [];
        if (words.length === 0) {
          line.appendChild(document.createElement('br'));
        } else {
          words.forEach((wd, i) => {
            const span = document.createElement('span');
            span.className = 'byo-word';
            span.textContent = wd.text;
            if (wd.color) { span.dataset.color = wd.color; span.style.color = wd.color; }
            else span.dataset.color = '';
            if (wd.fill) span.classList.add('byo-word--filled');
            if (wd.bold) span.setAttribute('data-bold', '1');
            if (wd.italic) span.setAttribute('data-italic', '1');
            if (wd.href) span.setAttribute('data-href', wd.href);
            line.appendChild(span);
            if (i < words.length - 1) line.appendChild(document.createTextNode(' '));
          });
        }
        ed.appendChild(line);
      });

      // restore format
      if (state.format && Object.keys(state.format).length) {
        this.format = {};
        this._selection = [];
        this.applyFormat(state.format);
      }

      this._applyLayout();

      // restore warp (and its transform model) if it was enabled
      if (state.warp && state.warp.enabled) {
        // attachWarp expects GEOMETRY opts ({projection, facingCut}); pass the
        // saved surfaceOpts, NOT the motion config. attachWarp supplies sane
        // defaults if surfaceOpts is null (mid-drag serialize edge case).
        this.attachWarp(state.warp.surfaceOpts || {});
        if (this.warp) {
          if (state.warp.config) {
            // motion config is live two-way bound; copy known keys
            Object.assign(this.warp.config, state.warp.config);
          }
          if (state.warp.model && this.warp.model) {
            this._applyModel(this.warp.model, state.warp.model);
          }
          this._rasterizeIntoWarp();
        }
      }
      return this;
    }

    _applyModel(target, src) {
      if (src.position) target.position.set(src.position.x, src.position.y, src.position.z);
      if (src.quaternion) target.quaternion.set(src.quaternion.x, src.quaternion.y, src.quaternion.z, src.quaternion.w);
      if (src.faceOffset) Object.assign(target.faceOffset, src.faceOffset);
      if (this.warp && this.warp.gizmo) this.warp.gizmo.setTransform(target);
    }

    /* ---------------- teardown ---------------- */
    destroy() {
      this.detachWarp();
      if (this.editor) this.editor.destroy();
      window.removeEventListener('resize', this._onResize);
      if (this._fillRaf) cancelAnimationFrame(this._fillRaf);
      this._fills.clear();
      if (this.el && this.el.parentNode) this.el.parentNode.removeChild(this.el);
      if (TextComponent._active === this) TextComponent._active = null;
    }
  }

  TextComponent._active = null;

  BYO.TextComponent = {
    create(opts) { return new TextComponent(opts || {}); },
    // dev-ui getActive() convenience: last-interacted component
    getActive() { return TextComponent._active; }
  };
})();
