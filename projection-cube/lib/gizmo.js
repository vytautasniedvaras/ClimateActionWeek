/* ===================================================================
   BYO.Gizmo — reusable, scene-agnostic transform widget. Absorbs the old
   Gizmo + GizmoControl: builds geometry, owns pointer handling, runs
   reveal/hover/drag, emits INCREMENTAL deltas via callbacks. NEVER mutates
   the model and knows nothing of scene content (no config/words/text/
   word-data/shader globals) — pass `stage`+`config` + model via setTransform().
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  // axis colours (frozen) — kept local so the gizmo has zero external deps
  const AXIS_COL = { x: 0xff3653, y: 0x3bd200, z: 0x2c8fff };
  const AXV = { x: new THREE.Vector3(1, 0, 0), y: new THREE.Vector3(0, 1, 0), z: new THREE.Vector3(0, 0, 1) };
  // face-table: outward local normal axis + sign + the two in-plane gradient axis colours
  const FACES = {
    xp: { ax: 'x', s: 1, cA: AXIS_COL.y, cB: AXIS_COL.z }, xn: { ax: 'x', s: -1, cA: AXIS_COL.y, cB: AXIS_COL.z },
    yp: { ax: 'y', s: 1, cA: AXIS_COL.x, cB: AXIS_COL.z }, yn: { ax: 'y', s: -1, cA: AXIS_COL.x, cB: AXIS_COL.z },
    zp: { ax: 'z', s: 1, cA: AXIS_COL.x, cB: AXIS_COL.y }, zn: { ax: 'z', s: -1, cA: AXIS_COL.x, cB: AXIS_COL.y }
  };
  const ARC_DEFS = [ // arc plane (a,b) -> rotation axis (perpendicular, colours the arc)
    { a: 'x', b: 'y', axis: 'z' }, { a: 'y', b: 'z', axis: 'x' }, { a: 'x', b: 'z', axis: 'y' }
  ];
  const PRIORITY = { faceExtrude: 4, rotate: 3, translate: 1 };
  const DEFAULTS = {
    arrowLen: 1.1, headLen: 0.12, shaftR: 0.007, headR: 0.03,
    // wider + longer-range face reveal so an extruded face stays grabbable
    // (was 0.5/0.14 -> the handle vanished mid-extrude and could not be pulled
    //  back); larger hit quad below makes the face easier to grab.
    faceRectSize: 0.24, faceRevealNear: 1.0, faceRevealFar: 0.06,
    extrudeArrowLen: 0.34, extrudeArrowGap: 0.16,
    // wider rotation-arc sector + radial hit band + reveal so the rotation
    // arrows can be picked from many more viewing angles (was the hardest grab).
    arcRadius: 0.62, arcTube: 0.008, arcThetaMin: 0.18, arcThetaMax: 1.39,
    arcHitInner: 0.40, arcHitOuter: 0.84, arcHoverHalf: 0.30, arcReveal: 0.30,
    screenScale: 0.16, hoverGrow: 1.4, hoverLong: 1.15
  };
  const BASE = 1; // gizmo-local reference half-extent (root.scale maps it to world; no scene size dep)

  class Gizmo {
    constructor(stage, config = {}) {
      this.stage = stage; this.cfg = Object.assign({}, DEFAULTS, config);
      this.model = { position: new THREE.Vector3(), quaternion: new THREE.Quaternion(), faceOffset: { xp: 0, xn: 0, yp: 0, yn: 0, zp: 0, zn: 0 } };
      this.onTranslate = this.onRotate = this.onFaceExtrude = this.onDragStart = this.onDragEnd = null;  // consumer assigns; deltas INCREMENTAL
      this.root = new THREE.Object3D(); stage.scene.add(this.root);
      this._pick = []; this._visible = true; this._hovering = false;
      this._mx = 0; this._my = 0; this._hasPtr = false;
      this._active = null;               // current drag descriptor incl. its own start anchors
      this._ray = new THREE.Raycaster(); this._ndc = new THREE.Vector2();
      this._t1 = new THREE.Vector3(); this._t2 = new THREE.Vector3(); this._t3 = new THREE.Vector3();
      this._plane = new THREE.Plane(); this._hit = new THREE.Vector3();
      this._build(); this._bindPointer();
    }

    _mat(c, o) { return new THREE.MeshBasicMaterial({ color: c, transparent: true, opacity: o || 0.9, depthTest: false, depthWrite: false }); }  // geometry (built once)
    _hidden() { return new THREE.MeshBasicMaterial({ visible: false }); }
    _reg(m, info) { m.userData.gz = info; m.renderOrder = 999; this._pick.push(m); this.root.add(m); return m; }
    _build() {
      this._arrows = {}; this._faces = {}; this._arcs = {};
      for (const ax in AXV) this._arrows[ax] = this._buildArrow(ax);
      for (const id in FACES) this._faces[id] = this._buildFace(id);
      for (const d of ARC_DEFS) this._arcs[d.axis] = this._buildArc(d);
    }
    // translate arrow: shaft + vertex-coloured cone (hover blends apex->white) + hidden hit cyl
    _buildArrow(ax) {
      const cfg = this.cfg, col = AXIS_COL[ax], g = new THREE.Group();
      const shaft = new THREE.Mesh(new THREE.CylinderGeometry(cfg.shaftR, cfg.shaftR, cfg.arrowLen, 8), this._mat(col)); shaft.position.y = cfg.arrowLen / 2;
      const cg = new THREE.ConeGeometry(cfg.headR, cfg.headLen, 12);
      const c = new THREE.Color(col), n = cg.attributes.position.count, colors = new Float32Array(n * 3), apex = [];
      for (let i = 0; i < n; i++) {        // seed flat axis colour; remember apex verts (top of cone)
        colors[i * 3] = c.r; colors[i * 3 + 1] = c.g; colors[i * 3 + 2] = c.b;
        if (cg.attributes.position.getY(i) >= cfg.headLen / 2 - 1e-4) apex.push(i);
      }
      cg.setAttribute('color', new THREE.BufferAttribute(colors, 3));
      const head = new THREE.Mesh(cg, new THREE.MeshBasicMaterial({ vertexColors: true, transparent: true, opacity: 0.9, depthTest: false, depthWrite: false })); head.position.y = cfg.arrowLen + cfg.headLen / 2;
      const hit = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, cfg.arrowLen + cfg.headLen, 6), this._hidden());
      hit.position.y = (cfg.arrowLen + cfg.headLen) / 2; g.add(shaft, head, hit);
      if (ax === 'x') g.rotation.z = -Math.PI / 2; if (ax === 'z') g.rotation.x = Math.PI / 2;  // +Y -> axis
      this._reg(g, { kind: 'translate', axis: ax }); Object.assign(g.userData, { head, apex, cg, col: c }); return g;
    }
    // face group: OKLab gradient rect (rides the extruded face) + outward arrow + forgiving hit quad
    _buildFace(id) {
      const f = FACES[id], cfg = this.cfg, g = new THREE.Group();
      const rect = new THREE.Mesh(new THREE.PlaneGeometry(cfg.faceRectSize, cfg.faceRectSize),
        new THREE.MeshBasicMaterial({ map: BYO.color.makeFaceGradientTexture(f.cA, f.cB), transparent: true, side: THREE.DoubleSide, depthTest: false, depthWrite: false }));
      const aShaft = new THREE.Mesh(new THREE.CylinderGeometry(cfg.shaftR, cfg.shaftR, cfg.extrudeArrowLen, 8), this._mat(f.cA)); aShaft.position.y = cfg.extrudeArrowGap + cfg.extrudeArrowLen / 2;
      const aHead = new THREE.Mesh(new THREE.ConeGeometry(cfg.headR, cfg.headLen, 12), this._mat(f.cA)); aHead.position.y = cfg.extrudeArrowGap + cfg.extrudeArrowLen + cfg.headLen / 2;
      const hit = new THREE.Mesh(new THREE.PlaneGeometry(cfg.faceRectSize * 2.2, cfg.faceRectSize * 2.2), this._hidden());
      rect.renderOrder = aHead.renderOrder = aShaft.renderOrder = hit.renderOrder = 999; g.add(rect, aShaft, aHead, hit);
      g.quaternion.setFromUnitVectors(AXV.y, AXV[f.ax].clone().multiplyScalar(f.s)); // +Y -> outward normal
      this._reg(g, { kind: 'faceExtrude', faceId: id }); g.visible = false; return g;
    }
    // rotation arc: thin mid-sector base + wide hidden annular hit proxy + thicker hover seg w/ end heads
    _buildArc(d) {
      const cfg = this.cfg, col = AXIS_COL[d.axis], grp = new THREE.Group();
      const tlen = cfg.arcThetaMax - cfg.arcThetaMin, hw = cfg.arcHoverHalf, R = cfg.arcRadius;
      // local frame: X=a, Y=b, Z=normal; torus sweeps +X->+Y, base rotated to start at arcThetaMin
      grp.quaternion.setFromRotationMatrix(new THREE.Matrix4().makeBasis(AXV[d.a], AXV[d.b], AXV[d.a].clone().cross(AXV[d.b]).normalize()));
      const base = new THREE.Mesh(new THREE.TorusGeometry(R, cfg.arcTube, 6, 48, tlen), this._mat(col, 0.8));
      const hit = new THREE.Mesh(new THREE.TorusGeometry(R, (cfg.arcHitOuter - cfg.arcHitInner) / 2, 6, 48, tlen), this._hidden());
      base.rotation.z = hit.rotation.z = cfg.arcThetaMin;
      const hover = new THREE.Group(), hg = new THREE.ConeGeometry(cfg.arcTube * 3.2, 0.055, 10);
      const seg = new THREE.Mesh(new THREE.TorusGeometry(R, cfg.arcTube * 2.4, 8, 24, 2 * hw), this._mat(col));
      const hEnd = new THREE.Mesh(hg, this._mat(col)), hStart = new THREE.Mesh(hg, this._mat(col)); // tangent arrowheads at seg ends (+ / -)
      hEnd.position.set(R * Math.cos(2 * hw), R * Math.sin(2 * hw), 0); hEnd.quaternion.setFromUnitVectors(AXV.y, new THREE.Vector3(-Math.sin(2 * hw), Math.cos(2 * hw), 0));
      hStart.position.set(R, 0, 0); hStart.quaternion.setFromUnitVectors(AXV.y, new THREE.Vector3(0, -1, 0));
      hover.add(seg, hEnd, hStart); hover.visible = false; grp.add(base, hit, hover);
      const info = { kind: 'rotate', axis: d.axis, a: d.a, b: d.b };
      grp.userData.gz = info; hit.userData.gz = info; grp.userData.hover = hover; grp.renderOrder = 999; grp.visible = false;
      this.root.add(grp); this._pick.push(hit); return grp;
    }

    /* ==== public API ==== Reads only; never mutates. setTransform stores a reference (no copy):
       consumer is the single source of truth and re-syncs each frame; call it again after any edit. */
    setTransform(model) { this.model = model; this._placeFaces(); }
    setVisible(v) { this._visible = v; this.root.visible = v; }
    get isDragging() { return !!this._active; }
    get isHovering() { return this._hovering; }
    // follow(target): reads only .position / .quaternion; root scaled for constant screen size
    follow(target) {
      this.root.position.copy(target.position); this.root.quaternion.copy(target.quaternion);
      this.root.scale.setScalar(this.root.position.distanceTo(this.stage.camera.position) * this.cfg.screenScale);
    }
    // per-frame BEFORE render: drag math (fires callbacks) or reveal+hover+hit-test
    update() {
      if (this._active) { this._drag(); this._hovering = true; return; }
      this._hovering = false;
      if (!this._hasPtr || !this._visible) return;
      this._setNdcRay(this._mx, this._my);
      this._placeFaces(); this._updateReveal(); this._updateArcHover();
      const hit = this._hitTest();
      this._updateArrowHover(hit);
      this._hovering = !!hit;
      document.body.style.cursor = hit ? 'grab' : 'pointer';
    }
    _scale() { return this.root.scale.x || 1; }   // world transforms (model is source of truth)
    _worldAxis(name) { return AXV[name].clone().applyQuaternion(this.model.quaternion).normalize(); }
    _faceCentre(id) { const f = FACES[id]; return AXV[f.ax].clone().multiplyScalar(f.s * (BASE + (this.model.faceOffset[id] || 0))).applyQuaternion(this.model.quaternion).add(this.model.position); }
    _faceNormal(id) { const f = FACES[id]; return AXV[f.ax].clone().multiplyScalar(f.s).applyQuaternion(this.model.quaternion).normalize(); }
    // reposition the 6 face groups to their current face-centres (gizmo-local, ride faceOffset)
    _placeFaces() { for (const id in this._faces) { const f = FACES[id]; this._faces[id].position.copy(AXV[f.ax]).multiplyScalar(f.s * (BASE + (this.model.faceOffset[id] || 0))); } }
    // NDC must be relative to the RENDERER CANVAS rect, not the whole window:
    // in the studio the warp renders into a sub-rect overlay, so window-relative
    // NDC would mis-map every pick. (For a full-window canvas this is identical.)
    _setNdcRay(cx, cy) {
      const el = this.stage && this.stage.renderer && this.stage.renderer.domElement;
      const r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : { left: 0, top: 0, width: innerWidth, height: innerHeight };
      const w = r.width || innerWidth, h = r.height || innerHeight;
      this._ndc.set(((cx - r.left) / w) * 2 - 1, -((cy - r.top) / h) * 2 + 1);
      this._ray.setFromCamera(this._ndc, this.stage.camera);
    }
    _rayPlane(origin, normal, out) { this._plane.setFromNormalAndCoplanarPoint(normal, origin); return this._ray.ray.intersectPlane(this._plane, out); }
    // closest-approach distance from ray to a world point, in gizmo-local units
    _rayPointDist(wp) {
      const ro = this._ray.ray.origin, rd = this._ray.ray.direction;
      return this._t2.copy(ro).addScaledVector(rd, this._t1.copy(wp).sub(ro).dot(rd)).distanceTo(wp) / this._scale();
    }
    // drag plane that contains an axis and faces the camera as much as possible
    _axisDragNormal(axisDir) {
      const toCam = this._t1.copy(this.stage.camera.position).sub(this.model.position);
      const n = this._t2.copy(axisDir).cross(toCam).cross(axisDir);
      if (n.lengthSq() < 1e-6) n.copy(toCam);
      return n.normalize().clone();
    }
    // analytic polar coords of the ray's hit on an arc plane -> {r, ang, planeDist} or null
    _arcPolar(d) {
      const wa = this._worldAxis(d.a), wb = this._worldAxis(d.b), wn = this._t3.copy(wa).cross(wb).normalize();
      if (!this._rayPlane(this.model.position, wn, this._hit)) return null;
      const rel = this._t1.copy(this._hit).sub(this.model.position), sc = this._scale();
      return { r: Math.hypot(rel.dot(wa), rel.dot(wb)) / sc, ang: Math.atan2(rel.dot(wb), rel.dot(wa)), planeDist: Math.abs(rel.dot(wn)) / sc };
    }
    _inSector(p) { const c = this.cfg; return p && p.r >= c.arcHitInner && p.r <= c.arcHitOuter && p.ang >= c.arcThetaMin && p.ang <= c.arcThetaMax; }
    _updateReveal() {   // reveal / hover (per-frame, before hit-test)
      const cfg = this.cfg, camPos = this.stage.camera.position;
      // faces: ray closest-approach to world face-centre in (far, near) AND face camera-facing (RESOLVED DECISION 1)
      for (const id in this._faces) {
        const wc = this._faceCentre(id), dl = this._rayPointDist(wc), facing = this._faceNormal(id).dot(this._t3.copy(camPos).sub(wc)) > 0;
        this._faces[id].visible = facing && dl < cfg.faceRevealNear && dl > cfg.faceRevealFar;
      }
      // arcs: ray-distance to arc plane < arcReveal AND polar hit inside the sector
      for (const d of ARC_DEFS) { const p = this._arcPolar(d); this._arcs[d.axis].visible = !!p && p.planeDist < cfg.arcReveal && this._inSector(p); }
    }
    // arc hover: show/thicken the hover segment of a revealed arc, centred on the pointer angle
    _updateArcHover() {
      const cfg = this.cfg;
      for (const d of ARC_DEFS) {
        const grp = this._arcs[d.axis], hover = grp.userData.hover;
        if (!grp.visible) { hover.visible = false; continue; }
        const p = this._arcPolar(d), on = this._inSector(p); hover.visible = on;
        if (on) hover.rotation.z = Math.min(Math.max(p.ang, cfg.arcThetaMin + cfg.arcHoverHalf), cfg.arcThetaMax - cfg.arcHoverHalf) - cfg.arcHoverHalf;
      }
    }
    // arrow head hover: blend apex vertex colours toward WHITE + scale by (grow, long, grow)
    _updateArrowHover(hit) {
      const cfg = this.cfg, hovAx = hit && hit.kind === 'translate' ? hit.axis : null;
      for (const ax in this._arrows) {
        const g = this._arrows[ax], col = g.userData.col, attr = g.userData.cg.attributes.color, lit = ax === hovAx;
        for (const i of g.userData.apex) lit ? attr.setXYZ(i, (col.r + 1) / 2, (col.g + 1) / 2, (col.b + 1) / 2) : attr.setXYZ(i, col.r, col.g, col.b);
        g.userData.head.scale.set(lit ? cfg.hoverGrow : 1, lit ? cfg.hoverLong : 1, lit ? cfg.hoverGrow : 1); attr.needsUpdate = true;
      }
    }
    _hitTest() {   // PRIORITY + analytic arc gate
      const list = this._pick.filter(m => { let n = m; while (n) { if (n.visible === false) return false; n = n.parent; } return true; });
      let best = null;
      for (const h of this._ray.intersectObjects(list, true)) {
        let o = h.object; while (o && !o.userData.gz) o = o.parent;
        if (!o) continue;
        const info = o.userData.gz;
        if (info.kind === 'rotate' && !this._inSector(this._arcPolar(info))) continue; // gate the wide proxy
        const pr = PRIORITY[info.kind] || 0;
        if (!best || pr > best.pr || (pr === best.pr && h.distance < best.dist)) best = { info, pr, dist: h.distance };
      }
      return best ? best.info : null;
    }
    _begin(info) {   // drag: record start anchors per kind
      const a = { kind: info.kind, axis: info.axis, faceId: info.faceId }, o = this.model.position;
      if (info.kind === 'translate') {
        a.axisDir = this._worldAxis(info.axis); a.dragN = this._axisDragNormal(a.axisDir); a.startHit = this._rayPlane(o, a.dragN, new THREE.Vector3()).clone(); a.last = a.startHit.clone();
      } else if (info.kind === 'rotate') {
        a.axisDir = this._worldAxis(info.axis); this._rayPlane(o, a.axisDir, this._hit); a.refVec = this._hit.clone().sub(o).normalize();
      } else { // faceExtrude
        a.normal = this._faceNormal(info.faceId); a.centre = this._faceCentre(info.faceId);
        this._rayPlane(a.centre, a.normal, this._hit); a.lastDist = this._hit.clone().sub(a.centre).dot(a.normal);
      }
      this._active = a;
      if (this.onDragStart) this.onDragStart({ kind: info.kind, axis: info.axis, faceId: info.faceId });
    }
    _drag() {
      this._setNdcRay(this._mx, this._my);
      const a = this._active, o = this.model.position;
      if (a.kind === 'translate') {
        if (!this._rayPlane(a.startHit, a.dragN, this._hit)) return;       // FIXED plane anchored at start hit
        const amt = this._t1.copy(this._hit).sub(a.last).dot(a.axisDir);    // incremental along axis since last frame
        if (this.onTranslate) this.onTranslate(a.axis, a.axisDir.clone().multiplyScalar(amt)); a.last.copy(this._hit);
      } else if (a.kind === 'rotate') {
        if (!this._rayPlane(o, a.axisDir, this._hit)) return;
        const cur = this._t1.copy(this._hit).sub(o).normalize();
        const ang = Math.atan2(this._t2.copy(a.refVec).cross(cur).dot(a.axisDir), a.refVec.dot(cur)); // incremental
        if (this.onRotate) this.onRotate(a.axis, ang); a.refVec = cur.clone();
      } else { // faceExtrude
        if (!this._rayPlane(a.centre, a.normal, this._hit)) return;
        const dist = this._t1.copy(this._hit).sub(a.centre).dot(a.normal);
        if (this.onFaceExtrude) this.onFaceExtrude(a.faceId, (dist - a.lastDist) / this._scale()); a.lastDist = dist; // incremental gizmo-local
      }
    }
    _end() { if (!this._active) return; this._active = null; if (this.onDragEnd) this.onDragEnd(); }
    _bindPointer() {   // pointer plumbing: own listeners on window
      addEventListener('mousemove', e => { this._mx = e.clientX; this._my = e.clientY; this._hasPtr = true; });
      addEventListener('mousedown', e => {
        if (!this._visible || e.button !== 0) return;
        this._setNdcRay(e.clientX, e.clientY);
        this._placeFaces(); this._updateReveal();   // reflect current pointer before picking
        const hit = this._hitTest(); if (hit) { e.stopPropagation(); this._begin(hit); }
      }, true);
      addEventListener('mouseup', () => this._end());
    }
  }

  BYO.Gizmo = Gizmo;
})();
