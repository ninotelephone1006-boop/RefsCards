// Run with NODE_PATH pointing to a local jsdom installation: node tests/social-flow.cjs
// Vérifie les pages Compte et En ligne : pseudo modifiable, code ami généré,
// ajout d'ami par code, profil d'ami avec ses cartes, proposition d'échange
// et d'achat (documents trades/ créés avec les bons champs).
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore() {
  return {
    playerSaves: {
      me: {
        coins: 500,
        firstPack: false,
        collection: ['pieds-de-rapace', 'chasseur-royer'],
        friends: ['friend1'],
        packsOpened: 3
      }
    },
    playerProfiles: {
      friend1: {
        pseudo: 'AmiJoueur',
        avatar: '',
        friendCode: 'REFS-ABC123',
        coins: 50,
        totalCards: 1,
        uniqueCards: 1,
        bestRarity: 'common',
        collection: ['chasseur-royer']
      }
    },
    friendCodes: { 'REFS-ABC123': { uid: 'friend1' } },
    friendRequests: {},
    trades: {}, marketListings: {}, coinGifts: {}
  };
}

function makeFirestore(store) {
  let nextId = 0;
  const docRef = (coll, id) => ({ coll, id,
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store[coll], id),
      data: () => store[coll][id]
    }),
    set: async (data) => { store[coll][id] = { ...(store[coll][id] || {}), ...data }; },
    update: async (patch) => { store[coll][id] = { ...(store[coll][id] || {}), ...patch }; }
  });
  /* Temps réel simulé : on garde les abonnés pour pouvoir pousser une mise à
     jour (c'est ainsi que l'ami « accepte » pendant que l'onglet est ouvert). */
  const watchers = [];
  const query = (coll, field, value) => {
    const snap = () => ({
      docs: Object.entries(store[coll])
        .filter(([, d]) => d[field] === value)
        .map(([id, d]) => ({ id, data: () => d }))
    });
    return {
      get: async () => snap(),
      onSnapshot: (cb) => {
        watchers.push({ coll, cb: () => cb(snap()) });
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
    },
    // Pousse une mise à jour du store vers les abonnés onSnapshot.
    refresh(coll) {
      watchers.filter((w) => !coll || w.coll === coll).forEach((w) => w.cb());
    }
  };
}

async function boot() {
  const store = makeStore();
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
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(150); // loadProfile : profil + code ami + sauvegarde du profil
  return { w, doc: w.document, store, db };
}

function submitForm(w, form) {
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

function buttonByText(root, text) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
}

(async () => {
  const { w, doc, store } = await boot();
  const submit = async (form) => { submitForm(w, form); await wait(10); };
  const confirm = async () => { assert.equal(doc.getElementById('confirm-sheet').hidden, false); doc.getElementById('confirm-ok').click(); await wait(100); };
  doc.querySelector('[data-tab="online"]').click();
  await wait(30);
  // Une annonce réserve un exemplaire, et on peut la retirer.
  doc.getElementById('market-card').value = 'pieds-de-rapace';
  doc.getElementById('market-price').value = '123';
  await submit(doc.getElementById('market-list-form')); await confirm();
  let listing = Object.values(store.marketListings)[0];
  assert.equal(listing.price, 123); assert.equal(listing.status, 'open');
  assert.deepEqual(store.playerSaves.me.collection, ['chasseur-royer']);
  buttonByText(doc.getElementById('my-listings'), 'Retirer').click(); await wait(100);
  assert.equal(listing.status, 'open'); // mock update replaces the object
  assert.equal(Object.values(store.marketListings)[0].status, 'cancelled');
  assert.ok(store.playerSaves.me.collection.includes('pieds-de-rapace'));
  // Un cadeau est débité tout de suite, mais reste récupérable hors ligne.
  buttonByText(doc.querySelector('.friend-row'), 'Voir').click(); await wait(50);
  doc.getElementById('gift-amount').value = '75';
  await submit(doc.getElementById('gift-form')); await confirm();
  assert.equal(store.playerSaves.me.coins, 425);
  assert.equal(Object.values(store.coinGifts)[0].amount, 75);
  assert.equal(Object.values(store.coinGifts)[0].status, 'pending');
  doc.getElementById('gift-amount').value = '999';
  await submit(doc.getElementById('gift-form')); await confirm();
  assert.equal(store.playerSaves.me.coins, 425);
  assert.equal(Object.keys(store.coinGifts).length, 1);
  assert.match(doc.getElementById('market-message').textContent, /pas assez/);
  // Achat d'une annonce au prix choisi ; elle ne peut pas être achetée deux fois.
  store.marketListings.other = { sellerUid: 'friend1', cardId: 'chasseur-royer', price: 250, buyerUid: '', status: 'open' };
  doc.getElementById('market-refresh').click(); await wait(40);
  buttonByText(doc.getElementById('friend-listings'), 'Acheter').click(); await confirm();
  assert.equal(store.playerSaves.me.coins, 175);
  assert.equal(store.playerSaves.me.collection.filter(id => id === 'chasseur-royer').length, 2);
  assert.equal(store.marketListings.other.status, 'sold');
  assert.equal(store.marketListings.other.buyerUid, 'me');
  assert.match(doc.getElementById('friend-listings').textContent, /Aucune carte/);
  // Une annonce affichée puis vendue entre-temps ne débite pas l'acheteur.
  store.marketListings.stale = { sellerUid: 'friend1', cardId: 'pieds-de-rapace', price: 20, buyerUid: '', status: 'open' };
  doc.getElementById('market-refresh').click(); await wait(40);
  buttonByText(doc.getElementById('friend-listings'), 'Acheter').click();
  store.marketListings.stale.status = 'sold';
  await confirm();
  assert.equal(store.playerSaves.me.coins, 175);
  assert.equal(store.playerSaves.me.collection.filter(id => id === 'pieds-de-rapace').length, 1);
  assert.match(doc.getElementById('market-message').textContent, /plus en vente/);
  // Le prix zéro est autorisé, comme n'importe quel prix entier valide.
  doc.getElementById('market-card').value = 'pieds-de-rapace';
  doc.getElementById('market-price').value = '0';
  await submit(doc.getElementById('market-list-form')); await confirm();
  assert.ok(Object.values(store.marketListings).some(l => l.sellerUid === 'me' && l.price === 0 && l.status === 'open'));
  // Récupération des recettes et cadeaux, une seule fois.
  store.marketListings.sold = { sellerUid: 'me', cardId: 'pieds-de-rapace', price: 33, buyerUid: 'friend1', status: 'sold' };
  store.coinGifts.incoming = { fromUid: 'friend1', toUid: 'me', amount: 22, status: 'pending' };
  doc.getElementById('market-refresh').click(); await wait(50);
  const claims = [...doc.querySelectorAll('#market-inbox button')]; assert.equal(claims.length, 2);
  claims[0].click(); await wait(100);
  buttonByText(doc.getElementById('market-inbox'), 'Récupérer').click(); await wait(100);
  assert.equal(store.playerSaves.me.coins, 230);
  assert.equal(store.marketListings.sold.status, 'completed');
  assert.equal(store.coinGifts.incoming.status, 'claimed');
  assert.equal(doc.querySelectorAll('#market-inbox button').length, 0);
  w.close(); console.log('PASS marché : réservation, annulation, cadeau, achat et récupération');
})().catch(error => { console.error(error); process.exitCode = 1; });
