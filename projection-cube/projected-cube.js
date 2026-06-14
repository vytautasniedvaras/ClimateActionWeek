/* ===================================================================
   BYO — text projected onto an invisible, mouse-driven cube.
   Organised as small single-responsibility modules wired together at
   the bottom. Plain classic script (globals: THREE, dat, WORD_DATA) so
   it runs straight from file://.
   =================================================================== */
(function () {
  'use strict';

  /* ---------- config (everything tweakable lives here) ---------- */
  const CONFIG = {
    // invisible cube
    cubeSize:      1.15,   // base half-extent (gizmo scales on top)
    projection:    0.3,    // ONE knob: depth, seam & clamp derive from this (stays seamless 0..1)
    facingCut:     0.2,    // drop triangles steeper than this (flat colour, no edge-on glow)
    // motion (mouse "heading" with momentum into a slow idle coast)
    paused:        false,
    driveGain:     0.0016, buildup: 1.6, decay: 0.9,
    slowSpin:      0.30,   responsiveness: 3.0, maxDriveSpeed: 2.6,
    // interaction
    wordThreshold: 55,     // px of horizontal travel over a line to change its word
    // quality
    renderScale:   1.5,    // super-sampling (crisper, costs GPU)
    // text (auto-shrinks per line to fit width)
    texResolution: 3072, textSize: 0.118, leftMargin: 0.04,
    letterSpacing: -0.03, wordSpacing: 0.0, lineSpacing: 1.02, autoCycle: 0.0,
    // helpers
    showGuide:     true
  };

  const CAM_FOV = 45, CAM_DIST = 6, PLANE_OVERSCAN = 1.0;

  const PALETTE = [
    '#E5233D', '#DDA73A', '#4CA146', '#C5192D', '#EF402C', '#27BFE6',
    '#FBC412', '#A31C44', '#F26A2D', '#E01483', '#F89D2A', '#BF8D2C',
    '#407F46', '#1F97D4', '#59BA48', '#126A9F', '#13496B'
  ];
  const pick       = arr => arr[(Math.random() * arr.length) | 0];
  const randColor  = () => pick(PALETTE);
  const otherColor = ex => pick(PALETTE.filter(c => c !== ex));

  /* ---------- Words: content state, emits the 3 title lines ---------- */
  const Words = (() => {
    const nouns = window.WORD_DATA.nouns;
    let ni = 0, vi = 0, nc = randColor(), vc = otherColor(nc);
    return {
      // each line is [ [text, colour], ... ]; the changeable word is the 2nd seg
      get lines() {
        const n = nouns[ni], verb = n.verbs[vi % n.verbs.length].toUpperCase();
        return [
          [['BYO', '#000'],        [n.word, nc]],
          [['HOW CAN ', '#000'],   [n.plural, nc]],
          [[verb + ' ', vc],       ['SCIENCE', '#000']]
        ];
      },
      nextNoun() { ni = (ni + 1) % nouns.length; vi = 0; nc = randColor(); vc = otherColor(nc); },
      nextVerb() { vi = (vi + 1) % nouns[ni].verbs.length; vc = otherColor(nc); }
    };
  })();

  /* ---------- TextLayer: Words -> transparent canvas texture ---------- */
  const TextLayer = (() => {
    const cv = document.createElement('canvas');
    const ctx = cv.getContext('2d');
    const texture = new THREE.CanvasTexture(cv);
    // trilinear + anisotropic mip filtering kills glyph-edge aliasing when the
    // projection tilts/minifies the text; premultiplied alpha avoids edge halos.
    texture.premultiplyAlpha = true;
    texture.minFilter = THREE.LinearMipmapLinearFilter;
    texture.magFilter = THREE.LinearFilter;
    texture.generateMipmaps = true;
    texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;

    const setFont = px => {
      ctx.font = `800 ${px}px Inter, Arial, sans-serif`;
      if ('letterSpacing' in ctx) ctx.letterSpacing = (CONFIG.letterSpacing * px).toFixed(2) + 'px';
      if ('wordSpacing'   in ctx) ctx.wordSpacing   = (CONFIG.wordSpacing   * px).toFixed(2) + 'px';
    };
    const widthOf = segs => segs.reduce((w, s) => w + ctx.measureText(s[0]).width, 0);

    function draw() {
      const W = cv.width, H = cv.height;
      ctx.clearRect(0, 0, W, H);            // transparent everywhere but the glyphs
      ctx.textBaseline = 'middle';
      ctx.textAlign = 'left';
      const base = Math.round(H * CONFIG.textSize);
      const lineH = base * CONFIG.lineSpacing;
      const margin = W * CONFIG.leftMargin, avail = W - margin * 2;
      const lines = Words.lines;
      let y = (H - lineH * lines.length) / 2 + lineH / 2;
      for (const segs of lines) {
        setFont(base);
        const w = widthOf(segs);
        if (w > avail) setFont(Math.floor(base * avail / w));   // shrink this line to fit
        let x = margin;
        for (const [t, c] of segs) { ctx.fillStyle = c; ctx.fillText(t, x, y); x += ctx.measureText(t).width; }
        y += lineH;
      }
      texture.needsUpdate = true;
    }
    function resize() {
      cv.width  = Math.round(CONFIG.texResolution);
      cv.height = Math.round(CONFIG.texResolution / (innerWidth / innerHeight));
      draw();
    }
    // which line (0..2) the screen-y `py` is near (flat layout); -1 if none
    function lineAt(py) {
      const f = CONFIG.textSize * CONFIG.lineSpacing, half = 0.62 * f * PLANE_OVERSCAN;
      const t = py / innerHeight;
      for (let i = 0; i < 3; i++) {
        const fy = 0.5 - 1.5 * f + f * (i + 0.5);
        const sy = 0.5 - (0.5 - fy) * PLANE_OVERSCAN;
        if (Math.abs(t - sy) < half) return i;
      }
      return -1;
    }
    return { texture, draw, resize, lineAt };
  })();

  /* ---------- Stage: renderer + scene + camera ---------- */
  const Stage = (() => {
    const canvas = document.getElementById('scene');
    const gl2 = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    const renderer = new THREE.WebGLRenderer(gl2
      ? { canvas, context: gl2, antialias: true, alpha: true }
      : { canvas, antialias: true, alpha: true });
    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(CAM_FOV, 1, 0.1, 100);
    camera.position.set(0, 0, CAM_DIST);
    camera.lookAt(0, 0, 0);
    const applyDPR = () => renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * CONFIG.renderScale);
    function resize() {
      applyDPR();
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    }
    return { renderer, scene, camera, applyDPR, resize, maxAniso: renderer.capabilities.getMaxAnisotropy() };
  })();
  TextLayer.texture.anisotropy = Stage.maxAniso;

  /* ---------- Plane: subdivided quad + displacement shader ---------- */
  const SHADERS = {
    vert: `
      uniform mat4 uCubeInv; uniform vec3 uHalf;
      uniform float uStrength, uEdgeBand, uMaxLift;
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        // ray-box: world column (wp.x, wp.y, t) into cube space, t == world-Z
        vec3 lo = (uCubeInv * vec4(wp.x, wp.y, 0.0, 1.0)).xyz;
        vec3 ld =  mat3(uCubeInv) * vec3(0.0, 0.0, 1.0);
        vec3 safe = vec3(abs(ld.x) < 1e-5 ? 1e-5 : ld.x,
                         abs(ld.y) < 1e-5 ? 1e-5 : ld.y,
                         abs(ld.z) < 1e-5 ? 1e-5 : ld.z);
        vec3 t1 = (-uHalf - lo) / safe, t2 = (uHalf - lo) / safe;
        vec3 tmin = min(t1, t2), tmax = max(t1, t2);
        float tlo = max(max(tmin.x, tmin.y), tmin.z);
        float thi = min(min(tmax.x, tmax.y), tmax.z);
        float z = wp.z;
        if (thi > tlo) {
          float mask = smoothstep(0.0, uEdgeBand, thi - tlo);
          z = mix(wp.z, min(thi * uStrength, uMaxLift), mask);
        }
        vUv = uv; vWorld = vec3(wp.x, wp.y, z);
        gl_Position = projectionMatrix * viewMatrix * vec4(wp.x, wp.y, z, 1.0);
      }`,
    frag: `
      uniform sampler2D uTex; uniform vec3 uCamPos; uniform float uFacingCut;
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vec4 c = texture2D(uTex, vUv);
        if (c.a < 0.02) discard;                      // only the glyphs
        // drop triangles stretched edge-on to the camera -> flat, opaque colour
        vec3 n = normalize(cross(dFdx(vWorld), dFdy(vWorld)));
        if (abs(dot(n, normalize(uCamPos - vWorld))) < uFacingCut) discard;
        gl_FragColor = vec4(c.rgb, c.a);
      }`
  };

  const Plane = (() => {
    const u = {
      uTex:      { value: TextLayer.texture },
      uCamPos:   { value: new THREE.Vector3(0, 0, CAM_DIST) },
      uFacingCut:{ value: CONFIG.facingCut },
      uMaxLift:  { value: 0 },
      uCubeInv:  { value: new THREE.Matrix4() },
      uHalf:     { value: new THREE.Vector3() },
      uStrength: { value: 0 },
      uEdgeBand: { value: 0 }
    };
    // couple depth/seam/clamp to the single `projection` knob (seamless everywhere)
    function deriveProjection() {
      const p = CONFIG.projection;
      u.uStrength.value = 0.70 + 2.30 * p;
      u.uEdgeBand.value = 0.30 + 0.85 * p;
      u.uMaxLift.value  = 1.40 + 2.60 * p;
    }
    const material = new THREE.ShaderMaterial({
      uniforms: u, vertexShader: SHADERS.vert, fragmentShader: SHADERS.frag,
      transparent: true, side: THREE.FrontSide, depthWrite: false
    });
    material.extensions = { derivatives: true };
    let mesh = null;
    function build() {
      if (mesh) { mesh.geometry.dispose(); Stage.scene.remove(mesh); }
      const aspect = innerWidth / innerHeight;
      const visH = 2 * CAM_DIST * Math.tan(CAM_FOV * Math.PI / 180 / 2);
      const W = visH * aspect * PLANE_OVERSCAN, H = visH * PLANE_OVERSCAN;
      mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 240, Math.max(40, Math.round(240 / aspect))), material);
      Stage.scene.add(mesh);
    }
    function update(cube) {
      cube.updateMatrixWorld();
      u.uCubeInv.value.copy(cube.matrixWorld).invert();
      u.uHalf.value.setScalar(CONFIG.cubeSize);
      u.uFacingCut.value = CONFIG.facingCut;
      deriveProjection();
    }
    return { build, update };
  })();

  /* ---------- Rig: cube object + wireframe guide + gizmo + motion ---------- */
  const Rig = (() => {
    const cube = new THREE.Object3D();
    Stage.scene.add(cube);

    let guide = null;
    function buildGuide() {
      if (guide) { guide.geometry.dispose(); cube.remove(guide); }
      const s = CONFIG.cubeSize * 2;
      guide = new THREE.LineSegments(
        new THREE.EdgesGeometry(new THREE.BoxGeometry(s, s, s)),
        new THREE.LineBasicMaterial({ color: 0xbfc6cc, transparent: true, opacity: 0.55 }));
      cube.add(guide);
      setGuideVisible(CONFIG.showGuide);
    }

    const tc = new THREE.TransformControls(Stage.camera, Stage.renderer.domElement);
    tc.setSpace('local'); tc.attach(cube); Stage.scene.add(tc);

    // gizmo edits a rest transform; integrated `spin` is layered on top
    const basePos = new THREE.Vector3(), baseQuat = new THREE.Quaternion(), baseScale = new THREE.Vector3(1, 1, 1);
    const spin = new THREE.Quaternion();
    let dragging = false;
    tc.addEventListener('dragging-changed', e => {
      dragging = e.value;
      if (!dragging) { basePos.copy(cube.position); baseQuat.copy(cube.quaternion); baseScale.copy(cube.scale); spin.identity(); }
    });

    // motion state
    let engage = 0;
    const axis   = new THREE.Vector3(0, 1, 0);
    const w      = new THREE.Vector3(0, CONFIG.slowSpin, 0);
    const drive  = new THREE.Vector3(), target = new THREE.Vector3(), tmp = new THREE.Vector3(), dq = new THREE.Quaternion();

    function step(dt, vx, vy) {
      if (dragging) return;                            // gizmo owns the transform mid-drag
      cube.position.copy(basePos);
      cube.scale.copy(baseScale);
      if (!CONFIG.paused) {
        const speed = Math.hypot(vx, vy);
        // trackball drive: horizontal -> about Y, vertical -> about X
        drive.set(-vy, vx, 0).multiplyScalar(CONFIG.driveGain / Math.max(dt, 1e-3));
        if (drive.length() > CONFIG.maxDriveSpeed) drive.setLength(CONFIG.maxDriveSpeed);
        const moving = speed > 0.4;
        engage += ((moving ? 1 : 0) - engage) * (1 - Math.exp(-(moving ? CONFIG.buildup : CONFIG.decay) * dt));
        if (drive.lengthSq() > 1e-4) axis.copy(drive).normalize();   // last heading -> idle coast axis
        target.copy(drive).multiplyScalar(engage).addScaledVector(axis, CONFIG.slowSpin * (1 - engage));
        w.lerp(target, 1 - Math.exp(-CONFIG.responsiveness * dt));   // momentum
        const ang = w.length() * dt;
        if (ang > 1e-7) { dq.setFromAxisAngle(tmp.copy(w).normalize(), ang); spin.premultiply(dq); }
      }
      cube.quaternion.multiplyQuaternions(spin, baseQuat);
    }

    function setGizmo(mode)       { tc.setMode(mode); }
    function setGuideVisible(v)   { if (guide) guide.visible = v; tc.enabled = v; tc.visible = v; }
    function onMouseDown(cb)      { tc.addEventListener('mouseDown', cb); }
    function reset() {
      basePos.set(0, 0, 0); baseQuat.identity(); baseScale.set(1, 1, 1);
      spin.identity(); engage = 0; axis.set(0, 1, 0);
      cube.position.set(0, 0, 0); cube.quaternion.identity(); cube.scale.set(1, 1, 1);
    }
    return { cube, buildGuide, step, setGizmo, setGuideVisible, reset, onMouseDown, get dragging() { return dragging; } };
  })();

  /* ---------- Input: mouse velocity sampler ---------- */
  const Input = (() => {
    const m = { x: 0, y: 0, px: 0, py: 0, moved: false, has: false };
    addEventListener('mousemove', e => {
      if (!m.has) { m.px = e.clientX; m.py = e.clientY; m.has = true; }
      m.x = e.clientX; m.y = e.clientY; m.moved = true;
    });
    function velocity() {           // px moved since last frame (0 if no event)
      let vx = 0, vy = 0;
      if (m.moved) { vx = m.x - m.px; vy = m.y - m.py; m.px = m.x; m.py = m.y; m.moved = false; }
      return { vx, vy, y: m.y };
    }
    return { velocity };
  })();

  /* ---------- word changes + gesture detection ---------- */
  const changeNoun = () => { Words.nextNoun(); TextLayer.draw(); };
  const changeVerb = () => { Words.nextVerb(); TextLayer.draw(); };

  let gLine = -1, gAccum = 0;
  function wordGesture(vx, vy, py) {
    if (Rig.dragging) return;
    const line = TextLayer.lineAt(py);
    if (line !== gLine) { gLine = line; gAccum = 0; }
    if (line < 0 || Math.abs(vx) <= Math.abs(vy)) return;   // need horizontal-dominant motion on a line
    gAccum += vx;
    if (Math.abs(gAccum) > CONFIG.wordThreshold) { (line === 2 ? changeVerb : changeNoun)(); gAccum = 0; }
  }

  /* ---------- GUI (hidden by default — press H) ---------- */
  const Gui = (() => {
    const gui = new dat.GUI({ width: 310 });
    gui.domElement.style.display = 'none';
    let visible = false;
    const toggle = () => { visible = !visible; gui.domElement.style.display = visible ? '' : 'none'; };

    const cube = gui.addFolder('Invisible cube');
    cube.add(CONFIG, 'cubeSize', 0.4, 2.4, 0.01).name('size').onChange(Rig.buildGuide);
    cube.add(CONFIG, 'projection', 0, 1, 0.01).name('projection');
    cube.add(CONFIG, 'facingCut', 0, 0.6, 0.01).name('edge cutoff');
    cube.add(CONFIG, 'showGuide').name('show guide + gizmo').onChange(Rig.setGuideVisible);
    cube.open();

    const mot = gui.addFolder('Motion (mouse heading)');
    mot.add(CONFIG, 'paused').name('pause (freeze)').listen();
    mot.add(CONFIG, 'driveGain', 0.0002, 0.006, 0.0001).name('heading strength');
    mot.add(CONFIG, 'buildup', 0.3, 6, 0.1).name('engage buildup');
    mot.add(CONFIG, 'decay', 0.1, 4, 0.1).name('engage decay');
    mot.add(CONFIG, 'slowSpin', 0, 1.2, 0.01).name('idle coast speed');
    mot.add(CONFIG, 'responsiveness', 0.5, 8, 0.1).name('momentum');
    mot.add(CONFIG, 'maxDriveSpeed', 0.5, 6, 0.1).name('max heading speed');
    mot.add(CONFIG, 'wordThreshold', 10, 150, 1).name('word change travel');
    mot.open();

    const giz = gui.addFolder('Gizmo mode');
    const acts = {
      move:   () => Rig.setGizmo('translate'),
      rotate: () => Rig.setGizmo('rotate'),
      scale:  () => Rig.setGizmo('scale'),
      reset:  () => Rig.reset()
    };
    giz.add(acts, 'move').name('move (G)');
    giz.add(acts, 'rotate').name('rotate (R)');
    giz.add(acts, 'scale').name('scale (S)');
    giz.add(acts, 'reset').name('reset transform');
    giz.open();

    const txt = gui.addFolder('Text');
    txt.add(CONFIG, 'texResolution', 1024, 8192, 256).name('texture res (px)').onChange(TextLayer.resize);
    txt.add(CONFIG, 'textSize', 0.05, 0.22, 0.002).name('text size').onChange(TextLayer.draw);
    txt.add(CONFIG, 'leftMargin', 0, 0.25, 0.005).name('left margin').onChange(TextLayer.draw);
    txt.add(CONFIG, 'letterSpacing', -0.12, 0.2, 0.005).name('letter spacing').onChange(TextLayer.draw);
    txt.add(CONFIG, 'wordSpacing', -0.1, 0.6, 0.01).name('word spacing').onChange(TextLayer.draw);
    txt.add(CONFIG, 'lineSpacing', 0.7, 1.6, 0.01).name('line spacing').onChange(TextLayer.draw);
    txt.add(CONFIG, 'autoCycle', 0, 6, 0.5).name('auto-change (s)');
    txt.open();

    const qual = gui.addFolder('Quality');
    qual.add(CONFIG, 'renderScale', 1, 2.5, 0.25).name('super-sampling').onChange(resize);
    qual.open();

    return { toggle };
  })();

  /* ---------- input handlers (click + keyboard) ---------- */
  let suppressClick = false;
  Rig.onMouseDown(() => { suppressClick = true; });
  addEventListener('click', () => {
    if (Rig.dragging || suppressClick) { suppressClick = false; return; }
    changeNoun();
  });
  addEventListener('keydown', e => {                     // Blender-style: G/R/S, H panel, space pause
    const k = e.key.toLowerCase();
    if      (k === 'g') Rig.setGizmo('translate');
    else if (k === 'r') Rig.setGizmo('rotate');
    else if (k === 's') Rig.setGizmo('scale');
    else if (k === 'h') Gui.toggle();
    else if (e.code === 'Space') { CONFIG.paused = !CONFIG.paused; e.preventDefault(); }
  });

  /* ---------- loop + resize + boot ---------- */
  const clock = new THREE.Clock();
  let autoT = 0;
  function frame() {
    requestAnimationFrame(frame);
    const dt = Math.min(clock.getDelta(), 0.05);
    if (CONFIG.autoCycle > 0 && !CONFIG.paused) {
      autoT += dt;
      if (autoT >= CONFIG.autoCycle) { autoT = 0; changeNoun(); }
    }
    const { vx, vy, y } = Input.velocity();
    wordGesture(vx, vy, y);
    Rig.step(dt, vx, vy);
    Plane.update(Rig.cube);
    Stage.renderer.render(Stage.scene, Stage.camera);
  }

  function resize() {            // function declaration -> hoisted for Gui/Stage callbacks
    Stage.resize();
    TextLayer.resize();
    Plane.build();
  }
  addEventListener('resize', resize);

  Rig.buildGuide();
  resize();
  Rig.setGizmo('scale');        // start with the gizmo selected, in scale mode
  frame();
})();
