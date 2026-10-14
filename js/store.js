// Persistance : serveur local (data/state.json) en source de vérité, localStorage en cache.
const LS_KEY = 'echecs3d.state.v1';
const token = document.querySelector('meta[name="e3d-token"]')?.content || '';
export const hasServer = !!token && token !== '__E3D_TOKEN__';

function lsGet() { try { return JSON.parse(localStorage.getItem(LS_KEY) || 'null'); } catch { return null; } }
function lsSet(v) { try { localStorage.setItem(LS_KEY, JSON.stringify(v)); } catch { /* stockage indisponible */ } }

export async function loadState() {
  const local = lsGet();
  if (!hasServer) return { state: local, info: null };
  try {
    const r = await fetch('/api/state', { cache: 'no-store' });
    const j = await r.json();
    const remote = j.state;
    const best = !remote ? local : !local ? remote : (local.updatedAt || 0) > (remote.updatedAt || 0) ? local : remote;
    return { state: best, info: { fallback: j.fallback, recovered: j.recovered } };
  } catch { return { state: local, info: null }; }
}

let timer = null, pending = null;
export function saveState(state) {
  state.updatedAt = Date.now();
  lsSet(state);
  if (!hasServer) return;
  pending = state;
  clearTimeout(timer);
  timer = setTimeout(flush, 250);
}
async function flush() {
  if (!pending) return;
  const body = JSON.stringify(pending);
  pending = null;
  try {
    await fetch('/api/state', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Echecs3D-Token': token }, body });
  } catch { /* le bandeau serveur signalera l'arrêt */ }
}
export function flushNow() { clearTimeout(timer); return flush(); }

export async function shutdownServer() {
  if (!hasServer) return;
  await flushNow();
  try { await fetch('/api/shutdown', { method: 'POST', headers: { 'Content-Type': 'application/json', 'X-Echecs3D-Token': token }, body: '{}' }); } catch { /* déjà arrêté */ }
}

// Connexion persistante : tant qu'elle est ouverte, le serveur reste actif.
export function connectLifecycle(onDown, onUp) {
  if (!hasServer) return;
  let failures = 0;
  const es = new EventSource('/api/events?t=' + encodeURIComponent(token));
  es.onopen = () => { failures = 0; onUp?.(); };
  es.onerror = () => { failures++; if (failures >= 3) onDown?.(); };
}
