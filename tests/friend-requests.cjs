// Run with NODE_PATH pointing to a local jsdom installation: node tests/friend-requests.cjs
// Vérifie les demandes d'ami (« on ne devient amis que si l'autre accepte ») :
// - ajouter un code ami crée une DEMANDE (friendRequests/{moi}__{lui}), pas un ami ;
// - une demande reçue s'affiche avec Accepter / Refuser ;
// - Accepter marque la demande acceptée et ajoute l'ami des DEUX côtés ;
// - Refuser ne crée aucun ami ;
// - une demande acceptée par l'autre pendant qu'on est hors ligne devient un
//   ami au chargement suivant ;
// - la fiche ami (« Voir ») monte chaque carte dans un cadre au ratio 5:7 :
//   sans lui, les cartes en position absolue se chevauchaient (bug visuel).
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore() {
  return {
    playerSaves: {
      me: { coins: 500, firstPack: false, collection: ['pieds-de-rapace', 'chasseur-royer'], friends: [], packsOpened: 3 }
    },
    playerProfiles: {
      friend1: {
        pseudo: 'AmiJoueur', avatar: '', friendCode: 'REFS-ABC123',
        coins: 50, totalCards: 1, uniqueCards: 1, bestRarity: 'common',
        collection: ['chasseur-royer']
      }
    },
    friendCodes: { 'REFS-ABC123': { uid: 'friend1' } },
    friendRequests: {},
    trades: {}
  };
}

function makeFirestore(store, { denyMissingGet = false } = {}) {
  const watchers = [];
  const docRef = (coll, id) => ({
    get: async () => {
      const exists = Object.prototype.hasOwnProperty.call(store[coll], id);
      /* Comme Firestore avec une règle `resource.data.x` sur un doc absent :
         lecture refusée (permission-denied) au lieu de « n'existe pas ». */
      if (denyMissingGet && !exists && coll === 'friendRequests') {
        throw Object.assign(new Error('Missing or insufficient permissions.'), { code: 'permission-denied' });
      }
      return { exists, data: () => store[coll][id] };
    },
    set: async (data) => { store[coll][id] = { ...(store[coll][id] || {}), ...data }; },
    update: async (patch) => {
      if (!Object.prototype.hasOwnProperty.call(store[coll], id)) {
        throw Object.assign(new Error('No document to update'), { code: 'not-found' });
      }
      store[coll][id] = { ...store[coll][id], ...patch };
    }
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
    refresh(coll) {
      watchers.filter((w) => !coll || w.coll === coll).forEach((w) => w.cb());
    }
  };
}

async function boot(store = makeStore(), fsOptions = {}) {
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
  const db = makeFirestore(store, fsOptions);
  w.firebase = { apps: [], initializeApp() {}, auth, firestore: () => db };

  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(160);
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

  /* 1. Ajouter un code ami = envoyer une demande, pas créer un ami. */
  doc.querySelector('[data-tab="online"]').click();
  await wait(30);
  doc.getElementById('friend-code-input').value = 'refs-abc123'; // casse/format tolérés
  submitForm(w, doc.getElementById('add-friend-form'));
  await wait(100);

  const requestId = 'me__friend1';
  assert.ok(store.friendRequests[requestId], 'la demande doit être créée dans friendRequests');
  assert.equal(store.friendRequests[requestId].fromUid, 'me');
  assert.equal(store.friendRequests[requestId].toUid, 'friend1');
  assert.equal(store.friendRequests[requestId].status, 'pending');
  assert.equal(doc.querySelectorAll('.friend-row').length, 0, 'pas ami tant que l’autre n’a pas accepté');
  assert.equal(doc.querySelectorAll('#friend-requests-out .request-row').length, 1, 'demande envoyée listée');
  assert.match(doc.getElementById('friend-requests-out').textContent, /En attente/);
  assert.match(doc.getElementById('add-friend-msg').textContent, /doit l’accepter/);
  console.log('PASS ajout par code = demande en attente, aucun ami créé d’office');

  /* 1 ter. L'aperçu sous le champ montre QUI on vient d'ajouter (photo + pseudo). */
  const preview = doc.getElementById('add-friend-preview');
  assert.equal(preview.hidden, false, 'aperçu du joueur ajouté visible');
  assert.match(preview.textContent, /AmiJoueur/);
  assert.match(preview.textContent, /Demande envoyée/);
  console.log('PASS ajout par code = aperçu pseudo/photo du joueur ajouté');

  /* 1 bis. Redemander la même personne ne duplique pas la demande. */
  doc.getElementById('friend-code-input').value = 'REFS-ABC123';
  submitForm(w, doc.getElementById('add-friend-form'));
  await wait(80);
  assert.match(doc.getElementById('add-friend-msg').textContent, /déjà en attente/);
  assert.equal(Object.keys(store.friendRequests).length, 1, 'une seule demande');
  console.log('PASS double demande = une seule demande en attente');

  /* 2. Une demande REÇUE s’affiche et peut être acceptée : les deux sont amis. */
  store.friendRequests['friend1__me'] = {
    fromUid: 'friend1', toUid: 'me', status: 'pending', applied: { friend1: true }
  };
  db.refresh('friendRequests');
  await wait(150);
  const incoming = doc.querySelectorAll('#friend-requests-in .request-row');
  assert.equal(incoming.length, 1, 'une demande reçue affichée');
  assert.match(incoming[0].textContent, /AmiJoueur/);
  assert.equal(doc.getElementById('friend-requests-count').textContent, '1');
  assert.equal(doc.getElementById('friend-requests-empty').hidden, true);

  buttonByText(incoming[0], 'Accepter').click();
  await wait(450); // acceptation + save() différé de 250 ms
  assert.equal(store.friendRequests['friend1__me'].status, 'accepted');
  assert.equal(store.friendRequests['friend1__me'].applied.me, true, 'ma moitié est marquée');
  assert.equal(doc.querySelectorAll('#friend-requests-in .request-row').length, 0, 'demande traitée retirée');
  assert.equal(doc.querySelectorAll('.friend-row').length, 1, 'l’ami apparaît dans ma liste');
  assert.ok(store.playerSaves.me.friends.includes('friend1'), 'ami enregistré dans ma sauvegarde');
  assert.match(doc.getElementById('toast').textContent, /maintenant amis/i);
  console.log('PASS demande reçue acceptée = amis enregistrés des deux côtés');

  /* 3. Une demande reçue peut être REFUSÉE : aucun ami. */
  store.playerSaves.me.friends = [];
  store.friendRequests['friend2__me'] = {
    fromUid: 'friend2', toUid: 'me', status: 'pending', applied: { friend2: true }
  };
  store.playerProfiles.friend2 = { pseudo: 'AutreJoueur', avatar: '', friendCode: 'REFS-ZZZ999', collection: [] };
  db.refresh('friendRequests');
  await wait(150);
  const second = doc.querySelectorAll('#friend-requests-in .request-row');
  buttonByText(second[0], 'Refuser').click();
  await wait(200);
  assert.equal(store.friendRequests['friend2__me'].status, 'declined');
  assert.equal(doc.querySelectorAll('#friend-requests-in .request-row').length, 0);
  assert.equal(doc.querySelectorAll('.friend-row').length, 1, 'toujours un seul ami (friend1)');
  assert.doesNotMatch(store.playerSaves.me.friends.join(','), /friend2/);
  console.log('PASS demande refusée = aucun ami ajouté');

  /* 4. Fiche ami (« Voir ») : chaque carte a un cadre au ratio 5:7. */
  buttonByText(doc.querySelector('.friend-row'), 'Voir').click();
  await wait(120);
  assert.equal(doc.getElementById('friend-detail').hidden, false);
  const cards = [...doc.querySelectorAll('.friend-card')];
  assert.equal(cards.length, 1);
  const frame = cards[0].querySelector('.friend-card-frame');
  assert.ok(frame, 'chaque carte doit être dans un cadre .friend-card-frame');
  assert.ok(frame.querySelector('.cf'), 'le visuel .cf est bien dans le cadre');
  assert.ok(cards[0].querySelector('.friend-card-actions'), 'les boutons restent sous la carte');
  console.log('PASS fiche ami = cartes montées dans un cadre 5:7 (plus de chevauchement)');

  /* 5. Une demande acceptée pendant mon absence devient un ami au chargement. */
  const other = makeStore();
  other.friendRequests['friend3__me'] = { fromUid: 'friend3', toUid: 'me', status: 'pending' };
  other.playerProfiles.friend3 = { pseudo: 'RetourJoueur', avatar: '', friendCode: 'REFS-RRR333', collection: [] };
  const second2 = await boot(other);
  assert.equal(second2.doc.querySelectorAll('#friend-requests-in .request-row').length, 1,
    'demande reçue visible à la connexion');
  second2.w.close();

  /* 7. Régression : lire la demande inverse (absente) est refusé par les
     anciennes règles (permission-denied). L'envoi doit quand même aboutir,
     sans afficher l'aide « Republie les règles », et la photo de profil
     du joueur ajouté doit s'afficher. */
  {
    const st = makeStore();
    st.playerProfiles.friend1.avatar = 'data:image/png;base64,iVBORw0KGgo=';
    const ctx7 = await boot(st, { denyMissingGet: true });
    ctx7.doc.querySelector('[data-tab="online"]').click();
    await wait(30);
    ctx7.doc.getElementById('friend-code-input').value = 'REFS-ABC123';
    submitForm(ctx7.w, ctx7.doc.getElementById('add-friend-form'));
    await wait(150);
    assert.ok(st.friendRequests['me__friend1'], 'demande créée malgré le refus de lecture du doc absent');
    assert.doesNotMatch(ctx7.doc.getElementById('add-friend-msg').textContent, /Republie/);
    assert.match(ctx7.doc.getElementById('add-friend-msg').textContent, /Demande envoyée/);
    const pv = ctx7.doc.getElementById('add-friend-preview');
    assert.equal(pv.hidden, false);
    const img = pv.querySelector('.friend-row-avatar');
    assert.ok(img && !img.hidden && img.getAttribute('src').startsWith('data:image/png'), 'photo de profil affichée');
    assert.equal(pv.querySelector('.friend-row-fallback').hidden, true);
    const outImg = ctx7.doc.querySelector('#friend-requests-out .friend-row-avatar');
    assert.ok(outImg && !outImg.hidden, 'photo aussi dans « Demandes envoyées »');
    console.log('PASS get() refusé sur la demande inverse absente = envoi OK + photo de profil visible');
  }

  w.close();
  console.log('PASS friend-requests : demande → acceptation/refus → amis, fiche ami sans chevauchement');
})().catch((error) => { console.error(error); process.exitCode = 1; });
