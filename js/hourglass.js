// Sablier 3D procédural affiché pendant la réflexion de l'adversaire.
import * as THREE from 'three';
import { woodCanvas, canvasToTexture } from './textures.js';

const NECK = 0.65;
const GRAINS = 220;

function glassProfile() {
  const pts = [];
  const N = 90;
  for (let i = 0; i <= N; i++) {
    const y = 0.07 + (1.16 * i) / N;
    const t = (y - 0.07) / 1.16; // 0..1
    const u = Math.abs(t - 0.5) * 2; // 0 au col, 1 aux extrémités
    let r = 0.035 + 0.255 * Math.sin(Math.min(1, u * 1.05) * Math.PI * 0.5) ** 1.6;
    if (u > 0.9) r = 0.035 + 0.255 * (1 - (u - 0.9) * 6.5);
    pts.push(new THREE.Vector2(Math.max(0.03, r), y));
  }
  return pts;
}

export class Hourglass {
  constructor(scene) {
    this.group = new THREE.Group();
    this.inner = new THREE.Group();
    this.group.add(this.inner);
    this.group.visible = false;
    scene.add(this.group);
    this.state = 'hidden';
    this.progress = 0;
    this.alpha = 0;
    this.lowQuality = false;
    this.reduceMotion = false;
    this.build();
    this.group.scale.setScalar(1.45);
  }

  build() {
    const woodTex = canvasToTexture(woodCanvas(256, 0x4a2a16, 0x1e0f07, 31, { rings: 5 }));
    this.woodMat = new THREE.MeshPhysicalMaterial({ map: woodTex, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.15, transparent: true });
    this.brassMat = new THREE.MeshStandardMaterial({ color: 0xc89b45, metalness: 1, roughness: 0.28, transparent: true });
    this.glassHi = new THREE.MeshPhysicalMaterial({ color: 0xfff7ea, transmission: 1, thickness: 0.25, ior: 1.5, roughness: 0.04, metalness: 0, transparent: true });
    this.glassLo = new THREE.MeshPhysicalMaterial({ color: 0xfff7ea, transparent: true, opacity: 0.22, roughness: 0.05, metalness: 0, depthWrite: false });
    this.sandMat = new THREE.MeshStandardMaterial({ color: 0xdcaa52, roughness: 0.92, emissive: 0x3a2508, emissiveIntensity: 0.6, transparent: true });

    const disc = new THREE.CylinderGeometry(0.42, 0.44, 0.07, 64);
    const bottom = new THREE.Mesh(disc, this.woodMat); bottom.position.y = 0.035;
    const top = new THREE.Mesh(disc, this.woodMat); top.position.y = 1.265;
    const ringG = new THREE.TorusGeometry(0.425, 0.012, 12, 72);
    const r1 = new THREE.Mesh(ringG, this.brassMat); r1.rotation.x = Math.PI / 2; r1.position.y = 0.07;
    const r2 = new THREE.Mesh(ringG, this.brassMat); r2.rotation.x = Math.PI / 2; r2.position.y = 1.23;
    this.inner.add(bottom, top, r1, r2);
    // Colonnes tournées
    const colPts = [];
    for (let i = 0; i <= 40; i++) {
      const y = 0.07 + (1.16 * i) / 40;
      const t = i / 40;
      const r = 0.028 + 0.012 * Math.sin(t * Math.PI * 6) ** 2 + (t < 0.06 || t > 0.94 ? 0.012 : 0);
      colPts.push(new THREE.Vector2(r, y));
    }
    const colG = new THREE.LatheGeometry(colPts, 20);
    for (let k = 0; k < 3; k++) {
      const c = new THREE.Mesh(colG, this.woodMat);
      const a = (k / 3) * Math.PI * 2 + Math.PI / 6;
      c.position.set(Math.cos(a) * 0.35, 0, Math.sin(a) * 0.35);
      c.castShadow = true;
      this.inner.add(c);
    }
    for (const m of this.inner.children) { m.castShadow = true; m.receiveShadow = true; }

    // Verre
    this.glass = new THREE.Mesh(new THREE.LatheGeometry(glassProfile(), 80), this.glassHi);
    this.glass.renderOrder = 10;
    this.inner.add(this.glass);

    // Sable haut : cône pointe en bas, ancré au col
    const topCone = new THREE.ConeGeometry(0.23, 0.26, 48, 1, false);
    topCone.rotateX(Math.PI);
    topCone.translate(0, 0.13, 0);
    this.sandTop = new THREE.Mesh(topCone, this.sandMat);
    this.sandTop.position.y = NECK + 0.02;
    // Sable bas : tas conique ancré sur le fond
    const pile = new THREE.ConeGeometry(0.25, 0.2, 48, 1, false);
    pile.translate(0, 0.1, 0);
    this.sandBottom = new THREE.Mesh(pile, this.sandMat);
    this.sandBottom.position.y = 0.08;
    this.inner.add(this.sandTop, this.sandBottom);
    // Filet de grains
    this.grains = new THREE.InstancedMesh(new THREE.SphereGeometry(0.0065, 6, 4), this.sandMat, GRAINS);
    this.grainSeed = Array.from({ length: GRAINS }, () => [Math.random(), (Math.random() - 0.5) * 0.012, (Math.random() - 0.5) * 0.012]);
    this.inner.add(this.grains);
    this.dummy = new THREE.Object3D();

    this.light = new THREE.PointLight(0xffb04a, 0, 2.5, 1.5);
    this.light.position.set(0, 0.7, 0.5);
    this.inner.add(this.light);
  }

  place(x, z) { this.group.position.set(x, -0.34, z); }

  setQualityLow(low) {
    this.lowQuality = low;
    this.glass.material = low ? this.glassLo : this.glassHi;
    this.grains.count = low ? 80 : GRAINS;
  }

  // durationMs : temps de réflexion attendu (progression du sable)
  show(durationMs) {
    this.duration = Math.max(400, durationMs);
    this.elapsed = 0;
    this.progress = 0;
    this.finishing = null;
    this.state = 'in';
    this.flip = this.reduceMotion ? 0 : 1;
    this.group.visible = true;
  }
  // Fin accélérée du sable puis disparition ; résout quand le sable est écoulé.
  finish(ms = 250) {
    if (this.state === 'hidden') return Promise.resolve();
    return new Promise((res) => { this.finishing = { from: this.progress, t: 0, ms, res }; });
  }
  hide() { if (this.state !== 'hidden') this.state = 'out'; }
  get visible() { return this.state !== 'hidden'; }

  setAlpha(a) {
    for (const m of [this.woodMat, this.brassMat, this.sandMat]) m.opacity = a;
    this.glassLo.opacity = 0.22 * a;
    this.glassHi.opacity = a;
    this.light.intensity = 1.8 * a;
  }

  update(dt) {
    if (this.state === 'hidden') return;
    if (this.state === 'in') { this.alpha = Math.min(1, this.alpha + dt / 0.3); if (this.alpha >= 1) this.state = 'run'; }
    if (this.state === 'out') {
      this.alpha = Math.max(0, this.alpha - dt / 0.3);
      if (this.alpha <= 0) { this.state = 'hidden'; this.group.visible = false; return; }
    }
    this.setAlpha(this.alpha);
    this.group.position.y = -0.34 + (1 - this.alpha) * 0.01 * 1.45;
    // Retournement visible à l'apparition
    if (this.flip > 0) {
      this.flip = Math.max(0, this.flip - dt / 0.5);
      const e = this.flip; const s = e * e * (3 - 2 * e);
      this.inner.rotation.z = s * Math.PI;
      this.inner.position.y = Math.sin(s * Math.PI) * 0.35;
    } else { this.inner.rotation.z = 0; this.inner.position.y = 0; }

    if (this.flip === 0 && this.state !== 'out') {
      if (this.finishing) {
        const f = this.finishing;
        f.t += dt * 1000;
        this.progress = f.from + (1 - f.from) * Math.min(1, f.t / f.ms);
        if (f.t >= f.ms) { this.finishing = null; f.res(); }
      } else {
        this.elapsed += dt * 1000;
        this.progress = Math.min(0.97, this.elapsed / this.duration);
      }
    }
    const p = this.progress;
    const st = Math.cbrt(Math.max(0.0001, 1 - p));
    this.sandTop.scale.set(st, st, st);
    this.sandTop.visible = p < 0.999;
    const sb = Math.cbrt(Math.max(0.0001, p));
    this.sandBottom.scale.set(sb, sb, sb);
    // Filet : visible pendant l'écoulement
    const flowing = p > 0.001 && p < 0.999 && this.flip === 0 && !this.reduceMotion;
    const pileTop = 0.08 + 0.2 * sb;
    const n = this.grains.count;
    const tnow = performance.now() / 1000;
    for (let i = 0; i < n; i++) {
      const [ph, ox, oz] = this.grainSeed[i];
      const k = (ph + tnow * 1.6) % 1;
      const y = flowing ? NECK - k * (NECK - pileTop) : -10;
      this.dummy.position.set(ox * k, y, oz * k);
      this.dummy.updateMatrix();
      this.grains.setMatrixAt(i, this.dummy.matrix);
    }
    this.grains.instanceMatrix.needsUpdate = true;
  }
}
