/* ===================================================================
   BYO.Panel — minimal floating dev-scaffolding panels.

   Throwaway utilitarian editing UI, NOT a site visual language: a plain
   light box with a small system font, header-draggable, position:fixed
   (so it never affects page layout / flow), high z-index. The product is
   the text component on the empty white page; these panels just drive it.

   API (frozen, per studio/_TEXTCOMPONENT_SPEC.md):
     BYO.Panel.create({ title, id, width=240 })
       -> { el, body, show(), hide(), toggle(), setPosition(x,y), destroy() }
     BYO.Panel.toggleAll() / hideAll() / showAll()  — over a live registry
       (app.js binds H to toggleAll()).

   Classic-script IIFE on window.BYO (no ES modules). No deps.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  // Live registry of created panels, so toggleAll/hideAll/showAll can act
  // over every panel without the app tracking them. destroy() removes from it.
  const registry = [];

  // Inject the one shared stylesheet once. Scoped to .byo-panel so it cannot
  // leak into the host page / component. Deliberately plain — no theme chrome.
  let styleInjected = false;
  function ensureStyle() {
    if (styleInjected) return;
    styleInjected = true;
    const css = `
.byo-panel {
  position: fixed;
  z-index: 2147483000;
  width: 240px;
  background: #fafafa;
  color: #1a1a1a;
  border: 1px solid #c9c9c9;
  border-radius: 4px;
  box-shadow: 0 4px 14px rgba(0,0,0,0.14);
  font-family: -apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
  font-size: 12px;
  line-height: 1.4;
  box-sizing: border-box;
  user-select: none;
}
.byo-panel, .byo-panel * { box-sizing: border-box; }
.byo-panel__header {
  display: flex;
  align-items: center;
  padding: 6px 9px;
  font-size: 11px;
  font-weight: 600;
  letter-spacing: 0.02em;
  text-transform: uppercase;
  color: #555;
  background: #efefef;
  border-bottom: 1px solid #d8d8d8;
  border-radius: 4px 4px 0 0;
  cursor: grab;
}
.byo-panel__header.byo-panel--dragging { cursor: grabbing; }
.byo-panel__title {
  flex: 1 1 auto;
  white-space: nowrap;
  overflow: hidden;
  text-overflow: ellipsis;
}
.byo-panel__body {
  padding: 9px;
  user-select: text;
}
.byo-panel--hidden { display: none; }
`;
    const style = document.createElement('style');
    style.id = 'byo-panel-style';
    style.textContent = css;
    document.head.appendChild(style);
  }

  // Cascade default position for panels created without an explicit one, so
  // they don't all stack at 0,0. Steps down-right per created panel.
  let cascade = 0;

  function create(opts) {
    opts = opts || {};
    ensureStyle();

    const title = opts.title != null ? String(opts.title) : '';
    const id = opts.id != null ? String(opts.id) : '';
    const width = opts.width != null ? opts.width : 240;

    const el = document.createElement('div');
    el.className = 'byo-panel';
    if (id) el.dataset.panelId = id;
    el.style.width = width + 'px';

    const header = document.createElement('div');
    header.className = 'byo-panel__header';

    const titleEl = document.createElement('span');
    titleEl.className = 'byo-panel__title';
    titleEl.textContent = title;
    header.appendChild(titleEl);

    const body = document.createElement('div');
    body.className = 'byo-panel__body';

    el.appendChild(header);
    el.appendChild(body);

    // Initial cascade position (overridable via setPosition). Wraps so a long
    // list of panels stays on-screen-ish; the app typically positions them.
    const step = 18;
    const baseX = 16 + (cascade % 6) * 28;
    const baseY = 16 + (cascade % 6) * 28 + Math.floor(cascade / 6) * step;
    cascade++;
    let posX = baseX, posY = baseY;

    function setPosition(x, y) {
      posX = x;
      posY = y;
      el.style.left = posX + 'px';
      el.style.top = posY + 'px';
      // explicit left/top wins; clear any right/bottom that might linger
      el.style.right = 'auto';
      el.style.bottom = 'auto';
    }
    setPosition(posX, posY);

    // --- header drag (pointer events; capture so it tracks outside the panel)
    let dragging = false, grabDX = 0, grabDY = 0, activePointer = null;

    function onPointerDown(e) {
      // primary button / touch only; ignore if interacting with body controls
      if (e.button != null && e.button !== 0) return;
      dragging = true;
      activePointer = e.pointerId;
      const rect = el.getBoundingClientRect();
      grabDX = e.clientX - rect.left;
      grabDY = e.clientY - rect.top;
      header.classList.add('byo-panel--dragging');
      if (header.setPointerCapture) {
        try { header.setPointerCapture(e.pointerId); } catch (_) {}
      }
      e.preventDefault();
    }
    function onPointerMove(e) {
      if (!dragging || (activePointer != null && e.pointerId !== activePointer)) return;
      setPosition(e.clientX - grabDX, e.clientY - grabDY);
    }
    function onPointerUp(e) {
      if (!dragging || (activePointer != null && e.pointerId !== activePointer)) return;
      dragging = false;
      activePointer = null;
      header.classList.remove('byo-panel--dragging');
      if (header.releasePointerCapture) {
        try { header.releasePointerCapture(e.pointerId); } catch (_) {}
      }
    }
    header.addEventListener('pointerdown', onPointerDown);
    header.addEventListener('pointermove', onPointerMove);
    header.addEventListener('pointerup', onPointerUp);
    header.addEventListener('pointercancel', onPointerUp);

    function show() { el.classList.remove('byo-panel--hidden'); }
    function hide() { el.classList.add('byo-panel--hidden'); }
    function toggle() { el.classList.toggle('byo-panel--hidden'); }

    function destroy() {
      header.removeEventListener('pointerdown', onPointerDown);
      header.removeEventListener('pointermove', onPointerMove);
      header.removeEventListener('pointerup', onPointerUp);
      header.removeEventListener('pointercancel', onPointerUp);
      if (el.parentNode) el.parentNode.removeChild(el);
      const i = registry.indexOf(panel);
      if (i !== -1) registry.splice(i, 1);
    }

    document.body.appendChild(el);

    const panel = { el, body, show, hide, toggle, setPosition, destroy };
    registry.push(panel);
    return panel;
  }

  // --- registry-wide controls -----------------------------------------
  // toggleAll uses the first panel's state as the reference so the set flips
  // together (rather than each panel independently inverting) — H feels like
  // a single "show/hide the dev UI" switch.
  function isHidden(p) { return p.el.classList.contains('byo-panel--hidden'); }
  function hideAll() { registry.forEach(function (p) { p.hide(); }); }
  function showAll() { registry.forEach(function (p) { p.show(); }); }
  function toggleAll() {
    if (!registry.length) return;
    const anyVisible = registry.some(function (p) { return !isHidden(p); });
    if (anyVisible) hideAll(); else showAll();
  }

  BYO.Panel = { create, toggleAll, hideAll, showAll };
})();
