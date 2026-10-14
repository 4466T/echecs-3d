// Pièces Staunton procédurales : profils de révolution lissés + Cavalier sculpté.
import * as THREE from 'three';
import { mergeGeometries, mergeVertices } from 'three/addons/utils/BufferGeometryUtils.js';
import { woodCanvas, canvasToTexture } from './textures.js';

const SEG = 72;

function arc(cx, cy, r, a0, a1, n) {
  const pts = [];
  for (let i = 0; i <= n; i++) {
    const a = a0 + (a1 - a0) * (i / n);
    pts.push([cx + r * Math.cos(a), cy + r * Math.sin(a)]);
  }
  return pts;
}
function base(rB) {
  return [[0, 0], [rB, 0], [rB + 0.012, 0.022], [rB + 0.006, 0.05], [rB - 0.03, 0.072], [rB - 0.04, 0.09]];
}
function lathe(ctrl, samples = 160) {
  const pts = ctrl.map(([r, y]) => new THREE.Vector2(Math.max(0, r), y));
  const curve = new THREE.SplineCurve(pts);
  const out = curve.getSpacedPoints(samples).map((p) => new THREE.Vector2(Math.max(0, p.x), p.y));
  out[0].set(0, out[0].y);
  out[out.length - 1].set(0, out[out.length - 1].y);
  return new THREE.LatheGeometry(out, SEG);
}
const ni = (g) => (g.index ? g.toNonIndexed() : g);
function merge(list) {
  const g = mergeGeometries(list.map((x) => { const n = ni(x); n.clearGroups(); return n; }), false);
  g.computeBoundingBox();
  return g;
}

function pawn() {
  return lathe([
    ...base(0.3),
    [0.24, 0.11], [0.245, 0.135], [0.2, 0.16], [0.15, 0.22], [0.12, 0.31],
    [0.18, 0.355], [0.19, 0.38], [0.13, 0.405], [0.1, 0.43],
    ...arc(0, 0.585, 0.16, -1.25, Math.PI / 2, 22),
  ]);
}
function rook() {
  const body = lathe([
    ...base(0.34),
    [0.28, 0.11], [0.29, 0.14], [0.25, 0.17], [0.215, 0.23], [0.2, 0.42], [0.2, 0.56],
    [0.235, 0.6], [0.245, 0.63], [0.23, 0.655], [0.255, 0.69], [0.265, 0.8], [0.275, 0.835],
    [0.272, 0.845], [0.2, 0.845], [0.195, 0.8], [0.0, 0.8],
  ]);
  const parts = [body];
  const n = 6;
  for (let i = 0; i < n; i++) {
    const a = (i / n) * Math.PI * 2;
    const m = new THREE.BoxGeometry(0.105, 0.085, 0.07, 1, 1, 1);
    m.translate(0, 0.885, 0.235);
    m.rotateY(a);
    parts.push(m);
  }
  return merge(parts);
}
function bishop() {
  return lathe([
    ...base(0.32),
    [0.255, 0.11], [0.26, 0.14], [0.2, 0.185], [0.14, 0.3], [0.11, 0.5],
    [0.175, 0.555], [0.185, 0.585], [0.12, 0.605], [0.135, 0.63], [0.175, 0.65], [0.11, 0.675],
    [0.125, 0.72], [0.165, 0.8], [0.172, 0.875], [0.15, 0.955], [0.1, 1.025], [0.05, 1.07], [0.032, 1.09],
    ...arc(0, 1.13, 0.045, -1.2, Math.PI / 2, 10),
  ]);
}
function queen() {
  const body = lathe([
    ...base(0.35),
    [0.285, 0.11], [0.29, 0.14], [0.22, 0.19], [0.15, 0.32], [0.12, 0.6],
    [0.2, 0.66], [0.21, 0.69], [0.13, 0.715], [0.15, 0.745], [0.19, 0.765], [0.13, 0.795],
    [0.14, 0.9], [0.195, 1.09], [0.228, 1.17], [0.222, 1.2], [0.17, 1.215], [0.15, 1.235],
    [0.12, 1.258], [0.065, 1.29], [0.04, 1.31],
    ...arc(0, 1.355, 0.055, -1.1, Math.PI / 2, 12),
  ]);
  const parts = [body];
  for (let i = 0; i < 10; i++) {
    const s = new THREE.SphereGeometry(0.03, 16, 12);
    s.translate(0.215, 1.215, 0);
    s.rotateY((i / 10) * Math.PI * 2);
    parts.push(s);
  }
  return merge(parts);
}
function king() {
  const body = lathe([
    ...base(0.36),
    [0.295, 0.11], [0.3, 0.14], [0.23, 0.19], [0.16, 0.33], [0.13, 0.64],
    [0.21, 0.7], [0.22, 0.73], [0.14, 0.755], [0.16, 0.785], [0.2, 0.805], [0.14, 0.835],
    [0.15, 0.95], [0.2, 1.12], [0.232, 1.2], [0.226, 1.235], [0.19, 1.25], [0.2, 1.27],
    [0.15, 1.31], [0.09, 1.34], [0.045, 1.355], [0.04, 1.39], [0.0, 1.39],
  ]);
  const v = new THREE.BoxGeometry(0.062, 0.22, 0.062); v.translate(0, 1.49, 0);
  const h = new THREE.BoxGeometry(0.17, 0.058, 0.062); h.translate(0, 1.5, 0);
  return merge([body, v, h]);
}
const smooth = (a, b, x) => { const t = Math.min(1, Math.max(0, (x - a) / (b - a))); return t * t * (3 - 2 * t); };

// Lisse une géométrie non indexée (fusion des sommets) et lui donne des UV planes.
function smoothed(geo) {
  geo.deleteAttribute('normal');
  geo.deleteAttribute('uv');
  const g = mergeVertices(geo, 1e-4);
  g.computeVertexNormals();
  const pos = g.attributes.position;
  const uv = new Float32Array(pos.count * 2);
  for (let i = 0; i < pos.count; i++) { uv[i * 2] = pos.getX(i) * 0.8 + 0.5; uv[i * 2 + 1] = pos.getY(i) * 0.8; }
  g.setAttribute('uv', new THREE.BufferAttribute(uv, 2));
  return g;
}

function knight() {
  const foot = lathe([
    ...base(0.34),
    [0.27, 0.11], [0.28, 0.14], [0.25, 0.165], [0.235, 0.185], [0.0, 0.185],
  ]);
  // Silhouette Staunton (u = vers le museau, v = hauteur au-dessus du socle)
  const P = [
    [-0.2, 0.0], [-0.24, 0.1], [-0.25, 0.22], [-0.23, 0.36], [-0.185, 0.5], [-0.13, 0.62],
    [-0.085, 0.72], [-0.05, 0.8], [0.0, 0.835], [0.06, 0.83], [0.12, 0.79], [0.19, 0.72],
    [0.25, 0.64], [0.3, 0.56], [0.335, 0.5], [0.34, 0.45], [0.315, 0.415], [0.25, 0.405],
    [0.18, 0.415], [0.12, 0.44], [0.075, 0.44], [0.065, 0.38], [0.09, 0.28], [0.14, 0.18],
    [0.19, 0.08], [0.2, 0.0],
  ];
  const shape = new THREE.Shape();
  shape.moveTo(P[0][0], P[0][1]);
  shape.splineThru(P.slice(1).map(([u, v]) => new THREE.Vector2(u, v)));
  shape.closePath();
  const depth = 0.26;
  let head = new THREE.ExtrudeGeometry(shape, { depth, steps: 6, bevelEnabled: true, bevelThickness: 0.07, bevelSize: 0.05, bevelSegments: 10, curveSegments: 120 });
  head.translate(0, 0, -depth / 2);
  // Modelage : tête et museau affinés, crinière plus étroite, encolure pleine
  const pos = head.attributes.position;
  for (let i = 0; i < pos.count; i++) {
    const u = pos.getX(i), v = pos.getY(i);
    let f = 1;
    f *= 1 - 0.42 * smooth(0.02, 0.34, u) * smooth(0.36, 0.62, v);
    f *= 1 - 0.3 * smooth(0.7, 0.84, v);
    f *= 1 - 0.22 * smooth(-0.12, -0.25, u);
    f *= 1 + 0.08 * (1 - smooth(0.0, 0.3, v));
    pos.setZ(i, pos.getZ(i) * f);
  }
  head = smoothed(head);
  head.translate(0, 0.17, 0);
  const parts = [foot, head];
  // Oreilles
  for (const side of [-1, 1]) {
    const ear = new THREE.ConeGeometry(0.042, 0.15, 20, 1);
    ear.scale(1, 1, 0.7);
    ear.rotateZ(-0.3);
    ear.rotateX(side * 0.22);
    ear.translate(0.0, 0.17 + 0.86, side * 0.06);
    parts.push(ear);
  }
  // Crinière : arête de petites mèches le long de la nuque
  const maneCurve = new THREE.CatmullRomCurve3([
    new THREE.Vector3(-0.235, 0.17 + 0.16, 0), new THREE.Vector3(-0.235, 0.17 + 0.32, 0),
    new THREE.Vector3(-0.19, 0.17 + 0.48, 0), new THREE.Vector3(-0.13, 0.17 + 0.6, 0),
    new THREE.Vector3(-0.075, 0.17 + 0.72, 0), new THREE.Vector3(-0.035, 0.17 + 0.8, 0),
  ]);
  const mane = new THREE.TubeGeometry(maneCurve, 48, 0.045, 14, false);
  mane.scale(1, 1, 0.75);
  mane.translate(-0.022, 0, 0);
  parts.push(mane);
  // Yeux et naseaux
  for (const side of [-1, 1]) {
    const eye = new THREE.SphereGeometry(0.028, 16, 12);
    eye.scale(1.2, 0.8, 0.6);
    eye.translate(0.12, 0.17 + 0.7, side * 0.162);
    parts.push(eye);
    const nostril = new THREE.TorusGeometry(0.018, 0.006, 8, 16);
    nostril.rotateY(Math.PI / 2 - side * 0.5);
    nostril.translate(0.31, 0.17 + 0.47, side * 0.125);
    parts.push(nostril);
  }
  return merge(parts);
}

let cache = null;
export function pieceGeometries() {
  if (cache) return cache;
  cache = { p: pawn(), r: rook(), n: knight(), b: bishop(), q: queen(), k: king() };
  return cache;
}

const matCache = new Map();
export function pieceMaterial(theme, color) {
  const key = theme.id + color;
  if (!matCache.has(key)) {
    const spec = color === 'w' ? theme.whitePiece : theme.blackPiece;
    const grain = canvasToTexture(woodCanvas(512, spec.grainA, spec.grainB, color === 'w' ? 11 : 13, { rings: 3, warp: 1.2 }));
    grain.repeat.set(2, 1);
    const m = new THREE.MeshPhysicalMaterial({
      color: 0xffffff,
      map: grain,
      roughness: spec.roughness,
      metalness: 0,
      clearcoat: color === 'w' ? 0.55 : 0.9,
      clearcoatRoughness: color === 'w' ? 0.25 : 0.12,
      sheen: color === 'w' ? 0.15 : 0,
      emissive: 0x000000,
    });
    matCache.set(key, m);
  }
  return matCache.get(key).clone(); // clone : émissif propre à chaque pièce
}

export function createPieceMesh(type, color, theme) {
  const geo = pieceGeometries()[type];
  const mesh = new THREE.Mesh(geo, pieceMaterial(theme, color));
  mesh.castShadow = true;
  mesh.receiveShadow = true;
  mesh.userData = { type, color };
  // Cavaliers orientés vers l'adversaire avec un léger trois-quarts (profil lisible depuis la place du joueur)
  if (type === 'n') mesh.rotation.y = color === 'w' ? Math.PI / 2 + 0.55 : -Math.PI / 2 + 0.55;
  return mesh;
}

export const PIECE_HEIGHT = { p: 0.75, r: 0.93, n: 1.04, b: 1.18, q: 1.41, k: 1.6 };
