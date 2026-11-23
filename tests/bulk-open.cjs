// Run with NODE_PATH pointing to a local jsdom installation: node tests/bulk-open.cjs
// Vérifie l'ouverture éclair : un appui long de 2 s sur une carte de
// l'inventaire ouvre TOUS les packs de ce type d'un coup (ou le bouton ⚡),
// crédite les cartes et les pièces immédiatement, persiste l'inventaire et
// affiche la grille des cartes en grand. Un appui trop court ou un simple
// clic sur « Ouvrir un pack » ne déclenche pas l'ouverture groupée.
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
      docs: Object.entries(store[coll])
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

async function boot(save) {
  const store = makeStore(save);
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
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);
  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(200);
  return { w, doc: w.document, store };
}

/* jsdom n'implémente pas toujours PointerEvent : un Event enrichi suffit. */
function pointerEvent(w, type, props = {}) {
  const ev = new w.Event(type, { bubbles: true, cancelable: true });
  ev.pointerId = 1;
  ev.pointerType = 'touch';
  ev.clientX = 10;
  ev.clientY = 10;
  ev.button = 0;
  Object.assign(ev, props);
  return ev;
}

function coinsOf(doc) {
  return Number(doc.getElementById('coins').textContent.replace(/[^\d]/g, ''));
}

(async () => {
  /* 0. Fichiers / marquage : l'overlay et l'appui long sont bien branchés. */
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="bulk-open"/, 'overlay d’ouverture éclair présent');
  assert.match(html, /id="bulk-grid"/, 'grille de cartes présente');
  const appSrc = fs.readFileSync('app.js', 'utf8');
  assert.match(appSrc, /BULK_PRESS_MS\s*=\s*2000/, 'appui long de 2 s');
  assert.match(appSrc, /data-bulk-open/, 'bouton ⚡ rendu dans l’inventaire');
  assert.match(appSrc, /function bulkOpenPacks/, 'ouverture groupée implémentée');
  assert.match(appSrc, /startBulkPress/, 'appui long branché sur l’inventaire');
  console.log('PASS marquage : overlay, grille, appui long 2 s, bouton ⚡');

  /* 1. Appui long 2 s : les 3 packs classiques s'ouvrent d'un coup. */
  {
    const { w, doc, store } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 3, rare: 0, legend: 0, video: 0 },
      streakDate: '', streak: 0, claimedDays: []
    });
    doc.querySelector('[data-tab="inventory"]').click();
    await wait(20);
    assert.equal(doc.getElementById('app').dataset.tab, 'inventory');
    const card = doc.querySelector('#inventory-grid .inventory-card');
    assert.ok(card, 'carte de pack affichée');
    assert.equal(card.dataset.packType, 'classic');
    assert.match(card.textContent, /×3/, 'quantité affichée');
    assert.ok(card.querySelector('[data-bulk-open]'), 'bouton ⚡ présent');
    assert.match(card.querySelector('[data-bulk-open]').textContent, /OUVRIR LES 3 D'UN COUP/);
    assert.match(card.textContent, /maintiens 2 s/i, 'astuce d’appui long affichée');

    /* Appui long : la barre de progression apparaît tout de suite. */
    card.dispatchEvent(pointerEvent(w, 'pointerdown'));
    assert.ok(card.classList.contains('is-holding'), 'appui en cours signalé');
    await wait(2100);
    assert.equal(card.classList.contains('is-holding'), false, 'appui terminé');
    const overlay = doc.getElementById('bulk-open');
    assert.equal(overlay.hidden, false, 'overlay d’ouverture éclair ouvert');
    assert.match(doc.getElementById('bulk-title').textContent, /3 packs classiques ouverts/i);
    const tiles = doc.querySelectorAll('#bulk-grid .bulk-tile');
    assert.equal(tiles.length, 15, '3 packs × 5 cartes affichées en grand');
    assert.ok(tiles[0].querySelector('.cf'), 'les cartes utilisent le cadre de carte');
    await wait(400); // sauvegarde différée (250 ms)
    assert.equal(store.playerSaves.me.packStock.classic, 0, 'stock vidé et persisté');
    assert.equal(store.playerSaves.me.packsOpened, 3, '3 packs comptés pour les quêtes');
    assert.equal(store.playerSaves.me.collection.length, 15, '15 cartes ajoutées à la collection');
    assert.ok(coinsOf(doc) > 0, 'pièces créditées d’un coup');
    assert.match(doc.getElementById('bulk-summary').textContent, /🪙/);
    assert.equal(doc.getElementById('tab-badge-inventory').hidden, true, 'plus de packs = plus de pastille');
    w.dispatchEvent(pointerEvent(w, 'pointerup'));
    /* Fermeture : overlay masqué, grille nettoyée. */
    doc.getElementById('bulk-close').click();
    await wait(260);
    assert.equal(overlay.hidden, true, 'overlay refermé');
    assert.equal(doc.querySelectorAll('#bulk-grid .bulk-tile').length, 0, 'grille nettoyée');
    w.close();
    console.log('PASS appui long 2 s : 3 packs ouverts d’un coup, butin crédité et persisté');
  }

  /* 2. Appui trop court : rien ne s'ouvre (le clic de relâchement est ignoré). */
  {
    const { w, doc, store } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 2, rare: 0, legend: 0, video: 0 },
      streakDate: '', streak: 0, claimedDays: []
    });
    doc.querySelector('[data-tab="inventory"]').click();
    await wait(20);
    const card = doc.querySelector('#inventory-grid .inventory-card');
    card.dispatchEvent(pointerEvent(w, 'pointerdown'));
    await wait(120);
    w.dispatchEvent(pointerEvent(w, 'pointerup'));
    await wait(2100);
    assert.equal(doc.getElementById('bulk-open').hidden, true, 'pas d’ouverture groupée sur un appui court');
    assert.equal(doc.querySelectorAll('#bulk-grid .bulk-tile').length, 0, 'aucune carte révélée');
    assert.equal(store.playerSaves.me.packStock.classic, 2, 'stock intact');
    assert.equal(store.playerSaves.me.collection.length, 0, 'collection intacte');
    w.close();
    console.log('PASS appui court : aucune ouverture groupée');
  }

  /* 3. Bouton ⚡ : équivalent clavier/accessibilité de l'appui long. */
  {
    const { w, doc, store } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 0, rare: 2, legend: 0, video: 0 },
      streakDate: '', streak: 0, claimedDays: []
    });
    doc.querySelector('[data-tab="inventory"]').click();
    await wait(20);
    const bulkBtn = doc.querySelector('#inventory-grid [data-bulk-open="rare"]');
    assert.ok(bulkBtn, 'bouton ⚡ du pack rare');
    bulkBtn.click();
    await wait(60);
    assert.equal(doc.getElementById('bulk-open').hidden, false, 'overlay ouvert au clic');
    assert.match(doc.getElementById('bulk-title').textContent, /2 packs rares ouverts/i);
    assert.equal(doc.querySelectorAll('#bulk-grid .bulk-tile').length, 10, '2 packs rares × 5 cartes');
    assert.match(doc.getElementById('bulk-pack-count').textContent, /×2/);
    await wait(400); // sauvegarde différée
    assert.equal(store.playerSaves.me.packStock.rare, 0, 'stock rare vidé');
    w.close();
    console.log('PASS bouton ⚡ : ouverture groupée sans appui long');
  }

  /* 4. Le simple clic sur « Ouvrir un pack » garde l'ouverture classique. */
  {
    const { w, doc, store } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 2, rare: 0, legend: 0, video: 0 },
      streakDate: '', streak: 0, claimedDays: []
    });
    doc.querySelector('[data-tab="inventory"]').click();
    await wait(20);
    doc.querySelector('#inventory-grid [data-open-pack="classic"]').click();
    await wait(30);
    assert.equal(doc.getElementById('app').dataset.tab, 'pack', 'retour à l’onglet Pack');
    assert.equal(doc.getElementById('bulk-open').hidden, true, 'pas d’ouverture groupée');
    assert.equal(store.playerSaves.me.packStock.classic, 2, 'le pack n’est consommé qu’à la déchirure');
    w.close();
    console.log('PASS clic normal : ouverture classique, stock inchangé');
  }

  /* 5. Appui long 2 s sur le gros booster (onglet Pack) : tout le stock
        du type affiché s'ouvre d'un coup. */
  {
    const { w, doc, store } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 2, rare: 0, legend: 0, video: 0 },
      streakDate: '', streak: 0, claimedDays: []
    });
    const packArea = doc.getElementById('pack-area');
    assert.match(doc.getElementById('pack-bulk-hint').textContent, /maintiens 2 s/i,
      'astuce d’appui long visible sous le booster');
    packArea.dispatchEvent(pointerEvent(w, 'pointerdown'));
    await wait(120);
    assert.ok(doc.getElementById('pack').classList.contains('is-holding-pack'), 'appui long en cours sur le booster');
    await wait(2000);
    assert.equal(doc.getElementById('bulk-open').hidden, false, 'ouverture éclair depuis l’onglet Pack');
    assert.equal(doc.querySelectorAll('#bulk-grid .bulk-tile').length, 10, '2 packs classiques × 5 cartes');
    assert.equal(doc.getElementById('pack').classList.contains('is-holding-pack'), false, 'appui long terminé');
    await wait(400);
    assert.equal(store.playerSaves.me.packStock.classic, 0, 'stock vidé');
    w.close();
    console.log('PASS appui long sur le gros booster : tout le stock ouvert d’un coup');
  }

  console.log('Tous les tests d’ouverture éclair passent.');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
