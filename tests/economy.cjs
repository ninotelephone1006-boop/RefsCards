// Ajouté pour l'équilibrage économique : les doublons rapportent moins,
// sans jamais débiter un solde existant ni ajouter carte / pack.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function makeDom() {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/?demo=1', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} }); // reduced motion : pas d'animations
  const noop = () => {};
  w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => noop, set: () => true });
  w.Sound = new Proxy({}, { get: () => noop });
  w.Math.random = () => 0.5; // aucun shiny aléatoire pendant le tirage démo
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/\}\)\(\);\s*$/, `
    window.__econ = { state, cardReward, applySave, showReveal, RARITIES, cardsDatabase };
  })();`), context);
  return { w, doc: w.document, api: w.__econ };
}

(async () => {
  /* 1. Barème : premier exemplaire plein tarif, décroissance, plancher. */
  {
    const { w, api } = makeDom();
    const common = api.cardsDatabase.find((c) => c.id === 'chasseur-royer');
    const base = api.RARITIES.common.reward;
    assert.equal(api.cardReward(common, 0), base, 'nouvelle carte = gain complet');
    const gains = [0, 1, 2, 3, 4, 5, 12].map((n) => api.cardReward(common, n));
    for (let i = 1; i < gains.length; i++) {
      assert.ok(gains[i] <= gains[i - 1], 'le gain ne doit jamais augmenter avec les doublons');
    }
    assert.ok(gains[1] < gains[0] && gains[1] > 0, '1er doublon réduit mais payé');
    assert.equal(gains[gains.length - 1], Math.round(base * 0.35), 'plancher à 35 %');
    assert.ok(api.cardReward({ rarity: 'inconnue' }, 0) >= 0, 'rareté inconnue sans erreur');
    w.close();
    console.log('PASS barème doublons : 100 % → 72 % → 52 % → 37 % → plancher 35 %');
  }

  /* 2. En jeu : posséder un exemplaire réduit le gain crédité ; une carte
        neuve paie toujours plein tarif. Le solde de départ n'est pas touché. */
  {
    const { w, doc, api } = makeDom();
    api.applySave({ coins: 1000, firstPack: false, decoReleaseClaimed: true, collection: ['chasseur-royer'] });
    api.showReveal();
    for (let tries = 0; tries < 60 && !doc.querySelector('#stack .card.is-top'); tries++) await wait(20);
    const first = doc.querySelector('#stack .card.is-top');
    assert.ok(first, 'pile démo prête');
    first.click();
    const afterDup = api.state.coins;
    const dupGain = afterDup - 1000;
    assert.equal(dupGain, api.cardReward(api.cardsDatabase.find((c) => c.id === 'chasseur-royer'), 1),
      'gain du doublon crédité');
    assert.ok(dupGain < api.RARITIES.common.reward, 'moins que le tarif d’une nouvelle commune');
    assert.match(doc.getElementById('reveal-sub').textContent, /gain réduit/, 'le joueur est informé');

    // Deuxième carte du tirage démo : pas encore possédée.
    doc.getElementById('next-card').click();
    await wait(180);
    for (let tries = 0; tries < 40 && !doc.querySelector('#stack .card.is-top:not(.is-revealed)'); tries++) await wait(20);
    const second = doc.querySelector('#stack .card.is-top');
    assert.ok(second, 'deuxième carte prête');
    second.click();
    const secondGain = api.state.coins - afterDup;
    assert.equal(secondGain, api.cardReward(api.cardsDatabase.find((c) => c.id === 'gros-plan-royer'), 0),
      'nouvelle carte = gain plein');
    assert.ok(secondGain > dupGain, 'une nouveauté rapporte plus qu’un doublon');
    assert.ok(api.state.coins > 1000, 'aucune pièce n’a été retirée au joueur');
    w.close();
    console.log('PASS révélation : doublon réduit, nouveauté plein tarif, solde préservé');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
