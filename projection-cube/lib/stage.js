/* ===================================================================
   BYO.Stage — renderer + scene + camera. Verbatim extraction of the
   monolith's Stage IIFE, refactored into a factory so renderScale is
   passed/mutated externally (NO global CONFIG read — keeps Stage clean
   and the rest of the modules decoupled). Classic script: globals THREE.
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  // camera constants live here (were CAM_FOV/CAM_DIST in the monolith)
  const CAM_FOV = 45, CAM_DIST = 6;

  // create({canvasId,fov,dist,renderScale}) -> stage object (spec 2.2 contract)
  function create(opts) {
    opts = opts || {};
    const canvasId   = opts.canvasId   != null ? opts.canvasId   : 'scene';
    const fov        = opts.fov        != null ? opts.fov        : CAM_FOV;
    const dist       = opts.dist       != null ? opts.dist       : CAM_DIST;

    const canvas = document.getElementById(canvasId);
    // WebGL2 path: explicit context so we get GLSL3-capable mipmaps + AA; fall
    // back to default (WebGL1) construction when WebGL2 is unavailable.
    const gl2 = canvas.getContext('webgl2', { antialias: true, alpha: true, premultipliedAlpha: true });
    const renderer = new THREE.WebGLRenderer(gl2
      ? { canvas, context: gl2, antialias: true, alpha: true }
      : { canvas, antialias: true, alpha: true });

    const scene = new THREE.Scene();
    const camera = new THREE.PerspectiveCamera(fov, 1, 0.1, 100);
    camera.position.set(0, 0, dist);
    camera.lookAt(0, 0, 0);

    // mutable: GUI sets stage.renderScale then calls resize() (super-sampling)
    const stage = {
      renderer, scene, camera,
      maxAniso: renderer.capabilities.getMaxAnisotropy(),  // for the text layer
      renderScale: opts.renderScale != null ? opts.renderScale : 1.5,
      applyDPR, resize
    };

    // DPR = clamp(devicePixelRatio,2) * renderScale — reads stage.renderScale,
    // NOT CONFIG, so Stage stays self-contained.
    function applyDPR() {
      renderer.setPixelRatio(Math.min(devicePixelRatio, 2) * stage.renderScale);
    }
    function resize() {
      applyDPR();
      renderer.setSize(innerWidth, innerHeight, false);
      camera.aspect = innerWidth / innerHeight;
      camera.updateProjectionMatrix();
    }

    return stage;
  }

  BYO.Stage = { create, CAM_FOV, CAM_DIST };
})();
