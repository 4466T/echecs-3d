// Plateau, cadre gravé, table ; conversions case <-> position.
import * as THREE from 'three';
import { woodCanvas, marbleCanvas, frameTopCanvas, tableCanvas, canvasToTexture } from './textures.js';

export const FILES = 'abcdefgh';
export function sqToPos(sq) {
  const f = sq.charCodeAt(0) - 97;
  const r = Number(sq[1]);
  return new THREE.Vector3(f - 3.5, 0, 3.5 - (r - 1));
}
export function posToSq(x, z) {
  const f = Math.floor(x + 4);
  const r = Math.floor(4 - z) + 1;
  if (f < 0 || f > 7 || r < 1 || r > 8) return null;
  return FILES[f] + r;
}
export function isLightSquare(sq) {
  const f = sq.charCodeAt(0) - 97, r = Number(sq[1]);
  return (f + r) % 2 === 1;
}

const canvasCache = new Map();
function cached(key, make) {
  if (!canvasCache.has(key)) canvasCache.set(key, make());
  return canvasCache.get(key);
}

export class Board {
  constructor(scene) {
    this.scene = scene;
    this.group = new THREE.Group();
    scene.add(this.group);
    this.table = null;
    this.disposables = [];
    this.plane = new THREE.Plane(new THREE.Vector3(0, 1, 0), 0);
  }

  build(theme, flipped) {
    this.clear();
    const keep = (x) => { this.disposables.push(x); return x; };

    // Table
    const tableTex = keep(canvasToTexture(cached('table', () => tableCanvas(1024))));
    tableTex.repeat.set(9, 9);
    const table = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(70, 70)),
      keep(new THREE.MeshPhysicalMaterial({ map: tableTex, color: 0x9a8070, roughness: 0.65, clearcoat: 0.12, clearcoatRoughness: 0.6 })),
    );
    table.rotation.x = -Math.PI / 2;
    table.position.y = -0.34;
    table.receiveShadow = true;
    this.group.add(table);

    // Cadre (corps)
    const sideTex = keep(canvasToTexture(cached('side' + theme.id, () => woodCanvas(512, theme.frameLight, theme.frameDark, 23, { rings: 6 }))));
    const frameMat = keep(new THREE.MeshPhysicalMaterial({ map: sideTex, roughness: 0.45, clearcoat: 0.5, clearcoatRoughness: 0.3 }));
    const frame = new THREE.Mesh(keep(new THREE.BoxGeometry(10.2, 0.32, 10.2)), frameMat);
    frame.position.y = -0.17;
    frame.castShadow = true;
    frame.receiveShadow = true;
    this.group.add(frame);
    // Biseau inférieur (socle légèrement plus large)
    const plinth = new THREE.Mesh(keep(new THREE.BoxGeometry(10.5, 0.04, 10.5)), frameMat);
    plinth.position.y = -0.32;
    plinth.receiveShadow = true;
    this.group.add(plinth);

    // Dessus du cadre avec coordonnées incrustées
    const topTex = keep(canvasToTexture(cached('top' + theme.id + flipped, () => frameTopCanvas(2048, theme, flipped))));
    topTex.wrapS = topTex.wrapT = THREE.ClampToEdgeWrapping;
    if (flipped) { topTex.center.set(0.5, 0.5); topTex.rotation = Math.PI; }
    const top = new THREE.Mesh(
      keep(new THREE.PlaneGeometry(10.2, 10.2)),
      keep(new THREE.MeshPhysicalMaterial({ map: topTex, roughness: 0.35, clearcoat: 0.9, clearcoatRoughness: 0.15 })),
    );
    top.rotation.x = -Math.PI / 2;
    top.position.y = -0.009;
    top.receiveShadow = true;
    this.group.add(top);

    // Cases
    const mk = (c) => canvasToTexture(c);
    const lightC = cached('L' + theme.id, () => theme.squareStyle === 'marble' ? marbleCanvas(1024, theme.light[0], theme.light[1], 5, 0.8) : woodCanvas(1024, theme.light[0], theme.light[1], 5, { rings: 7 }));
    const darkC = cached('D' + theme.id, () => theme.squareStyle === 'marble' ? marbleCanvas(1024, theme.dark[0], theme.dark[1], 9, 1.0) : woodCanvas(1024, theme.dark[0], theme.dark[1], 9, { rings: 8 }));
    const lightT = keep(mk(lightC));
    const darkT = keep(mk(darkC));
    const tileGeo = keep(new THREE.BoxGeometry(0.998, 0.05, 0.998));
    const rough = theme.squareStyle === 'marble' ? 0.18 : 0.38;
    for (let f = 0; f < 8; f++) {
      for (let r = 1; r <= 8; r++) {
        const sq = FILES[f] + r;
        const light = isLightSquare(sq);
        const t = (light ? lightT : darkT).clone();
        t.repeat.set(0.25, 0.25);
        t.offset.set(((f * 3 + r * 5) % 4) * 0.25, ((f * 7 + r) % 4) * 0.25);
        if ((f + r) % 3 === 0) { t.center.set(0.5, 0.5); t.rotation = Math.PI / 2; }
        keep(t);
        const m = keep(new THREE.MeshPhysicalMaterial({ map: t, roughness: rough, clearcoat: 0.7, clearcoatRoughness: 0.12 }));
        const tile = new THREE.Mesh(tileGeo, m);
        const p = sqToPos(sq);
        tile.position.set(p.x, -0.025, p.z);
        tile.receiveShadow = true;
        tile.userData.square = sq;
        this.group.add(tile);
      }
    }
  }

  clear() {
    for (const c of [...this.group.children]) this.group.remove(c);
    for (const d of this.disposables) d.dispose?.();
    this.disposables = [];
  }

  // Intersection rayon / plan du plateau (y = h)
  pick(raycaster, h = 0) {
    this.plane.constant = -h;
    const p = new THREE.Vector3();
    if (!raycaster.ray.intersectPlane(this.plane, p)) return null;
    return { point: p, square: posToSq(p.x, p.z) };
  }
}
