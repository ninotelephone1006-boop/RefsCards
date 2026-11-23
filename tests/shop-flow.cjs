// Run with NODE_PATH pointing to a local jsdom installation: node tests/shop-flow.cjs
// Vérifie la boutique : prix équilibrés (500 / 1 000), achats multiples dans
// l'inventaire, 3 packs gratuits par jour, pack rare (raretés élevées boostées) et navigation
// « Aller au Shop » depuis le récap (plus d'achat direct à 100 🪙).
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeStore(save) {
  return {
    playerSaves: { me: save },
    playerProfiles: {},
    friendCodes: {},
    friendRequests: {},
    trades: {},
    marketListings: {},
    coinGifts: {}
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
  const query = (coll, field, value) => {
    const snap = () => ({
      docs: Object.entries(store[coll])
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

async function boot(save) {
  const store = makeStore(save);
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
  return { w, doc: w.document, store };
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

(async () => {
  /* 0. Fichiers de packs présents + prix dans le HTML. */
  assert.ok(fs.existsSync('assets/packet.png'), 'packet.png doit exister');
  assert.ok(fs.existsSync('assets/packetrare.png'), 'packetrare.png doit exister');
  assert.ok(fs.existsSync('assets/packetlegende.png'), 'packetlegende.png doit exister');
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /data-tab="shop"/, 'onglet Shop présent');
  assert.match(html, /id="shop-view"/, 'vue Shop présente');
  assert.match(html, /id="free-claim"/, 'bouton gratuit présent');
  assert.match(html, /packetrare\.png/, 'pack rare référencé');
  assert.match(html, /ALLER AU SHOP/, 'récap renvoie au Shop');
  assert.doesNotMatch(html, /OUVRIR UN BOOSTER/, 'plus d\'achat direct « Ouvrir un booster »');
  const appSrc = fs.readFileSync('app.js', 'utf8');
  assert.match(appSrc, /classic:\s*500/, 'pack classique à 500');
  assert.match(appSrc, /rare:\s*1000/, 'pack rare à 1000');
  assert.match(appSrc, /legend:\s*800/, 'pack légende à 800');
  assert.match(appSrc, /FREE_PER_DAY\s*=\s*3/, '3 gratuits par jour');
  assert.match(appSrc, /RARE_RANK_FACTOR_BASE/, 'pack rare : boost par rang (base)');
  assert.match(appSrc, /RARE_RANK_FACTOR_STEP/, 'pack rare : boost par rang (step)');
  assert.doesNotMatch(appSrc, /RARE_BOOST\s*=\s*1\.2/, 'ancien boost plat +20 % supprimé');
  console.log('PASS prix boutique (500 / 1 000), 3 gratuits, rare boost par rang');

  /* 1. Achat multiple : quantité 5 classique = 2 500 🪙, inventaire +5. */
  {
    const { w, doc, store } = await boot({
      coins: 3000, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 0, rare: 0 }, freeDate: todayKey(), freeUsed: 0
    });
    assert.equal(doc.getElementById('coins').textContent.replace(/\s/g, ' '), '3 000');
    // Quantité ×5 via le raccourci.
    doc.querySelector('.qty-chip[data-pack="classic"][data-qty="5"]').click();
    await wait(20);
    assert.equal(doc.getElementById('qty-classic').textContent, '5');
    assert.match(doc.getElementById('buy-classic').textContent.replace(/\s/g, ' '), /2 500/);
    doc.getElementById('buy-classic').click();
    await wait(400); // save différée (250 ms)
    assert.equal(doc.getElementById('coins').textContent.replace(/\s/g, ' '), '500', '3000 - 2500 = 500');
    assert.match(doc.getElementById('open-classic').textContent, /×5/);
    assert.match(doc.getElementById('shop-stock-classic').textContent, /5/);
    assert.equal(store.playerSaves.me.packStock.classic, 5, 'inventaire persisté');
    assert.equal(store.playerSaves.me.coins, 500, 'solde persisté');
    // Solde insuffisant : bouton désactivé pour ×10 (5 000).
    doc.querySelector('.qty-chip[data-pack="classic"][data-qty="10"]').click();
    await wait(20);
    assert.equal(doc.getElementById('buy-classic').disabled, true, 'bouton désactivé si solde insuffisant');
    w.close();
    console.log('PASS achat multiple (×5 classique) + inventaire persisté');
  }

  /* 2. Gratuits quotidiens : 3 récupérables, le 4e bloqué. */
  {
    const { w, doc, store } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 0, rare: 0 }, freeDate: todayKey(), freeUsed: 0
    });
    const claim = doc.getElementById('free-claim');
    assert.match(claim.textContent, /3 RESTANT/);
    claim.click(); await wait(30);
    claim.click(); await wait(30);
    claim.click(); await wait(30);
    assert.equal(claim.disabled, true, '4e gratuit bloqué le même jour');
    assert.match(claim.textContent, /ÉPUISÉS/);
    assert.match(doc.getElementById('open-classic').textContent, /×3/);
    await wait(400);
    assert.equal(store.playerSaves.me.packStock.classic, 3);
    assert.equal(store.playerSaves.me.freeUsed, 3);
    w.close();
    console.log('PASS 3 packs gratuits par jour, 4e bloqué');
  }

  /* 3. Quota d'hier réinitialisé aujourd'hui. */
  {
    const { w, doc } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 0, rare: 0 }, freeDate: '2000-01-01', freeUsed: 3
    });
    assert.equal(doc.getElementById('free-claim').disabled, false, 'nouveau jour = gratuits à nouveau');
    w.close();
    console.log('PASS quota gratuit réinitialisé le lendemain');
  }

  /* 4. Pack rare : sélection change l'image et les chances affichées. */
  {
    const { w, doc } = await boot({
      coins: 5000, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 1, rare: 1 }, freeDate: todayKey(), freeUsed: 0
    });
    doc.getElementById('open-rare').click();
    assert.equal(doc.getElementById('app').dataset.tab, 'pack');
    await wait(20);
    assert.match(doc.getElementById('pack-img-main').getAttribute('src'), /packetrare\.png/);
    const oddsText = doc.getElementById('pack-odds').textContent;
    assert.match(oddsText, /RARETÉS ÉLEVÉES PLUS FRÉQUENTES/);
    assert.doesNotMatch(oddsText, /\+20 %/);
    const pct = (key) => {
      const row = doc.querySelector(`#pack-odds .odds-${key}`);
      assert.ok(row, `ligne odds manquante: ${key}`);
      const m = row.textContent.match(/([0-9]+(?:[.,][0-9]+)?)\s*%/);
      assert.ok(m, `pourcentage introuvable pour ${key}`);
      return parseFloat(m[1].replace(',', '.'));
    };
    assert.ok(pct('rare') > pct('common'), 'rare doit être plus fréquent que commune en pack rare');
    assert.ok(pct('divine') > 1.5, 'divine doit être un peu plus fréquente en pack rare');
    assert.ok(pct('secret') > 0.5, 'secrète doit être un peu plus fréquente en pack rare');
    // Achat rare ×1 = 1 000 🪙.
    doc.getElementById('buy-rare').click();
    await wait(400);
    assert.equal(doc.getElementById('coins').textContent.replace(/\s/g, ' '), '4 000');
    assert.match(doc.getElementById('open-rare').textContent, /×2/);
    w.close();
    console.log('PASS pack rare : image dorée, raretés élevées boostées, achat 1 000');
  }

  /* 5. Pack légendaire : 10 cartes, 800 🪙, visible immédiatement dans l'onglet Inventaire et Pack sans recharger la page. */
  {
    const { w, doc, store } = await boot({
      coins: 1600, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 0, rare: 0, legend: 0 }, freeDate: todayKey(), freeUsed: 0
    });
    // Avant achat : inventaire vide et badge caché.
    assert.equal(doc.getElementById('tab-badge-inventory').hidden, true);
    assert.equal(doc.getElementById('inventory-empty').hidden, false);
    assert.equal(doc.getElementById('inventory-grid').hidden, true);

    doc.querySelector('[data-tab="shop"]').click();
    await wait(20);
    doc.querySelector('.qty-chip[data-pack="legend"][data-qty="1"]').click();
    await wait(20);
    assert.equal(doc.getElementById('qty-legend').textContent, '1');
    assert.match(doc.getElementById('buy-legend').textContent.replace(/\s/g, ' '), /800/);
    doc.getElementById('buy-legend').click();
    await wait(400);
    assert.equal(doc.getElementById('coins').textContent.replace(/\s/g, ' '), '800');
    assert.match(doc.getElementById('open-legend').textContent, /×1/);
    assert.match(doc.getElementById('shop-stock-legend').textContent, /1/);
    assert.equal(store.playerSaves.me.packStock.legend, 1, 'inventaire légende persisté');
    assert.equal(store.playerSaves.me.coins, 800, 'solde persisté');

    // Sans recharger la page, l'onglet Inventaire affiche immédiatement le pack Légende.
    doc.querySelector('[data-tab="inventory"]').click();
    await wait(20);
    assert.equal(doc.getElementById('tab-badge-inventory').hidden, false, 'badge Inventaire affiché pour un pack légende');
    assert.equal(doc.getElementById('inventory-empty').hidden, true, 'message vide masqué');
    assert.equal(doc.getElementById('inventory-grid').hidden, false, 'grille Inventaire visible');
    assert.match(doc.getElementById('inventory-summary').textContent, /1 pack prêt/);
    const legendCard = doc.querySelector('.inventory-card[data-pack-type="legend"]');
    assert.ok(legendCard, 'carte Booster Légende présente dans l\'inventaire');
    assert.match(legendCard.textContent, /×1/);
    assert.match(legendCard.textContent, /Booster Légende/);

    // Ouvrir depuis l'onglet Inventaire sélectionne et affiche le pack Légende (10 cartes).
    legendCard.querySelector('[data-open-pack="legend"]').click();
    await wait(20);
    assert.equal(doc.getElementById('app').dataset.tab, 'pack');
    assert.equal(doc.getElementById('pack-area').hidden, false, 'booster légende visible sans reload');
    assert.match(doc.getElementById('pack-img-main').getAttribute('src'), /packetlegende\.png/);
    assert.equal(doc.querySelectorAll('.gap-cards i').length, 10, '10 cartes dans le booster légende');
    assert.equal(doc.getElementById('pack-odds').textContent.indexOf('+20 %'), -1, 'pas de boost rare sur le pack légende');
    w.close();
    console.log('PASS pack légende : visible immédiatement dans Inventaire et Pack sans reload, 800 🪙, 10 cartes');
  }

  /* 6. Inventaire vide : bouton « Aller au Shop » visible dans l'onglet Pack. */
  {
    const { w, doc } = await boot({
      coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
      packStock: { classic: 0, rare: 0 }, freeDate: todayKey(), freeUsed: 3
    });
    assert.equal(doc.getElementById('pack-stock-label').textContent, 'Aucun booster');
    assert.equal(doc.getElementById('pack-area').hidden, true);
    assert.equal(doc.getElementById('open-classic').disabled, true);
    assert.equal(doc.getElementById('open-rare').disabled, true);
    assert.equal(doc.getElementById('pack-type-rare'), null);
    w.close();
    console.log('PASS inventaire vide → bouton Aller au Shop');
  }

  console.log('PASS shop flow (boutique, inventaire, gratuits, rare)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
