# Studio — Text Component (frozen module spec)

We are building **one reusable text component** out of **separate, interconnecting modules** that drop onto an
**empty white page**. The editing UI is **throwaway dev scaffolding** — utilitarian floating panels, NOT a site
visual language. Do NOT add themed top bars / brand chrome / dark site styling. The product is the component.

Served app (http://127.0.0.1:8042, repo root). Classic scripts on `window.BYO` — **NO ES modules**. THREE r128
global. Reuse, do not rewrite: `../projection-cube/lib/{color,stage,motion,gizmo}.js`,
`studio/lib/{warp-surface,color-sampler,warpbox}.js`. Read each before calling it. Run `node --check` per file.

## Harness (the empty white page) — `studio/index.html` + `studio/app.js`
- `index.html`: white background, no chrome. `<head>` loads THREE, the Google variable fonts (Inter + Roboto
  Flex, with system fallback), then in dependency order: color, stage, motion, gizmo, warp-surface,
  color-sampler, warpbox, panel, fonts, color-panel, texture-window, text-component, then `app.js`.
- `app.js`: the only "page" code. Creates one or two `BYO.TextComponent` on the blank page, holds the app
  state `{ recentColors: [], activeComponent }`, and calls `BYO.DevUI.attach({ getActive, state, sources })`.
  Sources for sampling (`<video>` + `<img>` from `assets/`) live INSIDE a TextureWindow dev panel — NOT as
  page furniture. This file proves the component works on an empty page.

## Module: `studio/lib/panel.js` -> `BYO.Panel` (dev scaffolding)
Minimal floating, draggable panel. No theme — plain light box, small system font, just enough to be usable.
- `BYO.Panel.create({ title, id, width=240 }) -> { el, body, show(), hide(), toggle(), setPosition(x,y), destroy() }`
  - `el` is `position:fixed`, draggable by its header, `z-index` high, does NOT affect page layout.
- `BYO.Panel.toggleAll()` / `hideAll()` / `showAll()` — `app.js` binds **H** to `toggleAll()`.

## Module: `studio/lib/fonts.js` -> `BYO.Fonts`
- `BYO.Fonts.DISPLAY` = array of `{ label, stack }` Helvetica-family display fonts
  (e.g. `"Helvetica Neue, Helvetica, Arial, sans-serif"`, plus an Inter variable option).
- `BYO.Fonts.PARAGRAPH` = modern Arial-like grotesks for body (e.g. Inter, Roboto Flex variable, system grotesk).
- Each entry may have `variable: { wght:[min,max], opsz?:[...], wdth?:[...], slnt?:[...] }` for variable axes.
- `BYO.Fonts.apply(els, { family, weight, letterSpacing, wordSpacing, variation })` — sets
  `fontFamily, fontWeight, letterSpacing(px), wordSpacing(px), fontVariationSettings`. `variation` is
  `{ wght, wdth, slnt, opsz }` -> `font-variation-settings: 'wght' N, ...`.
- `BYO.Fonts.isVariable(stack) -> entry|null` so the format panel can show axis sliders only when relevant.

## Module: `studio/lib/color-panel.js` -> `BYO.ColorPanel`
A perceptual **solid-colour** picker as dev-panel content. Built on `BYO.color` (OKLab) + `BYO.ColorSampler`.
- `BYO.ColorPanel.create(panelBody) -> instance`
- `instance.open({ hex, onChange, onCommit, sources, recent })`
  - Renders: an **OKLCH 2D square** (x = chroma, y = lightness) + a **hue slider**; a draggable marker.
  - **Live**: dragging/clicking fires `onChange(hex)` continuously (recolours the live selection in real time).
  - **Re-click repositions** the marker to the clicked point (re-pick), not just a no-op.
  - **HEX** input + **R/G/B** inputs accept paste/typing -> `onChange`.
  - **Recent palette**: render `recent` (array of hex, newest first) as swatches; click -> `onChange` + move marker.
  - **One-time eyedropper** button: `BYO.ColorSampler.createEyedropper({ sources, onPick })` — single pick ->
    `onChange(hex)` + `onCommit(hex)` + stop. Esc cancels. (This is where the one-time sample lives.)
  - `onCommit(hex)` fires on release / enter / swatch / eyedropper-pick — the app uses it to push into recent-10.
- `instance.setRecent(arr)`; `instance.setColor(hex)`.
- Recent colours are owned by app state (so they serialize/export later); the panel only renders + reports.

## Module: `studio/lib/texture-window.js` -> `BYO.TextureWindow`
Media viewer with an interactive sample window, as dev-panel content.
- `BYO.TextureWindow.create(panelBody, { source }) -> instance`
  - Shows `source` (video|img) fit into the panel; overlays a **draggable + resizable rectangle** (the sample
    window). Each `requestAnimationFrame`, mirrors the source region under the rect into `instance.sampleCanvas`.
  - `mode`: `'fixed'` = rect is relative to the media frame (samples that part of the asset, default);
    `'floating'` = rect is fixed in **screen** space over the scrolling page (samples whatever scrolls under it).
    `instance.setMode('fixed'|'floating')`.
  - `instance.sampleCanvas` (a live `<canvas>`, working res ~256) usable as a CSS `background-clip:text` fill or
    a THREE texture. `instance.getRect()`, `instance.setSource(el)`, `instance.onUpdate(cb)`, `instance.dispose()`.

## Module: `studio/lib/text-component.js` -> `BYO.TextComponent` (THE product)
A self-contained, droppable rich-text component. Scene-agnostic except it composes a `BYO.WarpBox` for the warp
effect. Knows nothing about the dev panels — it exposes an API they drive.

`BYO.TextComponent.create({ mount, state }) -> instance`
- Renders a block into `mount` (default `document.body`) on a blank page.
- **Layout**: positioned by `leftPct` + `rightPct` (percent insets from the page's left/right; default 0/0 =
  full width). **Height is auto from content** (grows with text). Provide visible **drag handles** on the left &
  right edges that update `leftPct`/`rightPct` live. (Vertical stacking/offset is a later phase — for now it sits
  in normal flow / at a given top.)
- **Rich text**: `contenteditable`; content is lines; every word wrapped in `<span class="byo-word" data-color>`.
  Re-wrap on edit, preserving caret + exact per-word `data-color` (authoritative hex; never lose precision to
  computed rgb()).
- **Multi-word selection**: click selects a word; **shift+click** extends a contiguous range; **drag** across
  words selects multiple; selected words get a marker class; `instance.getSelection() -> [spanEls]`. All
  colour/format ops apply to the WHOLE selection.
- **Per-word colour**: `instance.setColor(hex)` sets `data-color` + `style.color` on every selected word.
- **Texture fill**: `instance.fillWithTexture(sampleCanvas)` fills selected words via `background-clip:text`
  using the live sample canvas (mask per word from the word's exact text+font); `instance.clearFill()`. Outline
  option when empty.
- **Formatting**: `instance.applyFormat({ family, weight, letterSpacing, wordSpacing, variation })` to the
  selection (uses `BYO.Fonts.apply`). `instance.setTag('header'|'paragraph'|'untagged')` on the focused block
  (tag styling shared across same-tag components is a later phase — store the tag now).
- **Effects (warp)**: `instance.attachWarp(opts)` / `instance.detachWarp()` / `instance.isWarped`. attachWarp:
  - Build ONE `BYO.WarpBox` whose overlay is sized + positioned **exactly over this component's screen rect**.
  - Feed it a **high-resolution rasterization** of THIS component's text:
    **rasterize at `rect * devicePixelRatio * SS` (SS≈2)** with font scaled to match — this FIXES the pixelation.
  - While warped, **hide the component's flat DOM text** (visibility:hidden on the words) so only the cube
    projection shows — this FIXES the warp/flat-text disconnect.
  - Re-rasterize on text edit and on **resize** (see resize requirement).
  - Expose the warp's config + transform model for the Warp dev panel: `instance.warp` (the WarpBox) with its
    `config` (projection, facingCut, motion params) + `model`.
- **Resize**: the component listens to window resize and, if warped, rebuilds the WarpBox overlay sizing +
  re-rasterizes. **This must fix the current "shaders fail on resize" bug** — WarpBox/WarpSurface need a
  `resize()` that rebuilds the plane + renderer size; call it. (Add `resize()` to warpbox.js/warp-surface.js if
  missing.)
- **Serialize**: `instance.serialize() -> plain JSON` = `{ leftPct, rightPct, tag, lines:[{ words:[{ text,
  color, fill? }] }], format, warp:{ enabled, config, model } }`. `instance.deserialize(state)` rebuilds it.
  (App-level `recentColors` are serialized by the app, not the component, but keep the shape compatible.)

## Module: `studio/lib/dev-ui.js` -> `BYO.DevUI` (throwaway scaffolding)
Wires editing panels to the active component + its selection. Minimal, utilitarian. Toggle all with **H**.
- `BYO.DevUI.attach({ getActive, state, sources }) -> { }`
  - Floating panels (via `BYO.Panel`): **Colour** (BYO.ColorPanel, live -> active.setColor, commit -> push
    state.recentColors keep last 10), **Format** (BYO.Fonts family/weight/spacing/variable-axis -> active
    .applyFormat), **Layout** (leftPct/rightPct number inputs + reflect drag handles), **Warp** (toggle +
    projection/edge/spin sliders bound to active.warp.config — "active panel follows the last-interacted
    component/widget"), **Texture** (BYO.TextureWindow over `sources`; "fill selection" -> active.fillWithTexture
    (textureWindow.sampleCanvas)).
  - `getActive()` returns the last-interacted TextComponent. Panels retarget when the active component changes.
  - `state.recentColors` is the single source of truth for recents (so export/import covers them later).

## Acceptance
- `studio/index.html` is an EMPTY WHITE PAGE with one/two text components and floating dev panels (H hides them).
- No themed site chrome / top bars.
- Warp is crisp (high-DPI raster) and replaces the flat text (no disconnect); survives window resize.
- Components positioned via left/right % + drag handles; height auto.
- Multi-word selection; colour panel updates the selection LIVE; recent-10 palette; re-click repositions; HEX/RGB
  paste; one-time eyedropper in the colour panel.
- Texture sample window (fixed/floating) fills selected words with live media.
- Fonts: Helvetica display + modern grotesk paragraph + weight/spacing + variable axes.
- `serialize()/deserialize()` round-trips a component (incl. warp + colours); app round-trips recentColors.
