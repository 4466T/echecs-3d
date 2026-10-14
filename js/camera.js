// Caméra orbitale bornée + préréglages animés.
import * as THREE from 'three';
import { OrbitControls } from 'three/addons/controls/OrbitControls.js';

export class CameraRig {
  constructor(camera, dom) {
    this.camera = camera;
    this.controls = new OrbitControls(camera, dom);
    const c = this.controls;
    c.enableDamping = true;
    c.dampingFactor = 0.08;
    c.enablePan = false;
    c.minDistance = 7.5;
    c.maxDistance = 24;
    c.minPolarAngle = 0.02;
    c.maxPolarAngle = 1.32; // jamais sous le plateau
    c.rotateSpeed = 0.6;
    c.zoomSpeed = 0.8;
    c.target.set(0, 0, 0);
    this.side = 1; // 1 = Blancs en bas, -1 = Noirs en bas
    this.tween = null;
    this.cinematic = false;
    this.reduceMotion = false;
    this.preset = 'joueur';
    this.fit = 1; // recul de caméra pour que le plateau tienne dans une zone étroite (portrait)
  }

  // area : zone libre {w, h} rapportée à la hauteur de l'écran. Le plateau occupe ≈ 1.15 de large et 0.75 de haut
  // (en unités de hauteur d'écran) à recul normal ; au-delà, la caméra recule juste assez pour qu'il tienne.
  setArea(area) {
    const fit = THREE.MathUtils.clamp(Math.max(1, 1.15 / area.w, 0.75 / area.h), 1, 2.4);
    if (Math.abs(fit - this.fit) < 0.02) return;
    this.fit = fit;
    this.controls.maxDistance = 24 * fit;
    if (!this.tween) this.go(this.preset, true);
  }

  presetPosition(name) {
    return this.rawPreset(name).multiplyScalar(this.fit);
  }

  rawPreset(name) {
    const s = this.side;
    switch (name) {
      case 'dessus': return new THREE.Vector3(0, 17.5, 0.02 * s);
      case 'cote': return new THREE.Vector3(13.2 * s, 7.4, 0.6 * s);
      case 'cine': return new THREE.Vector3(8.5 * s, 5.2, 9.5 * s);
      default: return new THREE.Vector3(0, 10.6, 12.4 * s);
    }
  }

  go(name, instant = false) {
    this.preset = name;
    this.cinematic = name === 'cine';
    const to = this.presetPosition(name);
    if (instant || this.reduceMotion) {
      this.camera.position.copy(to);
      this.controls.target.set(0, 0, 0);
      this.controls.update();
      this.tween = null;
      return;
    }
    // Interpolation sphérique autour de la cible pour une transition fluide
    const from = this.camera.position.clone();
    const sFrom = new THREE.Spherical().setFromVector3(from);
    const sTo = new THREE.Spherical().setFromVector3(to);
    let dTheta = sTo.theta - sFrom.theta;
    while (dTheta > Math.PI) dTheta -= Math.PI * 2;
    while (dTheta < -Math.PI) dTheta += Math.PI * 2;
    this.tween = { t: 0, dur: 1.1, sFrom, sTo, dTheta };
  }

  setSide(side, animate = true) { this.side = side; this.go(this.preset === 'cine' ? 'cine' : 'joueur', !animate); }

  update(dt) {
    if (this.tween) {
      const tw = this.tween;
      tw.t += dt;
      const k = Math.min(1, tw.t / tw.dur);
      const e = k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2;
      const s = new THREE.Spherical(
        THREE.MathUtils.lerp(tw.sFrom.radius, tw.sTo.radius, e),
        THREE.MathUtils.lerp(tw.sFrom.phi, tw.sTo.phi, e),
        tw.sFrom.theta + tw.dTheta * e,
      );
      this.camera.position.setFromSpherical(s);
      this.controls.target.set(0, 0, 0);
      if (k >= 1) this.tween = null;
    } else if (this.cinematic && !this.reduceMotion) {
      const s = new THREE.Spherical().setFromVector3(this.camera.position);
      s.theta += dt * 0.08;
      this.camera.position.setFromSpherical(s);
    }
    this.controls.update();
  }
}
