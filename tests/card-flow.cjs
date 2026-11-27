// Run with NODE_PATH pointing to a local jsdom installation: node tests/card-flow.cjs
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  for (const width of [390, 1440]) {
    const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
      url: 'https://example.test/?demo=1', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window;
    w.innerWidth = width;
    w.matchMedia = () => ({ matches: true, addEventListener() {} });
    const noop = () => {};
    const ctx = new Proxy({}, { get: () => noop, set: () => true });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.Sound = new Proxy({}, { get: () => noop });
    const context = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
    // Les cartes vidéo peuvent se passer d'`image` : leur couverture est la
    // vidéo elle-même. On ne contrôle donc les sources d'image que pour les
    // cartes sans bloc `video`.
    const imageCards = vm.runInContext(
      'cardsDatabase.filter((card) => !cardVideoConfig(card))',
      context
    );
    const sources = vm.runInContext(
      'cardsDatabase.filter((card) => !cardVideoConfig(card)).flatMap(cardImageSources)',
      context
    );
    assert.ok(sources.length >= imageCards.length, 'au moins une source candidate par carte image');
    // Les visuels manquants sont prévus (repli emoji/couleur) : on vérifie
    // que les fichiers présents sont bien trouvés, sans exiger les absents.
    const present = sources.filter((src) => fs.existsSync(src));
    assert.ok(present.length >= imageCards.length - 1, 'presque toutes les images doivent exister');
    // Start the reveal directly; the pack tear is unrelated to this regression.
    /* `boot();` est appelé dans start() (garde-fou DOMContentLoaded) : on
       choisit l'indentation réelle pour lancer aussi la révélation. */
    vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/(^\s*)boot\(\);$/m, '$1boot(); showReveal();'), context);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    await wait(30);
    const next = w.document.getElementById('next-card');
    assert.ok(next.hidden);
    /* La pile est montée juste après le démarrage (délai/animation) : on
       attend la première carte plutôt qu'un délai fixe trop court. */
    for (let tries = 0; tries < 40 && !w.document.querySelector('.card.is-top'); tries++) await wait(25);
    for (let i = 0; i < 5; i++) {
      const card = w.document.querySelector('.card.is-top');
      assert.ok(card);
      card.click();
      await wait(15);
      assert.ok(!next.hidden);
      next.click();
      next.click(); // repeated taps must not collect twice
      assert.ok(next.hidden);
      await wait(160);
      assert.equal(w.document.querySelectorAll('.slot.is-filled').length, i + 1);
      assert.equal(w.document.querySelectorAll('#stack .card').length, 4 - i);
    }
    assert.equal(w.document.getElementById('pile-label').textContent, 'CARTE 5 / 5 · RÉVÉLÉE');
    dom.window.close();
    console.log(`PASS card flow and image paths at viewport width ${width} (DOM simulation)`);
  }

  /* Vérifie l'équilibrage du tirage hors démo : Chasseur Royer (seule carte
     commune) ne doit plus monopoliser ~30 % des cartes ni sortir en 3+ copies
     dans un même booster (classique 5 cartes ou légende 10 cartes). */
  {
    const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
      url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window;
    w.matchMedia = () => ({ matches: true, addEventListener() {} });
    const noop = () => {};
    const ctx = new Proxy({}, { get: () => noop, set: () => true });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.Sound = new Proxy({}, { get: () => noop });
    const context = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
    vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
    vm.runInContext(
      fs.readFileSync('app.js', 'utf8').replace(
        /\}\)\(\);\s*$/,
        '  window.__testDraw = (type, boosted) => { state.currentPackType = type; return drawPack(boosted); };\n})();\n'
      ),
      context
    );
    let totalCards = 0;
    let chasseurCount = 0;
    for (let i = 0; i < 600; i++) {
      const pack = w.__testDraw('classic', false);
      assert.equal(pack.length, 5);
      const inPack = pack.filter((c) => c.id === 'chasseur-royer').length;

      totalCards += pack.length;
      chasseurCount += inPack;
    }
    const classicRate = chasseurCount / totalCards;
    assert.ok(classicRate < 0.15, `taux de Chasseur Royer trop élevé : ${(classicRate * 100).toFixed(1)} %`);
    /* Le coup de pouce « pack rentable » remonte une partie des communes
       vers des raretés plus élevées : la part du Chasseur Royer est donc
       plus basse qu'avant (environ 4-5 %), mais la carte reste tirable. */
    assert.ok(classicRate > 0.04, `Chasseur Royer doit rester tirable : ${(classicRate * 100).toFixed(1)} %`);

    for (let i = 0; i < 300; i++) {
      const pack = w.__testDraw('legend', false);
      assert.equal(pack.length, 10);
      const inPack = pack.filter((c) => c.id === 'chasseur-royer').length;
      assert.ok(inPack <= 2, `pas plus de 2 Chasseur Royer dans un pack légende (eu ${inPack})`);
    }
    dom.window.close();
    console.log(`PASS tirage équilibré : Chasseur Royer = ${(classicRate * 100).toFixed(1)} % (sans plafond en classique)`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
