# Climate Action Week — Studio (authoring tool) roadmap

Captured from the product brief. This is the source-of-truth feature spec. The build principle is
**independently-testable modules, connected later** — each module ships with a tiny standalone test
harness (`<module>/__test__.html`) that loads only that module + its deps, so it works before the whole
app exists. The in-flight `projection-cube/` modular refactor (`BYO.*`) is the first such module and
becomes the **WarpBox** effect.

> Status legend: ⬜ not started · 🟡 in progress · ✅ done · ❓ needs decision

---

## A. Foundational decisions (block everything — see questions)
- ❓ **Runtime/serving**: served app + ES modules (CORS media + sampling realistically need a server) vs
  strict `file://` classic-scripts (current cube) vs served-but-no-build classic-scripts.
- ❓ **Text rendering model**: DOM rich-text + attachable WebGL/canvas effect layers vs all-WebGL.
- ❓ **First slice to build**.
- **Persistence (assumed)**: a **Markdown file (YAML frontmatter for settings + body for content)** is the
  canonical document. Export writes it; Import recreates the exact experience (users never need the GUI).
  Import is built generic now so it can be pointed at a `.md` file trivially later.

## B. Known bug to fix (after the cube refactor lands)
- ⬜ **Resize breaks shaders**: need a single resize/screen-change **callback bus** that every effect/object
  subscribes to (rebuild render targets, plane geometry, textures). Fixes the current projection-cube
  resize failure and is the responsive backbone.

---

## C. Document & layout system
- ⬜ **Vertical stacked layout** of objects (text boxes, media, AV boxes). Page scrolls; can grow forever.
- ⬜ **End-of-page marker**: a black line, only visible on hover; scroll stops there (else infinite).
- ⬜ **Object positioning**: by **height offset from the object directly above (or top)** + **side offsets**.
  Distance is **visualised while dragging**.
- ⬜ **Per-breakpoint geometry**: separate **desktop** and **mobile** position/size settings on every object.
  A global **desktop/mobile preview toggle** applies to all objects at once.
- ⬜ **Drag handles** on anchor points.
- ⬜ **Persistent bottom toolbar** (does NOT scroll): add text box / image-video / AV box / effect, add
  end-of-page marker, import, export, desktop⇄mobile toggle, language selector.
- ⬜ **Per-object**: delete button; **duplicate** (clones all settings, inserts directly below, pushing the
  rest down).

## D. Text box
- ⬜ **Anchors**: top-left corner + **max width as a ratio of screen width**; content flows below per styling.
- ⬜ **Tags**: `header` / `paragraph` / `untagged`. New boxes spawn **`ungrouped`** (its own unique font opts).
  Changing header (or paragraph) size/font/styling updates **all** header (or paragraph) boxes together,
  **per breakpoint**. Per-word interactive colors are exempt from the shared styling.
- ⬜ **Typography**: keep current display font; **add a second paragraph font** (institutional/formal yet
  critical-arts — slick, clear, smart; educated pick, e.g. a grotesk like *Söhne/Inter-tight* for display +
  a readable serif/grotesk for body — TBD). Weight **options** (slider + numeric readout, copyable),
  character spacing, size, color.
- ⬜ **Inline editor basics**: bold, italic, weight slider(+number), **link**.
- ⬜ **Color**: default black; default per-word colors use the **current SDG palette** (random assign);
  selectable via **perceptual color picker**, or pasting **RGB**/**HEX**.
- ⬜ **Languages**: each box stores variants per selected language — **English, Brazilian Portuguese,
  Guaraní** (extensible).
- ⬜ **`<InteractiveReplace>`**: select a word → panel lists replacement words it cycles through on user
  interaction. Each replacement word has an assigned color (palette random initially; user can recolor via
  the perceptual grid).

## E. Color system (reusable everywhere)
- ⬜ **Perceptual picker**: OKLab/OKLCH grid (reuses `projection-cube/lib/color.js`). Plus RGB/HEX paste.
- ⬜ **Eyedropper**: sample the color **under the pointer** over video/image/**text**; a visibility toggle
  (contrast or contrasting outline) keeps the cursor readable. Sets the selected word's color.
- ⬜ **Texture-as-color**: a **fixed (non-scrolling) sampling window** placed on screen; as content scrolls
  under it, it grabs the underlying **media texture** and applies it as the selected text's fill. Optional
  **outline** when nothing is underneath.

## F. Effects (attachable to a text box; multiple instances allowed)
- ⬜ **Effect host**: attach/detach effects to a box; more than one per box. **GUI focus follows the
  last-interacted widget**; but **widget edits apply to all instances of that effect simultaneously**
  (e.g. all WarpBoxes move together; the panel just reflects the last-touched one). *(confirm semantics)*
- 🟡 **WarpBox** = the current projected-cube. Wrap `BYO.Stage/Motion/TextProjection/Gizmo` as an
  attachable effect (depends on the in-flight refactor).
- ⬜ **AVBox**: reuse the box object, extended — **self-rotation** (independent of hover) + toggle for
  hover-heading interaction; **media on selected faces** (single- or double-sided). Built on `BYO.Gizmo` +
  the box face model.

## G. Media box (image / video / later 360 video)
- ⬜ Sourced from **R2 public CORS-enabled** links. Image or video; **360 later**.
- ⬜ **Video playback**: autoplay with correct **iOS/Android unlock** (muted-autoplay/inline, gesture
  fallback — possibly a first-play button), HTTPS, **default audio on**, **default loop**.
- ⬜ Can be a **color source** for text (eyedropper + texture-as-color).
- ⬜ **Color border**: custom color (picker or sample), adjustable thickness.
- ⬜ **Transform**: translate, **even (uniform) scale**, rotate; positions relative to sides + object above;
  distance visualised while moving; desktop/mobile variants.

## H. Suggested module map (names provisional; final layout depends on Decision A)
```
core/resize-bus        screen-change callback bus (fixes shader resize)   [B,C]
core/store             document model + markdown (de)serialize            [A persistence]
core/layout            stacked layout, scroll, end-marker, drag handles   [C]
core/responsive        desktop/mobile mode + preview toggle               [C]
text/textbox           the text box component                            [D]
text/typography        font registry + shared tag-style groups            [D]
text/interactive-replace  <InteractiveReplace> word widget                [D]
i18n/languages         language selection + per-box variants              [D]
color/perceptual-picker  OKLab grid + RGB/HEX (reuses lib/color.js)        [E]
color/eyedropper       sample-under-pointer over media/text               [E]
color/texture-sampler  fixed window → media texture as text fill          [E]
effects/effect-host    attach/detach, multi-instance, shared-edit GUI     [F]
effects/warpbox        wraps BYO.* projected cube                         [F]
effects/avbox          media-on-faces box, self-spin                      [F,G]
media/media-box        image/video/360, autoplay unlock, border, xform    [G]
toolbar/bottom-bar     persistent add/import/export/preview controls      [C]
app                    wires everything                                   [all]
```

## I. Phasing
- **P0 (now)**: finish `BYO.*` cube refactor → reusable WarpBox foundation; add resize-bus + fix shaders.
- **P1**: core (resize-bus, responsive, layout/scroll, store/markdown) + TextBox MVP (tags, inline format,
  fonts, desktop/mobile, drag handles, add/delete/duplicate, end-marker) + bottom toolbar.
- **P2**: perceptual picker + per-word color + InteractiveReplace + languages.
- **P3**: effect host + WarpBox attach + AVBox.
- **P4**: media boxes (autoplay unlock, borders, transforms) + eyedropper + texture-as-color.
- **P5**: full export/import fidelity + polish.

## J. Open semantic questions to revisit
- Effects "active on all instances simultaneously": do all WarpBoxes truly share one transform, or are they
  independently editable with the panel just reflecting the last-touched one?
- Markdown schema for interactive-replace, per-word color, effect attachments, media embeds (custom fenced
  syntax vs HTML-in-md).
- 360 video projection model (equirect sphere) — deferred.
