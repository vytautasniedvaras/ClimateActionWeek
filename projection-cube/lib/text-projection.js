/* ===================================================================
   BYO.TextProjection — Words content -> TextLayer canvas texture ->
   subdivided Plane mesh + ray-box displacement shader. Scene-specific
   (knows WORD_DATA + CONFIG text/projection fields); the reusable Gizmo
   stays clean of all this. Shader generalized to an ASYMMETRIC box via
   uBoxMin/uBoxMax (replacing the old symmetric uHalf).
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  // SDG-ish palette; noun gets one colour, verb another (must differ).
  const PALETTE = [
    '#E5233D', '#DDA73A', '#4CA146', '#C5192D', '#EF402C', '#27BFE6',
    '#FBC412', '#A31C44', '#F26A2D', '#E01483', '#F89D2A', '#BF8D2C',
    '#407F46', '#1F97D4', '#59BA48', '#126A9F', '#13496B'
  ];
  const pick       = arr => arr[(Math.random() * arr.length) | 0];
  const randColor  = () => pick(PALETTE);
  const otherColor = ex => pick(PALETTE.filter(c => c !== ex));

  // ray-box vert: world column (wp.x, wp.y, t) -> cube space, t == world-Z.
  // ONLY change vs current: uHalf split into uBoxMin/uBoxMax for asymmetry.
  const SHADERS = {
    vert: `
      uniform mat4 uCubeInv; uniform vec3 uBoxMin; uniform vec3 uBoxMax;
      uniform float uStrength, uEdgeBand, uMaxLift;
      varying vec2 vUv; varying vec3 vWorld;
      void main() {
        vec3 wp = (modelMatrix * vec4(position, 1.0)).xyz;
        vec3 lo = (uCubeInv * vec4(wp.x, wp.y, 0.0, 1.0)).xyz;
        vec3 ld =  mat3(uCubeInv) * vec3(0.0, 0.0, 1.0);
        vec3 safe = vec3(abs(ld.x) < 1e-5 ? 1e-5 : ld.x,
                         abs(ld.y) < 1e-5 ? 1e-5 : ld.y,
                         abs(ld.z) < 1e-5 ? 1e-5 : ld.z);
        vec3 t1 = (uBoxMin - lo) / safe, t2 = (uBoxMax - lo) / safe;
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

  BYO.TextProjection = {
    create(stage, config) {
      const CONFIG = config;
      const PLANE_OVERSCAN = 1.0;
      // camera geometry comes from the stage (decoupled from any constant)
      const camDist = stage.camera.position.length();
      const fov = stage.camera.fov;

      /* ---- Words: static first-noun title lines (verbatim palette logic) ---- */
      const Words = (() => {
        const nouns = window.WORD_DATA.nouns;
        const nc = randColor(), vc = otherColor(nc);
        const n = nouns[0], verb = n.verbs[0].toUpperCase();
        const lines = [
          [['BYO', '#000'],        [n.word, nc]],
          [['HOW CAN ', '#000'],   [n.plural, nc]],
          [[verb + ' ', vc],       ['SCIENCE', '#000']]
        ];
        return { lines };          // static: first noun, no cycling
      })();

      /* ---- TextLayer: Words -> transparent canvas texture (verbatim) ---- */
      const cv = document.createElement('canvas');
      const ctx = cv.getContext('2d');
      const texture = new THREE.CanvasTexture(cv);
      // trilinear + anisotropic mip filtering kills glyph-edge aliasing when the
      // projection tilts/minifies the text; premultiplied alpha avoids halos.
      texture.premultiplyAlpha = true;
      texture.minFilter = THREE.LinearMipmapLinearFilter;
      texture.magFilter = THREE.LinearFilter;
      texture.generateMipmaps = true;
      texture.wrapS = texture.wrapT = THREE.ClampToEdgeWrapping;
      texture.anisotropy = stage.maxAniso;

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

      /* ---- Plane: subdivided quad + displacement shader ---- */
      const u = {
        uTex:      { value: texture },
        uCamPos:   { value: stage.camera.position.clone() },
        uFacingCut:{ value: CONFIG.facingCut },
        uMaxLift:  { value: 0 },
        uCubeInv:  { value: new THREE.Matrix4() },
        uBoxMin:   { value: new THREE.Vector3(-1, -1, -1) },
        uBoxMax:   { value: new THREE.Vector3(1, 1, 1) },
        uStrength: { value: 0 },
        uEdgeBand: { value: 0 }
      };
      // couple depth/seam/clamp to the single `projection` knob (verbatim coupling)
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
        if (mesh) { mesh.geometry.dispose(); stage.scene.remove(mesh); }
        const aspect = innerWidth / innerHeight;
        const visH = 2 * camDist * Math.tan(fov * Math.PI / 180 / 2);
        const W = visH * aspect * PLANE_OVERSCAN, H = visH * PLANE_OVERSCAN;
        mesh = new THREE.Mesh(new THREE.PlaneGeometry(W, H, 240, Math.max(40, Math.round(240 / aspect))), material);
        stage.scene.add(mesh);
      }

      // per frame: caller derives boxMin/boxMax (from faceOffset) + passes matrixWorld.
      // INVARIANT: boxMax.{x,y,z} >= boxMin.{x,y,z} + 1e-3 (epsilon guard) — the main
      // file enforces this after clamping (deriveBounds), preventing the ray-box
      // (uBoxMin-lo)/safe intersection in the vert shader from producing NaN/inversion.
      function update(boxMin, boxMax, cubeMatrixWorld) {
        u.uCubeInv.value.copy(cubeMatrixWorld).invert();
        u.uBoxMin.value.copy(boxMin);
        u.uBoxMax.value.copy(boxMax);
        u.uFacingCut.value = CONFIG.facingCut;
        deriveProjection();
      }

      return { build, resize, update };
    }
  };
})();
