// Run with NODE_PATH pointing to a local jsdom installation: node tests/read-budget.cjs
// Vérifie le budget de LECTURES Firestore (plan gratuit : 50 000 lectures/jour) :
// - le temps réel (onSnapshot) n'est PAS branché à la connexion ;
// - rouvrir « En ligne » ne relit pas le marché global une deuxième fois ;
// - afficher un ami puis un AUTRE ami ne relit pas toutes les annonces ;
// - l'onglet du navigateur caché ferme les écoutes temps réel ;
// - le quota épuisé (resource-exhausted) donne un message « quota », pas
//   « règles Firestore », quand on envoie des pièces.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Chaque annonce ouverte lue = 1 lecture facturée : c'est ce compteur qu'on
   surveille. Un abonnement onSnapshot non plus (il est facturé à chaque
   changement), d'où `attached`. */
const reads = { listings: 0, queryReads: 0, docs: 0, attached: 0, socialAttached: 0, detached: 0 };
/* Compteur détaillé (collection + filtre) pour dire précisément ce qui est relu. */
const byQuery = new Map();
/* Collections du réseau social : ce sont elles qui coûtaient des lectures en
   temps réel. La déco (playerProfiles du créateur) n'est écoutée qu'une fois. */
const SOCIAL = new Set(['marketListings', 'coinGifts', 'marketOffers', 'friendRequests', 'coinFlips']);

function makeStore(listings = 12) {
  const marketListings = {};
  for (let i = 0; i < listings; i++) {
    marketListings['l' + i] = {
      sellerUid: `f${i % 3}`, cardId: 'chasseur-royer', price: 100 + i, status: 'open'
    };
  }
  return {
    playerSaves: {
      me: {
        coins: 900, firstPack: false, decoReleaseClaimed: true,
        collection: ['pieds-de-rapace', 'chasseur-royer'],
        friends: ['f0', 'f1', 'f2'],
        packsOpened: 3, packStock: { classic: 2, rare: 1, legend: 0 }
      }
    },
    playerProfiles: {
      me: { pseudo: 'Moi', friendCode: 'REFS-ABC123', collection: ['pieds-de-rapace'] },
      f0: { pseudo: 'Ami zéro', collection: [] },
      f1: { pseudo: 'Ami un', collection: [] },
      f2: { pseudo: 'Ami deux', collection: [] }
    },
    friendCodes: { 'REFS-ABC123': { uid: 'me' } },
    friendRequests: {}, trades: {}, marketListings, marketOffers: {}, coinGifts: {}, coinFlips: {}
  };
}

function makeFirestore(store, { failMarket = null } = {}) {
  let nextId = 0;
  const docRef = (coll, id) => ({
    get: async () => {
      reads.docs++;
      return {
        exists: Object.prototype.hasOwnProperty.call(store[coll], id),
        data: () => store[coll][id]
      };
    },
    set: async (data) => { store[coll][id] = { ...(store[coll][id] || {}), ...data }; },
    update: async (patch) => { store[coll][id] = { ...(store[coll][id] || {}), ...patch }; }
  });
  const query = (coll, field, value) => {
    const snap = () => {
      const docs = Object.entries(store[coll])
        .filter(([, d]) => d[field] === value)
        .map(([id, d]) => ({ id, data: () => d }));
      return { docs, size: docs.length };
    };
    /* Une requête `.get()` est facturée par document renvoyé ; une émission
       d'onSnapshot n'est PAS une lecture (seul le premier instantané l'est).
       On distingue donc les deux dans le compteur. */
    const count = (s, { billable = true } = {}) => {
      if (billable) {
        reads.queryReads++;
        const key = `${coll}.${field}==${String(value).slice(0, 12)}`;
        byQuery.set(key, (byQuery.get(key) || 0) + 1);
        if (field === 'status') reads.listings += s.docs.length;
      }
      return s;
    };
    return {
      get: async () => {
        if (failMarket && coll === 'marketListings') {
          throw Object.assign(new Error('Quota exceeded.'), { code: 'resource-exhausted' });
        }
        return count(snap());
      },
      onSnapshot: (cb) => {
        reads.attached++;
        if (SOCIAL.has(coll)) reads.socialAttached++;
        // L'instantané initial d'un abonnement est facturé comme une lecture ;
        // les mises à jour suivantes aussi (une par document changé).
        Promise.resolve().then(() => cb(count(snap(), { billable: false })));
        return () => { reads.detached++; };
      }
    };
  };
  return {
    collection: (coll) => ({
      doc: (id) => docRef(coll, id || `g${++nextId}`),
      where: (field, op, value) => query(coll, field, value)
    }),
    async runTransaction(fn) {
      if (failMarket) {
        throw Object.assign(new Error('Quota exceeded.'), { code: 'resource-exhausted' });
      }
      const writes = [];
      const tx = {
        get: async (ref) => {
          reads.docs++;
          return { exists: true, data: () => structuredClone(store[ref.coll][ref.id]) };
        },
        set: (ref, data) => writes.push(() => { store[ref.coll][ref.id] = structuredClone(data); }),
        update: (ref, data) => writes.push(() => { store[ref.coll][ref.id] = { ...store[ref.coll][ref.id], ...structuredClone(data) }; })
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    }
  };
}

async function boot({ store = makeStore(), failMarket = null } = {}) {
  byQuery.clear();
  reads.listings = 0; reads.queryReads = 0; reads.docs = 0; reads.attached = 0; reads.socialAttached = 0; reads.detached = 0;
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
  const db = makeFirestore(store, { failMarket });
  w.firebase = { apps: [], initializeApp() {}, auth, firestore: () => db };

  const context = dom.getInternalVMContext();
  for (const file of ['firebase-config.js', 'cards.js', 'quests.js', 'audio.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  }
  await wait(40);
  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(250);
  return { w, doc: w.document, store };
}

function setHidden(w, hidden) {
  Object.defineProperty(w.document, 'hidden', { configurable: true, get: () => hidden });
  Object.defineProperty(w.document, 'visibilityState', { configurable: true, get: () => (hidden ? 'hidden' : 'visible') });
  w.document.dispatchEvent(new w.Event('visibilitychange'));
}

(async () => {
  /* 1. À la connexion, aucun temps réel ni marché global : on ne lit que la
     sauvegarde, le profil, les demandes et les défis (documents isolés). */
  const { w, doc } = await boot();
  assert.equal(reads.socialAttached, 0, 'aucune écoute temps réel du réseau social à la connexion');
  assert.equal(reads.listings, 0, 'le marché global n’est pas lu à la connexion');
  doc.querySelector('[data-tab="online"]').click();
  await wait(200);
  assert.equal(reads.listings, 12, 'une seule lecture du marché à la première ouverture');
  assert.ok(reads.socialAttached > 0, 'temps réel branché quand « En ligne » est affiché');
  console.log('PASS connexion sans temps réel, marché lu une seule fois à l’ouverture');

  /* 2. Quitter puis revenir tout de suite : pas de nouvelle lecture des
     annonces (cache de 2 minutes) et les écoutes sont rebranchées. */
  const before = reads.listings;
  const attachedBefore = reads.socialAttached;
  doc.querySelector('[data-tab="pack"]').click();
  await wait(30);
  assert.ok(reads.detached >= 6, 'les écoutes sont fermées en quittant « En ligne »');
  doc.querySelector('[data-tab="online"]').click();
  await wait(200);
  assert.equal(reads.listings, before, 'rouvrir « En ligne » ne relit pas les annonces');
  assert.ok(reads.socialAttached > attachedBefore, 'les écoutes reviennent à la réouverture');
  console.log('PASS rouvrir « En ligne » : temps réel repris sans relire le marché');

  /* 3. Fiche d'un ami puis d'un autre : la liste partagée évite une requête
     par fiche. */
  const visitFriend = async (index) => {
    const row = doc.querySelectorAll('.friend-row')[index];
    const view = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('Voir'));
    view.click();
    await wait(150);
  };
  const queriesBefore = reads.queryReads;
  byQuery.clear();
  await visitFriend(0);
  await visitFriend(1);
  const extraListings = [...byQuery.keys()].filter((k) => k.startsWith('marketListings.status')).length;
  assert.ok(extraListings <= 1, `au plus une relecture des annonces (déclenchée une seule fois) : ${[...byQuery.keys()].join(', ')}`);
  assert.ok(![...byQuery.keys()].some((k) => k.startsWith('marketListings.sellerUid')),
    `aucune requête « mes ventes » par fiche d’ami : ${[...byQuery.keys()].join(', ')}`);
  assert.match(doc.getElementById('friend-listings').textContent, /Aucune annonce|Chasseur/);
  console.log('PASS fiche d’ami : aucune lecture d’annonce supplémentaire');

  /* 4. Onglet du navigateur caché : le jeu ferme les écoutes (plus de lectures
     facturées pendant que le joueur est ailleurs). */
  const attachedWhenHidden = reads.socialAttached;
  setHidden(w, true);
  await wait(50);
  assert.ok(reads.detached >= 6, 'les écoutes sont fermées en arrière-plan');
  setHidden(w, false);
  await wait(200);
  assert.ok(reads.socialAttached > attachedWhenHidden, 'les écoutes reprennent au retour');
  w.close();
  console.log('PASS arrière-plan : écoutes fermées, reprises au retour dans le jeu');

  /* 4 bis. Retour dans le jeu depuis un autre onglet : une relecture des
     demandes/défis (petites requêtes), et pas deux si focus + visibilité
     arrivent ensemble. */
  {
    const back = await boot();
    const queriesAtLogin = reads.queryReads;
    back.doc.querySelector('[data-tab="collection"]').click();
    await wait(30);
    back.doc.dispatchEvent(new back.w.Event('visibilitychange'));
    back.w.dispatchEvent(new back.w.Event('focus'));
    await wait(250);
    const extra = reads.queryReads - queriesAtLogin;
    assert.ok(extra <= 4, `relecture groupée au retour dans le jeu (${extra} requêtes)`);
    assert.equal(reads.socialAttached, 0, 'pas de temps réel quand « En ligne » n’est pas affiché');
    back.w.close();
    console.log('PASS retour dans le jeu : relecture unique, sans temps réel');
  }

  /* 5. Quota gratuit épuisé : « envoyer des pièces » affiche le quota, pas un
     problème de règles (c'est le message qui faisait croire à un bug). */
  const failing = await boot({ failMarket: 'resource-exhausted' });
  const fdoc = failing.doc;
  fdoc.querySelector('[data-tab="online"]').click();
  await wait(200);
  failing.store.playerSaves.me.friends = ['f0'];
  const friendRow = fdoc.querySelector('.friend-row');
  assert.ok(friendRow, 'liste d’amis affichée malgré le quota épuisé');
  const viewBtn = [...friendRow.querySelectorAll('button')].find((b) => b.textContent.includes('Voir'));
  viewBtn.click();
  await wait(150);
  fdoc.getElementById('gift-amount').value = '10';
  fdoc.getElementById('gift-form').dispatchEvent(new failing.w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(30);
  const okBtn = fdoc.getElementById('confirm-ok');
  if (!fdoc.getElementById('confirm-sheet').hidden) okBtn.click();
  await wait(200);
  const msg = fdoc.getElementById('market-message').textContent;
  assert.match(msg, /quota/i, `message de quota attendu, vu : « ${msg} »`);
  assert.doesNotMatch(msg, /règles Firestore/i, 'ne parle pas des règles quand le quota est épuisé');
  failing.w.close();
  console.log('PASS quota épuisé : message « quota » (pas « règles Firestore ») quand on envoie des pièces');

  console.log('PASS read-budget : lectures Firestore économisées et quota expliqué');
})().catch((error) => { console.error(error); process.exitCode = 1; });
