// Animations : les effets optionnels (WAAPI) ne doivent jamais bloquer une
// ouverture de booster, laisser un fantôme à l'écran, ni déborder sur un autre
// onglet. Exécuter avec jsdom installé : node tests/animations.cjs
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Ouvre le jeu en mode démo et lance directement la révélation. `animate`
   permet de simuler un navigateur sans WAAPI (null) ou une animation qui ne
   rend jamais la main (`{ stuck: true }`). */
async function boot({ animate = 'native', reduceMotion = false, demo = '1' } = {}) {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: `https://example.test/?demo=${demo}`, runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: reduceMotion, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  /* jsdom ne calcule aucune géométrie : une boîte fixe suffit pour que les
     vols de carte aient un départ et une arrivée. */
  w.Element.prototype.getBoundingClientRect = () => ({ left: 0, top: 0, right: 100, bottom: 140, width: 100, height: 140, x: 0, y: 0 });
  if (animate === null) delete w.Element.prototype.animate;
  else if (animate === 'stuck') {
    w.Element.prototype.animate = () => ({ onfinish: null, cancel() {}, finished: new Promise(() => {}) });
  } else {
    w.Element.prototype.animate = () => ({ onfinish: null, cancel() {}, finished: Promise.resolve() });
  }
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(
    fs.readFileSync('app.js', 'utf8')
      .replace(/(^\s*)boot\(\);$/m, '$1boot(); showReveal();')
      .replace(
        /\}\)\(\);\s*$/,
        '  window.__refs = () => ({ state, remaining, revealCard, rarityBurst, domSpark, activeCharge: () => activeCharge, flying: () => flying, openingAll: () => openingAll });\n})();\n'
      ),
    context
  );
  await wait(40);
  for (let tries = 0; tries < 40 && !w.document.querySelector('.card.is-top'); tries++) await wait(25);
  assert.ok(w.document.querySelector('.card.is-top'), 'la pile de démonstration doit être montée');
  return { dom, w, d: w.document };
}

async function scenario(label, opts, run) {
  const env = await boot(opts);
  try {
    await run(env);
    console.log(`PASS animations : ${label}`);
  } finally {
    env.dom.window.close();
  }
}

(async () => {
  /* 1. Sans WAAPI, une nouvelle carte doit quand même se ranger : avant le
        correctif, flyToCollection levait, `flying` restait bloqué à true et le
        booster entier devenait injouable. */
  await scenario('sans WAAPI, la carte se range et le booster continue', { animate: null, demo: 'fusion' }, async ({ w, d }) => {
    const first = d.querySelector('.card.is-top');
    first.click();
    await wait(30);
    assert.ok(first.classList.contains('is-flipped'));
    assert.equal(first.dataset.isNew, '1', 'la première carte de la démo est nouvelle');

    d.getElementById('next-card').click();
    await wait(800);
    const refs = w.__refs();
    assert.equal(refs.flying(), false, 'l’envol ne bloque plus la suite');
    assert.equal(refs.state.loot.length, 1, 'la carte est rangée dans le butin');
    assert.equal(d.querySelectorAll('.coll-ghost').length, 0, 'aucun fantôme laissé à l’écran');
    assert.equal(d.querySelectorAll('#stack .card').length, 4);

    /* La carte suivante reste jouable. */
    const next = d.querySelector('.card.is-top');
    assert.ok(next);
    next.click();
    await wait(30);
    assert.ok(next.classList.contains('is-flipped'), 'la carte suivante se retourne');
  });

  /* 2. Une animation d'envol qui n'émet jamais `finish` ne doit pas laisser le
        fantôme ni la traînée d'étincelles indéfiniment. */
  await scenario('envol bloqué : filet de sécurité et fantôme retiré', { animate: 'stuck', demo: 'fusion' }, async ({ w, d }) => {
    d.querySelector('.card.is-top').click();
    await wait(30);
    d.getElementById('next-card').click();
    await wait(800);
    assert.equal(w.__refs().state.loot.length, 1, 'le butin est rempli même si le vol traîne');
    assert.equal(d.querySelectorAll('.coll-ghost').length, 1, 'le fantôme vole encore à 0,8 s');
    await wait(1300); // > filet de sécurité (1,7 s)
    assert.equal(d.querySelectorAll('.coll-ghost').length, 0, 'le fantôme est retiré par le filet de sécurité');
    assert.ok(d.querySelectorAll('.fx-float').length >= 1, 'l’onglet Collection réagit à l’arrivée');
    await wait(1200);
    assert.equal(d.querySelectorAll('.fx-spark').length, 0, 'aucune étincelle ne reste collée à l’écran');
  });

  /* 3. Quitter l'onglet Booster pendant un suspense : la carte se retourne
        aussitôt, l'overlay et les battements de cœur ne débordent pas. */
  await scenario('suspense interrompu au changement d’onglet', {}, async ({ w, d }) => {
    const refs = w.__refs();
    const index = refs.state.deck.findIndex((card) => card.rarity === 'rare');
    assert.ok(index >= 0, 'la démo contient une carte rare (suspense)');
    const card = refs.state.deck[index];
    const node = d.getElementById('stack').children[index];
    refs.revealCard(node, card);
    await wait(40);
    assert.equal(d.querySelectorAll('.suspense-layer').length, 1, 'le suspense est affiché');
    assert.ok(node.classList.contains('is-charging'));

    d.querySelector('.tab[data-tab="shop"]').click();
    assert.equal(d.querySelectorAll('.suspense-layer').length, 0, 'l’overlay ne reste pas sur l’onglet Shop');
    assert.equal(refs.activeCharge(), null, 'plus aucune charge en cours');
    assert.ok(node.classList.contains('is-flipped'), 'la carte se retourne immédiatement');
    assert.equal(node.classList.contains('is-charging'), false);

    await wait(600);
    assert.equal(d.querySelectorAll('.suspense-layer').length, 0, 'aucun overlay ne réapparaît après coup');
    assert.equal(d.getElementById('stage').classList.contains('shake'), false);
  });

  /* 4. Les effets de rareté ne s'affichent que sur l'écran du booster. */
  await scenario('effets de rareté limités à l’onglet Booster', {}, async ({ w, d }) => {
    const refs = w.__refs();
    /* Seule la rareté compte pour choisir le palier d'effet. */
    const legendary = { id: 'test-legendary', name: 'Test', description: '', rarity: 'legendary' };

    d.querySelector('.tab[data-tab="shop"]').click();
    refs.rarityBurst(legendary, 50, 50, false);
    assert.equal(d.getElementById('rays').classList.contains('on'), false, 'pas de rayons sur le Shop');
    assert.equal(d.getElementById('flash').classList.contains('run'), false, 'pas de flash sur le Shop');
    assert.equal(d.getElementById('stage').classList.contains('shake'), false, 'pas de secousse sur le Shop');
    assert.equal(d.getElementById('app').classList.contains('slow-mo'), false);

    d.querySelector('.tab[data-tab="pack"]').click();
    refs.rarityBurst(legendary, 50, 50, false);
    assert.equal(d.getElementById('rays').classList.contains('on'), true, 'les rayons reviennent sur le booster');
    await wait(320);
    assert.equal(d.getElementById('stage').classList.contains('shake'), true, 'la secousse joue sur le booster');

    /* Un effet différé (secousse + flash programmés) ne doit pas surgir après
       un changement d'onglet. */
    refs.rarityBurst({ rarity: 'epic' }, 50, 50, false);
    d.querySelector('.tab[data-tab="shop"]').click();
    await wait(520);
    assert.equal(d.getElementById('stage').classList.contains('shake'), false, 'aucune secousse différée sur le Shop');
    assert.equal(d.getElementById('flash').classList.contains('run'), false, 'aucun flash différé sur le Shop');
  });

  /* 6. Quitter pendant « Ouvrir tout » termine la cascade immédiatement :
        aucune carte perdue, aucune animation derrière l'autre onglet. */
  await scenario('cascade interrompue au changement d’onglet', { demo: 'fusion' }, async ({ w, d }) => {
    const refs = w.__refs();
    const deckSize = refs.state.deck.length;
    d.querySelector('.card.is-top').click();
    await wait(30);
    d.getElementById('open-all').click();
    assert.equal(refs.openingAll(), true, 'la cascade est lancée');
    d.querySelector('.tab[data-tab="shop"]').click();
    assert.equal(refs.openingAll(), false, 'la cascade se termine au changement d’onglet');
    assert.equal(refs.state.phase, 'done', 'le pack est terminé');
    assert.equal(d.getElementById('pack-results').hidden, false, 'le récap est prêt au retour');
    assert.equal(d.querySelectorAll('#stack .card').length, 0, 'plus aucune carte sur la table');
    assert.equal(refs.state.loot.length, deckSize, 'toutes les cartes sont dans le butin');
    assert.equal(d.querySelectorAll('.pack-result').length, deckSize, 'le récap présente tout le pack');
    await wait(500);
    assert.equal(refs.state.loot.length, deckSize, 'aucune minuterie oubliée ne modifie le butin');
  });

  /* 5. Étincelle DOM : repli CSS quand WAAPI manque, puis retrait garanti. */
  await scenario('étincelle DOM sans WAAPI (repli CSS)', { animate: null }, async ({ w, d }) => {
    const before = d.querySelectorAll('.fx-spark').length;
    w.__refs().domSpark(10, 10, '#fff', 30, 120);
    const sparks = [...d.querySelectorAll('.fx-spark')];
    assert.equal(sparks.length, before + 1);
    assert.ok(sparks[sparks.length - 1].classList.contains('fx-spark-css'), 'le repli CSS est utilisé');
    await wait(320);
    assert.equal(d.querySelectorAll('.fx-spark').length, before, 'l’étincelle est retirée du DOM');
  });
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
