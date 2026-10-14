// Rendu : renderer PBR, environnement, éclairage, post-traitement, qualité.
import * as THREE from 'three';
import { RoomEnvironment } from 'three/addons/environments/RoomEnvironment.js';
import { EffectComposer } from 'three/addons/postprocessing/EffectComposer.js';
import { RenderPass } from 'three/addons/postprocessing/RenderPass.js';
import { UnrealBloomPass } from 'three/addons/postprocessing/UnrealBloomPass.js';
import { GTAOPass } from 'three/addons/postprocessing/GTAOPass.js';
import { OutputPass } from 'three/addons/postprocessing/OutputPass.js';

export const QUALITY = {
  haut: { label: 'Haut', shadow: 4096, ao: true, samples: 4, maxDpr: 2 },
  moyen: { label: 'Moyen', shadow: 2048, ao: false, samples: 4, maxDpr: 1.5 },
  bas: { label: 'Bas', shadow: 1024, ao: false, samples: 0, maxDpr: 1 },
};

export function detectQuality(renderer) {
  try {
    const gl = renderer.getContext();
    const ext = gl.getExtension('WEBGL_debug_renderer_info');
    const name = ext ? String(gl.getParameter(ext.UNMASKED_RENDERER_WEBGL)) : '';
    if (/swiftshader|llvmpipe|software/i.test(name)) return 'bas';
    // Tablettes (iPad) : écran Retina très dense, budget mémoire et énergie plus serré
    if (navigator.maxTouchPoints > 1 && !matchMedia('(pointer: fine)').matches) return 'moyen';
    if (/apple m\d|apple gpu|radeon pro|nvidia|geforce|rtx/i.test(name)) return 'haut';
    return 'moyen';
  } catch { return 'moyen'; }
}

export class Stage {
  constructor(canvas) {
    this.canvas = canvas;
    this.renderer = new THREE.WebGLRenderer({ canvas, antialias: false, powerPreference: 'high-performance', alpha: false });
    this.renderer.outputColorSpace = THREE.SRGBColorSpace;
    this.renderer.toneMapping = THREE.ACESFilmicToneMapping;
    this.renderer.toneMappingExposure = 1.0;
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFShadowMap;

    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x0b0908);
    this.scene.fog = new THREE.Fog(0x0b0908, 26, 58);

    this.camera = new THREE.PerspectiveCamera(36, 1, 0.1, 200);
    this.camera.position.set(0, 10.4, 12.6);

    const pmrem = new THREE.PMREMGenerator(this.renderer);
    this.scene.environment = pmrem.fromScene(new RoomEnvironment(), 0.04).texture;
    this.scene.environmentIntensity = 0.42;
    pmrem.dispose();

    // Lumière principale chaude, ombres douces
    const key = new THREE.DirectionalLight(0xffeedd, 1.75);
    key.position.set(5.5, 13, 7);
    key.castShadow = true;
    const sc = key.shadow.camera;
    sc.left = -8.5; sc.right = 8.5; sc.top = 8.5; sc.bottom = -8.5; sc.near = 2; sc.far = 32;
    key.shadow.bias = -0.00035;
    key.shadow.normalBias = 0.025;
    key.shadow.radius = 3;
    this.key = key;
    this.scene.add(key);
    // Contre-jour froid
    const rim = new THREE.DirectionalLight(0xcfd6ff, 0.55);
    rim.position.set(-6, 7, -9);
    this.scene.add(rim);
    // Remplissage doux
    this.scene.add(new THREE.HemisphereLight(0xfff4e6, 0x1a120c, 0.22));
    // Douche de lumière sur le plateau (vignettage naturel)
    const pool = new THREE.SpotLight(0xffe6c4, 26, 30, 0.6, 0.8, 1.6);
    pool.position.set(0, 14, 2);
    pool.target.position.set(0, 0, 0);
    this.scene.add(pool, pool.target);

    this.composer = null;
    this.bloom = null;
    this.ao = null;
    this.quality = 'moyen';
    this.viewOffsetPx = 0;
  }

  setQuality(q) {
    this.quality = QUALITY[q] ? q : 'moyen';
    const Q = QUALITY[this.quality];
    this.key.shadow.mapSize.set(Q.shadow, Q.shadow);
    if (this.key.shadow.map) { this.key.shadow.map.dispose(); this.key.shadow.map = null; }
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, Q.maxDpr));
    this.buildComposer();
    this.resize();
  }

  buildComposer() {
    if (this.composer) { this.composer.renderTarget1.dispose(); this.composer.renderTarget2.dispose(); }
    const Q = QUALITY[this.quality];
    const size = this.renderer.getDrawingBufferSize(new THREE.Vector2());
    const rt = new THREE.WebGLRenderTarget(Math.max(1, size.x), Math.max(1, size.y), { type: THREE.HalfFloatType, samples: Q.samples });
    this.composer = new EffectComposer(this.renderer, rt);
    this.composer.addPass(new RenderPass(this.scene, this.camera));
    this.ao = null;
    if (Q.ao) {
      this.ao = new GTAOPass(this.scene, this.camera, size.x, size.y);
      this.ao.blendIntensity = 0.75;
      this.ao.updateGtaoMaterial({ radius: 0.35, distanceExponent: 1.5, thickness: 1.2, scale: 1.0 });
      this.composer.addPass(this.ao);
    }
    // Bloom sélectif par seuil HDR : seuls les éléments émissifs > 1 (signalisation) rayonnent.
    this.bloom = new UnrealBloomPass(new THREE.Vector2(size.x, size.y), 0.7, 0.4, 1.2);
    this.composer.addPass(this.bloom);
    this.composer.addPass(new OutputPass());
  }

  // px : largeur occupée à droite (panneau latéral) ; py : hauteur occupée en bas (panneau en portrait)
  setViewOffset(px, py = 0) { this.viewOffsetPx = px; this.viewOffsetPy = py; this.resize(); }

  // Zone libre où le plateau est centré, rapportée à la hauteur totale (référence du champ vertical)
  freeArea() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = Math.max(1, this.canvas.clientHeight || window.innerHeight);
    return { w: Math.max(1, w - (this.viewOffsetPx || 0)) / h, h: Math.max(1, h - (this.viewOffsetPy || 0)) / h };
  }

  resize() {
    const w = this.canvas.clientWidth || window.innerWidth;
    const h = this.canvas.clientHeight || window.innerHeight;
    this.renderer.setSize(w, h, false);
    this.camera.aspect = w / h;
    // Décale le centre optique pour centrer le plateau dans la zone libre (hors panneau)
    if (this.viewOffsetPx || this.viewOffsetPy) this.camera.setViewOffset(w, h, (this.viewOffsetPx || 0) / 2, (this.viewOffsetPy || 0) / 2, w, h);
    else this.camera.clearViewOffset();
    this.camera.updateProjectionMatrix();
    if (this.composer) {
      const s = this.renderer.getDrawingBufferSize(new THREE.Vector2());
      this.composer.setSize(w, h);
      if (this.ao) this.ao.setSize(s.x, s.y);
    }
  }

  render() { this.composer.render(); }
}
