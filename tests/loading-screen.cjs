// Run with NODE_PATH pointing to a local jsdom installation: node tests/loading-screen.cjs
// Vérifie l'écran de chargement d'ouverture :
//  - tant que Firebase n'a pas répondu, ni la page de connexion ni le jeu ne sont visibles ;
//  - session déjà active → le jeu s'affiche directement (jamais la page de connexion) ;
//  - pas de session → la page de connexion s'affiche ;
//  - Firebase absent, en erreur ou muet → on ne reste jamais bloqué sur le chargement.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeFirebase(firestore) {
  const state = { onChange: null };
  const auth = () => ({
    onAuthStateChanged(next) { state.onChange = next; },
    setPersistence() {},
    signOut: () => Promise.resolve(),
    getRedirectResult: () => Promise.resolve(null),
    signInWithPopup: () => new Promise(() => {})
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  const db = firestore || {
    collection: () => ({ doc: () => ({ get: () => Promise.resolve({ exists: false }), set: () => Promise.resolve() }) })
  };
  return { firebase: { apps: [], initializeApp() {}, auth, firestore: () => db }, state };
}

async function boot({ firebase = null, shrinkTimers = false } = {}) {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  if (shrinkTimers) {
    const realSetTimeout = w.setTimeout.bind(w);
    // Le délai de 8 s de l'écran de chargement est ramené à 80 ms pour le test.
    w.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms === 8000 ? 80 : ms, ...args);
  }
  const built = firebase !== null ? makeFirebase(firebase) : null;
  if (built) w.firebase = built.firebase;
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);
  const $ = (id) => w.document.getElementById(id);
  return {
    w, state: built && built.state,
    loadingShown: () => !$('loading-screen').hidden,
    loginShown: () => !$('auth-screen').hidden,
    gameShown: () => $('app').classList.contains('is-authenticated'),
    error: () => ($('auth-error').hidden ? '' : $('auth-error').textContent),
    hint: () => ($('auth-hint').hidden ? '' : $('auth-hint-text').textContent),
    coins: () => $('coins').textContent
  };
}

const saveWith = (data) => ({ collection: () => ({ doc: () => ({ get: () => Promise.resolve({ exists: true, data: () => data }), set: () => Promise.resolve() }) }) });

(async () => {
  /* 0. Au premier affichage (HTML seul) : chargement visible, connexion cachée. */
  {
    const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url: 'https://refs-cards.test/', runScripts: 'outside-only' });
    const doc = dom.window.document;
    assert.equal(doc.getElementById('loading-screen').hidden, false, 'le chargement doit être visible dès l’ouverture');
    assert.equal(doc.getElementById('auth-screen').hidden, true, 'la connexion ne doit pas apparaître avant la vérification');
    dom.window.close();
    console.log('PASS à l’ouverture : écran de chargement visible, connexion cachée');
  }

  /* 1. Session déjà active : le jeu s'ouvre, la page de connexion n'apparaît jamais. */
  {
    const ui = await boot({ firebase: saveWith({ coins: 420, firstPack: false, decoReleaseClaimed: true, collection: [] }) });
    assert.equal(ui.loadingShown(), true, 'le chargement reste visible tant que Firebase ne répond pas');
    assert.equal(ui.loginShown(), false, 'la connexion reste cachée pendant la vérification');
    assert.equal(ui.gameShown(), false);
    await ui.state.onChange({ uid: 'u1', email: 'joueur@example.test', displayName: 'Joueur' });
    await wait(60);
    assert.equal(ui.loadingShown(), false, 'le chargement doit disparaître une fois le jeu prêt');
    assert.equal(ui.loginShown(), false, 'un joueur connecté ne voit jamais la page de connexion');
    assert.equal(ui.gameShown(), true, 'le jeu doit s’afficher directement');
    assert.equal(ui.coins(), '420', 'la sauvegarde cloud doit être chargée');
    ui.w.close();
    console.log('PASS session active → le jeu directement, sans page de connexion');
  }

  /* 2. Pas de session : la page de connexion remplace le chargement. */
  {
    const ui = await boot({ firebase: {} });
    assert.equal(ui.loadingShown(), true);
    await ui.state.onChange(null);
    await wait(20);
    assert.equal(ui.loadingShown(), false, 'le chargement doit disparaître');
    assert.equal(ui.loginShown(), true, 'la page de connexion doit s’afficher');
    assert.equal(ui.gameShown(), false);
    assert.equal(ui.error(), '', 'pas de message d’erreur pour un simple visiteur');
    ui.w.close();
    console.log('PASS pas de session → page de connexion');
  }

  /* 3. Sauvegarde inaccessible : retour à la connexion avec l'explication. */
  {
    const firestore = { collection: () => ({ doc: () => ({ get: () => Promise.reject(Object.assign(new Error('x'), { code: 'permission-denied' })), set: () => Promise.resolve() }) }) };
    const ui = await boot({ firebase: firestore });
    await ui.state.onChange({ uid: 'u2', email: 'a@example.test' });
    await wait(60);
    assert.equal(ui.loadingShown(), false, 'le chargement ne doit pas rester bloqué');
    assert.equal(ui.loginShown(), true, 'retour à la page de connexion');
    assert.match(ui.error(), /Accès cloud refusé/);
    ui.w.close();
    console.log('PASS sauvegarde inaccessible → connexion avec explication, pas de blocage');
  }

  /* 4. Firebase absent : pas de chargement infini, la connexion explique le problème. */
  {
    const ui = await boot();
    assert.equal(ui.loadingShown(), false, 'le chargement doit être masqué sans Firebase');
    assert.equal(ui.loginShown(), true, 'la connexion doit s’afficher avec le message');
    assert.match(ui.error(), /scripts Firebase/);
    ui.w.close();
    console.log('PASS Firebase absent → page de connexion avec le message');
  }

  /* 5. Firebase muet : après le délai, on ouvre la connexion sans bloquer. */
  {
    const ui = await boot({ firebase: {}, shrinkTimers: true });
    assert.equal(ui.loadingShown(), true, 'avant le délai, le chargement reste visible');
    assert.equal(ui.loginShown(), false);
    await wait(160);
    assert.equal(ui.loadingShown(), false, 'le chargement doit être masqué après le délai');
    assert.equal(ui.loginShown(), true, 'la connexion doit devenir accessible après le délai');
    assert.match(ui.hint(), /plus de temps que prévu/);
    ui.w.close();
    console.log('PASS Firebase muet → connexion après le délai, sans blocage');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
