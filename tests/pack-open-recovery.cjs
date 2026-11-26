// Ouverture de booster atomique : une erreur pendant la cinématique ne doit
// ni consommer le pack, ni bloquer le jeu, ni forcer un rechargement.
// Exécuter avec : node tests/pack-open-recovery.cjs
const { JSDOM, VirtualConsole } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

async function scenario(label, { failReveal = false, emptyPool = false } = {}, run) {
  const errors = [];
  const virtualConsole = new VirtualConsole();
  virtualConsole.on('jsdomError', (error) => errors.push(error));
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://example.test/',
    runScripts: 'outside-only',
    pretendToBeVisual: true,
    virtualConsole
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  w.Element.prototype.getBoundingClientRect = () => ({
    left: 0, top: 0, right: 100, bottom: 140, width: 100, height: 140, x: 0, y: 0
  });
  w.Element.prototype.animate = () => ({ onfinish: null, cancel() {}, finished: Promise.resolve() });

  const source = fs.readFileSync('app.js', 'utf8')
    .replace(
      /(function showReveal\(packType\) \{\n)/,
      `$1    if (window.__failReveal) throw new Error('boom révélation');\n`
    )
    .replace(
      /(function packPool\(type\) \{\n)/,
      `$1    if (window.__emptyPool && type === 'classic') return [];\n`
    )
    .replace(
      /\}\)\(\);\s*$/,
      `  window.__testOpen = () => {
         state.currentPackType = 'classic';
         state.packStock.classic = 1;
         state.packsOpened = 7;
         state.phase = 'tearing';
         openPack();
       };
       window.__testState = () => ({
         phase: state.phase,
         stock: state.packStock.classic,
         opened: state.packsOpened,
         busy: document.body.classList.contains('refs-pack-opening'),
         revealHidden: document.getElementById('reveal-view').hidden,
         toast: document.getElementById('toast').textContent
       });
     })();\n`
    );
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(source, context);
  w.__failReveal = failReveal;
  w.__emptyPool = emptyPool;
  try {
    await run(w, errors);
    console.log(`PASS ouverture de booster : ${label}`);
  } finally {
    dom.window.close();
  }
}

(async () => {
  /* 1. Erreur pendant la révélation différée : le pack est rendu, l'écran
        revient au booster et le toast explique, sans navigation. */
  await scenario('erreur de révélation → booster intact, aucun rechargement', { failReveal: true }, async (w, errors) => {
    w.__testOpen();
    const busy = w.__testState();
    assert.equal(busy.busy, true, 'la cinématique signale qu\'un booster est en cours');
    await wait(700);
    const s = w.__testState();
    assert.equal(s.phase, 'pack', 'le jeu revient à l\'écran du booster');
    assert.equal(s.stock, 1, 'le booster consommé est rendu');
    assert.equal(s.opened, 7, 'le compteur de boosters ouverts est restauré');
    assert.equal(s.busy, false, 'le drapeau « ouverture en cours » est retiré');
    assert.equal(s.revealHidden, true, 'aucune pile à moitié construite n\'est affichée');
    assert.match(s.toast, /booster est intact/i);
    assert.equal(errors.filter((e) => /navigation/i.test(e.message)).length, 0, 'aucune navigation/rechargement');
  });

  /* 2. Tirage vide : le pack ne doit pas non plus être perdu. */
  await scenario('tirage vide → booster rendu', { emptyPool: true }, async (w, errors) => {
    w.__testOpen();
    await wait(700);
    const s = w.__testState();
    assert.equal(s.phase, 'pack');
    assert.equal(s.stock, 1, 'un tirage avorté ne consomme pas le booster');
    assert.equal(s.opened, 7);
    assert.equal(errors.filter((e) => /navigation/i.test(e.message)).length, 0);
  });

  /* 3. Le bandeau de mise à jour ne recharge pas pendant l'ouverture :
        le rechargement est différé jusqu'à la fin de la cinématique. */
  {
    const errors = [];
    const virtualConsole = new VirtualConsole();
    virtualConsole.on('jsdomError', (error) => errors.push(error));
    const dom = new JSDOM('<!doctype html><html><head><meta name="app-version" content="2026.11.26-2"></head><body></body></html>', {
      url: 'https://example.test/', runScripts: 'outside-only', virtualConsole
    });
    const w = dom.window;
    vm.runInContext(fs.readFileSync('version-check.js', 'utf8'), dom.getInternalVMContext());
    const api = w.REFS_CARDS_VERSION_CHECK;
    assert.ok(api, 'API de mise à jour exposée');
    w.document.body.classList.add('refs-pack-opening');
    api.reload();
    assert.equal(errors.filter((e) => /navigation/i.test(e.message)).length, 0, 'pas de rechargement pendant l\'ouverture');
    w.document.body.classList.remove('refs-pack-opening');
    api.reload();
    assert.equal(errors.filter((e) => /navigation/i.test(e.message)).length, 1, 'rechargement dès que l\'ouverture est terminée');
    dom.window.close();
    console.log('PASS bandeau « Recharger » différé pendant l\'ouverture d\'un booster');
  }
})().catch((error) => { console.error(error); process.exitCode = 1; });
