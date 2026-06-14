/* ===================================================================
   BYO.Motion — mouse-heading momentum spin + idle coast + hover-to-stop.
   Extracted verbatim from the old Rig.step motion math. PURE: knows
   nothing about the cube, gizmo, or transform model — it only integrates
   angular velocity and exposes the accumulated `spin` quaternion delta.
   Classic script IIFE attaching to window.BYO (no modules).
   =================================================================== */
(function () {
  'use strict';
  window.BYO = window.BYO || {};

  // frozen current defaults — `config` is the SAME object the GUI mutates live
  const DEFAULTS = {
    driveGain: 0.0016, buildup: 1.6, decay: 0.9,
    slowSpin: 0.30, responsiveness: 3.0, maxDriveSpeed: 2.6
  };

  BYO.Motion = {
    create(config) {
      // fill any missing keys but keep caller's object identity (GUI two-way binds it)
      config = config || {};
      for (const k in DEFAULTS) if (config[k] === undefined) config[k] = DEFAULTS[k];

      // integrated state (module-owned)
      const spin = new THREE.Quaternion();              // accumulated orientation delta
      let engage = 0;                                   // 0=idle coast, 1=actively driven
      const axis = new THREE.Vector3(0, 1, 0);          // last heading -> idle coast axis
      const w = new THREE.Vector3(0, config.slowSpin, 0); // current angular velocity
      // scratch (avoid per-frame allocation, identical to source)
      const drive = new THREE.Vector3(), target = new THREE.Vector3(),
            tmp = new THREE.Vector3(), dq = new THREE.Quaternion();

      function step(dt, vx, vy, hovering, paused) {
        // hover OR paused -> ease engage + spin velocity to rest (no new drive)
        const stop = hovering || paused;
        if (!stop) {
          const speed = Math.hypot(vx, vy);
          // trackball drive: horizontal -> about Y, vertical -> about X
          drive.set(-vy, vx, 0).multiplyScalar(config.driveGain / Math.max(dt, 1e-3));
          if (drive.length() > config.maxDriveSpeed) drive.setLength(config.maxDriveSpeed);
          const moving = speed > 0.4;
          engage += ((moving ? 1 : 0) - engage) * (1 - Math.exp(-(moving ? config.buildup : config.decay) * dt));
          if (drive.lengthSq() > 1e-4) axis.copy(drive).normalize();   // remember heading for coast
          target.copy(drive).multiplyScalar(engage).addScaledVector(axis, config.slowSpin * (1 - engage));
          w.lerp(target, 1 - Math.exp(-config.responsiveness * dt));   // momentum
        } else {
          // smoothly ease engage + spin velocity to 0 while hovering/paused
          engage += (0 - engage) * (1 - Math.exp(-config.decay * dt));
          w.lerp(target.set(0, 0, 0), 1 - Math.exp(-config.responsiveness * dt));
        }
        const ang = w.length() * dt;
        if (ang > 1e-7) { dq.setFromAxisAngle(tmp.copy(w).normalize(), ang); spin.premultiply(dq); }
        return { spin, engage };
      }

      function reset() {                 // after drag end / explicit GUI rotation edit
        spin.identity();
        w.set(0, config.slowSpin, 0);
      }

      return { step, reset, config };
    }
  };
})();
