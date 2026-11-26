// Run with NODE_PATH pointing to a local jsdom installation: node tests/legacy-save-cleanup.cjs
// Reproduit le cas « tout est à jour, mais l'accès cloud est refusé » :
// une ancienne sauvegarde contient encore `freeDate` / `freeUsed`
// (« 3 gratuits/jour », remplacés depuis par streakDate/streak/claimedDays).
// Les règles Firestore (hasOnly) jugent le document FUSIONNÉ : la présence de
// ces clés fait refuser chaque set merge, même si l'app et les règles sont à
// jour. Le jeu doit supprimer ces champs au chargement (FieldValue.delete) ;
// le compteur de sauvegarde ne doit plus se bloquer.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const DELETE = Object.freeze({ __refsDelete: true });

/* Clés autorisées dans playerSaves/{uid} par les règles AVANT ce correctif
   (freeDate/freeUsed absents) : c'est ce jeu de clés que le client doit
   finir par respecter en supprimant les champs hérités, sans attendre la
   republication des règles. */
const STRICT_SAVE_KEYS = ['coins', 'firstPack', 'collection', 'friends',
  'packsOpened', 'packStock', 'decoOwned', 'decoEquipped', 'streakDate', 'streak', 'claimedDays',
  'fusions', 'packsBought', 'freePacks', 'marketSales', 'marketEarned',
  'marketBuys', 'xp', 'quests', 'questBaseline', 'achievements',
  'notifications', 'leaderboardAnnounced', 'updatedAt'];

function denied() {
  return Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
}

function makeStore() {
  return {
    playerSaves: {
      me: {
        coins: 1234,
        firstPack: false,
        collection: ['chasseur-royer'],
        friends: [],
        packsOpened: 5,
        packStock: { classic: 2, rare: 0, legend: 0, video: 0 },
        /* Clés héritées d'une ancienne version : elles empoisonnent
           chaque écriture merge tant qu'elles sont présentes. */
        freeDate: '2024-05-01',
        freeUsed: 2,
        updatedAt: 'SERVER_TIMESTAMP'
      }
    },
    playerProfiles: {},
    friendCodes: {},
    friendRequests: {},
    marketListings: {},
    coinGifts: {}
  };
}

/* Mock Firestore qui applique le hasOnly des règles sur le document
   FUSIONNÉ (comportement réel de set(..., {merge: true})) : toute clé
   héritée fait échouer l'écriture avec permission-denied. */
function makeFirestore(store) {
  const deniedError = () => denied();
  const applyWrite = (target, data) => {
    const merged = { ...(target || {}) };
    for (const [key, value] of Object.entries(data)) {
      if (value && value.__refsDelete) delete merged[key];
      else merged[key] = value;
    }
    for (const key of Object.keys(merged)) {
      /* STRICT_SAVE_KEYS ne contient pas les champs hérités : si le merge
         les conserve, l'écriture est refusée (comme avec les règles actuelles). */
      if (!STRICT_SAVE_KEYS.includes(key)) throw deniedError();
    }
    return merged;
  };
  const docRef = (coll, id) => ({
    coll,
    id,
    async get() {
      return {
        exists: Object.prototype.hasOwnProperty.call(store[coll], id),
        data: () => store[coll][id]
      };
    },
    async set(data) {
      if (coll === 'playerSaves') store[coll][id] = applyWrite(store[coll][id], data);
      else store[coll][id] = { ...(store[coll][id] || {}), ...data };
    },
    async update(patch) {
      if (coll === 'playerSaves') store[coll][id] = applyWrite(store[coll][id], patch);
      else store[coll][id] = { ...(store[coll][id] || {}), ...patch };
    }
  });
  const query = (coll, field, value) => ({
    get: async () => ({
      docs: Object.entries(store[coll] || {})
        .filter(([, d]) => d[field] === value)
        .map(([id, d]) => ({ id, data: () => d }))
    }),
    onSnapshot: (onNext) => {
      Promise.resolve().then(() => onNext({
        docs: Object.entries(store[coll] || {})
          .filter(([, d]) => d[field] === value)
          .map(([id, d]) => ({ id, data: () => d }))
      }));
      return () => {};
    }
  });
  return {
    collection: (coll) => ({
      doc: (id) => docRef(coll, id),
      where: (field, op, value) => query(coll, field, value)
    }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (ref) => ({ exists: !!(store[ref.coll] || {})[ref.id], data: () => structuredClone(store[ref.coll][ref.id]) }),
        set: (ref, data) => writes.push(() => { store[ref.coll][ref.id] = structuredClone(data); }),
        update: (ref, data) => writes.push(() => {
          if (ref.coll === 'playerSaves') store[ref.coll][ref.id] = applyWrite(store[ref.coll][ref.id], structuredClone(data));
          else store[ref.coll][ref.id] = { ...(store[ref.coll][ref.id] || {}), ...structuredClone(data) };
        })
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    }
  };
}

(async () => {
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
    signOut: () => { authState.signedOut = true; return Promise.resolve(); }
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  const db = makeFirestore(store);
  db.FieldValue = undefined; // posée sur firebase.firestore ci-dessous (SDK compat)
  const firestore = () => db;
  firestore.FieldValue = {
    serverTimestamp: () => 'SERVER_TIMESTAMP',
    delete: () => DELETE
  };
  w.firebase = { apps: [], initializeApp() {}, auth, firestore };

  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(250); // le nettoyage des champs hérités part juste après applySave

  /* 1. Le document cloud a été débarrassé des clés héritées. */
  assert.ok(!Object.prototype.hasOwnProperty.call(store.playerSaves.me, 'freeDate'),
    'freeDate supprimé du document cloud');
  assert.ok(!Object.prototype.hasOwnProperty.call(store.playerSaves.me, 'freeUsed'),
    'freeUsed supprimé du document cloud');
  /* 2. Les données du joueur sont intactes. */
  assert.equal(store.playerSaves.me.coins, 1234, 'pièces conservées');
  /* Objets venus du contexte vm : prototype différent, on compare champ à champ. */
  assert.equal(store.playerSaves.me.packStock.classic, 2, 'stock classique conservé');
  assert.equal(store.playerSaves.me.packStock.rare, 0, 'stock rare conservé');
  assert.equal(store.playerSaves.me.packStock.legend, 0, 'stock légendaire conservé');
  assert.equal(store.playerSaves.me.packStock.video, 0, 'stock vidéo conservé');

  /* 3. Une sauvegarde déclenchée ensuite (ici via la déconnexion) aboutit :
     l'écriture n'est pas refusée par les règles. */
  const logout = w.document.getElementById('logout-btn');
  assert.ok(logout, 'bouton Déconnexion présent');
  logout.click();
  await wait(150);
  assert.equal(authState.signedOut, true, 'la déconnexion aboutit (la sauvegarde préalable réussit)');
  assert.doesNotMatch(w.document.getElementById('toast').textContent, /accès cloud refusé/i,
    'aucun toast « Accès cloud refusé » pour une sauvegarde à jour');

  /* 4. Les règles tolèrent désormais les clés héritées (défense en profondeur,
     comme questBaseline) : même un document pas encore nettoyé est accepté. */
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /'updatedAt', 'freeDate', 'freeUsed'\]\)/, 'hasOnly tolère freeDate/freeUsed');
  assert.match(rules, /freeDate[\s\S]*?freeUsed/, 'bloc de tolérance freeDate/freeUsed présent');

  w.close();
  console.log('PASS legacy-save-cleanup = champs hérités supprimés du cloud, sauvegarde à jour acceptée');
})().catch((error) => { console.error(error); process.exitCode = 1; });
