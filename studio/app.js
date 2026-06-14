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
    activeComponent: null
  };

  function init() {
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
      mount: document.body,
      state: {
        leftPct: 6, rightPct: 6, tag: 'header',
        lines: [{ words: [
          { text: 'Bring', color: '' },
          { text: 'your', color: '' },
          { text: 'own', color: '' },
          { text: 'words.', color: '' }
        ] }]
      }
    });

    const b = BYO.TextComponent.create({
      mount: document.body,
      state: {
        leftPct: 6, rightPct: 30, tag: 'paragraph',
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

    // give the second block some breathing room below the first
    b.el.style.marginTop = '28px';

    state.activeComponent = a;
    BYO.TextComponent._active = a;

    // getActive: last-interacted component (TextComponent tracks it on focus /
    // mousedown). Mirror it into app state so export covers the active id.
    function getActive() {
      const active = BYO.TextComponent.getActive() || a;
      state.activeComponent = active;
      return active;
    }

    /* ---- attach the throwaway dev UI -----------------------------------
       The sampling sources live INSIDE the Texture panel (not page furniture). */
    BYO.DevUI.attach({
      getActive: getActive,
      state: state,
      sources: { video: video, img: img }
    });

    /* ---- H toggles all dev panels (the dev UI is throwaway scaffolding) ---- */
    window.addEventListener('keydown', function (e) {
      // ignore while typing into the component / an input
      const t = e.target;
      const typing = t && (t.isContentEditable ||
        t.tagName === 'INPUT' || t.tagName === 'TEXTAREA' || t.tagName === 'SELECT');
      if (typing) return;
      if (e.key === 'h' || e.key === 'H') {
        e.preventDefault();
        BYO.Panel.toggleAll();
      }
    });

    // expose for debugging / future export-import
    window.__BYO_APP__ = { state: state, components: [a, b], getActive: getActive };
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', init);
  } else {
    init();
  }
})();
