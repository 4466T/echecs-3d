// Interface (DOM) : panneau, modales, promotion, fin de partie.
const $ = (id) => document.getElementById(id);
const GLYPH = { w: { k: '♔', q: '♕', r: '♖', b: '♗', n: '♘', p: '♙' }, b: { k: '♚', q: '♛', r: '♜', b: '♝', n: '♞', p: '♟' } };
const VALUE = { p: 1, n: 3, b: 3, r: 5, q: 9, k: 0 };
const ORDER = ['q', 'r', 'b', 'n', 'p'];

export class UI {
  constructor() {
    this.toastTimer = null;
    document.querySelectorAll('.modal [data-close]').forEach((b) => b.addEventListener('click', () => this.closeModal(b.closest('.modal').id)));
    document.querySelectorAll('.modal').forEach((m) => m.addEventListener('mousedown', (e) => { if (e.target === m && m.id !== 'modalPromo') this.closeModal(m.id); }));
  }

  ready() { $('loading').classList.add('done'); setTimeout(() => $('loading').remove(), 700); }
  fatal(msg) { $('fatalMsg').textContent = msg; $('fatal').hidden = false; $('loading')?.remove(); }

  setMatchLine(t) { $('matchline').textContent = t; }

  setStatus(kind, text) {
    const s = $('status');
    s.dataset.kind = kind;
    $('statusText').textContent = text;
  }

  setHourglassFlag(visible) {
    const f = $('hourglassFlag');
    f.dataset.hourglass = visible ? 'visible' : 'hidden';
    document.body.dataset.hourglass = visible ? 'visible' : 'hidden';
  }

  // players : { top:{name,color,toMove,clock,captured,adv}, bottom:{...} }
  setPlayers(top, bottom) {
    for (const [el, p] of [[$('playerTop'), top], [$('playerBottom'), bottom]]) {
      el.classList.toggle('to-move', !!p.toMove);
      el.querySelector('.p-dot').className = 'p-dot ' + p.color;
      el.querySelector('.p-name').textContent = p.name;
      const ck = el.querySelector('.p-clock');
      ck.hidden = p.clock == null;
      if (p.clock != null) { ck.textContent = fmtClock(p.clock); ck.classList.toggle('low', p.clock < 20000); }
      const cap = el.querySelector('.p-captured');
      const sorted = [...p.captured].sort((a, b) => ORDER.indexOf(a) - ORDER.indexOf(b));
      cap.innerHTML = sorted.map((t) => GLYPH[p.capturedColor][t]).join('') + (p.adv > 0 ? `<span class="adv">+${p.adv}</span>` : '');
    }
  }

  setEval(score, turnColorOfScore) {
    // score : {cp} ou {mate} du point de vue du camp qui calculait ; converti en perspective Blancs
    if (!score) return;
    const sgn = turnColorOfScore === 'w' ? 1 : -1;
    let txt, frac;
    if (score.mate != null) {
      const m = score.mate * sgn;
      txt = (m > 0 ? '+M' : '-M') + Math.abs(m);
      frac = m > 0 ? 1 : 0;
    } else {
      const cp = score.cp * sgn;
      txt = (cp >= 0 ? '+' : '') + (cp / 100).toFixed(1);
      frac = 0.5 + 0.5 * Math.tanh(cp / 600);
    }
    $('evalFill').style.width = (frac * 100).toFixed(1) + '%';
    $('evalText').textContent = txt;
  }
  resetEval() { $('evalFill').style.width = '50%'; $('evalText').textContent = '0.0'; }

  setMoves(history, currentPly, onPick) {
    const ol = $('moveList');
    ol.innerHTML = '';
    for (let i = 0; i < history.length; i += 2) {
      const n = document.createElement('li'); n.className = 'num'; n.textContent = (i / 2 + 1) + '.';
      ol.appendChild(n);
      for (const k of [i, i + 1]) {
        const li = document.createElement('li');
        if (k < history.length) {
          li.className = 'mv' + (k === currentPly - 1 ? ' current' : '');
          li.textContent = history[k];
          li.addEventListener('click', () => onPick(k + 1));
        }
        ol.appendChild(li);
      }
    }
    $('moveCount').textContent = history.length ? `${Math.ceil(history.length / 2)} coup${history.length > 2 ? 's' : ''}` : '';
    const cur = ol.querySelector('.current');
    if (cur) cur.scrollIntoView({ block: 'nearest' });
    else ol.scrollTop = ol.scrollHeight;
  }

  setReview(on) { $('reviewBar').hidden = !on; }

  openModal(id) { $(id).hidden = false; }
  closeModal(id) { $(id).hidden = true; if (id === 'modalPromo' && this.promoResolve) { const r = this.promoResolve; this.promoResolve = null; r(null); } }

  promotion(color) {
    const row = $('promoRow');
    row.innerHTML = '';
    const names = { q: 'Dame', r: 'Tour', b: 'Fou', n: 'Cavalier' };
    return new Promise((resolve) => {
      this.promoResolve = resolve;
      for (const t of ['q', 'r', 'b', 'n']) {
        const b = document.createElement('button');
        b.innerHTML = `${GLYPH[color][t]}<span>${names[t]}</span>`;
        b.addEventListener('click', () => { this.promoResolve = null; $('modalPromo').hidden = true; resolve(t); });
        row.appendChild(b);
      }
      this.openModal('modalPromo');
    });
  }

  gameOver({ title, detail, icon }) {
    $('goTitle').textContent = title;
    $('goDetail').textContent = detail;
    $('goIcon').textContent = icon;
    $('gameOver').hidden = false;
  }
  hideGameOver() { $('gameOver').hidden = true; }

  toast(msg, ms = 2600) {
    const t = $('toast');
    t.textContent = msg; t.hidden = false;
    clearTimeout(this.toastTimer);
    this.toastTimer = setTimeout(() => { t.hidden = true; }, ms);
  }

  setActiveView(name) { document.querySelectorAll('.chip[data-view]').forEach((c) => c.classList.toggle('active', c.dataset.view === name)); }
  setSegment(id, v) { document.querySelectorAll(`#${id} button`).forEach((b) => b.classList.toggle('active', b.dataset.v === v)); }
  getSegment(id) { return document.querySelector(`#${id} button.active`)?.dataset.v; }
  bindSegment(id, onChange) {
    document.querySelectorAll(`#${id} button`).forEach((b) => b.addEventListener('click', () => { this.setSegment(id, b.dataset.v); onChange?.(b.dataset.v); }));
  }
  serverDown(on) { $('serverDown').hidden = !on; }
  setSaveInfo(t) { $('saveInfo').textContent = t; }
}

export function fmtClock(ms) {
  const s = Math.max(0, Math.ceil(ms / 1000));
  const m = Math.floor(s / 60);
  return `${m}:${String(s % 60).padStart(2, '0')}`;
}
export function materialSummary(chess) {
  // Pièces capturées par chaque camp, déduites du matériel restant
  const start = { p: 8, n: 2, b: 2, r: 2, q: 1 };
  const count = { w: { p: 0, n: 0, b: 0, r: 0, q: 0 }, b: { p: 0, n: 0, b: 0, r: 0, q: 0 } };
  for (const row of chess.board()) for (const c of row) if (c && c.type !== 'k') count[c.color][c.type]++;
  const lost = { w: [], b: [] };
  let mat = { w: 0, b: 0 };
  for (const col of ['w', 'b']) for (const t of Object.keys(start)) {
    const missing = Math.max(0, start[t] - count[col][t]);
    for (let i = 0; i < missing; i++) lost[col].push(t);
    mat[col] += count[col][t] * VALUE[t];
  }
  return { lost, mat };
}
