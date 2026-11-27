// Run with NODE_PATH pointing to a local jsdom installation:
// node tests/ios-audio.cjs
// Vérifie le déblocage du son sur iPhone / iPad (Safari = WebKit) :
// - un AudioContext factice démarre « suspended » et ne passe « running »
//   qu'après resume(), comme sur iOS ;
// - navigator.audioSession (Safari 16.4+) reçoit type = 'playback' : les
//   bruitages sortent même avec le bouton silencieux de l'iPhone ;
// - sans audioSession (iOS plus ancien), une boucle <audio playsinline> sur un
//   WAV de silence intégré est lancée dans le geste (aucun fichier à charger) ;
// - un contexte « interrupted » (après un appel / un verrouillage) est repris ;
// - play() réveille un contexte encore suspendu au lieu de rester muet ;
// - app.js écoute touchend / pointerup / click et non plus seulement
//   pointerdown, et reprend le son visibilité / pageshow / focus.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* ------------------------------------------------------- contexte factice */

function fakeAudioContext(log) {
  return class FakeAudioContext {
    constructor() {
      this.state = 'suspended';
      this.currentTime = 0;
      this.destination = { connect() {}, disconnect() {} };
      this.sampleRate = 44100;
      log.created += 1;
    }
    resume() {
      log.resume += 1;
      // iOS : la reprise est asynchrone ; une promesse suffit.
      this.state = 'running';
      return Promise.resolve();
    }
    close() { this.state = 'closed'; }
    createDynamicsCompressor() {
      return { threshold: {}, knee: {}, ratio: {}, attack: {}, release: {}, connect() {} };
    }
    createGain() {
      return { gain: { value: 1, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    createStereoPanner() {
      return { pan: { value: 0, setValueAtTime() {}, setTargetAtTime() {}, linearRampToValueAtTime() {} }, connect() {}, disconnect() {} };
    }
    createBuffer(channels, length, rate) {
      return { duration: length / rate, numberOfChannels: channels, length };
    }
    createBufferSource() {
      const node = {
        buffer: null, loop: false, loopStart: 0, loopEnd: 0,
        playbackRate: { value: 1, setTargetAtTime() {} },
        connect() {}, disconnect() {},
        start() { log.starts += 1; },
        stop() {}
      };
      return node;
    }
  };
}

/* --------------------------------------------------------------- un runtime */

function runtime(opts) {
  const options = opts || {};
  const log = { created: 0, resume: 0, starts: 0, session: [], played: 0 };
  const html = '<!doctype html><html><body><button id="sound-btn"></button></body></html>';
  const dom = new JSDOM(html, { url: 'https://example.test/', pretendToBeVisual: true });
  const { window } = dom;

  window.AudioContext = fakeAudioContext(log);
  Object.defineProperty(window.navigator, 'userAgent', {
    value: options.ua || 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_1 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.1 Mobile/15E148 Safari/604.1',
    configurable: true
  });
  Object.defineProperty(window.navigator, 'maxTouchPoints', { value: 5, configurable: true });
  if (options.audioSession) {
    const session = {};
    Object.defineProperty(session, 'type', {
      get() { return session._type; },
      set(value) { session._type = value; log.session.push(value); }
    });
    Object.defineProperty(window.navigator, 'audioSession', { value: session, configurable: true });
  }

  // chrome de chargement des mp3 : on n'en a pas besoin ici.
  window.fetch = () => Promise.reject(new Error('réseau désactivé dans le test'));
  // `play()` d'un <audio> : accepté (le geste est réel).
  window.HTMLMediaElement.prototype.play = function play() { log.played += 1; this.paused = false; return Promise.resolve(); };
  window.HTMLMediaElement.prototype.pause = function pause() { this.paused = true; };

  const context = vm.createContext(window);
  vm.runInContext(fs.readFileSync('audio.js', 'utf8'), context);
  const Sound = vm.runInContext('Sound', context);
  return { window, Sound, log };
}

(async () => {
  /* 1. iPhone + navigator.audioSession : canal « playback » + reprise. */
  {
    const { window, Sound, log } = runtime({ audioSession: true });
    assert.equal(Sound.ios, true, 'iPhone reconnu (userAgent)');
    Sound.gesture();
    assert.equal(log.created, 1, 'un AudioContext est créé');
    assert.equal(Sound.state(), 'running', 'le contexte est repris dès le geste');
    assert.ok(log.session.includes('playback'),
      'navigator.audioSession.type = playback : le bouton silencieux ne coupe plus le son');
    assert.ok(log.starts >= 1, 'un échantillon muet est joué dans le geste (déblocage WebKit)');
    assert.ok(window.document.querySelector('audio[playsinline]'),
      'boucle muette <audio playsinline> ajoutée');
    // L'élément doit rester « audible » pour iOS (sinon pas de canal playback),
    // mais son fichier est un WAV de silence pur : aucun bruit.
    const silent = window.document.querySelector('audio[playsinline]');
    assert.equal(silent.muted, false, 'la boucle n’est pas muette (iOS exige un média audible)');
    assert.equal(silent.volume, 1, 'volume à 1 : le canal playback ne s’obtient pas à volume 0');
    assert.equal(silent.loop, true, 'la boucle tourne en continu');
    assert.ok(log.played >= 1, 'la boucle muette est lancée (play appelé)');
    // Le fichier embarqué est un vrai WAV, PCM, et ne contient que du silence.
    const uri = silent.src;
    assert.match(uri, /^data:audio\/wav;base64,/, 'WAV intégré en base64 (aucune requête réseau)');
    const wav = Buffer.from(uri.split(',')[1], 'base64');
    assert.equal(wav.slice(0, 4).toString('latin1'), 'RIFF', 'en-tête RIFF');
    assert.equal(wav.slice(8, 12).toString('latin1'), 'WAVE', 'en-tête WAVE');
    assert.equal(wav.readUInt16LE(20), 1, 'PCM non compressé');
    assert.ok(wav.readUInt32LE(24) >= 8000, 'taux d’échantillonnage exploitable');
    let deviation = 0;
    for (const byte of wav.slice(44)) deviation = Math.max(deviation, Math.abs(byte - 128));
    assert.equal(deviation, 0, '8 bits non signé 128 = silence pur');
    console.log('  boucle :', (wav.readUInt32LE(40) / wav.readUInt32LE(24)).toFixed(2), 's de silence,',
      wav.length, 'octets, aucun bruit');
    console.log('PASS iPhone + audioSession : canal playback, contexte running, boucle muette');
  }

  /* 2. iOS sans navigator.audioSession : la boucle muette suffit, sans erreur. */
  {
    const { window, Sound, log } = runtime({ audioSession: false });
    assert.equal(Sound.ios, true, 'iPhone reconnu');
    Sound.gesture();
    assert.equal(Sound.state(), 'running', 'contexte débloqué même sans audioSession');
    assert.equal(log.session.length, 0, 'aucun audioSession : rien à demander');
    assert.ok(window.document.querySelector('audio[playsinline]'),
      'la boucle silencieuse prend le relais sur iOS ancien');
    Sound.gesture(); // deuxième geste : idempotent
    assert.equal(window.document.querySelectorAll('audio[playsinline]').length, 1,
      'un seul élément <audio> réutilisé');
    console.log('PASS iOS sans audioSession : boucle muette, aucun doublon');
  }

  /* 3. Contexte « interrupted » (appel, verrouillage) : repris au geste. */
  {
    const { Sound, log } = runtime({ audioSession: false });
    Sound.gesture();
    const ac = Sound.unlock();
    ac.state = 'interrupted';           // iOS après un appel
    const before = log.resume;
    Sound.gesture();
    assert.ok(log.resume > before, 'un contexte interrupted est repris');
    assert.equal(Sound.state(), 'running', 'le son revient après un appel');

    ac.state = 'interrupted';
    Sound.tick();                       // un son demandé réveille le contexte
    assert.equal(Sound.state(), 'running', 'play/tick réveille un contexte interrupted');
    console.log('PASS contexte interrupted : repris au geste et à la lecture');
  }

  /* 4. Desktop : rien ne casse, pas de boucle muette inutile. */
  {
    const { window, Sound, log } = runtime({
      ua: 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
    });
    assert.equal(Sound.ios, false, 'desktop non identifié comme iOS');
    Sound.gesture();
    assert.equal(Sound.state(), 'running', 'desktop débloqué');
    assert.equal(window.document.querySelector('audio[playsinline]'), null,
      'aucune boucle muette hors iPhone/iPad');
    console.log('PASS desktop : déblocage normal, pas de boucle muette');
  }

  /* 5. API : gesture/state exposés, appels silencieux sans AudioContext. */
  {
    const src = fs.readFileSync('audio.js', 'utf8');
    const context = vm.createContext({});
    vm.runInContext(src, context);
    const Sound = vm.runInContext('Sound', context);
    assert.equal(typeof Sound.gesture, 'function', 'Sound.gesture exposé');
    assert.equal(typeof Sound.state, 'function', 'Sound.state exposé');
    assert.equal(Sound.state(), 'none', 'sans AudioContext, état « none »');
    Sound.gesture();
    Sound.setMuted(false);
    console.log('PASS API : gesture/state présents, aucun plantage sans AudioContext');
  }

  /* 6. app.js : gestes écoutés (pas seulement pointerdown) + retours. */
  {
    const appSrc = fs.readFileSync('app.js', 'utf8');
    for (const type of ['pointerup', 'touchend', 'click', 'keydown']) {
      assert.match(appSrc, new RegExp(`'${type}'`), `app.js écoute ${type} pour débloquer le son`);
    }
    assert.match(appSrc, /SFX\.gesture\(\)/, 'app.js appelle Sound.gesture()');
    assert.match(appSrc, /visibilitychange[\s\S]{0,200}gestureUnlock/, 'reprise au retour dans le jeu');
    assert.match(appSrc, /'pageshow'[\s\S]{0,80}gestureUnlock/, 'reprise sur pageshow (Safari)');
    assert.doesNotMatch(appSrc, /unlockOnce/, 'l’ancien déblocage « pointerdown seulement » a disparu');
    console.log('PASS app.js : touchend/pointerup/click écoutés, reprise visibilité/pageshow');
  }

  await wait(10);
  console.log('PASS audio iPhone (déblocage, canal playback, interruptions)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
