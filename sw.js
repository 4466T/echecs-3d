// Échecs 3D — service worker (généré, version c71212de33f1)
const CACHE = 'echecs3d-c71212de33f1';
const FILES = [
 "./",
 "css/style.css",
 "icons/apple-touch-icon.png",
 "icons/icon-192.png",
 "icons/icon-512.png",
 "icons/icon-maskable-512.png",
 "js/audio.js",
 "js/board.js",
 "js/camera.js",
 "js/engine.js",
 "js/hourglass.js",
 "js/main.js",
 "js/pieces.js",
 "js/scene.js",
 "js/signals.js",
 "js/store.js",
 "js/textures.js",
 "js/themes.js",
 "js/ui.js",
 "manifest.webmanifest",
 "vendor/chess.js/chess.js",
 "vendor/stockfish/stockfish-19-lite-single.js",
 "vendor/stockfish/stockfish-19-lite-single.wasm",
 "vendor/three/addons/controls/OrbitControls.js",
 "vendor/three/addons/environments/RoomEnvironment.js",
 "vendor/three/addons/math/SimplexNoise.js",
 "vendor/three/addons/postprocessing/EffectComposer.js",
 "vendor/three/addons/postprocessing/GTAOPass.js",
 "vendor/three/addons/postprocessing/MaskPass.js",
 "vendor/three/addons/postprocessing/OutputPass.js",
 "vendor/three/addons/postprocessing/Pass.js",
 "vendor/three/addons/postprocessing/RenderPass.js",
 "vendor/three/addons/postprocessing/ShaderPass.js",
 "vendor/three/addons/postprocessing/UnrealBloomPass.js",
 "vendor/three/addons/shaders/CopyShader.js",
 "vendor/three/addons/shaders/GTAOShader.js",
 "vendor/three/addons/shaders/LuminosityHighPassShader.js",
 "vendor/three/addons/shaders/OutputShader.js",
 "vendor/three/addons/shaders/PoissonDenoiseShader.js",
 "vendor/three/addons/utils/BufferGeometryUtils.js",
 "vendor/three/three.core.js",
 "vendor/three/three.module.js"
];
self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k.startsWith('echecs3d-') && k !== CACHE).map((k) => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  const req = e.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  const isPage = req.mode === 'navigate';
  e.respondWith(caches.open(CACHE).then(async (c) => {
    const hit = await c.match(isPage ? './' : req, { ignoreSearch: true });
    if (hit) return hit;
    try { return await fetch(req); } catch { return (await c.match('./')) || Response.error(); }
  }));
});
