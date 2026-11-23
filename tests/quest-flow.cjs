// Run with NODE_PATH pointing to a local jsdom installation: node tests/quest-flow.cjs
// Vérifie le système de quêtes / succès / niveau / notifications :
// - quests.js : 20 quêtes, 30 succès, progression relative au baseline, XP.
// - intégration : onglet Quêtes, quête active verrouillée tant qu'elle n'est
//   pas réclamée, récompenses (pièces + XP), déblocage séquentiel, badges,
//   succès qui se débloquent, panneau de notifications et persistance.
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

/* Expose quelques fonctions internes pour piloter les compteurs sans avoir
   à simuler tout le geste de déchir (déjà couvert par card-flow.cjs). */
const TEST_HOOK = `
  window.__quest = {
    state,
    questState,
    openPack,
    claim: claimActiveQuest,
    track: trackProgress,
    setPackOpened(n) { state.packsOpened = n; },
    setFusions(n) { state.fusions = n; },
    setPacksBought(n) { state.packsBought = n; },
    setFreePacks(n) { state.freePacks = n; },
    setMarketSales(n) { state.marketSales = n; },
    setMarketEarned(n) { state.marketEarned = n; },
    setMarketBuys(n) { state.marketBuys = n; },
    addCards(ids) {
      state.collection.push(...ids.map((id) => CardMutations.resolve(id)).filter(Boolean));
    }
  };
})();
`;

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
  vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/\}\)\(\);\s*$/, TEST_HOOK), context);
  await wait(40);
  await authState.onChange({ uid: 'me', email: 'moi@test', displayName: 'Moi', photoURL: '' });
  await wait(200);
  return { w, doc: w.document, store };
}

function todayKey() {
  const now = new Date();
  return `${now.getFullYear()}-${String(now.getMonth() + 1).padStart(2, '0')}-${String(now.getDate()).padStart(2, '0')}`;
}

/* Les ids réels des cartes de cards.js (le catalogue évolue, pas le test). */
function cardIds() {
  const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://refs-cards.test/', runScripts: 'outside-only' });
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  const ids = vm.runInContext('cardsDatabase.map((c) => c.id)', context);
  dom.window.close();
  return ids;
}

const freshSave = () => ({
  coins: 0, firstPack: false, collection: [], friends: [], packsOpened: 0,
  packStock: { classic: 3, rare: 0, legend: 0, video: 0 },
  freeDate: todayKey(), freeUsed: 0
});

(async () => {
  /* ---------- 1. Données pures : 20 quêtes, 30 succès, XP, baseline. ---------- */
  {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://refs-cards.test/', runScripts: 'outside-only' });
    const context = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
    const Q = vm.runInContext('RefsQuests', context);
    assert.equal(Q.QUESTS.length, 20, 'exactement 20 quêtes');
    assert.equal(Q.ACHIEVEMENTS.length, 30, 'exactement 30 succès');
    assert.equal(new Set(Q.QUESTS.map((q) => q.id)).size, 20, 'ids de quêtes uniques');
    assert.equal(new Set(Q.ACHIEVEMENTS.map((a) => a.id)).size, 30, 'ids de succès uniques');
    assert.ok(Q.QUESTS.every((q) => q.title && q.desc && q.metric && q.target >= 1 && q.reward && q.reward.coins > 0 && q.reward.xp > 0),
      'chaque quête a un titre, un objectif et une récompense');
    assert.ok(Q.ACHIEVEMENTS.every((a) => a.title && a.desc && a.metric && a.target >= 1 && a.xp > 0),
      'chaque succès a un titre, un objectif et de l’XP');
    /* Progression relative au baseline. */
    const q1 = Q.QUESTS[0];
    const prog = (ctx, base) => Q.questProgress(q1, ctx, base);
    assert.equal(prog({ packsOpened: 0 }, {}).done, false);
    assert.equal(prog({ packsOpened: 0 }, {}).value, 0);
    assert.equal(prog({ packsOpened: 1 }, {}).done, true);
    assert.equal(prog({ packsOpened: 1 }, {}).value, 1);
    /* Un joueur qui a déjà 100 boosters ne recommence pas la quête à zéro. */
    assert.equal(prog({ packsOpened: 101 }, { packsOpened: 100 }).done, true);
    assert.equal(prog({ packsOpened: 100 }, { packsOpened: 100 }).done, false);
    /* Niveaux : 0 / 100 / 300 / 600… */
    assert.equal(Q.xpForLevel(1), 0);
    assert.equal(Q.xpForLevel(2), 100);
    assert.equal(Q.xpForLevel(3), 300);
    const lvl = (xp) => Q.levelFromXp(xp);
    assert.equal(lvl(0).level, 1);
    assert.equal(lvl(0).into, 0);
    assert.equal(lvl(0).needed, 100);
    assert.equal(lvl(250).level, 2);
    assert.equal(lvl(250).into, 150);
    assert.equal(lvl(300).level, 3);
    dom.window.close();
    console.log('PASS données : 20 quêtes, 30 succès, baseline et niveaux cohérents');
  }

  /* ---------- 2. Page Quêtes : onglet, quête active, verrouillage. ---------- */
  {
    const { w, doc, store } = await boot(freshSave());
    assert.match(fs.readFileSync('index.html', 'utf8'), /data-tab="quests"/, 'onglet Quêtes présent');
    assert.match(fs.readFileSync('index.html', 'utf8'), /id="quests-view"/, 'vue Quêtes présente');
    assert.ok(doc.getElementById('quest-panel'), 'panneau des quêtes présent');
    assert.ok(doc.getElementById('ach-panel'), 'panneau des succès présent');
    assert.equal(doc.querySelectorAll('[data-quest-tab]').length, 2, 'deux sections (Quêtes / Succès)');

    doc.querySelector('[data-tab="quests"]').click();
    await wait(30);
    assert.equal(doc.getElementById('app').dataset.tab, 'quests');
    assert.equal(doc.getElementById('quests-count').textContent, 'Quête 1 / 20');
    assert.equal(doc.getElementById('level-value').textContent, '1');
    assert.equal(doc.getElementById('ach-count').textContent, '0 / 30');
    const claim = doc.querySelector('.quest-claim');
    assert.ok(claim, 'bouton de réclamation présent');
    assert.equal(claim.disabled, true, 'quête 1 pas encore réclamable à 0 booster');
    assert.match(doc.querySelector('.quest-title').textContent, /Premier déchir/);
    assert.equal(doc.querySelectorAll('.quest-done-row').length, 0, 'aucune quête terminée au départ');
    /* Les quêtes suivantes ne sont pas affichées (verrouillage). */
    assert.equal(doc.querySelectorAll('.quest-card').length, 1, 'une seule quête visible : la suivante est verrouillée');
    /* Succès : 30 tuiles, toutes verrouillées. */
    doc.querySelector('[data-quest-tab="achievements"]').click();
    await wait(20);
    assert.equal(doc.querySelectorAll('.ach-tile').length, 30, '30 succès affichés');
    assert.equal(doc.querySelectorAll('.ach-tile.is-unlocked').length, 0, 'aucun succès débloqué au départ');
    w.close();
    console.log('PASS page Quêtes : quête 1 active, suivantes verrouillées, 30 succès listés');
  }

  /* ---------- 3. Réclamation : pièces, XP, niveau, déblocage séquentiel. ---------- */
  {
    const { w, doc, store } = await boot(freshSave());
    doc.querySelector('[data-tab="quests"]').click();
    await wait(20);
    const hook = w.__quest;
    assert.equal(hook.state.coins, 0);
    /* Ouvrir un booster (vrai openPack : consomme le stock, +1 packsOpened). */
    hook.openPack();
    await wait(60);
    assert.equal(hook.state.packsOpened, 1, 'booster ouvert compté');
    const claim = doc.querySelector('.quest-claim');
    assert.equal(claim.disabled, false, 'quête 1 réclamable après l’ouverture');
    assert.equal(doc.getElementById('tab-badge-quests').hidden, false, 'badge de l’onglet Quêtes allumé');
    assert.ok(hook.questState.notifications.some((n) => n.type === 'quest'), 'notification de quête créée');
    /* Succès « Premier déchir » débloqué automatiquement : +50 XP. */
    assert.ok(hook.questState.achievements.includes('a01'), 'succès a01 débloqué');
    /* Réclamation : +100 🪙 (quête), +50 XP (quête) puis +50 XP (succès a01)
       = 100 XP → niveau 2, puis +50 XP (succès a26). Le niveau ne crédite
       pas de pièces : le solde reste exact. */
    claim.click();
    await wait(60);
    assert.equal(hook.state.coins, 100, '100 pièces de quête, le niveau ne crédite pas');
    assert.equal(hook.questState.xp, 150, '50 (quête) + 50 (a01) + 50 (a26 niveau 2) = 150 XP');
    assert.deepEqual(doc.getElementById('quests-count').textContent, 'Quête 2 / 20');
    assert.equal(doc.querySelector('.quest-title').textContent, 'Petite collection', 'quête 2 débloquée après la 1re');
    assert.equal(doc.querySelectorAll('.quest-done-row').length, 1, 'quête 1 dans les terminées');
    assert.equal(doc.querySelector('.quest-claim').disabled, true, 'quête 2 pas encore réclamable (0 carte unique)');
    assert.ok(hook.questState.achievements.includes('a26'), 'succès « Niveau 2 » débloqué');
    /* La quête 2 exige 5 cartes différentes : 4 ne suffisent pas. */
    const ids = cardIds();
    hook.addCards([ids[0], ids[1], ids[2], ids[3]]);
    hook.track();
    await wait(30);
    assert.equal(doc.querySelector('.quest-claim').disabled, true, '4 cartes uniques : toujours verrouillée');
    assert.match(doc.querySelector('.quest-progress-top').textContent, /4 \/ 5/);
    w.close();
    console.log('PASS réclamation : pièces, XP, niveau 2, déblocage séquentiel, verrouillage');
  }

  /* ---------- 4. Succès rétroactifs + baseline d’un joueur existant. ---------- */
  {
    /* Joueur déjà avancé AVANT le système : ses compteurs sont sauvegardés
       sans le moindre champ quête → le baseline doit figer la situation pour
       que les quêtes restent à faire. */
    const ids = cardIds();
    const save = Object.assign(freshSave(), {
      coins: 5000,
      packsOpened: 120,
      collection: [...ids, ...ids.slice(0, 14)], // 40 exemplaires, ids.length uniques
      friends: ['u1', 'u2', 'u3']
    });
    const { w, doc } = await boot(save);
    const hook = w.__quest;
    assert.equal(hook.questState.baseline.packsOpened, 120, 'baseline figé sur les compteurs existants');
    assert.equal(hook.questState.baseline.unique, ids.length, 'baseline figé sur la collection existante');
    /* Les succès, eux, sont absolus : la collection débloquera les succès de
       collection et d'amis, y compris s'ils étaient déjà faits avant. */
    assert.ok(hook.questState.achievements.includes('a03'), 'succès « Collectionneur » (15 uniques) rétroactif');
    assert.ok(hook.questState.achievements.includes('a13'), 'succès « Premier ami » rétroactif');
    assert.ok(hook.questState.achievements.includes('a14'), 'succès « Sociable » (3 amis) rétroactif');
    doc.querySelector('[data-tab="quests"]').click();
    await wait(30);
    assert.match(doc.getElementById('ach-count').textContent, /^(\d+) \/ 30$/);
    const unlocked = Number(doc.getElementById('ach-count').textContent.split(' ')[0]);
    assert.ok(unlocked >= 3, `au moins 3 succès rétroactifs, vu ${unlocked}`);
    assert.equal(doc.querySelectorAll('.ach-tile.is-unlocked').length, unlocked, 'tuiles débloquées accordées avec le compteur');
    /* La quête 1 exige 1 booster SUPPLÉMENTAIRE (baseline 120). */
    hook.setPackOpened(120);
    hook.track();
    await wait(20);
    assert.equal(doc.querySelector('.quest-claim').disabled, true, '120 = baseline : rien de neuf, verrouillé');
    hook.setPackOpened(121);
    hook.track();
    await wait(20);
    assert.equal(doc.querySelector('.quest-claim').disabled, false, '121 = 1 ouverture de plus : réclamable');
    w.close();
    console.log('PASS baseline joueur existant + succès rétroactifs');
  }

  /* ---------- 5. Notifications : persistance, badge, « tout lire ». ---------- */
  {
    const { w, doc, store } = await boot(freshSave());
    const hook = w.__quest;
    hook.setPackOpened(1);
    hook.track();
    await wait(30);
    assert.equal(doc.getElementById('notif-badge').hidden, false, 'badge de la cloche allumé (quêtes + succès non lus)');
    const badge = Number(doc.getElementById('notif-badge').textContent);
    assert.ok(badge >= 2, `au moins 2 notifications non lues, vu ${badge}`);
    /* Panneau. */
    doc.getElementById('notif-btn').click();
    await wait(30);
    assert.equal(doc.getElementById('notif-sheet').hidden, false, 'panneau de notifications ouvert');
    const rows = doc.querySelectorAll('.notif-row');
    assert.equal(rows.length, hook.questState.notifications.length, 'toutes les notifications listées');
    assert.equal(doc.querySelectorAll('.notif-row.is-unread').length, rows.length, 'non lues surlignées');
    doc.getElementById('notif-read-all').click();
    await wait(30);
    assert.equal(doc.getElementById('notif-badge').hidden, true, 'badge éteint après « tout marquer comme lu »');
    assert.equal(doc.querySelectorAll('.notif-row.is-unread').length, 0, 'plus aucune notification non lue');
    /* Persistance : la sauvegarde porte quêtes, succès, XP, notifications, baseline. */
    await wait(400); // sauvegarde différée (250 ms)
    const saved = store.playerSaves.me;
    assert.ok(Array.isArray(saved.quests), 'quêtes persistées');
    assert.ok(Array.isArray(saved.achievements), 'succès persistés');
    assert.equal(typeof saved.xp, 'number', 'XP persistée');
    assert.ok(saved.questBaseline && typeof saved.questBaseline === 'object', 'baseline persisté');
    assert.ok(Array.isArray(saved.notifications) && saved.notifications.length >= 2, 'notifications persistées');
    assert.ok(saved.notifications.every((n) => n.read === true), 'état « lu » persisté');
    assert.equal(saved.packsOpened, 1, 'compteur de boosters persisté');
    w.close();
    console.log('PASS notifications : badge, panneau, tout-lire, persistance');
  }

  /* ---------- 6. Rechargement : la progression survit à la déconnexion. ---------- */
  {
    const first = await boot(freshSave());
    const hook = first.w.__quest;
    hook.setPackOpened(1);
    hook.track();
    await wait(30);
    first.doc.querySelector('[data-tab="quests"]').click();
    await wait(20);
    first.doc.querySelector('.quest-claim').click();
    await wait(400); // sauvegarde différée
    const saved = first.store.playerSaves.me;
    assert.equal(saved.quests.length, 1, 'quête 1 réclamée dans la sauvegarde');
    assert.equal(saved.quests[0], 'q01', 'bonne quête réclamée');
    first.w.close();

    /* Second appareil : on recharge la même sauvegarde. */
    const second = await boot(JSON.parse(JSON.stringify(saved)));
    const hook2 = second.w.__quest;
    assert.equal(hook2.questState.completed.length, 1, 'quête 1 toujours terminée au rechargement');
    assert.equal(hook2.questState.completed[0], 'q01', 'bonne quête restaurée');
    assert.equal(hook2.questState.xp, saved.xp, 'XP conservée au rechargement');
    assert.ok(!hook2.questState.baseline.packsOpened, 'baseline reste celui d’origine (vide pour un nouveau joueur)');
    second.doc.querySelector('[data-tab="quests"]').click();
    await wait(30);
    assert.equal(second.doc.getElementById('quests-count').textContent, 'Quête 2 / 20', 'on reprend à la quête 2');
    assert.equal(second.doc.querySelector('.quest-title').textContent, 'Petite collection', 'pas de retour en arrière');
    assert.ok(hook2.questState.notifications.length >= 1, 'notifications rechargées');
    second.w.close();
    console.log('PASS rechargement : quêtes, XP, notifications et baseline restaurés');
  }

  console.log('PASS quest flow (quêtes, succès, niveaux, notifications)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
