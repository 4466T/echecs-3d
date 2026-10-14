// Sons synthétisés (Web Audio) : déplacement bois, capture, roque, échec, fin de partie.
export class Sound {
  constructor() { this.ctx = null; this.volume = 0.7; this.muted = false; }

  ensure() {
    if (!this.ctx) {
      const AC = window.AudioContext || window.webkitAudioContext;
      if (!AC) return null;
      this.ctx = new AC();
      this.master = this.ctx.createGain();
      this.master.connect(this.ctx.destination);
    }
    if (this.ctx.state === 'suspended') this.ctx.resume();
    this.master.gain.value = this.muted ? 0 : this.volume;
    return this.ctx;
  }

  knock(t0, freq = 900, gain = 0.6, dur = 0.09) {
    const c = this.ctx;
    const len = Math.floor(c.sampleRate * dur);
    const buf = c.createBuffer(1, len, c.sampleRate);
    const d = buf.getChannelData(0);
    for (let i = 0; i < len; i++) d[i] = (Math.random() * 2 - 1) * Math.pow(1 - i / len, 5);
    const src = c.createBufferSource(); src.buffer = buf;
    const bp = c.createBiquadFilter(); bp.type = 'bandpass'; bp.frequency.value = freq; bp.Q.value = 2.2;
    const g = c.createGain(); g.gain.value = gain;
    src.connect(bp).connect(g).connect(this.master);
    src.start(t0);
    // corps boisé
    const o = c.createOscillator(); o.type = 'sine'; o.frequency.setValueAtTime(freq * 0.24, t0);
    o.frequency.exponentialRampToValueAtTime(freq * 0.16, t0 + dur);
    const og = c.createGain(); og.gain.setValueAtTime(gain * 0.5, t0); og.gain.exponentialRampToValueAtTime(0.001, t0 + dur * 1.4);
    o.connect(og).connect(this.master); o.start(t0); o.stop(t0 + dur * 1.5);
  }

  tone(t0, freq, dur, gain = 0.18, type = 'sine') {
    const c = this.ctx;
    const o = c.createOscillator(); o.type = type; o.frequency.value = freq;
    const g = c.createGain();
    g.gain.setValueAtTime(0.0001, t0);
    g.gain.exponentialRampToValueAtTime(gain, t0 + 0.02);
    g.gain.exponentialRampToValueAtTime(0.0001, t0 + dur);
    o.connect(g).connect(this.master); o.start(t0); o.stop(t0 + dur + 0.05);
  }

  play(kind) {
    if (this.muted || !this.ensure()) return;
    const t = this.ctx.currentTime + 0.01;
    switch (kind) {
      case 'move': this.knock(t, 820, 0.55); break;
      case 'capture': this.knock(t, 1100, 0.7, 0.07); this.knock(t + 0.06, 700, 0.5); break;
      case 'castle': this.knock(t, 820, 0.5); this.knock(t + 0.12, 760, 0.45); break;
      case 'check': this.knock(t, 900, 0.5); this.tone(t + 0.05, 880, 0.5, 0.12); this.tone(t + 0.05, 1318, 0.6, 0.07); break;
      case 'illegal': this.tone(t, 180, 0.15, 0.1, 'triangle'); break;
      case 'win': [523, 659, 784, 1046].forEach((f, i) => this.tone(t + i * 0.12, f, 0.9, 0.12)); break;
      case 'lose': [440, 392, 349, 262].forEach((f, i) => this.tone(t + i * 0.16, f, 0.9, 0.11)); break;
      case 'draw': [523, 523, 659].forEach((f, i) => this.tone(t + i * 0.14, f, 0.7, 0.1)); break;
      case 'start': this.tone(t, 659, 0.4, 0.08); this.tone(t + 0.1, 988, 0.5, 0.06); break;
      default: break;
    }
  }
}
