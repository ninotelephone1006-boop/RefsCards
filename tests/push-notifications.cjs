// Run with NODE_PATH pointing to a local jsdom installation: node tests/push-notifications.cjs
// Vérifie les notifications « hors jeu » (vraies notifications du téléphone) :
// - push.js : catégories, préférences par compte (localStorage), filtres
//   (catégorie décochée, jeu au premier plan), permission, service worker ;
// - l'interface : fenêtre « Quelles notifications veux-tu recevoir ? », ligne
//   d'accès dans la cloche, rappel dans la page Compte, activation / test ;
// - l'intégration : une quête prête n'envoie une notification système que si
//   le joueur l'a demandée ET si le jeu n'est pas sous ses yeux ;
// - sw.js : affichage et clic sur la notification, service worker sans cache.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const SW_SOURCE = fs.readFileSync('sw.js', 'utf8');

/* ---------------------------------------------------------------- helpers */

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
      exists: Object.prototype.hasOwnProperty.call(store[coll] || {}, id),
      data: () => (store[coll] || {})[id]
    }),
    set: async (data) => { (store[coll] = store[coll] || {})[id] = { ...(store[coll] || {})[id], ...data }; },
    update: async (patch) => { (store[coll] = store[coll] || {})[id] = { ...(store[coll] || {})[id], ...patch }; }
  });
  const query = (coll, field, value) => {
    const snap = () => ({
      docs: Object.entries(store[coll] || {})
        .filter(([, d]) => d && d[field] === value)
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

/* Faux `Notification` du navigateur : la permission est pilotée par le test et
   chaque notification réellement affichée est enregistrée. */
function makeNotificationClass(win, { permission = 'default', request = null } = {}) {
  const sent = [];
  function FakeNotification(title, options) {
    sent.push({ title, options: options || {}, via: 'constructor' });
    this.title = title;
    this.close = () => { this.closed = true; };
  }
  FakeNotification.permission = permission;
  FakeNotification.requestPermission = async () => {
    FakeNotification.permission = request || 'granted';
    return FakeNotification.permission;
  };
  win.Notification = FakeNotification;
  return sent;
}

async function boot(save, { notification = {}, visibility = 'visible', serviceWorker = null } = {}) {
  const store = makeStore(save);
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  Object.defineProperty(w.document, 'visibilityState', { value: visibility, configurable: true });
  Object.defineProperty(w.document, 'hidden', { value: visibility === 'hidden', configurable: true });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  const sent = makeNotificationClass(w, notification);
  const shown = [];   // notifications passées au service worker
  const registered = [];
  if (serviceWorker) {
    w.navigator.serviceWorker = {
      register: async (url, options) => {
        registered.push({ url, options });
        return {
          scope: options && options.scope,
          showNotification: async (title, options) => { shown.push({ title, options: options || {}, via: 'sw' }); },
          active: { state: 'activated' }
        };
      },
      ready: Promise.resolve({})
    };
  }
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
  vm.runInContext(fs.readFileSync('push.js', 'utf8'), context);
  /* app.js n'expose pas ses fonctions : on injecte un petit point d'entrée
     pour piloter les compteurs (comme tests/quest-flow.cjs). */
  const hook = `
    window.__push = {
      questState,
      track: trackProgress,
      setPackOpened(n) { state.packsOpened = n; },
      notify: notifyOutOfGame,
      ask: maybeAskPush,
      flush() {
        window.clearTimeout(pushAskTimer);
        pushAskTimer = 0;
        maybeAskPush();
      },
      render: renderPush,
      open: openPushSheet,
      uid: pushUid
    };
  })();
  `;
  vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/\}\)\(\);\s*$/, hook), context);
  await wait(40);
  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(250);
  /* La question des notifications est programmée 6,5 s après l'entrée dans le
     jeu (pour laisser passer les annonces) : on la déclenche tout de suite,
     plusieurs fois si une annonce l'a repoussée. */
  await flushAsk(w);
  return { w, doc: w.document, store, sent, shown, registered, authState };
}

/* Déclenche la question des notifications jusqu'à ce qu'elle soit posée (ou
   abandonnée) : les annonces du jour peuvent la repousser une ou deux fois. */
async function flushAsk(w, tries = 4) {
  for (let i = 0; i < tries; i++) {
    w.__push.flush();
    await wait(60);
    if (w.RefsPush.prefs('me').asked) return;
  }
}

const freshSave = () => ({
  coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
  packStock: { classic: 3, rare: 0, legend: 0, video: 0 }
});

(async () => {
  /* ---------- 1. push.js seul : catégories, préférences, filtres. ---------- */
  {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://refs-cards.test/', runScripts: 'outside-only' });
    const w = dom.window;
    /* jsdom démarre en « prerender » (document.hidden = true) : on simule un
       onglet visible, puis un onglet en arrière-plan. */
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
    const sent = makeNotificationClass(w, { permission: 'granted' });
    vm.runInContext(fs.readFileSync('push.js', 'utf8'), dom.getInternalVMContext());
    const P = w.RefsPush;
    assert.ok(P, 'window.RefsPush exposé');
    assert.equal(P.KINDS.length, 8, 'huit catégories proposées');
    assert.equal(P.KIND_IDS.join(','),
      'quests,achievements,levels,friends,market,games,gift,news',
      'ids de catégories stables');
    assert.ok(P.KINDS.every((k) => k.icon && k.label && k.desc), 'chaque catégorie est décrite');

    /* Par défaut : rien n'est actif, et le marketing est décoché. */
    const base = P.prefs('moi');
    assert.equal(base.enabled, false, 'désactivé par défaut');
    assert.equal(base.kinds.news, false, 'nouveautés/promos décochées par défaut');
    assert.equal(base.kinds.quests, true, 'quêtes cochées par défaut');

    /* Préférences par compte, persistées dans le navigateur. */
    P.setEnabled('moi', true);
    P.setKind('moi', 'market', false);
    const saved = P.prefs('moi');
    assert.equal(saved.enabled, true);
    assert.equal(saved.kinds.market, false, 'catégorie décochée conservée');
    assert.equal(P.prefs('autre').enabled, false, 'les réglages ne fuient pas d’un compte à l’autre');
    assert.equal(P.enabledKindCount('moi'), 6, 'six catégories actives sur huit');
    assert.equal(P.kindEnabled('moi', 'quests'), true);
    assert.equal(P.kindEnabled('moi', 'market'), false, 'catégorie décochée = rien à envoyer');

    /* Jeu au premier plan : aucune notification système (la cloche suffit). */
    assert.equal(P.pageVisible(), true, 'page visible');
    /* Onglet en arrière-plan : c'est là (et seulement là) que le téléphone
       reçoit la notification. */
    assert.equal(P.KINDS.length, 8);
    await P.notify({ uid: 'moi', kind: 'quests', title: 'Quête prête', body: 'Test' });
    assert.equal(sent.length, 0, 'aucune notification quand le jeu est sous les yeux');
    await P.notify({ uid: 'moi', kind: 'quests', title: 'Quête prête', body: 'Test', force: true });
    assert.equal(sent.length, 1, 'le bouton « Tester » force l’affichage');
    assert.match(sent[0].title, /Quête prête/);
    assert.equal(sent[0].options.icon, 'assets/icons/icon-192.png', 'icône du jeu dans la notification');
    assert.equal(sent[0].options.tag, 'refs-quests', 'regroupement par catégorie');

    /* Onglet en arrière-plan : c'est le cas « hors jeu ». Une catégorie
       décochée est ignorée, les autres partent. */
    Object.defineProperty(w.document, 'visibilityState', { value: 'hidden', configurable: true });
    Object.defineProperty(w.document, 'hidden', { value: true, configurable: true });
    assert.equal(P.pageVisible(), false, 'onglet en arrière-plan');
    await P.notify({ uid: 'moi', kind: 'market', title: 'Vente', body: 'x' });
    assert.equal(sent.length, 1, 'une catégorie décochée n’envoie rien');
    await P.notify({ uid: 'moi', kind: 'quests', title: 'Quête prête', body: 'x' });
    assert.equal(sent.length, 2, 'une catégorie cochée part bien hors jeu');
    assert.equal(sent[1].options.body, 'x');
    /* Tout couper d'un coup. */
    P.setEnabled('moi', false);
    await P.notify({ uid: 'moi', kind: 'quests', title: 'Quête', body: 'x' });
    assert.equal(sent.length, 2, 'notifications coupées = aucun envoi');

    /* Permission refusée par le navigateur. */
    P.setEnabled('moi', true);
    w.Notification.permission = 'denied';
    assert.equal(P.canNotify(), false, 'permission refusée = pas d’envoi');
    assert.equal(await P.notify({ uid: 'moi', kind: 'quests', title: 'x' }), false);
    assert.equal(sent.length, 2, 'aucune tentative quand la permission est refusée');

    /* État du support : https, API présente, service worker absent. */
    const info = P.support();
    assert.equal(info.api, true);
    assert.equal(info.secure, true, 'https = contexte sûr');
    assert.equal(info.serviceWorker, false, 'pas de service worker dans jsdom');
    assert.equal(info.needsInstall, false, 'pas d’iPhone ici');
    assert.equal(info.permission, 'denied');
    dom.window.close();
    console.log('PASS push.js : catégories, préférences par compte, filtres hors jeu, permission');
  }

  /* ---------- 2. Service worker : notification et clic. ---------- */
  {
    assert.doesNotMatch(SW_SOURCE, /fetch\s*\(/, 'sw.js n’intercepte aucune requête (pas de cache)');
    assert.match(SW_SOURCE, /notificationclick/, 'clic sur une notification géré');
    assert.match(SW_SOURCE, /showNotification/, 'affichage des notifications');
    assert.match(SW_SOURCE, /addEventListener\('push'/, 'prêt pour un vrai serveur de push (FCM)');
    const handlers = {};
    let opened = null;
    const clients = [];
    const self = {
      addEventListener: (type, fn) => { handlers[type] = fn; },
      skipWaiting: () => {},
      registration: { showNotification: async (title, options) => { clients.push({ title, options }); } },
      clients: {
        claim: () => Promise.resolve(),
        matchAll: async () => [],
        openWindow: async (url) => { opened = url; return null; }
      }
    };
    const context = vm.createContext({ self, Promise, JSON, Object });
    vm.runInContext(SW_SOURCE, context);
    assert.equal(typeof handlers.notificationclick, 'function');
    let waited = null;
    handlers.notificationclick({
      notification: { close() {}, data: { url: './?tab=quests' } },
      waitUntil: (p) => { waited = p; }
    });
    await waited;
    assert.equal(opened, './?tab=quests', 'le clic ouvre le jeu sur la bonne page');

    let pushed = null;
    handlers.push({
      data: { json: () => ({ title: 'Demande d’ami', body: 'Nino veut t’ajouter', url: './' }) },
      waitUntil: (p) => { pushed = p; }
    });
    await pushed;
    assert.equal(clients[clients.length - 1].title, 'Demande d’ami', 'push serveur affiché tel quel');
    console.log('PASS sw.js : notification, clic → retour au jeu, aucun cache, écoute push');
  }

  /* ---------- 3. Interface : la question « quelles notifications ? ». ---------- */
  {
    const { w, doc } = await boot(freshSave(), { notification: { permission: 'default', request: 'granted' }, serviceWorker: true });
    const sheet = doc.getElementById('push-sheet');
    assert.ok(sheet, 'fenêtre de réglages présente');

    /* Première visite : la question s'ouvre toute seule, une seule fois. */
    assert.equal(sheet.hidden, false, 'la question « quelles notifications ? » s’ouvre à la première visite');
    assert.equal(w.RefsPush.prefs('me').asked, true, 'question marquée comme posée');
    assert.match(doc.getElementById('push-msg').textContent, /Choisis/, 'texte d’explication présent');
    assert.equal(doc.querySelectorAll('.push-kind').length, 8, 'huit catégories proposées');
    doc.querySelector('#push-sheet [data-close-push]').click();
    await wait(20);
    assert.equal(sheet.hidden, true, 'on peut répondre « Plus tard »');
    w.__push.ask();
    await wait(20);
    assert.equal(sheet.hidden, true, 'la question ne revient pas à chaque visite');
    assert.ok(Object.prototype.hasOwnProperty.call(w.RefsPush.prefs('me'), 'asked'), 'mémoire de la question par compte');

    /* Elle s'ouvre depuis le Compte, avec une ligne par catégorie. */
    doc.querySelector('[data-tab="account"]').click();
    await wait(30);
    assert.equal(doc.getElementById('stats-grid').children.length, 10, 'statistiques inchangées');
    const settings = doc.querySelector('.notif-settings');
    assert.ok(settings, 'réglage « Notifications du téléphone » dans la page Compte');
    assert.match(doc.getElementById('push-summary').textContent, /Désactivées/);
    doc.getElementById('notif-settings-open').click();
    await wait(30);
    assert.equal(sheet.hidden, false, 'fenêtre ouverte depuis le Compte (ou la cloche)');
    assert.equal(doc.querySelectorAll('.push-kind-input').length, 8, 'huit interrupteurs');
    const questBox = doc.querySelector('[data-push-kind="quests"]');
    const newsBox = doc.querySelector('[data-push-kind="news"]');
    assert.equal(questBox.checked, true, 'quêtes cochées');
    assert.equal(newsBox.checked, false, 'promos décochées');

    /* Décocher une catégorie est retenu (et survit à la fermeture). */
    questBox.checked = false;
    questBox.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(20);
    assert.equal(w.RefsPush.prefs('me').kinds.quests, false, 'catégorie décochée enregistrée');
    /* La liste est reconstruite : on reprend la nouvelle case « quêtes ». */
    const questBoxAgain = doc.querySelector('[data-push-kind="quests"]');
    assert.equal(questBoxAgain.checked, false, 'la case reflète le réglage enregistré');
    questBoxAgain.checked = true;
    questBoxAgain.dispatchEvent(new w.Event('change', { bubbles: true }));
    await wait(20);
    assert.equal(w.RefsPush.prefs('me').kinds.quests, true, 'case recochée enregistrée');

    /* Activation : permission demandée, préférence enregistrée, message envoyé. */
    doc.getElementById('push-enable').click();
    await wait(120);
    assert.equal(w.Notification.permission, 'granted', 'permission demandée à l’activation seulement');
    assert.equal(w.RefsPush.prefs('me').enabled, true, 'notifications activées pour ce compte');
    assert.equal(doc.getElementById('push-enable').hidden, true, 'bouton « Activer » masqué');
    assert.equal(doc.getElementById('push-disable').hidden, false, 'bouton « Désactiver » visible');
    assert.equal(doc.getElementById('push-test').hidden, false, 'bouton « Tester » visible');
    assert.match(doc.getElementById('push-msg').textContent, /(activées|bienvenue)/i, 'confirmation d’activation');
    assert.match(doc.getElementById('push-summary').textContent, /Activées :/, 'résumé des catégories sur la page Compte');
    assert.equal(doc.getElementById('notif-phone-state').textContent, 'Activées', 'ligne de la cloche à jour');
    assert.equal(w.RefsPush.enabledKindCount('me'), 7, 'sept catégories actives (promos décochées)');

    /* Test : une notification passe par le service worker. */
    doc.getElementById('push-test').click();
    await wait(150);
    assert.match(doc.getElementById('push-msg').textContent, /[Tt]est/, 'retour du bouton « Tester »');
    /* Désactivation : plus rien n'est envoyé. */
    doc.getElementById('push-disable').click();
    await wait(40);
    assert.equal(w.RefsPush.prefs('me').enabled, false, 'désactivation enregistrée');
    assert.match(doc.getElementById('push-msg').textContent, /désactivées/i);
    assert.equal(doc.getElementById('push-enable').hidden, false, 'bouton « Activer » revenu');
    doc.querySelector('#push-sheet [data-close-push]').click();
    await wait(20);
    assert.equal(sheet.hidden, true, 'fenêtre refermée');
    w.close();
    console.log('PASS interface : question, huit catégories, activation, test, désactivation');
  }

  /* ---------- 4. Intégration : quêtes, catégories et visibilité. ---------- */
  {
    const { w, doc, shown, registered } = await boot(freshSave(), {
      notification: { permission: 'granted' }, visibility: 'hidden', serviceWorker: true
    });
    /* Le jeu est en arrière-plan : les évènements partent en notification. */
    assert.equal(w.RefsPush.pageVisible(), false, 'onglet en arrière-plan');
    w.RefsPush.setEnabled('me', true);
    w.__push.setPackOpened(1);
    w.__push.track();
    await wait(80);
    assert.ok(registered.length >= 1, 'service worker enregistré (notifications Android)');
    assert.equal(registered[0].url, './sw.js', 'service worker = sw.js');
    assert.ok(shown.length >= 1, 'une vraie notification est partie');
    assert.ok(shown.some((n) => /Quête accomplie/.test(n.title)), 'titre de la notification de quête');
    const questNotif = shown.find((n) => /Quête accomplie/.test(n.title));
    assert.equal(questNotif.options.tag, 'refs-quests', 'regroupement par catégorie (pas de rafale de bannières)');
    assert.ok(doc.querySelectorAll('.notif-row').length === 0, 'la cloche n’a pas été ouverte par le test');
    assert.equal(doc.getElementById('notif-badge').hidden, false, 'la cloche interne a bien une pastille');
    assert.ok(w.__push.questState.notifications.length >= 1, 'la cloche interne est alimentée aussi');

    /* Catégorie décochée : la cloche reçoit toujours, le téléphone non. */
    const before = shown.length;
    w.RefsPush.setKind('me', 'quests', false);
    w.RefsPush.setKind('me', 'achievements', false);
    w.__push.setPackOpened(0);
    w.__push.track();
    await wait(60);
    assert.equal(shown.length, before, 'catégories décochées = aucune notification système');

    /* Jeu au premier plan : silence côté téléphone (la cloche suffit). */
    Object.defineProperty(w.document, 'visibilityState', { value: 'visible', configurable: true });
    Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
    Object.defineProperty(w.document, 'hidden', { value: false, configurable: true });
    w.RefsPush.setKind('me', 'quests', true);
    w.RefsPush.setKind('me', 'achievements', true);
    w.__push.notify('quest', 'Test premier plan', 'Rien ne doit partir.');
    await wait(60);
    assert.equal(shown.length, before, 'aucune notification système quand le jeu est visible');
    w.close();
    console.log('PASS intégration : hors jeu = notification système, catégories respectées, premier plan silencieux');
  }

  /* ---------- 5. Dégradations : sans push.js, sans permission. ---------- */
  {
    /* Permission refusée : le panneau l'explique et rien n'est demandé. */
    const { w, doc } = await boot(freshSave(), { notification: { permission: 'denied' } });
    doc.querySelector('[data-tab="account"]').click();
    await wait(20);
    doc.getElementById('notif-settings-open').click();
    await wait(20);
    assert.match(doc.getElementById('push-system-msg').textContent, /bloquées/i,
      'permission refusée expliquée');
    assert.match(doc.getElementById('push-enable').textContent, /bloquées/i, 'bouton explicite');
    assert.equal(doc.getElementById('push-test').hidden, true, 'pas de test sans permission');
    w.close();
    console.log('PASS dégradation : permission refusée expliquée, aucune relance');
  }

  console.log('PASS push notifications (hors jeu) : choix par l’utilisateur, service worker, cloche intacte');
})().catch((error) => {
  console.error(error);
  /* Les fenêtres jsdom gardent des minuteurs (compte à rebours des promos…) :
     on sort franchement pour ne pas laisser le test tourner dans le vide. */
  process.exit(1);
});
