// Tests du journal « Nouveautés » (page Compte → 📰 Nouveautés).
// - Un joueur ne voit QUE les entrées publiées (gameNews/published).
// - Le document des brouillons (gameNews/drafts) n'est même pas LU pour un
//   joueur : la règle Firestore le réserve au compte propriétaire et le jeu ne
//   le demande jamais. Un brouillon n'est donc jamais envoyé au navigateur.
// - Le compte propriétaire voit ses brouillons, peut en enregistrer, puis les
//   « release » (Publier) : l'entrée passe dans le document public et devient
//   visible par les autres joueurs.
// - À la déconnexion, le journal et les brouillons ne restent pas affichés.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ADMIN_EMAIL = 'ninotelephone1006@gmail.com';

function newsDoc(entries) {
  return { schema: 'news-v1', entries, updatedAt: new Date() };
}

function makeStore() {
  return {
    playerSaves: {
      me: {
        coins: 500,
        firstPack: false, decoReleaseClaimed: true,
        collection: ['pieds-de-rapace', 'chasseur-royer'],
        friends: [],
        packsOpened: 3
      }
    },
    playerProfiles: {
      me: {
        pseudo: 'Joueur',
        avatar: '',
        friendCode: 'REFS-ABC123',
        coins: 500,
        totalCards: 2,
        uniqueCards: 2,
        bestRarity: 'common',
        collection: ['pieds-de-rapace', 'chasseur-royer']
      }
    },
    friendCodes: { 'REFS-ABC123': { uid: 'me' } },
    friendRequests: {},
    trades: {}, marketListings: {}, marketOffers: {}, coinGifts: {}, coinFlips: {},
    gameNews: {
      published: newsDoc([
        {
          id: 'pub-decos',
          title: 'Les Décos arrivent',
          body: '- Chapeau de Noël\n- Béret rouge',
          version: '2026.12.0',
          date: Date.parse('2026-11-27T10:00:00Z')
        }
      ], ['journal-nouveautes']),
      drafts: newsDoc([
        {
          id: 'draft-secret',
          title: 'Pack Légende en préparation',
          body: 'Sortie prévue très bientôt.',
          version: '2026.12.1',
          date: Date.parse('2026-11-28T09:00:00Z')
        }
      ])
    }
  };
}

function makeFirestore(store, reads) {
  const docRef = (coll, id) => ({
    get: async () => {
      reads[`${coll}/${id}`] = (reads[`${coll}/${id}`] || 0) + 1;
      return {
        exists: Object.prototype.hasOwnProperty.call(store[coll] || {}, id),
        data: () => store[coll][id]
      };
    },
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

async function boot(email, store) {
  store = store || makeStore();
  const reads = {};
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
  w.Sound = new Proxy({}, { get: () => noop, set: () => true });

  const authState = { onChange: null };
  const auth = () => ({
    onAuthStateChanged(next) { authState.onChange = next; },
    getRedirectResult: () => Promise.resolve(null),
    signOut: async () => { await authState.onChange(null); }
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  w.firebase = { apps: [], initializeApp() {}, auth, firestore: () => makeFirestore(store, reads) };

  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({ uid: 'me', email, displayName: 'Moi', photoURL: '' });
  await wait(260); // profil + journal + premiers rendus
  return { w, doc: w.document, store, reads, authState };
}

function textOf(node) {
  return node ? node.textContent.replace(/\s+/g, ' ').trim() : '';
}

(async () => {
  /* 1. Joueur normal : il voit les entrées publiées, jamais les brouillons,
        et le document `drafts` n'est même pas lu. */
  {
    const { w, doc, store, reads } = await boot('joueur.lambda@example.com');
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);

    assert.equal(doc.getElementById('admin-panel').hidden, true,
      'le panneau admin reste masqué pour un joueur normal');
    assert.equal(doc.getElementById('news-new').hidden, false,
      'le badge NOUVEAU signale une entrée non lue');
    assert.match(textOf(doc.getElementById('news-summary')), /1 nouveauté publiée/,
      'le résumé du Compte annonce la nouveauté publiée');

    doc.getElementById('news-open').click();
    await wait(60);
    assert.equal(doc.getElementById('news-sheet').hidden, false, 'le journal s’ouvre');

    const list = textOf(doc.getElementById('news-list'));
    assert.match(list, /Les Décos arrivent/, 'l’entrée publiée est affichée');
    assert.equal(doc.querySelectorAll('#news-list .news-bullets li').length, 2,
      'les lignes « - » deviennent des puces');
    assert.equal(doc.getElementById('news-drafts-block').hidden, true,
      'le bloc brouillons est masqué pour un joueur');
    assert.doesNotMatch(textOf(doc.getElementById('news-sheet')), /Pack Légende en préparation/,
      'un brouillon ne doit jamais apparaître dans la page d’un joueur');
    assert.equal(reads['gameNews/drafts'], undefined,
      'le document des brouillons n’est pas lu pour un joueur');
    assert.ok(reads['gameNews/published'] >= 1, 'le journal public est bien lu');
    assert.equal(doc.getElementById('news-new').hidden, true,
      'le badge disparaît après lecture');

    // Le brouillon est présent dans le store : c'est bien le filtrage (et
    // l'absence de lecture) qui protège, pas l'absence de données.
    assert.equal(store.gameNews.drafts.entries.length, 1);
    w.close();
    console.log('PASS joueur : publiées visibles, brouillons ni lus ni affichés');
  }

  /* 2. Compte propriétaire : brouillons visibles, enregistrement, release. */
  {
    const { w, doc, store, reads } = await boot(ADMIN_EMAIL);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);

    assert.equal(doc.getElementById('admin-panel').hidden, false, 'le panneau admin est visible');
    assert.ok(reads['gameNews/drafts'] >= 1, 'l’admin lit ses brouillons');
    assert.match(textOf(doc.getElementById('admin-news-count')), /1 brouillon/,
      'le panneau indique le nombre de brouillons');

    // Enregistrement d'un brouillon : il ne doit RIEN publier.
    const publishedBefore = store.gameNews.published.entries.length;
    doc.getElementById('admin-news-version').value = '2026.12.2';
    doc.getElementById('admin-news-title-input').value = 'Nouveau pack vidéo';
    doc.getElementById('admin-news-body').value = '- 12 cartes\n- Sortie vendredi';
    doc.getElementById('admin-news-save').click();
    await wait(80);

    const drafts = store.gameNews.drafts.entries;
    assert.equal(drafts.length, 2, 'le brouillon est ajouté');
    assert.equal(drafts[0].title, 'Nouveau pack vidéo');
    assert.equal(drafts[0].version, '2026.12.2');
    assert.equal(store.gameNews.published.entries.length, publishedBefore,
      'enregistrer un brouillon ne publie rien');
    assert.match(textOf(doc.getElementById('admin-news-msg')), /visible par toi seul/);

    // Le journal montre le brouillon avec son bouton de release.
    doc.getElementById('news-open').click();
    await wait(80);
    assert.equal(doc.getElementById('news-drafts-block').hidden, false,
      'le bloc brouillons est visible pour l’admin');
    const draftText = textOf(doc.getElementById('news-drafts'));
    assert.match(draftText, /Nouveau pack vidéo/, 'le brouillon est relu dans le journal');
    assert.match(draftText, /BROUILLON/, 'le brouillon est étiqueté');

    const publish = Array.from(doc.querySelectorAll('#news-drafts .mini-btn'))
      .find((b) => /Publier/.test(b.textContent));
    assert.ok(publish, 'un bouton Publier (release) est proposé');
    publish.click();
    await wait(80);

    assert.equal(store.gameNews.published.entries[0].title, 'Nouveau pack vidéo',
      'la release place l’entrée en tête du journal public');
    assert.ok(!store.gameNews.drafts.entries.some((e) => e.title === 'Nouveau pack vidéo'),
      'le brouillon est retiré après publication');
    assert.match(textOf(doc.getElementById('news-list')), /Nouveau pack vidéo/,
      'l’entrée publiée apparaît dans le journal');
    assert.doesNotMatch(textOf(doc.getElementById('news-drafts')), /Nouveau pack vidéo/,
      'le brouillon publié ne reste pas dans la liste des brouillons');

    // Déconnexion : rien du compte propriétaire ne reste affiché.
    doc.getElementById('news-sheet').hidden = true;
    await w.firebase.auth().signOut();
    await wait(60);
    assert.equal(doc.getElementById('admin-panel').hidden, true,
      'le panneau admin disparaît à la déconnexion');
    assert.doesNotMatch(textOf(doc.getElementById('news-sheet')), /Nouveau pack vidéo/,
      'le journal est vidé à la déconnexion');
    assert.equal(doc.getElementById('news-drafts-block').hidden, true);
    w.close();
    console.log('PASS admin : brouillon privé, release, puis journal public');
  }

  /* 3. Un autre joueur, après la release, voit la nouveauté publiée. */
  {
    const store = makeStore();
    store.gameNews.drafts = newsDoc([]);
    store.gameNews.published = newsDoc([
      {
        id: 'release-1',
        title: 'Nouveau pack vidéo',
        body: 'Disponible dès maintenant.',
        version: '2026.12.2',
        date: Date.parse('2026-11-28T12:00:00Z')
      }
    ], ['journal-nouveautes']);
    const { w, doc, reads } = await boot('ami@example.com', store);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    doc.getElementById('news-open').click();
    await wait(60);

    const list = textOf(doc.getElementById('news-list'));
    assert.match(list, /Nouveau pack vidéo/, 'l’entrée publiée est visible par les autres');
    assert.equal(reads['gameNews/drafts'], undefined,
      'les brouillons ne sont toujours pas lus par un joueur');
    assert.equal(doc.getElementById('news-drafts-block').hidden, true);
    w.close();
    console.log('PASS après release : la nouveauté est visible par tous');
  }

  console.log('news-flow: OK');
})().catch((error) => {
  console.error(error);
  process.exit(1);
});
