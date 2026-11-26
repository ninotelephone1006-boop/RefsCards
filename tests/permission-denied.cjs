// Run with NODE_PATH pointing to a local jsdom installation: node tests/permission-denied.cjs
// Reproduit le scénario « règles Firestore du projet non republiées » : la
// sauvegarde privée (playerSaves) fonctionne, mais playerProfiles /
// friendCodes / trades sont refusés (« Missing or insufficient permissions »).
// Le jeu ne doit pas planter et les messages doivent parler de RÈGLES
// Firestore, pas d'une prétendue connexion réseau.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const denied = () => Object.assign(
  new Error('Missing or insufficient permissions.'),
  { code: 'permission-denied' }
);
const rejectDenied = () => Promise.reject(denied());

function makeFirestore(store) {
  const saveDoc = {
    get: async () => ({ exists: Object.prototype.hasOwnProperty.call(store.playerSaves, 'me'), data: () => store.playerSaves.me }),
    set: async (data) => { store.playerSaves.me = { ...(store.playerSaves.me || {}), ...data }; },
    update: async (patch) => { store.playerSaves.me = { ...(store.playerSaves.me || {}), ...patch }; }
  };
  const deniedDoc = () => ({ get: rejectDenied, set: rejectDenied, update: rejectDenied });
  const deniedQuery = () => ({
    get: rejectDenied,
    onSnapshot: (onNext, onError) => {
      if (typeof onError === 'function') Promise.resolve().then(() => onError(denied()));
      return () => {};
    }
  });
  return {
    collection: (name) => (name === 'playerSaves'
      ? { doc: () => saveDoc }
      : { doc: deniedDoc, where: () => deniedQuery() })
  };
}

function makeStore() {
  return {
    playerSaves: {
      me: { coins: 100, firstPack: false, decoReleaseClaimed: true, collection: ['chasseur-royer'], friends: [], packsOpened: 1 }
    },
    playerProfiles: {},
    friendCodes: {},
    trades: {}
  };
}

(async () => {
  const store = makeStore();
  const warnings = [];
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  w.console.warn = (...args) => warnings.push(args.map(String).join(' '));

  const authState = { onChange: null };
  const auth = () => ({
    onAuthStateChanged(next) { authState.onChange = next; },
    getRedirectResult: () => Promise.resolve(null),
    signOut: () => Promise.resolve()
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  w.firebase = { apps: [], initializeApp() {}, auth, firestore: () => makeFirestore(store) };

  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(200); // loadProfile / loadTrades refusés, mais le jeu démarre

  const doc = w.document;
  assert.equal(doc.querySelectorAll('.tab').length, 7, 'le jeu démarre malgré les règles');
  assert.ok(doc.querySelector('.app').classList.contains('is-authenticated'), 'partie affichée (playerSaves lisible)');

  /* Le compte reste utilisable : les stats sont calculées localement. */
  doc.querySelector('[data-tab="account"]').click();
  await wait(30);
  assert.equal(doc.getElementById('stats-grid').children.length, 10, 'dix statistiques rendues');

  /* Le journal signale les règles, pas une « connexion ». */
  assert.ok(warnings.some((line) => /permission-denied|insuffisantes/i.test(line)), `avertissement « règles » attendu dans la console, vu : ${warnings.join(' | ')}`);

  /* Le toast indique le refus sans supposer que les règles sont obsolètes. */
  assert.match(doc.getElementById('toast').textContent, /accès cloud refusé/i, 'toast signalant le refus');
  assert.doesNotMatch(doc.getElementById('toast').textContent, /republie/i, 'ne suppose pas que les règles sont obsolètes');

  /* Ajout d'ami : message actionnable sur les règles, plus « vérifie ta connexion ». */
  doc.querySelector('[data-tab="online"]').click();
  await wait(30);
  doc.getElementById('friend-code-input').value = 'REFS-ABC123';
  doc.getElementById('add-friend-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(80);
  const msg = doc.getElementById('add-friend-msg').textContent;
  assert.match(msg, /règles/i, `le message doit parler des règles Firestore, vu : « ${msg} »`);
  assert.doesNotMatch(msg, /ta connexion/i, 'le message ne doit plus accuser la connexion');
  assert.equal(doc.querySelectorAll('.friend-row').length, 0, 'aucun ami ajouté');

  w.close();
  console.log('PASS permission-denied = règles Firestore signalées, jeu utilisable, pas de crash');
})().catch((error) => { console.error(error); process.exitCode = 1; });
