// Run with NODE_PATH pointing to a local jsdom installation: node tests/market-flow.cjs
// Vérifie le marché : mise en vente (cartes au prix et au nombre choisis),
// réservation, annulation, achat chez un ami depuis son profil, cadeaux
// de pièces et récupération des recettes.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore(collection = ['pieds-de-rapace', 'chasseur-royer'], coins = 500, packs = { classic: 0, rare: 0 }) {
  return {
    playerSaves: {
      me: {
        coins,
        firstPack: false,
        collection: [...collection],
        friends: ['friend1'],
        packsOpened: 3,
        packStock: { classic: packs.classic || 0, rare: packs.rare || 0, legend: packs.legend || 0 }
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
    trades: {}, marketListings: {}, marketOffers: {}, coinGifts: {}, coinFlips: {}
  };
}

function makeFirestore(store) {
  let nextId = 0;
  const docRef = (coll, id) => ({ coll, id,
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
      doc: (id) => docRef(coll, id || `generated${++nextId}`),
      where: (field, op, value) => query(coll, field, value)
    }),
    async runTransaction(fn) {
      const writes = [];
      const tx = {
        get: async (ref) => ({ exists: !!store[ref.coll][ref.id], data: () => structuredClone(store[ref.coll][ref.id]) }),
        set: (ref, data) => writes.push(() => { store[ref.coll][ref.id] = structuredClone(data); }),
        update: (ref, data) => {
          if (ref.coll === 'playerSaves') {
            assert.equal(data.packStock.legend, store.playerSaves[ref.id].packStock.legend,
              'toute transaction doit conserver les packs légendaires (champ requis par les règles)');
          }
          writes.push(() => { store[ref.coll][ref.id] = { ...store[ref.coll][ref.id], ...structuredClone(data) }; });
        }
      };
      const result = await fn(tx);
      writes.forEach((write) => write());
      return result;
    },
    // Pousse une mise à jour du store vers les abonnés onSnapshot.
    refresh(coll) {
      watchers.filter((w) => !coll || w.coll === coll).forEach((w) => w.cb());
    }
  };
}

async function boot(collection, coins, packs) {
  const store = makeStore(collection, coins, packs);
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
  const { w, doc, store } = await boot();
  const submit = async (form) => { submitForm(w, form); await wait(10); };
  const confirm = async () => { assert.equal(doc.getElementById('confirm-sheet').hidden, false); doc.getElementById('confirm-ok').click(); await wait(100); };
  doc.querySelector('[data-tab="online"]').click();
  await wait(30);
  // Une annonce réserve un exemplaire, et on peut la retirer.
  doc.getElementById('market-card').value = 'pieds-de-rapace';
  doc.getElementById('market-price').value = '123';
  await submit(doc.getElementById('market-list-form')); await confirm();
  let listing = Object.values(store.marketListings)[0];
  assert.equal(listing.price, 123); assert.equal(listing.status, 'open');
  assert.deepEqual(store.playerSaves.me.collection, ['chasseur-royer']);
  buttonByText(doc.getElementById('my-listings'), 'Retirer').click(); await wait(100);
  assert.equal(listing.status, 'open'); // mock update replaces the object
  assert.equal(Object.values(store.marketListings)[0].status, 'cancelled');
  assert.ok(store.playerSaves.me.collection.includes('pieds-de-rapace'));
  // Un cadeau est débité tout de suite, mais reste récupérable hors ligne.
  buttonByText(doc.querySelector('.friend-row'), 'Voir').click(); await wait(50);
  doc.getElementById('gift-amount').value = '75';
  await submit(doc.getElementById('gift-form')); await confirm();
  assert.equal(store.playerSaves.me.coins, 425);
  assert.equal(Object.values(store.coinGifts)[0].amount, 75);
  assert.equal(Object.values(store.coinGifts)[0].status, 'pending');
  doc.getElementById('gift-amount').value = '999';
  await submit(doc.getElementById('gift-form')); await confirm();
  assert.equal(store.playerSaves.me.coins, 425);
  assert.equal(Object.keys(store.coinGifts).length, 1);
  assert.match(doc.getElementById('market-message').textContent, /pas assez/);
  // Achat d'une annonce au prix choisi ; elle ne peut pas être achetée deux fois.
  store.marketListings.other = { sellerUid: 'friend1', cardId: 'chasseur-royer', price: 250, buyerUid: '', status: 'open' };
  doc.getElementById('market-refresh').click(); await wait(40);
  buttonByText(doc.getElementById('friend-listings'), 'Acheter').click(); await confirm();
  assert.equal(store.playerSaves.me.coins, 175);
  assert.equal(store.playerSaves.me.collection.filter(id => id === 'chasseur-royer').length, 2);
  assert.equal(store.marketListings.other.status, 'sold');
  assert.equal(store.marketListings.other.buyerUid, 'me');
  assert.match(doc.getElementById('friend-listings').textContent, /Aucune annonce/);
  // Une annonce affichée puis vendue entre-temps ne débite pas l'acheteur.
  store.marketListings.stale = { sellerUid: 'friend1', cardId: 'pieds-de-rapace', price: 20, buyerUid: '', status: 'open' };
  doc.getElementById('market-refresh').click(); await wait(40);
  buttonByText(doc.getElementById('friend-listings'), 'Acheter').click();
  store.marketListings.stale.status = 'sold';
  await confirm();
  assert.equal(store.playerSaves.me.coins, 175);
  assert.equal(store.playerSaves.me.collection.filter(id => id === 'pieds-de-rapace').length, 1);
  assert.match(doc.getElementById('market-message').textContent, /plus en vente/);
  // Le prix zéro est autorisé, comme n'importe quel prix entier valide.
  doc.getElementById('market-card').value = 'pieds-de-rapace';
  doc.getElementById('market-price').value = '0';
  await submit(doc.getElementById('market-list-form')); await confirm();
  assert.ok(Object.values(store.marketListings).some(l => l.sellerUid === 'me' && l.price === 0 && l.status === 'open'));
  // Récupération des recettes et cadeaux, une seule fois.
  store.marketListings.sold = { sellerUid: 'me', cardId: 'pieds-de-rapace', price: 33, buyerUid: 'friend1', status: 'sold' };
  store.coinGifts.incoming = { fromUid: 'friend1', toUid: 'me', amount: 22, status: 'pending' };
  doc.getElementById('market-refresh').click(); await wait(50);
  const claims = [...doc.querySelectorAll('#market-inbox button')]; assert.equal(claims.length, 2);
  claims[0].click(); await wait(100);
  buttonByText(doc.getElementById('market-inbox'), 'Récupérer').click(); await wait(100);
  assert.equal(store.playerSaves.me.coins, 230);
  assert.equal(store.marketListings.sold.status, 'completed');
  assert.equal(store.coinGifts.incoming.status, 'claimed');
  assert.equal(doc.querySelectorAll('#market-inbox button').length, 0);
  w.close(); console.log('PASS marché : réservation, annulation, cadeau, achat et récupération');

  /* 2. Choix de la quantité à vendre (pas tout d'un coup), retrait partiel/total et achat par quantité. */
  const s2 = await boot([
    'chasseur-royer', 'chasseur-royer', 'chasseur-royer', 'chasseur-royer', 'chasseur-royer',
    'pieds-de-rapace', 'pieds-de-rapace'
  ], 500);
  const w2 = s2.w;
  const doc2 = s2.doc;
  const store2 = s2.store;
  const submit2 = async (form) => { submitForm(w2, form); await wait(10); };
  const confirm2 = async () => { assert.equal(doc2.getElementById('confirm-sheet').hidden, false); doc2.getElementById('confirm-ok').click(); await wait(120); };

  doc2.querySelector('[data-tab="online"]').click();
  await wait(30);

  const cardSel = doc2.getElementById('market-card');
  const qtyInput = doc2.getElementById('market-qty');
  const qtyMinus = doc2.getElementById('market-qty-minus');
  const qtyPlus = doc2.getElementById('market-qty-plus');
  const qtyHint = doc2.getElementById('market-qty-hint');
  const submitBtn = doc2.getElementById('market-submit');

  cardSel.value = 'chasseur-royer';
  cardSel.dispatchEvent(new w2.Event('change', { bubbles: true }));
  assert.equal(qtyInput.value, '1', 'quantité par défaut = 1 (pas toute la pile)');
  assert.equal(qtyMinus.disabled, true);
  assert.equal(qtyPlus.disabled, false);
  assert.match(qtyHint.textContent, /1 sur 5.*restera 4/);

  qtyPlus.click();
  qtyPlus.click();
  assert.equal(qtyInput.value, '3');
  assert.match(qtyHint.textContent, /3 sur 5.*restera 2/);
  assert.match(submitBtn.textContent, /×3/);
  qtyMinus.click();
  assert.equal(qtyInput.value, '2');
  assert.match(qtyHint.textContent, /2 sur 5.*restera 3/);

  // Changer de carte réinitialise la quantité à 1.
  cardSel.value = 'pieds-de-rapace';
  cardSel.dispatchEvent(new w2.Event('change', { bubbles: true }));
  assert.equal(qtyInput.value, '1');
  assert.match(qtyHint.textContent, /1 sur 2.*restera 1/);

  // Quantité > stock ou <= 0 refusée sans rien vendre.
  cardSel.value = 'chasseur-royer';
  cardSel.dispatchEvent(new w2.Event('change', { bubbles: true }));
  doc2.getElementById('market-price').value = '40';
  qtyInput.value = '6';
  await submit2(doc2.getElementById('market-list-form'));
  assert.equal(doc2.getElementById('confirm-sheet').hidden, true);
  assert.match(doc2.getElementById('market-message').textContent, /ne possèdes que 5/);
  qtyInput.value = '0';
  await submit2(doc2.getElementById('market-list-form'));
  assert.equal(doc2.getElementById('confirm-sheet').hidden, true);
  assert.equal(Object.keys(store2.marketListings).length, 0);

  // Vendre exactement 2 exemplaires sur 5 laisse 3 exemplaires dans la collection.
  qtyInput.value = '2';
  await submit2(doc2.getElementById('market-list-form'));
  assert.match(doc2.getElementById('confirm-message').textContent, /2 exemplaires.*restera 3/);
  await confirm2();
  assert.equal(store2.playerSaves.me.collection.filter((id) => id === 'chasseur-royer').length, 3, 'il doit rester exactement 3 exemplaires');
  assert.equal(Object.values(store2.marketListings).filter((l) => l.status === 'open').length, 2, 'exactement 2 annonces créées');
  assert.equal(qtyInput.value, '1', 'la quantité revient à 1 après la mise en vente');
  assert.match(qtyHint.textContent, /1 sur 3.*restera 2/);

  // Mes annonces sont regroupées : on peut retirer 1 seul exemplaire sans tout annuler.
  assert.match(doc2.getElementById('my-listings').textContent, /×2/);
  buttonByText(doc2.getElementById('my-listings'), 'Retirer 1').click();
  await wait(120);
  assert.equal(store2.playerSaves.me.collection.filter((id) => id === 'chasseur-royer').length, 4);
  assert.equal(Object.values(store2.marketListings).filter((l) => l.status === 'open').length, 1);

  // Mettre 2 autres exemplaires au même prix (total 3 en vente), puis tout retirer.
  qtyInput.value = '2';
  await submit2(doc2.getElementById('market-list-form'));
  await confirm2();
  assert.equal(store2.playerSaves.me.collection.filter((id) => id === 'chasseur-royer').length, 2);
  assert.match(doc2.getElementById('my-listings').textContent, /×3/);
  buttonByText(doc2.getElementById('my-listings'), 'Tout retirer').click();
  await wait(150);
  assert.equal(store2.playerSaves.me.collection.filter((id) => id === 'chasseur-royer').length, 5);
  assert.equal(Object.values(store2.marketListings).filter((l) => l.status === 'open').length, 0);

  // Côté acheteur : choisir combien d'exemplaires acheter sur un lot d'un ami.
  buttonByText(doc2.querySelector('.friend-row'), 'Voir').click();
  await wait(50);
  store2.marketListings.f1 = { sellerUid: 'friend1', cardId: 'chasseur-royer', price: 30, buyerUid: '', status: 'open' };
  store2.marketListings.f2 = { sellerUid: 'friend1', cardId: 'chasseur-royer', price: 30, buyerUid: '', status: 'open' };
  store2.marketListings.f3 = { sellerUid: 'friend1', cardId: 'chasseur-royer', price: 30, buyerUid: '', status: 'open' };
  doc2.getElementById('market-refresh').click();
  await wait(50);
  const friendBox = doc2.getElementById('friend-listings');
  assert.match(friendBox.textContent, /×3 dispo/);
  const buyQty = friendBox.querySelector('.market-row-qty');
  assert.equal(buyQty.value, '1');
  friendBox.querySelectorAll('.market-row-btn')[1].click(); // +
  assert.equal(buyQty.value, '2');
  buttonByText(friendBox, 'Acheter').click();
  await wait(10);
  assert.match(doc2.getElementById('confirm-message').textContent, /2 exemplaires.*60/);
  await confirm2();
  assert.equal(store2.playerSaves.me.coins, 440);
  assert.equal(store2.playerSaves.me.collection.filter((id) => id === 'chasseur-royer').length, 7);
  assert.equal([store2.marketListings.f1, store2.marketListings.f2, store2.marketListings.f3].filter((l) => l.status === 'open').length, 1);

  // Solde insuffisant pour le lot demandé : aucun achat partiel.
  store2.marketListings.exp1 = { sellerUid: 'friend1', cardId: 'pieds-de-rapace', price: 300, buyerUid: '', status: 'open' };
  store2.marketListings.exp2 = { sellerUid: 'friend1', cardId: 'pieds-de-rapace', price: 300, buyerUid: '', status: 'open' };
  doc2.getElementById('market-refresh').click();
  await wait(50);
  const expRow = [...friendBox.querySelectorAll('.trade-row')].find((r) => r.textContent.includes('300'));
  expRow.querySelector('.market-row-qty').value = '2';
  buttonByText(expRow, 'Acheter').click();
  await wait(10);
  await confirm2();
  assert.equal(store2.playerSaves.me.coins, 440, 'aucun débit si le solde ne couvre pas la quantité choisie');
  assert.equal(store2.marketListings.exp1.status, 'open');
  assert.equal(store2.marketListings.exp2.status, 'open');
  assert.match(doc2.getElementById('market-message').textContent, /pas assez/);

  w2.close(); console.log('PASS marché : choix de la quantité à vendre, retrait partiel/total et achat par quantité');

  /* 3. Marché des packs : le vendeur choisit le type, le nombre et le prix. */
  const s3 = await boot(['pieds-de-rapace'], 500, { classic: 2, rare: 1, legend: 4 });
  const w3 = s3.w; const doc3 = s3.doc; const store3 = s3.store;
  const submit3 = async (form) => { submitForm(w3, form); await wait(10); };
  const confirm3 = async () => { assert.equal(doc3.getElementById('confirm-sheet').hidden, false); doc3.getElementById('confirm-ok').click(); await wait(150); };
  doc3.querySelector('[data-tab="online"]').click();
  await wait(30);

  const typeSel = doc3.getElementById('pack-market-type');
  const packQty = doc3.getElementById('pack-market-qty');
  const packPlus = doc3.getElementById('pack-market-qty-plus');
  const packHint = doc3.getElementById('pack-market-qty-hint');
  assert.equal(packQty.value, '1');
  packPlus.click();
  assert.equal(packQty.value, '2');
  assert.match(packHint.textContent, /2 sur 2.*restera 0/);

  // Mettre 2 packs classiques en vente : le stock est réservé à la liste.
  doc3.getElementById('pack-market-price').value = '77';
  await submit3(doc3.getElementById('pack-market-form'));
  assert.match(doc3.getElementById('confirm-message').textContent, /2.*Pack Classique.*77/);
  await confirm3();
  assert.equal(store3.playerSaves.me.packStock.classic, 0);
  const packListings = Object.values(store3.marketListings).filter((l) => l.packType === 'classic');
  assert.equal(packListings.length, 2);
  assert.ok(packListings.every((l) => l.price === 77 && l.status === 'open'));
  assert.match(doc3.getElementById('my-listings').textContent, /Pack Classique/);
  assert.match(doc3.getElementById('my-listings').textContent, /×2/);

  // Retirer l'annonce rend les packs au stock.
  buttonByText(doc3.getElementById('my-listings'), 'Tout retirer').click();
  await wait(150);
  assert.equal(store3.playerSaves.me.packStock.classic, 2);
  assert.equal(Object.values(store3.marketListings).filter((l) => l.status === 'open').length, 0);

  // Vendre un pack Rare doré gratuit (prix 0) : autorisé comme tout prix entier.
  typeSel.value = 'rare';
  typeSel.dispatchEvent(new w3.Event('change', { bubbles: true }));
  assert.equal(packQty.value, '1', 'changer de type réinitialise la quantité');
  doc3.getElementById('pack-market-price').value = '0';
  await submit3(doc3.getElementById('pack-market-form'));
  await confirm3();
  assert.equal(store3.playerSaves.me.packStock.rare, 0);
  assert.ok(Object.values(store3.marketListings).some((l) => l.packType === 'rare' && l.price === 0 && l.status === 'open'));

  // Achat côté ami d'un pack mis en vente : le pack va dans l'inventaire, pas les cartes.
  store3.marketListings.frare = { sellerUid: 'friend1', packType: 'rare', price: 90, buyerUid: '', status: 'open' };
  buttonByText(doc3.querySelector('.friend-row'), 'Voir').click(); await wait(60);
  doc3.getElementById('market-refresh').click(); await wait(50);
  const friendBox3 = doc3.getElementById('friend-listings');
  assert.match(friendBox3.textContent, /Pack Rare doré/);
  assert.match(friendBox3.textContent, /90/);
  buttonByText(friendBox3, 'Acheter').click();
  await wait(10);
  assert.match(doc3.getElementById('confirm-message').textContent, /Pack Rare doré/);
  await confirm3();
  assert.equal(store3.playerSaves.me.coins, 410);
  assert.equal(store3.playerSaves.me.packStock.rare, 1, 'le pack acheté arrive dans l’inventaire');
  assert.equal(store3.marketListings.frare.status, 'sold');
  assert.equal(store3.marketListings.frare.buyerUid, 'me');
  assert.equal(store3.playerSaves.me.packStock.legend, 4, 'les packs légendaires sont conservés après ventes, retraits et achat');
  w3.close(); console.log('PASS marché des packs : mise en vente, retrait, prix libre et achat chez l’ami');
})().catch(error => { console.error(error); process.exitCode = 1; });
