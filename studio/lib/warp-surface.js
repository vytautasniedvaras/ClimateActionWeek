/* ===================================================================
   BYO.WarpSurface — reusable subdivided Plane + ray-box displacement
   shader, extracted VERBATIM from projection-cube/lib/text-projection.js.
   The ONLY difference vs TextProjection: the texture is supplied by the
   caller via setTexture(tex) (uTex) instead of the BYO word canvas, so
   ANY content (video, image, canvas, generated) can be warped onto the
   cube. No Words / no TextLayer / no scene-specific config here.

   Frozen interface (studio contract):
     BYO.WarpSurface.create(stage, opts={projection:0,facingCut:0}) -> {
       mesh, material, build(), resize(), setTexture(tex:THREE.Texture),
       update(boxMin:Vector3, boxMax:Vector3, cubeMatrixWorld:Matrix4) }
   build()/resize() size the plane to the STAGE RENDERER drawing buffer
   (not innerWidth/innerHeight) so the warp plane tracks the host container
   on window resize — this is the fix for shaders failing on resize.

   Classic script: globals THREE, window.BYO. No ES modules.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  // ray-box vert + frag shaders — VERBATIM from BYO.TextProjection.
  // world column (wp.x, wp.y, t) -> cube space, t == world-Z; box is the
  // ASYMMETRIC cube via uBoxMin/uBoxMax (the main file enforces the
  // boxMax >= boxMin + epsilon invariant before calling update()).
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
        // NOTE: UVs are the flat plane's own coords and do NOT follow the Z
        // displacement, so extruding a face (which enlarges the box + lifts
        // these vertices) STRETCHES the sampled text over that face. Inherent to
        // planar UVs; the Warp panel bounds face-offset to a stretch-tolerable
        // range. A true fix (reproject UV from displaced local position) is a
        // follow-up that would change this line.
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

  BYO.WarpSurface = {
    // create(stage, opts) — opts is the MUTABLE projection/facingCut model
    // (deriveProjection reads it live each update, matching text-projection's
    // CONFIG read). Callers may mutate opts.projection / opts.facingCut.
    create(stage, opts) {
      opts = opts || {};
      if (opts.projection == null) opts.projection = 0;
      if (opts.facingCut  == null) opts.facingCut  = 0;

      const PLANE_OVERSCAN = 1.0;
      // camera geometry comes from the stage (decoupled from any constant)
      const camDist = stage.camera.position.length();
      const fov = stage.camera.fov;

      /* ---- Plane: subdivided quad + displacement shader ---- */
      // uTex starts null — caller MUST call setTexture(tex) before render.
      const u = {
        uTex:      { value: null },
        uCamPos:   { value: stage.camera.position.clone() },
        uFacingCut:{ value: opts.facingCut },
        uMaxLift:  { value: 0 },
        uCubeInv:  { value: new THREE.Matrix4() },
        uBoxMin:   { value: new THREE.Vector3(-1, -1, -1) },
        uBoxMax:   { value: new THREE.Vector3(1, 1, 1) },
        uStrength: { value: 0 },
        uEdgeBand: { value: 0 }
      };
      // couple depth/seam/clamp to the single `projection` knob (verbatim coupling)
      function deriveProjection() {
        const p = opts.projection;
        u.uStrength.value = 0.70 + 2.30 * p;
        u.uEdgeBand.value = 0.30 + 0.85 * p;
        u.uMaxLift.value  = 1.40 + 2.60 * p;
      }
      const material = new THREE.ShaderMaterial({
        uniforms: u, vertexShader: SHADERS.vert, fragmentShader: SHADERS.frag,
        transparent: true, side: THREE.FrontSide, depthWrite: false
      });
      material.extensions = { derivatives: true };

      const api = { mesh: null, material };

      // setTexture(tex) — caller-supplied content (video/image/canvas/generated)
      function setTexture(tex) {
        u.uTex.value = tex;
      }

      // _sizeVec — scratch reused so build()/resize() allocate nothing per call.
      const _sizeVec = new THREE.Vector2();
      // aspect from the STAGE RENDERER drawing buffer (container box), NOT
      // innerWidth/innerHeight. On window resize the caller resizes the
      // renderer first, then rebuilds the plane to match — keeping the warp
      // plane locked to the host container instead of the whole viewport.
      function currentAspect() {
        stage.renderer.getSize(_sizeVec);
        const w = _sizeVec.x, h = _sizeVec.y;
        return (w > 0 && h > 0) ? (w / h) : 1;
      }

      function build() {
        if (api.mesh) { api.mesh.geometry.dispose(); stage.scene.remove(api.mesh); }
        const aspect = currentAspect();
        const visH = 2 * camDist * Math.tan(fov * Math.PI / 180 / 2);
        const W = visH * aspect * PLANE_OVERSCAN, H = visH * PLANE_OVERSCAN;
        // vertical subdivisions track 1/aspect (more rows when tall) but are
        // CAPPED so a very tall/portrait viewport cannot blow the vertex count
        // (e.g. aspect 0.5 would otherwise yield 240x480 = 115k verts).
        const vSeg = Math.max(40, Math.min(200, Math.round(240 / aspect)));
        const mesh = new THREE.Mesh(
          new THREE.PlaneGeometry(W, H, 240, vSeg),
          material
        );
        stage.scene.add(mesh);
        api.mesh = mesh;
      }

      // resize() — rebuild the subdivided plane for the CURRENT drawing-buffer
      // size (the host container box after the renderer has been resized). The
      // plane width/height + vSeg are derived from the renderer aspect, so this
      // is just build() under a contract-named entry point; preserving mesh
      // visibility across the rebuild so a hidden surface stays hidden.
      function resize() {
        const wasVisible = api.mesh ? api.mesh.visible : true;
        build();
        if (api.mesh) api.mesh.visible = wasVisible;
      }

      // per frame: caller derives boxMin/boxMax (from faceOffset) + passes matrixWorld.
      // INVARIANT: boxMax.{x,y,z} >= boxMin.{x,y,z} + 1e-3 (epsilon guard) — the
      // caller enforces this after clamping, preventing the ray-box
      // (uBoxMin-lo)/safe intersection in the vert shader from producing NaN/inversion.
      function update(boxMin, boxMax, cubeMatrixWorld) {
        // Guard the inversion: a singular / near-singular matrix (e.g. a
        // collapsed scale) makes .invert() emit a zero/NaN matrix that would
        // produce NaN in the shader's (uBoxMin - lo)/safe division and break
        // every displaced vertex. Skip the update and keep the last good
        // inverse rather than poisoning the uniform.
        const det = cubeMatrixWorld.determinant();
        if (Math.abs(det) >= 1e-6) {
          u.uCubeInv.value.copy(cubeMatrixWorld).invert();
        }
        u.uBoxMin.value.copy(boxMin);
        u.uBoxMax.value.copy(boxMax);
        u.uFacingCut.value = opts.facingCut;
        deriveProjection();
      }

      api.build = build;
      api.resize = resize;
      api.setTexture = setTexture;
      api.update = update;
      return api;
    }
  };
})();
