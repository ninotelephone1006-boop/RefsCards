// Run with NODE_PATH pointing to a local jsdom installation: node tests/auth-flow.cjs
// Vérifie que le bouton « Se connecter avec Google » donne TOUJOURS un retour :
// scripts Firebase absents, pop-up qui ne répond jamais, pop-up bloqué dans un
// aperçu intégré, domaine non autorisé, et connexion réussie.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeAuth(signInWithPopup, extra = {}, firestore = {}) {
  const state = { onChange: null, redirectResult: null };
  const auth = () => ({
    onAuthStateChanged(next) { state.onChange = next; },
    setPersistence() {},
    signOut: () => Promise.resolve(),
    getRedirectResult: () => Promise.resolve(state.redirectResult),
    signInWithPopup,
    ...extra
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  return { firebase: { apps: [], initializeApp() {}, auth, firestore: () => firestore }, state };
}

async function boot({ makeFirebase = null, embedded = false, fastWatchdog = false } = {}) {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  // Simule un aperçu affiché dans une iframe : self !== top.
  if (embedded) w.self = { apercu: true };
  if (fastWatchdog) {
    const realSetTimeout = w.setTimeout.bind(w);
    w.setTimeout = (fn, ms, ...args) => realSetTimeout(fn, ms >= 25000 ? 80 : ms, ...args);
  }
  const built = makeFirebase ? makeFirebase() : null;
  if (built) w.firebase = built.firebase;
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);
  const doc = w.document;
  return {
    w, doc, state: built && built.state,
    button: doc.getElementById('google-signin'),
    label: () => doc.querySelector('.google-label').textContent,
    error: () => (doc.getElementById('auth-error').hidden ? '' : doc.getElementById('auth-error').textContent),
    status: () => (doc.getElementById('auth-status').hidden ? '' : doc.getElementById('auth-status').textContent),
    hint: () => (doc.getElementById('auth-hint').hidden ? '' : doc.getElementById('auth-hint').textContent)
  };
}

(async () => {
  /* 1. Firebase absent (CDN bloqué, hors ligne, bloqueur de pub) : le bouton
     doit rester cliquable et expliquer la cause au lieu de ne rien faire. */
  {
    const ui = await boot();
    assert.equal(ui.button.disabled, false, 'le bouton doit rester cliquable');
    assert.match(ui.error(), /scripts Firebase/);
    const before = ui.error();
    ui.button.click();
    await wait(40);
    assert.equal(ui.button.disabled, false);
    assert.ok(ui.error().length > 0);
    assert.notEqual(ui.error(), '', 'un clic doit afficher une explication');
    assert.ok(before.length > 0);
    ui.w.close();
    console.log('PASS clic sans Firebase = message explicite, bouton actif');
  }

  /* 2. Pop-up qui ne se résout jamais : garde-fou → message + bouton réactivé. */
  {
    const ui = await boot({ makeFirebase: () => makeAuth(() => new Promise(() => {})), fastWatchdog: true });
    ui.button.click();
    await wait(20);
    assert.equal(ui.button.getAttribute('aria-busy'), 'true', 'un état occupé doit être visible');
    assert.match(ui.status(), /Ouverture de la fenêtre Google/);
    await wait(120);
    assert.equal(ui.button.disabled, false, 'le bouton doit être réactivé par le garde-fou');
    assert.equal(ui.button.getAttribute('aria-busy'), null);
    assert.match(ui.error(), /ne répond pas/);
    assert.equal(ui.label(), 'Se connecter avec Google');
    const secondClick = ui.button.click(); // un nouveau clic doit fonctionner
    assert.equal(secondClick, undefined);
    ui.w.close();
    console.log('PASS pop-up sans réponse = garde-fou, message, bouton réutilisable');
  }

  /* 3. Aperçu intégré (iframe) + pop-up bloqué : conseil « nouvel onglet ». */
  {
    const ui = await boot({
      embedded: true,
      makeFirebase: () => makeAuth(() => Promise.reject(Object.assign(new Error('bloqué'), { code: 'auth/popup-blocked' })))
    });
    assert.match(ui.hint(), /Aperçu intégré/, 'le contexte intégré est annoncé dès le départ');
    ui.button.click();
    await wait(60);
    assert.equal(ui.button.disabled, false);
    assert.match(ui.error(), /aperçu intégré/);
    assert.match(ui.hint(), /nouvel onglet|un onglet/);
    assert.equal(ui.doc.getElementById('auth-open-tab').href, 'https://refs-cards.test/');
    ui.w.close();
    console.log('PASS aperçu intégré = conseil clair et lien vers un onglet');
  }

  /* 4. Domaine non autorisé : le message nomme le domaine à whitelister. */
  {
    const ui = await boot({
      makeFirebase: () => makeAuth(() => Promise.reject(Object.assign(new Error('x'), { code: 'auth/unauthorized-domain' })))
    });
    ui.button.click();
    await wait(60);
    assert.match(ui.error(), /refs-cards\.test/);
    assert.match(ui.error(), /Authorized domains/);
    assert.equal(ui.button.disabled, false);
    ui.w.close();
    console.log('PASS domaine non autorisé = domaine affiché dans le message');
  }

  /* 5. Connexion réussie : statut puis écran de jeu avec la sauvegarde cloud. */
  {
    let resolvePopup;
    // Firestore minimal : la sauvegarde du joueur.
    const save = {
      exists: true,
      data: () => ({ coins: 420, firstPack: false, collection: [] })
    };
    const firestore = {
      collection: () => ({ doc: () => ({ get: () => Promise.resolve(save), set: () => Promise.resolve() }) })
    };
    const built = makeAuth(() => new Promise((resolve) => { resolvePopup = resolve; }), {}, firestore);
    const ui = await boot({ makeFirebase: () => built });
    ui.button.click();
    await wait(30);
    assert.match(ui.status(), /Ouverture de la fenêtre Google/);
    resolvePopup({ user: { uid: 'u1' } });
    await wait(30);
    assert.match(ui.status(), /Connexion réussie/);
    assert.ok(built.state.onChange, 'onAuthStateChanged doit être branché');
    await built.state.onChange({ uid: 'u1', email: 'joueur@example.test', displayName: 'Joueur' });
    await wait(60);
    assert.equal(ui.doc.getElementById('auth-screen').hidden, true, 'le jeu doit s’afficher');
    assert.ok(ui.doc.getElementById('app').classList.contains('is-authenticated'));
    assert.equal(ui.doc.getElementById('coins').textContent, '420');
    ui.w.close();
    console.log('PASS connexion réussie = statut, puis jeu affiché avec la sauvegarde');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
