// Pont UCI vers Stockfish 19 (lite, single-thread) exécuté dans un Web Worker.
export const ENGINE_URL = 'vendor/stockfish/stockfish-19-lite-single.js';

export const LEVELS = [
  { name: 'Débutant', skill: 0, depth: 1, movetime: 200, humanDelay: [900, 1500] },
  { name: 'Novice', skill: 2, depth: 2, movetime: 300, humanDelay: [800, 1400] },
  { name: 'Amateur', skill: 5, depth: 4, movetime: 400, humanDelay: [700, 1300] },
  { name: 'Club', skill: 8, depth: 6, movetime: 600, humanDelay: [600, 1100] },
  { name: 'Confirmé', skill: 11, depth: 9, movetime: 900, humanDelay: [400, 900] },
  { name: 'Expert', skill: 14, depth: 14, movetime: 1200, humanDelay: [0, 0] },
  { name: 'Maître', skill: 17, depth: 30, movetime: 1800, humanDelay: [0, 0] },
  { name: 'Grand Maître', skill: 20, depth: 60, movetime: 2600, humanDelay: [0, 0] },
];

export class Engine extends EventTarget {
  constructor() {
    super();
    this.worker = null;
    this.ready = null;
    this.pending = null;
    this.listeners = [];
    this.restarts = 0;
  }

  start() {
    this.terminate();
    this.ready = new Promise((resolve, reject) => {
      let w;
      try { w = new Worker(ENGINE_URL); } catch (e) { reject(e); return; }
      this.worker = w;
      const timer = setTimeout(() => reject(new Error('Moteur : délai de démarrage dépassé')), 20000);
      w.onmessage = (e) => this.onLine(String(e.data ?? ''));
      w.onerror = (e) => {
        this.dispatchEvent(new CustomEvent('error', { detail: e.message || 'erreur du moteur' }));
        if (this.pending) { const p = this.pending; this.pending = null; p.reject(new Error('crash')); }
      };
      this.waitFor((l) => l === 'uciok').then(() => {
        this.send('setoption name Threads value 1');
        this.send('setoption name Hash value 32');
        this.send('isready');
        return this.waitFor((l) => l === 'readyok');
      }).then(() => { clearTimeout(timer); resolve(); }, reject);
      this.send('uci');
    });
    return this.ready;
  }

  terminate() {
    if (this.worker) { try { this.worker.terminate(); } catch { /* déjà arrêté */ } }
    this.worker = null;
    this.listeners = [];
    if (this.pending) { const p = this.pending; this.pending = null; p.reject(new Error('arrêt')); }
  }

  send(cmd) { this.worker?.postMessage(cmd); }

  waitFor(pred) {
    return new Promise((resolve) => this.listeners.push({ pred, resolve }));
  }

  onLine(line) {
    for (const l of [...this.listeners]) {
      if (l.pred(line)) { this.listeners.splice(this.listeners.indexOf(l), 1); l.resolve(line); }
    }
    const p = this.pending;
    if (!p) return;
    if (line.startsWith('info') && line.includes(' score ')) {
      const cp = line.match(/score cp (-?\d+)/);
      const mate = line.match(/score mate (-?\d+)/);
      if (cp) p.score = { cp: Number(cp[1]) };
      else if (mate) p.score = { mate: Number(mate[1]) };
    } else if (line.startsWith('bestmove')) {
      const m = line.match(/bestmove (\S+)/);
      this.pending = null;
      clearTimeout(p.timer);
      if (!m || m[1] === '(none)') p.reject(new Error('aucun coup'));
      else p.resolve({ uci: m[1], score: p.score });
    }
  }

  // Calcule un coup ; redémarre automatiquement le moteur en cas de blocage.
  async go({ fen, skill = 20, depth = 30, movetime = 1000 }) {
    if (!this.worker) await this.start();
    await this.ready;
    if (this.pending) { this.stop(); await new Promise((r) => setTimeout(r, 30)); }
    this.send(`setoption name Skill Level value ${skill}`);
    this.send('ucinewgame');
    this.send('isready');
    await this.waitFor((l) => l === 'readyok');
    return new Promise((resolve, reject) => {
      const timer = setTimeout(async () => {
        this.pending = null;
        this.restarts++;
        this.dispatchEvent(new CustomEvent('restart'));
        try { await this.start(); } catch { /* signalé par l'interface */ }
        reject(new Error('timeout'));
      }, movetime + 10000);
      this.pending = { resolve, reject, timer, score: null };
      this.send(`position fen ${fen}`);
      this.send(`go depth ${depth} movetime ${movetime}`);
    });
  }

  stop() {
    if (this.pending) {
      const p = this.pending;
      this.pending = null;
      clearTimeout(p.timer);
      p.reject(new Error('annulé'));
    }
    this.send('stop');
  }
}
