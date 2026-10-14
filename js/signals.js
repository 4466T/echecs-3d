// Signalisation lumineuse : sélection, coups légaux, dernier coup, échec (rouge), fin de partie, indice.
import * as THREE from 'three';
import { sqToPos, FILES } from './board.js';

const Y = 0.004;
const C = {
  last: new THREE.Color(1.0, 0.74, 0.32),
  select: new THREE.Color(2.6, 1.85, 0.7),
  legal: new THREE.Color(2.1, 1.55, 0.6),
  capture: new THREE.Color(2.6, 1.25, 0.45),
  check: new THREE.Color(4.2, 0.28, 0.2),
  draw: new THREE.Color(2.2, 1.5, 0.4),
  hint: new THREE.Color(0.7, 2.8, 1.4),
  win: new THREE.Color(1.8, 1.4, 0.5),
};

function basic(color, opacity) {
  return new THREE.MeshBasicMaterial({ color, transparent: true, opacity, depthWrite: false, polygonOffset: true, polygonOffsetFactor: -2, polygonOffsetUnits: -2 });
}

export class Signals {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.time = 0;
    this.reduceMotion = false;

    // Teintes de cases (dernier coup / sélection)
    this.tint = {};
    const tg = new THREE.PlaneGeometry(0.985, 0.985);
    for (let f = 0; f < 8; f++) for (let r = 1; r <= 8; r++) {
      const sq = FILES[f] + r;
      const m = new THREE.Mesh(tg, basic(C.last.clone(), 0));
      m.rotation.x = -Math.PI / 2;
      const p = sqToPos(sq);
      m.position.set(p.x, Y, p.z);
      m.visible = false;
      m.renderOrder = 2;
      this.group.add(m);
      this.tint[sq] = m;
    }
    this.last = null;
    this.selected = null;

    // Marqueurs de coups légaux (réserve)
    this.dotGeo = new THREE.CircleGeometry(0.12, 40);
    this.ringGeo = new THREE.RingGeometry(0.37, 0.46, 64);
    this.markers = [];

    // Halo de sélection au pied de la pièce
    this.halo = new THREE.Mesh(new THREE.RingGeometry(0.34, 0.47, 72), basic(C.select.clone(), 0.85));
    this.halo.rotation.x = -Math.PI / 2;
    this.halo.visible = false;
    this.halo.renderOrder = 3;
    this.group.add(this.halo);
    // Projecteur suivant la pièce sélectionnée / en mouvement
    this.spot = new THREE.SpotLight(0xffd59a, 0, 6, 0.32, 0.55, 1.2);
    this.spot.castShadow = false;
    this.group.add(this.spot, this.spot.target);
    this.spotTargetIntensity = 0;
    this.spotFollow = null;

    // Échec : anneau + disque rouges pulsants et lumière rouge
    this.checkDisk = new THREE.Mesh(new THREE.CircleGeometry(0.49, 64), basic(C.check.clone(), 0.55));
    this.checkDisk.rotation.x = -Math.PI / 2;
    this.checkDisk.visible = false;
    this.checkDisk.renderOrder = 3;
    this.checkRing = new THREE.Mesh(new THREE.RingGeometry(0.46, 0.5, 72), basic(C.check.clone(), 1));
    this.checkRing.rotation.x = -Math.PI / 2;
    this.checkRing.visible = false;
    this.checkRing.renderOrder = 4;
    this.checkLight = new THREE.PointLight(0xff2a1a, 0, 3.2, 1.6);
    this.group.add(this.checkDisk, this.checkRing, this.checkLight);
    this.checkState = null; // { king, attackers:[mesh], mate }
    this.endRings = [];

    // Flèche d'indice
    this.arrow = null;
  }

  setLastMove(from, to) {
    if (this.last) for (const s of this.last) this.tint[s].visible = false;
    this.last = from ? [from, to] : null;
    this.refreshTints();
  }

  refreshTints() {
    for (const m of Object.values(this.tint)) m.visible = false;
    if (this.last) for (const s of this.last) {
      const m = this.tint[s];
      m.material.color.copy(C.last); m.material.opacity = 0.34; m.visible = true;
    }
    if (this.selected) {
      const m = this.tint[this.selected];
      m.material.color.copy(C.select); m.material.opacity = 0.42; m.visible = true;
    }
  }

  select(square, mesh, legalMoves) {
    this.clearMarkers();
    this.selected = square;
    this.refreshTints();
    if (!square) {
      this.halo.visible = false;
      this.spotTargetIntensity = 0;
      this.spotFollow = null;
      return;
    }
    const p = sqToPos(square);
    this.halo.position.set(p.x, Y + 0.001, p.z);
    this.halo.visible = true;
    this.spotFollow = mesh;
    this.spotTargetIntensity = 26;
    for (const mv of legalMoves) {
      const cap = !!mv.captured;
      const mk = new THREE.Mesh(cap ? this.ringGeo : this.dotGeo, basic((cap ? C.capture : C.legal).clone(), cap ? 0.9 : 0.85));
      mk.rotation.x = -Math.PI / 2;
      const q = sqToPos(mv.to);
      mk.position.set(q.x, Y + 0.002, q.z);
      mk.renderOrder = 3;
      mk.userData.square = mv.to;
      this.group.add(mk);
      this.markers.push(mk);
    }
  }

  // Pièce en mouvement : le projecteur la suit pendant le trajet
  follow(mesh) { this.spotFollow = mesh; this.spotTargetIntensity = mesh ? 22 : 0; }

  clearMarkers() {
    for (const m of this.markers) { this.group.remove(m); m.material.dispose(); }
    this.markers = [];
  }

  setCheck(kingMesh, kingSquare, attackerMeshes, mate) {
    this.clearCheck();
    if (!kingSquare) return;
    const p = sqToPos(kingSquare);
    this.checkDisk.position.set(p.x, Y + 0.0015, p.z);
    this.checkRing.position.set(p.x, Y + 0.0025, p.z);
    this.checkLight.position.set(p.x, 1.1, p.z);
    this.checkDisk.visible = this.checkRing.visible = true;
    this.checkState = { king: kingMesh, attackers: attackerMeshes, mate };
  }

  clearCheck() {
    if (this.checkState) {
      const { king, attackers } = this.checkState;
      for (const m of [king, ...attackers]) if (m) m.material.emissive.setRGB(0, 0, 0);
    }
    this.checkState = null;
    this.checkDisk.visible = this.checkRing.visible = false;
    this.checkLight.intensity = 0;
  }

  setDraw(squares) {
    this.clearEnd();
    for (const s of squares) {
      const r = new THREE.Mesh(new THREE.RingGeometry(0.4, 0.48, 64), basic(C.draw.clone(), 0.9));
      r.rotation.x = -Math.PI / 2;
      const p = sqToPos(s);
      r.position.set(p.x, Y + 0.003, p.z);
      this.group.add(r);
      this.endRings.push(r);
    }
  }
  clearEnd() {
    for (const r of this.endRings) { this.group.remove(r); r.geometry.dispose(); r.material.dispose(); }
    this.endRings = [];
  }

  showHint(from, to) {
    this.clearHint();
    const a = sqToPos(from), b = sqToPos(to);
    const dir = new THREE.Vector3().subVectors(b, a);
    const len = dir.length();
    const shape = new THREE.Shape();
    const w = 0.09, hw = 0.24, hl = 0.36, L = Math.max(0.2, len - 0.15);
    shape.moveTo(-w, 0); shape.lineTo(-w, L - hl); shape.lineTo(-hw, L - hl); shape.lineTo(0, L);
    shape.lineTo(hw, L - hl); shape.lineTo(w, L - hl); shape.lineTo(w, 0); shape.closePath();
    const g = new THREE.ShapeGeometry(shape);
    const m = new THREE.Mesh(g, basic(C.hint.clone(), 0.85));
    m.rotation.x = -Math.PI / 2;
    m.rotation.z = Math.atan2(-dir.x, -dir.z); // aligne l'axe +y local sur la direction (Rz puis Rx)
    m.position.set(a.x, 0.012, a.z);
    m.renderOrder = 5;
    this.arrow = m;
    this.group.add(m);
    this.arrowT = 0;
  }
  clearHint() {
    if (this.arrow) { this.group.remove(this.arrow); this.arrow.geometry.dispose(); this.arrow.material.dispose(); this.arrow = null; }
  }

  clearAll() {
    this.select(null);
    this.setLastMove(null);
    this.clearCheck();
    this.clearEnd();
    this.clearHint();
  }

  update(dt) {
    this.time += dt;
    const t = this.time;
    // Projecteur
    if (this.spotFollow) {
      const wp = new THREE.Vector3();
      this.spotFollow.getWorldPosition(wp);
      this.spot.position.set(wp.x, wp.y + 3.4, wp.z + 0.4);
      this.spot.target.position.copy(wp);
    }
    this.spot.intensity += (this.spotTargetIntensity - this.spot.intensity) * Math.min(1, dt * 8);
    if (this.halo.visible) this.halo.material.opacity = this.reduceMotion ? 0.85 : 0.7 + 0.2 * Math.sin(t * 3.2);
    // Échec : pulsation rouge lente
    if (this.checkState) {
      const { king, attackers, mate } = this.checkState;
      const pulse = mate || this.reduceMotion ? 1 : 0.55 + 0.45 * (0.5 + 0.5 * Math.sin(t * 3.4));
      this.checkDisk.material.opacity = (mate ? 0.7 : 0.38) * pulse + 0.12;
      this.checkRing.material.opacity = pulse;
      this.checkLight.intensity = (mate ? 9 : 6) * pulse;
      if (king) king.material.emissive.setRGB(0.55 * pulse, 0.03, 0.02);
      for (const a of attackers) a.material.emissive.setRGB(0.32 * pulse, 0.02, 0.01);
    }
    if (this.arrow) this.arrow.material.opacity = this.reduceMotion ? 0.85 : 0.6 + 0.3 * Math.sin(t * 4);
  }
}
