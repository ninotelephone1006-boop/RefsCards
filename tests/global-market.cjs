// Run with NODE_PATH pointing to a local jsdom installation: node tests/global-market.cjs
// Vérifie le catalogue global regroupé par carte, le classement des vendeurs,
// la séparation Shiny, le filtre, l'ajout en ami et l'achat auprès d'un vendeur choisi.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore() {
  return {
    playerSaves: {
      me: {
        coins: 1000,
        firstPack: false, decoReleaseClaimed: true,
        collection: ['pieds-de-rapace'],
        friends: [],
        packsOpened: 0,
        packStock: { classic: 0, rare: 0, legend: 0 }
      }
    },
    playerProfiles: {
      stranger: {
        pseudo: 'VendeurInconnu',
        avatar: '',
        friendCode: 'REFS-ZZZ999',
        coins: 10,
        totalCards: 1,
        uniqueCards: 1,
        bestRarity: 'common',
        collection: ['chasseur-royer']
      },
      sellerCheap: {
        pseudo: 'VendeurPasCher',
        avatar: '',
        friendCode: 'REFS-CCC111',
        coins: 100,
        totalCards: 3,
        uniqueCards: 2,
        bestRarity: 'secret',
        collection: ['babault-musique']
      }
    },
    friendCodes: { 'REFS-ZZZ999': { uid: 'stranger' } },
    friendRequests: {},
    marketListings: {
      strangerListing: { sellerUid: 'stranger', cardId: 'chasseur-royer', price: 200, buyerUid: '', status: 'open', createdAt: '2026-11-20T10:00:00.000Z' },
      babaultCheap: { sellerUid: 'sellerCheap', cardId: 'babault-musique', price: 100, buyerUid: '', status: 'open', createdAt: '2026-11-22T10:00:00.000Z' },
      babaultMid: { sellerUid: 'stranger', cardId: 'babault-musique', price: 200, buyerUid: '', status: 'open', createdAt: '2026-11-21T10:00:00.000Z' },
      babaultExpensive: { sellerUid: 'stranger', cardId: 'babault-musique', price: 250, buyerUid: '', status: 'open', createdAt: '2026-11-20T11:00:00.000Z' },
      shinyListing: { sellerUid: 'stranger', cardId: 'babault-musique::shiny', price: 450, buyerUid: '', status: 'open', createdAt: '2026-11-23T10:00:00.000Z' },
      mine: { sellerUid: 'me', cardId: 'pieds-de-rapace', price: 5, buyerUid: '', status: 'open', createdAt: '2026-11-21T10:00:00.000Z' },
      alreadySold: { sellerUid: 'stranger', cardId: 'pieds-de-rapace', price: 1, buyerUid: 'other', status: 'sold', createdAt: '2026-11-19T10:00:00.000Z' }
    },
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
  const query = (coll, field, value) => {
    const snap = () => ({
      docs: Object.entries(store[coll])
        .filter(([, d]) => d[field] === value)
        .map(([id, d]) => ({ id, data: () => d }))
    });
    return {
      get: async () => snap(),
      onSnapshot: (cb) => {
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
    }
  };
}

async function boot(store) {
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
  await wait(200);
  return { w, doc: w.document, store, db };
}

function buttonByText(root, text) {
  return [...root.querySelectorAll('button')].find((b) => b.textContent.includes(text));
}

(async () => {
  /* 1. Le balisage du marché global existe dans index.html. */
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /id="global-market-list"/, 'liste du marché global');
  assert.match(html, /id="global-market-search"/, 'filtre du marché global');
  assert.match(html, /Marché global/, 'titre du marché global');

  /* 2. Les règles Firestore autorisent un marché ouvert (pas seulement entre amis). */
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.doesNotMatch(rules, /sellerUid in beforeSave\(\)\.friends/,
    'l’achat ne doit plus exiger que le vendeur soit un ami');
  assert.match(rules, /allow read: if signedIn\(\) && \(resource\.data\.sellerUid == request\.auth\.uid \|\| listed\(\)\)/,
    'les annonces en vente sont lisibles par tous les joueurs connectés');

  const store = makeStore();
  const { w, doc } = await boot(store);
  doc.querySelector('[data-tab="online"]').click();
  await wait(80);

  const globalBox = doc.getElementById('global-market-list');
  const globalCount = doc.getElementById('global-market-count');
  const itemByTitle = (title) => [...globalBox.querySelectorAll('.global-market-product')]
    .find((item) => item.querySelector('.global-market-card-title')?.textContent === title);
  assert.equal(doc.getElementById('global-market-sort').value, 'cheap', 'les offres sont triées par prix croissant par défaut');
  assert.equal(globalCount.textContent, '5', 'le compteur global compte les annonces disponibles');
  assert.doesNotMatch(globalBox.textContent, /VendeurInconnu/,
    'les vendeurs restent masqués tant qu’on n’a pas ouvert une carte');
  assert.doesNotMatch(globalBox.textContent, /alreadySold|1 🪙/, 'les annonces vendues ne sont pas listées');
  assert.doesNotMatch(globalBox.textContent, /pieds de rapace|Pieds de rapace/i,
    'mes propres annonces ne sont pas listées dans le marché global');

  /* 3. Les annonces d'une carte sont regroupées, avec son titre et son visuel. */
  const babault = itemByTitle('Babault Musique');
  assert.ok(babault, 'la carte Babault Musique est affichée comme un seul produit');
  assert.match(babault.textContent, /3 en vente/, 'le produit annonce les 3 exemplaires regroupés');
  assert.equal(babault.querySelector('.global-market-card-title').dataset.rarity, 'secret',
    'le titre du shop porte la rareté de la carte');
  assert.ok(babault.querySelector('.global-market-card-preview .cf'), 'le visuel réel de la carte est affiché');
  assert.equal(babault.querySelector('.global-market-card-preview .cf-name').textContent, 'Babault Musique',
    'la carte elle-même porte également son titre');

  /* 4. Les Shiny restent dans une section dédiée, séparées des cartes normales. */
  const shinySection = globalBox.querySelector('[data-market-kind="shiny"]');
  assert.ok(shinySection, 'une section Shiny distincte est créée');
  const shinyProduct = shinySection.querySelector('.global-market-product');
  assert.match(shinyProduct.querySelector('.global-market-card-title').textContent, /Shiny/);
  assert.ok(shinyProduct.querySelector('.cf.mutation-shiny'), 'le rendu de la carte conserve son effet Shiny');
  assert.equal(globalBox.querySelector('[data-market-kind="cards"] .global-market-card-title').textContent.includes('Shiny'), false,
    'les Shiny ne sont pas mélangées aux cartes normales');

  /* 5. Cliquer une carte montre tous les vendeurs du moins cher au plus cher. */
  babault.querySelector('.global-market-product-trigger').click();
  const offers = [...babault.querySelectorAll('.global-market-offer')];
  assert.equal(offers.length, 3, 'les trois annonces Babault sont accessibles dans le détail');
  assert.deepEqual(offers.map((row) => Number(row.querySelector('.global-market-offer-price-box').dataset.price)),
    [100, 200, 250], 'les vendeurs sont classés du plus avantageux au moins avantageux');
  assert.match(offers[0].textContent, /VendeurPasCher/);
  assert.match(offers[2].textContent, /VendeurInconnu/);

  /* 6. Ajouter en ami depuis l'offre du vendeur choisi. */
  const strangerOffer = offers.find((row) => row.textContent.includes('VendeurInconnu'));
  const addBtn = buttonByText(strangerOffer, 'Ajouter en ami');
  assert.ok(addBtn, 'on peut ajouter le vendeur en ami depuis son offre');
  addBtn.click();
  await wait(120);
  assert.equal(Object.keys(store.friendRequests).length, 1, 'une demande d’ami est créée');
  const request = Object.values(store.friendRequests)[0];
  assert.equal(request.fromUid, 'me');
  assert.equal(request.toUid, 'stranger');
  assert.equal(request.status, 'pending');
  const currentBabault = itemByTitle('Babault Musique');
  currentBabault.querySelector('.global-market-product-trigger').click();
  assert.match(currentBabault.textContent, /Demande envoyée/,
    'l’état « Demande envoyée » remplace le bouton');

  /* 7. Filtre par vendeur et par carte. */
  const search = doc.getElementById('global-market-search');
  search.value = 'inconnu';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(20);
  assert.ok(itemByTitle('Babault Musique'), 'le filtre par pseudo conserve les cartes vendues par ce joueur');
  search.value = 'babault musique';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(20);
  assert.equal(globalBox.querySelectorAll('.global-market-product').length, 2,
    'la recherche par carte sépare bien la version normale et la version Shiny');
  search.value = 'zzz-rien';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(20);
  assert.match(globalBox.textContent, /Aucune annonce ne correspond/);
  search.value = '';
  search.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(20);

  /* 8. On peut choisir un vendeur précis, même si son prix n’est pas le plus bas. */
  const babaultToBuy = itemByTitle('Babault Musique');
  babaultToBuy.querySelector('.global-market-product-trigger').click();
  const chosenOffer = [...babaultToBuy.querySelectorAll('.global-market-offer')]
    .find((row) => row.querySelector('.global-market-offer-price-box').dataset.price === '250');
  buttonByText(chosenOffer, 'Acheter').click();
  await wait(20);
  assert.match(doc.getElementById('confirm-message').textContent, /VendeurInconnu.*250/,
    'la confirmation correspond au vendeur et au prix choisis');
  doc.getElementById('confirm-ok').click();
  await wait(200);
  assert.equal(store.playerSaves.me.coins, 750, 'les pièces du vendeur choisi sont débitées');
  assert.ok(store.playerSaves.me.collection.includes('babault-musique'), 'la carte choisie arrive dans ma collection');
  assert.equal(store.marketListings.babaultExpensive.status, 'sold');
  assert.equal(store.marketListings.babaultExpensive.buyerUid, 'me');

  /* 9. Achat d’une autre carte directement à un joueur non-ami. */
  const chasseur = itemByTitle('Chasseur Royer');
  chasseur.querySelector('.global-market-product-trigger').click();
  const chasseurOffer = chasseur.querySelector('.global-market-offer');
  buttonByText(chasseurOffer, 'Acheter').click();
  await wait(20);
  assert.match(doc.getElementById('confirm-message').textContent, /VendeurInconnu/,
    'la confirmation nomme le vendeur');
  doc.getElementById('confirm-ok').click();
  await wait(200);
  assert.equal(store.playerSaves.me.coins, 550, 'les pièces sont débitées');
  assert.equal(store.playerSaves.me.collection.filter((id) => id === 'chasseur-royer').length, 1,
    'la carte achetée arrive dans ma collection');
  assert.equal(store.marketListings.strangerListing.status, 'sold');
  assert.equal(store.marketListings.strangerListing.buyerUid, 'me');
  assert.match(doc.getElementById('global-market-message').textContent, /Achat réussi/,
    'le message de résultat s’affiche dans le marché global');
  assert.doesNotMatch(doc.getElementById('global-market-list').textContent, /VendeurInconnu/,
    'les vendeurs restent dans le détail des produits, pas sur la page catalogue');

  w.close();
  console.log('PASS marché global : vendeurs inconnus, ajout en ami, filtre et achat direct');
})().catch((error) => { console.error(error); process.exitCode = 1; });
