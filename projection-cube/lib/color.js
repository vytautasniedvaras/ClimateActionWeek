/* ===================================================================
   BYO.color — pure colour math + the perceptual face-gradient texture
   factory. No THREE-scene knowledge beyond THREE.CanvasTexture; the 6
   cube faces only need 3 distinct gradients, so textures are cached.
   OKLab matrices/gamma are copied VERBATIM from the frozen spec (2.1).
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  /* sRGB component <-> linear: 0.04045 split, gamma 2.4 (spec authoritative). */
  function lin(c) { return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4); }
  function srgb(c) {
    c = c <= 0.0031308 ? 12.92 * c : 1.055 * Math.pow(c, 1 / 2.4) - 0.055;
    return c < 0 ? 0 : c > 1 ? 1 : c;  // clamp [0,1]
  }

  function hexToRgb(hex) {
    // Accept 0xRRGGBB number, '#rgb', '#rrggbb'. -> {r,g,b} in [0,1].
    if (typeof hex === 'number') {
      return { r: ((hex >> 16) & 255) / 255, g: ((hex >> 8) & 255) / 255, b: (hex & 255) / 255 };
    }
    let s = String(hex).replace('#', '');
    if (s.length === 3) s = s[0] + s[0] + s[1] + s[1] + s[2] + s[2];  // expand shorthand
    const n = parseInt(s, 16);
    return { r: ((n >> 16) & 255) / 255, g: ((n >> 8) & 255) / 255, b: (n & 255) / 255 };
  }

  function rgbToHex(r, g, b) {
    // inputs [0,1] -> '#rrggbb'
    const h = (c) => {
      let v = Math.round((c < 0 ? 0 : c > 1 ? 1 : c) * 255).toString(16);
      return v.length === 1 ? '0' + v : v;
    };
    return '#' + h(r) + h(g) + h(b);
  }

  function rgbToOklab(r, g, b) {
    // sRGB -> linear
    r = lin(r); g = lin(g); b = lin(b);
    // linear RGB -> LMS
    const l = 0.4122214708 * r + 0.5363325363 * g + 0.0514459929 * b;
    const m = 0.2119034982 * r + 0.6806995451 * g + 0.1073969566 * b;
    const s = 0.0883024619 * r + 0.2817188376 * g + 0.6299787005 * b;
    const l_ = Math.cbrt(l), m_ = Math.cbrt(m), s_ = Math.cbrt(s);
    // LMS -> OKLab
    return {
      L: 0.2104542553 * l_ + 0.7936177850 * m_ - 0.0040720468 * s_,
      a: 1.9779984951 * l_ - 2.4285922050 * m_ + 0.4505937099 * s_,
      b: 0.0259040371 * l_ + 0.7827717662 * m_ - 0.8086757660 * s_
    };
  }

  function oklabToRgb(o) {
    // inverse OKLab -> LMS
    const l_ = o.L + 0.3963377774 * o.a + 0.2158037573 * o.b;
    const m_ = o.L - 0.1055613458 * o.a - 0.0638541728 * o.b;
    const s_ = o.L - 0.0894841775 * o.a - 1.2914855480 * o.b;
    const l = l_ * l_ * l_, m = m_ * m_ * m_, s = s_ * s_ * s_;
    // LMS -> linear RGB, then linear -> sRGB (clamped in srgb())
    return {
      r: srgb(4.0767416621 * l - 3.3077115913 * m + 0.2309699292 * s),
      g: srgb(-1.2684380046 * l + 2.6097574011 * m - 0.3413193965 * s),
      b: srgb(-0.0041960863 * l - 0.7034186147 * m + 1.7076147010 * s)
    };
  }

  function oklabLerp(a, b, t) {
    // per-component linear mix (perceptual because we mix in OKLab)
    return { L: a.L + (b.L - a.L) * t, a: a.a + (b.a - a.a) * t, b: a.b + (b.b - a.b) * t };
  }

  /* module-private cache: 6 faces -> 3 distinct textures, keyed by inputs. */
  const _texCache = new Map();

  // canonical hex string for cache keys (so 0xff3653 and '#ff3653' collapse to one key)
  function _hexKey(c) { return typeof c === 'number' ? '#' + (c >>> 0).toString(16).padStart(6, '0') : String(c); }

  function makeFaceGradientTexture(colA, colB, opts) {
    opts = opts || {};
    const size = opts.size || 128;
    let edgeFade = opts.edgeFade != null ? opts.edgeFade : 0.18;
    if (!(edgeFade > 0)) edgeFade = 0.18;   // guard div-by-zero / NaN edgeFade (spec default)
    const key = _hexKey(colA) + '|' + _hexKey(colB) + '|' + size + '|' + edgeFade;
    if (_texCache.has(key)) return _texCache.get(key);

    const ca = hexToRgb(colA), cb = hexToRgb(colB);
    const oa = rgbToOklab(ca.r, ca.g, ca.b);
    const ob = rgbToOklab(cb.r, cb.g, cb.b);

    const cv = document.createElement('canvas');
    cv.width = cv.height = size;
    const ctx = cv.getContext('2d');
    const img = ctx.createImageData(size, size);
    const px = img.data;
    const denom = size - 1;

    for (let y = 0; y < size; y++) {
      const v = y / denom;
      for (let x = 0; x < size; x++) {
        const u = x / denom;
        const rgb = oklabToRgb(oklabLerp(oa, ob, u));   // gradient runs along u (first in-plane axis)
        // alpha: edges opaque, centre transparent. d=edge distance; d=0 ->1, d>=edgeFade ->0; squared falloff.
        const d = Math.min(u, 1 - u, v, 1 - v);
        let alpha = (edgeFade - d) / edgeFade;   // edgeFade>0 guaranteed above
        alpha = Math.max(0, Math.min(1, alpha));  // explicit safe clamp
        alpha = alpha * alpha;
        const i = (y * size + x) * 4;
        px[i] = Math.round(rgb.r * 255);
        px[i + 1] = Math.round(rgb.g * 255);
        px[i + 2] = Math.round(rgb.b * 255);
        px[i + 3] = Math.round(alpha * 255);
      }
    }
    ctx.putImageData(img, 0, 0);

    const tex = new THREE.CanvasTexture(cv);
    tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
    tex.needsUpdate = true;
    _texCache.set(key, tex);
    return tex;
  }

  BYO.color = {
    hexToRgb: hexToRgb,
    rgbToHex: rgbToHex,
    rgbToOklab: rgbToOklab,
    oklabToRgb: oklabToRgb,
    oklabLerp: oklabLerp,
    makeFaceGradientTexture: makeFaceGradientTexture
  };
})();
