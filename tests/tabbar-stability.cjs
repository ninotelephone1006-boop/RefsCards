// Run with NODE_PATH pointing to a local jsdom installation: node tests/tabbar-stability.cjs
// La barre d'onglets « décrochait » parfois et faisait sauter tout le contenu.
// Cause : la page elle-même pouvait défiler (barre d'adresse repliée, rebond
// iOS, clavier) et la hauteur de .app restait figée sur un 100dvh périmé.
// Depuis, html/body ne défilent plus et app.js publie la hauteur réellement
// visible dans --app-h (visualViewport), que .app consomme.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function boot({ innerHeight = 812, visualHeight = 812 } = {}) {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url: 'https://refs-cards.test/', runScripts: 'outside-only', pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  w.innerHeight = innerHeight;
  // visualViewport factice (Safari / Chrome mobile) : on peut faire varier la
  // hauteur visible comme le fait la barre d'adresse pendant un scroll.
  const viewport = new w.EventTarget();
  viewport.height = visualHeight;
  viewport.width = 390;
  viewport.offsetTop = 0;
  w.visualViewport = viewport;
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('firebase-config.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  vm.runInContext(fs.readFileSync('app.js', 'utf8'), context);
  return { dom, w, viewport, appHeight: () => w.document.documentElement.style.getPropertyValue('--app-h') };
}

(async () => {
  /* 1. La coquille est verrouillée : ni html ni body ne peuvent défiler, et
     .app mesure la hauteur visible (variable --app-h) plutôt que 100dvh. */
  // Commentaires retirés : ils contiennent des accolades ({ } de `calc`, etc.).
  const css = fs.readFileSync('styles.css', 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
  const rule = (selector) => {
    // Toutes les règles dont la liste de sélecteurs contient exactement
    // `selector`, concaténées : une déclaration ajoutée plus loin dans la
    // feuille compte autant qu'une déclaration posée à côté de `margin: 0`.
    let body = null;
    const blocks = css.matchAll(/([^{}]+)\{([^}]*)\}/g);
    for (const [, selectors, declarations] of blocks) {
      if (selectors.includes('@')) continue; // media queries : on les ignore
      // « .app » et « .app:hover » ne doivent pas être confondus.
      const list = selectors.split(',').map((s) => s.trim());
      if (list.includes(selector)) body = `${body || ''}\n${declarations}`;
    }
    assert.ok(body !== null, `règle ${selector} attendue dans styles.css`);
    return body;
  };
  assert.match(rule('html'), /overflow:\s*hidden/, 'html doit bloquer le défilement du document');
  assert.match(rule('body'), /overflow:\s*hidden/, 'body doit bloquer le défilement du document');
  assert.doesNotMatch(rule('body'), /min-height:\s*100%/, 'body ne doit plus grandir au-delà de l’écran');
  assert.match(rule('.app'), /height:\s*var\(--app-h/, '.app doit suivre la hauteur visible —app-h');

  /* 2. Au démarrage, --app-h vaut la hauteur visible réelle. */
  const first = boot();
  await wait(40);
  assert.equal(first.appHeight(), '812px', 'la hauteur visible du démarrage est publiée dans --app-h');
  first.w.close();

  /* 3. Le clavier s'ouvre (viewport réduit à 420 px) : la coquille ne doit PAS
     se replier à 420 px, sinon la barre d'onglets saute au milieu de l'écran. */
  {
    const ui = boot();
    await wait(40);
    assert.match(ui.w.document.body.textContent, /Chargement/);
    ui.viewport.height = 420;
    ui.viewport.dispatchEvent(new ui.w.Event('resize'));
    await wait(10);
    assert.equal(ui.appHeight(), '812px', 'un clavier ouvert ne rétrécit pas la coquille');
    /* 4. Barre d'adresse repliée : la zone visible grandit, --app-h suit. */
    ui.w.innerHeight = 880;
    ui.viewport.height = 880;
    ui.viewport.dispatchEvent(new ui.w.Event('resize'));
    await wait(10);
    assert.equal(ui.appHeight(), '880px', 'la barre d’adresse repliée met --app-h à jour');
    /* Barre d'adresse revenue : innerHeight est souvent en retard sur
       visualViewport (valeur périmée haute) — .app ne doit pas rester plus
       haut que l'écran, sinon le bas (la barre d'onglets) sort de l'écran. */
    ui.w.innerHeight = 812;
    ui.viewport.height = 760;
    ui.viewport.dispatchEvent(new ui.w.Event('resize'));
    await wait(10);
    assert.equal(ui.appHeight(), '760px', 'c’est la zone visible qui fait foi quand elle est plus petite');
    /* Un rebond de scroll (évènement scroll du visualViewport) ne doit pas
       casser la valeur : la hauteur visible ne change pas. */
    ui.viewport.dispatchEvent(new ui.w.Event('scroll'));
    await wait(10);
    assert.equal(ui.appHeight(), '760px', 'le rebond de scroll ne modifie pas la hauteur');
    ui.w.close();
  }

  /* 5. Sans visualViewport (navigateurs anciens), innerHeight prend le relais. */
  {
    const ui = boot({ innerHeight: 900, visualHeight: 900 });
    delete ui.w.visualViewport;
    ui.w.innerHeight = 880;
    ui.w.dispatchEvent(new ui.w.Event('resize'));
    await wait(10);
    assert.equal(ui.appHeight(), '880px', 'innerHeight est utilisé sans visualViewport');
    ui.w.close();
  }

  console.log('PASS barre d’onglets stable : document verrouillé, --app-h synchronisée (clavier, barre d’adresse, rebond)');
})().catch((error) => { console.error(error); process.exitCode = 1; });
