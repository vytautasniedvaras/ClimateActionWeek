/* ===================================================================
   BYO.Editor — inline-formatting + paste helper for the text component.

   Owns the bits of "rich text editing" that the component needs (bold,
   italic, link, plain-text paste) WITHOUT taking ownership of the
   contenteditable DOM. The component's per-word `.byo-word` span model is
   the single source of truth: it drives the warp rasterizer (which reads
   each word's COMPUTED style), per-word colour, effects, and serialize.

   NOTE on Squire: the roadmap named Squire (UMD) for this. In practice an
   embedded rich-text editor OWNS the contenteditable and formats via nested
   <b>/<i>/<a> tags — which (a) the warp raster (one fillText per word, using
   the WORD span's computed font) would not pick up, and (b) split words
   across formatting boundaries, breaking the one-span-per-word model that
   colour / effects / serialize depend on. So inline format lives as per-word
   ATTRIBUTES (data-bold / data-italic / data-href) styled by CSS, so
   getComputedStyle(word) reflects them and the raster honours them. This
   keeps editing robust AND warp-correct.

   API:
     BYO.Editor.create(editableEl, { onChange }) -> {
       bold(spans), italic(spans), link(spans, url), unlink(spans),
       removeFormat(spans), isBold(spans), isItalic(spans), linkOf(spans),
       destroy()
     }
   Each formatter toggles attributes across ALL given spans (the component's
   current selection) and returns the resulting state. Plain-text paste is
   bound on the editable here.

   Classic-script IIFE on window.BYO — no ES modules.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  function _every(spans, fn) {
    if (!spans || !spans.length) return false;
    for (let i = 0; i < spans.length; i++) if (!fn(spans[i])) return false;
    return true;
  }

  // Insert plain text at the caret, preserving undo where possible. Returns
  // true if anything was inserted. Fires a synthetic 'input' on the fallback
  // path so the component's re-wrap runs (execCommand fires 'input' itself).
  function _insertPlainText(editable, text) {
    if (!text) return false;
    // strip CRLF -> LF; the component splits lines on block elements, so we
    // turn newlines into <div> blocks via execCommand's own handling / range.
    text = String(text).replace(/\r\n?/g, '\n');
    let ok = false;
    try { ok = document.execCommand('insertText', false, text); } catch (_) { ok = false; }
    if (ok) return true;
    // manual fallback: replace the current range with a text node
    const sel = window.getSelection();
    if (!sel || sel.rangeCount === 0) return false;
    const range = sel.getRangeAt(0);
    range.deleteContents();
    const node = document.createTextNode(text);
    range.insertNode(node);
    range.setStartAfter(node);
    range.collapse(true);
    sel.removeAllRanges();
    sel.addRange(range);
    editable.dispatchEvent(new Event('input', { bubbles: true }));
    return true;
  }

  function create(editable, opts) {
    opts = opts || {};
    const onChange = typeof opts.onChange === 'function' ? opts.onChange : function () {};

    // plain-text paste: never let the browser inject foreign markup into the
    // contenteditable (it would survive the re-wrap as stray tags).
    function onPaste(e) {
      const cd = e.clipboardData || window.clipboardData;
      if (!cd) return;
      const text = cd.getData('text/plain');
      e.preventDefault();
      if (_insertPlainText(editable, text)) onChange();
    }
    editable.addEventListener('paste', onPaste);

    function setAttr(spans, name, value) {
      (spans || []).forEach(function (s) {
        if (value == null) s.removeAttribute(name);
        else s.setAttribute(name, value);
      });
    }

    const api = {
      isBold: function (spans) { return _every(spans, function (s) { return s.getAttribute('data-bold') === '1'; }); },
      isItalic: function (spans) { return _every(spans, function (s) { return s.getAttribute('data-italic') === '1'; }); },
      // the shared href if all spans link to the same url, else ''
      linkOf: function (spans) {
        if (!spans || !spans.length) return '';
        const h = spans[0].getAttribute('data-href') || '';
        return _every(spans, function (s) { return (s.getAttribute('data-href') || '') === h; }) ? h : '';
      },

      // toggle: if every span is already on, turn the attribute off; else on.
      bold: function (spans) {
        const on = !api.isBold(spans);
        setAttr(spans, 'data-bold', on ? '1' : null);
        onChange();
        return on;
      },
      italic: function (spans) {
        const on = !api.isItalic(spans);
        setAttr(spans, 'data-italic', on ? '1' : null);
        onChange();
        return on;
      },
      link: function (spans, url) {
        url = (url == null ? '' : String(url)).trim();
        setAttr(spans, 'data-href', url || null);
        onChange();
        return url;
      },
      unlink: function (spans) { setAttr(spans, 'data-href', null); onChange(); },
      removeFormat: function (spans) {
        setAttr(spans, 'data-bold', null);
        setAttr(spans, 'data-italic', null);
        setAttr(spans, 'data-href', null);
        onChange();
      },

      destroy: function () { editable.removeEventListener('paste', onPaste); }
    };
    return api;
  }

  BYO.Editor = { create: create };
})();
