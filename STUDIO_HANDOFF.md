# Studio — Agent Handoff

Onboarding for the next agent picking up the `studio/` text component. Read this first,
then `STUDIO_ROADMAP.md` (product spec) and `studio/_TEXTCOMPONENT_SPEC.md` (frozen module spec).

---

## 0. Git / pushing (read first)

A previous remote session could **not push**: it was a stale snapshot with no GitHub write
credentials, so every change had to be handed off as a `git bundle` / `git format-patch` set that
the human applied locally with `git am` and pushed. Note: `git am` re-creates commits under **new
hashes**, so a bundle anchored to the original commit (`f613652…`) will fail with
`Repository lacks these prerequisite commits` — **prefer patches over bundles** for that workflow.

**If you are in a session with working git write access** (the GitHub connector is now added):
just branch, commit, `git push -u origin <branch>`, and open the PR normally. Verify first with:

```bash
git ls-remote origin >/dev/null && echo "read OK"
git push --dry-run origin HEAD 2>&1 | head   # if this prompts for a username, you have NO write creds
```

If you lack write creds, fall back to the patch-handoff: `git format-patch <base>..HEAD -o /tmp/patches`,
deliver the files, and have the human `git am` + push. (Branch from `prototypes`; PR base is `prototypes`.)

Conventions: branch off `prototypes`; commit messages and PR bodies end with the session URL footer;
do **not** put model identifiers in commits/PRs.

---

## 1. What this is

A reusable, droppable **rich-text component** that lands on an empty white page, built from small
classic-script modules on `window.BYO` (**no ES modules, no build step**). THREE r128 is a global
(loaded from unpkg in `studio/index.html`). The editing UI is throwaway dev scaffolding (floating
panels), NOT a site visual language.

**Core invariant:** the per-word `.byo-word` span set is the single source of truth. Everything —
per-word colour, inline format, texture fill, word effects, warp rasterization, serialize — reads/
writes those spans. Canvas/WebGL is used **only** for the warp render; DOM stays live everywhere else.

### File map (`studio/`)
- `index.html` — loads THREE, fonts, then libs in dependency order, then `app.js`.
- `app.js` — the only "page" code: creates the `.byo-page` frame + components, wires DevUI, document
  persistence (export/import + localStorage autosave), `H` (toggle panels) / `P` (preview),
  breakpoint + preview, the component registry + `recomputeLayout` (docking).
- `lib/text-component.js` — **the product** (`BYO.TextComponent`). The big file; see §3.
- `lib/editor.js` — `BYO.Editor`: inline bold/italic/link as per-word `data-*` attrs + plain-text paste.
- `lib/word-effects.js` — `BYO.WordEffects`: Scrub + AutoCycle + Perlin noise + SDG palette.
- `lib/dev-ui.js` — `BYO.DevUI`: the panels (Colour/Format/Layout/Warp/Texture/Effects), event-driven
  show/hide on the active component (no polling).
- `lib/panel.js` — `BYO.Panel`: floating, draggable, **collapsible** dev panels.
- `lib/warpbox.js` — `BYO.WarpBox`: the projected-cube warp effect (configurable `size`).
- `lib/warp-surface.js` — ray-box displacement shader plane.
- `lib/{color-panel,color-sampler,texture-window,fonts}.js` — colour picker, eyedropper, media
  sampler, font catalogue.
- Reused from `../projection-cube/lib/`: `color.js` (`BYO.color` OKLab), `stage.js`, `motion.js`,
  `gizmo.js` (the transform gizmo — shared with the projection-cube prototype, so edits affect both).

---

## 2. What's implemented (all merged into `prototypes`)

Round 1 (PR #1):
1. **Selection robustness** — `_selection` decoupled from the DOM Selection; multi-word colour/format
   no longer collapse to the first word; `focusout` snapshot + `restoreSelection()`; `mousedown
   preventDefault` on buttons + colour swatches (NOT range sliders — that breaks the thumb drag).
2. **Inline format + paste** (`editor.js`) — bold/italic/link as per-word `data-bold/italic/href`
   styled by CSS (so `getComputedStyle(word)` reflects them and the warp raster honours them).
3. **Contextual UI + free 2D positioning** — panels show/hide with the active component; boundary +
   margin shading + 8 handles; corner-anchor placement; relative docking; z-order.
4. **Warp cube GUI** — configurable `size`; Warp panel for size / 6 face offsets / position / rotation
   with two-way gizmo read-back. Gizmo hit targets + face-reveal widened.
5. **Word effects** (`word-effects.js`) — Scrub + AutoCycle + replacements editor.
6. **Breakpoints / preview / persistence** — per-breakpoint variants, Preview (P), JSON export/import
   + localStorage autosave.

Round 2 (PR #2, from human testing feedback):
7. **Warp usability** — overlay **overscans** the box (`WARP_OVERSCAN = 0.9` in text-component.js) so
   the cube + gizmo aren't clipped; overlay is `position:absolute` (scrolls with the box, was fixed);
   gizmo NDC computed from the **renderer-canvas rect** not the window (it renders into a sub-rect, so
   picking was miscalibrated — this was the main "warp unusable" cause).
8. **Dev-UI declutter** — `BYO.Panel` collapsible (click title bar; a <4px press = click, else drag);
   panels start collapsed.
9. **Viewable breakpoints** — components mount in a `.byo-page` frame whose **width is the breakpoint**
   (desktop = full, mobile = 414px centred). Layout is **px** relative to the frame width (x/width) +
   viewport height (y), re-applied on resize, so mobile actually reflows.

---

## 3. text-component.js — key internals

- **Per-word spans**: `.byo-word[data-color]` (+ `data-bold/italic/href`, `data-fx`). `_wrapLine`
  rebuilds `innerHTML` from `textContent` on every edit and **preserves these attrs by word index** —
  any new per-word state MUST be added to the capture + re-emit in `_wrapLine`.
- **Selection**: `_selection` array; `_pruneSelection` (input) vs `_refreshSelectionFromCaret`
  (keyup, narrows to caret word only when selection ≤ 1); `restoreSelection()` before mutating ops.
- **Positioning**: `pos = {anchor,xPct,yPct,widthPct}`, `dock = {relTo,side,gapPct}|null`, `z`.
  `_applyLayout` writes px from `mount` width + viewport height. Static hooks for the app/dev-ui:
  `onActiveChange`, `onGeometryChange` (docking recompute), `onSelectionChange`.
- **Warp**: `attachWarp/detachWarp`; `_positionWarpHost` (overscan + document coords + z mirror);
  `_rasterizeIntoWarp` (hi-DPI raster, offset by the overscan margin so text stays centred on the box;
  reads computed font incl. style/weight). `deserialize` detaches any existing warp first.
- **Effects**: `effects` map keyed by `data-fx` id; `addEffect/removeEffectFromSelection/
  selectionEffect/refreshEffects`. The controller lives in `word-effects.js`.
- **Breakpoints**: `variants = {desktop,mobile}` (full serialize payloads); `setBreakpoint`,
  `serializeAll/deserializeAll`, `copyToOtherBreakpoint`.
- **Serialize shape**: `{ pos, dock, z, tag, lines:[{words:[{text,color,bold?,italic?,href?,fill?,
  fx?}]}], format, warp:{enabled,surfaceOpts,config,size,model:{position,quaternion,faceOffset}} }`.

---

## 4. How to run & test

Served from the **repo root** (studio HTML references `../projection-cube/lib/...`):
```bash
python3 -m http.server 8042       # from repo root
# open http://127.0.0.1:8042/studio/index.html
```
Needs internet for THREE (unpkg) + Google fonts.

**Headless caveat:** in the cloud sandbox the datacenter IP is **403'd by unpkg/jsDelivr/cdnjs**, so
THREE won't load from the page. For Puppeteer smoke tests, vendor THREE via npm
(`npm i three@0.128.0`) and **intercept** the `three.min.js` request to serve the local copy (see the
pattern below). WebGL warp visuals are hard to verify headless; the *logic* (sizes, model values,
serialize) is testable. **Real mouse-drag gizmo picking has NOT been verified in a browser** — needs a
human or a scripted pointer test.

```js
// puppeteer request-interception sketch
page.on('request', r => r.url().includes('three.min.js')
  ? r.respond({ status:200, contentType:'application/javascript', body: THREE_SRC })
  : r.continue());
```

**Gotchas:**
- **localStorage autosave** (`byo-studio-doc`) overrides the default page on load. If you see stale
  content: `localStorage.removeItem('byo-studio-doc'); location.reload()`.
- A `favicon.ico` 404 in the console is harmless.

---

## 5. Open follow-ups / next tasks

- **Extrusion UV-stretch (true fix):** the warp vertex shader uses planar UVs (`vUv = uv` in
  `warp-surface.js`), so extruding a face stretches the text. Bounded + documented for now. Real fix =
  reproject UV from the displaced local position in the vert shader.
- **Mobile frame is width-only:** `.byo-page--mobile` constrains width (414px); there's no device-style
  viewport height. Add a height frame if mobile preview needs it.
- **Squire was intentionally NOT used:** an embedded editor owning the contenteditable formats via
  nested `<b>/<i>/<a>`, which breaks the one-span-per-word model (warp raster reads per-word computed
  style; colour/effects/serialize assume one span = one word). Inline format is per-word `data-*`
  attrs instead. Revisit only if richer editing is needed — it's a real refactor.
- **Warp raster** doesn't honour CSS letter/word-spacing (canvas `fillText` limitation).
- **Gizmo picking** was improved (wider targets, canvas-rect NDC) but should get a real
  pointer-drag test. Consider a "sticky reveal"/hold so a revealed handle doesn't flicker before grab.
- Media boxes (image/video) are future; the positioning/z model is generic so they layer in the same
  stack (see `STUDIO_ROADMAP.md` §G).

---

## 6. Verification checklist (manual, in a browser)
1. Multi-word select → Colour/Format → all selected words update (not just the first).
2. Bold/italic/link; paste stays plain; format survives typing.
3. Click box → boundary + 8 handles + panels; click empty → hide. Panels collapse on title click.
4. Drag a corner (move), edges (resize width / nudge), set Z, dock to another box.
5. Enable warp → drag the on-cube **gizmo** (the key untested path) + move Warp panel sliders; cube +
   gizmo not clipped; warp stays on the box when scrolling.
6. Toggle desktop/mobile (Document panel) → mobile reflows to the 414px frame; each keeps its layout.
7. Preview (P) → chrome hidden, warp + gizmo stay live.
8. Export JSON → Import → reproduces text/colour/format/position/z/warp/effects + both breakpoints.
