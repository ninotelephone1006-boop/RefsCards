// Run with NODE_PATH pointing to a local jsdom installation: node tests/deco-everywhere.cjs
// Le décor équipé (chapeau de Noël, Shop → Déco) ne doit pas rester sur le
// seul onglet Compte : il suit la photo PARTOUT (HUD, page Compte, listes
// d'amis et de demandes, fiche d'un ami, marché global, classements) et le
// décor des AUTRES joueurs arrive avec leur profil public (champ `deco`).
// Vérifie aussi l'équiper / retirer depuis l'onglet Déco et la publication
// du décor dans playerProfiles pour que les autres le voient.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore() {
  return {
    playerSaves: {
      me: {
        coins: 5000,
        firstPack: false, decoReleaseClaimed: true,
        collection: ['pieds-de-rapace'],
        friends: ['friend1'],
        packsOpened: 3,
        packStock: { classic: 1, rare: 0, legend: 0 },
        decoOwned: ['chapeau-noel'],
        decoEquipped: 'chapeau-noel'
      }
    },
    playerProfiles: {
      me: {
        pseudo: 'Moi', avatar: '', friendCode: 'REFS-MOI111', coins: 5000,
        totalCards: 1, uniqueCards: 1, collection: ['pieds-de-rapace'], deco: 'chapeau-noel'
      },
      friend1: {
        pseudo: 'AmiJoueur', avatar: '', friendCode: 'REFS-ABC123', coins: 10,
        totalCards: 1, uniqueCards: 1, collection: ['chasseur-royer'], deco: 'chapeau-noel'
      }
    },
    friendCodes: {},
    friendRequests: {},
    marketListings: {},
    marketOffers: {},
    coinGifts: {},
    coinFlips: {}
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
  const query = () => ({
    get: async () => ({ docs: [] }),
    onSnapshot: (cb) => { Promise.resolve().then(() => cb({ docs: [] })); return () => {}; }
  });
  return {
    collection: (coll) => ({
      doc: (id) => docRef(coll, id || `generated${++nextId}`),
      where: () => query(),
      orderBy: () => ({
        limit: () => ({
          get: async () => ({
            docs: Object.entries(store[coll])
              .map(([id, data]) => ({ id, data: () => data }))
          })
        })
      })
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
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => noop, set: () => true });
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
  for (const file of ['firebase-config.js', 'cards.js', 'quests.js', 'app.js']) {
    vm.runInContext(fs.readFileSync(file, 'utf8'), context);
  }
  await wait(50);
  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(300);
  return { w, doc: w.document, store };
}

(async () => {
  /* Le balisage ne contient plus d'image de décor propre à l'onglet Compte :
     le chapeau est inséré par app.js sur chaque avatar (HUD compris). */
  const html = fs.readFileSync('index.html', 'utf8');
  assert.doesNotMatch(html, /id="profile-deco"/, 'plus d’image de décor réservée à la page Compte');

  /* Les règles Firestore acceptent le décor public (champ `deco`). */
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /\('deco' in request\.resource\.data\)/, 'le décor public est autorisé par les règles');

  const { w, doc, store } = await boot();

  /* 1. HUD : le décor équipé suit l'avatar en haut de l'écran. */
  const hudDeco = doc.querySelector('.account-avatar-slot > .avatar-deco');
  assert.ok(hudDeco, 'le décor doit apparaître dans le HUD');
  assert.equal(hudDeco.getAttribute('src'), 'assets/deco/chapeau-noel.png');

  /* 2. Page Compte : décor au-dessus de la photo de profil. */
  assert.ok(doc.querySelector('.avatar-wrap > .avatar-deco'), 'décor sur la page Compte');

  /* 3. Liste d'amis : l'avatar de l'ami porte SON décor (profil public). */
  doc.querySelector('[data-tab="online"]').click();
  await wait(250);
  const row = doc.querySelector('.friend-row');
  assert.ok(row, 'ligne d’ami');
  assert.match(row.textContent, /AmiJoueur/);
  assert.ok(row.querySelector('.avatar-deco-slot > .avatar-deco'), 'décor de l’ami dans la liste');

  /* 4. Fiche d'un ami : décor sur sa photo. */
  const view = [...row.querySelectorAll('button')].find((b) => b.textContent.includes('Voir'));
  view.click();
  await wait(150);
  assert.ok(doc.querySelector('.friend-avatar-slot > .avatar-deco'), 'décor sur la fiche de l’ami');

  /* 5. Le décor équipé est publié dans le profil public. */
  assert.equal(store.playerProfiles.me.deco, 'chapeau-noel', 'décor public publié');

  /* 6. Onglet Déco : la carte du décor possédé apparaît avec le bouton
        Équiper / Retirer (l'achat n'est plus proposé). */
  doc.querySelector('[data-tab="shop"]').click();
  doc.querySelector('[data-shop-tab="deco"]').click();
  await wait(60);
  assert.equal(doc.getElementById('deco-owned-card').hidden, false);
  const toggle = doc.getElementById('deco-toggle-chapeau-noel');
  assert.match(toggle.textContent, /ÉQUIPÉ/);
  assert.equal(doc.getElementById('buy-chapeau-noel'), null, 'le décor n’est plus en vente');

  /* 7. Retirer : plus de décor nulle part, et le retrait est publié. */
  toggle.click();
  await wait(900);
  assert.equal(store.playerSaves.me.decoEquipped, '', 'retrait enregistré dans la sauvegarde');
  assert.equal(doc.querySelector('.avatar-wrap > .avatar-deco'), null, 'décor retiré de la page Compte');
  assert.equal(doc.querySelector('.account-avatar-slot > .avatar-deco'), null, 'décor retiré du HUD');
  /* La fiche de l'AMI garde SON décor (profil public) : il ne dépend pas de
     mon équipement. Le mien, lui, a disparu du HUD et de la page Compte. */
  assert.ok(doc.querySelector('.friend-avatar-slot > .avatar-deco'), 'l’ami garde son propre décor');
  assert.ok(doc.querySelector('.friend-row .avatar-deco'), 'la liste montre le décor de l’ami');
  await wait(1200);
  assert.equal(store.playerProfiles.me.deco, '', 'retrait publié dans le profil public');

  /* 8. Cohérence du catalogue Déco (dont Chapeau One Piece) : chaque carte du
        Shop a son option dans l'éditeur admin et son fichier image sur disque,
        et l'achat / équipement de chapeau-onepiece affiche bien son visuel. */
  const shopDecoIds = [...doc.querySelectorAll('.deco-card[data-deco]')].map((n) => n.getAttribute('data-deco'));
  const editorDecoIds = [...doc.querySelectorAll('#admin-deco-select option')].map((n) => n.value);
  assert.ok(shopDecoIds.includes('chapeau-onepiece'), 'chapeau-onepiece présent dans le Shop');
  assert.deepEqual(editorDecoIds, shopDecoIds, 'l’éditeur admin liste exactement les mêmes chapeaux que le Shop');
  for (const id of shopDecoIds) {
    assert.ok(fs.existsSync(`assets/deco/${id}.png`), `assets/deco/${id}.png doit exister`);
  }
  doc.getElementById('deco-toggle-chapeau-onepiece').click();
  await wait(900);
  assert.equal(store.playerSaves.me.decoEquipped, 'chapeau-onepiece');
  assert.equal(doc.querySelector('.account-avatar-slot > .avatar-deco').getAttribute('src'),
    'assets/deco/chapeau-onepiece.png', 'le chapeau One Piece s’affiche dans le HUD');

  w.close();
  console.log('PASS déco partout : HUD, Compte, amis, fiche ami, profil public, équiper/retirer');
})().catch((error) => { console.error(error); process.exitCode = 1; });
