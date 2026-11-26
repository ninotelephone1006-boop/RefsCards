// Run with NODE_PATH pointing to a local jsdom installation: node tests/profile-save.cjs
// Vérifie que le pseudo et la photo de profil sont bien persistés :
// - l'avatar du HUD (en haut de l'écran) suit la photo personnalisée, pas
//   seulement la photo Google (régression : il restait figé sur la photo
//   Google, donc la photo semblait « non sauvegardée ») ;
// - le pseudo est sauvegardé via le bouton « Enregistrer » ET automatiquement
//   après la frappe (sans attendre le bouton) ;
// - la photo téléversée est écrite dans le profil cloud et affichée partout ;
// - si la sauvegarde cloud échoue, l'ancienne valeur est restaurée et un
//   message d'erreur s'affiche (pas de faux « mis à jour » qui disparaît au
//   rechargement).
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

const denied = () => Object.assign(
  new Error('Missing or insufficient permissions.'),
  { code: 'permission-denied' }
);

function makeStore({ avatar = 'data:image/jpeg;base64,CUSTOMAVATAR' } = {}) {
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
        pseudo: 'AncienPseudo',
        avatar,
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
    trades: {}
  };
}

function makeFirestore(store, { failProfileSet = false } = {}) {
  const docRef = (coll, id) => ({
    get: async () => ({
      exists: Object.prototype.hasOwnProperty.call(store[coll] || {}, id),
      data: () => store[coll][id]
    }),
    set: async (data) => {
      if (failProfileSet && coll === 'playerProfiles') throw denied();
      store[coll][id] = { ...(store[coll][id] || {}), ...data };
    },
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

async function boot({ failProfileSet = false, avatar } = {}) {
  const store = makeStore({ avatar });
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
  w.HTMLCanvasElement.prototype.toDataURL = () => 'data:image/jpeg;base64,FAKEAVATAR';
  w.Sound = new Proxy({}, { get: () => noop });

  /* jsdom ne décode pas les images : on simule le chargement pour que
     resizeAvatar() aille jusqu'au canvas. */
  w.Image = class FakeImage {
    set src(value) {
      this._src = value;
      this.naturalWidth = 100;
      this.naturalHeight = 100;
      setTimeout(() => { if (this.onload) this.onload(); }, 0);
    }
    get src() { return this._src; }
  };

  const authState = { onChange: null };
  const auth = () => ({
    onAuthStateChanged(next) { authState.onChange = next; },
    getRedirectResult: () => Promise.resolve(null),
    signOut: () => Promise.resolve()
  });
  auth.GoogleAuthProvider = class { setCustomParameters() {} };
  w.firebase = { apps: [], initializeApp() {}, auth, firestore: () => makeFirestore(store, { failProfileSet }) };

  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  await wait(40);

  await authState.onChange({
    uid: 'me',
    email: 'moi@test',
    displayName: 'Moi',
    photoURL: 'https://google.test/photo.jpg'
  });
  await wait(150); // loadProfile : profil chargé puis réécrit dans le cloud
  return { w, doc: w.document, store };
}

function submitForm(w, form) {
  form.dispatchEvent(new w.Event('submit', { bubbles: true, cancelable: true }));
}

(async () => {
  const { w, doc, store } = await boot();

  /* 1. Au chargement, le HUD affiche la photo PERSONNALISÉE (pas la photo
        Google) et le pseudo sauvegardé. */
  assert.equal(doc.getElementById('account-avatar').src, 'data:image/jpeg;base64,CUSTOMAVATAR',
    'l’avatar du HUD doit être la photo personnalisée sauvegardée');
  assert.equal(doc.getElementById('account-avatar').hidden, false);
  assert.equal(doc.getElementById('account-email').textContent, 'AncienPseudo');
  console.log('PASS HUD = photo personnalisée et pseudo chargés depuis le cloud');

  /* 2. Changement de pseudo via le bouton : écrit dans le cloud + HUD. */
  doc.querySelector('[data-tab="account"]').click();
  await wait(30);
  assert.equal(doc.getElementById('profile-avatar').src, 'data:image/jpeg;base64,CUSTOMAVATAR');
  const pseudoInput = doc.getElementById('pseudo-input');
  pseudoInput.value = 'NouveauPseudo';
  submitForm(w, doc.getElementById('pseudo-form'));
  await wait(80);
  assert.equal(store.playerProfiles.me.pseudo, 'NouveauPseudo', 'le pseudo doit être écrit dans playerProfiles');
  assert.equal(doc.getElementById('account-email').textContent, 'NouveauPseudo');
  assert.match(doc.getElementById('profile-msg').textContent, /mis à jour/);
  console.log('PASS pseudo (bouton Enregistrer) = cloud + HUD mis à jour');

  /* 3. Auto-sauvegarde : taper un pseudo sans cliquer sur Enregistrer
        l'enregistre quand même après la frappe. */
  pseudoInput.value = 'AutoPseudo';
  pseudoInput.dispatchEvent(new w.Event('input', { bubbles: true }));
  await wait(1100); // délai d'auto-sauvegarde (800 ms) + écriture cloud
  assert.equal(store.playerProfiles.me.pseudo, 'AutoPseudo', 'le pseudo tapé doit être sauvegardé automatiquement');
  assert.equal(doc.getElementById('account-email').textContent, 'AutoPseudo');
  console.log('PASS pseudo (auto-sauvegarde à la frappe) = cloud mis à jour sans bouton');

  /* 4. Téléversement d'une photo : recadrée, écrite dans le cloud et
        affichée sur la page Compte ET dans le HUD. */
  const avatarInput = doc.getElementById('avatar-input');
  const file = new w.File(['fake-image'], 'photo.png', { type: 'image/png' });
  Object.defineProperty(avatarInput, 'files', { value: [file], configurable: true });
  avatarInput.dispatchEvent(new w.Event('change', { bubbles: true }));
  await wait(150);
  assert.equal(store.playerProfiles.me.avatar, 'data:image/jpeg;base64,FAKEAVATAR',
    'la photo doit être écrite dans playerProfiles');
  assert.equal(doc.getElementById('profile-avatar').src, 'data:image/jpeg;base64,FAKEAVATAR');
  assert.equal(doc.getElementById('account-avatar').src, 'data:image/jpeg;base64,FAKEAVATAR',
    'le HUD doit suivre la nouvelle photo');
  assert.match(doc.getElementById('profile-msg').textContent, /mise à jour/);
  console.log('PASS photo téléversée = cloud + page Compte + HUD mis à jour');

  /* 5. Le bouton « Utiliser ma photo Google » a disparu : la photo Google
        n'est plus utilisée comme repli d'avatar. */
  assert.equal(doc.getElementById('avatar-google-btn'), null,
    'le bouton « Utiliser ma photo Google » ne doit plus exister');
  assert.doesNotMatch(fs.readFileSync('index.html', 'utf8'), /photo Google/,
    'index.html ne propose plus la photo Google comme avatar');

  w.close();

  /* 5 bis. Compte SANS photo personnalisée : l'image de base du jeu est
     affichée partout (page Compte + HUD), et PAS la photo Google — même
     quand le compte Google en a une. */
  const bare = await boot({ avatar: '' });
  const bdoc = bare.doc;
  assert.match(bdoc.getElementById('account-avatar').src, /assets\/default-avatar\.png$/,
    'sans photo, le HUD affiche l’image de base du jeu');
  assert.equal(bdoc.getElementById('account-avatar').hidden, false,
    'l’image de base reste visible (plus de pastille ✦)');
  bdoc.querySelector('[data-tab="account"]').click();
  await wait(40);
  assert.match(bdoc.getElementById('profile-avatar').src, /assets\/default-avatar\.png$/,
    'sans photo, la page Compte affiche aussi l’image de base');
  assert.equal(bdoc.getElementById('profile-avatar').hidden, false);
  assert.doesNotMatch(bdoc.getElementById('profile-avatar').src, /google\.test/,
    'la photo Google ne sert plus de repli');
  bare.w.close();
  console.log('PASS sans photo = image de base du jeu (pas la photo Google), HUD + Compte');

  /* 6. Échec de la sauvegarde cloud : l'ancienne valeur est restaurée,
        un message d'erreur s'affiche, et aucun faux « mis à jour ». */
  const failing = await boot({ failProfileSet: true });
  const fdoc = failing.doc;
  fdoc.querySelector('[data-tab="account"]').click();
  await wait(30);
  const failingInput = fdoc.getElementById('pseudo-input');
  failingInput.value = 'EchecPseudo';
  submitForm(failing.w, fdoc.getElementById('pseudo-form'));
  await wait(100);
  assert.equal(failing.store.playerProfiles.me.pseudo, 'AncienPseudo',
    'le cloud garde l’ancien pseudo quand l’écriture échoue');
  assert.equal(fdoc.getElementById('account-email').textContent, 'AncienPseudo',
    'le HUD revient à l’ancien pseudo');
  assert.match(fdoc.getElementById('profile-msg').textContent, /Sauvegarde impossible/,
    'un message d’erreur doit expliquer l’échec');
  assert.doesNotMatch(fdoc.getElementById('toast').textContent, /Pseudo :/,
    'pas de toast de succès mensonger');
  failing.w.close();
  console.log('PASS échec cloud = ancienne valeur restaurée + message d’erreur, pas de faux succès');

  console.log('PASS profile-save : pseudo et photo persistés (bouton, auto-sauvegarde, HUD, échec)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
