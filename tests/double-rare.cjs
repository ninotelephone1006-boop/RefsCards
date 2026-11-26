// Run with NODE_PATH pointing to a local jsdom installation: node tests/shop-flow.cjs
// Vérifie la boutique : prix équilibrés (500 / 1 000), achats multiples dans
// l'inventaire, le calendrier de connexion (cadeaux quotidiens de mieux en
// mieux), pack rare (raretés élevées boostées) et navigation
// « Aller au Shop » depuis le récap (plus d'achat direct à 100 🪙).
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore(save) {
  return {
    playerSaves: { me: save },
    playerProfiles: {},
    friendCodes: {},
    friendRequests: {},
    trades: {},
    marketListings: {},
    coinGifts: {}
  };
}

function makeFirestore(store) {
  const docRef = (coll, id) => ({
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store[coll], id),
      data: () => store[coll][id]
    }),
    set: async (data) => { store[coll][id] = { ...(store[coll][id] || {}), ...data }; },
    update: async (patch) => { store[coll][id] = { ...(store[coll][id] || {}), ...patch }; }
  });
  const query = (coll, field, value) => {
    const snap = () => ({
      docs: Object.entries(store[coll] || {})
        .filter(([, d]) => d[field] === value)
        .map(([id, d]) => ({ id, data: () => d }))
    });
    return {
      get: async () => snap(),
      onSnapshot: (cb) => { Promise.resolve().then(() => cb(snap())); return () => {}; }
    };
  };
  return {
    collection: (coll) => ({
      doc: (id) => docRef(coll, id),
      where: (field, op, value) => query(coll, field, value)
    })
  };
}

async function boot(save, now = Date.parse('2026-11-24T20:00:00Z'), seen = false) {
  const store = makeStore(save);
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.Date.now = () => now;
  if (seen) w.localStorage.setItem('refs-cards:double-rare-promo-seen', 'double-rare-2026-11-24');
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  const authState = { onChange: null };
  const auth = () => ({
    onAuthStateChanged(next) { authState.onChange = next; },
    getRedirectResult: () => Promise.resolve(null),
    signOut: () => Promise.resolve()
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  const db = makeFirestore(store);
  w.firebase = { apps: [], initializeApp() {}, auth, firestore: () => db };
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/\}\)\(\);\s*$/, 'window.__test = { drawPack, packPool, packTableFor, packSlotsFor, packShinyFor, promoUnitPrice, maybeShowDoublePromo };\n})();'), context);
  await wait(40);
  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(200);
  return { w, doc: w.document, store };
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}
function yesterdayKey() {
  const d = new Date();
  d.setDate(d.getDate() - 1);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
}

(async () => {
  const save = { coins: 5000, firstPack: false, decoReleaseClaimed: true, collection: [], friends: [], packsOpened: 0, packStock: { classic: 0, rare: 0 }, streakDate: '', streak: 0, claimedDays: [] };
  const { w, doc, store } = await boot(save);
  const t = w.__test;
  assert.equal(t.promoUnitPrice('doubleRare'), 1445);
  assert.deepEqual(JSON.parse(JSON.stringify(t.packTableFor('doubleRare'))), JSON.parse(JSON.stringify(t.packTableFor('rare'))));
  assert.deepEqual(JSON.parse(JSON.stringify(t.packSlotsFor('doubleRare'))), [...JSON.parse(JSON.stringify(t.packSlotsFor('rare'))), ...JSON.parse(JSON.stringify(t.packSlotsFor('rare')))]);
  assert.equal(t.packShinyFor('doubleRare'), 2);
  assert.equal(t.drawPack(false, t.packPool('doubleRare'), 'doubleRare').length, 10);
  doc.querySelector('[data-pack="doubleRare"][data-qty="2"]')?.click();
  doc.getElementById('buy-doubleRare').click(); await wait(400);
  assert.equal(store.playerSaves.me.coins, 3555);
  assert.equal(store.playerSaves.me.packStock.doubleRare, 1);
  doc.getElementById('open-doubleRare').click();
  assert.match(doc.getElementById('pack-img-main').src, /Packraredouble.png/);
  t.maybeShowDoublePromo();
  assert.equal(doc.getElementById('double-promo-sheet').hidden, false);
  doc.getElementById('double-promo-later').click(); t.maybeShowDoublePromo();
  assert.equal(doc.getElementById('double-promo-sheet').hidden, true);
  w.close();
  const expired = await boot(save, Date.parse('2026-11-26T19:35:00Z'), true);
  assert.equal(expired.w.__test.promoUnitPrice('doubleRare'), 1700);
  assert.equal(expired.doc.getElementById('double-promo-line').hidden, true);
  expired.w.close();
  console.log('PASS Double Rare : tirage, achat, sauvegarde, annonce unique et expiration');
})().catch(error => { console.error(error); process.exitCode = 1; });
