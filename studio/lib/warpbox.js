/* ===================================================================
   BYO.WarpBox — an attachable effect that warps ANY caller-supplied
   2D canvas onto an invisible, mouse-driven cube, on its OWN overlay
   BYO.Stage sized/positioned over a host container. Reuses the proven
   projected-cube composition VERBATIM (BYO.Stage + BYO.Motion +
   BYO.Gizmo + BYO.WarpSurface) with ZERO word/text/word-data specifics:
   the only content is the CanvasTexture fed via setSourceCanvas().

   Owns the single transform model {position, quaternion, faceOffset}
   (Gizmo edits it through incremental callbacks, never directly) and
   runs the FROZEN frame loop:
     gizmo.update -> hover-to-stop motion.step
       -> cube.quaternion = spin * model.quaternion (straight while drag)
       -> gizmo.follow(cube) -> derive boxMin/boxMax
       -> surface.update(boxMin, boxMax, cube.matrixWorld) -> render.

   Classic-script IIFE on window.BYO (no ES modules); globals: THREE,
   window.BYO (Stage/Motion/Gizmo/WarpSurface).
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  // local axis world vectors for rotate callbacks (uses live cube orientation)
  const AXV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  const clamp = (v, lo, hi) => (v < lo ? lo : v > hi ? hi : v);
  // faceOffset clamp range (frozen): [-0.9, 3]
  const OFF_LO = -0.9, OFF_HI = 3;
  const CUBE_SIZE = 1;            // DEFAULT base half-extent (matches projected-cube CONFIG.cubeSize)
  const SIZE_LO = 0.1, SIZE_HI = 4;  // configurable cube-size range (GUI bound)
  let _seq = 0;                   // unique overlay-canvas id per instance

  class WarpBox {
    constructor(container, opts) {
      // fail loud + early if the FROZEN load order was broken (see dom.html /
      // webgl.html): WarpBox composes these lib singletons and is useless
      // without them. A clear message beats an opaque "undefined" deref.
      if (!BYO.Stage || !BYO.Motion || !BYO.Gizmo || !BYO.WarpSurface) {
        throw new Error('WarpBox requires BYO.Stage, BYO.Motion, BYO.Gizmo and BYO.WarpSurface to be loaded first');
      }
      opts = opts || {};
      this.container = container;
      // configurable cube base half-extent (was the hard-coded CUBE_SIZE);
      // the Warp panel binds this via setSize(). Bounds derive from it.
      this.size = clamp(opts.size != null ? opts.size : CUBE_SIZE, SIZE_LO, SIZE_HI);
      this._raf = 0;
      this._visible = true;
      this._tex = null;            // CanvasTexture wrapping the caller's source canvas
      this._clock = new THREE.Clock();

      /* ---- per-frame mouse velocity (overlay-local glue, not reusable) ---- */
      this._ptr = { x: 0, y: 0, px: 0, py: 0, moved: false, has: false };
      this._onMouseMove = (e) => {
        const p = this._ptr;
        if (!p.has) { p.px = e.clientX; p.py = e.clientY; p.has = true; }
        p.x = e.clientX; p.y = e.clientY; p.moved = true;
      };
      addEventListener('mousemove', this._onMouseMove);

      /* ---- shared transform model: recessed rest pose, identity orientation ---- */
      this.model = {
        position: new THREE.Vector3(0, 0, -1.2),
        quaternion: new THREE.Quaternion(),
        faceOffset: { xp: 0, xn: 0, yp: 0, yn: 0, zp: 0, zn: 0 }
      };

      /* ---- overlay canvas sized/positioned over the container ---- */
      const canvas = document.createElement('canvas');
      canvas.id = 'byo-warpbox-' + (++_seq);
      Object.assign(canvas.style, {
        position: 'absolute', left: '0', top: '0',
        width: '100%', height: '100%', display: 'block',
        pointerEvents: 'none'        // overlay never eats container pointer events;
      });                            // Gizmo binds its own window listeners for dragging
      // ensure the container can host an absolutely-positioned overlay
      const cs = getComputedStyle(container);
      if (cs.position === 'static') container.style.position = 'relative';
      container.appendChild(canvas);
      this.canvas = canvas;

      /* ---- lib singletons (own Stage; Gizmo/Motion/WarpSurface ride it) ---- */
      const stage = BYO.Stage.create({
        canvasId: canvas.id,
        fov: opts.fov,                                   // Stage supplies CAM_FOV default
        dist: opts.dist,                                 // Stage supplies CAM_DIST default
        renderScale: opts.renderScale != null ? opts.renderScale : 1.5
      });
      this.stage = stage;

      const motion = BYO.Motion.create(opts.motion || {}); // Motion fills its own defaults
      this.motion = motion;

      // keep the opts object reference: WarpSurface.deriveProjection reads it
      // live, so a GUI can mutate surfaceOpts.projection/facingCut at runtime.
      this.surfaceOpts = {
        projection: opts.projection != null ? opts.projection : 0,
        facingCut: opts.facingCut != null ? opts.facingCut : 0
      };
      const surface = BYO.WarpSurface.create(stage, this.surfaceOpts);
      this.surface = surface;

      const gizmo = new BYO.Gizmo(stage, {});
      this.gizmo = gizmo;

      /* ---- cube Object3D (transform carrier; bounds derived from faceOffset) ---- */
      const cube = new THREE.Object3D();
      stage.scene.add(cube);
      this.cube = cube;
      this._boxMin = new THREE.Vector3();
      this._boxMax = new THREE.Vector3();
      this._dq = new THREE.Quaternion();   // scratch for rotate callback

      /* ---- gizmo wiring: INCREMENTAL deltas; we apply + clamp the model ---- */
      const worldAxis = (name) => AXV[name].clone().applyQuaternion(cube.quaternion).normalize();
      gizmo.onTranslate = (axis, dWorld) => {
        this.model.position.add(dWorld);
        gizmo.setTransform(this.model);
      };
      gizmo.onRotate = (axis, dAng) => {
        this._dq.setFromAxisAngle(worldAxis(axis), dAng);
        this.model.quaternion.premultiply(this._dq);
        gizmo.setTransform(this.model);
      };
      gizmo.onFaceExtrude = (faceId, dOff) => {
        this.model.faceOffset[faceId] = clamp(this.model.faceOffset[faceId] + dOff, OFF_LO, OFF_HI);
        gizmo.setTransform(this.model);     // bounds re-derived from faceOffset each frame
      };
      // on drop: fold the accumulated spin into the rest orientation, reset motion
      gizmo.onDragEnd = () => {
        this.model.quaternion.copy(cube.quaternion);
        motion.reset();
        gizmo.setTransform(this.model);
      };

      /* ---- build geometry + place at rest before first frame ---- */
      surface.build();
      this._deriveBounds();
      cube.position.copy(this.model.position);
      cube.quaternion.copy(this.model.quaternion);
      gizmo.setTransform(this.model);
      gizmo.setVisible(this._visible);

      /* ---- resize: own sizing to the CONTAINER (not the window) ---- */
      this._onResize = () => this.resize();
      addEventListener('resize', this._onResize);
      this.resize();
    }

    /* derive local bounds from faceOffset (epsilon guard so boxMax > boxMin in shader) */
    _deriveBounds() {
      const fo = this.model.faceOffset, b = this.size, mn = this._boxMin, mx = this._boxMax;
      mx.set(b + fo.xp, b + fo.yp, b + fo.zp);
      mn.set(-(b + fo.xn), -(b + fo.yn), -(b + fo.zn));
      mx.x = Math.max(mx.x, mn.x + 1e-3);
      mx.y = Math.max(mx.y, mn.y + 1e-3);
      mx.z = Math.max(mx.z, mn.z + 1e-3);
    }

    /* resize() — public (studio WARP CONTRACT): size renderer + camera to the
       CONTAINER element box (the overlay canvas tracks it via width/height:100%),
       then rebuild the WarpSurface plane for the new drawing-buffer size. This is
       the fix for the projection shader failing on window resize: the plane is
       rebuilt to match the renderer aspect instead of going stale.
       Safe to call any time (e.g. when the host text-component re-rasterizes). */
    resize() {
      const r = this.container.getBoundingClientRect();
      const w = Math.max(1, Math.round(r.width)), h = Math.max(1, Math.round(r.height));
      const st = this.stage;
      st.applyDPR();
      st.renderer.setSize(w, h, false);  // (false = don't touch the CSS size; canvas is 100%/100%)
      st.camera.aspect = w / h;
      st.camera.updateProjectionMatrix();
      this.surface.resize();             // rebuild plane to the new drawing-buffer aspect
    }

    /* content warped onto the cube: wrap caller's 2D canvas in a CanvasTexture.
       (Animated sources stay live: needsUpdate is flagged each frame in the loop.) */
    setSourceCanvas(canvas2d) {
      if (this._tex) this._tex.dispose();   // free the previous CanvasTexture (no GPU leak on re-raster)
      const tex = new THREE.CanvasTexture(canvas2d);
      tex.premultiplyAlpha = true;
      // linear (no mipmaps): hi-dpi rasterized text is already supersampled, so
      // mipmap downsampling would only blur the crisp glyphs at glancing angles.
      tex.minFilter = THREE.LinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = false;
      tex.wrapS = tex.wrapT = THREE.ClampToEdgeWrapping;
      tex.anisotropy = this.stage.maxAniso;
      this._tex = tex;
      this.surface.setTexture(tex);
    }

    /* per-frame mouse velocity in pixels (consumed once, then reset) */
    _velocity() {
      const p = this._ptr; let vx = 0, vy = 0;
      if (p.moved) { vx = p.x - p.px; vy = p.y - p.py; p.px = p.x; p.py = p.y; p.moved = false; }
      return { vx, vy };
    }

    /* FROZEN frame loop order (mirrors projected-cube.js) */
    _frame() {
      this._raf = requestAnimationFrame(() => this._frame());
      const dt = Math.min(this._clock.getDelta(), 0.05);
      const { vx, vy } = this._velocity();

      this.gizmo.update();                                   // reveal/hover/drag -> fires callbacks
      const cube = this.cube, model = this.model;
      if (this.gizmo.isDragging) {                           // gizmo owns the transform mid-drag
        cube.position.copy(model.position);
        cube.quaternion.copy(model.quaternion);              // straight from model while dragging
      } else {
        // isDragging is already handled by the outer branch, so it is always
        // false here; the only stop signal in this path is hover.
        const stop = this.gizmo.isHovering;  // hover-to-stop
        const { spin } = this.motion.step(dt, vx, vy, stop, false);
        cube.position.copy(model.position);
        cube.quaternion.multiplyQuaternions(spin, model.quaternion);  // spin * rest
      }
      this.gizmo.follow(cube);                               // gizmo tracks full orientation

      // boxMin/boxMax are LOCAL cube-space bounds (derived purely from
      // faceOffset, independent of world transform). The shader transforms
      // world points into this local frame via uCubeInv (= inverse matrixWorld)
      // and intersects against these local bounds, so the order here only needs
      // matrixWorld refreshed before surface.update() reads it.
      this._deriveBounds();
      cube.updateMatrixWorld();
      if (this._tex) this._tex.needsUpdate = true;           // keep animated sources live
      this.surface.update(this._boxMin, this._boxMax, cube.matrixWorld);
      this.stage.renderer.render(this.stage.scene, this.stage.camera);
    }

    start() { if (!this._raf) { this._clock.getDelta(); this._frame(); } }   // swallow first dt
    stop() { if (this._raf) { cancelAnimationFrame(this._raf); this._raf = 0; } }

    // configurable cube size (GUI). Bounds re-derive from it each frame, so a
    // change takes effect immediately; clamp keeps boxMax > boxMin valid.
    setSize(v) { this.size = clamp(+v || CUBE_SIZE, SIZE_LO, SIZE_HI); }

    get config() { return this.motion.config; }   // live motion config (GUI two-way binds it)
    get isHovering() { return this.gizmo.isHovering; }
    get isDragging() { return this.gizmo.isDragging; }
    setVisible(v) {
      this._visible = !!v;
      this.gizmo.setVisible(this._visible);
      if (this.surface.mesh) this.surface.mesh.visible = this._visible;
    }

    dispose() {
      this.stop();
      removeEventListener('resize', this._onResize);
      removeEventListener('mousemove', this._onMouseMove);
      if (this._tex) this._tex.dispose();
      if (this.surface.mesh) {
        if (this.surface.mesh.geometry) this.surface.mesh.geometry.dispose();
        this.stage.scene.remove(this.surface.mesh);
      }
      if (this.surface.material) this.surface.material.dispose();
      if (this.gizmo.root) this.stage.scene.remove(this.gizmo.root);
      this.stage.scene.remove(this.cube);
      this.stage.renderer.dispose();
      if (this.canvas && this.canvas.parentNode) this.canvas.parentNode.removeChild(this.canvas);
    }
  }

  BYO.WarpBox = WarpBox;
})();
