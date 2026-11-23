// Run with NODE_PATH pointing to a local jsdom installation: node tests/fusion-flow.cjs
// Vérifie la demande de fusion : accessible depuis la Collection (même loin du
// récap d'un pack), auto-ouverte après un pack qui contient un doublon, et le
// mode démo ?demo=fusion qui fournit enfin de vrais doublons.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeFirestore(store) {
  const docRef = (coll, id) => ({
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store[coll], id),
      data: () => store[coll][id]
    }),
    set: async (data) => { store[coll][id] = { ...(store[coll][id] || {}), ...data }; },
    update: async (patch) => { store[coll][id] = { ...(store[coll][id] || {}), ...patch }; }
  });
  return {
    collection: (coll) => ({
      doc: (id) => docRef(coll, id),
      where: () => ({ get: async () => ({ docs: [] }), onSnapshot: () => () => {} })
    })
  };
}

async function boot({ url = 'https://refs-cards.test/', save = null, mutateScript = null, signedIn = true } = {}) {
  const store = {
    playerSaves: save ? { me: save } : {},
    playerProfiles: {}, friendCodes: {}, friendRequests: {}, trades: {}
  };
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), { url, runScripts: 'outside-only', pretendToBeVisual: true });
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
  let src = fs.readFileSync('app.js', 'utf8');
  if (mutateScript) src = mutateScript(src);
  vm.runInContext(src, context);
  await wait(40);
  if (signedIn) {
    await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
    await wait(220);
  }
  return { w, doc: w.document, store };
}

async function collectPack(doc) {
  const next = doc.getElementById('next-card');
  for (let i = 0; i < 5; i++) {
    const card = doc.querySelector('.card.is-top');
    if (!card) return i;
    card.click();
    await wait(20);
    if (!next.hidden) { next.click(); await wait(180); }
  }
  return 5;
}

(async () => {
  /* 1. Mode démo ?demo=fusion : le pack contient deux paires fusionnables et la
        demande de fusion s'ouvre toute seule à la fin des cinq cartes. */
  {
    const { w, doc } = await boot({
      url: 'https://refs-cards.test/?demo=fusion',
      signedIn: false,
      mutateScript: (src) => src.replace('  boot();', '  boot(); showReveal();')
    });
    await wait(120);
    const collected = await collectPack(doc);
    assert.equal(collected, 5, 'les cinq cartes du pack démo sont révélées');
    await wait(1500);
    assert.equal(doc.getElementById('fusion').hidden, false, 'la demande de fusion s’ouvre automatiquement');
    const rows = doc.querySelectorAll('.fusion-row');
    assert.equal(rows.length, 2, 'deux doublons fusionnables dans le pack démo');
    assert.match(rows[0].textContent, /Chasseur Royer/);
    w.close();
    console.log('PASS ?demo=fusion = doublons réels et demande de fusion auto-ouverte');
  }

  /* 2. Depuis la Collection : bouton « DEMANDE DE FUSION » avec le compte de
        doublons, ouverture manuelle, puis fusion qui consomme 2 exemplaires. */
  {
    const save = {
      coins: 0, firstPack: false, packsOpened: 0,
      packStock: { classic: 0, rare: 0 }, freeDate: null, freeUsed: 0,
      /* Aucune carte de rareté « supérieure » (uncommon) n'est possédée : le
         résultat aléatoire de la fusion ne peut donc pas recréer un doublon
         (sinon le test échouait une fois sur trois, au hasard). */
      collection: ['chasseur-royer', 'chasseur-royer', 'petite-degustation', 'gros-plan-royer'],
      friends: []
    };
    const { w, doc, store } = await boot({ save });
    doc.querySelector('[data-tab="collection"]').click();
    await wait(60);
    const btn = doc.getElementById('coll-fusion');
    assert.equal(btn.hidden, false, 'bouton visible dès qu’un doublon existe');
    assert.match(doc.getElementById('coll-fusion-label').textContent, /1 DOUBLON/, 'une paire fusionnable');

    btn.click();
    await wait(40);
    assert.equal(doc.getElementById('fusion').hidden, false, 'la demande de fusion s’ouvre depuis la Collection');
    const row = doc.querySelector('.fusion-row');
    assert.ok(row, 'la paire de doublons est proposée');
    row.click();
    await wait(30);
    const go = doc.getElementById('fusion-go');
    assert.equal(go.hidden, false);
    assert.match(go.textContent, /FUSIONNER/);
    go.click();
    await wait(500);

    const saved = store.playerSaves.me.collection;
    assert.equal(saved.length, 3, 'deux exemplaires consommés, un résultat ajouté');
    assert.equal(saved.filter((id) => id === 'chasseur-royer').length, 0, 'les deux Chasseur Royer ont fusionné');
    assert.ok(saved.includes('petite-degustation') && saved.includes('gros-plan-royer'), 'les autres cartes restent');
    await wait(400);
    assert.equal(doc.getElementById('coll-fusion').hidden, true, 'plus de doublon = bouton masqué');
    w.close();
    console.log('PASS demande de fusion depuis la Collection + fusion consommée et sauvegardée');
  }

  /* 3. Sans doublon : pas de bouton dans la Collection (pas de fausse promesse). */
  {
    const { w, doc } = await boot({
      save: {
        coins: 0, firstPack: false, packsOpened: 0,
        packStock: { classic: 0, rare: 0 }, freeDate: null, freeUsed: 0,
        collection: ['chasseur-royer', 'toilet-call'], friends: []
      }
    });
    doc.querySelector('[data-tab="collection"]').click();
    await wait(50);
    assert.equal(doc.getElementById('coll-fusion').hidden, true, 'aucun doublon = bouton caché');
    w.close();
    console.log('PASS aucun doublon = pas de demande de fusion proposée');
  }

  console.log('PASS fusion flow : demande accessible, auto-ouverte et fonctionnelle');
})().catch((error) => { console.error(error); process.exitCode = 1; });
