/* ===================================================================
   app.js — the ONLY "page" code. Proves the text component works on an
   EMPTY WHITE PAGE: it creates one/two BYO.TextComponent instances, holds
   the app state { recentColors, activeComponent }, binds H to hide/show the
   dev panels, and attaches the throwaway dev UI (BYO.DevUI) which drives the
   active component's public API.

   The sampling media (<video> + <img> from assets/) is created here but
   handed to BYO.DevUI so it lives INSIDE the Texture dev panel — NOT as page
   furniture. This file adds no chrome and no site styling; the product is the
   component on the blank page.

   Classic-script on window.BYO — NO ES modules.
   =================================================================== */
(function () {
  'use strict';

  // single source of truth for app-level state (recents serialize/export later)
  const state = {
    recentColors: [],
    activeComponent: null,
    breakpoint: 'desktop',
    preview: false
  };

  function init() {
    /* ---- page container: the mount for all components. Its WIDTH is the
       breakpoint frame (desktop = full width; mobile = a narrow centred column),
       so switching breakpoint actually reflows + shows the mobile layout. ---- */
    const pageStyle = document.createElement('style');
    pageStyle.textContent =
      '.byo-page{position:relative;margin:0 auto;width:100%;min-height:100vh;}' +
      '.byo-page--mobile{width:414px;box-shadow:0 0 0 1px #e2e2e2;background:#fff;}';
    document.head.appendChild(pageStyle);
    const page = document.createElement('div');
    page.className = 'byo-page';
    document.body.appendChild(page);

    /* ---- sampling media (offscreen until the Texture panel mounts it) ----
       Created here, owned here, but DISPLAYED inside the Texture dev panel
       (BYO.TextureWindow moves the element into its viewer). Kept out of the
       normal page flow so the white page stays empty. */
    const video = document.createElement('video');
    video.muted = true;
    video.loop = true;
    video.autoplay = true;
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('muted', '');
    video.crossOrigin = 'anonymous';
    const mp4 = document.createElement('source');
    mp4.src = 'assets/sample.mp4'; mp4.type = 'video/mp4';
    const webm = document.createElement('source');
    webm.src = 'assets/sample.webm'; webm.type = 'video/webm';
    video.appendChild(webm);
    video.appendChild(mp4);
    video.play().catch(function () { /* autoplay may need a gesture; harmless */ });

    const img = document.createElement('img');
    img.src = 'assets/texture.png';
    img.crossOrigin = 'anonymous';

    /* ---- one or two text components on the blank page ----
       Two components prove "active follows the last-interacted component". */
    const a = BYO.TextComponent.create({
      mount: page,
      state: {
        pos: { anchor: 'tl', xPct: 6, yPct: 10, widthPct: 60 }, z: 0, tag: 'header',
        lines: [{ words: [
          { text: 'Bring', color: '' },
          { text: 'your', color: '' },
          { text: 'own', color: '' },
          { text: 'words.', color: '' }
        ] }]
      }
    });

    const b = BYO.TextComponent.create({
      mount: page,
      state: {
        pos: { anchor: 'tl', xPct: 6, yPct: 42, widthPct: 50 }, z: 0, tag: 'paragraph',
        lines: [{ words: [
          { text: 'Drop', color: '' },
          { text: 'this', color: '' },
          { text: 'component', color: '' },
          { text: 'on', color: '' },
          { text: 'an', color: '' },
          { text: 'empty', color: '' },
          { text: 'page.', color: '' }
        ] }],
        format: { family: '"Inter", Arial, sans-serif', weight: 400 }
      }
    });

    // component registry (single source of truth for the app: docking targets,
    // export, breakpoint switching). state.components is read by the dev UI.
    const components = [a, b];
    state.components = components;

    state.activeComponent = a;
    a.activate();

    // getActive: last-interacted (active/selected) component. Mirror into state.
    function getActive() {
      const active = BYO.TextComponent.getActive();
      if (active) state.activeComponent = active;
      return state.activeComponent;
    }

    /* ---- relative docking: when any box's geometry changes, re-resolve every
       box docked to it against the reference's live screen rect. ---- */
    function recomputeLayout() {
      components.forEach(function (c) {
        if (!c.dock) return;
        const ref = components.filter(function (x) { return x.id === c.dock.relTo; })[0];
        if (ref) c.applyDockFrom(ref.el.getBoundingClientRect());
      });
    }
    BYO.TextComponent.onGeometryChange(recomputeLayout);
    recomputeLayout();

    /* ---- click on empty page (not a component, not a panel) -> deselect ---- */
    document.addEventListener('mousedown', function (e) {
      const t = e.target;
      if (t.closest && (t.closest('.byo-textcomp') || t.closest('.byo-panel'))) return;
      BYO.TextComponent.deselect();
    });

    /* ---- attach the throwaway dev UI -----------------------------------
       The sampling sources live INSIDE the Texture panel (not page furniture). */
    BYO.DevUI.attach({
      getActive: getActive,
      state: state,
      sources: { video: video, img: img }
    });

    /* ---- H toggles all dev panels; P toggles preview (hide editing chrome,
       keep the warp cubes + gizmos live) ---- */
    function setPreview(on) {
      state.preview = !!on;
      components.forEach(function (c) { c.setPreview(state.preview); });
      if (state.preview) BYO.Panel.hideAll(); else BYO.Panel.showAll();
    }
    window.addEventListener('keydown', function (e) {
      const t = e.target;
      const typing = t && (t.isContentEditable ||
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing) return;
      if (e.key === 'h' || e.key === 'H') { e.preventDefault(); BYO.Panel.toggleAll(); }
      else if (e.key === 'p' || e.key === 'P') { e.preventDefault(); setPreview(!state.preview); }
    });

    /* ---- breakpoint switching: resize the page frame, then apply to EVERY box
       (the width change must land BEFORE each box re-applies its px layout). ---- */
    function setBreakpoint(bp) {
      state.breakpoint = bp === 'mobile' ? 'mobile' : 'desktop';
      page.classList.toggle('byo-page--mobile', state.breakpoint === 'mobile');
      components.forEach(function (c) { c.setBreakpoint(state.breakpoint); c._applyLayout(); });
      recomputeLayout();
      bpBtn.textContent = 'Breakpoint: ' + state.breakpoint;
    }

    /* ---- document persistence: JSON export / import + localStorage autosave.
       The document is { version, breakpoint, recentColors, components:[
       {breakpoint, variants:{desktop,mobile}} ] } — both breakpoints round-
       trip. (Structured so it can be emitted as Markdown+YAML later.) ---- */
    function exportDocument() {
      return {
        version: 1,
        breakpoint: state.breakpoint,
        recentColors: state.recentColors.slice(),
        components: components.map(function (c) { return c.serializeAll(); })
      };
    }
    function downloadDocument() {
      const blob = new Blob([JSON.stringify(exportDocument(), null, 2)], { type: 'application/json' });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url; link.download = 'studio-document.json';
      document.body.appendChild(link); link.click(); link.remove();
      URL.revokeObjectURL(url);
    }
    function importDocument(doc) {
      if (!doc || !Array.isArray(doc.components)) return;
      components.forEach(function (c) { c.destroy(); });
      components.length = 0;
      state.breakpoint = doc.breakpoint === 'mobile' ? 'mobile' : 'desktop';
      state.recentColors = Array.isArray(doc.recentColors) ? doc.recentColors : [];
      doc.components.forEach(function (cs) {
        const c = BYO.TextComponent.create({ mount: page });
        c.deserializeAll(cs);
        if (c.breakpoint !== state.breakpoint) c.setBreakpoint(state.breakpoint);
        components.push(c);
      });
      state.components = components;
      recomputeLayout();
      if (components[0]) components[0].activate();
      bpBtn.textContent = 'Breakpoint: ' + state.breakpoint;
    }

    /* ---- Document panel (app-level; stays while nothing is selected) ---- */
    const docPanel = BYO.Panel.create({ title: 'Document', id: 'devui-document', width: 200 });
    docPanel.setPosition(540, 16);
    function docBtn(label, fn) {
      const b = document.createElement('button');
      b.type = 'button'; b.textContent = label;
      b.style.cssText = 'width:100%;padding:5px;margin:2px 0;font:inherit;cursor:pointer;border:1px solid #ccc;border-radius:3px;background:#fff;';
      b.addEventListener('mousedown', function (e) { e.preventDefault(); });
      b.addEventListener('click', fn);
      docPanel.body.appendChild(b);
      return b;
    }
    const bpBtn = docBtn('Breakpoint: desktop', function () { setBreakpoint(state.breakpoint === 'desktop' ? 'mobile' : 'desktop'); });
    docBtn('Copy layout to other bp', function () { components.forEach(function (c) { c.copyToOtherBreakpoint(); }); });
    docBtn('Preview (P)', function () { setPreview(!state.preview); });
    docBtn('Export JSON', downloadDocument);
    const fileInput = document.createElement('input');
    fileInput.type = 'file'; fileInput.accept = 'application/json,.json'; fileInput.style.display = 'none';
    fileInput.addEventListener('change', function () {
      const f = fileInput.files && fileInput.files[0];
      if (!f) return;
      const reader = new FileReader();
      reader.onload = function () { try { importDocument(JSON.parse(reader.result)); } catch (err) { window.alert('Import failed: ' + err.message); } };
      reader.readAsText(f);
      fileInput.value = '';
    });
    docPanel.body.appendChild(fileInput);
    docBtn('Import JSON', function () { fileInput.click(); });

    /* ---- localStorage autosave (debounced periodic) + restore on load ---- */
    const LS_KEY = 'byo-studio-doc';
    function autosave() { try { localStorage.setItem(LS_KEY, JSON.stringify(exportDocument())); } catch (e) { /* quota / disabled */ } }
    try {
      const saved = localStorage.getItem(LS_KEY);
      if (saved) importDocument(JSON.parse(saved));
    } catch (e) { /* ignore corrupt save */ }
    setInterval(autosave, 5000);
    window.addEventListener('beforeunload', autosave);

    // expose for debugging / export-import
    state.setPreview = setPreview;
    state.setBreakpoint = setBreakpoint;
    state.recomputeLayout = recomputeLayout;
    state.exportDocument = exportDocument;
    state.importDocument = importDocument;
    window.__BYO_APP__ = { state: state, components: components, getActive: getActive, setPreview: setPreview, setBreakpoint: setBreakpoint, exportDocument: exportDocument, importDocument: importDocument };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
