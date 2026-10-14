// Orchestration : état de partie (chess.js), rendu, interactions, ordinateur, persistance.
import * as THREE from 'three';
import { Chess } from 'chess.js';
import { Stage, detectQuality, QUALITY } from './scene.js';
import { Board, sqToPos } from './board.js';
import { createPieceMesh, pieceGeometries } from './pieces.js';
import { Signals } from './signals.js';
import { Hourglass } from './hourglass.js';
import { CameraRig } from './camera.js';
import { Engine, LEVELS } from './engine.js';
import { Sound } from './audio.js';
import { UI, materialSummary } from './ui.js';
import { THEMES } from './themes.js';
import * as store from './store.js';

const ui = new UI();
const COLOR_FR = { w: 'Blancs', b: 'Noirs' };
const DEFAULTS = { level: 4, color: 'w', clock: 'none', theme: 'bois', quality: 'auto', volume: 0.7, muted: false, reduceMotion: false, hourglassMine: false };
const CLOCKS = { none: null, '10+0': [600000, 0], '15+10': [900000, 10000], '30+0': [1800000, 0] };

const app = {
  chess: new Chess(),
  settings: { ...DEFAULTS },
  player: 'w',
  viewSide: 1,
  pieces: new Map(),      // case -> mesh
  trays: { w: [], b: [] }, // pièces capturées posées sur la table, par couleur
  selected: null,
  lifted: null,
  thinking: false,
  gen: 0,
  busy: false,
  over: null,
  clocks: null,
  review: null,
  hintBusy: false,
  lastScore: null,
};

let stage, board, signals, hourglass, rig, engine, sound;
const tweens = new Set();
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const ease = (k) => (k < 0.5 ? 4 * k * k * k : 1 - Math.pow(-2 * k + 2, 3) / 2);
const other = (c) => (c === 'w' ? 'b' : 'w');
const computer = () => other(app.player);

function tween(dur, fn, easing = ease) {
  if (app.settings.reduceMotion) dur = Math.min(dur, 0.08);
  return new Promise((resolve) => tweens.add({ t: 0, dur: Math.max(0.001, dur), fn, easing, resolve }));
}
function updateTweens(dt) {
  for (const tw of [...tweens]) {
    tw.t += dt;
    const k = Math.min(1, tw.t / tw.dur);
    tw.fn(tw.easing(k));
    if (k >= 1) { tweens.delete(tw); tw.resolve(); }
  }
}

// ---------- Pièces ----------
function theme() { return THEMES[app.settings.theme] || THEMES.bois; }

function clearPieces() {
  for (const m of app.pieces.values()) stage.scene.remove(m);
  for (const c of ['w', 'b']) for (const m of app.trays[c]) stage.scene.remove(m);
  app.pieces.clear();
  app.trays = { w: [], b: [] };
  app.lifted = null;
}

function trayPos(color, index) {
  const s = app.viewSide;
  const col = color === 'w' ? 0 : 1;
  const row = index % 16;
  return new THREE.Vector3(-s * (5.75 + col * 0.72), -0.34, s * (-3.6 + row * 0.48));
}

function rebuildPieces(chess = app.chess) {
  clearPieces();
  for (const row of chess.board()) for (const c of row) {
    if (!c) continue;
    const m = createPieceMesh(c.type, c.color, theme());
    const p = sqToPos(c.square);
    m.position.set(p.x, 0, p.z);
    m.userData.square = c.square;
    stage.scene.add(m);
    app.pieces.set(c.square, m);
  }
  const { lost } = materialSummary(chess);
  for (const color of ['w', 'b']) for (const t of lost[color]) {
    const m = createPieceMesh(t, color, theme());
    m.scale.setScalar(0.62);
    m.position.copy(trayPos(color, app.trays[color].length));
    m.userData.square = null;
    stage.scene.add(m);
    app.trays[color].push(m);
  }
}

function placeTrays() {
  for (const color of ['w', 'b']) app.trays[color].forEach((m, i) => m.position.copy(trayPos(color, i)));
}

function placeHourglass(forColor) {
  const zSide = forColor === 'w' ? 1 : -1;
  hourglass.place(5.95 * app.viewSide, 2.3 * zSide);
}

function arcMove(mesh, toSq, dur, height) {
  const from = mesh.position.clone();
  const to = sqToPos(toSq);
  const d = Math.hypot(to.x - from.x, to.z - from.z);
  const h = height ?? 0.3 + 0.1 * d;
  return tween(dur, (k) => {
    mesh.position.x = from.x + (to.x - from.x) * k;
    mesh.position.z = from.z + (to.z - from.z) * k;
    mesh.position.y = from.y * (1 - k) + 4 * h * k * (1 - k);
  });
}

function flyToTray(mesh, color) {
  const target = trayPos(color, app.trays[color].length);
  app.trays[color].push(mesh);
  mesh.userData.square = null;
  mesh.material.emissive.setRGB(0, 0, 0);
  const from = mesh.position.clone();
  const s0 = mesh.scale.x;
  return tween(0.5, (k) => {
    mesh.position.lerpVectors(from, target, k);
    mesh.position.y = from.y + (target.y - from.y) * k + 1.4 * k * (1 - k);
    mesh.scale.setScalar(s0 + (0.62 - s0) * k);
  });
}

function shake(mesh) {
  if (!mesh) return Promise.resolve();
  const x0 = mesh.position.x;
  sound.play('illegal');
  return tween(0.32, (k) => { mesh.position.x = x0 + Math.sin(k * Math.PI * 6) * 0.06 * (1 - k); }, (k) => k);
}

function liftTo(mesh, y, dur = 0.16) {
  if (!mesh) return Promise.resolve();
  const y0 = mesh.position.y;
  return tween(dur, (k) => { mesh.position.y = y0 + (y - y0) * k; });
}

// ---------- Sélection ----------
function select(sq) {
  if (app.lifted && app.lifted !== app.pieces.get(sq)) { liftTo(app.lifted, 0); app.lifted.material.emissive.setRGB(0, 0, 0); app.lifted = null; }
  app.selected = sq;
  if (!sq) { signals.select(null); return; }
  const mesh = app.pieces.get(sq);
  const legal = app.chess.moves({ square: sq, verbose: true });
  signals.select(sq, mesh, legal);
  if (mesh) { app.lifted = mesh; liftTo(mesh, 0.14); mesh.material.emissive.setRGB(0.16, 0.11, 0.03); }
}

function canInteract() {
  return !app.over && !app.thinking && !app.busy && app.review == null && app.chess.turn() === app.player;
}

// ---------- Coups ----------
async function performMove(mv, { dragged = false } = {}) {
  app.busy = true;
  signals.select(null);
  signals.clearHint();
  signals.clearCheck();
  signals.clearEnd();
  app.selected = null;
  const mesh = app.pieces.get(mv.from);
  if (mesh) mesh.material.emissive.setRGB(0, 0, 0);
  app.lifted = null;

  let capSq = null;
  if (mv.flags.includes('e')) capSq = mv.to[0] + mv.from[1];
  else if (mv.captured) capSq = mv.to;
  const capMesh = capSq ? app.pieces.get(capSq) : null;
  if (capSq) app.pieces.delete(capSq);
  app.pieces.delete(mv.from);
  if (mesh) { app.pieces.set(mv.to, mesh); mesh.userData.square = mv.to; }

  let rook = null, rookTo = null;
  if (mv.flags.includes('k') || mv.flags.includes('q')) {
    const r = mv.from[1];
    const rf = (mv.flags.includes('k') ? 'h' : 'a') + r;
    rookTo = (mv.flags.includes('k') ? 'f' : 'd') + r;
    rook = app.pieces.get(rf);
    app.pieces.delete(rf);
    if (rook) { app.pieces.set(rookTo, rook); rook.userData.square = rookTo; }
  }

  signals.follow(mesh);
  const anims = [];
  if (mesh) anims.push(arcMove(mesh, mv.to, dragged ? 0.18 : 0.42, dragged ? 0.05 : undefined));
  if (rook) anims.push(sleep(120).then(() => arcMove(rook, rookTo, 0.4, 0.45)));
  if (capMesh) anims.push(sleep(dragged ? 60 : 220).then(() => flyToTray(capMesh, capMesh.userData.color)));
  sound.play(mv.captured ? 'capture' : rook ? 'castle' : 'move');
  await Promise.all(anims);

  if (mv.promotion && mesh) {
    stage.scene.remove(mesh);
    const nm = createPieceMesh(mv.promotion, mv.color, theme());
    const p = sqToPos(mv.to);
    nm.position.set(p.x, 0, p.z);
    nm.userData.square = mv.to;
    nm.scale.setScalar(0.01);
    stage.scene.add(nm);
    app.pieces.set(mv.to, nm);
    await tween(0.28, (k) => nm.scale.setScalar(0.01 + 0.99 * k));
  }
  signals.follow(null);
  signals.setLastMove(mv.from, mv.to);
  verifySync();
  app.busy = false;
}

// Contrôle d'intégrité : la scène doit refléter exactement chess.js
function verifySync() {
  let ok = app.pieces.size === app.chess.board().flat().filter(Boolean).length;
  if (ok) for (const [sq, m] of app.pieces) {
    const c = app.chess.get(sq);
    if (!c || c.type !== m.userData.type || c.color !== m.userData.color) { ok = false; break; }
  }
  if (!ok) { console.warn('[Echecs3D] resynchronisation de la scène'); rebuildPieces(); }
}

function afterMove(mv) {
  const ch = app.chess;
  if (app.clocks && mv) app.clocks[mv.color] += app.clocks.inc;
  if (ch.inCheck()) sound.play('check');
  updateCheckSignal();
  const over = detectOver();
  if (over) finishGame(over);
  refreshUI();
  persist();
  if (!app.over && ch.turn() === computer()) aiMove();
  else if (!app.over) playerTurnStarted();
}

function updateCheckSignal() {
  const ch = app.chess;
  signals.clearCheck();
  if (!ch.inCheck()) return;
  const turn = ch.turn();
  const kingSq = ch.findPiece({ type: 'k', color: turn })[0];
  const attackers = ch.attackers(kingSq, other(turn)).map((s) => app.pieces.get(s)).filter(Boolean);
  signals.setCheck(app.pieces.get(kingSq), kingSq, attackers, ch.isCheckmate());
}

function detectOver() {
  const ch = app.chess;
  const n = Math.ceil(ch.history().length / 2);
  if (ch.isCheckmate()) return { type: 'mate', winner: other(ch.turn()), detail: n ? `Échec et mat en ${n} coup${n > 1 ? 's' : ''}` : 'Échec et mat' };
  if (ch.isStalemate()) return { type: 'draw', detail: 'Pat : le camp au trait n’a aucun coup légal' };
  if (ch.isInsufficientMaterial()) return { type: 'draw', detail: 'Nulle : matériel insuffisant pour mater' };
  if (ch.isThreefoldRepetition()) return { type: 'draw', detail: 'Nulle par triple répétition de la position' };
  if (ch.isDrawByFiftyMoves()) return { type: 'draw', detail: 'Nulle par la règle des 50 coups' };
  return null;
}

async function finishGame(over, { silent = false } = {}) {
  app.over = over;
  cancelThinking();
  select(null);
  const ch = app.chess;
  let title, icon, snd;
  if (over.type === 'draw') { title = 'Partie nulle'; icon = '½'; snd = 'draw'; }
  else { const won = over.winner === app.player; title = won ? 'Victoire' : 'Défaite'; icon = won ? '♔' : '♚'; snd = won ? 'win' : 'lose'; }
  if (over.type === 'draw') {
    const ks = ['w', 'b'].map((c) => ch.findPiece({ type: 'k', color: c })[0]).filter(Boolean);
    signals.setDraw(ks);
  }
  if (over.type === 'mate' && !silent) {
    const kingSq = ch.findPiece({ type: 'k', color: ch.turn() })[0];
    const king = app.pieces.get(kingSq);
    if (king) {
      const dir = king.userData.color === 'w' ? -1 : 1;
      const p0 = king.position.clone();
      tween(1.3, (k) => {
        king.rotation.x = dir * 1.42 * k;
        king.position.y = p0.y + 0.32 * k;
      }, (k) => (k < 1 ? 1 - Math.pow(1 - k, 3) : 1));
    }
  }
  if (!silent) sound.play(snd);
  ui.gameOver({ title, detail: over.detail, icon });
  refreshUI();
  persist();
}

// ---------- Ordinateur ----------
function cancelThinking() {
  app.gen++;
  if (app.thinking) engine.stop();
  app.thinking = false;
  hourglass.hide();
  ui.setHourglassFlag(false);
}

async function aiMove(retry = 0) {
  if (app.over || app.thinking || app.review != null) return;
  const my = ++app.gen;
  app.thinking = true;
  const L = LEVELS[app.settings.level - 1];
  const [d0, d1] = L.humanDelay;
  const delay = d0 + Math.random() * (d1 - d0);
  const expected = L.movetime + delay + 150;
  placeHourglass(computer());
  hourglass.show(expected);
  ui.setHourglassFlag(true);
  refreshUI();
  const t0 = performance.now();
  let res;
  try {
    res = await engine.go({ fen: app.chess.fen(), skill: L.skill, depth: L.depth, movetime: L.movetime });
  } catch (e) {
    if (my !== app.gen) return;
    app.thinking = false;
    hourglass.hide();
    ui.setHourglassFlag(false);
    if (retry < 2) { ui.toast('Moteur relancé — nouvel essai…'); setTimeout(() => aiMove(retry + 1), 400); }
    else { ui.toast('Le moteur ne répond pas. Utilisez « Annuler » ou relancez le jeu.', 6000); refreshUI(); }
    return;
  }
  if (my !== app.gen) return;
  const minShow = Math.max(600, delay);
  const el = performance.now() - t0;
  if (el < minShow) await sleep(minShow - el);
  if (my !== app.gen) return;
  await hourglass.finish(250);
  if (my !== app.gen) return;
  app.lastScore = { score: res.score, turn: app.chess.turn() };
  ui.setEval(res.score, app.chess.turn());
  let mv;
  try { mv = app.chess.move({ from: res.uci.slice(0, 2), to: res.uci.slice(2, 4), promotion: res.uci[4] }); }
  catch { app.thinking = false; hourglass.hide(); ui.setHourglassFlag(false); return; }
  app.thinking = false;
  hourglass.hide();
  ui.setHourglassFlag(false);
  await performMove(mv);
  afterMove(mv);
}

function playerTurnStarted() {
  if (!app.settings.hourglassMine) return;
  placeHourglass(app.player);
  const remaining = app.clocks ? app.clocks[app.player] : 45000;
  hourglass.show(Math.min(remaining, 120000));
}

// ---------- Actions joueur ----------
async function tryMove(from, to, { dragged = false } = {}) {
  const ch = app.chess;
  const candidates = ch.moves({ square: from, verbose: true }).filter((m) => m.to === to);
  const mesh = app.pieces.get(from);
  if (!candidates.length) {
    if (dragged) await arcMove(mesh, from, 0.18, 0.05);
    await shake(mesh);
    return false;
  }
  let promotion;
  if (candidates.some((m) => m.promotion)) {
    promotion = await ui.promotion(app.player);
    if (!promotion) { if (dragged) await arcMove(mesh, from, 0.18, 0.05); return false; }
  }
  if (hourglass.visible && app.settings.hourglassMine) hourglass.hide();
  const mv = ch.move({ from, to, promotion });
  await performMove(mv, { dragged });
  afterMove(mv);
  return true;
}

function newGame() {
  cancelThinking();
  ui.hideGameOver();
  exitReview(false);
  const s = app.settings;
  app.chess.reset();
  app.over = null;
  app.player = s.color === 'r' ? (Math.random() < 0.5 ? 'w' : 'b') : s.color;
  app.viewSide = app.player === 'w' ? 1 : -1;
  const ck = CLOCKS[s.clock];
  app.clocks = ck ? { w: ck[0], b: ck[0], inc: ck[1] } : null;
  board.build(theme(), app.viewSide === -1);
  rig.setSide(app.viewSide, true);
  ui.setActiveView(rig.preset);
  signals.clearAll();
  rebuildPieces();
  ui.resetEval();
  app.lastScore = null;
  sound.play('start');
  refreshUI();
  persist();
  if (app.player === 'b') setTimeout(() => aiMove(), 700);
  else playerTurnStarted();
}

function undo() {
  if (app.review != null) exitReview();
  if (app.busy) return;
  const ch = app.chess;
  if (!ch.history().length) return;
  cancelThinking();
  ch.undo();
  while (ch.history().length && ch.turn() !== app.player) ch.undo();
  app.over = null;
  ui.hideGameOver();
  signals.clearAll();
  rebuildPieces();
  const h = ch.history({ verbose: true });
  if (h.length) signals.setLastMove(h[h.length - 1].from, h[h.length - 1].to);
  updateCheckSignal();
  refreshUI();
  persist();
  if (ch.turn() === computer()) aiMove();
}

async function hint() {
  if (!canInteract() || app.hintBusy) return;
  app.hintBusy = true;
  ui.toast('Recherche du meilleur coup…', 1500);
  try {
    const res = await engine.go({ fen: app.chess.fen(), skill: 20, depth: 18, movetime: 900 });
    if (canInteract()) signals.showHint(res.uci.slice(0, 2), res.uci.slice(2, 4));
  } catch { ui.toast('Indice indisponible pour le moment.'); }
  app.hintBusy = false;
}

async function offerDraw() {
  if (!canInteract()) return;
  if (app.chess.history().length < 20) { ui.toast('L’ordinateur décline : la partie vient de commencer.'); return; }
  try {
    const res = await engine.go({ fen: app.chess.fen(), skill: 20, depth: 14, movetime: 600 });
    const sc = res.score || { cp: 0 };
    // Score du point de vue du joueur (camp au trait) : l'ordinateur accepte s'il n'est pas mieux.
    const engineAdv = sc.mate != null ? -Math.sign(sc.mate) * 10000 : -sc.cp;
    if (engineAdv <= 25) finishGame({ type: 'draw', detail: 'Nulle par accord mutuel' });
    else ui.toast('L’ordinateur décline la nulle.');
  } catch { ui.toast('Proposition impossible pour le moment.'); }
}

let resignArmed = null;
function resign() {
  if (app.over) return;
  const btn = document.getElementById('btnResign');
  if (!resignArmed) {
    btn.textContent = 'Confirmer l’abandon';
    resignArmed = setTimeout(() => { btn.textContent = 'Abandonner'; resignArmed = null; }, 3000);
    return;
  }
  clearTimeout(resignArmed); resignArmed = null; btn.textContent = 'Abandonner';
  finishGame({ type: 'resign', winner: computer(), detail: 'Vous avez abandonné' });
}

function flip() {
  app.viewSide *= -1;
  board.build(theme(), app.viewSide === -1);
  rig.setSide(app.viewSide);
  ui.setActiveView(rig.preset);
  placeTrays();
  if (hourglass.visible) placeHourglass(app.thinking ? computer() : app.player);
  refreshUI();
}

// Import PGN / FEN ; renvoie un message d'erreur ou null
function importPosition(txt) {
  const isFen = /^([rnbqkpRNBQKP1-8]+\/){7}[rnbqkpRNBQKP1-8]+\s[wb]/.test(txt);
  const test = new Chess();
  try { if (isFen) test.load(txt); else test.loadPgn(txt); } catch (ex) { return ex.message || 'format invalide'; }
  cancelThinking();
  exitReview(false);
  ui.hideGameOver();
  if (isFen) app.chess.load(txt); else app.chess.loadPgn(txt);
  app.over = null;
  signals.clearAll();
  rebuildPieces();
  const h = app.chess.history({ verbose: true });
  if (h.length) signals.setLastMove(h[h.length - 1].from, h[h.length - 1].to);
  updateCheckSignal();
  const over = detectOver();
  if (over) finishGame(over, { silent: true });
  refreshUI();
  persist();
  if (!app.over && app.chess.turn() === computer()) aiMove();
  return null;
}

// ---------- Revue ----------
function enterReview(ply) {
  const hist = app.chess.history({ verbose: true });
  if (ply >= hist.length) { exitReview(); return; }
  cancelThinking();
  app.review = ply;
  select(null);
  const temp = new Chess(ply === 0 ? undefined : hist[ply - 1].after);
  rebuildPieces(temp);
  signals.clearCheck();
  signals.clearEnd();
  if (ply > 0) signals.setLastMove(hist[ply - 1].from, hist[ply - 1].to); else signals.setLastMove(null);
  ui.setReview(true);
  refreshUI();
}
function exitReview(resume = true) {
  if (app.review == null) return;
  app.review = null;
  ui.setReview(false);
  rebuildPieces();
  const h = app.chess.history({ verbose: true });
  signals.setLastMove(h.length ? h[h.length - 1].from : null, h.length ? h[h.length - 1].to : null);
  updateCheckSignal();
  if (app.over?.type === 'draw') finishGame(app.over, { silent: true });
  refreshUI();
  if (resume && !app.over && app.chess.turn() === computer()) aiMove();
}

// ---------- Interface ----------
function refreshUI() {
  const ch = app.chess;
  const L = LEVELS[app.settings.level - 1];
  const clockTxt = app.clocks ? ` · ${app.settings.clock.replace('+', ' + ')}${app.settings.clock.includes('+0') ? ' min' : ''}` : '';
  ui.setMatchLine(`Vous (${COLOR_FR[app.player]}) contre l’ordinateur · ${L.name}${clockTxt}`);

  let kind = 'turn', text;
  if (app.review != null) { kind = 'turn'; text = `Revue · position après ${app.review} demi-coup${app.review > 1 ? 's' : ''}`; }
  else if (app.over) {
    if (app.over.type === 'mate') { kind = 'mate'; text = app.over.winner === app.player ? 'Échec et mat — vous gagnez' : 'Échec et mat — l’ordinateur gagne'; }
    else if (app.over.type === 'draw') { kind = 'draw'; text = app.over.detail; }
    else if (app.over.type === 'timeout') { kind = app.over.winner === app.player ? 'win' : 'mate'; text = app.over.detail; }
    else { kind = 'mate'; text = app.over.detail; }
  } else if (app.thinking) {
    kind = ch.inCheck() ? 'check' : 'thinking';
    text = ch.inCheck() ? 'Échec ! L’ordinateur réfléchit…' : 'L’ordinateur réfléchit…';
  } else if (ch.inCheck()) { kind = 'check'; text = 'Échec ! À vous de jouer'; }
  else text = 'À vous de jouer';
  ui.setStatus(kind, text);

  const { lost, mat } = materialSummary(ch);
  const mk = (color) => ({
    name: color === app.player ? 'Vous' : `Ordinateur · ${L.name}`,
    color,
    toMove: !app.over && app.review == null && ch.turn() === color,
    clock: app.clocks ? app.clocks[color] : null,
    captured: lost[other(color)],
    capturedColor: other(color),
    adv: mat[color] - mat[other(color)],
  });
  const bottom = app.viewSide === 1 ? 'w' : 'b';
  ui.setPlayers(mk(other(bottom)), mk(bottom));
  const hist = ch.history();
  ui.setMoves(hist, app.review ?? hist.length, (ply) => enterReview(ply));
  document.getElementById('btnUndo').disabled = !hist.length;
  document.getElementById('btnHint').disabled = !canInteract();
  document.getElementById('btnDraw').disabled = !canInteract();
  document.getElementById('btnResign').disabled = !!app.over;
}

function persist() {
  store.saveState({
    version: 1,
    pgn: app.chess.pgn(),
    fen: app.chess.fen(),
    player: app.player,
    viewSide: app.viewSide,
    clocks: app.clocks,
    over: app.over,
    settings: app.settings,
  });
}

function tickClocks(dtMs) {
  if (!app.clocks || app.over || app.review != null || !app.chess.history().length) return;
  const c = app.chess.turn();
  app.clocks[c] -= dtMs;
  if (app.clocks[c] <= 0) {
    app.clocks[c] = 0;
    const winner = other(c);
    finishGame({ type: 'timeout', winner, detail: winner === app.player ? 'Victoire au temps' : 'Défaite au temps' });
    return;
  }
  clockAcc += dtMs;
  if (clockAcc > 250) { clockAcc = 0; refreshUI(); }
}
let clockAcc = 0;

// ---------- Entrées ----------
// Tolérance d'un « tap » : un doigt bouge davantage qu'une souris
const tapSlop = (e) => (e.pointerType === 'touch' ? 14 : 6);
function bindInput(canvas) {
  const ray = new THREE.Raycaster();
  const ndc = new THREE.Vector2();
  const setRay = (e) => {
    const r = canvas.getBoundingClientRect();
    ndc.set(((e.clientX - r.left) / r.width) * 2 - 1, -((e.clientY - r.top) / r.height) * 2 + 1);
    ray.setFromCamera(ndc, stage.camera);
  };
  const pickSquare = (e, piecesFirst = true) => {
    setRay(e);
    if (piecesFirst) {
      const hits = ray.intersectObjects([...app.pieces.values()], false);
      if (hits.length && hits[0].object.userData.square) return hits[0].object.userData.square;
    }
    return board.pick(ray)?.square ?? null;
  };
  let down = null, drag = null;

  canvas.addEventListener('pointerdown', (e) => {
    if (e.button !== 0) return;
    sound.ensure();
    down = { x: e.clientX, y: e.clientY };
    if (!canInteract()) return;
    const sq = pickSquare(e);
    const pc = sq ? app.chess.get(sq) : null;
    if (pc && pc.color === app.player) {
      if (app.selected !== sq) select(sq);
      drag = { from: sq, mesh: app.pieces.get(sq), moved: false, id: e.pointerId };
      rig.controls.enabled = false;
      canvas.setPointerCapture(e.pointerId);
    }
  });

  canvas.addEventListener('pointermove', (e) => {
    if (!drag) return;
    if (!drag.moved && Math.hypot(e.clientX - down.x, e.clientY - down.y) < tapSlop(e)) return;
    drag.moved = true;
    setRay(e);
    const hit = board.pick(ray, 0.35);
    if (hit && drag.mesh) {
      drag.mesh.position.set(THREE.MathUtils.clamp(hit.point.x, -4.6, 4.6), 0.35, THREE.MathUtils.clamp(hit.point.z, -4.6, 4.6));
      signals.follow(drag.mesh);
    }
  });

  canvas.addEventListener('pointerup', async (e) => {
    if (e.button !== 0) return;
    const moved = down ? Math.hypot(e.clientX - down.x, e.clientY - down.y) : 99;
    if (drag) {
      const d = drag; drag = null;
      rig.controls.enabled = true;
      try { canvas.releasePointerCapture(d.id); } catch { /* déjà relâché */ }
      if (d.moved) {
        setRay(e);
        const target = board.pick(ray)?.square;
        if (target && target !== d.from) { await tryMove(d.from, target, { dragged: true }); }
        else { await arcMove(d.mesh, d.from, 0.16, 0.05); await liftTo(d.mesh, 0.14, 0.08); signals.follow(d.mesh); }
      }
      return;
    }
    if (moved > tapSlop(e) || !canInteract()) return;
    const sq = pickSquare(e);
    if (!app.selected) return;
    if (!sq) { select(null); return; }
    const pc = app.chess.get(sq);
    if (pc && pc.color === app.player) { select(sq); return; }
    const from = app.selected;
    const ok = await tryMove(from, sq);
    if (!ok && app.selected === from) select(null);
  });

  window.addEventListener('keydown', (e) => {
    if (e.target.closest?.('input, textarea')) return;
    const mod = e.metaKey || e.ctrlKey;
    if (mod && e.key.toLowerCase() === 'z') { e.preventDefault(); undo(); return; }
    if (mod) return;
    const k = e.key.toLowerCase();
    if (k === 'escape') { select(null); document.querySelectorAll('.modal:not([hidden])').forEach((m) => ui.closeModal(m.id)); }
    else if (k === 'n') openNewGame();
    else if (k === 'f') flip();
    else if (k === 'h') hint();
    else if (['1', '2', '3', '4'].includes(k)) { const v = ['joueur', 'dessus', 'cote', 'cine'][Number(k) - 1]; rig.go(v); ui.setActiveView(v); }
  });
}

// ---------- Modales ----------
function openNewGame() {
  const s = app.settings;
  ui.setSegment('segColor', s.color);
  ui.setSegment('segClock', s.clock);
  const r = document.getElementById('levelRange');
  r.value = s.level;
  document.getElementById('levelName').textContent = LEVELS[s.level - 1].name;
  ui.openModal('modalNew');
}

function applySettings(first = false) {
  const s = app.settings;
  sound.volume = s.volume; sound.muted = s.muted;
  signals.reduceMotion = hourglass.reduceMotion = rig.reduceMotion = s.reduceMotion;
  const q = s.quality === 'auto' ? detectQuality(stage.renderer) : s.quality;
  if (first || stage.quality !== q) { stage.setQuality(q); hourglass.setQualityLow(q === 'bas'); }
}

function bindPanel() {
  const on = (id, fn) => document.getElementById(id).addEventListener('click', fn);
  on('btnNew', openNewGame);
  on('btnStart', () => {
    const s = app.settings;
    s.color = ui.getSegment('segColor') || 'w';
    s.clock = ui.getSegment('segClock') || 'none';
    s.level = Number(document.getElementById('levelRange').value);
    ui.closeModal('modalNew');
    newGame();
  });
  ui.bindSegment('segColor');
  ui.bindSegment('segClock');
  document.getElementById('levelRange').addEventListener('input', (e) => { document.getElementById('levelName').textContent = LEVELS[Number(e.target.value) - 1].name; });
  on('btnUndo', undo);
  on('btnHint', hint);
  on('btnFlip', flip);
  on('btnDraw', offerDraw);
  on('btnResign', resign);
  on('btnReplay', () => { ui.hideGameOver(); newGame(); });
  on('btnAnalyse', () => { ui.hideGameOver(); if (app.chess.history().length) enterReview(Math.max(0, app.chess.history().length - 1)); });
  on('btnLive', () => exitReview());
  on('btnQuit', async () => {
    await store.shutdownServer();
    ui.toast('Jeu arrêté. Vous pouvez fermer cette fenêtre.', 60000);
    setTimeout(() => window.close(), 600);
  });
  on('btnPgn', () => {
    document.getElementById('fenOut').value = app.chess.fen();
    document.getElementById('pgnOut').value = app.chess.pgn();
    document.getElementById('importIn').value = '';
    document.getElementById('importErr').hidden = true;
    ui.openModal('modalPgn');
  });
  const copy = async (txt) => { try { await navigator.clipboard.writeText(txt); ui.toast('Copié dans le presse-papiers'); } catch { ui.toast('Copie impossible : sélectionnez le texte manuellement'); } };
  on('btnCopyFen', () => copy(app.chess.fen()));
  on('btnCopyPgn', () => copy(app.chess.pgn()));
  on('btnImport', () => {
    const txt = document.getElementById('importIn').value.trim();
    const err = document.getElementById('importErr');
    if (!txt) return;
    const e = importPosition(txt);
    if (e) { err.textContent = 'Import refusé : ' + e; err.hidden = false; return; }
    ui.closeModal('modalPgn');
  });
  on('btnSettings', () => {
    const s = app.settings;
    ui.setSegment('segTheme', s.theme);
    ui.setSegment('segQuality', s.quality);
    document.getElementById('volRange').value = s.volume;
    document.getElementById('chkMute').checked = s.muted;
    document.getElementById('chkMotion').checked = s.reduceMotion;
    document.getElementById('chkHgMine').checked = s.hourglassMine;
    ui.openModal('modalSettings');
  });
  ui.bindSegment('segTheme', (v) => {
    app.settings.theme = v;
    board.build(theme(), app.viewSide === -1);
    if (app.review != null) enterReview(app.review); else rebuildPieces();
    updateCheckSignal();
    persist();
  });
  ui.bindSegment('segQuality', (v) => { app.settings.quality = v; applySettings(); persist(); });
  document.getElementById('volRange').addEventListener('input', (e) => { app.settings.volume = Number(e.target.value); applySettings(); persist(); });
  document.getElementById('volRange').addEventListener('change', () => sound.play('move'));
  document.getElementById('chkMute').addEventListener('change', (e) => { app.settings.muted = e.target.checked; applySettings(); persist(); });
  document.getElementById('chkMotion').addEventListener('change', (e) => { app.settings.reduceMotion = e.target.checked; applySettings(); persist(); });
  document.getElementById('chkHgMine').addEventListener('change', (e) => {
    app.settings.hourglassMine = e.target.checked;
    if (!e.target.checked && !app.thinking) hourglass.hide();
    persist();
  });
  document.querySelectorAll('.chip[data-view]').forEach((c) => c.addEventListener('click', () => { rig.go(c.dataset.view); ui.setActiveView(c.dataset.view); }));
}

const BOTTOM_PANEL = '(orientation: portrait), (max-width: 820px)';
// Place occupée par le panneau : à droite (paysage) ou en bas (portrait / écran étroit)
function panelOffset() {
  const r = document.getElementById('panel').getBoundingClientRect();
  if (matchMedia(BOTTOM_PANEL).matches) {
    return { x: 0, y: Math.max(0, window.innerHeight - r.top + 8) };
  }
  return { x: r.width + 32, y: 0 };
}
function layout() {
  const o = panelOffset();
  stage.setViewOffset(o.x, o.y);
  rig.setArea(stage.freeArea());
}

// ---------- Hors ligne (version web) ----------
function registerOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) return;
  navigator.serviceWorker.register('sw.js').then((reg) => {
    reg.addEventListener('updatefound', () => {
      const nw = reg.installing;
      nw?.addEventListener('statechange', () => {
        if (nw.state === 'installed' && navigator.serviceWorker.controller) ui.toast('Mise à jour installée : elle sera active au prochain lancement.', 4000);
        if (nw.state === 'activated' && !navigator.serviceWorker.controller) ui.toast('Jeu disponible hors ligne sur cet appareil.', 3500);
      });
    });
  }).catch(() => { /* hors ligne indisponible : le jeu fonctionne en ligne */ });
}

// ---------- Démarrage ----------
async function init() {
  const canvas = document.getElementById('scene');
  try {
    stage = new Stage(canvas);
  } catch (e) {
    ui.fatal('Ce navigateur ou cet ordinateur ne permet pas l’affichage WebGL. Ouvrez le jeu avec Safari ou Google Chrome à jour.');
    return;
  }
  if (window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) DEFAULTS.reduceMotion = true;

  const { state, info } = await store.loadState();
  if (state?.settings) app.settings = { ...DEFAULTS, ...state.settings };
  sound = new Sound();
  board = new Board(stage.scene);
  signals = new Signals(stage.scene);
  hourglass = new Hourglass(stage.scene);
  rig = new CameraRig(stage.camera, canvas);
  engine = new Engine();
  engine.addEventListener('restart', () => ui.toast('Moteur relancé automatiquement'));
  applySettings(true);
  pieceGeometries();

  let restored = false;
  if (state?.pgn !== undefined) {
    try {
      if (state.pgn) app.chess.loadPgn(state.pgn); else if (state.fen) app.chess.load(state.fen);
      app.player = state.player === 'b' ? 'b' : 'w';
      app.viewSide = state.viewSide === -1 ? -1 : 1;
      app.clocks = state.clocks || null;
      app.over = state.over || null;
      restored = true;
    } catch { app.chess.reset(); }
  }
  if (!restored) {
    app.player = app.settings.color === 'b' ? 'b' : 'w';
    app.viewSide = app.player === 'w' ? 1 : -1;
    const ck = CLOCKS[app.settings.clock];
    app.clocks = ck ? { w: ck[0], b: ck[0], inc: ck[1] } : null;
  }
  board.build(theme(), app.viewSide === -1);
  rig.side = app.viewSide;
  rig.go('joueur', true);
  rebuildPieces();
  const h = app.chess.history({ verbose: true });
  if (h.length) signals.setLastMove(h[h.length - 1].from, h[h.length - 1].to);
  updateCheckSignal();

  layout();
  window.addEventListener('resize', layout);
  window.addEventListener('orientationchange', () => setTimeout(layout, 250));
  bindInput(canvas);
  bindPanel();
  refreshUI();
  ui.setSaveInfo(!store.hasServer ? 'Sauvegarde automatique sur cet appareil' : info?.fallback ? 'Sauvegarde locale à ce Mac' : 'Sauvegarde automatique');
  if (!store.hasServer) {
    // Version web / iPad : pas de serveur à arrêter ; mise en cache hors ligne ; stockage persistant demandé
    document.getElementById('btnQuit').hidden = true;
    registerOffline();
    try { navigator.storage?.persist?.(); } catch { /* non supporté */ }
  }
  // Safari iPad : empêcher le zoom de page par pincement / double-tap (le zoom 3D reste actif)
  for (const ev of ['gesturestart', 'gesturechange']) document.addEventListener(ev, (e) => e.preventDefault(), { passive: false });
  if (info?.fallback) ui.toast('Le disque n’est pas inscriptible : sauvegarde locale à ce Mac.', 5000);
  if (info?.recovered === false) ui.toast('Sauvegarde illisible mise de côté : nouvelle partie.', 5000);
  store.connectLifecycle(() => ui.serverDown(true), () => ui.serverDown(false));

  let last = performance.now();
  const frame = (now) => {
    const dtMs = now - last;
    last = now;
    const dt = Math.min(0.05, dtMs / 1000);
    updateTweens(dt);
    rig.update(dt);
    signals.update(dt);
    hourglass.update(dt);
    tickClocks(dtMs);
    stage.render();
    requestAnimationFrame(frame);
  };
  requestAnimationFrame(frame);
  ui.ready();
  window.__e3d = { app, engine, hourglass, signals, rig, stage, tryMove, newGame, undo, aiMove, importPosition, select, flip, layout };

  try { await engine.start(); } catch { ui.toast('Le moteur d’échecs n’a pas pu démarrer.', 6000); }
  if (app.over) { finishGame(app.over, { silent: true }); }
  else if (app.chess.turn() === computer()) aiMove();
  else if (!restored) { sound.play('start'); playerTurnStarted(); }
  else playerTurnStarted();
}

init();
