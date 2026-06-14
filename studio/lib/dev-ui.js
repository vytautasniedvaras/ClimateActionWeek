/* ===================================================================
   BYO.DevUI — throwaway editing scaffolding. Wires floating dev panels
   (BYO.Panel) to the LAST-INTERACTED BYO.TextComponent and its current
   word selection. This is NOT a site visual language: plain utilitarian
   panels, hidden/shown together with H (app binds H -> BYO.Panel.toggleAll).

   The product is the text component on the empty white page; everything
   here just drives its public API:
     Colour  : BYO.ColorPanel  live  -> active.setColor(hex)
                                commit-> state.recentColors (keep last 10)
     Format  : BYO.Fonts family/weight/spacing/variable-axes -> active.applyFormat
     Layout  : leftPct / rightPct number inputs (+ reflect live handle drags)
     Warp    : toggle + projection / edge / spin sliders bound to the live
               warp config (active.warp.surfaceOpts + active.warp.config)
     Texture : BYO.TextureWindow over the sample <video>/<img>; "fill
               selection" -> active.fillWithTexture(textureWindow.sampleCanvas)

   getActive() returns the active component; panels retarget when it changes.
   state.recentColors is the single source of truth for recents (app owns it,
   so export/import covers them later). Texture clearing routes to clearFill().

   API (frozen spec, studio/_TEXTCOMPONENT_SPEC.md):
     BYO.DevUI.attach({ getActive, state, sources }) -> {}
       sources: { video, img }  (the sampling media elements; they live INSIDE
                                  the Texture panel, not as page furniture)

   Classic-script IIFE on window.BYO — NO ES modules.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  if (!BYO.Panel) throw new Error('DevUI requires BYO.Panel (studio/lib/panel.js) loaded first');

  /* ---- tiny DOM builders (utilitarian, no theming) ------------------- */
  function row(label) {
    const r = document.createElement('label');
    r.style.cssText = 'display:flex;align-items:center;gap:6px;margin:0 0 6px;font-size:11px;';
    if (label != null) {
      const t = document.createElement('span');
      t.textContent = label;
      t.style.cssText = 'flex:0 0 72px;color:#555;';
      r.appendChild(t);
    }
    return r;
  }
  function numInput(value, step) {
    const el = document.createElement('input');
    el.type = 'number';
    if (step != null) el.step = String(step);
    if (value != null) el.value = String(value);
    el.style.cssText = 'flex:1 1 auto;width:100%;min-width:0;box-sizing:border-box;' +
      'padding:3px 4px;font:inherit;border:1px solid #ccc;border-radius:3px;';
    return el;
  }
  function rangeInput(min, max, step, value) {
    const el = document.createElement('input');
    el.type = 'range';
    el.min = String(min); el.max = String(max); el.step = String(step);
    el.value = String(value);
    el.style.cssText = 'flex:1 1 auto;width:100%;min-width:0;';
    return el;
  }
  function selectInput(options) {
    const el = document.createElement('select');
    el.style.cssText = 'flex:1 1 auto;width:100%;min-width:0;box-sizing:border-box;' +
      'padding:3px 4px;font:inherit;border:1px solid #ccc;border-radius:3px;';
    (options || []).forEach(function (o) {
      const op = document.createElement('option');
      op.value = o.value; op.textContent = o.label;
      el.appendChild(op);
    });
    return el;
  }
  function button(text) {
    const el = document.createElement('button');
    el.type = 'button';
    el.textContent = text;
    el.style.cssText = 'width:100%;padding:4px;margin:2px 0;font:inherit;cursor:pointer;' +
      'border:1px solid #ccc;border-radius:3px;background:#fff;';
    // don't steal focus from the editable: a button click must not blur the
    // contenteditable (which would drop the live selection before the op runs).
    // (Safe for buttons — unlike range inputs, which need the default mousedown
    // to start a thumb drag, so we never preventDefault those.)
    el.addEventListener('mousedown', function (e) { e.preventDefault(); });
    return el;
  }

  function attach(cfg) {
    cfg = cfg || {};
    const getActive = typeof cfg.getActive === 'function' ? cfg.getActive : function () { return null; };
    const state = cfg.state || { recentColors: [] };
    if (!Array.isArray(state.recentColors)) state.recentColors = [];
    const srcObj = cfg.sources || {};
    const colorSources = [srcObj.video, srcObj.img].filter(Boolean);

    // forward-declared so the active-component retarget can reference them
    // before the Effects panel is built (see the effects section below).
    let effectsPanel = null, refreshEffects = null;

    /* =============================================================
       COLOUR panel
       ============================================================= */
    const colorPanel = BYO.Panel.create({ title: 'Colour', id: 'devui-colour', width: 220 });
    colorPanel.setPosition(16, 16);
    const colorPicker = BYO.ColorPanel.create(colorPanel.body);

    function pushRecent(hex) {
      if (!hex) return;
      const i = state.recentColors.indexOf(hex);
      if (i !== -1) state.recentColors.splice(i, 1);
      state.recentColors.unshift(hex);
      if (state.recentColors.length > 10) state.recentColors.length = 10;
      colorPicker.setRecent(state.recentColors);
    }

    function openColorPicker() {
      const c = getActive();
      // seed the picker from the active selection's first word colour, if any
      let seed = '#888888';
      if (c) {
        const sel = c.getSelection();
        if (sel.length && sel[0].dataset && sel[0].dataset.color) seed = sel[0].dataset.color;
      }
      colorPicker.open({
        hex: seed,
        recent: state.recentColors,
        sources: colorSources,
        onChange: function (hex) {
          const a = getActive();
          if (a) a.setColor(hex);
        },
        onCommit: function (hex) {
          const a = getActive();
          if (a) a.setColor(hex);
          pushRecent(hex);
        }
      });
    }
    openColorPicker();

    /* =============================================================
       FORMAT panel — family / weight / spacing / variable axes
       ============================================================= */
    const formatPanel = BYO.Panel.create({ title: 'Format', id: 'devui-format', width: 220 });
    formatPanel.setPosition(250, 16);

    const fontEntries = (BYO.Fonts ? BYO.Fonts.DISPLAY.concat(BYO.Fonts.PARAGRAPH) : []);
    const famRow = row('Font');
    const famSel = selectInput(fontEntries.map(function (e, i) { return { value: String(i), label: e.label }; }));
    famRow.appendChild(famSel);
    formatPanel.body.appendChild(famRow);

    const weightRow = row('Weight');
    const weightInput = numInput(800, 100);
    weightInput.min = '1'; weightInput.max = '1000';
    weightRow.appendChild(weightInput);
    formatPanel.body.appendChild(weightRow);

    const lsRow = row('Letter');
    const lsInput = numInput(0, 0.1);
    lsRow.appendChild(lsInput);
    formatPanel.body.appendChild(lsRow);

    const wsRow = row('Word');
    const wsInput = numInput(0, 0.1);
    wsRow.appendChild(wsInput);
    formatPanel.body.appendChild(wsRow);

    // variable-axis sliders (rebuilt when the family changes)
    const axisHost = document.createElement('div');
    axisHost.style.cssText = 'margin-top:4px;';
    formatPanel.body.appendChild(axisHost);

    // tag selector (header / paragraph / untagged) on the focused block
    const tagRow = row('Tag');
    const tagSel = selectInput([
      { value: 'untagged', label: 'untagged' },
      { value: 'header', label: 'header' },
      { value: 'paragraph', label: 'paragraph' }
    ]);
    tagRow.appendChild(tagSel);
    formatPanel.body.appendChild(tagRow);

    // inline formatting: bold / italic / link / clear — applied per-word to the
    // selection (via active.toggleBold/toggleItalic/setLink/removeInlineFormat).
    const fmtRow = document.createElement('div');
    fmtRow.style.cssText = 'display:flex;gap:4px;margin:2px 0 6px;';
    function inlineBtn(label, w) {
      const b = button(label);
      b.style.cssText += 'width:auto;flex:' + (w || '1') + ';margin:0;';
      fmtRow.appendChild(b);
      return b;
    }
    const boldBtn = inlineBtn('B'); boldBtn.style.fontWeight = '800';
    const italicBtn = inlineBtn('I'); italicBtn.style.fontStyle = 'italic';
    const linkBtn = inlineBtn('Link', '2');
    const clearFmtBtn = inlineBtn('Clear', '2');
    formatPanel.body.appendChild(fmtRow);

    function refreshInlineButtons() {
      const a = getActive();
      const st = a && a.inlineState ? a.inlineState() : { bold: false, italic: false, href: '' };
      boldBtn.style.background = st.bold ? '#cfe0ff' : '#fff';
      italicBtn.style.background = st.italic ? '#cfe0ff' : '#fff';
      linkBtn.style.background = st.href ? '#cfe0ff' : '#fff';
    }
    boldBtn.addEventListener('click', function () { const a = getActive(); if (a) { a.toggleBold(); refreshInlineButtons(); } });
    italicBtn.addEventListener('click', function () { const a = getActive(); if (a) { a.toggleItalic(); refreshInlineButtons(); } });
    linkBtn.addEventListener('click', function () {
      const a = getActive();
      if (!a) return;
      const cur = a.inlineState ? a.inlineState().href : '';
      const url = window.prompt('Link URL (blank to remove):', cur || 'https://');
      if (url === null) return;
      if (url.trim()) a.setLink(url.trim()); else a.clearLink();
      refreshInlineButtons();
    });
    clearFmtBtn.addEventListener('click', function () { const a = getActive(); if (a) { a.removeInlineFormat(); refreshInlineButtons(); } });

    // current variable-axis values, keyed by axis name
    let axisValues = {};

    function currentEntry() {
      const idx = parseInt(famSel.value, 10);
      return fontEntries[idx] || null;
    }

    function applyFormatNow() {
      const a = getActive();
      if (!a) return;
      const entry = currentEntry();
      const fmt = {
        family: entry ? entry.stack : undefined,
        weight: weightInput.value === '' ? undefined : Number(weightInput.value),
        letterSpacing: lsInput.value === '' ? undefined : Number(lsInput.value),
        wordSpacing: wsInput.value === '' ? undefined : Number(wsInput.value)
      };
      if (entry && entry.variable) {
        const variation = {};
        Object.keys(axisValues).forEach(function (k) { variation[k] = axisValues[k]; });
        fmt.variation = variation;
      }
      a.applyFormat(fmt);
    }

    function rebuildAxisSliders() {
      axisHost.textContent = '';
      axisValues = {};
      const entry = currentEntry();
      if (!entry || !entry.variable) return;
      const axes = entry.variable;
      Object.keys(axes).forEach(function (axis) {
        const range = axes[axis];
        if (!Array.isArray(range)) return;
        const mid = axis === 'wght' ? Math.min(range[1], 400)
          : Math.round((range[0] + range[1]) / 2);
        axisValues[axis] = mid;
        const r = row(axis);
        const sl = rangeInput(range[0], range[1], 1, mid);
        const out = document.createElement('span');
        out.textContent = String(mid);
        out.style.cssText = 'flex:0 0 34px;text-align:right;color:#777;';
        sl.addEventListener('input', function () {
          axisValues[axis] = Number(sl.value);
          out.textContent = sl.value;
          applyFormatNow();
        });
        r.appendChild(sl);
        r.appendChild(out);
        axisHost.appendChild(r);
      });
    }

    famSel.addEventListener('change', function () { rebuildAxisSliders(); applyFormatNow(); });
    weightInput.addEventListener('input', applyFormatNow);
    lsInput.addEventListener('input', applyFormatNow);
    wsInput.addEventListener('input', applyFormatNow);
    tagSel.addEventListener('change', function () {
      const a = getActive();
      if (a) a.setTag(tagSel.value);
    });
    rebuildAxisSliders();

    /* =============================================================
       LAYOUT panel — free 2D placement (X/Y/Width %), z-order + docking
       (reflects live handle drags; X/Y/W are % of the viewport)
       ============================================================= */
    const layoutPanel = BYO.Panel.create({ title: 'Layout', id: 'devui-layout', width: 220 });
    layoutPanel.setPosition(16, 320);

    const xRow = row('X %'); const xInput = numInput(0, 0.5); xRow.appendChild(xInput); layoutPanel.body.appendChild(xRow);
    const yRow = row('Y %'); const yInput = numInput(0, 0.5); yRow.appendChild(yInput); layoutPanel.body.appendChild(yRow);
    const wRow = row('Width %'); const wInput = numInput(100, 0.5); wInput.min = '5'; wInput.max = '200'; wRow.appendChild(wInput); layoutPanel.body.appendChild(wRow);
    const zRow = row('Z order'); const zInput = numInput(0, 1); zRow.appendChild(zInput); layoutPanel.body.appendChild(zRow);

    function applyLayoutNow() {
      const a = getActive();
      if (!a) return;
      a.setPos({
        xPct: xInput.value === '' ? 0 : Number(xInput.value),
        yPct: yInput.value === '' ? 0 : Number(yInput.value),
        widthPct: wInput.value === '' ? 100 : Number(wInput.value)
      });
    }
    xInput.addEventListener('input', applyLayoutNow);
    yInput.addEventListener('input', applyLayoutNow);
    wInput.addEventListener('input', applyLayoutNow);
    zInput.addEventListener('input', function () { const a = getActive(); if (a) a.setZ(Number(zInput.value) || 0); });

    // relative docking: dock the active box beside / above / below another
    const dockRow = row('Dock');
    const dockSide = selectInput([
      { value: '', label: 'none' }, { value: 'right', label: 'right of' }, { value: 'left', label: 'left of' },
      { value: 'below', label: 'below' }, { value: 'above', label: 'above' }
    ]);
    dockRow.appendChild(dockSide);
    layoutPanel.body.appendChild(dockRow);
    const dockToRow = row('Dock to');
    const dockTo = selectInput([{ value: '', label: '(pick)' }]);
    dockToRow.appendChild(dockTo);
    layoutPanel.body.appendChild(dockToRow);
    const gapRow = row('Gap %'); const gapInput = numInput(2, 0.5); gapRow.appendChild(gapInput); layoutPanel.body.appendChild(gapRow);

    // populate the dock-target list from the app's component registry
    function refreshDockTargets() {
      const a = getActive();
      const comps = (state.components || []);
      const cur = dockTo.value;
      dockTo.innerHTML = '';
      const none = document.createElement('option'); none.value = ''; none.textContent = '(pick)'; dockTo.appendChild(none);
      comps.forEach(function (c) {
        if (c === a) return;
        const op = document.createElement('option'); op.value = String(c.id); op.textContent = 'box #' + c.id; dockTo.appendChild(op);
      });
      dockTo.value = cur;
    }
    function applyDockNow() {
      const a = getActive();
      if (!a) return;
      const side = dockSide.value;
      if (!side || !dockTo.value) { a.setDock(null); return; }
      a.setDock({ relTo: Number(dockTo.value), side: side, gapPct: Number(gapInput.value) || 0 });
    }
    dockSide.addEventListener('change', applyDockNow);
    dockTo.addEventListener('change', applyDockNow);
    gapInput.addEventListener('input', applyDockNow);

    /* =============================================================
       WARP panel — toggle + projection / edge / spin sliders
       Bound to the live warp config:
         projection -> active.warp.surfaceOpts.projection
         edge       -> active.warp.surfaceOpts.facingCut
         spin       -> active.warp.config.slowSpin  (idle coast speed)
       ============================================================= */
    const warpPanel = BYO.Panel.create({ title: 'Warp', id: 'devui-warp', width: 220 });
    warpPanel.setPosition(250, 320);

    const warpToggle = button('Enable warp');
    warpPanel.body.appendChild(warpToggle);

    // numeric read-out next to each warp slider so the user can see the drag
    // registering (and tell apart dead zones from a stuck control).
    function valOut(initial) {
      const out = document.createElement('span');
      out.textContent = String(initial);
      out.style.cssText = 'flex:0 0 34px;text-align:right;color:#777;';
      return out;
    }

    const projRow = row('Project');
    const projSlider = rangeInput(0, 1, 0.01, 0.45);
    const projOut = valOut(projSlider.value);
    projRow.appendChild(projSlider);
    projRow.appendChild(projOut);
    warpPanel.body.appendChild(projRow);

    const edgeRow = row('Edge');
    const edgeSlider = rangeInput(0, 0.5, 0.01, 0.12);
    const edgeOut = valOut(edgeSlider.value);
    edgeRow.appendChild(edgeSlider);
    edgeRow.appendChild(edgeOut);
    warpPanel.body.appendChild(edgeRow);

    const spinRow = row('Spin');
    const spinSlider = rangeInput(0, 2, 0.01, 0.3);
    const spinOut = valOut(spinSlider.value);
    spinRow.appendChild(spinSlider);
    spinRow.appendChild(spinOut);
    warpPanel.body.appendChild(spinRow);

    function refreshWarpToggle() {
      const a = getActive();
      warpToggle.textContent = (a && a.isWarped) ? 'Disable warp' : 'Enable warp';
    }
    function syncWarpControlsFromActive() {
      const a = getActive();
      refreshWarpToggle();
      if (a && a.warp) {
        if (a.warp.surfaceOpts) {
          if (a.warp.surfaceOpts.projection != null) projSlider.value = String(a.warp.surfaceOpts.projection);
          if (a.warp.surfaceOpts.facingCut != null) edgeSlider.value = String(a.warp.surfaceOpts.facingCut);
        }
        if (a.warp.config && a.warp.config.slowSpin != null) spinSlider.value = String(a.warp.config.slowSpin);
      }
      projOut.textContent = projSlider.value;
      edgeOut.textContent = edgeSlider.value;
      spinOut.textContent = spinSlider.value;
    }
    warpToggle.addEventListener('click', function () {
      const a = getActive();
      if (!a) return;
      if (a.isWarped) {
        a.detachWarp();
      } else {
        a.attachWarp({
          projection: Number(projSlider.value),
          facingCut: Number(edgeSlider.value)
        });
        if (a.warp && a.warp.config) a.warp.config.slowSpin = Number(spinSlider.value);
      }
      syncWarpControlsFromActive();
    });
    projSlider.addEventListener('input', function () {
      projOut.textContent = projSlider.value;
      const a = getActive();
      if (a && a.warp && a.warp.surfaceOpts) a.warp.surfaceOpts.projection = Number(projSlider.value);
    });
    edgeSlider.addEventListener('input', function () {
      edgeOut.textContent = edgeSlider.value;
      const a = getActive();
      if (a && a.warp && a.warp.surfaceOpts) a.warp.surfaceOpts.facingCut = Number(edgeSlider.value);
    });
    spinSlider.addEventListener('input', function () {
      spinOut.textContent = spinSlider.value;
      const a = getActive();
      if (a && a.warp && a.warp.config) a.warp.config.slowSpin = Number(spinSlider.value);
    });

    /* =============================================================
       TEXTURE panel — the sample media lives HERE (not page furniture)
       ============================================================= */
    const texturePanel = BYO.Panel.create({ title: 'Texture', id: 'devui-texture', width: 260 });
    texturePanel.setPosition(16, 560);

    let textureWindow = null;
    const initialSource = srcObj.video || srcObj.img || null;
    if (BYO.TextureWindow && initialSource) {
      textureWindow = BYO.TextureWindow.create(texturePanel.body, { source: initialSource });
    }

    // source switch (video <-> still) so both assets are reachable in-panel
    if (textureWindow && srcObj.video && srcObj.img) {
      const srcRow = row('Source');
      const srcSel = selectInput([
        { value: 'video', label: 'video' },
        { value: 'img', label: 'image' }
      ]);
      srcRow.appendChild(srcSel);
      texturePanel.body.appendChild(srcRow);
      srcSel.addEventListener('change', function () {
        textureWindow.setSource(srcSel.value === 'img' ? srcObj.img : srcObj.video);
      });
    }

    const fillBtn = button('Fill selection');
    texturePanel.body.appendChild(fillBtn);
    const clearBtn = button('Clear fill');
    texturePanel.body.appendChild(clearBtn);

    fillBtn.addEventListener('click', function () {
      const a = getActive();
      if (a && textureWindow) a.fillWithTexture(textureWindow.sampleCanvas);
    });
    clearBtn.addEventListener('click', function () {
      const a = getActive();
      if (a && a.clearFill) a.clearFill();
    });

    /* =============================================================
       Active-component driven (NO polling): the editing panels reflect and
       show/hide with the active (selected) component. TextComponent fires
       onActiveChange(component|null); deselect hides the editing panels.
       ============================================================= */
    const editingPanels = [colorPanel, formatPanel, layoutPanel, warpPanel, texturePanel, effectsPanel];
    function showEditing(on) { editingPanels.forEach(function (p) { if (p) (on ? p.show() : p.hide()); }); }

    function retarget(a) {
      if (!a) { showEditing(false); return; }
      showEditing(true);
      xInput.value = String(Math.round((a.pos.xPct || 0) * 10) / 10);
      yInput.value = String(Math.round((a.pos.yPct || 0) * 10) / 10);
      wInput.value = String(Math.round((a.pos.widthPct != null ? a.pos.widthPct : 100) * 10) / 10);
      zInput.value = String(a.z || 0);
      tagSel.value = a.tag || 'untagged';
      dockSide.value = a.dock ? a.dock.side : '';
      gapInput.value = String(a.dock ? (a.dock.gapPct || 0) : 2);
      refreshDockTargets();
      if (a.dock) dockTo.value = String(a.dock.relTo);
      syncWarpControlsFromActive();
      refreshInlineButtons();
      if (refreshEffects) refreshEffects();
      // re-open the colour picker so its seed + hex/RGB + marker reflect the
      // newly-active component's selection.
      openColorPicker();
      // reflect live handle drags into the X/Y/Width inputs
      a.onLayoutChange(function () {
        xInput.value = String(Math.round(a.pos.xPct * 10) / 10);
        yInput.value = String(Math.round(a.pos.yPct * 10) / 10);
        wInput.value = String(Math.round(a.pos.widthPct * 10) / 10);
      });
    }
    BYO.TextComponent.onActiveChange(retarget);
    retarget(getActive());

    return {
      colorPanel: colorPanel,
      formatPanel: formatPanel,
      layoutPanel: layoutPanel,
      warpPanel: warpPanel,
      texturePanel: texturePanel,
      effectsPanel: effectsPanel,
      pushRecent: pushRecent,
      retarget: retarget,
      destroy: function () {
        editingPanels.forEach(function (p) { if (p) p.destroy(); });
        if (textureWindow) textureWindow.dispose();
      }
    };
  }

  BYO.DevUI = { attach: attach };
})();
