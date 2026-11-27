// Run with NODE_PATH pointing to a local jsdom installation: node tests/quest-flow.cjs
// Vérifie le système de quêtes / succès / niveau / notifications :
// - quests.js : 310 quêtes (dont des récompenses en PACKS, sans pièces), 28 succès, progression à vie (rétroactive), XP.
// - intégration : onglet Quêtes, une quête active par chaîne, réclamation libre, récompenses (pièces + XP), remplacement automatique, badges,
//   succès qui se débloquent, panneau de notifications et persistance.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let allQuestIds = [];
let allQuestRecords = [];

function makeStore(save) {
  return {
    playerSaves: { me: save },
    playerProfiles: {},
    friendCodes: {},
    friendRequests: {},
    trades: {},
    marketListings: {},
    marketOffers: {},
    coinGifts: {},
    coinFlips: {}
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
  coins: 0, firstPack: false, decoReleaseClaimed: true, collection: [], friends: [], packsOpened: 0,
  packStock: { classic: 3, rare: 0, legend: 0, video: 0 },
  freeDate: todayKey(), freeUsed: 0
});

(async () => {
  /* ---------- 1. Données pures : 310 quêtes, 28 succès, XP, rétroactivité. ---------- */
  {
    const dom = new JSDOM('<!DOCTYPE html><body></body>', { url: 'https://refs-cards.test/', runScripts: 'outside-only' });
    const context = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
    const Q = vm.runInContext('RefsQuests', context);
    allQuestRecords = Q.QUESTS.map((q) => ({
      id: q.id,
      metric: q.metric,
      step: Q.chainInfo(q).step,
      total: Q.chainInfo(q).total
    }));
    allQuestIds = allQuestRecords.map((q) => q.id);
    assert.equal(Q.QUESTS.length, 310, 'exactement 310 quêtes');
    assert.equal(Q.ACHIEVEMENTS.length, 28, 'exactement 28 succès');
    assert.equal(new Set(Q.QUESTS.map((q) => q.id)).size, 310, 'ids de quêtes uniques');
    assert.equal(new Set(Q.ACHIEVEMENTS.map((a) => a.id)).size, 28, 'ids de succès uniques');
    assert.ok(Q.QUESTS.every((q) => q.title && q.desc && q.metric && q.target >= 1 && q.reward),
      'chaque quête a un titre, un objectif et une récompense');
    /* Chaque quête donne au moins quelque chose, et les récompenses sont
       variées : beaucoup offrent des PACKS, parfois sans aucune pièce. */
    const rewards = Q.QUESTS.map((q) => Q.questReward(q));
    assert.ok(rewards.every((r) => r.coins > 0 || r.xp > 0 || Object.keys(r.packs).length > 0),
      'chaque quête donne des pièces, de l’XP ou des packs');
    const withPacks = Q.QUESTS.filter((q) => Object.keys(Q.questReward(q).packs).length > 0);
    assert.ok(withPacks.length >= 40, `au moins 40 quêtes donnent des packs, vu ${withPacks.length}`);
    const packOnly = rewards.filter((r) => !r.coins);
    assert.ok(packOnly.length >= 30, `au moins 30 quêtes sans pièces, vu ${packOnly.length}`);
    assert.ok(rewards.some((r) => r.coins === 0 && r.xp === 0 && Object.keys(r.packs).length > 0),
      'au moins une quête ne donne QUE des packs');
    assert.ok(rewards.some((r) => r.coins === 0 && r.xp > 0 && Object.keys(r.packs).length > 0),
      'au moins une quête donne XP + packs sans pièces');
    assert.deepEqual(Object.keys(Q.questReward({ reward: { packs: { rare: 2, legend: 0, nope: 3 } } }).packs), ['rare'],
      'les packs inconnus / à zéro sont ignorés');
    assert.equal(Q.packRewardLabel({ rare: 1, video: 2 }), '1 Pack Rare + 2 Pack Vidéo', 'libellé des packs');
    assert.ok(Q.ACHIEVEMENTS.every((a) => a.title && a.desc && a.metric && a.target >= 1 && a.xp > 0),
      'chaque succès a un titre, un objectif et de l’XP');
    /* Progression à vie : les compteurs absolus comptent, sans remise à zéro. */
    const q1 = Q.QUESTS[0];
    const prog = (ctx) => Q.questProgress(q1, ctx);
    assert.equal(prog({}).done, false, 'aucun booster : quête 1 à faire');
    assert.equal(prog({ packsOpened: 0 }).value, 0);
    assert.equal(prog({ packsOpened: 1 }).done, true);
    assert.equal(prog({ packsOpened: 1 }).value, 1);
    /* Un joueur qui avait déjà ouvert 120 boosters avant les quêtes valide
       l’objectif immédiatement (aucune seconde fois à faire). */
    assert.equal(prog({ packsOpened: 120 }).done, true, 'quête rétroactive acquise');
    assert.equal(prog({ packsOpened: 120 }).value, 1, 'progression plafonnée à l’objectif');
    /* Objectifs de collection : 5 cartes différentes = objectif atteint. */
    const q2 = Q.QUESTS.find((q) => q.id === 'q02');
    assert.equal(Q.questProgress(q2, { unique: 5 }).done, true, '5 cartes uniques : objectif atteint');
    assert.equal(Q.questProgress(q2, { unique: 4 }).done, false, '4 cartes uniques : encore à faire');
    assert.equal(Q.questProgress(q2, { unique: 4 }).value, 4);
    /* La signature n’utilise plus de baseline (3ᵉ argument ignoré). */
    assert.equal(Q.questProgress(q1, { packsOpened: 3 }, { packsOpened: 3 }).done, true,
      'un ancien baseline ne bloque plus une quête déjà accomplie');
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
    console.log('PASS données : 310 quêtes (dont récompenses en packs), 28 succès, progression rétroactive et niveaux cohérents');
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
    assert.equal(doc.getElementById('quests-count').textContent, '0 / 310 terminées · 16 en cours');
    assert.equal(doc.getElementById('level-value').textContent, '1');
    assert.equal(doc.getElementById('ach-count').textContent, '0 / 28');
    const claim = doc.querySelector('.quest-claim');
    assert.ok(claim, 'bouton de réclamation présent');
    assert.equal(claim.disabled, true, 'quête 1 pas encore réclamable à 0 booster');
    assert.match(doc.querySelector('.quest-title').textContent, /Premier déchir/);
    assert.equal(doc.querySelectorAll('.quest-done-row').length, 0, 'aucune quête terminée au départ');
    /* Une quête par chaîne, regroupées par catégorie : deux dans « Boosters ». */
    assert.equal(doc.querySelectorAll('.quest-card').length, 2, 'deux quêtes Boosters visibles');
    /* Succès : 28 tuiles, toutes verrouillées. */
    doc.querySelector('[data-quest-tab="achievements"]').click();
    await wait(20);
    assert.equal(doc.querySelectorAll('.ach-tile').length, 28, '28 succès affichés');
    assert.equal(doc.querySelectorAll('.ach-tile.is-unlocked').length, 0, 'aucun succès débloqué au départ');
    w.close();
    console.log('PASS page Quêtes : quêtes par catégorie, 28 succès listés');
  }

  /* ---------- 3. Réclamation : pièces, XP, niveau, remplacement automatique. ---------- */
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
    assert.deepEqual(doc.getElementById('quests-count').textContent, '1 / 310 terminées · 16 en cours');
    assert.equal(doc.querySelector('.quest-title').textContent, 'Booster offert', 'étape suivante de la chaîne Boosters');
    assert.equal(doc.querySelectorAll('.quest-done-row').length, 1, 'quête 1 dans les terminées');
    assert.equal(doc.querySelector('.quest-claim').disabled, true, 'étape suivante pas encore réclamable (1 booster sur 2)');
    assert.ok(hook.questState.achievements.includes('a26'), 'succès « Niveau 2 » débloqué');
    assert.match(doc.querySelector('.quest-progress-top').textContent, /1 \/ 2/);
    /* Dans la catégorie Collection, la quête « 5 cartes différentes » attend
       toujours 4 cartes supplémentaires. */
    [...doc.querySelectorAll('.quest-cat')].find((b) => b.textContent.includes('Collection')).click();
    await wait(20);
    assert.equal(doc.querySelector('[data-quest-id="q02"] .quest-claim').disabled, true);
    const ids = cardIds();
    hook.addCards(ids.slice(0, 4));
    hook.track();
    await wait(30);
    assert.equal(doc.querySelector('[data-quest-id="q02"] .quest-claim').disabled, true, '4 cartes uniques : toujours verrouillée');
    assert.match(doc.querySelector('[data-quest-id="q02"] .quest-progress-top').textContent, /4 \/ 5/);
    w.close();
    console.log('PASS réclamation : pièces, XP, niveau 2, étape suivante, verrouillage');
  }

  /* ---------- 4. Joueur existant : quêtes ET succès rétroactifs. ---------- */
  {
    /* Joueur déjà avancé AVANT le système : sa sauvegarde ne contient aucun
       champ quête. Ses compteurs doivent compter tels quels : une quête déjà
       accomplie est réclamable immédiatement, sans rien refaire. */
    const ids = cardIds();
    const save = Object.assign(freshSave(), {
      coins: 5000,
      packsOpened: 120,
      collection: [...ids, ...ids.slice(0, 14)], // 40 exemplaires, 25 uniques
      friends: ['u1', 'u2', 'u3']
    });
    const { w, doc, store } = await boot(save);
    const hook = w.__quest;
    assert.equal(hook.questState.baseline, undefined, 'plus de baseline dans l’état des quêtes');
    /* Succès rétroactifs (absolus). */
    assert.ok(hook.questState.achievements.includes('a03'), 'succès « Collectionneur » (15 uniques) rétroactif');
    assert.ok(hook.questState.achievements.includes('a13'), 'succès « Premier ami » rétroactif');
    assert.ok(hook.questState.achievements.includes('a14'), 'succès « Sociable » (3 amis) rétroactif');
    doc.querySelector('[data-tab="quests"]').click();
    await wait(30);
    assert.match(doc.getElementById('ach-count').textContent, /^(\d+) \/ 28$/);
    const unlocked = Number(doc.getElementById('ach-count').textContent.split(' ')[0]);
    assert.ok(unlocked >= 3, `au moins 3 succès rétroactifs, vu ${unlocked}`);
    assert.equal(doc.querySelectorAll('.ach-tile.is-unlocked').length, unlocked, 'tuiles débloquées accordées avec le compteur');

    /* Quête 1 « Ouvre ton premier booster » : 120 boosters déjà ouverts →
       récompense disponible tout de suite. */
    assert.equal(doc.querySelector('.quest-claim').disabled, false, 'quête 1 rétroactive : réclamable sans rien refaire');
    assert.ok(doc.querySelector('.quest-card').classList.contains('is-ready'), 'carte marquée « prête »');
    assert.match(doc.getElementById('quests-count').textContent, /0 \/ 310 terminées · 16 en cours · récompense prête/);
    assert.equal(doc.getElementById('tab-badge-quests').hidden, false, 'badge de l’onglet allumé');

    /* Réclamation : +100 🪙, puis l'étape suivante (« 2 boosters », récompense
       en pack) est elle aussi déjà accomplie (120 boosters ouverts). */
    const coins = hook.state.coins;
    doc.querySelector('.quest-claim').click();
    await wait(40);
    assert.equal(hook.state.coins, coins + 100, 'récompense rétroactive versée');
    assert.equal(hook.questState.completed[0], 'q01');
    assert.equal(doc.querySelector('.quest-title').textContent, 'Booster offert');
    assert.match(doc.querySelector('.quest-progress-top').textContent, /2 \/ 2/);
    assert.equal(doc.querySelector('.quest-claim').disabled, false, 'étape suivante rétroactive : réclamable aussi');
    assert.equal(doc.getElementById('tab-badge-quests').hidden, false, 'badge toujours allumé pour la quête suivante prête');

    const stockBefore = hook.state.packStock.classic;
    doc.querySelector('.quest-claim').click();
    await wait(40);
    assert.equal(hook.questState.completed[1], 'q21');
    assert.equal(hook.state.packStock.classic, stockBefore + 1, 'récompense en pack rétroactive');
    assert.equal(hook.questState.completed.length, 2, 'deux quêtes rétroactives réclamées');
    /* D'autres chaînes gardent des récompenses prêtes : le badge reste
       allumé même si l'étape suivante de Boosters demande plus de boosters. */
    assert.ok(doc.querySelector('.quest-card.is-ready'), 'une autre quête active est prête');
    assert.equal(doc.getElementById('tab-badge-quests').hidden, false, 'badge allumé pour les récompenses prêtes');

    /* Persistance : le champ `questBaseline` n’est plus écrit (les anciennes
       sauvegardes qui en ont un restent lisibles, il est simplement ignoré). */
    await wait(400);
    assert.ok(!('questBaseline' in store.playerSaves.me), 'aucun baseline réécrit dans la sauvegarde');
    w.close();
    console.log('PASS joueur existant : quêtes et succès rétroactifs, réclamations enchaînées');
  }

  /* ---------- 4bis. Ancienne sauvegarde avec `questBaseline` : ignoré. ---------- */
  {
    const ids = cardIds();
    const legacy = Object.assign(freshSave(), {
      coins: 1000,
      packsOpened: 80,
      collection: ids.slice(0, 8),
      quests: ['q01'],
      questBaseline: { packsOpened: 80, unique: 8, friends: 2 },
      xp: 150,
      achievements: ['a01', 'a02', 'a26'],
      notifications: []
    });
    const { w, doc, store } = await boot(legacy);
    const hook = w.__quest;
    doc.querySelector('[data-tab="quests"]').click();
    await wait(30);
    assert.equal(hook.questState.completed.length, 1, 'quête 1 bien restaurée');
    assert.equal(doc.querySelector('.quest-title').textContent, 'Booster offert');
    assert.equal(doc.querySelector('.quest-claim').disabled, false,
      'étape suivante déjà accomplie (80 boosters) malgré l’ancien baseline');
    doc.querySelector('.quest-claim').click();
    await wait(400);
    assert.deepEqual(store.playerSaves.me.quests, ['q01', 'q21'], 'réclamation persistée');
    assert.equal(store.playerSaves.me.questBaseline.unique, 8,
      'ancien champ laissé tel quel par le merge, simplement ignoré');
    w.close();
    console.log('PASS ancienne sauvegarde : questBaseline ignoré, quêtes déjà accomplies réclamables');
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
    /* Persistance : la sauvegarde porte quêtes, succès, XP, notifications. */
    await wait(400); // sauvegarde différée (250 ms)
    const saved = store.playerSaves.me;
    assert.ok(Array.isArray(saved.quests), 'quêtes persistées');
    assert.ok(Array.isArray(saved.achievements), 'succès persistés');
    assert.equal(typeof saved.xp, 'number', 'XP persistée');
    assert.ok(!('questBaseline' in saved), 'pas de baseline inutile dans la sauvegarde');
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
    assert.equal(hook2.questState.baseline, undefined, 'aucun baseline à restaurer');
    second.doc.querySelector('[data-tab="quests"]').click();
    await wait(30);
    assert.equal(second.doc.getElementById('quests-count').textContent, '1 / 310 terminées · 16 en cours', 'progression conservée');
    assert.equal(second.doc.querySelector('.quest-title').textContent, 'Booster offert', 'pas de retour en arrière');
    assert.ok(hook2.questState.notifications.length >= 1, 'notifications rechargées');
    second.w.close();
    console.log('PASS rechargement : quêtes, XP et notifications restaurés');
  }

  /* Réclamation hors ordre, remplacement, anti-double gain et rechargement. */
  {
    const { w, doc, store } = await boot(freshSave());
    doc.querySelector('[data-tab="quests"]').click();
    const hook = w.__quest;
    hook.setFusions(1);
    hook.track();
    [...doc.querySelectorAll('.quest-cat')].find((b) => b.textContent.includes('Fusion')).click();
    await wait(20);
    const cards = () => Array.from(doc.querySelectorAll('.quest-card'), (c) => c.dataset.questId);
    assert.ok(cards().includes('q04'), 'la quête de fusion est active dans sa catégorie');
    assert.equal(doc.querySelector('[data-quest-id="q01"]'), null, 'les autres catégories ne sont pas affichées');
    assert.equal(doc.querySelector('[data-quest-id="q04"] .quest-claim').disabled, false);
    assert.equal(doc.getElementById('tab-badge-quests').hidden, false);
    const notices = hook.questState.notifications.filter((n) => n.title === 'Quête accomplie').length;
    hook.track();
    assert.equal(hook.questState.notifications.filter((n) => n.title === 'Quête accomplie').length, notices);
    const staleButton = doc.querySelector('[data-quest-id="q04"] .quest-claim');
    staleButton.click();
    await wait(20);
    assert.ok(!cards().includes('q04'), 'la quête réclamée quitte la liste');
    assert.ok(cards().some((id) => id !== 'q04'), 'd’autres quêtes de la catégorie restent actives');
    const coins = hook.state.coins;
    const xp = hook.questState.xp;
    staleButton.click();
    hook.claim('q20'); // hors liste active, même si un appel contourne l'UI
    assert.equal(hook.state.coins, coins);
    assert.equal(hook.questState.xp, xp);
    await wait(400);
    assert.deepEqual(Array.from(store.playerSaves.me.quests), ['q04']);
    const second = await boot(JSON.parse(JSON.stringify(store.playerSaves.me)));
    [...second.doc.querySelectorAll('.quest-cat')].find((b) => b.textContent.includes('Fusion')).click();
    await wait(20);
    assert.deepEqual(Array.from(second.doc.querySelectorAll('.quest-card'), (c) => c.dataset.questId), cards());
    second.w.close();
    w.close();
    console.log('PASS quêtes par catégorie : choix hors ordre, pop, notifications uniques, anti-double gain, sauvegarde');
  }

  /* Fin de liste : les deux dernières chaînes actives, puis écran terminé. */
  {
    const finalQuestByMetric = new Map();
    for (const quest of allQuestRecords) {
      if (quest.step === quest.total) finalQuestByMetric.set(quest.metric, quest.id);
    }
    const pendingIds = new Set(Array.from(finalQuestByMetric.values()).slice(-2));
    assert.equal(pendingIds.size, 2, 'deux chaînes distinctes ont une dernière étape');
    const save = freshSave();
    save.quests = allQuestIds.filter((id) => !pendingIds.has(id));
    const { w, doc } = await boot(save);
    const tabs = [...doc.querySelectorAll('.quest-cat')];
    const visibleQuests = () => tabs.reduce((sum, tab) => {
      tab.click();
      return sum + doc.querySelectorAll('.quest-card').length;
    }, 0);
    assert.equal(visibleQuests(), 2, 'deux dernières quêtes actives, dans leurs catégories');
    w.close();
    /* Toutes les quêtes réclamées => écran terminé. */
    save.quests = allQuestIds.slice();
    const last = await boot(save);
    assert.equal(last.doc.querySelectorAll('.quest-card').length, 0);
    assert.ok(last.doc.querySelector('.quest-all-done'));
    assert.equal(last.doc.getElementById('tab-badge-quests').hidden, true);
    last.w.close();
  }

  /* Récompenses en PACKS : une quête sans pièces remplit l'inventaire. */
  {
    const { w, doc, store } = await boot(freshSave());
    doc.querySelector('[data-tab="quests"]').click();
    await wait(30);
    /* q01 « Premier déchir » : récompense en pièces + XP (pas de pack). */
    const hook = w.__quest;
    hook.setPackOpened(1);
    hook.track();
    doc.querySelector('[data-quest-id="q01"] .quest-claim').click();
    await wait(40);
    /* On valide les quêtes 2 à 20, puis on réclame q21 « Booster offert »
       (1 Pack Classique, 0 pièce). */
    hook.questState.completed.push('q01', 'q02', 'q03', 'q04', 'q05');
    hook.setPackOpened(2);
    hook.track();
    await wait(30);
    /* On termine aussi q06..q20 pour que q21 entre dans la fenêtre. */
    const claimed = Array.from({ length: 15 }, (_, i) => `q${String(i + 6).padStart(2, '0')}`);
    hook.questState.completed.push(...claimed);
    hook.track();
    await wait(30);
    assert.ok(doc.querySelector('[data-quest-id="q21"]'), 'q21 devient active');
    const packBadge = doc.querySelector('[data-quest-id="q21"] .quest-reward-pack');
    assert.ok(packBadge, 'la récompense en pack est affichée');
    assert.match(packBadge.textContent, /1 Pack Classique/);
    assert.equal(doc.querySelectorAll('[data-quest-id="q21"] .quest-reward').length, 2,
      'pas de pastille de pièces pour une quête sans argent');
    const coinsBefore = hook.state.coins;
    const stockBefore = hook.state.packStock.classic;
    doc.querySelector('[data-quest-id="q21"] .quest-claim').click();
    await wait(60);
    assert.equal(hook.state.coins, coinsBefore, 'aucune pièce versée');
    assert.equal(hook.state.packStock.classic, stockBefore + 1, 'le pack est ajouté à l’inventaire');
    assert.ok(hook.questState.completed.includes('q21'));
    const notice = hook.questState.notifications.find((n) => /Booster offert/.test(n.message));
    assert.ok(notice && /Pack Classique/.test(notice.message), 'notification détaillant le pack');
    await wait(400);
    assert.ok(store.playerSaves.me.packStock.classic >= stockBefore + 1, 'packOffert persisté dans la sauvegarde');
    w.close();
    console.log('PASS récompenses en packs : inventaire crédité, pas de pièces, affichage et persistance');
  }

  console.log('PASS quest flow (quêtes, succès, niveaux, notifications)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
