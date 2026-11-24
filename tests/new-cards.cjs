// Ajouté pour l'annonce « Nouvelles cartes » : détection du catalogue,
// animation des cartes grisées numérotées, badge dans la collection et
// fermeture sans effet de bord sur les pièces / cartes / packs.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const CATALOG_KEY = 'refs-cards:catalog-seen';
const NEW_IDS = ['carte-test-arrivee-1', 'carte-test-arrivee-2'];

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

async function boot({ seen, extraIds = [] } = {}) {
  const store = makeStore({
    coins: 1234, firstPack: false, collection: [], friends: [], packsOpened: 0,
    packStock: { classic: 1, rare: 0 }, streakDate: '', streak: 0, claimedDays: []
  });
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  if (seen !== undefined) w.localStorage.setItem(CATALOG_KEY, seen);

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
  // Nouvelles cartes « ajoutées par le propriétaire du jeu » entre deux visites.
  if (extraIds.length) {
    vm.runInContext(`
      cardsDatabase.push(...${JSON.stringify(extraIds)}.map((id) => ({
        id, name: id, description: 'Nouvelle carte de test', rarity: 'common',
        emoji: '✦', color: '#cccccc'
      })));
    `, context);
  }
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);
  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(80);
  return { w, doc: w.document, store, catalogSize: vm.runInContext('cardsDatabase.length', context) };
}

(async () => {
  const css = fs.readFileSync('styles.css', 'utf8');
  assert.match(css, /@keyframes newcard-deal/, 'animation d’arrivée des vignettes');
  assert.match(css, /prefers-reduced-motion[\s\S]*newcard-tile/,
    'l’animation doit être désactivée si le joueur préfère moins de mouvements');

  /* 1. Première visite : on apprend le catalogue, aucune annonce. */
  const first = await boot();
  const firstSeen = first.w.localStorage.getItem(CATALOG_KEY);
  assert.ok(firstSeen, 'le catalogue connu doit être mémorisé');
  assert.equal(JSON.parse(firstSeen).length, first.catalogSize);
  assert.equal(first.doc.getElementById('new-cards-sheet').hidden, true, 'aucune annonce à la 1re visite');
  assert.equal(first.doc.querySelectorAll('#coll-grid .catalog-new').length, 0);
  assert.equal(first.doc.getElementById('coins').textContent.replace(/\s/g, ''), '1234', 'solde inchangé');
  first.w.close();

  /* 2. Deux cartes ajoutées au catalogue : annonce animée, en gris et
        numérotée, badge dans la collection, fermeture sans effet de bord. */
  const second = await boot({ seen: firstSeen, extraIds: NEW_IDS });
  const sheet = second.doc.getElementById('new-cards-sheet');
  assert.equal(sheet.hidden, false, 'l’annonce doit s’ouvrir au retour dans le jeu');
  assert.match(second.doc.getElementById('new-cards-title').textContent, /Nouvelles cartes/);
  assert.match(second.doc.getElementById('new-cards-desc').textContent, /2 nouvelles cartes/);
  const tiles = [...second.doc.querySelectorAll('#new-cards-grid .newcard-tile')];
  assert.equal(tiles.length, 2, 'une vignette par nouvelle carte');
  tiles.forEach((tile, i) => {
    assert.equal(tile.querySelector('.lock-q').textContent, '???', 'identité masquée');
    const num = String(second.catalogSize - 1 + i).padStart(3, '0');
    assert.equal(tile.querySelector('.lock-n').textContent, `N° ${num}`, 'numéro de catalogue affiché');
    assert.match(tile.querySelector('.newcard-flag').textContent, /NOUVEAU/);
  });
  assert.ok(!tiles.map((t) => t.textContent).join(' ').includes('carte-test-arrivee'),
    'le nom de la carte ne doit pas être révélé');
  assert.equal(second.doc.querySelectorAll('#coll-grid .catalog-new').length, 2,
    'les nouvelles cases de la collection sont signalées');
  assert.equal(second.doc.getElementById('coins').textContent.replace(/\s/g, ''), '1234',
    'aucune pièce débitée ou offerte par l’annonce');
  second.doc.getElementById('new-cards-later').click();
  assert.equal(sheet.hidden, true, '« Plus tard » ferme l’annonce');
  assert.equal(second.doc.getElementById('app').dataset.tab, 'pack', '« Plus tard » ne change pas d’onglet');
  const secondSeen = second.w.localStorage.getItem(CATALOG_KEY);
  assert.equal(JSON.parse(secondSeen).length, second.catalogSize);
  second.w.close();

  /* 3. La même visite suivante ne rejoue pas l'annonce. */
  const third = await boot({ seen: secondSeen, extraIds: NEW_IDS });
  assert.equal(third.doc.getElementById('new-cards-sheet').hidden, true, 'annonce jouée une seule fois');
  third.w.close();

  /* 4. Une carte de plus : le bouton principal mène à la collection. */
  const fourth = await boot({ seen: secondSeen, extraIds: [...NEW_IDS, 'carte-test-arrivee-3'] });
  assert.equal(fourth.doc.getElementById('new-cards-sheet').hidden, false);
  assert.equal(fourth.doc.querySelectorAll('#new-cards-grid .newcard-tile').length, 1,
    'seule la carte réellement nouvelle est annoncée');
  fourth.doc.getElementById('new-cards-see').click();
  assert.equal(fourth.doc.getElementById('new-cards-sheet').hidden, true);
  assert.equal(fourth.doc.getElementById('app').dataset.tab, 'collection', 'bouton principal : voir la collection');
  assert.equal(fourth.doc.querySelectorAll('#coll-grid .catalog-new').length, 1);
  fourth.w.close();

  console.log('PASS nouvelles cartes : détection, annonce animée grise/numérotée, badge collection, une seule fois, aucun effet sur le solde');
})().catch((error) => { console.error(error); process.exitCode = 1; });
