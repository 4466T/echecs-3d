// Textures procédurales (bois, marbre, feutre) — aucune ressource externe.
import * as THREE from 'three';

function hash(x, y, s) {
  let h = (x * 374761393 + y * 668265263 + s * 1442695041) | 0;
  h = Math.imul(h ^ (h >>> 13), 1274126177);
  return ((h ^ (h >>> 16)) >>> 0) / 4294967295;
}
function vnoise(x, y, s) {
  const xi = Math.floor(x), yi = Math.floor(y);
  const xf = x - xi, yf = y - yi;
  const u = xf * xf * (3 - 2 * xf), v = yf * yf * (3 - 2 * yf);
  const a = hash(xi, yi, s), b = hash(xi + 1, yi, s), c = hash(xi, yi + 1, s), d = hash(xi + 1, yi + 1, s);
  return a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v;
}
function fbm(x, y, s, oct = 4) {
  let t = 0, amp = 0.5, f = 1;
  for (let i = 0; i < oct; i++) { t += amp * vnoise(x * f, y * f, s + i * 17); f *= 2; amp *= 0.5; }
  return t;
}
const mix = (a, b, t) => a + (b - a) * t;
const hex = (h) => [(h >> 16) & 255, (h >> 8) & 255, h & 255];

function makeTexture(canvas, srgb = true) {
  const t = new THREE.CanvasTexture(canvas);
  if (srgb) t.colorSpace = THREE.SRGBColorSpace;
  t.wrapS = t.wrapT = THREE.RepeatWrapping;
  t.anisotropy = 8;
  t.needsUpdate = true;
  return t;
}

// Bois : fil longitudinal + cernes ondulés + pores.
export function woodCanvas(size, light, dark, seed, opts = {}) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const L = hex(light), D = hex(dark);
  const rings = opts.rings ?? 9, warp = opts.warp ?? 2.2;
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const w = fbm(nx * 3, ny * 0.6, seed, 4) * warp;
      let r = (ny * rings + w) % 1;
      r = Math.pow(Math.abs(Math.sin(r * Math.PI)), 6);
      const grain = fbm(nx * 140, ny * 4, seed + 7, 2);
      const pore = vnoise(nx * 600, ny * 40, seed + 3) > 0.92 ? 0.25 : 0;
      let t = Math.min(1, r * 0.55 + grain * 0.35 + pore);
      const i = (y * size + x) * 4;
      img.data[i] = mix(L[0], D[0], t);
      img.data[i + 1] = mix(L[1], D[1], t);
      img.data[i + 2] = mix(L[2], D[2], t);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

// Marbre : veines par turbulence.
export function marbleCanvas(size, base, vein, seed, contrast = 1) {
  const c = document.createElement('canvas');
  c.width = c.height = size;
  const ctx = c.getContext('2d');
  const img = ctx.createImageData(size, size);
  const B = hex(base), V = hex(vein);
  for (let y = 0; y < size; y++) {
    for (let x = 0; x < size; x++) {
      const nx = x / size, ny = y / size;
      const turb = fbm(nx * 4, ny * 4, seed, 5);
      const v = Math.abs(Math.sin((nx * 3 + ny * 2 + turb * 4.5) * Math.PI));
      let t = Math.pow(1 - v, 9) * contrast + fbm(nx * 20, ny * 20, seed + 5, 2) * 0.12;
      t = Math.min(1, t);
      const i = (y * size + x) * 4;
      img.data[i] = mix(B[0], V[0], t);
      img.data[i + 1] = mix(B[1], V[1], t);
      img.data[i + 2] = mix(B[2], V[2], t);
      img.data[i + 3] = 255;
    }
  }
  ctx.putImageData(img, 0, 0);
  return c;
}

export function canvasToTexture(c, srgb = true) { return makeTexture(c, srgb); }

// Dessus du cadre : bois + coordonnées incrustées (a–h, 1–8).
export function frameTopCanvas(size, theme, flipped) {
  const base = theme.frameStyle === 'marble'
    ? marbleCanvas(size, theme.frameLight, theme.frameDark, 41, 0.9)
    : woodCanvas(size, theme.frameLight, theme.frameDark, 41, { rings: 14, warp: 3 });
  const ctx = base.getContext('2d');
  const border = 1.1 / 10.2; // largeur du bord en fraction
  const cell = (8 / 10.2) * size / 8;
  const off = border * size;
  ctx.fillStyle = theme.inlay;
  ctx.font = `600 ${Math.round(cell * 0.32)}px "Iowan Old Style", "Palatino", Georgia, serif`;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  const files = 'abcdefgh';
  for (let i = 0; i < 8; i++) {
    const f = flipped ? files[7 - i] : files[i];
    const r = flipped ? String(i + 1) : String(8 - i);
    const cx = off + cell * (i + 0.5);
    ctx.fillText(f, cx, size - off * 0.45);
    ctx.fillText(f, cx, off * 0.45);
    ctx.fillText(r, off * 0.45, off + cell * (i + 0.5));
    ctx.fillText(r, size - off * 0.45, off + cell * (i + 0.5));
  }
  // filet d'incrustation autour des cases
  ctx.strokeStyle = theme.inlay;
  ctx.lineWidth = Math.max(2, size / 400);
  const pad = off - size * 0.012;
  ctx.strokeRect(pad, pad, size - 2 * pad, size - 2 * pad);
  return base;
}

// Table : bois sombre large.
export function tableCanvas(size) {
  return woodCanvas(size, 0x3a2418, 0x1a0e08, 77, { rings: 5, warp: 4 });
}
