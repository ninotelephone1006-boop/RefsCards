// Tests des aperçus (« feature flags ») : une fonctionnalité déjà dans le code
// mais pas encore sortie doit rester INVISIBLE pour les joueurs.
// - Une balise data-preview est verrouillée ([data-preview-locked]) pour un
//   joueur et déverrouillée pour le compte propriétaire.
// - Le propriétaire publie depuis Administration → 🧪 Aperçus (« Publier pour
//   tous »), ou tout d'un coup avec « Tout publier (release) » : l'identifiant
//   part dans gameNews/published (champ `released`), lisible par tout le monde.
// - Un joueur qui recharge ensuite voit la fonctionnalité ; un autre aperçu
//   reste privé.
// - styles.css doit masquer [data-preview-locked] quel que soit le display.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ADMIN_EMAIL = 'ninotelephone1006@gmail.com';

function newsDoc(entries, released) {
  return { schema: 'news-v1', entries: entries || [], released: released || [], updatedAt: new Date() };
}

function makeStore(released) {
  return {
    playerSaves: {
      me: {
        coins: 500, firstPack: false, decoReleaseClaimed: true,
        collection: ['pieds-de-rapace'], friends: [], packsOpened: 3
      }
    },
    playerProfiles: {
      me: {
        pseudo: 'Joueur', avatar: '', friendCode: 'REFS-ABC123', coins: 500,
        totalCards: 1, uniqueCards: 1, bestRarity: 'common',
        collection: ['pieds-de-rapace']
      }
    },
    friendCodes: { 'REFS-ABC123': { uid: 'me' } },
    friendRequests: {},
    trades: {}, marketListings: {}, marketOffers: {}, coinGifts: {}, coinFlips: {},
    gameNews: {
      published: newsDoc([], released),
      drafts: newsDoc([], [])
    }
  };
}

function makeFirestore(store) {
  const docRef = (coll, id) => ({
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store[coll] || {}, id),
      data: () => store[coll][id]
    }),
    set: async (data) => { store[coll][id] = { ...(store[coll][id] || {}), ...data }; },
    update: async (patch) => { store[coll][id] = { ...(store[coll][id] || {}), ...patch }; }
  });
  const query = (coll, field, value) => {
    const snap = () => ({
      docs: Object.entries(store[coll] || {})
        .filter(([, d]) => d[field] === value)
        .map(([id, d]) => ({ id, data: () => d }))
    });
    return {
      get: async () => snap(),
      onSnapshot: (cb) => { Promise.resolve().then(() => cb(snap())); return () => {}; }
    };
  };
  return {
    collection: (coll) => ({
      doc: (id) => docRef(coll, id),
      where: (field, op, value) => query(coll, field, value)
    })
  };
}

/* Ajoute un faux bloc « fonctionnalité future » dans la page Compte, comme le
   ferait index.html avec data-preview. */
function injectUpcomingBlock(document) {
  const anchor = document.querySelector('.news-card');
  const section = document.createElement('section');
  section.id = 'pack-du-mois';
  section.className = 'news-card';
  section.setAttribute('data-preview', 'pack-du-mois');
  section.setAttribute('data-preview-label', 'Pack du mois');
  section.innerHTML = '<h3>Pack du mois</h3><p>Réservé à l’aperçu.</p>';
  anchor.parentNode.insertBefore(section, anchor.nextSibling);
}

async function boot(email, store) {
  store = store || makeStore([]);
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  injectUpcomingBlock(w.document);
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => noop, set: () => true });
  w.Sound = new Proxy({}, { get: () => noop, set: () => true });

  const authState = { onChange: null };
  const auth = () => ({
    onAuthStateChanged(next) { authState.onChange = next; },
    getRedirectResult: () => Promise.resolve(null),
    signOut: async () => { await authState.onChange(null); }
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  w.firebase = { apps: [], initializeApp() {}, auth, firestore: () => makeFirestore(store) };

  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({ uid: 'me', email, displayName: 'Moi', photoURL: '' });
  await wait(260);
  return { w, doc: w.document, store };
}

function textOf(node) {
  return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
}

function previewRow(doc, id) {
  return Array.from(doc.querySelectorAll('#admin-preview-list .preview-row'))
    .find((row) => textOf(row.querySelector('.preview-row-id')) === id);
}

function isLocked(node) {
  return Boolean(node && node.hasAttribute('data-preview-locked') && node.classList.contains('is-preview-locked'));
}

(async () => {
  /* 0. La règle CSS qui rend le verrouillage effectif doit rester en place. */
  {
    const css = fs.readFileSync('styles.css', 'utf8');
    assert.match(css, /\[data-preview-locked\]\{display:none!important\}/,
      'styles.css doit masquer les blocs verrouillés quel que soit leur display');
  }

  /* 1. Joueur : les aperçus sont verrouillés, et il n'a aucun moyen de les
        publier (panneau admin masqué). */
  {
    const { w, doc } = await boot('joueur.lambda@example.com');
    doc.querySelector('[data-tab="account"]').click();
    await wait(40);

    assert.equal(isLocked(doc.querySelector('.news-card')), true,
      'le journal (aperçu) est verrouillé pour un joueur');
    assert.equal(isLocked(doc.getElementById('news-sheet')), true,
      'la feuille du journal est verrouillée pour un joueur');
    assert.equal(isLocked(doc.getElementById('pack-du-mois')), true,
      'un bloc data-preview non publié est verrouillé');
    assert.equal(doc.getElementById('admin-panel').hidden, true,
      'le panneau admin (et donc les boutons de release) reste masqué');
    w.close();
    console.log('PASS joueur : aperçus verrouillés, aucun contrôle de release');
  }

  /* 2. Propriétaire : il voit tout, publie un aperçu puis relâche le reste. */
  {
    const store = makeStore([]);
    const { w, doc } = await boot(ADMIN_EMAIL, store);
    doc.querySelector('[data-tab="account"]').click();
    await wait(40);

    assert.equal(isLocked(doc.querySelector('.news-card')), false,
      'le propriétaire voit son propre aperçu');
    assert.equal(isLocked(doc.getElementById('pack-du-mois')), false,
      'le propriétaire voit tous les blocs en aperçu');
    assert.equal(doc.getElementById('admin-panel').hidden, false);
    assert.equal(doc.getElementById('admin-preview').hidden, false,
      'la section Aperçus est dans le panneau admin');

    const journalRow = previewRow(doc, 'journal-nouveautes');
    const packRow = previewRow(doc, 'pack-du-mois');
    assert.ok(journalRow, 'le journal est déclaré comme aperçu');
    assert.ok(packRow, 'le bloc injecté est déclaré comme aperçu');
    assert.match(textOf(journalRow), /Journal des nouveautés/, 'le libellé lisible est utilisé');
    assert.match(textOf(journalRow), /Privé · toi seul/);
    assert.match(textOf(doc.getElementById('admin-preview-count')), /2 aperçus privés/);

    // Publication d'un seul aperçu.
    packRow.querySelector('button').click();
    await wait(80);
    assert.deepEqual(Array.from(store.gameNews.published.released), ['pack-du-mois'],
      'la publication écrit l’identifiant dans gameNews/published');
    assert.equal(isLocked(doc.getElementById('pack-du-mois')), false);
    assert.ok(!store.gameNews.published.released.includes('journal-nouveautes'),
      'le journal n’est pas publié pour autant');
    assert.match(textOf(doc.getElementById('admin-preview-msg')), /visible par tous les joueurs/);
    assert.match(textOf(previewRow(doc, 'pack-du-mois')), /Publié/);
    const cache = JSON.parse(w.localStorage.getItem('refs-cards:preview-released'));
    assert.deepEqual(Array.from(cache), ['pack-du-mois'],
      'le cache local reflète la publication (état appliqué dès le chargement suivant)');

    // Release global : tout le reste d'un coup.
    const releaseAll = doc.getElementById('admin-preview-release-all');
    assert.equal(releaseAll.hidden, false, 'le bouton de release reste proposé');
    releaseAll.click();
    await wait(80);
    assert.ok(store.gameNews.published.released.includes('journal-nouveautes'),
      '« Tout publier » relâche aussi le journal');
    assert.equal(isLocked(doc.querySelector('.news-card')), false);
    assert.match(textOf(doc.getElementById('admin-preview-msg')), /Release/);
    assert.equal(doc.getElementById('admin-preview-release-all').hidden, true,
      'plus rien à publier : le bouton de release disparaît');
    w.close();
    console.log('PASS propriétaire : aperçus visibles, publication individuelle et release global');
  }

  /* 3. Après publication, un autre joueur voit la fonctionnalité ; et un
        aperçu resté privé le reste. */
  {
    const store = makeStore(['journal-nouveautes', 'pack-du-mois']);
    const { w, doc } = await boot('ami@example.com', store);
    doc.querySelector('[data-tab="account"]').click();
    await wait(40);

    assert.equal(isLocked(doc.querySelector('.news-card')), false,
      'le journal publié est visible par les joueurs');
    assert.equal(isLocked(doc.getElementById('pack-du-mois')), false,
      'le bloc publié est visible par les joueurs');
    doc.getElementById('news-open').click();
    await wait(50);
    assert.equal(doc.getElementById('news-sheet').hidden, false,
      'le journal publié s’ouvre normalement');

    // Retour en privé : le propriétaire peut retirer un aperçu à tout moment.
    const store2 = makeStore(['journal-nouveautes', 'pack-du-mois']);
    const admin = await boot(ADMIN_EMAIL, store2);
    admin.doc.querySelector('[data-tab="account"]').click();
    await wait(40);
    previewRow(admin.doc, 'pack-du-mois').querySelector('button').click();
    await wait(80);
    assert.deepEqual(Array.from(store2.gameNews.published.released), ['journal-nouveautes'],
      '« Repasser en privé » retire l’identifiant du document public');
    w.close();
    admin.w.close();
    console.log('PASS après release : visible par tous, et retirable par le propriétaire');
  }

  console.log('preview-flow: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
