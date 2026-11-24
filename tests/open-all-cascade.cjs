// « Ouvrir tout le pack » : les cartes restantes s'étalent, se retournent en
// cascade puis filent vers le butin avant le récap. Exécuter avec jsdom
// installé : node tests/open-all-cascade.cjs
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function boot({ reduceMotion, demo }) {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: `https://example.test/?demo=${demo}`, runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: reduceMotion, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  /* jsdom ne calcule aucune géométrie et n'a pas WAAPI : on fournit une boîte
     fixe (les envols visent alors le centre) et un `animate` inerte, pour que
     la réaction de l'onglet Collection (étincelles + annonce) puisse jouer. */
  w.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 140, width: 100, height: 140, x: 0, y: 0 });
  w.Element.prototype.animate = () => ({ onfinish: null, cancel() {}, finished: Promise.resolve() });
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  /* On lance la révélation dès le démarrage et on expose l'état interne
     (pièces, collection, pile restante, butin) pour les vérifications. */
  vm.runInContext(
    fs.readFileSync('app.js', 'utf8')
      .replace(/(^\s*)boot\(\);$/m, '$1boot(); showReveal();')
      .replace(
        /\}\)\(\);\s*$/,
        '  window.__refs = () => ({ state, remaining, cardReward, openingAll, packCinematic });\n})();\n'
      ),
    context
  );
  await wait(30);
  for (let tries = 0; tries < 40 && !w.document.querySelector('.card.is-top'); tries++) await wait(25);
  return { dom, w, d: w.document };
}

/* Pièces attendues pour le reste de la pile, calculées AVANT l'ouverture
   (chaque exemplaire déjà possédé réduit le gain du suivant). */
function expectedReward(w) {
  const { remaining, state, cardReward } = w.__refs();
  const owned = new Map();
  for (const c of state.collection) owned.set(c.id, (owned.get(c.id) || 0) + 1);
  let total = 0;
  for (const { data, node } of remaining) {
    if (node.classList.contains('is-revealed')) continue;
    const n = owned.get(data.id) || 0;
    total += cardReward(data, n);
    owned.set(data.id, n + 1);
  }
  return total;
}

async function revealFirstCard(d) {
  const first = d.querySelector('.card.is-top');
  assert.ok(first, 'la pile doit être montée');
  first.click(); // commune : pas de suspense, retournement immédiat
  await wait(40);
  assert.ok(first.classList.contains('is-flipped'), 'la première carte est retournée');
  const openAll = d.getElementById('open-all');
  assert.equal(openAll.hidden, false, '« Ouvrir tout le pack » apparaît après la première carte');
  assert.equal(openAll.disabled, false);
  return openAll;
}

async function untilResults(d, maxMs = 12000) {
  for (let t = 0; t < maxMs && d.getElementById('pack-results').hidden; t += 100) await wait(100);
  return !d.getElementById('pack-results').hidden;
}

async function scenario(label, opts, run) {
  const env = await boot(opts);
  try {
    await run(env);
    console.log(`PASS ouvrir tout : ${label}`);
  } finally {
    env.dom.window.close();
  }
}

(async () => {
  /* 1. Cascade complète (pack sans carte au-dessus de Divine : démarrage
        immédiat) : éventail, retournements, plus rare en avant, envol, récap. */
  await scenario('éventail, cascade de retournements, plus rare en avant, envol, récap', { reduceMotion: false, demo: 'fusion' }, async ({ w, d }) => {
    const openAll = await revealFirstCard(d);
    const before = w.__refs();
    const coinsBefore = before.state.coins;
    const collectionBefore = before.state.collection.length;
    const deckSize = before.state.deck.length;
    const expected = expectedReward(w);
    const stack = d.getElementById('stack');

    openAll.click();
    assert.ok(w.__refs().openingAll, 'la cascade démarre');
    assert.ok(stack.classList.contains('is-fan'), 'la pile passe en éventail');
    const cards = [...stack.querySelectorAll('.card')];
    assert.equal(cards.length, deckSize, 'toutes les cartes restent sur la table pendant l’éventail');
    assert.ok(cards.every((c) => c.classList.contains('is-fanned')), 'chaque carte reçoit sa place');
    assert.ok(cards.every((c) => c.style.getPropertyValue('--fan-x') !== ''), 'position d’éventail posée');
    assert.ok(cards.every((c) => !c.classList.contains('is-top')), 'plus de carte « du dessus » pendant la cascade');
    assert.ok(/Passer/.test(openAll.textContent), 'le bouton devient « Passer »');
    assert.equal(openAll.disabled, false, 'le bouton « Passer » reste cliquable');
    assert.equal(d.getElementById('next-card').hidden, true);
    assert.ok(d.getElementById('pack-results').hidden, 'le récap attend la fin de la cascade');

    // Le bouton « Carte suivante » reste inactif : rien n'est rangé tant que
    // la cascade n'a pas atteint l'envol.
    d.getElementById('next-card').click();
    assert.equal(w.__refs().state.loot.length, 0, 'rien n’est rangé avant l’envol');

    assert.equal(d.getElementById('pile-label').textContent, `1 / ${deckSize} RÉVÉLÉE`, 'le compteur part de la carte déjà retournée');

    // Retournements : tout le monde finit face visible et compté une fois.
    await wait(1800);
    assert.ok(cards.every((c) => c.classList.contains('is-flipped')), 'toutes les cartes sont retournées');
    assert.equal(d.getElementById('pile-label').textContent, `${deckSize} / ${deckSize} RÉVÉLÉES`, 'le compteur suit les retournements');
    assert.ok(cards.every((c) => c.classList.contains('is-revealed')), 'toutes les cartes sont comptées');
    assert.equal(w.__refs().state.collection.length, collectionBefore + deckSize - 1, 'chaque carte est ajoutée une fois');
    assert.equal(w.__refs().state.coins, coinsBefore + expected, 'les pièces suivent le retournement de chaque carte');
    assert.ok(d.getElementById('pack-results').hidden, 'le récap attend encore (projecteur sur la plus rare)');
    await wait(600);
    const bests = stack.querySelectorAll('.card.is-best');
    assert.equal(bests.length, 1, 'la plus rare est mise en avant');
    const rank = (c) => Number(c.style.getPropertyValue('--fan-i'));
    const bestCard = bests[0];
    assert.ok(cards.every((c) => rank(c) <= rank(bestCard)), 'la plus rare ferme la cascade');
    assert.ok(bestCard.classList.contains('card-rare'), 'la carte rare de la démo est la plus rare du lot');

    // Envol puis récap.
    assert.ok(await untilResults(d), 'le récap s’affiche à la fin de la cascade');
    assert.equal(w.__refs().openingAll, false, 'la cascade est terminée');
    assert.equal(w.__refs().packCinematic, false);
    assert.equal(stack.classList.contains('is-fan'), false, 'la pile est rangée');
    assert.equal(stack.querySelectorAll('.card').length, 0, 'plus aucune carte sur la table');
    assert.equal(d.querySelectorAll('.pack-result').length, deckSize, 'le récap présente tout le pack');
    assert.equal(d.querySelectorAll('.slot.is-filled').length, deckSize, 'chaque case du butin est remplie');
    const after = w.__refs();
    assert.equal(after.state.loot.length, deckSize);
    assert.equal(after.state.collection.length, collectionBefore + deckSize - 1, 'aucune carte comptée deux fois');
    assert.equal(after.state.coins, coinsBefore + expected, 'aucune pièce comptée deux fois');
    assert.equal(after.state.phase, 'done');
    assert.ok(!/Passer/.test(openAll.innerHTML), 'le bouton retrouve son libellé');
    assert.ok(openAll.hidden, 'le bouton disparaît une fois le pack terminé');
    // Nouvelles cartes : l'onglet Collection réagit une seule fois pour le lot.
    await wait(500);
    const floats = [...d.querySelectorAll('.fx-float')].map((n) => n.textContent);
    assert.equal(floats.length, 1, 'une seule annonce pour tout le lot');
    assert.match(floats[0], /nouvelles? cartes?/i);
  });

  /* 2. « Passer » pendant la cascade : fin immédiate, comptes justes. */
  await scenario('« Passer » termine aussitôt sans double comptage', { reduceMotion: false, demo: 'fusion' }, async ({ w, d }) => {
    const openAll = await revealFirstCard(d);
    const before = w.__refs();
    const coinsBefore = before.state.coins;
    const collectionBefore = before.state.collection.length;
    const deckSize = before.state.deck.length;
    const expected = expectedReward(w);
    openAll.click();
    openAll.click(); // double-clic : le second clic ne doit pas passer la cascade
    assert.ok(w.__refs().openingAll, 'un double-clic sur « Ouvrir tout » ne saute pas l’animation');
    await wait(650); // en plein éventail
    assert.ok(w.__refs().openingAll);
    openAll.click(); // = « Passer »
    assert.equal(w.__refs().openingAll, false, '« Passer » arrête la cascade');
    assert.equal(d.getElementById('pack-results').hidden, false, 'le récap s’affiche aussitôt');
    assert.equal(d.querySelectorAll('.pack-result').length, deckSize);
    assert.equal(d.getElementById('stack').querySelectorAll('.card').length, 0);
    const after = w.__refs();
    assert.equal(after.state.collection.length, collectionBefore + deckSize - 1, 'cartes comptées une seule fois après « Passer »');
    assert.equal(after.state.coins, coinsBefore + expected, 'pièces comptées une seule fois après « Passer »');
    assert.equal(after.state.phase, 'done');
    // Les minuteries restantes ne doivent plus rien toucher.
    await wait(4500);
    assert.equal(w.__refs().state.collection.length, collectionBefore + deckSize - 1);
    assert.equal(w.__refs().state.coins, coinsBefore + expected);
    assert.equal(d.querySelectorAll('.pack-result').length, deckSize);
    assert.equal(d.querySelectorAll('.slot.is-filled').length, 0, 'aucune case remplie après coup par une minuterie oubliée');
  });

  /* 3. Toucher la table passe aussi la cascade, en plein retournement. */
  await scenario('toucher la table passe la cascade', { reduceMotion: false, demo: 'fusion' }, async ({ w, d }) => {
    const openAll = await revealFirstCard(d);
    const before = w.__refs();
    const deckSize = before.state.deck.length;
    const collectionBefore = before.state.collection.length;
    openAll.click();
    await wait(1000); // pendant les retournements
    d.getElementById('table').click();
    assert.equal(w.__refs().openingAll, false, 'un toucher sur la table passe la cascade');
    assert.equal(d.getElementById('pack-results').hidden, false);
    assert.equal(w.__refs().state.collection.length, collectionBefore + deckSize - 1, 'les cartes non retournées sont comptées à la fin');
  });

  /* 3 bis. Les cartes étalées ne captent plus le pointeur : un toucher sur
        l'une d'elles remonte à la table et passe aussi la cascade. */
  await scenario('toucher une carte étalée passe la cascade', { reduceMotion: false, demo: 'fusion' }, async ({ w, d }) => {
    const openAll = await revealFirstCard(d);
    const deckSize = w.__refs().state.deck.length;
    openAll.click();
    await wait(650);
    d.querySelectorAll('#stack .card')[2].click();
    assert.equal(w.__refs().openingAll, false, 'le toucher remonte à la table et passe la cascade');
    assert.equal(d.querySelectorAll('.pack-result').length, deckSize);
  });

  /* 4. Carte au-dessus de Divine cachée : sa mise en scène joue d'abord,
        puis le reste du pack s'ouvre en cascade (pas d'ouverture sèche). */
  await scenario('après la mise en scène d’une Secrète, le reste s’ouvre en cascade', { reduceMotion: false, demo: '1' }, async ({ w, d }) => {
    const openAll = await revealFirstCard(d);
    const before = w.__refs();
    const deckSize = before.state.deck.length;
    const collectionBefore = before.state.collection.length;
    const coinsBefore = before.state.coins;
    const expected = expectedReward(w);
    openAll.click();
    assert.ok(w.__refs().packCinematic, 'la Secrète passe d’abord par sa mise en scène');
    assert.equal(w.__refs().openingAll, false);
    for (let t = 0; t < 9000 && !w.__refs().openingAll; t += 100) await wait(100);
    assert.ok(w.__refs().openingAll, 'la cascade prend le relais après la Secrète');
    const stack = d.getElementById('stack');
    assert.ok(stack.classList.contains('is-fan'));
    const secret = stack.querySelector('.card-secret');
    assert.ok(secret && secret.classList.contains('is-flipped'), 'la Secrète est déjà retournée');
    assert.ok(await untilResults(d), 'le récap s’affiche après la cascade');
    const after = w.__refs();
    assert.equal(after.state.collection.length, collectionBefore + deckSize - 1, 'la Secrète n’est comptée qu’une fois');
    assert.equal(after.state.coins, coinsBefore + expected);
    assert.equal(d.querySelectorAll('.pack-result').length, deckSize);
  });

  /* 5. Mouvement réduit : ouverture instantanée, comme avant. */
  await scenario('mouvement réduit = ouverture instantanée', { reduceMotion: true, demo: 'fusion' }, async ({ w, d }) => {
    const openAll = await revealFirstCard(d);
    const before = w.__refs();
    const deckSize = before.state.deck.length;
    const coinsBefore = before.state.coins;
    const expected = expectedReward(w);
    openAll.click();
    assert.equal(w.__refs().openingAll, false, 'pas de cascade en mouvement réduit');
    assert.equal(d.getElementById('pack-results').hidden, false, 'récap immédiat');
    assert.equal(d.querySelectorAll('.pack-result').length, deckSize);
    assert.equal(w.__refs().state.coins, coinsBefore + expected);
  });
})().catch((error) => { console.error(error); process.exitCode = 1; });
