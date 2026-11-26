// Tests des classements publics et de l'annonce de leur arrivée.
// Vérifie les pages Compte et En ligne : pseudo modifiable, code ami généré,
// ajout d'ami par code, profil d'ami avec ses cartes et son marché.
// Les échanges à la demande (trades/) n'existent plus : ce test vérifie
// aussi qu'on ne peut PLUS demander une carte à un ami, et que le marché
// de l'ami s'achète depuis son profil.
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
        friends: [],
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
    trades: {}, marketListings: {}, marketOffers: {}, coinGifts: {}, coinFlips: {}
  };
}

function makeFirestore(store) {
  let nextId = 0;
  let failField = null;
  const queries = [];
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
      get: async () => {
        // Firestore vérifie la requête entière, pas uniquement les résultats.
        if (coll === 'marketListings' && field === 'sellerUid' && value !== 'me') {
          throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
        }
        return snap();
      },
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
      where: (field, op, value) => query(coll, field, value),
      orderBy: (field, direction) => ({ limit: (n) => ({ get: async () => {
        queries.push({ coll, field, direction, n });
        if (field === failField) throw new Error('offline');
        return { docs: Object.entries(store[coll]).filter(([, d]) => d[field] !== undefined)
          .sort((a, b) => b[1][field] - a[1][field] || b[0].localeCompare(a[0]))
          .slice(0, n).map(([id, d]) => ({ id, data: () => d })) };
      } }) })
    }),
    queries, fail(field) { failField = field; },
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
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(150); // loadProfile : profil + code ami + sauvegarde du profil
  return { w, doc: w.document, store, db, authState };
}


(async () => {
  const { w, doc, store, db, authState } = await boot();
  try {
    assert.equal(store.playerProfiles.me.packsOpened, 3, 'le compteur historique est publié au chargement');
    await wait(400);
    assert.equal(store.playerSaves.me.leaderboardAnnounced, true);
    assert.equal(store.playerSaves.me.notifications.filter(n => n.title.includes('classements')).length, 1);
    // Plus de vingt profils, un ancien profil sans compteur et un pseudo HTML hostile.
    for (let i = 0; i < 25; i++) store.playerProfiles['p' + i] = {
      pseudo: i === 24 ? '<img src=x onerror=alert(1)>' : 'Joueur ' + i,
      coins: 1000 + i, packsOpened: 25 - i
    };
    doc.querySelector('[data-tab="online"]').click();
    doc.querySelector('[data-online-tab="leaderboard"]').click();
    await wait(50);
    const coins = doc.getElementById('leaderboard-coins');
    const packs = doc.getElementById('leaderboard-packs');
    assert.equal(coins.querySelectorAll('li').length, 20);
    assert.equal(packs.querySelectorAll('li').length, 20);
    assert.match(coins.querySelector('li').textContent, /1\s?024/);
    assert.match(packs.querySelector('li').textContent, /Joueur 0/);
    /* Les pseudos restent du TEXTE (le pseudo HTML hostile ne crée aucun
       élément) : la seule image autorisée dans une ligne est la pastille de
       photo, qui affiche le décor équipé. */
    assert.equal(coins.querySelector('img[src="x"]'), null, 'aucun HTML injecté par un pseudo');
    coins.querySelectorAll('li').forEach((row) => {
      row.querySelectorAll('img').forEach((img) => {
        assert.match(img.className, /leaderboard-avatar|avatar-deco/,
          'une ligne ne contient que la photo et son décor');
      });
    });
    assert.deepEqual(db.queries.slice(-2).map(q => [q.coll, q.field, q.direction, q.n]), [
      ['playerProfiles', 'coins', 'desc', 20], ['playerProfiles', 'packsOpened', 'desc', 20]
    ]);
    assert.doesNotMatch(packs.textContent, /AmiJoueur/, 'ancien profil sans compteur exclu');
    store.playerProfiles.me.coins = 2000;
    store.playerProfiles.me.packsOpened = 100;
    doc.getElementById('leaderboard-refresh').click();
    await wait(30);
    assert.match(coins.querySelector('li').textContent, /Moi.*Toi/);
    assert.match(packs.querySelector('li').textContent, /100 boosters/);
    db.fail('packsOpened');
    doc.getElementById('leaderboard-refresh').click();
    await wait(30);
    assert.match(packs.textContent, /indisponible/);
    assert.match(coins.textContent, /Moi/);
    db.fail(null);
    // La notification ne réapparaît pas à la reconnexion, même lue ou évincée.
    store.playerSaves.me.notifications = [];
    await authState.onChange(null);
    await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi' });
    await wait(350);
    assert.equal(store.playerSaves.me.notifications.filter(n => n.title.includes('classements')).length, 0);
    assert.equal(store.playerProfiles.me.packsOpened, 3);
    console.log('PASS classements : top 20, publication, actualisation, échec et annonce unique');
  } finally { w.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
