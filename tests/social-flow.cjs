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
    trades: {}
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
      doc: (id) => docRef(coll, id),
      where: (field, op, value) => query(coll, field, value)
    }),
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
  const { w, doc, store, db } = await boot();

  /* 1. Cinq onglets, page Compte : pseudo, code ami, stats. */
  assert.equal(doc.querySelectorAll('.tab').length, 5, 'Pack, Shop, Collection, En ligne, Compte');
  doc.querySelector('[data-tab="account"]').click();
  await wait(30);
  assert.equal(doc.getElementById('profile-pseudo').textContent, 'Moi');
  assert.match(doc.getElementById('friend-code').textContent, /^REFS-[A-Z0-9]{6}$/);
  assert.equal(doc.getElementById('stats-grid').children.length, 8, 'huit statistiques');
  assert.match(doc.getElementById('stats-grid').textContent, /500/);
  assert.ok(store.playerProfiles.me, 'le profil public doit être créé');
  assert.match(store.playerProfiles.me.friendCode, /^REFS-[A-Z0-9]{6}$/);
  console.log('PASS page Compte = pseudo, code ami REFS-XXXXXX, 8 statistiques');

  /* 2. Changement de pseudo : sauvegarde cloud + HUD. */
  const pseudoInput = doc.getElementById('pseudo-input');
  pseudoInput.value = 'SuperJoueur';
  submitForm(w, doc.getElementById('pseudo-form'));
  await wait(60);
  assert.equal(store.playerProfiles.me.pseudo, 'SuperJoueur');
  assert.equal(doc.getElementById('account-email').textContent, 'SuperJoueur');
  console.log('PASS pseudo modifiable = profil cloud + HUD mis à jour');

  /* 3. Page En ligne : ajout par code = DEMANDE, pas un ami direct. */
  doc.querySelector('[data-tab="online"]').click();
  await wait(30);
  assert.equal(doc.querySelectorAll('.friend-row').length, 0);
  doc.getElementById('friend-code-input').value = 'REFS-ABC123';
  submitForm(w, doc.getElementById('add-friend-form'));
  await wait(80);
  assert.equal(doc.querySelectorAll('.friend-row').length, 0, 'pas ami avant acceptation');
  const requestId = 'me__friend1';
  assert.equal(store.friendRequests[requestId].status, 'pending');
  assert.match(doc.getElementById('add-friend-msg').textContent, /doit l’accepter/);
  console.log('PASS ajout par code = demande d’ami en attente (rien sans acceptation)');

  /* 3 bis. L'AUTRE joueur accepte la demande : je deviens ami chez moi aussi
     (temps réel : l'abonnement onSnapshot pousse la mise à jour). */
  store.friendRequests[requestId].status = 'accepted';
  store.friendRequests[requestId].applied = { friend1: true };
  db.refresh('friendRequests');
  await wait(150);
  assert.equal(doc.querySelectorAll('.friend-row').length, 1, 'ami ajouté après acceptation');
  assert.match(doc.querySelector('.friend-row').textContent, /AmiJoueur/);
  assert.equal(store.friendRequests[requestId].applied.me, true, 'ma moitié est marquée appliquée');
  await wait(400); // save() est différé de 250 ms
  assert.ok(store.playerSaves.me.friends.includes('friend1'), 'ami enregistré dans ma sauvegarde');
  console.log('PASS acceptation par l’autre joueur = amis des deux côtés');
  /* 4. Profil d'ami : stats + ses cartes, boutons Échanger / Acheter. */
  buttonByText(doc.querySelector('.friend-row'), 'Voir').click();
  await wait(60);
  assert.equal(doc.getElementById('friend-detail').hidden, false);
  assert.equal(doc.getElementById('friend-pseudo').textContent, 'AmiJoueur');
  assert.equal(doc.querySelectorAll('.friend-card').length, 1);
  const buyBtn = buttonByText(doc.querySelector('.friend-card'), 'Acheter');
  assert.match(buyBtn.textContent, /40/, 'Commune = 20 🪙 de récompense x2');
  console.log('PASS profil d’ami = stats et cartes avec prix d’achat');

  /* 5. Échange : choix d'une de mes cartes, confirmation, document trades/. */
  buttonByText(doc.querySelector('.friend-card'), 'Échanger').click();
  await wait(30);
  assert.equal(doc.getElementById('trade-sheet').hidden, false);
  assert.equal(doc.querySelectorAll('.picker-tile').length, 2, 'mes deux cartes uniques');
  doc.querySelector('#trade-picker .picker-tile').click();
  await wait(30);
  assert.equal(doc.getElementById('confirm-sheet').hidden, false);
  doc.getElementById('confirm-ok').click();
  await wait(80);
  const tradeIds = Object.keys(store.trades);
  assert.equal(tradeIds.length, 1);
  const trade = store.trades[tradeIds[0]];
  assert.equal(trade.fromUid, 'me');
  assert.equal(trade.toUid, 'friend1');
  assert.equal(trade.receiveId, 'chasseur-royer');
  assert.equal(trade.giveId, 'pieds-de-rapace');
  assert.equal(trade.price, 0);
  assert.equal(trade.status, 'pending');
  console.log('PASS proposition d’échange = trades/ pending avec give/receive');

  /* 6. Achat : prix = récompense x2, document trades/ avec price. */
  buyBtn.click();
  await wait(30);
  assert.equal(doc.getElementById('confirm-sheet').hidden, false);
  doc.getElementById('confirm-ok').click();
  await wait(80);
  assert.equal(Object.keys(store.trades).length, 2);
  const purchase = Object.values(store.trades).find((t) => t.price > 0);
  assert.ok(purchase, 'un achat doit exister');
  assert.equal(purchase.price, 40);
  assert.equal(purchase.receiveId, 'chasseur-royer');
  assert.equal(purchase.giveId, null);
  console.log('PASS proposition d’achat = trades/ avec prix 40 🪙');

  w.close();
  console.log('PASS social-flow : compte, amis, échange et achat');
})().catch((error) => { console.error(error); process.exitCode = 1; });
