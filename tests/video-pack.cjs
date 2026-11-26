// Run with NODE_PATH pointing to a local jsdom installation:
// node tests/video-pack.cjs
//
// Vérifie le Pack Vidéo de bout en bout. Le projet livre une carte vidéo
// (« Le Sapin George », voir cards.js) : on la compte dans les pools et on
// l'injecte aussi dans les cas dédiés. On injecte également des cartes de
// test dans cardsDatabase pour contrôler structure des données, tirage,
// lecteur <video>, réglages par carte et stock sauvegardable.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

/* Cartes vidéo de test : elles simulent celles que l'utilisateur ajoute dans
   cards.js avec ses propres fichiers .mp4 déposés dans assets/Cartes/videos/. */
const SAMPLE_VIDEO_CARDS = [
  {
    id: 'test-babault-live',
    name: 'Babault Live (test)',
    description: '24 images par seconde.',
    rarity: 'divine',
    emoji: '🕺',
    image: 'assets/Cartes/babaultdancing.png',
    color: '#bff3ff',
    video: { src: 'clip-babault', fps: 24, sound: false, loop: true }
  },
  {
    id: 'test-karate-film',
    name: 'Karate Film (test)',
    description: 'Avec le son.',
    rarity: 'legendary',
    emoji: '🎬',
    image: 'assets/Cartes/karate-fagar.jpg',
    color: '#f5d979',
    video: { src: 'clip-karate', fps: 30, sound: true, loop: true }
  },
  {
    id: 'test-royer-cam',
    name: 'Royer Cam (test)',
    description: '60 images par seconde.',
    rarity: 'ultraepic',
    emoji: '📹',
    image: 'assets/Cartes/royer-rizz.jpg',
    color: '#ff8fd1',
    video: {
      src: 'clip-royer',
      srcByFps: { 24: 'clip-royer-24', 60: 'clip-royer' },
      fps: 60,
      sound: false,
      loop: true
    }
  },
  {
    id: 'test-chasseur-slowmo',
    name: 'Chasseur Slowmo (test)',
    description: 'Ralenti ×0,4.',
    rarity: 'mythic',
    emoji: '🎞️',
    image: 'assets/Cartes/chasseur-royer.jpg',
    color: '#ffa469',
    video: { src: 'clip-slowmo', fps: 24, sourceFps: 60, sound: false, loop: false }
  }
];

function injectCards(context, cards) {
  if (!cards || !cards.length) return;
  vm.runInContext(`cardsDatabase.push(...${JSON.stringify(cards)});`, context);
}

/* Nombre de cartes vidéo déjà livrées avec le projet (avant toute injection). */
function builtinVideoCount() {
  const ctx = vm.createContext({});
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), ctx);
  return vm.runInContext(
    'cardsDatabase.filter((card) => Boolean(cardVideoConfig(card))).length',
    ctx
  );
}

/* Retire du catalogue les cartes vidéo livrées avec le projet (utile pour
   simuler un catalogue sans aucune carte vidéo). */
function stripBuiltinVideos(context) {
  vm.runInContext(
    'cardsDatabase.splice(0, cardsDatabase.length, ...cardsDatabase.filter((card) => !cardVideoConfig(card)))',
    context
  );
}

function bootApp(url = 'https://refs-cards.test/', extraCards = null, stripBuiltins = false) {
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
  vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
  injectCards(context, extraCards);
  if (stripBuiltins) stripBuiltinVideos(context);
  /* Expose les fonctions internes à la fin du module, sans changer le code
     exécuté au démarrage. */
  const appSrc = fs.readFileSync('app.js', 'utf8').replace(
    /\}\)\(\);\s*$/,
    `  window.__videoTest = {
      state, drawPack, packPool, cardFrame, buildCard, selectPackType,
      packStockFrom, packTotal, cardVideoPlaybackRate, cardVideoInfo,
      showReveal, applySave, PACK_TYPES, cardsDatabase
    };
})();
`
  );
  vm.runInContext(appSrc, context);
  return { w, doc: w.document, context };
}

(async () => {
  /* 0. Fichiers et intégration de la boutique. */
  assert.ok(fs.existsSync('assets/packetvideo.png'), 'packetvideo.png doit exister');
  assert.ok(
    fs.existsSync('assets/Cartes/videos/LISEZ-MOI.txt'),
    'le dossier des vidéos utilisateur est conservé (LISEZ-MOI.txt)'
  );
  const html = fs.readFileSync('index.html', 'utf8');
  assert.match(html, /data-pack="video"/, 'carte Pack Vidéo dans le Shop');
  assert.match(html, /id="buy-video"/, 'bouton d’achat vidéo');
  assert.match(html, /id="open-video"/, 'bouton d’ouverture vidéo');
  /* Le teaser « BIENTÔT DISPONIBLE » de l'onglet Déco est normal : cette
     vérification ne concerne que le panneau des packs. */
  const packsPanel = html.slice(html.indexOf('id="shop-packs"'), html.indexOf('id="shop-deco"'));
  assert.ok(packsPanel, 'panneau des packs présent');
  assert.doesNotMatch(packsPanel, /BIENTÔT/, 'plus de badge « BIENTÔT » sur les packs du Shop');
  assert.doesNotMatch(html, /pas encore achetable ni ouvrable/, 'plus de message d’avant-première');
  assert.doesNotMatch(html, /is-coming-soon/, 'plus de classe avant-première');
  assert.match(html, /id="buy-video"[^>]*>ACHETER/, 'bouton d’achat vidéo actif (prix affiché)');
  assert.match(html, /packetvideo\.png/, 'visuel packetvideo.png référencé');
  const rules = fs.readFileSync('firestore.rules', 'utf8');
  assert.match(rules, /packStock\.video is int/, 'les règles Firestore autorisent le stock vidéo');
  const server = fs.readFileSync('server.js', 'utf8');
  assert.match(server, /'\.mp4':'video\/mp4'/, 'le serveur local sert les .mp4 en video/mp4');
  assert.match(server, /'\.webm':'video\/webm'/, 'le serveur local sert les .webm en video/webm');
  console.log('PASS fichiers Pack Vidéo + boutique + règles Firestore');

  /* 1. Structure de données : normalisation, alias, raccourcis, défauts. */
  const cardsContext = vm.createContext({});
  vm.runInContext(fs.readFileSync('cards.js', 'utf8'), cardsContext);
  injectCards(cardsContext, SAMPLE_VIDEO_CARDS);
  const normalize = vm.runInContext('normalizeVideoConfig', cardsContext);
  const cardVideoSources = vm.runInContext('cardVideoSources', cardsContext);
  const cardVideoConfig = vm.runInContext('cardVideoConfig', cardsContext);
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
  /* Raccourcis de configuration directement sur la carte. */
  assert.equal(cardVideoConfig({ id: 'clip', video: 'clip' }).src, 'clip',
    'video: "clip" est accepté comme source');
  assert.equal(cardVideoConfig({ id: 'mon-clip', video: true }).src, 'mon-clip',
    'video: true utilise l’id de la carte comme nom de fichier');
  assert.equal(cardVideoConfig({ video: '  ' }), null, 'chaîne vide ignorée');
  console.log('PASS config vidéo par carte (raccourcis, fps / sound / loop / srcByFps)');

  /* 2. Catalogue + tirage : le Pack Vidéo ne contient que des cartes vidéo. */
  const { w, doc, context } = bootApp('https://refs-cards.test/', SAMPLE_VIDEO_CARDS);
  await wait(40);
  const test = w.__videoTest;
  assert.ok(test, 'helpers exposés');
  const videoPool = test.packPool('video');
  assert.equal(videoPool.length, SAMPLE_VIDEO_CARDS.length + builtinVideoCount(), 'toutes les cartes vidéo (injectées + livrées) sont dans le pool');
  assert.ok(videoPool.every((card) => test.cardVideoInfo(card)), 'toutes les cartes du pool vidéo ont une vidéo');
  for (let i = 0; i < 30; i++) {
    const pack = test.drawPack(false, test.packPool('video'), 'video');
    assert.equal(pack.length, 2, 'un Pack Vidéo contient 2 cartes');
    pack.forEach((card) => {
      assert.ok(test.cardVideoInfo(card), `${card.id} doit être une carte vidéo`);
    });
    assert.equal(
      new Set(pack.map((card) => card.baseId || card.id)).size,
      2,
      'les 2 cartes vidéo sont différentes quand le catalogue le permet'
    );
  }
  /* Les autres packs restent complets et fonctionnels, mais ne contiennent
     jamais de carte vidéo : celles-ci restent exclusives au Pack Vidéo. */
  ['classic', 'rare', 'legend'].forEach((type) => {
    assert.ok(
      test.packPool(type).every((card) => !test.cardVideoInfo(card)),
      `le pack ${type} ne contient aucune carte vidéo`
    );
  });
  assert.equal(test.drawPack(false, test.packPool('classic'), 'classic').length, 5, 'pack classique intact');
  console.log('PASS tirage Pack Vidéo = 2 cartes vidéo, autres packs intacts sans vidéo');

  /* 3. Lecteur : fps, son, boucle et variantes respectés par carte. */
  const byId = (id) => vm.runInContext('cardsDatabase', cardsContext).find((card) => card.id === id);
  const build = (id, opts = {}) => test.cardFrame(byId(id), opts);

  const babault = build('test-babault-live');
  let video = babault.querySelector('video.cf-video');
  assert.ok(video, 'la carte vidéo utilise un <video>');
  assert.equal(video.dataset.fps, '24');
  assert.equal(video.dataset.sound, 'off');
  assert.equal(video.dataset.loop, 'on');
  assert.equal(video.loop, true);
  assert.equal(video.muted, true, 'départ muet compatible autoplay');
  assert.equal(babault.querySelector('.cf-audio'), null, 'pas de bouton son sans sound:true');
  assert.match(babault.querySelector('.cf-video-tags').textContent, /24 i\/s/);

  const karate = build('test-karate-film');
  video = karate.querySelector('video.cf-video');
  assert.equal(video.dataset.sound, 'on');
  assert.equal(video.dataset.loop, 'on');
  assert.ok(karate.querySelector('.cf-audio'), 'bouton 🔊 présent quand sound:true');

  const slowmo = build('test-chasseur-slowmo');
  video = slowmo.querySelector('video.cf-video');
  assert.equal(video.dataset.loop, 'off');
  assert.equal(video.loop, false, 'loop:false respecté');
  assert.equal(video.dataset.fps, '24');
  assert.equal(video.dataset.sourceFps, '60');
  assert.equal(test.cardVideoPlaybackRate(test.cardVideoInfo(byId('test-chasseur-slowmo'))), 0.4,
    'fps 24 sur source 60 → vitesse ×0,4');

  const royer = build('test-royer-cam');
  video = royer.querySelector('video.cf-video');
  assert.equal(video.dataset.fps, '60');
  const firstSource = video.querySelector('source');
  assert.match(firstSource.getAttribute('src'), /clip-royer\.mp4$/, 'variante 60 i/s choisie');

  /* Miniature : pas de bouton son, vidéo montée quand même (muette). */
  const mini = build('test-karate-film', { mini: true });
  assert.ok(mini.querySelector('video.cf-video'), 'vidéo aussi dans les miniatures');
  assert.equal(mini.querySelector('.cf-audio'), null, 'pas de bouton son en miniature');

  /* Compatibilité mutation : une carte vidéo Shiny garde sa vidéo et ses réglages. */
  const shinyVideo = vm.runInContext(
    "CardMutations.roll(cardsDatabase.find((c) => c.id === 'test-karate-film'), () => 0)",
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
    { classic: 1, rare: 2, doubleRare: 0, legend: 3, video: 4, ultra: 0 },
    'la normalisation conserve les six types de packs (les nouveaux à zéro)'
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
  assert.match(doc.getElementById('open-video').textContent, /OUVRIR VIDÉO · ×2/, 'bouton OUVRIR VIDÉO avec le stock');
  assert.equal(doc.getElementById('open-video').disabled, false, 'ouverture vidéo possible');
  assert.ok(doc.querySelector('.inventory-card[data-pack-type="video"]'), 'carte Booster Vidéo dans l’inventaire');
  assert.equal(doc.querySelector('.inventory-card[data-pack-type="video"] .inventory-open-btn').disabled, false,
    'bouton d’ouverture d’inventaire actif');
  assert.match(doc.getElementById('inventory-summary').textContent, /2 packs prêts/, 'résumé inventaire avec les packs vidéo');

  /* Pack publié : achetable et ouvrable comme les autres packs. */
  assert.equal(doc.getElementById('buy-video').disabled, false, 'bouton ACHETER actif');
  assert.match(doc.getElementById('buy-video').textContent, /ACHETER/, 'prix affiché sur le bouton');
  assert.match(doc.getElementById('shop-stock-video').textContent, /Tu en as 2/);
  assert.equal(doc.querySelector('.shop-card[data-pack="video"]').classList.contains('is-coming-soon'), false,
    'carte Shop sans état avant-première');
  assert.equal(doc.querySelector('.qty-chip[data-pack="video"]').disabled, false, 'quantité vidéo active');
  const coinsBefore = test.state.coins;
  doc.getElementById('buy-video').click();
  await wait(30);
  assert.equal(test.state.coins, coinsBefore - 1000, 'achat débite 1 000 🪙');
  assert.equal(test.state.packStock.video, 3, 'un pack vidéo ajouté au stock');
  assert.match(doc.getElementById('shop-stock-video').textContent, /Tu en as 3/, 'stock mis à jour après achat');

  test.selectPackType('video');
  assert.equal(test.state.currentPackType, 'video');
  assert.match(doc.getElementById('pack-img-main').getAttribute('src'), /packetvideo\.png/);
  assert.equal(doc.querySelectorAll('.gap-cards i').length, 2, '2 cartes dans le booster vidéo');

  /* 5. Ouverture réelle : la pile contient des cartes vidéo jouables. */
  test.showReveal('video');
  const stackCards = [...doc.querySelectorAll('#stack .card')];
  assert.equal(stackCards.length, 2, '2 cartes révélées');
  stackCards.forEach((node) => {
    assert.ok(node.querySelector('video.cf-video'), 'chaque carte de la pile a un lecteur vidéo');
  });
  assert.match(doc.getElementById('pack-odds').textContent, /PACK VIDÉO/, 'note vidéo dans les probabilités');
  w.close();

  /* 6. La démo suit les cartes vidéo configurées (?demo=video). */
  const demo = bootApp('https://refs-cards.test/?demo=video', SAMPLE_VIDEO_CARDS);
  await wait(40);
  assert.equal(demo.w.__videoTest.state.currentPackType, 'video', '?demo=video sélectionne le pack');
  assert.equal(demo.doc.getElementById('buy-video').disabled, true, 'sans pièces, l’achat reste désactivé en démo');
  assert.match(demo.doc.getElementById('pack-img-main').getAttribute('src'), /packetvideo\.png/);
  assert.equal(demo.doc.querySelectorAll('.gap-cards i').length, 2);
  demo.w.__videoTest.showReveal('video');
  const demoCards = [...demo.doc.querySelectorAll('#stack .card')];
  assert.equal(demoCards.length, 2, 'la démo affiche 2 cartes animées');
  demoCards.forEach((node) => {
    assert.ok(node.querySelector('video.cf-video'), 'la démo n’affiche que des cartes vidéo');
  });
  /* Même en mode démo, les autres packs ne contiennent jamais de carte vidéo. */
  assert.ok(
    demo.w.__videoTest.packPool('classic').every((card) => !demo.w.__videoTest.cardVideoInfo(card)),
    'aucune carte vidéo dans le pack classique en mode démo'
  );
  demo.w.close();

  /* 7. Sans aucune carte vidéo configurée : garde-fou, pas de pile vide.
     On retire la carte vidéo livrée avec le projet pour ce cas. */
  const empty = bootApp('https://refs-cards.test/', [], true);
  await wait(40);
  assert.equal(empty.w.__videoTest.packPool('video').length, 0, 'pool vidéo vide sans carte configurée');
  empty.w.__videoTest.selectPackType('video');
  empty.w.__videoTest.showReveal('video');
  assert.equal(empty.w.__videoTest.state.phase, 'pack', 'on reste sur l’écran du booster');
  assert.equal(empty.doc.getElementById('toast').textContent, 'Ajoute au moins une carte vidéo dans cards.js (bloc « video »).');
  empty.w.close();

  console.log('PASS Pack Vidéo : configurable, achetable, démo dynamique, garde-fou vide');
  console.log('PASS video pack flow');
})().catch((error) => { console.error(error); process.exitCode = 1; });
