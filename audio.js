/* ==========================================================================
   Refs Cards — moteur sonore « sons de GitHub »
   --------------------------------------------------------------------------
   Plus aucune synthèse : tous les bruitages du jeu sont de VRAIS fichiers
   audio téléchargés depuis GitHub. La banque vient du dépôt public
   microsoft/vscode (licence MIT), dossier
   `src/vs/platform/accessibilitySignal/browser/media` : ce sont les signaux
   sonores de l'éditeur (ligne de diff ajoutée, sauvegarde, terminal, tâche
   terminée, confettis, réponse reçue…). Chaque fichier est cité, avec son
   lien et le commit exact, dans `assets/sounds/CREDITS.md`.

   Le moteur reste 100 % Web Audio API pour la lecture : décodage des mp3 en
   AudioBuffer, superposition des couches à l'heure près (aucun setTimeout
   pour le calage), panoramique, vitesse de lecture et volume par bruitage.
   Les fichiers VS Code contiennent du silence au début et une longue traîne
   muette : chaque cue déclare sa fenêtre utile (`in`/`out`), mesurée sur le
   décodage réel, pour que le son parte immédiatement.

   API publique inchangée (app.js l'appelle via le proxy SFX) :
     unlock, muted, setMuted, tearStart, tearUpdate, tearStop, rip, pop,
     whoosh, deal, tick, snap, coin, chaChing, ultraOpen, packOpen, rarity.
   Si le navigateur n'a pas d'AudioContext (ou si un fichier manque), le jeu
   continue sans bruitage : aucune fonction ne lève d'exception.
   ========================================================================== */
const Sound = (() => {
  'use strict';

  const SOUND_DIR = 'assets/sounds/';
  const SOUND_VERSION = '2026.11.26-1';   // cache-busting, comme les ?v= des scripts

  /* -------------------------------------------------------------- banque
     Clé = nom du fichier sur GitHub (sans .mp3). `in`/`out` = fenêtre utile
     en secondes, `peak` = crête mesurée (sert à égaliser les volumes). */
  const CUES = {
    foldedAreas:              { in: 0.060, out: 0.330, peak: 0.517 }, // petit clic d'interface
    diffLineInserted:         { in: 0.020, out: 0.290, peak: 0.266 }, // blip montant (ligne ajoutée)
    diffLineModified:         { in: 0.015, out: 0.210, peak: 0.436 }, // blip court (ligne modifiée)
    diffLineDeleted:          { in: 0.040, out: 0.350, peak: 0.470 }, // blip descendant
    save:                     { in: 0.130, out: 0.510, peak: 0.423 }, // « sauvegarde » : clic doux
    requestSent:              { in: 0.055, out: 0.580, peak: 0.307 }, // balayage montant (requête envoyée)
    success:                  { in: 0.025, out: 0.490, peak: 0.360 }, // validation simple
    terminalCommandSucceeded: { in: 0.090, out: 0.500, peak: 0.259 }, // commande réussie
    taskCompleted:            { in: 0.290, out: 1.300, peak: 0.413 }, // grande validation (accord)
    confetti:                 { in: 0.030, out: 1.120, peak: 0.472 }, // confettis / célébration
    clear:                    { in: 0.025, out: 0.240, peak: 0.413 }, // balayage sec (« clear »)
    editsKept:                { in: 0.190, out: 0.860, peak: 0.552 }, // modifications conservées
    progress:                 { in: 0.090, out: 0.620, peak: 0.247 }, // pulsation « en cours » (boucle)
    codeActionTriggered:      { in: 0.370, out: 0.860, peak: 0.495 }, // ampoule : action déclenchée
    codeActionApplied:        { in: 0.220, out: 0.800, peak: 0.550 }, // action appliquée (scintillant)
    quickFixes:               { in: 0.070, out: 0.440, peak: 0.489 }, // correctifs rapides
    responseReceived1:        { in: 0.080, out: 0.650, peak: 0.315 }, // carillon 1
    responseReceived2:        { in: 0.080, out: 0.550, peak: 0.258 }, // carillon 2
    responseReceived3:        { in: 0.075, out: 0.540, peak: 0.258 }, // carillon 3
    responseReceived4:        { in: 0.040, out: 0.500, peak: 0.259 }, // carillon 4
    voiceRecordingStarted:    { in: 0.065, out: 0.340, peak: 0.567 }, // début d'enregistrement (bip)
    terminalBell:             { in: 0.110, out: 0.540, peak: 0.379 }, // cloche du terminal
    chatUserActionRequired:   { in: 0.145, out: 0.600, peak: 0.460 }  // attention requise (montée)
  };

  /* Chargés dès le premier geste ; le reste suit en tâche de fond. */
  const FIRST_LOAD = ['foldedAreas', 'save', 'diffLineInserted', 'success', 'confetti', 'progress'];

  let ac = null;
  let master = null;
  let comp = null;
  let muted = false;
  let lastTick = 0;
  let lastCrackle = 0;
  let preloadTimer = null;

  const buffers = new Map();   // nom → AudioBuffer décodé
  const pending = new Map();   // nom → Promise<AudioBuffer|null>
  const broken = new Set();    // noms indisponibles (404, décodage impossible)
  const active = [];           // heures de fin des voix en cours (anti-saturation)

  const MAX_VOICES = 28;       // garde-fou pendant les cascades d'ouverture
  const TARGET_PEAK = 0.65;    // égalisation des cues entre eux

  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const now = () => (ac ? ac.currentTime : 0);
  const rand = (a, b) => a + Math.random() * (b - a);
  const url = (name) => `${SOUND_DIR}${name}.mp3?v=${SOUND_VERSION}`;

  /* ---------------------------------------------------------------- setup */

  function build() {
    comp = ac.createDynamicsCompressor();
    comp.threshold.value = -12;
    comp.knee.value = 20;
    comp.ratio.value = 4;
    comp.attack.value = 0.003;
    comp.release.value = 0.22;

    master = ac.createGain();
    master.gain.value = muted ? 0 : 0.9;
    master.connect(comp);
    comp.connect(ac.destination);
  }

  function unlock() {
    if (!ac) {
      const Ctx = typeof window !== 'undefined' && (window.AudioContext || window.webkitAudioContext);
      if (!Ctx) return null;
      try {
        ac = new Ctx();
      } catch (err) {
        return null;
      }
      build();
      preload(FIRST_LOAD);
      scheduleRest();
    }
    if (ac.state === 'suspended') ac.resume().catch(() => {});
    return ac;
  }

  function ready() {
    return !!ac && ac.state !== 'closed' && !muted;
  }

  /* ------------------------------------------------------- chargement mp3 */

  function decode(arrayBuffer) {
    return new Promise((resolve, reject) => {
      let settled = false;
      const ok = (buf) => { if (!settled) { settled = true; resolve(buf); } };
      const ko = (err) => { if (!settled) { settled = true; reject(err); } };
      try {
        const p = ac.decodeAudioData(arrayBuffer, ok, ko);
        if (p && typeof p.then === 'function') p.then(ok, ko);
      } catch (err) {
        ko(err);
      }
    });
  }

  function load(name) {
    if (buffers.has(name)) return Promise.resolve(buffers.get(name));
    if (broken.has(name)) return Promise.resolve(null);
    if (pending.has(name)) return pending.get(name);
    if (!ac || typeof fetch !== 'function') return Promise.resolve(null);

    let job;
    try {
      job = fetch(url(name), { cache: 'force-cache' })
        .then((res) => {
          if (!res.ok) throw new Error(`HTTP ${res.status}`);
          return res.arrayBuffer();
        })
        .then((data) => decode(data))
        .then((buf) => {
          buffers.set(name, buf);
          pending.delete(name);
          return buf;
        })
        .catch(() => {
          broken.add(name);
          pending.delete(name);
          return null;
        });
    } catch (err) {
      broken.add(name);
      return Promise.resolve(null);
    }
    pending.set(name, job);
    return job;
  }

  /* Joue dès que le buffer est là. S'il arrive trop tard (premier clic, le
     temps de télécharger), on laisse tomber : un bruitage en retard est pire
     que pas de bruitage. */
  function withBuffer(name, run, maxWait) {
    const buf = buffers.get(name);
    if (buf) { run(buf); return; }
    const started = now();
    load(name).then((loaded) => {
      if (!loaded || !ready()) return;
      if (maxWait && now() - started > maxWait) return;
      run(loaded);
    });
  }

  function preload(names) {
    names.forEach((name) => { if (CUES[name]) load(name); });
  }

  /* Le reste de la banque part en tâche de fond, par petites fournées, pour
     ne pas concurrencer les images des cartes au démarrage. */
  function scheduleRest() {
    if (preloadTimer) return;
    const rest = Object.keys(CUES).filter((name) => FIRST_LOAD.indexOf(name) === -1);
    let i = 0;
    const step = () => {
      preloadTimer = null;
      if (!ac || ac.state === 'closed') return;
      preload(rest.slice(i, i + 4));
      i += 4;
      if (i < rest.length) preloadTimer = setTimeout(step, 400);
    };
    preloadTimer = setTimeout(step, 1200);
  }

  /* -------------------------------------------------------------- lecture */

  /* opts : { delay, gain, rate, pan, panTo, panTime } */
  function play(name, opts) {
    if (!ready()) return;
    const cue = CUES[name];
    if (!cue) return;
    const t = now();
    while (active.length && active[0] <= t) active.shift();
    if (active.length >= MAX_VOICES) return;

    const o = opts || {};
    const gainValue = (o.gain == null ? 0.35 : o.gain) * clamp(TARGET_PEAK / cue.peak, 0.7, 2.4);
    if (gainValue <= 0.0005) return;
    const rate = clamp(o.rate == null ? 1 : o.rate, 0.25, 4);
    const base = t;
    const delay = o.delay || 0;

    withBuffer(name, (buf) => {
      if (!ready()) return;
      const start = clamp(cue.in, 0, buf.duration);
      const end = clamp(cue.out, start + 0.01, buf.duration);
      const at = Math.max(now(), base + delay);
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.playbackRate.value = rate;

      const g = ac.createGain();
      g.gain.value = gainValue;
      src.connect(g);

      let out = g;
      const pan = o.pan || 0;
      if (pan || o.panTo != null) {
        const p = ac.createStereoPanner();
        p.pan.setValueAtTime(clamp(pan, -1, 1), at);
        if (o.panTo != null) p.pan.linearRampToValueAtTime(clamp(o.panTo, -1, 1), at + (o.panTime || 0.4));
        g.connect(p);
        out = p;
      }
      out.connect(master);

      const span = (end - start) / rate;
      active.push(at + span);
      active.sort((a, b) => a - b);
      try {
        src.start(at, start, end - start);
      } catch (err) {
        const i = active.indexOf(at + span);
        if (i !== -1) active.splice(i, 1);
      }
    }, 1.5);
  }

  /* ------------------------------------------------- déchirement du pack
     Boucle sur `progress.mp3` (la pulsation « en cours » de VS Code) :
     volume, vitesse et panoramique suivent le doigt, plus des craquements
     tirés des blips de diff. */

  let tear = null;
  let tearWanted = false;
  let tearIntensity = 0;
  let tearPan = 0;

  function applyTear() {
    if (!tear || !ac) return;
    const t = now();
    const i = tearIntensity;
    tear.g.gain.setTargetAtTime(0.05 + i * 0.30, t, 0.04);
    tear.src.playbackRate.setTargetAtTime(0.7 + i * 0.95, t, 0.06);
    tear.pan.pan.setTargetAtTime(clamp(tearPan, -0.9, 0.9), t, 0.08);
  }

  function tearStart() {
    if (!ready() || tear || tearWanted) return;
    tearWanted = true;
    tearIntensity = 0;
    withBuffer('progress', (buf) => {
      if (!tearWanted || !ready()) return;
      const cue = CUES.progress;
      const src = ac.createBufferSource();
      src.buffer = buf;
      src.loop = true;
      src.loopStart = clamp(cue.in, 0, buf.duration);
      src.loopEnd = clamp(cue.out, src.loopStart + 0.02, buf.duration);
      src.playbackRate.value = 0.7;

      const g = ac.createGain();
      g.gain.value = 0.0001;
      const pan = ac.createStereoPanner();
      pan.pan.value = 0;

      src.connect(g);
      g.connect(pan);
      pan.connect(master);
      src.start(now(), src.loopStart);

      tear = { src, g, pan };
      applyTear();
    }, 2);
  }

  function tearUpdate(intensity, panValue) {
    tearIntensity = clamp(intensity || 0, 0, 1);
    if (typeof panValue === 'number') tearPan = panValue;
    if (!tear || !ac) return;
    applyTear();

    const t = performance.now();
    if (t - lastCrackle < 55) return;
    if (Math.random() < 0.14 + tearIntensity * 0.4) {
      lastCrackle = t;
      play(Math.random() < 0.5 ? 'diffLineModified' : 'foldedAreas', {
        gain: 0.05 + tearIntensity * 0.13,
        rate: rand(1.3, 2.2),
        pan: rand(-0.6, 0.6)
      });
    }
  }

  function tearStop() {
    tearWanted = false;
    if (!tear) return;
    const ref = tear;
    tear = null;
    const t = now();
    try {
      ref.g.gain.cancelScheduledValues(t);
      ref.g.gain.setTargetAtTime(0.0001, t, 0.03);
      ref.src.stop(t + 0.2);
    } catch (err) {
      /* source déjà arrêtée */
    }
  }

  /* ------------------------------------------------------------ bruitages */

  /* Déchirure finale : balayage « clear » + blip descendant. */
  function rip() {
    play('clear', { gain: 0.55, rate: 0.85 });
    play('diffLineDeleted', { gain: 0.34, rate: 0.8, delay: 0.05 });
    play('confetti', { gain: 0.16, rate: 1.35, delay: 0.02 });
  }

  /* Le booster éclate : confettis + validation « edits kept ». */
  function pop() {
    play('confetti', { gain: 0.55, rate: 0.95 });
    play('editsKept', { gain: 0.32, rate: 1.05, delay: 0.03 });
    play('save', { gain: 0.2, rate: 0.8 });
  }

  /* Carte qui file vers le butin : balayage « requête envoyée ». */
  function whoosh() {
    play('requestSent', { gain: 0.42, rate: 1.1, pan: -0.45, panTo: 0.5, panTime: 0.42 });
  }

  /* Carte distribuée : blip de ligne ajoutée, légèrement varié. */
  function deal() {
    play('diffLineInserted', { gain: 0.3, rate: rand(0.95, 1.25), pan: rand(-0.4, 0.4) });
  }

  /* Survol / petit clic : clic d'interface accéléré, très discret. */
  function tick() {
    if (!ready()) return;
    const t = performance.now();
    if (t - lastTick < 55) return;
    lastTick = t;
    play('foldedAreas', { gain: 0.15, rate: rand(1.3, 1.6), pan: rand(-0.2, 0.2) });
  }

  /* Carte rangée / bouton : « sauvegarde ». */
  function snap() {
    play('save', { gain: 0.42, rate: 1.05, pan: 0.15 });
    play('foldedAreas', { gain: 0.13, rate: 1.25, delay: 0.005 });
  }

  /* Pièces gagnées : deux validations courtes. */
  function coin() {
    play('success', { gain: 0.3, rate: 1.15 });
    play('terminalCommandSucceeded', { gain: 0.22, rate: 1.25, delay: 0.06, pan: 0.2 });
  }

  /* Achat : clic de caisse, grande validation, confettis. */
  function chaChing() {
    play('save', { gain: 0.3, rate: 1.45 });
    play('taskCompleted', { gain: 0.5, delay: 0.07 });
    play('confetti', { gain: 0.3, rate: 1.1, delay: 0.18 });
    play('success', { gain: 0.2, rate: 1.3, delay: 0.26, pan: 0.3 });
  }

  /* ------------------------------------------------------------- raretés
     Une couche de plus par palier : du simple « commande réussie » jusqu'à
     la fanfare « tâche terminée + confettis + carillons ». */

  const TIERS = [
    /* 0 · commune */
    [['terminalCommandSucceeded', 0.34, 0, 1.05]],
    /* 1 · inhabituelle */
    [['success', 0.36, 0, 1], ['foldedAreas', 0.12, 0.02, 1.3]],
    /* 2 · rare */
    [['responseReceived1', 0.45, 0, 1], ['quickFixes', 0.18, 0.1, 1.05]],
    /* 3 · super rare */
    [['responseReceived2', 0.45, 0, 1], ['success', 0.24, 0.12, 1.15]],
    /* 4 · épique */
    [['codeActionApplied', 0.5, 0, 0.95], ['responseReceived3', 0.3, 0.12, 1]],
    /* 5 · ultra épique */
    [['editsKept', 0.45, 0, 0.95], ['codeActionApplied', 0.32, 0.12, 1.05], ['confetti', 0.2, 0.2, 1.1]],
    /* 6 · mythique */
    [['taskCompleted', 0.5, 0, 1], ['confetti', 0.3, 0.14, 1]],
    /* 7 · légendaire */
    [['taskCompleted', 0.55, 0, 1], ['confetti', 0.35, 0.14, 1], ['responseReceived4', 0.3, 0.3, 1]],
    /* 8 · divine et au-delà */
    [['taskCompleted', 0.55, 0, 1], ['confetti', 0.4, 0.12, 0.95], ['codeActionApplied', 0.32, 0.26, 1.05],
     ['responseReceived4', 0.34, 0.4, 1], ['terminalBell', 0.22, 0.55, 1.1]]
  ];

  const RARITY_TIER = {
    common: 0, uncommon: 1, rare: 2, superrare: 3, epic: 4, ultraepic: 5,
    mythic: 6, legendary: 7, divine: 8, secret: 8, ultrasecret: 8,
    hypersecret: 8, unique: 8
  };

  function rarity(kind) {
    if (!ready()) return;
    const tier = TIERS[RARITY_TIER[kind] == null ? 0 : RARITY_TIER[kind]];
    tier.forEach(([name, gain, delay, rate], i) => {
      play(name, { gain, delay, rate, pan: i === 0 ? 0 : (i % 2 ? 0.25 : -0.25) });
    });
  }

  /* ------------------------------------------------- jingles de booster */

  function ultraOpen() {
    play('chatUserActionRequired', { gain: 0.4, rate: 0.85 });
    play('progress', { gain: 0.35, rate: 0.7 });
    play('taskCompleted', { gain: 0.55, delay: 0.36 });
    play('confetti', { gain: 0.45, delay: 0.42 });
    play('codeActionApplied', { gain: 0.35, delay: 0.52 });
    play('responseReceived4', { gain: 0.34, delay: 0.66, pan: 0.35 });
    play('terminalBell', { gain: 0.24, delay: 0.8, pan: -0.35 });
  }

  /* Jingle d'ouverture propre à chaque booster (appelé par app.js). */
  function packOpen(type) {
    if (type === 'ultra') { ultraOpen(); return; }
    if (!ready()) return;

    if (type === 'legend') {
      // Montée « build en cours » puis grande validation + confettis.
      play('progress', { gain: 0.4, rate: 0.75 });
      play('chatUserActionRequired', { gain: 0.3, rate: 0.9, delay: 0.18 });
      play('taskCompleted', { gain: 0.55, delay: 0.42 });
      play('confetti', { gain: 0.4, delay: 0.5 });
      play('responseReceived4', { gain: 0.3, delay: 0.66, pan: 0.3 });
      play('terminalBell', { gain: 0.22, delay: 0.78, pan: -0.3 });
      return;
    }

    if (type === 'rare') {
      // Correctifs rapides puis carillon doré.
      play('quickFixes', { gain: 0.35, rate: 0.95 });
      play('responseReceived2', { gain: 0.45, delay: 0.3 });
      play('success', { gain: 0.3, rate: 1.1, delay: 0.38, pan: 0.25 });
      play('confetti', { gain: 0.22, rate: 1.15, delay: 0.44 });
      return;
    }

    if (type === 'video') {
      // Bip d'enregistrement + cloche du terminal + carillon néon.
      play('voiceRecordingStarted', { gain: 0.35, rate: 1.1 });
      play('terminalBell', { gain: 0.25, delay: 0.12, pan: -0.35 });
      play('responseReceived3', { gain: 0.45, delay: 0.32, pan: 0.3 });
      play('diffLineInserted', { gain: 0.2, rate: 1.4, delay: 0.4 });
      return;
    }

    // Classique : ampoule « action déclenchée » puis confettis.
    play('codeActionTriggered', { gain: 0.4, rate: 1 });
    play('confetti', { gain: 0.4, delay: 0.24 });
    play('success', { gain: 0.25, rate: 1.15, delay: 0.3 });
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
    /* Liste des bruitages GitHub utilisés (debug + tests). */
    get cues() { return Object.keys(CUES); },
    get soundDir() { return SOUND_DIR; },
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
    ultraOpen,
    packOpen,
    rarity
  };
})();
