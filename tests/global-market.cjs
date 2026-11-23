// Run with NODE_PATH pointing to a local jsdom installation: node tests/global-market.cjs
// Vérifie le marché global : les annonces des joueurs qui ne sont PAS mes amis
// s'affichent avec le pseudo du vendeur, on peut l'ajouter en ami et acheter
// directement chez lui. On vérifie aussi le filtre, le tri et l'exclusion de
// mes propres annonces.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore() {
  return {
    playerSaves: {
      me: {
        coins: 1000,
        firstPack: false,
        collection: ['pieds-de-rapace'],
        friends: [],
        packsOpened: 0,
        packStock: { classic: 0, rare: 0, legend: 0 }
      }
    },
    playerProfiles: {
      stranger: {
        pseudo: 'VendeurInconnu',
        avatar: '',
        friendCode: 'REFS-ZZZ999',
        coins: 10,
        totalCards: 1,
        uniqueCards: 1,
        bestRarity: 'common',
        collection: ['chasseur-royer']
      }
    },
    friendCodes: { 'REFS-ZZZ999': { uid: 'stranger' } },
    friendRequests: {},
    marketListings: {
      strangerListing: { sellerUid: 'stranger', cardId: 'chasseur-royer', price: 200, buyerUid: '', status: 'open', createdAt: '2026-11-20T10:00:00.000Z' },
      mine: { sellerUid: 'me', cardId: 'pieds-de-rapace', price: 5, buyerUid: '', status: 'open', createdAt: '2026-11-21T10:00:00.000Z' },
      alreadySold: { sellerUid: 'stranger', cardId: 'pieds-de-rapace', price: 1, buyerUid: 'other', status: 'sold', createdAt: '2026-11-19T10:00:00.000Z' }
    },
    coinGifts: {}
  };
}

function makeFirestore(store) {
  let nextId = 0;
  const docRef = (coll, id) => ({
    coll,
    id,
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
      onSnapshot: (cb) => {
        Promise.resolve().then(() => cb(snap()));
        return () => {};
      }
    };
  };
  return {
    collection: (coll) => ({
      doc: (id) => docRef(coll, id || `generated${++nextId}`),
      where: (field, op, value) => query(coll, field, value)
    }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (ref) => ({ exists: !!store[ref.coll][ref.id], data: () => structuredClone(store[ref.coll][ref.id]) }),
        set: (ref, data) => writes.push(() => { store[ref.coll][ref.id] = structuredClone(data); }),
        update: (ref, data) => writes.push(() => { store[ref.coll][ref.id] = { ...store[ref.coll][ref.id], ...structuredClone(data) }; })
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    }
  };
}

async function boot(store) {
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
  return { w, doc: w.document, store, db };
}

function buttonByText(root, text) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
}

(async () => {
  /* 1. Le balisage du marché global existe dans index.html. */
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="global-market-list"/, 'liste du marché global');
  assert.match(html, /id="global-market-search"/, 'filtre du marché global');
  assert.match(html, /Marché global/, 'titre du marché global');

  /* 2. Les règles Firestore autorisent un marché ouvert (pas seulement entre amis). */
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.doesNotMatch(rules, /sellerUid in beforeSave\(\)\.friends/,
    'l’achat ne doit plus exiger que le vendeur soit un ami');
  assert.match(rules, /allow read: if signedIn\(\) && \(resource\.data\.sellerUid == request\.auth\.uid \|\| listed\(\)\)/,
    'les annonces en vente sont lisibles par tous les joueurs connectés');

  const store = makeStore();
  const { w, doc } = await boot(store);
  doc.querySelector('[data-tab="online"]').click();
  await wait(80);

  const globalBox = doc.getElementById('global-market-list');
  assert.match(globalBox.textContent, /VendeurInconnu/, 'le pseudo du vendeur non-ami est affiché');
  assert.match(globalBox.textContent, /200/, 'le prix de son annonce est affiché');
  assert.doesNotMatch(globalBox.textContent, /alreadySold|1 🪙/, 'les annonces vendues ne sont pas listées');
  assert.doesNotMatch(globalBox.textContent, /pieds de rapace|Pieds de rapace/i,
    'mes propres annonces ne sont pas listées dans le marché global');
  assert.equal(doc.getElementById('global-market-count').textContent, '1');

  /* 3. Bouton « Ajouter en ami » sur un vendeur inconnu. */
  const addBtn = buttonByText(globalBox, 'Ajouter en ami');
  assert.ok(addBtn, 'un bouton « Ajouter en ami » est proposé pour un vendeur inconnu');
  addBtn.click();
  await wait(120);
  assert.equal(Object.keys(store.friendRequests).length, 1, 'une demande d’ami est créée');
  const request = Object.values(store.friendRequests)[0];
  assert.equal(request.fromUid, 'me');
  assert.equal(request.toUid, 'stranger');
  assert.equal(request.status, 'pending');
  assert.match(doc.getElementById('global-market-list').textContent, /Demande envoyée/,
    'l’état « Demande envoyée » remplace le bouton');

  /* 4. Filtre par pseudo et par carte. */
  const search = doc.getElementById('global-market-search');
  search.value = 'inconnu';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(20);
  assert.match(globalBox.textContent, /VendeurInconnu/, 'le filtre par pseudo garde la ligne');
  search.value = 'zzz-rien';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(20);
  assert.match(globalBox.textContent, /Aucune annonce ne correspond/);
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(20);

  /* 5. Achat direct chez un joueur qui n'est pas mon ami. */
  buttonByText(globalBox, 'Acheter').click();
  await wait(20);
  assert.match(doc.getElementById('confirm-message').textContent, /VendeurInconnu/,
    'la confirmation nomme le vendeur');
  doc.getElementById('confirm-ok').click();
  await wait(200);
  assert.equal(store.playerSaves.me.coins, 800, 'les pièces sont débitées');
  assert.equal(store.playerSaves.me.collection.filter((id) => id === 'chasseur-royer').length, 1,
    'la carte achetée arrive dans ma collection');
  assert.equal(store.marketListings.strangerListing.status, 'sold');
  assert.equal(store.marketListings.strangerListing.buyerUid, 'me');
  assert.match(doc.getElementById('global-market-message').textContent, /Achat réussi/,
    'le message de résultat s’affiche dans le marché global');
  assert.doesNotMatch(doc.getElementById('global-market-list').textContent, /VendeurInconnu/,
    'l’annonce achetée disparaît du marché global');

  w.close();
  console.log('PASS marché global : vendeurs inconnus, ajout en ami, filtre et achat direct');
})().catch((error) => { console.error(error); process.exitCode = 1; });
