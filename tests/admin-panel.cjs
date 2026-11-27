// Tests du panneau d'administration (page Compte).
// - Invisible pour un joueur normal : la section reste masquée.
// - Visible uniquement pour le compte propriétaire (ADMIN_EMAIL).
// - Les actions (pièces, boosters ouverts, don de packs, don de cartes)
//   modifient l'état et sont persistées dans la sauvegarde cloud privée,
//   sans notification ni annonce visible par les autres joueurs.
// - Le panneau est masqué à la déconnexion (jamais visible par un autre
//   compte sur le même appareil).
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const ADMIN_EMAIL = 'ninotelephone1006@gmail.com';

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
    trades: {}, marketListings: {}, marketOffers: {}, coinGifts: {}, coinFlips: {}
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

async function boot(email) {
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
  await wait(150); // chargement du profil + premiers rendus
  return { w, doc: w.document, store, authState };
}

(async () => {
  /* 1. Un joueur normal ne voit JAMAIS le panneau : la section reste masquée
        même sur l'onglet Compte. */
  {
    const { w, doc } = await boot('joueur.lambda@example.com');
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    assert.equal(doc.getElementById('admin-panel').hidden, true,
      'le panneau admin doit rester masqué pour un joueur normal');
    w.close();
    console.log('PASS joueur normal : panneau admin invisible');
  }

  /* 2. Le compte propriétaire voit le panneau, pré-rempli avec son état. */
  {
    const { w, doc } = await boot(ADMIN_EMAIL);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    assert.equal(doc.getElementById('admin-panel').hidden, false,
      'le panneau admin doit être visible pour le compte propriétaire');
    assert.equal(doc.getElementById('admin-coins').value, '500',
      'le champ pièces reflète le solde actuel');
    assert.equal(doc.getElementById('admin-packs-opened').value, '3',
      'le champ boosters reflète le compteur actuel');
    assert.ok(doc.getElementById('admin-card').options.length > 50,
      'la liste des cartes à donner est remplie');
    w.close();
    console.log('PASS propriétaire : panneau visible et synchronisé');
  }

  /* 3. Définir les pièces et le compteur de boosters : état + cloud. */
  {
    const { w, doc, store } = await boot(ADMIN_EMAIL);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    doc.getElementById('admin-coins').value = '987654';
    doc.getElementById('admin-coins-set').click();
    await wait(400); // délai de sauvegarde (250 ms) + écriture cloud
    assert.equal(store.playerSaves.me.coins, 987654, 'pièces persistées dans playerSaves');
    assert.match(doc.getElementById('coins').textContent.replace(/[\s ]/g, ''), /987654/,
      'le HUD affiche le nouveau solde');
    assert.match(doc.getElementById('admin-msg').textContent, /987/);

    doc.getElementById('admin-packs-opened').value = '4321';
    doc.getElementById('admin-packs-opened-set').click();
    await wait(400);
    assert.equal(store.playerSaves.me.packsOpened, 4321, 'compteur de boosters persisté');
    w.close();
    console.log('PASS pièces et boosters ouverts modifiés et sauvegardés');
  }

  /* 4. Don de packs : stock d'inventaire crédité et sauvegardé. */
  {
    const { w, doc, store } = await boot(ADMIN_EMAIL);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    doc.getElementById('admin-pack-type').value = 'legend';
    doc.getElementById('admin-pack-qty').value = '7';
    doc.getElementById('admin-pack-give').click();
    await wait(400);
    assert.equal(store.playerSaves.me.packStock.legend, 7, 'packs légende sauvegardés dans le cloud');
    w.close();
    console.log('PASS don de packs : inventaire crédité et persisté');
  }

  /* 5. Don de cartes (normales et shiny) : collection créditée et sauvegardée. */
  {
    const { w, doc, store } = await boot(ADMIN_EMAIL);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    const select = doc.getElementById('admin-card');
    select.value = select.options[select.options.length - 1].value; // une carte rare du bas de liste
    const cardId = select.value;
    doc.getElementById('admin-card-qty').value = '2';
    doc.getElementById('admin-card-give').click();
    await wait(400);
    const saved = store.playerSaves.me.collection;
    assert.equal(saved.filter((id) => id === cardId).length, 2, 'deux exemplaires donnés et persistés');

    doc.getElementById('admin-card-shiny').checked = true;
    doc.getElementById('admin-card-qty').value = '1';
    doc.getElementById('admin-card-give').click();
    await wait(400);
    assert.ok(store.playerSaves.me.collection.includes(`${cardId}::shiny`),
      'la variante shiny est donnée et persistée');
    w.close();
    console.log('PASS don de cartes (normale + shiny) : collection créditée et persistée');
  }

  /* 6. Éditeur de chapeaux : choisir ou taper « chapeau one piece » affiche
        bien le chapeau One Piece (et jamais le chapeau de Noël), et enregistre
        son propre réglage dans playerProfiles.decoLayout. */
  {
    const { w, doc, store } = await boot(ADMIN_EMAIL);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    const select = doc.getElementById('admin-deco-select');
    const hat = doc.getElementById('admin-deco-hat');
    assert.ok(select && hat, 'sélecteur et aperçu de chapeau présents');

    /* Sélection directe (mobile / souris) de chaque chapeau, dont One Piece. */
    select.value = 'chapeau-onepiece';
    select.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal(hat.getAttribute('src'), 'assets/deco/chapeau-onepiece.png',
      'choisir Chapeau One Piece doit afficher chapeau-onepiece.png');
    assert.equal(hat.dataset.deco, 'chapeau-onepiece');

    /* Frappe clavier « chapeau one piece » sur le sélecteur : ne doit pas
       retomber sur le chapeau de Noël à cause du mot « Chapeau » ou des espaces. */
    select.value = 'chapeau-cowboy';
    select.dispatchEvent(new w.Event('change', { bubbles: true }));
    assert.equal(hat.getAttribute('src'), 'assets/deco/chapeau-cowboy.png');
    for (const ch of 'chapeau one piece') {
      select.dispatchEvent(new w.KeyboardEvent('keydown', { key: ch, bubbles: true, cancelable: true }));
    }
    assert.equal(select.value, 'chapeau-onepiece',
      'taper « chapeau one piece » sélectionne bien chapeau-onepiece');
    assert.equal(hat.getAttribute('src'), 'assets/deco/chapeau-onepiece.png',
      'taper « chapeau one piece » affiche chapeau-onepiece.png et pas Noël');

    /* Modification de la place du chapeau One Piece et publication globale. */
    const sliderX = doc.getElementById('admin-deco-x');
    const sliderY = doc.getElementById('admin-deco-y');
    sliderX.value = '48';
    sliderX.dispatchEvent(new w.Event('input', { bubbles: true }));
    sliderY.value = '62';
    sliderY.dispatchEvent(new w.Event('input', { bubbles: true }));
    assert.equal(hat.style.getPropertyValue('--deco-x'), '48%');
    assert.equal(hat.style.getPropertyValue('--deco-y'), '62%');

    doc.getElementById('admin-deco-save').click();
    await wait(100);
    assert.ok(store.playerProfiles.me.decoLayout, 'decoLayout publié sur le profil créateur');
    assert.deepEqual({ ...store.playerProfiles.me.decoLayout['chapeau-onepiece'] }, {
      x: 48, y: 62, scale: 1, rotate: -11
    }, 'le réglage propre au chapeau One Piece est sauvegardé');
    assert.deepEqual({ ...store.playerProfiles.me.decoLayout['chapeau-noel'] }, {
      x: 54, y: 54, scale: 1, rotate: -11
    }, 'le réglage du chapeau de Noël reste intact');
    w.close();
    console.log('PASS éditeur de chapeaux : sélection et frappe « chapeau one piece » + sauvegarde');
  }

  /* 7. Déconnexion : le panneau est masqué, impossible à retrouver pour le
        compte suivant sur le même appareil. */
  {
    const { w, doc, authState } = await boot(ADMIN_EMAIL);
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    assert.equal(doc.getElementById('admin-panel').hidden, false);
    await authState.onChange(null); // déconnexion
    await wait(30);
    assert.equal(doc.getElementById('admin-panel').hidden, true,
      'le panneau admin doit être masqué après la déconnexion');
    w.close();
    console.log('PASS déconnexion : panneau admin masqué');
  }

  console.log('✅ admin-panel: tous les tests passent');
})().catch((error) => {
  console.error('❌ admin-panel:', error);
  process.exit(1);
});
