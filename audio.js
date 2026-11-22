/* ==========================================================================
   Refs Cards — moteur sonore 100 % Web Audio API (aucun fichier audio)
   --------------------------------------------------------------------------
   Chaque bruitage est synthétisé : bruit blanc filtré, oscillateurs, FM,
   réverbération à convolution générée à la volée. Le déchirement du booster
   est un son continu dont le timbre suit la vitesse du doigt.
   ========================================================================== */
const Sound = (() => {
  'use strict';

  let ac = null;
  let master = null;
  let comp = null;
  let wet = null;
  let reverb = null;
  let noiseBuf = null;
  let muted = false;
  let tear = null;
  let lastTick = 0;

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => (ac ? ac.currentTime : 0);

  /* ---------------------------------------------------------------- setup */

  function makeNoise(duration) {
    const rate = ac.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = ac.createBuffer(1, len, rate);
    const data = buf.getChannelData(0);
    for (let i = 0; i < len; i++) data[i] = Math.random() * 2 - 1;
    return buf;
  }

  function makeImpulse(duration, decay) {
    const rate = ac.sampleRate;
    const len = Math.floor(rate * duration);
    const buf = ac.createBuffer(2, len, rate);
    for (let c = 0; c < 2; c++) {
      const data = buf.getChannelData(c);
      for (let i = 0; i < len; i++) {
        const t = i / len;
        const early = i < rate * 0.02 ? 0.35 : 1;
        data[i] = (Math.random() * 2 - 1) * Math.pow(1 - t, decay) * early;
      }
    }
    return buf;
  }

  function distortionCurve(amount) {
    const n = 1024;
    const curve = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      const x = (i * 2) / n - 1;
      curve[i] = Math.tanh(x * amount);
    }
    return curve;
  }

  function build() {
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -14;
    comp.knee.value = 22;
    comp.ratio.value = 4;
    comp.attack.value = 0.004;
    comp.release.value = 0.24;

    master = ac.createGain();
    master.gain.value = 0.9;
    master.connect(comp);
    comp.connect(ac.destination);

    reverb = ac.createConvolver();
    reverb.buffer = makeImpulse(2.8, 2.6);
    wet = ac.createGain();
    wet.gain.value = 0.34;
    wet.connect(reverb);
    reverb.connect(master);

    noiseBuf = makeNoise(2.5);
  }

  function unlock() {
    if (!ac) {
      const Ctx = window.AudioContext || window.webkitAudioContext;
      if (!Ctx) return null;
      try {
        ac = new Ctx();
      } catch (err) {
        return null;
      }
      build();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  // Le contexte peut être encore en cours de reprise juste après le premier
  // geste : on programme quand même, tout sera joué dès le resume().
  function ready() {
    return !!ac && ac.state !== 'closed' && !muted;
  }

  /* -------------------------------------------------------------- helpers */

  function envelope(t, peak, attack, decay, hold = 0) {
    const g = ac.createGain();
    const top = Math.max(0.0002, peak);
    g.gain.setValueAtTime(0.0001, t);
    g.gain.exponentialRampToValueAtTime(top, t + Math.max(0.002, attack));
    if (hold) g.gain.setValueAtTime(top, t + attack + hold);
    g.gain.exponentialRampToValueAtTime(0.0001, t + attack + hold + decay);
    g.gain.setValueAtTime(0, t + attack + hold + decay + 0.02);
    return g;
  }

  function output(node, pan, send) {
    let out = node;
    if (pan) {
      const p = ac.createStereoPanner();
      p.pan.value = clamp(pan, -1, 1);
      out.connect(p);
      out = p;
    }
    out.connect(master);
    if (send) {
      const s = ac.createGain();
      s.gain.value = send;
      out.connect(s);
      s.connect(wet);
    }
    return out;
  }

  function tone(opts) {
    if (!ready()) return;
    const {
      freq = 440, type = 'sine', t = now(), attack = 0.006, decay = 0.25,
      hold = 0, gain = 0.12, freqEnd = null, glide = null, filterType = null,
      filterFreq = 1400, filterEnd = null, q = 1, pan = 0, send = 0, detune = 0
    } = opts;

    const t0 = Math.max(t, now());
    const osc = ac.createOscillator();
    osc.type = type;
    osc.frequency.setValueAtTime(Math.max(1, freq), t0);
    if (detune) osc.detune.setValueAtTime(detune, t0);
    if (freqEnd) {
      osc.frequency.exponentialRampToValueAtTime(Math.max(1, freqEnd), t0 + (glide || attack + hold + decay));
    }

    const g = envelope(t0, gain, attack, decay, hold);
    let node = osc;
    if (filterType) {
      const f = ac.createBiquadFilter();
      f.type = filterType;
      f.frequency.setValueAtTime(filterFreq, t0);
      if (filterEnd) f.frequency.exponentialRampToValueAtTime(filterEnd, t0 + attack + hold + decay);
      f.Q.value = q;
      node.connect(f);
      node = f;
    }
    node.connect(g);
    output(g, pan, send);
    osc.start(t0);
    osc.stop(t0 + attack + hold + decay + 0.06);
  }

  function noiseHit(opts) {
    if (!ready()) return;
    const {
      t = now(), attack = 0.004, decay = 0.2, hold = 0, gain = 0.2,
      type = 'bandpass', freq = 1200, freqEnd = null, q = 1, pan = 0,
      send = 0, rate = 1
    } = opts;

    const t0 = Math.max(t, now());
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    src.playbackRate.value = rate;

    const f = ac.createBiquadFilter();
    f.type = type;
    f.frequency.setValueAtTime(freq, t0);
    if (freqEnd) f.frequency.exponentialRampToValueAtTime(Math.max(30, freqEnd), t0 + attack + hold + decay);
    f.Q.value = q;

    const g = envelope(t0, gain, attack, decay, hold);
    src.connect(f);
    f.connect(g);
    output(g, pan, send);
    src.start(t0, Math.random() * 1.2);
    src.stop(t0 + attack + hold + decay + 0.06);
  }

  function bell(freq, t, opts) {
    if (!ready()) return;
    const { gain = 0.08, decay = 1.2, ratio = 3.5, index = 900, pan = 0, send = 0.5 } = opts || {};
    const t0 = Math.max(t, now());
    const car = ac.createOscillator();
    car.type = 'sine';
    car.frequency.value = freq;

    const mod = ac.createOscillator();
    mod.type = 'sine';
    mod.frequency.value = freq * ratio;

    const modGain = ac.createGain();
    modGain.gain.setValueAtTime(index, t0);
    modGain.gain.exponentialRampToValueAtTime(0.5, t0 + decay);
    mod.connect(modGain);
    modGain.connect(car.frequency);

    const g = envelope(t0, gain, 0.004, decay);
    car.connect(g);
    output(g, pan, send);

    car.start(t0);
    mod.start(t0);
    car.stop(t0 + decay + 0.08);
    mod.stop(t0 + decay + 0.08);
  }

  /* ------------------------------------------------------- déchirement */

  function tearStart() {
    if (!ready() || tear) return;
    const t = now();

    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;

    const hp = ac.createBiquadFilter();
    hp.type = 'highpass';
    hp.frequency.value = 420;

    const bp = ac.createBiquadFilter();
    bp.type = 'bandpass';
    bp.frequency.value = 1500;
    bp.Q.value = 0.85;

    const shaper = ac.createWaveShaper();
    shaper.curve = distortionCurve(2.4);
    shaper.oversample = '2x';

    const g = ac.createGain();
    g.gain.value = 0.0001;

    const pan = ac.createStereoPanner();
    pan.pan.value = 0;

    src.connect(hp);
    hp.connect(bp);
    bp.connect(shaper);
    shaper.connect(g);
    g.connect(pan);
    pan.connect(master);

    const bp2 = ac.createBiquadFilter();
    bp2.type = 'bandpass';
    bp2.frequency.value = 260;
    bp2.Q.value = 1.1;
    const g2 = ac.createGain();
    g2.gain.value = 0.0001;
    src.connect(bp2);
    bp2.connect(g2);
    g2.connect(pan);

    src.start(t);
    tear = { src, bp, bp2, g, g2, pan };
  }

  function tearUpdate(intensity, panValue) {
    if (!tear || !ac) return;
    const t = now();
    const i = clamp(intensity || 0, 0, 1);
    const target = 0.05 + i * 0.19;
    tear.g.gain.setTargetAtTime(target, t, 0.035);
    tear.g2.gain.setTargetAtTime(0.025 + i * 0.11, t, 0.05);
    tear.bp.frequency.setTargetAtTime(950 + i * 2600, t, 0.05);
    tear.bp2.frequency.setTargetAtTime(170 + i * 250, t, 0.05);
    if (typeof panValue === 'number') tear.pan.pan.setTargetAtTime(clamp(panValue, -0.9, 0.9), t, 0.08);

    // Craquements aléatoires du papier / plastique.
    if (Math.random() < 0.22 + i * 0.55) {
      noiseHit({
        attack: 0.001,
        decay: 0.008 + Math.random() * 0.03,
        gain: 0.018 + i * 0.05 + Math.random() * 0.02,
        type: 'highpass',
        freq: 2400 + Math.random() * 3600,
        q: 0.8,
        pan: (Math.random() - 0.5) * 1.2
      });
    }
  }

  function tearStop() {
    if (!tear) return;
    const t = now();
    const ref = tear;
    tear = null;
    try {
      ref.g.gain.cancelScheduledValues(t);
      ref.g.gain.setTargetAtTime(0.0001, t, 0.03);
      ref.g2.gain.cancelScheduledValues(t);
      ref.g2.gain.setTargetAtTime(0.0001, t, 0.03);
      ref.src.stop(t + 0.3);
    } catch (err) {
      /* source déjà arrêtée */
    }
  }

  function rip() {
    if (!ready()) return;
    const t = now();
    noiseHit({ t, attack: 0.003, decay: 0.42, gain: 0.26, type: 'bandpass', freq: 3200, freqEnd: 520, q: 0.7, send: 0.25 });
    noiseHit({ t: t + 0.02, attack: 0.002, decay: 0.16, gain: 0.2, type: 'highpass', freq: 3800, send: 0.2 });
    noiseHit({ t: t + 0.1, attack: 0.002, decay: 0.22, gain: 0.16, type: 'bandpass', freq: 1500, freqEnd: 6400, q: 1.2, send: 0.2 });
    tone({ t: t + 0.02, type: 'sawtooth', freq: 220, freqEnd: 74, decay: 0.28, gain: 0.1, filterType: 'lowpass', filterFreq: 900 });
  }

  /* ------------------------------------------------------------ bruitages */

  function pop() {
    if (!ready()) return;
    const t = now();
    noiseHit({ t, attack: 0.002, decay: 0.34, gain: 0.3, type: 'lowpass', freq: 5200, freqEnd: 300, send: 0.32 });
    tone({ t, type: 'sine', freq: 190, freqEnd: 42, decay: 0.5, gain: 0.38 });
    tone({ t: t + 0.01, type: 'triangle', freq: 880, freqEnd: 150, decay: 0.18, gain: 0.16 });
    noiseHit({ t: t + 0.03, attack: 0.002, decay: 0.5, gain: 0.1, type: 'highpass', freq: 5200, send: 0.5 });
  }

  function whoosh() {
    if (!ready()) return;
    const t = now();
    const src = ac.createBufferSource();
    src.buffer = noiseBuf;
    src.loop = true;
    const f = ac.createBiquadFilter();
    f.type = 'bandpass';
    f.Q.value = 1.1;
    f.frequency.setValueAtTime(380, t);
    f.frequency.exponentialRampToValueAtTime(2600, t + 0.2);
    f.frequency.exponentialRampToValueAtTime(560, t + 0.46);
    const g = envelope(t, 0.2, 0.06, 0.4);
    const p = ac.createStereoPanner();
    p.pan.setValueAtTime(-0.5, t);
    p.pan.linearRampToValueAtTime(0.55, t + 0.45);
    src.connect(f);
    f.connect(g);
    g.connect(p);
    p.connect(master);
    src.start(t, Math.random());
    src.stop(t + 0.56);
  }

  function deal() {
    if (!ready()) return;
    noiseHit({
      attack: 0.002,
      decay: 0.13,
      gain: 0.1,
      type: 'highpass',
      freq: 1800 + Math.random() * 1400,
      pan: (Math.random() - 0.5) * 0.8,
      send: 0.15
    });
    tone({ type: 'sine', freq: 520 + Math.random() * 180, freqEnd: 320, decay: 0.09, gain: 0.035 });
  }

  function tick() {
    if (!ready()) return;
    const t = performance.now();
    if (t - lastTick < 55) return;
    lastTick = t;
    tone({ type: 'square', freq: 1800 + Math.random() * 300, decay: 0.024, gain: 0.022, pan: (Math.random() - 0.5) * 0.4 });
  }

  function snap() {
    if (!ready()) return;
    const t = now();
    noiseHit({ t, attack: 0.002, decay: 0.12, gain: 0.16, type: 'bandpass', freq: 1800, freqEnd: 460, q: 1.4, pan: 0.2 });
    tone({ t, type: 'sine', freq: 150, freqEnd: 72, decay: 0.16, gain: 0.16 });
  }

  function coin() {
    if (!ready()) return;
    const t = now();
    bell(1318.5, t, { gain: 0.045, decay: 0.35, ratio: 2.01, index: 260, send: 0.3 });
    bell(1975.5, t + 0.055, { gain: 0.035, decay: 0.4, ratio: 2.7, index: 300, send: 0.35 });
  }

  function chaChing() {
    if (!ready()) return;
    const t = now();
    // Tiroir-caisse : deux cliquetis métalliques puis la « monnaie ».
    noiseHit({ t, attack: 0.001, decay: 0.05, gain: 0.16, type: 'highpass', freq: 3600, send: 0.15 });
    noiseHit({ t: t + 0.07, attack: 0.001, decay: 0.09, gain: 0.12, type: 'bandpass', freq: 2400, q: 2 });
    bell(2093, t + 0.02, { gain: 0.11, decay: 0.8, ratio: 2.01, index: 900, pan: -0.2, send: 0.5 });
    bell(2637, t + 0.11, { gain: 0.1, decay: 1.0, ratio: 1.5, index: 700, pan: 0.25, send: 0.55 });
    bell(3136, t + 0.19, { gain: 0.07, decay: 0.9, ratio: 2.4, index: 500, pan: 0.1, send: 0.6 });
    tone({ t: t + 0.12, type: 'triangle', freq: 1046.5, decay: 0.5, gain: 0.06, send: 0.4 });
    tone({ t: t + 0.2, type: 'triangle', freq: 1568, decay: 0.6, gain: 0.05, send: 0.4 });
    for (let i = 0; i < 5; i++) {
      noiseHit({
        t: t + 0.24 + i * 0.05,
        attack: 0.001,
        decay: 0.05,
        gain: 0.035,
        type: 'bandpass',
        freq: 3000 + Math.random() * 2600,
        q: 3,
        pan: (Math.random() - 0.5) * 1.4
      });
    }
  }

  /* ------------------------------------------------------------- raretés */

  function stingerCommon() {
    if (!ready()) return;
    const t = now();
    [523.25, 659.25, 783.99].forEach((f, i) => {
      tone({ t: t + i * 0.07, type: 'triangle', freq: f, decay: 0.35, gain: 0.1, send: 0.25 });
      tone({ t: t + i * 0.07, type: 'sine', freq: f * 2, decay: 0.2, gain: 0.03 });
    });
    noiseHit({ t, attack: 0.002, decay: 0.2, gain: 0.05, type: 'highpass', freq: 4200, send: 0.4 });
  }

  function stingerRare() {
    if (!ready()) return;
    const t = now();
    [659.25, 830.61, 987.77, 1318.51].forEach((f, i) => {
      bell(f, t + i * 0.075, { gain: 0.075, decay: 1.5, ratio: 3.01, index: 420, pan: (i - 1.5) * 0.3, send: 0.7 });
    });
    [2637, 3135.96, 3951.07].forEach((f, i) => {
      tone({ t: t + 0.16 + i * 0.07, type: 'sine', freq: f, decay: 0.6, gain: 0.02, pan: (Math.random() - 0.5), send: 0.8 });
    });
    noiseHit({ t, attack: 0.08, decay: 0.5, gain: 0.06, type: 'highpass', freq: 6000, send: 0.9 });
    tone({ t, type: 'sine', freq: 329.63, decay: 0.9, gain: 0.05, send: 0.6 });
  }

  function stingerEpic() {
    if (!ready()) return;
    const t = now();
    // Impact + descente dramatique.
    tone({ t, type: 'sine', freq: 120, freqEnd: 30, decay: 0.9, gain: 0.42, send: 0.2 });
    noiseHit({ t, attack: 0.002, decay: 0.55, gain: 0.28, type: 'lowpass', freq: 900, freqEnd: 120, send: 0.35 });
    noiseHit({ t: t + 0.02, attack: 0.001, decay: 0.3, gain: 0.12, type: 'highpass', freq: 2600, send: 0.4 });
    // Montée tendue avant l'accord.
    tone({ t: t + 0.05, type: 'sawtooth', freq: 110, freqEnd: 440, decay: 0.55, gain: 0.07, filterType: 'lowpass', filterFreq: 500, filterEnd: 3200, q: 4, send: 0.3 });
    // Accord sombre en A mineur, nappes désaccordées.
    const chord = [110, 130.81, 164.81, 196, 261.63];
    chord.forEach((f, i) => {
      [-8, 7].forEach((detune) => {
        tone({
          t: t + 0.5, type: 'sawtooth', freq: f, detune, decay: 1.9, hold: 0.2,
          gain: 0.045, filterType: 'lowpass', filterFreq: 2600, filterEnd: 420, q: 1.4,
          pan: (i / chord.length - 0.5) * 0.9, send: 0.45
        });
      });
    });
    [880, 1318.5].forEach((f, i) => {
      bell(f, t + 0.56 + i * 0.1, { gain: 0.05, decay: 2.2, ratio: 2.4, index: 700, send: 0.8 });
    });
    // Grosse caisse.
    tone({ t: t + 0.5, type: 'sine', freq: 90, freqEnd: 42, decay: 0.5, gain: 0.34 });
    tone({ t: t + 1.05, type: 'sine', freq: 82, freqEnd: 38, decay: 0.6, gain: 0.2 });
  }

  function stingerLegendary() {
    if (!ready()) return;
    const t = now();
    // Impact d'ouverture + timbales.
    tone({ t, type: 'sine', freq: 130, freqEnd: 34, decay: 0.8, gain: 0.4, send: 0.25 });
    noiseHit({ t, attack: 0.002, decay: 0.5, gain: 0.24, type: 'lowpass', freq: 1600, freqEnd: 200, send: 0.4 });
    [0, 0.42, 0.84].forEach((offset, i) => {
      tone({ t: t + offset, type: 'sine', freq: 98 - i * 6, freqEnd: 52, decay: 0.75, gain: 0.3, send: 0.3 });
      noiseHit({ t: t + offset, attack: 0.002, decay: 0.2, gain: 0.12, type: 'lowpass', freq: 500, send: 0.3 });
    });

    // Fanfare cuivrée qui monte.
    const melody = [523.25, 659.25, 783.99, 1046.5, 1318.51, 1567.98, 2093];
    melody.forEach((f, i) => {
      const at = t + 0.05 + i * 0.1;
      [-6, 6].forEach((detune) => {
        tone({
          t: at, type: 'sawtooth', freq: f, detune, attack: 0.01, decay: 0.42, hold: 0.16,
          gain: 0.055, filterType: 'lowpass', filterFreq: 4200, filterEnd: 1800, q: 0.9,
          pan: (i / melody.length - 0.5) * 0.8, send: 0.5
        });
      });
      tone({ t: at, type: 'triangle', freq: f * 2, decay: 0.4, gain: 0.035, send: 0.6 });
      bell(f * 2, at, { gain: 0.03, decay: 1.1, ratio: 2.01, index: 300, send: 0.7 });
    });

    // Accord final brillant + scintillements.
    [1046.5, 1318.51, 1567.98, 2093].forEach((f, i) => {
      tone({
        t: t + 0.8, type: 'sawtooth', freq: f, attack: 0.02, decay: 1.8, hold: 0.3,
        gain: 0.028, filterType: 'lowpass', filterFreq: 5200, filterEnd: 1500,
        pan: (i - 1.5) * 0.3, send: 0.7
      });
    });
    for (let i = 0; i < 9; i++) {
      tone({
        t: t + 0.55 + i * 0.09,
        type: 'sine',
        freq: 2093 * Math.pow(2, (Math.floor(Math.random() * 5) * 2) / 12),
        decay: 0.7,
        gain: 0.025,
        pan: (Math.random() - 0.5) * 1.6,
        send: 0.9
      });
    }
    noiseHit({ t: t + 0.1, attack: 0.3, decay: 1.6, gain: 0.05, type: 'highpass', freq: 6800, send: 1 });
  }

  function rarity(kind) {
    if (!ready()) return;
    if (kind === 'rare') stingerRare();
    else if (kind === 'epic') stingerEpic();
    else if (kind === 'legendary') stingerLegendary();
    else stingerCommon();
  }

  /* ---------------------------------------------------------------- API */

  return {
    unlock,
    get muted() { return muted; },
    setMuted(value) {
      muted = !!value;
      if (master) master.gain.setTargetAtTime(muted ? 0 : 0.9, now(), 0.05);
      if (muted) tearStop();
    },
    tearStart,
    tearUpdate,
    tearStop,
    rip,
    pop,
    whoosh,
    deal,
    tick,
    snap,
    coin,
    chaChing,
    rarity
  };
})();
