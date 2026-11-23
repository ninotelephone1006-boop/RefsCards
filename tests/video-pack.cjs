// Run with NODE_PATH pointing to a local jsdom installation:
// node tests/video-pack.cjs
//
// Vérifie le Pack Vidéo de bout en bout (structure des données, tirage,
// lecteur <video>, fps / son / boucle par carte, stock sauvegardable).
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

function bootApp(url = 'https://refs-cards.test/') {
  const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
    url,
    runScripts: 'outside-only',
    pretendToBeVisual: true
  });
  const w = dom.window;
  w.matchMedia = () => ({ matches: true, addEventListener() {} });
  const noop = () => {};
  const ctx = new Proxy({}, { get: () => noop, set: () => true });
  w.HTMLCanvasElement.prototype.getContext = () => ctx;
  w.Sound = new Proxy({}, { get: () => noop });
  const context = dom.getInternalVMContext();
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
  /* Expose les fonctions internes à la fin du module, sans changer le code
     exécuté au démarrage. */
  const appSrc = fs.readFileSync('app.js', 'utf8').replace(
    /\}\)\(\);\s*$/,
    `  window.__videoTest = {
      state, drawPack, packPool, cardFrame, buildCard, selectPackType,
      packStockFrom, packTotal, cardVideoPlaybackRate, cardVideoInfo,
      showReveal, applySave, packComingSoon, isPackAvailable,
      PACK_COMING_SOON, PACK_TYPES
    };\n})();\n`
  );
  vm.runInContext(appSrc, context);
  return { w, doc: w.document, context };
}

(async () => {
  /* 0. Fichiers et intégration de la boutique. */
  assert.ok(fs.existsSync('assets/packetvideo.png'), 'packetvideo.png doit exister');
  ['babault-dancing-live', 'karate-fagar-le-film', 'royer-rizz-cam', 'royer-rizz-cam-24', 'chasseur-royer-slowmo']
    .forEach((name) => {
      assert.ok(fs.existsSync(`assets/Cartes/videos/${name}.mp4`), `${name}.mp4 doit exister`);
    });
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /data-pack="video"/, 'carte Pack Vidéo dans le Shop');
  assert.match(html, /id="buy-video"/, 'bouton d’achat vidéo');
  assert.match(html, /id="open-video"/, 'bouton d’ouverture vidéo');
  assert.match(html, /BIENTÔT/, 'le Pack Vidéo est marqué « BIENTÔT »');
  assert.match(html, /pas encore achetable ni ouvrable/, 'message d’avant-première visible');
  assert.match(html, /packetvideo\.png/, 'visuel packetvideo.png référencé');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /packStock\.video is int/, 'les règles Firestore autorisent le stock vidéo');
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /'\.mp4':'video\/mp4'/, 'le serveur local sert les .mp4 en video/mp4');
  assert.match(server, /'\.webm':'video\/webm'/, 'le serveur local sert les .webm en video/webm');
  console.log('PASS fichiers Pack Vidéo + boutique + règles Firestore');

  /* 1. Structure de données : normalisation, alias hasAudio, défauts. */
  const cardsContext = vm.createContext({});
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), cardsContext);
  const normalize = vm.runInContext('normalizeVideoConfig', cardsContext);
  const cardVideoSources = vm.runInContext('cardVideoSources', cardsContext);
  assert.equal(normalize({}), null, 'pas de source = pas de carte vidéo');
  assert.equal(normalize({ src: '' }), null, 'source vide refusée');
  const defaults = normalize({ src: 'clip' });
  assert.equal(defaults.fps, null, 'fps par défaut = null');
  assert.equal(defaults.sound, false, 'son par défaut = false');
  assert.equal(defaults.loop, true, 'boucle par défaut = true');
  assert.equal(defaults.autoplay, true, 'lecture auto par défaut');
  const alias = normalize({ src: 'clip', hasAudio: true, loop: false, fps: 24 });
  assert.equal(alias.sound, true, 'hasAudio est accepté comme alias de sound');
  assert.equal(alias.loop, false, 'loop false conservé');
  assert.equal(alias.fps, 24, 'fps conservé');
  assert.equal(
    cardVideoSources({ video: { src: 'clip', srcByFps: { 24: 'clip-24', 60: 'clip-60' }, fps: 60 } })[0],
    'assets/Cartes/videos/clip-60.mp4',
    'la variante du fps demandé passe en premier'
  );
  assert.equal(
    cardVideoSources({ video: { src: 'clip' } })[0],
    'assets/Cartes/videos/clip.mp4',
    'source sans extension → .mp4 dans assets/Cartes/videos/'
  );
  console.log('PASS config vidéo par carte (fps / sound / loop / srcByFps)');

  /* 2. Catalogue + tirage : le Pack Vidéo ne contient que des cartes vidéo. */
  const { w, doc, context } = bootApp();
  await wait(40);
  const test = w.__videoTest;
  assert.ok(test, 'helpers exposés');
  const videoPool = test.packPool('video');
  assert.equal(videoPool.length, 4, '4 cartes vidéo dans le catalogue');
  assert.ok(videoPool.every((card) => test.cardVideoInfo(card)), 'toutes les cartes du pool vidéo ont une vidéo');
  for (let i = 0; i < 30; i++) {
    const pack = test.drawPack(false, test.packPool('video'), 'video');
    assert.equal(pack.length, 3, 'un Pack Vidéo contient 3 cartes');
    pack.forEach((card) => {
      assert.ok(test.cardVideoInfo(card), `${card.id} doit être une carte vidéo`);
    });
  }
  /* Les autres packs restent complets et fonctionnels. */
  assert.equal(test.drawPack(false, test.packPool('classic'), 'classic').length, 5, 'pack classique intact');
  console.log('PASS tirage Pack Vidéo = 3 cartes vidéo, autres packs intacts');

  /* 3. Lecteur : fps, son, boucle et variantes respectés par carte. */
  const byId = (id) => vm.runInContext('cardsDatabase', cardsContext).find((card) => card.id === id);
  const build = (id, opts = {}) => test.cardFrame(byId(id), opts);

  const babault = build('babault-dancing-live');
  let video = babault.querySelector('video.cf-video');
  assert.ok(video, 'la carte vidéo utilise un <video>');
  assert.equal(video.dataset.fps, '24');
  assert.equal(video.dataset.sound, 'off');
  assert.equal(video.dataset.loop, 'on');
  assert.equal(video.loop, true);
  assert.equal(video.muted, true, 'départ muet compatible autoplay');
  assert.equal(babault.querySelector('.cf-audio'), null, 'pas de bouton son sans sound:true');
  assert.match(babault.querySelector('.cf-video-tags').textContent, /24 i\/s/);

  const karate = build('karate-fagar-film');
  video = karate.querySelector('video.cf-video');
  assert.equal(video.dataset.sound, 'on');
  assert.equal(video.dataset.loop, 'on');
  assert.ok(karate.querySelector('.cf-audio'), 'bouton 🔊 présent quand sound:true');

  const slowmo = build('chasseur-royer-slowmo');
  video = slowmo.querySelector('video.cf-video');
  assert.equal(video.dataset.loop, 'off');
  assert.equal(video.loop, false, 'loop:false respecté');
  assert.equal(video.dataset.fps, '24');
  assert.equal(video.dataset.sourceFps, '60');
  assert.equal(test.cardVideoPlaybackRate(test.cardVideoInfo(byId('chasseur-royer-slowmo'))), 0.4,
    'fps 24 sur source 60 → vitesse ×0,4');

  const royer = build('royer-rizz-cam');
  video = royer.querySelector('video.cf-video');
  assert.equal(video.dataset.fps, '60');
  const firstSource = video.querySelector('source');
  assert.match(firstSource.getAttribute('src'), /royer-rizz-cam\.mp4$/, 'variante 60 i/s choisie');

  /* Miniature : pas de bouton son, vidéo montée quand même (muette). */
  const mini = build('karate-fagar-film', { mini: true });
  assert.ok(mini.querySelector('video.cf-video'), 'vidéo aussi dans les miniatures');
  assert.equal(mini.querySelector('.cf-audio'), null, 'pas de bouton son en miniature');

  /* Compatibilité mutation : une carte vidéo Shiny garde sa vidéo et ses réglages. */
  const shinyVideo = vm.runInContext(
    "CardMutations.roll(cardsDatabase.find((c) => c.id === 'karate-fagar-film'), () => 0)",
    cardsContext
  );
  const shinyFrame = test.cardFrame(shinyVideo);
  assert.ok(shinyFrame.classList.contains('mutation-shiny'), 'la couche Shiny reste appliquée');
  const shinyVideoEl = shinyFrame.querySelector('video.cf-video');
  assert.ok(shinyVideoEl, 'la carte vidéo Shiny garde son lecteur');
  assert.equal(shinyVideoEl.dataset.sound, 'on', 'les réglages vidéo survivent à la mutation');
  assert.equal(shinyVideoEl.dataset.fps, '30');
  console.log('PASS lecture : <video> avec fps, sound, loop, srcByFps et mutation Shiny');

  /* 4. Stock : vidéo incluse dans l'inventaire, l'achat et la sauvegarde. */
  const stock = test.packStockFrom({ classic: 1, rare: 2, legend: 3, video: 4 });
  assert.deepEqual(
    JSON.parse(JSON.stringify(stock)),
    { classic: 1, rare: 2, legend: 3, video: 4 },
    'la normalisation conserve les quatre types de packs'
  );
  assert.equal(test.packStockFrom({ classic: 1 }).video, 0, 'ancienne sauvegarde → 0 pack vidéo');
  test.state.packStock = stock;
  assert.equal(test.packTotal(), 10, 'le stock vidéo entre dans le total');
  assert.ok(test.PACK_TYPES.includes('video'), 'type vidéo enregistré dans la liste des packs');

  /* Chargement d'une sauvegarde contenant des packs vidéo. */
  test.applySave({
    coins: 5000,
    firstPack: false,
    collection: [],
    friends: [],
    packsOpened: 0,
    packStock: { classic: 0, rare: 0, legend: 0, video: 2 },
    freeDate: '',
    freeUsed: 0
  });
  assert.equal(test.state.packStock.video, 2, 'packStock.video chargé depuis la sauvegarde');
  assert.equal(test.state.currentPackType, 'video', 'le Pack Vidéo est sélectionné quand il est le seul en stock');
  assert.match(doc.getElementById('open-video').textContent, /BIENTÔT/, 'bouton OUVRIR VIDÉO marqué bientôt');
  assert.equal(doc.getElementById('open-video').disabled, true, 'ouverture vidéo bloquée');
  assert.ok(doc.querySelector('.inventory-card[data-pack-type="video"]'), 'carte Booster Vidéo dans l’inventaire');
  assert.equal(doc.querySelector('.inventory-card[data-pack-type="video"] .inventory-open-btn').disabled, true,
    'bouton d’ouverture d’inventaire bloqué');
  assert.match(doc.getElementById('inventory-summary').textContent, /2 packs prêts/, 'résumé inventaire avec les packs vidéo');

  /* Achat et ouverture bloqués : visible, mais on ne peut pas le prendre. */
  assert.equal(test.packComingSoon('video'), true, 'le Pack Vidéo est en « bientôt disponible »');
  assert.equal(test.isPackAvailable('video'), false, 'non disponible hors démo');
  const coinsBefore = doc.getElementById('coins').textContent;
  doc.getElementById('buy-video').click();
  await wait(30);
  assert.equal(doc.getElementById('coins').textContent, coinsBefore, 'aucun achat possible');
  assert.equal(test.state.packStock.video, 2, 'aucun pack vidéo ajouté');
  assert.equal(doc.getElementById('buy-video').disabled, true, 'bouton ACHETER désactivé');
  assert.match(doc.getElementById('buy-video').textContent, /BIENTÔT DISPONIBLE/);
  assert.match(doc.getElementById('shop-stock-video').textContent, /Bientôt disponible/);
  assert.equal(doc.querySelector('.shop-card[data-pack="video"]').classList.contains('is-coming-soon'), true,
    'carte Shop en avant-première');
  assert.equal(doc.querySelector('.qty-chip[data-pack="video"]').disabled, true, 'quantité vidéo désactivée');

  test.selectPackType('video');
  assert.equal(test.state.currentPackType, 'video');
  assert.match(doc.getElementById('pack-img-main').getAttribute('src'), /packetvideo\.png/);
  assert.equal(doc.querySelectorAll('.gap-cards i').length, 3, '3 cartes dans le booster vidéo');

  /* 5. Ouverture réelle : la pile contient des cartes vidéo jouables. */
  test.showReveal();
  const stackCards = [...doc.querySelectorAll('#stack .card')];
  assert.equal(stackCards.length, 3, '3 cartes révélées');
  stackCards.forEach((node) => {
    assert.ok(node.querySelector('video.cf-video'), 'chaque carte de la pile a un lecteur vidéo');
  });
  assert.match(doc.getElementById('pack-odds').textContent, /PACK VIDÉO/, 'note vidéo dans les probabilités');

  w.close();

  /* 6. La démo reste disponible malgré l'avant-première (sans achat). */
  const demo = bootApp('https://refs-cards.test/?demo=video');
  await wait(40);
  assert.equal(demo.w.__videoTest.state.currentPackType, 'video', '?demo=video sélectionne le pack');
  assert.equal(demo.w.__videoTest.isPackAvailable('video'), true, 'la démo autorise la prévisualisation');
  assert.equal(demo.doc.getElementById('buy-video').disabled, true, 'achat toujours bloqué en démo');
  assert.match(demo.doc.getElementById('pack-img-main').getAttribute('src'), /packetvideo\.png/);
  assert.equal(demo.doc.querySelectorAll('.gap-cards i').length, 3);
  demo.w.__videoTest.showReveal();
  assert.equal(demo.doc.querySelectorAll('#stack .card').length, 3, 'la démo affiche les 3 cartes animées');
  demo.w.close();
  console.log('PASS Pack Vidéo : visible mais non achetable, démo ?demo=video conservée');
  console.log('PASS video pack flow');
})().catch((error) => { console.error(error); process.exitCode = 1; });
