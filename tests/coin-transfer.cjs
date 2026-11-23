// Transfert de pièces de bout en bout : deux sessions (expéditeur puis
// destinataire) partagent le même « Firestore » simulé. Vérifie que les pièces
// sont débitées, que le cadeau apparaît chez le destinataire (même après une
// reconnexion) et qu'il ne peut être récupéré qu'une seule fois.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore() {
  return {
    playerSaves: {
      me: {
        coins: 500, firstPack: false, collection: ['pieds-de-rapace'],
        friends: ['friend1'], packsOpened: 2
      },
      friend1: {
        coins: 40, firstPack: false, collection: ['chasseur-royer'],
        friends: ['me'], packsOpened: 1
      }
    },
    playerProfiles: {
      me: { pseudo: 'Moi', avatar: '', friendCode: 'REFS-MOI111', collection: ['pieds-de-rapace'], coins: 500, totalCards: 1, uniqueCards: 1 },
      friend1: { pseudo: 'AmiJoueur', avatar: '', friendCode: 'REFS-ABC123', collection: ['chasseur-royer'], coins: 40, totalCards: 1, uniqueCards: 1 }
    },
    friendCodes: { 'REFS-MOI111': { uid: 'me' }, 'REFS-ABC123': { uid: 'friend1' } },
    friendRequests: {},
    trades: {}, marketListings: {}, coinGifts: {}
  };
}

function makeFirestore(store) {
  let nextId = 0;
  const docRef = (coll, id) => ({
    coll, id,
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store[coll], id),
      data: () => store[coll][id]
    }),
    set: async (data) => { store[coll][id] = { ...(store[coll][id] || {}), ...data }; },
    update: async (patch) => { store[coll][id] = { ...(store[coll][id] || {}), ...patch }; }
  });
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
    refresh(coll) {
      watchers.filter((w) => !coll || w.coll === coll).forEach((w) => w.cb());
    }
  };
}

async function boot(store, uid) {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/', runScripts: 'outside-only', pretendToBeVisual: true
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
  await authState.onChange({ uid, email: `${uid}@test`, displayName: uid, photoURL: '' });
  await wait(200);
  return { w, doc: w.document, store, db };
}

const buttonByText = (root, text) => [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));

async function sendGift(session, amount) {
  const { w, doc } = session;
  doc.querySelector('[data-tab="online"]').click();
  await wait(40);
  const friendRow = doc.querySelector('.friend-row');
  assert.ok(friendRow, 'la liste d’amis doit afficher friend1');
  buttonByText(friendRow, 'Voir').click();
  await wait(60);
  doc.getElementById('gift-amount').value = String(amount);
  doc.getElementById('gift-form').dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
  await wait(20);
  assert.equal(doc.getElementById('confirm-sheet').hidden, false, 'une confirmation doit s’ouvrir');
  doc.getElementById('confirm-ok').click();
  await wait(200);
}

(async () => {
  const store = makeStore();

  /* --- Le destinataire est déjà connecté (cas réel : on joue à deux). --- */
  const receiver = await boot(store, 'friend1');
  const rdoc = receiver.doc;
  rdoc.querySelector('[data-tab="online"]').click();
  await wait(60);
  assert.match(rdoc.getElementById('market-inbox').textContent, /Rien à récupérer/);

  /* --- L'expéditeur envoie 120 pièces, sans rechargement chez le destinataire. --- */
  const sender = await boot(store, 'me');
  const sdoc = sender.doc;
  await sendGift(sender, 120);

  assert.equal(store.playerSaves.me.coins, 380, 'l’expéditeur est débité de 120');
  const gift = Object.values(store.coinGifts)[0];
  assert.ok(gift, 'un document coinGifts doit être créé');
  assert.equal(gift.fromUid, 'me');
  assert.equal(gift.toUid, 'friend1');
  assert.equal(gift.amount, 120);
  assert.equal(gift.status, 'pending');

  // « Temps réel » : le destinataire est prévenu et voit le cadeau arriver.
  receiver.db.refresh('coinGifts');
  await wait(120);
  const inbox = rdoc.getElementById('market-inbox');
  assert.match(inbox.textContent, /120/, 'le cadeau doit apparaître tout seul chez le destinataire');
  assert.match(rdoc.getElementById('toast').textContent, /120/, 'le destinataire est prévenu par un message');
  assert.equal(rdoc.getElementById('market-inbox-count').textContent, '1');

  buttonByText(inbox, 'Récupérer').click();
  await wait(200);
  assert.equal(store.playerSaves.friend1.coins, 160, 'le destinataire reçoit les 120 pièces');
  assert.equal(Object.values(store.coinGifts)[0].status, 'claimed');
  assert.equal(store.playerSaves.me.coins, 380, 'le total reste cohérent');
  assert.equal(rdoc.querySelectorAll('#market-inbox button').length, 0, 'plus rien à récupérer');
  assert.equal(rdoc.getElementById('market-inbox-count').textContent, '0');

  // Le solde affiché sur la fiche de l'ami est relu à l'ouverture (plus de
  // vieux montant en cache qui ferait croire que le transfert n'a rien fait).
  await wait(800); // le profil public du destinataire est sauvegardé avec un léger délai
  sdoc.getElementById('friend-close').click();
  await wait(20);
  buttonByText(sdoc.querySelector('.friend-row'), 'Voir').click();
  await wait(80);
  assert.match(sdoc.getElementById('friend-stats').textContent, /160/, 'la fiche de l’ami montre le solde à jour');

  /* --- Cadeau annulé tant qu'il n'est pas récupéré : l'expéditeur est remboursé. --- */
  await sendGift(sender, 60);
  assert.equal(store.playerSaves.me.coins, 320, 'le second cadeau est débité');
  const pendingId = Object.keys(store.coinGifts).find((id) => store.coinGifts[id].amount === 60);
  assert.ok(pendingId, 'le second cadeau doit exister');
  assert.match(sdoc.getElementById('market-sent').textContent, /60/, 'l’expéditeur voit son cadeau en attente');
  buttonByText(sdoc.getElementById('market-sent'), 'Annuler').click();
  await wait(200);
  assert.equal(store.playerSaves.me.coins, 380, 'l’annulation rembourse les pièces');
  assert.equal(store.coinGifts[pendingId].status, 'cancelled');
  assert.match(sdoc.getElementById('market-sent').textContent, /Aucun cadeau/);

  // Le destinataire ne peut pas récupérer un cadeau annulé.
  receiver.db.refresh('coinGifts');
  await wait(120);
  assert.equal(rdoc.querySelectorAll('#market-inbox button').length, 0, 'cadeau annulé = rien à récupérer');
  assert.equal(store.playerSaves.friend1.coins, 160, 'aucun crédit pour un cadeau annulé');

  sender.w.close();
  receiver.w.close();

  console.log('PASS transfert de pièces : débit, arrivée en temps réel, récupération unique, annulation remboursée');
})().catch((error) => { console.error(error); process.exitCode = 1; });
