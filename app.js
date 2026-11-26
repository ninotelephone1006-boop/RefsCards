/* ==========================================================================
   Refs Cards — logique de jeu
   Découpe au doigt/souris · pile de cartes · révélations par rareté ·
   bruitages Web Audio · butin · demande de fusion.
   ========================================================================== */
(() => {
  'use strict';

  /* Boutique : les packs s'achètent dans le Shop et vont dans l'inventaire
     (onglet Pack). Les prix sont réglés AU-DESSUS de la valeur moyenne d'un
     pack (classique ≈ 451 🪙, rare ≈ 878 🪙, légende ≈ 788 🪙 pour 10 cartes,
     vidéo ≈ 153 🪙 pour 2 cartes, ultra ≈ 1 964 🪙 — valeurs calculées depuis
     les tables de rareté et les slots garantis, voir PACK_TABLES) : à 100 🪙,
     chaque ouverture rapportait en moyenne ~294 🪙 et l'argent devenait
     infini. À 500 / 1 000 🪙, acheter fait perdre un peu en moyenne — sauf
     coup de pouce « pack rentable » (PACK_PROFIT_CHANCE, plus bas) : avec la
     probabilité annoncée par pack (1/2 classique et légende, 2/5 rare et
     double rare, 1/3 vidéo et ultra rare), la valeur brute des cartes du
     pack est remontée au moins au prix payé. */
  const PACK_PRICES = { classic: 500, rare: 1000, doubleRare: 1700, legend: 800, video: 1000, ultra: 10000 };
  const PACK_PRICE = PACK_PRICES.classic; // compat : ancien prix unique (100) abandonné

  /* ============================================ OFFRE DE SORTIE · ULTRA RARE
     Le Pack Ultra Rare sort et reste à −20 % pendant 24 h. La remise est
     réelle : `promoUnitPrice('ultra')` sert au Shop comme au débit des pièces.
     Pour prolonger / rejouer l'offre, il suffit de changer `startAt` (la durée
     et la remise restent ci-dessous). Hors de la fenêtre, tout reprend le
     prix normal — aucun état n'est écrit dans la sauvegarde du joueur. */
  const ULTRA_PROMO = {
    id: 'ultra-release-2026-11-24',
    startAt: Date.parse('2026-11-24T14:00:00Z'),
    durationMs: 24 * 60 * 60 * 1000,
    discount: 0.2,
    pack: 'ultra'
  };
  const DOUBLE_PROMO = { id: 'double-rare-2026-11-24', startAt: Date.parse('2026-11-24T19:35:00Z'), durationMs: 48 * 60 * 60 * 1000, discount: 0.15 };
  const DOUBLE_SEEN_KEY = 'refs-cards:double-rare-promo-seen';
  function doublePromoActive(now = Date.now()) { return now >= DOUBLE_PROMO.startAt && now < DOUBLE_PROMO.startAt + DOUBLE_PROMO.durationMs; }
  const PROMO_SEEN_KEY = 'refs-cards:promo-seen';

  function promoEndsAt() {
    return ULTRA_PROMO.startAt + ULTRA_PROMO.durationMs;
  }

  function promoActive(now = Date.now()) {
    return now >= ULTRA_PROMO.startAt && now < promoEndsAt();
  }

  function promoMsLeft(now = Date.now()) {
    return Math.max(0, promoEndsAt() - now);
  }

  /* Prix unitaire réellement débité : remise appliquée uniquement au pack en
     promotion, et uniquement pendant la fenêtre de l'offre. */
  function promoUnitPrice(type) {
    const base = Number(PACK_PRICES[type]) || 0;
    if (type === 'doubleRare' && doublePromoActive()) return Math.round(base * (1 - DOUBLE_PROMO.discount));
    if (type !== ULTRA_PROMO.pack || !promoActive()) return base;
    return Math.round(base * (1 - ULTRA_PROMO.discount));
  }
  /* Calendrier de connexion : un cadeau gratuit chaque jour, de mieux en mieux.
     Le cycle fait 7 jours (le 7e est le jackpot) puis recommence ; le cran
     dépend des jours de connexion d'affilée (`streak`) : une journée sans
     connexion remet le compteur au jour 1. */
  const DAILY_REWARD_CYCLE = [
    { packs: { classic: 1 }, coins: 150 },
    { packs: { classic: 2 }, coins: 200 },
    { packs: { rare: 1 }, coins: 250 },
    { coins: 700 },
    { packs: { rare: 1, classic: 1 }, coins: 300 },
    { packs: { legend: 1 }, coins: 400 },
    { packs: { video: 1, legend: 1 }, coins: 1000 }
  ];
  const MONTHS_FR = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin',
    'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  /* Compatibilité : ancien boost « par rang » du Pack Rare (remplacé par les
     tables explicites PACK_TABLES ci-dessous). Conservé pour ne pas casser les
     références existantes ; le tirage ne l'utilise plus. */
  const RARE_RANK_FACTOR_BASE = 0.45;
  const RARE_RANK_FACTOR_STEP = 0.32;
  /* Économie : une carte déjà possédée rapporte moins à chaque révélation.
     On ne retire jamais de pièces à personne — on limite seulement la création
     d'argent des doublons (sinon ouvrir toujours la même commune restait une
     source infinie). Plancher à 35 % pour que les doublons aient encore un
     intérêt, sans permettre de s'enrichir indéfiniment en farmant une carte. */
  const DUPLICATE_REWARD_FACTOR = 0.72;
  const MIN_DUPLICATE_REWARD_FACTOR = 0.35;
  const MAX_QTY = 10; // quantité max par achat (on peut racheter ensuite)
  const PACK_IMAGES = {
    classic: 'assets/packet.png',
    rare: 'assets/packetrare.png',
    doubleRare: 'assets/Packraredouble.png',
    legend: 'assets/packetlegende.png',
    video: 'assets/packetvideo.png',
    ultra: 'assets/packetultra.png'
  };
  const CARD_COUNT = 5;
  const PACK_CARD_COUNT = { classic: 5, rare: 5, doubleRare: 10, legend: 10, video: 2, ultra: 5 };
  /* Ordre d'affichage + validation. Ajouter un type ici (et dans les objets
     ci-dessus) suffit pour qu'il apparaisse dans le Shop, l'inventaire, les
     sauvegardes et les écrans d'ouverture. */
  const PACK_TYPES = ['classic', 'rare', 'doubleRare', 'legend', 'video', 'ultra'];
  function isPackType(type) { return PACK_TYPES.indexOf(type) >= 0; }
  function cardCountFor(type) { return PACK_CARD_COUNT[type] || CARD_COUNT; }
  function packLabelFr(type) {
    return type === 'doubleRare' ? 'double rare' : type === 'rare' ? 'rare'
      : type === 'legend' ? 'légende'
        : type === 'video' ? 'vidéo'
          : type === 'ultra' ? 'ultra rare'
            : 'classique';
  }
  function packLabelUpper(type) {
    return type === 'doubleRare' ? 'DOUBLE RARE' : type === 'rare' ? 'RARE'
      : type === 'legend' ? 'LÉGENDE'
        : type === 'video' ? 'VIDÉO'
          : type === 'ultra' ? 'ULTRA RARE'
            : 'CLASSIQUE';
  }
  /* Cinématique d'ouverture : chaque pack a sa propre identité (titre,
     sous-titre, palette, rythme). `burstDelay` = temps avant l'explosion,
     `revealDelay` = temps avant la pile de cartes. L'ultra reste la plus
     longue et la plus spectaculaire ; le classique reste punchy. */
  const PACK_OPENING = {
    classic: {
      title: 'CLASSIQUE', sub: '5 cartes · 1 Rare+ garantie',
      colors: ['#ffffff', '#c084fc', '#a855f7', '#f0abfc', '#e9d5ff'],
      burstDelay: 240, revealDelay: 820, sparks: 26, dots: 34, confetti: 26, rain: 0,
      shake: 'shake', sound: 'classic'
    },
    rare: {
      title: 'RARE DORÉ', sub: '5 cartes · 1 Rare+ et 1 Épique+ garanties',
      colors: ['#ffffff', '#fbbf24', '#f59e0b', '#fde68a', '#fef3c7'],
      burstDelay: 300, revealDelay: 1050, sparks: 34, dots: 44, confetti: 40, rain: 36,
      shake: 'shake', sound: 'rare'
    },
    doubleRare: {
      title: 'DOUBLE RARE', sub: '10 cartes · 2 Rare+ et 2 Épique+ garanties',
      colors: ['#ffffff', '#ff24cf', '#ff86e7', '#c80087', '#ffe1fa'],
      burstDelay: 350, revealDelay: 1150, sparks: 40, dots: 50, confetti: 45, rain: 40,
      shake: 'shake', sound: 'rare'
    },
    legend: {
      title: 'LÉGENDE', sub: '10 cartes · chances standards',
      colors: ['#ffffff', '#fbbf24', '#f97316', '#ef4444', '#fde68a'],
      burstDelay: 420, revealDelay: 1350, sparks: 44, dots: 52, confetti: 48, rain: 48,
      shake: 'ultra-shake', sound: 'legend'
    },
    video: {
      title: 'VIDÉO', sub: '2 cartes animées exclusives',
      colors: ['#ffffff', '#22d3ee', '#ec4899', '#f0abfc', '#67e8f9'],
      burstDelay: 320, revealDelay: 1100, sparks: 36, dots: 46, confetti: 36, rain: 40,
      shake: 'shake', sound: 'video'
    },
    ultra: {
      title: 'ULTRA RARE', sub: '5 cartes · raretés extrêmes garanties',
      colors: ['#ffffff', '#67e8f9', '#f0abfc', '#fde047', '#c4a1ff'],
      burstDelay: 360, revealDelay: 1380, sparks: 36, dots: 55, confetti: 54, rain: 64,
      shake: 'ultra-shake', sound: 'ultra'
    }
  };
  function packOpeningFor(type) {
    return PACK_OPENING[type] || PACK_OPENING.classic;
  }
  /* Accès tolérant à la configuration vidéo (cards.js en cache ancien). */
  function cardVideoInfo(card) {
    return typeof cardVideoConfig === 'function' ? cardVideoConfig(card) : null;
  }
  /* Le Pack Vidéo ne tire que des cartes dotées d'une configuration `video`,
     et ces cartes restent exclusives à ce pack : elles ne sortent jamais des
     autres boosters (classique, rare, légende, ultra rare). On peut les voir
     verrouillées dans la collection, mais on ne les obtient que par le Pack Vidéo. */
  function packPool(type) {
    if (type === 'video') {
      /* Seules les cartes configurées avec un bloc `video` sortent du Pack
         Vidéo ; sans carte vidéo, le tirage est simplement vide (voir le
         garde-fou dans showReveal). */
      return cardsDatabase.filter((card) => Boolean(cardVideoInfo(card)));
    }
    return cardsDatabase.filter((card) => !cardVideoInfo(card));
  }
  function emptyPackStock() { return { classic: 0, rare: 0, doubleRare: 0, legend: 0, video: 0, ultra: 0 }; }
  function packStockFrom(raw) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const stock = emptyPackStock();
    PACK_TYPES.forEach((type) => {
      stock[type] = Math.max(0, Number(source[type]) || 0);
    });
    return stock;
  }
  /* Charge utile Firestore : n'écrit `ultra` que s'il est > 0 ou déjà
     présent dans la sauvegarde cloud, afin de rester compatible même si
     firestore.rules n'a pas encore été republié avec le pack Ultra. */
  function cloudPackStock(raw, includeUltra = false, includeDouble = false) {
    const source = raw && typeof raw === 'object' ? raw : {};
    const stock = {
      classic: clamp(Math.floor(Number(source.classic) || 0), 0, 100000),
      rare: clamp(Math.floor(Number(source.rare) || 0), 0, 100000),
      legend: clamp(Math.floor(Number(source.legend) || 0), 0, 100000),
      video: clamp(Math.floor(Number(source.video) || 0), 0, 100000)
    };
    const ultra = clamp(Math.floor(Number(source.ultra) || 0), 0, 100000);
    if (ultra > 0 || includeUltra) stock.ultra = ultra;
    const doubleRare = clamp(Math.floor(Number(source.doubleRare) || 0), 0, 100000);
    if (doubleRare > 0 || includeDouble) stock.doubleRare = doubleRare;
    return stock;
  }
  const TEAR_THRESHOLD = 0.75;

  /* Treize raretés, du plus courant au plus rare. `weight` est la probabilité de
     tirage (en %), `fx` le niveau de mise en scène (calm | rare | epic | gold)
     et `next` la rareté obtenue par fusion. Les couleurs servent au cadre, au
     badge, au titre et aux lueurs de la carte. Au-dessus de Secrète (0,5 %) :
     Ultra Secrète (0,3 %), Hyper Secrète (0,2 %) et Unique (0,1 % = 1/1000). */
  const RARITIES = {
    common:     { label: 'Commune',      rank: 0, weight: 29.4, color: '#e6ebdf', ink: '#20261b', glow: '#e6ebdf', reward: 20,  fx: 'calm', next: 'uncommon' },
    uncommon:   { label: 'Inhabituelle', rank: 1, weight: 22,  color: '#6fe0a8', ink: '#04251a', glow: '#57d39a', reward: 35,  fx: 'calm', next: 'rare' },
    rare:       { label: 'Rare',         rank: 2, weight: 16,  color: '#5fb8ff', ink: '#06243a', glow: '#4aa8ff', reward: 55,  fx: 'rare', next: 'superrare' },
    superrare:  { label: 'Super Rare',   rank: 3, weight: 11,  color: '#67e0d0', ink: '#032a26', glow: '#3fd8c8', reward: 80,  fx: 'rare', next: 'epic' },
    epic:       { label: 'Épique',       rank: 4, weight: 8,   color: '#b47bff', ink: '#24093c', glow: '#a457ff', reward: 120, fx: 'epic', next: 'ultraepic' },
    ultraepic:  { label: 'Ultra épique', rank: 5, weight: 5,   color: '#ff8ccb', ink: '#3a0524', glow: '#ff5cb8', reward: 175, fx: 'epic', next: 'mythic' },
    mythic:     { label: 'Mythique',     rank: 6, weight: 3.5, color: '#ffa469', ink: '#331204', glow: '#ff8a3d', reward: 240, fx: 'gold', next: 'legendary' },
    legendary:  { label: 'Légendaire',   rank: 7, weight: 2.5, color: '#ffd45e', ink: '#3a2600', glow: '#ffb347', reward: 340, fx: 'gold', next: 'divine' },
    divine:     { label: 'Divine',       rank: 8, weight: 1.5, color: '#a7f3ff', ink: '#032830', glow: '#7ce8ff', reward: 520, fx: 'gold', next: 'secret' },
    secret:     { label: 'Secrète',      rank: 9, weight: 0.5, color: '#e9d4ff', ink: '#231035', glow: '#c79bff', reward: 900, fx: 'gold', next: 'ultrasecret' },
    ultrasecret:{ label: 'Ultra Secrète',rank: 10, weight: 0.3, color: '#c084fc', ink: '#2a0a3d', glow: '#a855f7', reward: 1400, fx: 'gold', next: 'hypersecret' },
    hypersecret:{ label: 'Hyper Secrète',rank: 11, weight: 0.2, color: '#fb7185', ink: '#3d0714', glow: '#f43f5e', reward: 2200, fx: 'gold', next: 'unique' },
    unique:     { label: 'Unique',       rank: 12, weight: 0.1, color: '#fef08a', ink: '#3a2c00', glow: '#facc15', reward: 5000, fx: 'gold', next: null }
  };

  /* Une fusion ne peut jamais produire mieux qu'Ultra épique. */
  const FUSION_MAX_RANK = RARITIES.ultraepic.rank;
  const canFuseInto = (info) => Boolean(info && info.next && RARITIES[info.next] && RARITIES[info.next].rank <= FUSION_MAX_RANK);

  const SOUND_FX = { calm: 'common', rare: 'rare', epic: 'epic', gold: 'legendary' };

  /* ====================================================== SYSTÈME DE TIRAGE
     Principe (refonte complète) : on tire d'abord la RARETÉ, puis la carte.
     - Chaque pack a sa propre table de rareté (PACK_TABLES, en % par rareté,
       somme = 100) et sa liste de slots (PACK_SLOTS). Un slot « std » tire
       dans toute la table ; un slot { minRank } ne tire que dans les raretés
       de rang >= minRank (poids renormalisés) : c'est la garantie
       (« 1 Rare+ par pack classique », etc.).
     - La carte est ensuite tirée UNIFORMÉMENT parmi les cartes du pool qui
       ont cette rareté (plafond de 2 copies par pack, 1 pour le Pack Vidéo).
       Chaque carte d'une même rareté a donc exactement la même chance : les
       pourcentages affichés sous le booster sont les vraies probabilités.
     - Si une rareté n'a aucune carte dans le pool (ex. Pack Vidéo, qui ne
       contient que des Rare/Épique), elle est écartée et les poids sont
       renormalisés sur les raretés disponibles. Si toutes les cartes d'une
       rareté tirée sont déjà au plafond, on retire une autre rareté.
     - Les chances Shiny restent multipliées par pack (rare ×2, ultra ×7).
     Pour changer les probas, il suffit de modifier PACK_TABLES / PACK_SLOTS :
     l'affichage des chances (renderOdds) et le tirage suivent automatiquement. */
  const PACK_TABLES = {
    classic: { common: 29.4, uncommon: 22, rare: 16, superrare: 11, epic: 8, ultraepic: 5, mythic: 3.5, legendary: 2.5, divine: 1.5, secret: 0.5, ultrasecret: 0.3, hypersecret: 0.2, unique: 0.1 },
    rare: { common: 9.4, uncommon: 12, rare: 18, superrare: 14, epic: 13, ultraepic: 11, mythic: 9, legendary: 7, divine: 4, secret: 2, ultrasecret: 0.3, hypersecret: 0.2, unique: 0.1 },
    doubleRare: { common: 9.4, uncommon: 12, rare: 18, superrare: 14, epic: 13, ultraepic: 11, mythic: 9, legendary: 7, divine: 4, secret: 2, ultrasecret: 0.3, hypersecret: 0.2, unique: 0.1 },
    legend: { common: 29.4, uncommon: 22, rare: 16, superrare: 11, epic: 8, ultraepic: 5, mythic: 3.5, legendary: 2.5, divine: 1.5, secret: 0.5, ultrasecret: 0.3, hypersecret: 0.2, unique: 0.1 },
    video: { common: 29.4, uncommon: 22, rare: 16, superrare: 11, epic: 8, ultraepic: 5, mythic: 3.5, legendary: 2.5, divine: 1.5, secret: 0.5, ultrasecret: 0.3, hypersecret: 0.2, unique: 0.1 },
    ultra: { common: 0, uncommon: 0, rare: 2, superrare: 4, epic: 10, ultraepic: 16, mythic: 22, legendary: 20.9, divine: 14, secret: 10, ultrasecret: 0.8, hypersecret: 0.2, unique: 0.1 }
  };
  /* Slots par pack : 'std' = table complète ; { minRank } = garantie
     (rang minimum, ex. 2 = Rare+, 4 = Épique+, 6 = Mythique+, 7 = Légendaire+).
     La longueur de la liste = nombre de cartes du pack (cf. PACK_CARD_COUNT). */
  const PACK_SLOTS = {
    classic: ['std', 'std', 'std', 'std', { minRank: 2 }],
    rare: ['std', 'std', 'std', { minRank: 2 }, { minRank: 4 }],
    doubleRare: ['std', 'std', 'std', { minRank: 2 }, { minRank: 4 }, 'std', 'std', 'std', { minRank: 2 }, { minRank: 4 }],
    legend: ['std', 'std', 'std', 'std', 'std', 'std', 'std', 'std', 'std', 'std'],
    video: ['std', 'std'],
    ultra: ['std', 'std', { minRank: 4 }, { minRank: 6 }, { minRank: 7 }]
  };
  const PACK_SHINY_MULTIPLIER = { classic: 1, rare: 2, doubleRare: 2, legend: 1, video: 1, ultra: 7 };
  /* Coup de pouce « pack rentable » : probabilité qu'un pack dont la valeur
     brute (somme des récompenses de rareté, hors réduction doublon) est sous
     son prix soit remonté au moins au prix payé (voir boostPackProfit).
     Classique / Légende : 1 sur 2, Rare / Double Rare : 2 sur 5,
     Vidéo / Ultra Rare : 1 sur 3. Un pack déjà rentable ne change pas. */
  const PACK_PROFIT_CHANCE = { classic: 1 / 2, rare: 2 / 5, doubleRare: 2 / 5, legend: 1 / 2, video: 1 / 3, ultra: 1 / 3 };
  function packProfitChanceFor(packType) {
    return PACK_PROFIT_CHANCE[packType] || 0;
  }
  function packTableFor(packType) {
    return PACK_TABLES[packType] || PACK_TABLES.classic;
  }
  function packSlotsFor(packType) {
    return PACK_SLOTS[packType] || PACK_SLOTS.classic;
  }
  function packShinyFor(packType) {
    return PACK_SHINY_MULTIPLIER[packType] || 1;
  }

  const $ = (id) => document.getElementById(id);
  /* Sélecteur tolérant : renvoie null au lieu de lever une exception quand le
     parent manque (HTML en cache obsolète, bloc retiré, aperçu partiel…). */
  const qs = (root, selector) => (root && typeof root.querySelector === 'function'
    ? root.querySelector(selector)
    : null);
  /* Écouteur tolérant : même rôle que addEventListener, mais un élément absent
     n'interrompt plus le script (c'était la cause du bouton Google inerte :
     `Cannot read properties of null (reading 'addEventListener')`). */
  const on = (target, type, handler, options) => {
    if (target && typeof target.addEventListener === 'function') {
      target.addEventListener(type, handler, options);
      return true;
    }
    console.warn(`[Refs Cards] élément absent pour l'écouteur « ${type} »`);
    return false;
  };
  const clamp = (v, a, b) => (v < a ? a : v > b ? b : v);
  const fmt = (n) => new Intl.NumberFormat('fr-FR').format(n);
  const reduceMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  /* Son : si audio.js plante ou manque, le jeu continue sans bruitage. */
  const SFX = new Proxy({}, {
    get(_, key) {
      const s = typeof Sound !== 'undefined' ? Sound : null;
      const v = s && s[key];
      if (typeof v === 'function') return (...a) => { try { return v.apply(s, a); } catch (e) { /* silencieux */ } };
      return v;
    }
  });

  const el = (tag, cls, text) => {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  };

  /* Badge « Créateur » : le marteau pixel-art affiché à côté du pseudo du
     compte propriétaire (ninotelephone1006@gmail.com). Le drapeau `creator`
     voyage dans le profil public (playerProfiles), donc TOUT le monde voit
     le badge, pas seulement l'admin sur son propre écran. Les règles
     Firestore n'autorisent creator: true que pour le compte propriétaire. */
  const creatorBadge = () => {
    const img = el('img', 'creator-badge');
    img.src = 'assets/creator-hammer.png';
    img.alt = 'Créateur';
    img.title = 'Créateur du jeu';
    img.width = 20;
    img.height = 20;
    img.decoding = 'async';
    img.draggable = false;
    return img;
  };
  /* Accroche le badge au pseudo déjà rendu dans `node` si le profil le
     permet (donnée publique `creator` pour les autres joueurs, isAdmin()
     pour le compte local). Renvoie `node` pour chaîner. */
  const withCreatorBadge = (node, data) => {
    if (!node) return node;
    const flagged = data && typeof data === 'object' ? data.creator === true : isAdmin();
    if (flagged) node.append(creatorBadge());
    return node;
  };

  /* ------------------------------------------------------------------ refs */

  const app = $('app');
  const stage = $('stage');
  const packView = $('pack-view');
  const revealView = $('reveal-view');
  const packArea = $('pack-area');
  const pack = $('pack');
  const packFlap = $('pack-flap');
  const packFloat = $('pack-float');
  const gapGlow = qs(pack, '.gap-glow');
  const gapCards = qs(pack, '.gap-cards');
  const packSave = qs(pack, '.pack-and-save');
  const cut = $('cut');
  const hintPct = $('hint-pct');
  const hintText = $('hint-text');
  const coinsEl = $('coins');
  const wallet = $('wallet');
  const coinFloat = $('coin-float');
  const stack = $('stack');
  const tableEl = $('table');
  const nextCard = $('next-card');
  const rays = $('rays');
  const tableGlow = $('table-glow');
  const flash = $('flash');
  const openAll = $('open-all');
  const nextPack = $('next-pack');
  const packResults = $('pack-results');
  const packResultsGrid = $('pack-results-grid');
  const recap = $('recap');
  const recapSlots = $('recap-slots');
  const recapCount = $('recap-count');
  const recapToggle = $('recap-toggle');
  const recapToggleLabel = $('recap-toggle-label');
  const buyBtn = $('buy-btn');
  const recapMsg = $('recap-msg');
  const fusionChip = $('fusion-chip');
  const fusion = $('fusion');
  const fusionGrid = $('fusion-grid');
  const fusionBuy = $('fusion-buy');
  const fusionStage = $('fusion-stage');
  const fusionGo = $('fusion-go');
  const fusionLater = $('fusion-later');
  const fusionDesc = $('fusion-desc');
  const collFusion = $('coll-fusion');
  const collFusionLabel = $('coll-fusion-label');
  const toast = $('toast');
  const newCardsSheet = $('new-cards-sheet');
  const newCardsGrid = $('new-cards-grid');
  const newCardsDesc = $('new-cards-desc');
  /* Annonce de sortie du Pack Ultra Rare (−20 % pendant 24 h). */
  const promoSheet = $('promo-sheet');
  const promoClock = $('promo-clock');
  const promoBarFill = $('promo-bar-fill');
  const promoPriceEl = $('promo-price');
  const ultraPromoLine = $('ultra-promo-line');
  const ultraPromoClock = $('ultra-promo-clock');
  const ultraPromoPrice = $('ultra-promo-price');
  const pileLabel = $('pile-label');
  const footRight = $('foot-right');
  const revealTitle = $('reveal-title');
  const revealSub = $('reveal-sub');
  const revealKicker = $('reveal-kicker');
  const soundBtn = $('sound-btn');
  const packOdds = $('pack-odds');
  const inspect = $('inspect');
  const inspectCard = $('inspect-card');
  const inspectX = $('inspect-x');
  const inspectBackdrop = $('inspect-backdrop');
  const authScreen = $('auth-screen');
  const loadingScreen = $('loading-screen');
  const loadingText = $('loading-text');
  const authError = $('auth-error');
  const googleSignIn = $('google-signin');
  const googleLabel = qs(googleSignIn, '.google-label');
  const authStatus = $('auth-status');
  const authHint = $('auth-hint');
  const authHintText = $('auth-hint-text');
  const authOpenTab = $('auth-open-tab');
  const accountAvatar = $('account-avatar');
  const accountEmail = $('account-email');
  const logoutBtn = $('logout-btn');
  const gameRegions = document.querySelectorAll('.hud, #stage, #tabbar, .toast');
  /* Shop + inventaire (tolérants : HTML en cache obsolète sans ces blocs). */
  const shopView = $('shop-view');
  const packImgMain = $('pack-img-main');
  const packImgFlap = $('pack-img-flap');
  const packStockLabel = $('pack-stock-label');
  const packEmpty = $('pack-empty');
  const packGoShop = $('pack-go-shop');
  const freeClaim = $('free-claim');
  const freeLabel = $('free-label');
  const freeMsg = $('free-msg');
  const dailyCalendar = $('daily-calendar');
  const dailyTrack = $('daily-track');
  const dailyCalTitle = $('daily-cal-title');
  const shopStockClassic = $('shop-stock-classic');
  const shopStockRare = $('shop-stock-rare');
  const qtyClassic = $('qty-classic');
  const qtyRare = $('qty-rare');
  const buyClassic = $('buy-classic');
  const buyRare = $('buy-rare');
  const shopInventoryLabel = $('shop-inventory-label');
  const openClassic = $('open-classic');
  const openRare = $('open-rare');
  const shopStockLegend = $('shop-stock-legend');
  const qtyLegend = $('qty-legend');
  const buyLegend = $('buy-legend');
  const openLegend = $('open-legend');
  const shopStockVideo = $('shop-stock-video');
  const qtyVideo = $('qty-video');
  const buyVideo = $('buy-video');
  const openVideo = $('open-video');
  const shopStockUltra = $('shop-stock-ultra');
  const qtyUltra = $('qty-ultra');
  const buyUltra = $('buy-ultra');
  const openUltra = $('open-ultra');
  /* Cinématique d'ouverture générique (tous les packs). `ultraOpening`
     reste un alias pour compatibilité avec l'ancien HTML en cache. */
  const packOpening = $('pack-opening') || $('ultra-opening');

  const packOpeningImg = $('pack-opening-img');
  const packOpeningTitle = $('pack-opening-title');
  const packOpeningSub = $('pack-opening-sub');
  const packOpeningKicker = $('pack-opening-kicker');
  const shopMsg = $('shop-msg');
  const tabBadgeShop = $('tab-badge-shop');
  const inventoryView = $('inventory-view');
  const inventoryGrid = $('inventory-grid');
  const inventorySummary = $('inventory-summary');
  const inventoryEmpty = $('inventory-empty');
  const inventoryGoShop = $('inventory-go-shop');
  const tabBadgeInventory = $('tab-badge-inventory');
  const shopQty = { classic: 1, rare: 1, doubleRare: 1, legend: 1, video: 1, ultra: 1 };
  /* Quêtes, succès, niveau, notifications (blocs tolérants : un HTML en
     cache obsolète peut ne pas les avoir). */
  const questsView = $('quests-view');
  const questPanel = $('quest-panel');
  const achPanel = $('ach-panel');
  const levelValue = $('level-value');
  const levelXp = $('level-xp');
  const levelFill = $('level-fill');
  const questsCount = $('quests-count');
  const achCount = $('ach-count');
  const tabBadgeQuests = $('tab-badge-quests');
  const notifBtn = $('notif-btn');
  const notifBadge = $('notif-badge');
  const notifSheet = $('notif-sheet');
  const notifList = $('notif-list');
  const notifReadAll = $('notif-read-all');
  const notifPhoneRow = $('notif-phone-row');
  const notifPhoneState = $('notif-phone-state');
  const notifPhoneBtn = $('notif-phone-btn');
  /* Réglages « hors jeu » : panneau dédié (liste des notifications à recevoir). */
  const pushSheet = $('push-sheet');
  const pushKinds = $('push-kinds');
  const pushMsg = $('push-msg');
  const pushEnable = $('push-enable');
  const pushDisable = $('push-disable');
  const pushTest = $('push-test');
  const pushSystemMsg = $('push-system-msg');
  const pushHint = $('push-hint');
  const pushSummary = $('push-summary');
  const notifSettingsOpen = $('notif-settings-open');

  /* ----------------------------------------------------------------- state */

  const state = {
    coins: 0,
    phase: 'pack', // pack | tearing | reveal | done
    deck: [],
    loot: [],
    collection: [],
    packIndex: 0,
    fusionOpen: false,
    fusionSelection: null,
    firstPack: true,
    /* Inventaire de packs (achetés dans le Shop + cadeaux du calendrier).
       Ouvrir un pack en consomme 1. `currentPackType` = pack choisi dans
       l'onglet Pack. Calendrier de connexion : `streakDate` = date locale du
       dernier cadeau récupéré, `streak` = jours de connexion d'affilée,
       `claimedDays` = dates du mois déjà cochées (affichage du calendrier). */
    packStock: emptyPackStock(),
    currentPackType: 'classic',
    streakDate: '',
    streak: 0,
    claimedDays: [],
    packsOpened: 0,
    /* Compteurs alimentant les quêtes et les succès (cumuls, persistés).
       Ils comptent toute l'activité du compte, y compris celle d'avant
       l'arrivée des quêtes : rien n'est remis à zéro. */
    fusions: 0,
    packsBought: 0,
    freePacks: 0,
    marketSales: 0,
    marketEarned: 0,
    marketBuys: 0
  };

  /* Progression des quêtes / succès / niveau / notifications.
     - completed : ids des quêtes RÉCLAMÉES (ordre de réclamation libre :
       les quêtes se font 5 par 5, dans n'importe quel ordre).
     - xp : XP cumulée ; le niveau en est dérivé (RefsQuests.levelFromXp).
     - achievements : ids des succès débloqués.
     - notifications : liste (plus récente en tête), lues ou non.
     Les objectifs se mesurent à VIE (valeur absolue) : un joueur qui avait
     déjà 5 cartes différentes avant les quêtes peut réclamer « Petite
     collection » directement (cf. RefsQuests.questProgress). */
  const questState = {
    completed: [],
    xp: 0,
    achievements: [],
    notifications: []
  };
  const questReadyNotifiedIds = new Set(); // quêtes actives déjà annoncées « prêtes »
  let questSeenInitialized = false;        // 1er rendu : pas d'animation pop
  const questSeenIds = new Set();          // quêtes déjà affichées (détecte les pops)
  let notifSeq = 0;               // suffixe d'id local, évite les collisions
  let notifSalesKnown = null;     // ids des ventes 'sold' déjà vues (notif)
  let notifSalesSnapshot = false; // premier snapshot marché : pas de toast

  /* Données quêtes/succès (quests.js, chargé avant app.js). Tolérant : si le
     fichier manque (ancien HTML en cache, chargement partiel), le système se
     désactive proprement — le jeu reste jouable sans quêtes. */
  const Quests = (typeof RefsQuests !== 'undefined' && RefsQuests && Array.isArray(RefsQuests.QUESTS))
    ? RefsQuests
    : {
      QUESTS: [],
      ACHIEVEMENTS: [],
      METRICS: [],
      METRIC_LABELS: {},
      xpForLevel: () => 0,
      levelFromXp: () => ({ level: 1, into: 0, needed: 100 }),
      metricValue: () => 0,
      metricLabel: (m) => m,
      QUEST_WINDOW: 5,
      activeQuests: () => [],
      questProgress: () => ({ value: 0, target: 1, done: false }),
      achievementProgress: () => ({ value: 0, target: 1, done: false }),
      questReward: (quest) => ({
        coins: Math.max(0, Number((quest && quest.reward || {}).coins) || 0),
        xp: Math.max(0, Number((quest && quest.reward || {}).xp) || 0),
        packs: {}
      }),
      packRewardLabel: () => '',
      PACK_LABELS: {}
    };
  const NOTIF_ICONS = { quest: '🗺️', achievement: '🏆', level: '⭐', friend: '👥', market: '🪙', system: '✦' };
  const QUEST_NOTIFICATIONS_MAX = 50;

  /* Notifications « hors jeu » (vraies notifications du téléphone) : module
     push.js, chargé avant app.js. Tolérant : si le fichier manque (ancien
     HTML en cache), le jeu fonctionne exactement comme avant, avec la seule
     cloche interne. notifyOutOfGame() est appelé à chaque évènement qui
     mérite une notification système (quête prête, demande d'ami, vente,
     défi…). */
  const Push = (typeof RefsPush !== 'undefined' && RefsPush && typeof RefsPush.notify === 'function')
    ? RefsPush
    : null;
  /* Mémoire de la question « quelles notifications ? » et de la dernière
     relance (7 jours). La question elle-même est mémorisée PAR COMPTE par
     push.js (`asked`), si bien qu'un autre compte sur le même appareil aura
     aussi droit à sa propre question. */
  const PUSH_LAST_PROMPT_KEY = 'refs-cards:push-prompt-at';
  const PUSH_ASK_COOLDOWN = 7 * 24 * 60 * 60 * 1000;

  /* --------------------------------------------------------------- comptes */

  function updateCoins(delta) {
    coinsEl.textContent = fmt(state.coins);
    /* Les boutons d'achat du Shop dépendent du solde : on les rafraîchit
       (fonction déclarée plus bas, hoistée — sans effet si le Shop manque). */
    if (typeof renderShop === 'function') renderShop();
    if (delta) {
      wallet.classList.remove('bump', 'spend');
      void wallet.offsetWidth;
      wallet.classList.add(delta > 0 ? 'bump' : 'spend');
      coinFloat.textContent = (delta > 0 ? '+' : '−') + fmt(Math.abs(delta));
      coinFloat.classList.toggle('neg', delta < 0);
      coinFloat.classList.remove('run');
      void coinFloat.offsetWidth;
      coinFloat.classList.add('run');
    }
  }

  function addCoins(n) {
    if (!n) return;
    state.coins = Math.max(0, Math.round(state.coins + n));
    updateCoins(n);
    save();
  }

  /* Pièces gagnées à la révélation d'une carte. Le premier exemplaire paie
     plein tarif ; chaque exemplaire déjà possédé réduit le gain (plancher à
     35 %). C'est un robinet d'argent, jamais une ponction : le solde existant
     n'est jamais touché, seul le gain des doublons est plafonné. */
  function cardReward(card, copiesOwned = 0) {
    const info = RARITIES[card && card.rarity] || RARITIES.common;
    const base = CardMutations.multiply(card, info.reward, 'reward');
    if (!Number.isFinite(base) || base <= 0) return 0;
    const copies = Math.max(0, Math.floor(Number(copiesOwned) || 0));
    if (!copies) return Math.round(base);
    const factor = Math.max(MIN_DUPLICATE_REWARD_FACTOR,
      Math.pow(DUPLICATE_REWARD_FACTOR, copies));
    return Math.max(1, Math.round(base * factor));
  }

  let toastTimer = null;
  function showToast(message, duration = 3200) {
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), duration);
  }

  /* =========================================== NOUVELLES CARTES DU CATALOGUE
     À chaque retour dans le jeu, on compare les identifiants de cards.js avec
     ceux vus lors de la dernière visite (conservés dans le navigateur). Si le
     catalogue a grandi, une annonce animée présente les nouvelles cartes en
     gris, avec leur numéro — leur identité reste à découvrir dans les packs.
     Aucun compte, aucune carte et aucune pièce n'est modifié par l'annonce. */

  function readSeenCatalog() {
    try {
      const raw = window.localStorage.getItem(CATALOG_SEEN_KEY);
      if (!raw) return null;
      const list = JSON.parse(raw);
      if (!Array.isArray(list)) return null;
      return new Set(list.filter((id) => typeof id === 'string'));
    } catch (error) {
      /* Navigation privée / stockage bloqué : pas d'annonce, le jeu continue. */
      return null;
    }
  }

  function writeSeenCatalog(ids) {
    try {
      window.localStorage.setItem(CATALOG_SEEN_KEY, JSON.stringify(ids));
    } catch (error) { /* stockage indisponible : on garde la liste en mémoire */ }
  }

  function closeNewCards(goToCollection = false) {
    if (!newCardsSheet || newCardsSheet.hidden) return;
    closeSheet(newCardsSheet);
    if (goToCollection) setTab('collection');
    /* L'annonce du catalogue était prioritaire : l'offre de sortie passe
       maintenant, si elle n'a pas déjà été vue. */
    window.setTimeout(maybeShowUltraPromo, 420);
  }

  function announceNewCards() {
    if (typeof cardsDatabase === 'undefined' || !Array.isArray(cardsDatabase) || !newCardsSheet) return;
    const ids = cardsDatabase.map((c) => c.id);
    const seen = readSeenCatalog();
    writeSeenCatalog(ids);
    if (!seen) return; // 1re visite : on apprend le catalogue, sans annonce

    const added = cardsDatabase.filter((c) => !seen.has(c.id));
    if (!added.length) return;
    catalogNewIds.clear();
    added.forEach((c) => catalogNewIds.add(c.id));
    renderCollection(); // les nouvelles cases se signalent dans la collection

    if (newCardsDesc) {
      newCardsDesc.textContent = added.length === 1
        ? 'Une nouvelle carte vient d’arriver dans le catalogue. Elle t’attend dans ta collection !'
        : `${added.length} nouvelles cartes viennent d’arriver dans le catalogue. Elles t’attendent dans ta collection !`;
    }
    if (newCardsGrid) {
      newCardsGrid.replaceChildren(...added.map((card, i) => {
        const num = cardsDatabase.indexOf(card) + 1;
        const tile = el('div', 'newcard-tile');
        tile.style.setProperty('--i', i);
        tile.setAttribute('aria-label', `Nouvelle carte verrouillée, numéro ${num}`);
        tile.append(el('span', 'lock-q', '???'));
        tile.append(el('span', 'lock-n', `N° ${String(num).padStart(3, '0')}`));
        tile.append(el('span', 'newcard-flag', 'NOUVEAU'));
        return tile;
      }));
    }
    openSheet(newCardsSheet);
    const later = $('new-cards-later');
    window.setTimeout(() => {
      if (!newCardsSheet.hidden) (later || $('new-cards-x')).focus({ preventScroll: true });
    }, 80);
  }

  on(newCardsSheet, 'click', (e) => {
    if (e.target && e.target.closest && e.target.closest('[data-close-newcards]')) closeNewCards();
  });
  on($('new-cards-x'), 'click', () => closeNewCards());
  on($('new-cards-later'), 'click', () => closeNewCards());
  on($('new-cards-see'), 'click', () => closeNewCards(true));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && newCardsSheet && !newCardsSheet.hidden) closeNewCards();
  });

  /* ================================================ ANNONCE DE SORTIE · ULTRA
     Même principe que l'annonce du catalogue : elle apparaît UNE fois, à
     l'entrée du jeu, puis ne revient plus (identifiant de l'offre conservé
     dans le navigateur). Elle est accompagnée d'une notification persistante
     dans la cloche et d'un compte à rebours vivant. À zéro : la fenêtre se
     ferme, le Shop reprend le prix normal et le joueur est prévenu. */

  function readPromoSeen() {
    try {
      return window.localStorage.getItem(PROMO_SEEN_KEY) || '';
    } catch (error) {
      return ''; // stockage bloqué : on ne montre pas l'annonce en boucle
    }
  }

  function writePromoSeen() {
    try {
      window.localStorage.setItem(PROMO_SEEN_KEY, ULTRA_PROMO.id);
    } catch (error) { /* stockage indisponible : la page reste utilisable */ }
  }

  function promoClockText(ms) {
    const total = Math.ceil(Math.max(0, ms) / 1000);
    const h = Math.floor(total / 3600);
    const m = Math.floor((total % 3600) / 60);
    const s = total % 60;
    return `${pad2(h)}:${pad2(m)}:${pad2(s)}`;
  }

  /* Les deux compteurs (fenêtre + ligne du Shop) et la jauge avancent ensemble. */
  function tickPromo() {
    const left = promoMsLeft();
    const text = promoClockText(left);
    if (promoClock && promoClock.textContent !== text) promoClock.textContent = text;
    if (ultraPromoClock && ultraPromoClock.textContent !== text) ultraPromoClock.textContent = text;
    if (promoBarFill) {
      const ratio = promoActive() ? left / ULTRA_PROMO.durationMs : 0;
      promoBarFill.style.transform = `scaleX(${Math.max(0, Math.min(1, ratio))})`;
    }
    if (!promoActive()) {
      if (promoSheet && !promoSheet.hidden) {
        closeSheet(promoSheet);
        showToast('L’offre de sortie du Pack Ultra Rare est terminée.');
      }
      if (promoTimer) {
        window.clearInterval(promoTimer);
        promoTimer = null;
      }
      renderShop();
    }
  }

  let promoTimer = null;
  let promoShownThisPage = false;

  function startPromoTimer() {
    if (promoTimer || !promoActive()) return;
    promoTimer = window.setInterval(tickPromo, 1000);
  }

  function refreshPromoShop() {
    const active = promoActive();
    const unit = promoUnitPrice(ULTRA_PROMO.pack);
    if (ultraPromoLine) ultraPromoLine.hidden = !active;
    if (promoPriceEl) promoPriceEl.textContent = `${fmt(unit)} 🪙`;
    if (ultraPromoPrice) ultraPromoPrice.textContent = fmt(unit);
    const card = document.querySelector('.shop-card-ultra');
    if (card) card.classList.toggle('is-promo', active);
    if (active) startPromoTimer();
  }

  function closePromo(goShop = false) {
    if (!promoSheet || promoSheet.hidden) return;
    closeSheet(promoSheet);
    window.setTimeout(maybeShowDoublePromo, 420);
    if (goShop) {
      setTab('shop');
      const card = document.querySelector('.shop-card-ultra');
      if (card && typeof card.scrollIntoView === 'function') {
        card.scrollIntoView({ behavior: 'smooth', block: 'center' });
      }
    }
  }

  function showUltraPromo() {
    if (!promoSheet || !promoActive()) return;
    promoShownThisPage = true;
    writePromoSeen();
    refreshPromoShop();
    tickPromo();
    startPromoTimer();
    pushNotification(
      'system',
      'Sortie du Pack Ultra Rare · −20 %',
      'Le Pack Ultra Rare débarque. Pendant 24 h, il est à ' +
      `${fmt(promoUnitPrice(ULTRA_PROMO.pack))} 🪙 au lieu de ${fmt(PACK_PRICES[ULTRA_PROMO.pack])} 🪙.`
    );
    openSheet(promoSheet);
    window.setTimeout(() => {
      if (promoSheet.hidden) return;
      const cta = $('promo-see') || $('promo-later') || $('promo-x');
      if (cta) cta.focus({ preventScroll: true });
    }, 120);
  }

  /* Appelée à l'entrée du jeu, après l'annonce éventuelle du catalogue : les
     deux fenêtres ne se superposent jamais (celle des nouvelles cartes passe
     d'abord, l'offre arrive quand elle se referme). */
  function maybeShowUltraPromo() {
    refreshPromoShop();
    if (!promoSheet || !promoActive() || readPromoSeen() === ULTRA_PROMO.id || promoShownThisPage) { maybeShowDoublePromo(); return; }
    if (newCardsSheet && !newCardsSheet.hidden) return; // annonce catalogue en cours
    showUltraPromo();
  }

  if (promoSheet) {
    promoSheet.addEventListener('click', (e) => {
      if (e.target && e.target.closest && e.target.closest('[data-close-promo]')) closePromo();
    });
    const promoX = $('promo-x');
    const promoLater = $('promo-later');
    const promoSee = $('promo-see');
    if (promoX) promoX.addEventListener('click', () => closePromo());
    if (promoLater) promoLater.addEventListener('click', () => closePromo());
    if (promoSee) promoSee.addEventListener('click', () => closePromo(true));
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && !promoSheet.hidden) closePromo();
    });
  }

  /* Une annonce indépendante, sans chevaucher les annonces existantes. */
  let doublePromoShown = false;
  let doublePromoTimer = null;
  function refreshDoublePromo() {
    const active = doublePromoActive();
    const line = $('double-promo-line');
    if (line) line.hidden = !active;
    const clock = promoClockText(DOUBLE_PROMO.startAt + DOUBLE_PROMO.durationMs - Date.now());
    ['double-promo-clock', 'double-sheet-clock'].forEach(id => { const node = $(id); if (node) node.textContent = clock; });
    const bar = $('double-bar-fill');
    if (bar) bar.style.transform = `scaleX(${active ? Math.max(0, Math.min(1, (DOUBLE_PROMO.startAt + DOUBLE_PROMO.durationMs - Date.now()) / DOUBLE_PROMO.durationMs)) : 0})`;
    const card = document.querySelector('.shop-card-double');
    if (card) card.classList.toggle('is-promo', active);
    if (active && !doublePromoTimer) doublePromoTimer = window.setInterval(() => {
      if (!doublePromoActive()) {
        window.clearInterval(doublePromoTimer); doublePromoTimer = null;
        const sheet = $('double-promo-sheet'); if (sheet && !sheet.hidden) closeSheet(sheet);
        renderShop();
      } else refreshDoublePromo();
    }, 1000);
  }
  function maybeShowDoublePromo() {
    refreshDoublePromo();
    const sheet = $('double-promo-sheet');
    if (!sheet || !doublePromoActive() || doublePromoShown || (newCardsSheet && !newCardsSheet.hidden) || (promoSheet && !promoSheet.hidden)) return;
    try { if (window.localStorage.getItem(DOUBLE_SEEN_KEY) === DOUBLE_PROMO.id) return; } catch (error) { /* une fois par page au minimum */ }
    doublePromoShown = true;
    try { window.localStorage.setItem(DOUBLE_SEEN_KEY, DOUBLE_PROMO.id); } catch (error) { /* stockage bloqué */ }
    pushNotification('system', 'Nouveau Pack Double Rare · −15 %', '10 cartes aux chances du Pack Rare : 1 445 🪙 au lieu de 1 700 🪙 pendant 48 h.');
    openSheet(sheet);
    const button = $('double-promo-see'); if (button) button.focus({ preventScroll: true });
  }
  const doubleSheet = $('double-promo-sheet');
  function closeDoublePromo(goShop = false) {
    if (!doubleSheet || doubleSheet.hidden) return;
    closeSheet(doubleSheet);
    if (goShop) { setTab('shop'); const card = document.querySelector('.shop-card-double'); if (card && card.scrollIntoView) card.scrollIntoView({ behavior: 'smooth', block: 'center' }); }
  }
  if (doubleSheet) {
    doubleSheet.addEventListener('click', e => { if (e.target.closest('[data-close-double]')) closeDoublePromo(); });
    on($('double-promo-x'), 'click', () => closeDoublePromo());
    on($('double-promo-later'), 'click', () => closeDoublePromo());
    on($('double-promo-see'), 'click', () => closeDoublePromo(true));
    document.addEventListener('keydown', e => { if (e.key === 'Escape') closeDoublePromo(); });
  }

  /* ====================================================== SHOP · INVENTAIRE
     Les packs ne s'achètent plus en un clic depuis le récap : ils vont dans
     l'inventaire (state.packStock) et s'ouvrent depuis l'onglet Pack.
     - Achat : plusieurs d'un coup (quantité 1..MAX_QTY), prix PACK_PRICES.
     - Calendrier de connexion : un cadeau gratuit par jour, de mieux en mieux
       (streakDate/streak/claimedDays persistés ; cf. DAILY_REWARD_CYCLE).
     - Ouverture : consomme 1 pack du type choisi (currentPackType). */

  function pad2(n) {
    return String(n).padStart(2, '0');
  }

  function dayKey(offset) {
    const now = new Date();
    now.setDate(now.getDate() + offset);
    return `${now.getFullYear()}-${pad2(now.getMonth() + 1)}-${pad2(now.getDate())}`;
  }

  function todayKey() {
    return dayKey(0);
  }

  function yesterdayKey() {
    return dayKey(-1);
  }

  /* Calendrier de connexion : le cadeau du jour est disponible tant que le
     dernier cadeau récupéré n'est pas d'aujourd'hui. Une série interrompue
     (dernier cadeau il y a 2 jours ou plus) repart au jour 1. */
  function refreshStreak() {
    if (!state.streakDate
        || (state.streakDate !== todayKey() && state.streakDate !== yesterdayKey())) {
      state.streak = 0;
    }
    state.streak = clamp(Math.floor(Number(state.streak) || 0), 0, 999);
  }

  function dailyAvailable() {
    refreshStreak();
    return state.streakDate !== todayKey();
  }

  /* Prochain cran du calendrier (1..7, cycle). Quand le cadeau du jour est
     déjà pris, c'est le cran de demain qui est annoncé. */
  function nextDailyDay() {
    refreshStreak();
    if (!state.streakDate) return 1;
    return (Math.floor(Number(state.streak) || 0) % DAILY_REWARD_CYCLE.length) + 1;
  }

  function rewardForDay(day) {
    const cycle = DAILY_REWARD_CYCLE;
    return cycle[(Math.max(1, day) - 1) % cycle.length];
  }

  function rewardParts(reward) {
    const parts = [];
    const packs = (reward && reward.packs) || {};
    PACK_TYPES.forEach((type) => {
      const n = Number(packs[type]) || 0;
      if (n > 0) parts.push(`${n} pack${n > 1 ? 's' : ''} ${packLabelFr(type)}${n > 1 ? 's' : ''}`);
    });
    if (Number(reward.coins) > 0) parts.push(`${fmt(reward.coins)} 🪙`);
    return parts;
  }

  function describeReward(reward) {
    return rewardParts(reward).join(' + ') || 'cadeau surprise';
  }

  /* Le calendrier affiché ne garde que le mois en cours (la sauvegarde ne
     grossit pas avec l'historique des mois passés). */
  function noteClaimedDay(key) {
    if (state.claimedDays.indexOf(key) < 0) state.claimedDays.push(key);
    const prefix = key.slice(0, 7);
    state.claimedDays = state.claimedDays.filter((k) => k.slice(0, 7) === prefix).slice(-31);
  }

  function packTotal() {
    return PACK_TYPES.reduce((sum, type) => sum + (Number(state.packStock[type]) || 0), 0);
  }

  /* Premier type disponible (sert de repli quand le pack affiché est épuisé). */
  function firstAvailablePackType() {
    return PACK_TYPES.find((type) => (Number(state.packStock[type]) || 0) > 0) || 'classic';
  }

  function isDemoMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      return ['1', 'fusion', 'video'].includes(params.get('demo'))
        || ['1', 'fusion', 'video'].includes(sessionStorage.getItem('refs-demo'));
    } catch (error) { return false; }
  }

  function setShopMsg(message) {
    if (shopMsg) shopMsg.textContent = message || '';
  }

  function setFreeMsg(message) {
    if (freeMsg) freeMsg.textContent = message || '';
  }

  /* Calendrier du mois en cours : les jours déjà payés sont cochés, la date
     du jour est entourée (semaine commençant le lundi). */
  function renderDailyCalendar() {
    if (!dailyCalendar) return;
    const now = new Date();
    const year = now.getFullYear();
    const month = now.getMonth();
    const daysInMonth = new Date(year, month + 1, 0).getDate();
    const lead = (new Date(year, month, 1).getDay() + 6) % 7;
    const today = todayKey();
    const frag = document.createDocumentFragment();
    ['L', 'M', 'M', 'J', 'V', 'S', 'D'].forEach((label) => {
      const cell = document.createElement('span');
      cell.className = 'daily-cal-dow';
      cell.textContent = label;
      frag.append(cell);
    });
    for (let i = 0; i < lead; i += 1) frag.append(document.createElement('span'));
    for (let d = 1; d <= daysInMonth; d += 1) {
      const key = `${year}-${pad2(month + 1)}-${pad2(d)}`;
      const cell = document.createElement('span');
      cell.className = 'daily-cal-cell';
      if (key === today) cell.classList.add('is-today');
      else if (key < today) cell.classList.add('is-past');
      if (state.claimedDays.indexOf(key) >= 0) {
        cell.classList.add('is-claimed');
        cell.textContent = '✓';
        cell.title = 'Cadeau récupéré';
      } else {
        cell.textContent = String(d);
      }
      frag.append(cell);
    }
    dailyCalendar.replaceChildren(frag);
    if (dailyCalTitle) {
      dailyCalTitle.textContent = `${MONTHS_FR[month]} ${year} · un cadeau par jour de connexion`;
    }
  }

  /* Les 7 crans à venir du cycle, en partant du prochain cadeau. */
  function renderDailyTrack() {
    if (!dailyTrack) return;
    const start = nextDailyDay();
    const frag = document.createDocumentFragment();
    for (let i = 0; i < DAILY_REWARD_CYCLE.length; i += 1) {
      const day = ((start - 1 + i) % DAILY_REWARD_CYCLE.length) + 1;
      const cell = document.createElement('div');
      cell.className = 'daily-track-cell' + (day === start ? ' is-next' : '');
      const head = document.createElement('span');
      head.className = 'daily-track-day';
      head.textContent = `JOUR ${day}`;
      const desc = document.createElement('span');
      desc.className = 'daily-track-reward';
      desc.textContent = describeReward(rewardForDay(day));
      cell.append(head, desc);
      frag.append(cell);
    }
    dailyTrack.replaceChildren(frag);
  }

  function renderShop() {
    const available = dailyAvailable();
    if (freeClaim) {
      freeClaim.disabled = !available;
      freeClaim.textContent = available
        ? `RÉCUPÉRER · CADEAU DU JOUR ${nextDailyDay()}`
        : 'CADEAU DU JOUR RÉCUPÉRÉ · REVIENS DEMAIN';
    }
    if (freeLabel) {
      freeLabel.textContent = available
        ? `Jour ${nextDailyDay()} du calendrier — ${describeReward(rewardForDay(nextDailyDay()))}. Connecte-toi chaque jour pour améliorer les cadeaux.`
        : `Cadeau du jour ${state.streak} récupéré. Demain : jour ${nextDailyDay()} — ${describeReward(rewardForDay(nextDailyDay()))}.`;
    }
    if (tabBadgeShop) tabBadgeShop.hidden = !available;
    renderDailyCalendar();
    renderDailyTrack();

    const stockText = (n) => `Tu en as ${n}`;
    if (shopStockClassic) shopStockClassic.textContent = stockText(state.packStock.classic || 0);
    if (shopStockRare) shopStockRare.textContent = stockText(state.packStock.rare || 0);
    if (shopStockLegend) shopStockLegend.textContent = stockText(state.packStock.legend || 0);
    if (shopStockVideo) {
      shopStockVideo.textContent = stockText(state.packStock.video || 0);
    }
    if (shopStockUltra) {
      shopStockUltra.textContent = stockText(state.packStock.ultra || 0);
    }

    if ($('shop-stock-doubleRare')) $('shop-stock-doubleRare').textContent = stockText(state.packStock.doubleRare || 0);

    const updateBuy = (type, qtyEl, btn) => {
      const qty = clamp(shopQty[type] || 1, 1, MAX_QTY);
      if (qtyEl) qtyEl.textContent = String(qty);
      if (btn) {
        const total = promoUnitPrice(type) * qty;
        btn.textContent = type === 'doubleRare' && doublePromoActive()
          ? `ACHETER · ${fmt(total)} 🪙 · −15 %`
          : type === ULTRA_PROMO.pack && promoActive()
          ? `ACHETER · ${fmt(total)} 🪙 · −20 %`
          : `ACHETER · ${fmt(total)} 🪙`;
        btn.disabled = state.coins < total;
      }
      document.querySelectorAll(`.qty-chip[data-pack="${type}"], .qty-btn[data-pack="${type}"]`).forEach((control) => {
        if (control.classList.contains('qty-chip')) {
          control.classList.toggle('is-active', Number(control.dataset.qty) === qty);
        }
      });
    };
    updateBuy('classic', qtyClassic, buyClassic);
    updateBuy('rare', qtyRare, buyRare);
    updateBuy('doubleRare', $('qty-doubleRare'), $('buy-doubleRare'));
    updateBuy('legend', qtyLegend, buyLegend);
    updateBuy('video', qtyVideo, buyVideo);
    updateBuy('ultra', qtyUltra, buyUltra);
    refreshPromoShop();
    refreshDoublePromo();

    const total = packTotal();
    if (shopInventoryLabel) {
      shopInventoryLabel.textContent = total > 0
        ? `Inventaire : ${PACK_TYPES
          .map((type) => ({ type, count: Number(state.packStock[type]) || 0 }))
          .filter((entry) => entry.count > 0)
          .map((entry) => `${entry.count} ${packLabelFr(entry.type)}${entry.count > 1 ? 's' : ''}`)
          .join(' · ')}`
        : 'Inventaire vide — achète ou récupère tes packs gratuits.';
    }
    [
      [openClassic, 'classic'], [openRare, 'rare'], [$('open-doubleRare'), 'doubleRare'],
      [openLegend, 'legend'], [openVideo, 'video'], [openUltra, 'ultra']
    ].forEach(([button, type]) => {
      if (!button) return;
      const count = state.packStock[type] || 0;
      button.textContent = `OUVRIR ${packLabelUpper(type)} · ×${count} →`;
      button.disabled = count <= 0 || (state.phase !== 'pack' && state.phase !== 'done');
    });
  }

  function renderPackInventory() {
    const total = packTotal();
    const type = isPackType(state.currentPackType) ? state.currentPackType : 'classic';
    const selected = state.packStock[type] || 0;
    const demo = isDemoMode();
    const empty = selected <= 0 && !demo && state.phase === 'pack';
    const head = document.querySelector('.pack-head');
    if (head) head.hidden = total === 0 && !demo && state.phase === 'pack';
    /* Aucun booster : on affiche une carte d'invitation (Shop + cadeau du
       jour) au lieu du paquet. Plus de bandeau vide au-dessus du booster. */
    if (packStockLabel) packStockLabel.textContent = 'Aucun booster';
    if (packEmpty) packEmpty.hidden = !empty;
    if (packArea) packArea.hidden = empty;
    if (packOdds) packOdds.hidden = empty;
    if (packView) packView.dataset.packType = type;
    if (pack) {
      pack.dataset.packType = type;
      pack.classList.toggle('is-empty', empty);
      pack.setAttribute('aria-label', `Booster ${packLabelFr(type)}. Fais glisser vers la droite pour le déchirer.`);
    }
    renderOdds(type === 'ultra' ? 'ultra' : type === 'rare', packPool(type), type);
    renderInventory();
    if (state.phase === 'done') updateNextPackAction();
  }

  function renderInventory() {
    const total = packTotal();
    if (tabBadgeInventory) tabBadgeInventory.hidden = total <= 0;
    if (inventorySummary) {
      inventorySummary.textContent = total > 0
        ? `${fmt(total)} pack${total > 1 ? 's' : ''} prêt${total > 1 ? 's' : ''} à être ouvert${total > 1 ? 's' : ''}.`
        : 'Aucun pack en inventaire.';
    }
    const cardsToOpen = PACK_TYPES.reduce((sum, type) => sum + (Number(state.packStock[type]) || 0) * cardCountFor(type), 0);
    const typesInStock = PACK_TYPES.filter((type) => (Number(state.packStock[type]) || 0) > 0).length;
    const setStat = (id, value) => { const node = $(id); if (node) node.textContent = fmt(value); };
    setStat('inv-stat-packs', total);
    setStat('inv-stat-cards', cardsToOpen);
    setStat('inv-stat-types', typesInStock);
    if (inventoryEmpty) inventoryEmpty.hidden = total > 0;
    const sellLink = $('inventory-sell-link');
    if (sellLink) sellLink.hidden = !(Number(state.packStock.classic) > 0 || Number(state.packStock.rare) > 0);
    if (!inventoryGrid) return;
    inventoryGrid.hidden = total === 0;
    if (total === 0) {
      inventoryGrid.innerHTML = '';
      return;
    }
    const definitions = {
      classic: {
        title: 'Booster Classique',
        desc: '5 cartes · 1 Rare+ garantie par pack.',
        rare: false,
      },
      rare: {
        title: 'Booster Rare',
        desc: '5 cartes · 1 Rare+ et 1 Épique+ garanties · Shiny ×2.',
        rare: true,
      },
      doubleRare: {
        title: 'Booster Double Rare',
        desc: '10 cartes · mêmes chances que le Pack Rare · 2 Rare+ et 2 Épique+ garanties · Shiny ×2.',
        rare: false,
        double: true,
      },
      legend: {
        title: 'Booster Légende',
        desc: '10 cartes · chances standard de rareté.',
        rare: false,
      },
      video: {
        title: 'Booster Vidéo',
        desc: '2 cartes animées · fps, son et boucle réglés par carte.',
        rare: false,
        video: true,
      },
      ultra: {
        title: 'Booster Ultra Rare',
        desc: '5 cartes · Épique+, Mythique+ et Légendaire+ garantis · Shiny ×7.',
        rare: false,
        ultra: true,
      },
    };
    const items = PACK_TYPES
      .map((type) => ({
        type,
        count: Number(state.packStock[type]) || 0,
        img: PACK_IMAGES[type],
        ...definitions[type]
      }))
      .filter((item) => item.count > 0);
    const canOpen = state.phase === 'pack' || state.phase === 'done';
    inventoryGrid.innerHTML = items.map((item, i) => {
      /* Seuls les packs Classique et Rare peuvent être mis en vente :
         les autres restent exclusivement ouvrables. */
      const sellable = item.type === 'classic' || item.type === 'rare';
      return `
      <article class="inventory-card${item.rare ? ' inventory-card-rare' : ''}${item.double ? ' inventory-card-double' : ''}${item.video ? ' inventory-card-video' : ''}${item.ultra ? ' inventory-card-ultra' : ''}" data-pack-type="${item.type}" style="--i:${i}">
        <div class="inventory-card-visual">
          <span class="inventory-qty-badge">×${item.count}</span>
          <img class="inventory-card-img" src="${item.img}" alt="${item.title}" draggable="false">
        </div>
        <div class="inventory-card-body">
          <span class="inventory-card-kicker">${packLabelUpper(item.type)} · ${cardCountFor(item.type)} CARTES</span>
          <h3 class="inventory-card-title">${item.title}</h3>
          <p class="inventory-card-desc">${item.desc}</p>
        </div>
        <div class="inventory-card-actions">
          <button class="inventory-open-btn" type="button" data-open-pack="${item.type}" ${canOpen ? '' : 'disabled'}>
            Ouvrir <span aria-hidden="true">→</span>
          </button>
          ${sellable ? `<button class="inventory-sell-btn" type="button" data-sell-pack="${item.type}" aria-label="Vendre un pack ${packLabelFr(item.type)}">🏷️ Vendre</button>` : ''}
        </div>
      </article>
    `;
    }).join('');
  }

  function selectPackType(type, { silent = false } = {}) {
    if (!isPackType(type)) return;
    state.currentPackType = type;
    const src = PACK_IMAGES[type];
    if (packImgMain) packImgMain.src = src;
    if (packImgFlap) packImgFlap.src = src;
    if (packView) packView.dataset.packType = type;
    if (pack) pack.dataset.packType = type;
    if (!silent) SFX.tick();
    renderPackInventory();
    const gapCards = document.querySelector('.gap-cards');
    if (gapCards) {
      const count = cardCountFor(type);
      gapCards.replaceChildren(...Array.from({ length: count }, () => document.createElement('i')));
    }
  }

  function claimFreePack() {
    SFX.unlock();
    if (!dailyAvailable()) {
      SFX.snap();
      setFreeMsg('Tu as déjà récupéré le cadeau du jour. Reviens demain pour continuer le calendrier !');
      return;
    }
    const day = nextDailyDay();
    const reward = rewardForDay(day);
    const continuing = state.streakDate === yesterdayKey();
    state.streak = continuing ? (Math.floor(Number(state.streak) || 0) + 1) : 1;
    state.streakDate = todayKey();
    const gained = rewardParts(reward);
    Object.keys(reward.packs || {}).forEach((type) => {
      state.packStock[type] = (state.packStock[type] || 0) + (Number(reward.packs[type]) || 0);
    });
    if (Number(reward.coins) > 0) state.coins += reward.coins;
    state.freePacks = (state.freePacks || 0) + 1;
    noteClaimedDay(todayKey());
    if ((state.packStock[state.currentPackType] || 0) <= 0) {
      selectPackType('classic', { silent: true });
    }
    SFX.chaChing();
    const tomorrowDay = (state.streak % DAILY_REWARD_CYCLE.length) + 1;
    setFreeMsg(`Cadeau du jour ${day} récupéré : ${gained.join(' + ')}. Reviens demain pour le jour ${tomorrowDay} !`);
    showToast(`Cadeau du jour ${day} : ${gained.join(' + ')} !`);
    updateCoins();
    save();
    renderShop();
    renderPackInventory();
    /* Quête « Le gratuit d'abord » + succès « Quotidien », « Fidèle… » */
    trackProgress();
  }

  function buyPacks(type) {
    SFX.unlock();
    const qty = clamp(shopQty[type] || 1, 1, MAX_QTY);
    const total = promoUnitPrice(type) * qty;
    if (state.coins < total) {
      SFX.snap();
      setShopMsg(`Pas assez de pièces : il te manque ${fmt(total - state.coins)} 🪙 pour ${qty} pack${qty > 1 ? 's' : ''} ${packLabelFr(type)}${qty > 1 ? 's' : ''}.`);
      return;
    }
    SFX.chaChing();
    state.packStock[type] = (state.packStock[type] || 0) + qty;
    if (type === 'doubleRare') cloudHasDouble = true;
    state.packsBought = (state.packsBought || 0) + qty;
    if ((state.packStock[state.currentPackType] || 0) <= 0) {
      selectPackType(type, { silent: true });
    }
    addCoins(-total);
    setShopMsg(`${qty} pack${qty > 1 ? 's' : ''} ${packLabelFr(type)}${qty > 1 ? 's' : ''} ajouté${qty > 1 ? 's' : ''} à ton inventaire !`);
    showToast(`${qty} pack${qty > 1 ? 's' : ''} ${packLabelFr(type)}${qty > 1 ? 's' : ''} dans l'inventaire !`);
    renderShop();
    renderPackInventory();
    /* Quête « Premier achat », « Grossiste » + succès « Client », « Accro… » */
    trackProgress();
  }

  /* --------------------------------------------------------------- tirage */

  /* Nouveau moteur de tirage (voir PACK_TABLES / PACK_SLOTS plus haut) :
     1. on tire la rareté du slot (table du pack, garantie éventuelle),
     2. puis la carte, uniformément parmi les cartes de cette rareté.
     Plafond : 2 copies d'une même carte par pack (1 pour le Pack Vidéo).
     Si la rareté tirée n'a plus de carte disponible (plafond atteint), on
     retire parmi les raretés encore disponibles. */
  const MAX_SAME_CARD_PER_PACK = 2;

  /* Poids de chaque rareté pour un slot donné, restreints au pool :
     - table du pack (PACK_TABLES),
     - rang >= minRank pour un slot garanti,
     - rareté présente dans le pool (au moins une carte).
     Seul le rapport des poids compte : les pourcentages affichés sont les
     poids renormalisés sur les raretés disponibles. */
  function slotRarityWeights(packType, slot, pool) {
    const table = packTableFor(packType);
    const minRank = slot && typeof slot === 'object' ? (slot.minRank || 0) : 0;
    const available = new Set();
    (pool || []).forEach((c) => { if (RARITIES[c.rarity]) available.add(c.rarity); });
    const weights = {};
    Object.keys(RARITIES).forEach((key) => {
      const w = Number(table[key]) || 0;
      if (w <= 0) return;
      if (RARITIES[key].rank < minRank) return;
      if (!available.has(key)) return;
      weights[key] = w;
    });
    /* Garantie impossible dans ce pool (ex. aucune carte Épique+ en vidéo) :
       on retombe sur toutes les raretés disponibles du pool. */
    if (!Object.keys(weights).length) {
      Object.keys(RARITIES).forEach((key) => {
        const w = Number(table[key]) || 0;
        if (w > 0 && available.has(key)) weights[key] = w;
      });
    }
    return weights;
  }

  /* Tire une rareté selon ses poids (renormalisés). Renvoie null si vide. */
  function rollRarity(weights) {
    const keys = Object.keys(weights || {});
    let total = 0;
    keys.forEach((k) => { total += weights[k]; });
    if (!keys.length || total <= 0) return null;
    let roll = Math.random() * total;
    for (let i = 0; i < keys.length; i++) {
      if ((roll -= weights[keys[i]]) < 0) return keys[i];
    }
    return keys[keys.length - 1];
  }

  /* Cartes d'une rareté encore sous le plafond dans ce pack. */
  function availableCards(rarity, packCounts, pool, maxSame) {
    return (pool || []).filter((c) => c.rarity === rarity && (packCounts.get(c.id) || 0) < maxSame);
  }

  /* Tire une carte pour un slot : rareté d'abord, carte ensuite (uniforme).
     Renvoie null si le pool est vide. */
  function pickCardForSlot(packType, slot, packCounts, pool, maxSame) {
    const validPool = (pool || []).filter((c) => RARITIES[c.rarity]);
    if (!validPool.length) return null;
    let weights = slotRarityWeights(packType, slot, validPool);
    /* Exclut les raretés dont toutes les cartes sont déjà au plafond. */
    const usable = {};
    Object.keys(weights).forEach((key) => {
      if (availableCards(key, packCounts, validPool, maxSame).length) usable[key] = weights[key];
    });
    if (Object.keys(usable).length) weights = usable;
    const rarity = rollRarity(weights);
    if (!rarity) return null;
    const candidates = availableCards(rarity, packCounts, validPool, maxSame);
    if (candidates.length) return candidates[Math.floor(Math.random() * candidates.length)];
    /* Repli : n'importe quelle carte sous le plafond, sinon n'importe quelle
       carte du pool (le pack est toujours rempli, même avec un pool minuscule). */
    const underCap = validPool.filter((c) => (packCounts.get(c.id) || 0) < maxSame);
    const fallback = underCap.length ? underCap : validPool;
    return fallback[Math.floor(Math.random() * fallback.length)];
  }

  /* Valeur brute d'une carte tirée (récompense de sa rareté, mutations incluses). */
  function packCardValue(card) {
    const info = RARITIES[card && card.rarity] || RARITIES.common;
    return CardMutations.multiply(card, info.reward, 'reward') || 0;
  }

  /* Coup de pouce « pack rentable » (PACK_PROFIT_CHANCE) : si le tirage vaut
     moins que le prix réellement payé (promo incluse) et que le coup de pouce
     se déclenche, on remonte les cartes les plus faibles, une par une, à la
     plus petite rareté qui suffit à atteindre le prix — ou à la plus haute
     disponible si même elle ne suffit pas (on continue alors sur la carte
     suivante). Pool du pack et plafond de copies par pack sont respectés,
     et le remplacement repasse par le tirage Shiny du pack. Si le pool ne
     permet pas d'atteindre le prix, le pack est remonté au maximum possible. */
  function boostPackProfit(drawn, packType, pool, maxSame) {
    const price = promoUnitPrice(packType);
    const chance = packProfitChanceFor(packType);
    if (!drawn.length || !price || !chance || Math.random() >= chance) return;
    let total = drawn.reduce((sum, card) => sum + packCardValue(card), 0);
    if (total >= price) return;
    const baseKey = (card) => card.baseId || String(card.id || '').split('::')[0];
    const counts = new Map();
    drawn.forEach((card) => counts.set(baseKey(card), (counts.get(baseKey(card)) || 0) + 1));
    const raritiesByReward = Object.keys(RARITIES).sort((a, b) => RARITIES[a].reward - RARITIES[b].reward);
    const upgraded = new Set();
    while (total < price && upgraded.size < drawn.length) {
      let idx = -1;
      let lowest = Infinity;
      drawn.forEach((card, i) => {
        if (upgraded.has(i)) return;
        const value = packCardValue(card);
        if (value < lowest) { lowest = value; idx = i; }
      });
      if (idx < 0) break;
      upgraded.add(idx);
      const oldKey = baseKey(drawn[idx]);
      counts.set(oldKey, (counts.get(oldKey) || 0) - 1);
      const deficit = price - (total - lowest);
      let chosen = null;
      for (const rarity of raritiesByReward) {
        if (RARITIES[rarity].reward < deficit) continue;
        const candidates = availableCards(rarity, counts, pool, maxSame);
        if (candidates.length) { chosen = candidates[Math.floor(Math.random() * candidates.length)]; break; }
      }
      if (!chosen) {
        for (const rarity of [...raritiesByReward].reverse()) {
          if (RARITIES[rarity].reward <= lowest) continue;
          const candidates = availableCards(rarity, counts, pool, maxSame);
          if (candidates.length) { chosen = candidates[Math.floor(Math.random() * candidates.length)]; break; }
        }
      }
      if (!chosen) { counts.set(oldKey, (counts.get(oldKey) || 0) + 1); continue; }
      const rolled = CardMutations.roll(chosen, Math.random, packShinyFor(packType));
      drawn[idx] = rolled;
      counts.set(baseKey(rolled), (counts.get(baseKey(rolled)) || 0) + 1);
      total = total - lowest + packCardValue(rolled);
    }
  }

  /* `boosted` est conservé pour compatibilité (anciens appels) : le pack
     (et donc sa table + ses slots) est déduit de `type` ou du pack courant. */
  function drawPack(boosted, pool, type) {
    const packType = isPackType(type) ? type : isPackType(state.currentPackType) ? state.currentPackType : 'classic';
    const cardPool = pool && pool.length ? pool : packPool(packType);
    const drawn = [];
    const packCounts = new Map();
    const params = new URLSearchParams(window.location.search);
    const demoMode = params.get('demo') || sessionStorage.getItem('refs-demo');
    const wantsDemo = demoMode === '1' || demoMode === 'fusion' || demoMode === 'video';
    const record = (card) => {
      /* Les tirages de démo sont fixés d'avance (paires fusionnables, cartes
         vidéo) : un Shiny aléatoire casserait la démonstration. */
      const shinyMultiplier = wantsDemo ? 0 : packShinyFor(packType);
      drawn.push(CardMutations.roll(card, Math.random, shinyMultiplier));
      packCounts.set(card.id, (packCounts.get(card.id) || 0) + 1);
    };
    if (wantsDemo) {
      sessionStorage.setItem('refs-demo', demoMode === 'fusion' ? 'fusion' : demoMode === 'video' ? 'video' : '1');
      /* Les identifiants de la démo vidéo sont calculés à la volée dans
         cards.js (videoDemoIds) : ils suivent les cartes vidéo configurées. */
      let demoList = [];
      if (packType === 'video' && typeof videoDemoIds === 'function') {
        demoList = videoDemoIds();
      } else if (packType === 'video' && typeof videoDemoDraw !== 'undefined') {
        demoList = videoDemoDraw;
      } else if (demoMode === 'fusion' && typeof fusionDemoDraw !== 'undefined') {
        demoList = fusionDemoDraw;
      } else if (typeof demoDraw !== 'undefined') {
        demoList = demoDraw;
      }
      demoList.slice(0, cardCountFor(packType)).forEach((id) => {
        const found = CardMutations.resolve(id);
        if (found) record(found);
      });
    }
    /* Le Pack Vidéo ne tire que 2 cartes : on évite les doublons dès qu'il
       existe assez de cartes vidéo différentes (sinon le pool est rempli). */
    const maxSame = packType === 'video' ? 1 : MAX_SAME_CARD_PER_PACK;
    packSlotsFor(packType).forEach((slot) => {
      if (drawn.length >= cardCountFor(packType)) return;
      const card = pickCardForSlot(packType, slot, packCounts, cardPool, maxSame);
      if (card) record(card);
    });
    /* Hors démo : coup de pouce rentabilité (1/2, 2/5 ou 1/3 selon le pack). */
    if (!wantsDemo) boostPackProfit(drawn, packType, cardPool, maxSame);
    // Tri croissant : la carte la moins rare est révélée en premier, la plus
    // rare reste au fond de la pile pour faire monter la tension.
    return drawn.sort((a, b) => RARITIES[a.rarity].rank - RARITIES[b.rarity].rank);
  }

  /* ------------------------------------------------------------- FX canvas */

  const FX = (() => {
    const canvas = $('fx');
    const ctx = canvas.getContext('2d');
    const parts = [];
    let w = 0;
    let h = 0;
    let dpr = 1;
    let raf = 0;
    let last = 0;

    function resize() {
      const r = stage.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
    }

    function add(p) {
      if (parts.length > 420) parts.shift();
      p.age = 0;
      parts.push(p);
      if (!raf) {
        last = performance.now();
        raf = requestAnimationFrame(tick);
      }
    }

    const rand = (a, b) => a + Math.random() * (b - a);
    const pick = (arr) => arr[(Math.random() * arr.length) | 0];

    function spark(x, y, color, opts = {}) {
      const angle = opts.angle != null ? opts.angle + rand(-0.7, 0.7) : rand(0, Math.PI * 2);
      const speed = rand(opts.speedMin || 120, opts.speedMax || 520);
      add({
        type: 'spark',
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed - (opts.lift || 0),
        g: opts.g != null ? opts.g : 620,
        life: rand(0.3, opts.life || 0.75),
        size: rand(1.2, opts.size || 3),
        color: color || '#b388ff',
        drag: 0.985
      });
    }

    function dot(x, y, color, opts = {}) {
      const angle = rand(0, Math.PI * 2);
      const speed = rand(opts.speedMin || 40, opts.speedMax || 320);
      add({
        type: 'dot',
        x, y,
        vx: Math.cos(angle) * speed,
        vy: Math.sin(angle) * speed,
        g: opts.g != null ? opts.g : -30,
        life: rand(0.5, opts.life || 1.2),
        size: rand(opts.sizeMin || 2, opts.size || 5),
        color: color || '#fff',
        drag: 0.96
      });
    }

    function confetti(x, y, colors, count, opts = {}) {
      for (let i = 0; i < count; i++) {
        add({
          type: 'rect',
          x: x + rand(-24, 24),
          y: y + rand(-12, 12),
          vx: rand(-260, 260),
          vy: rand(-460, -120),
          g: 900,
          life: rand(1.4, 2.8),
          size: rand(4, 9),
          color: pick(colors),
          rot: rand(0, Math.PI * 2),
          vr: rand(-9, 9),
          sway: rand(0.6, 2),
          drag: 0.99,
          ...opts
        });
      }
    }

    function rain(colors, count) {
      for (let i = 0; i < count; i++) {
        add({
          type: 'rect',
          x: rand(0, w),
          y: rand(-h * 0.4, -10),
          vx: rand(-40, 40),
          vy: rand(90, 230),
          g: 60,
          life: rand(3, 5),
          size: rand(4, 8),
          color: pick(colors),
          rot: rand(0, Math.PI * 2),
          vr: rand(-5, 5),
          sway: rand(0.8, 2.4),
          drag: 1
        });
      }
    }

    function ring(x, y, color, radius) {
      add({
        type: 'ring',
        x, y,
        vx: 0,
        vy: 0,
        g: 0,
        life: 0.6,
        size: 10,
        to: radius || 220,
        color: color || '#fff',
        drag: 1
      });
    }

    function tick(now) {
      const dt = Math.min(0.05, (now - last) / 1000);
      last = now;
      ctx.clearRect(0, 0, w, h);

      for (let i = parts.length - 1; i >= 0; i--) {
        const p = parts[i];
        p.age += dt;
        const k = p.age / p.life;
        if (k >= 1) {
          parts.splice(i, 1);
          continue;
        }

        p.vy += p.g * dt;
        p.vx *= p.drag;
        p.vy *= p.drag;
        p.x += p.vx * dt;
        p.y += p.vy * dt;
        if (p.type === 'rect') {
          p.rot += p.vr * dt;
          p.x += Math.sin(p.age * p.sway * 6) * 22 * dt;
        }

        const alpha = k < 0.15 ? k / 0.15 : 1 - Math.pow((k - 0.15) / 0.85, 1.7);
        ctx.save();
        ctx.globalAlpha = Math.max(0, alpha);
        if (p.type !== 'rect') ctx.globalCompositeOperation = 'lighter';
        if (p.type === 'spark') {
          ctx.strokeStyle = p.color;
          ctx.lineWidth = p.size;
          ctx.lineCap = 'round';
          ctx.beginPath();
          ctx.moveTo(p.x, p.y);
          ctx.lineTo(p.x - p.vx * 0.014, p.y - p.vy * 0.014);
          ctx.stroke();
        } else if (p.type === 'dot') {
          ctx.fillStyle = p.color;
          ctx.globalAlpha = Math.max(0, alpha) * 0.28;
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size * 2.6, 0, Math.PI * 2);
          ctx.fill();
          ctx.globalAlpha = Math.max(0, alpha);
          ctx.beginPath();
          ctx.arc(p.x, p.y, p.size, 0, Math.PI * 2);
          ctx.fill();
        } else if (p.type === 'rect') {
          ctx.translate(p.x, p.y);
          ctx.rotate(p.rot);
          ctx.fillStyle = p.color;
          ctx.fillRect(-p.size / 2, -p.size / 4, p.size, p.size / 2);
        } else if (p.type === 'ring') {
          const r = p.size + (p.to - p.size) * Math.pow(k, 0.45);
          ctx.strokeStyle = p.color;
          ctx.lineWidth = 2 + (1 - k) * 2;
          ctx.beginPath();
          ctx.arc(p.x, p.y, r, 0, Math.PI * 2);
          ctx.stroke();
        }
        ctx.restore();
      }

      if (parts.length) raf = requestAnimationFrame(tick);
      else {
        raf = 0;
        ctx.clearRect(0, 0, w, h);
      }
    }

    return { resize, spark, dot, confetti, rain, ring };
  })();

  /* ---------------------------------------------------------- poussières */

  const Dust = (() => {
    const canvas = $('dust');
    const ctx = canvas.getContext('2d');
    let w = 0, h = 0, dpr = 1, raf = 0;
    const dots = [];

    function resize() {
      const r = canvas.getBoundingClientRect();
      dpr = Math.min(window.devicePixelRatio || 1, 2);
      w = r.width;
      h = r.height;
      canvas.width = Math.max(1, Math.round(w * dpr));
      canvas.height = Math.max(1, Math.round(h * dpr));
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0);
      seed();
    }

    function seed() {
      dots.length = 0;
      const count = Math.round(clamp((w * h) / 30000, 18, 44));
      for (let i = 0; i < count; i++) {
        dots.push({
          x: Math.random() * w,
          y: Math.random() * h,
          r: Math.random() * 1.6 + 0.4,
          vy: -(Math.random() * 0.18 + 0.03),
          vx: (Math.random() - 0.5) * 0.12,
          a: Math.random() * 0.5 + 0.12,
          ph: Math.random() * Math.PI * 2
        });
      }
    }

    function tick(now) {
      ctx.clearRect(0, 0, w, h);
      for (const d of dots) {
        d.y += d.vy;
        d.x += d.vx + Math.sin(now / 2600 + d.ph) * 0.09;
        if (d.y < -8) { d.y = h + 8; d.x = Math.random() * w; }
        if (d.x < -8) d.x = w + 8;
        if (d.x > w + 8) d.x = -8;
        const tw = 0.6 + Math.sin(now / 900 + d.ph) * 0.4;
        ctx.globalAlpha = d.a * tw;
        ctx.fillStyle = '#cdb0ff';
        ctx.beginPath();
        ctx.arc(d.x, d.y, d.r, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 1;
      raf = requestAnimationFrame(tick);
    }

    function start() {
      if (raf || reduceMotion.matches) return;
      raf = requestAnimationFrame(tick);
    }

    return { resize, start };
  })();

  /* ---------------------------------------------------------------- tween */

  const easeOutCubic = (t) => 1 - Math.pow(1 - t, 3);
  const easeOutElastic = (t) =>
    t === 0 ? 0 : t === 1 ? 1 : Math.pow(2, -9 * t) * Math.sin((t * 10 - 0.75) * ((2 * Math.PI) / 3)) + 1;

  function tween(from, to, duration, ease, onUpdate, onDone) {
    const start = performance.now();
    function step(now) {
      const k = clamp((now - start) / duration, 0, 1);
      onUpdate(from + (to - from) * ease(k));
      if (k < 1) requestAnimationFrame(step);
      else if (onDone) onDone();
    }
    requestAnimationFrame(step);
  }

  function stagePoint(clientX, clientY) {
    const r = stage.getBoundingClientRect();
    return { x: clientX - r.left, y: clientY - r.top };
  }

  /* ====================================================== DÉCOUPE DU PACK */

  let drag = null;
  let tearP = 0;
  let tearRaf = null;

  function setTear(p, dx = 0) {
    tearP = clamp(p, 0, 1);
    // La coupe s'ouvre vite dès les premiers pixels, puis ralentit : le geste
    // « accroche » le film au lieu de le suivre mécaniquement.
    const eased = 1 - Math.pow(1 - tearP, 1.35);
    packArea.style.setProperty('--p', eased.toFixed(4));
    pack.style.transform = `translateX(${(dx * 0.08).toFixed(2)}px) rotate(${(tearP * 1.4).toFixed(2)}deg)`;
    packFlap.style.transform = `translateY(${(-tearP * 8).toFixed(2)}px) rotateX(${(-tearP * 10).toFixed(2)}deg) translateZ(${(tearP * 6).toFixed(2)}px)`;
    hintPct.textContent = `${Math.round(tearP * 100)} %`;
    hintPct.classList.toggle('hot', tearP >= TEAR_THRESHOLD);
    if (gapGlow) {
      gapGlow.style.opacity = tearP > 0.02 ? String(Math.min(1, tearP * 1.8)) : '0';
      gapGlow.style.transform = `scaleX(${tearP})`;
    }
    if (gapCards) {
      gapCards.style.opacity = tearP > 0.32 ? '1' : '0';
      gapCards.style.transform = `translateY(${(6 - tearP * 14).toFixed(1)}px)`;
    }
    if (packSave) packSave.style.opacity = String(clamp(1 - tearP * 2.4, 0, 1));
  }

  function resetTear() {
    setTear(0, 0);
    hintText.textContent = 'Trace la ligne de découpe d\'un doigt ou à la souris';
    hintPct.classList.remove('hot');
  }

  function emitCutSparks() {
    const r = cut.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const x = r.left - s.left + r.width * tearP;
    const y = r.top - s.top;
    if (reduceMotion.matches) return;
    for (let i = 0; i < 2; i++) {
      FX.spark(x + (Math.random() - 0.5) * 6, y, i ? '#ffffff' : '#b388ff', {
        angle: (Math.random() - 0.5) * 0.9 + (Math.random() < 0.5 ? 0 : Math.PI),
        speedMin: 60,
        speedMax: 260,
        g: 340,
        size: 2.2
      });
    }
  }

  /* Sans pack en inventaire, on ne peut pas déchirer : on renvoie au Shop. */
  function hasPackToOpen() {
    if (isDemoMode()) return true;
    return (state.packStock[state.currentPackType] || 0) > 0;
  }

  function denyNoPack() {
    SFX.snap();
    showToast('Aucun pack en inventaire — va au Shop pour en acheter ou récupérer les gratuits.', 3600);
  }

  function onDragStart(e) {
    if (state.phase !== 'pack' || drag) return;
    SFX.unlock();
    if (!hasPackToOpen()) { denyNoPack(); e.preventDefault(); return; }
    if (e.button != null && e.button !== 0) return;
    const rect = pack.getBoundingClientRect();
    drag = {
      id: e.pointerId,
      startX: e.clientX,
      startY: e.clientY,
      lastX: e.clientX,
      lastT: performance.now(),
      travel: Math.max(90, rect.width * 0.8),
      speed: 0,
      started: false,
      lastSpark: 0
    };
    pack.classList.add('is-dragging');
    try { pack.setPointerCapture(e.pointerId); } catch (err) {}
    window.addEventListener('pointermove', onDragMove, { passive: false });
    window.addEventListener('pointerup', onDragEnd);
    window.addEventListener('pointercancel', onDragEnd);
    e.preventDefault();
  }

  function onDragMove(e) {
    if (!drag || e.pointerId !== drag.id) return;
    e.preventDefault();
    const dx = e.clientX - drag.startX;
    const now = performance.now();
    const dt = Math.max(8, now - drag.lastT);
    drag.speed = Math.abs(e.clientX - drag.lastX) / dt;
    drag.lastX = e.clientX;
    drag.lastT = now;

    const p = clamp(dx / drag.travel, 0, 1);
    setTear(p, Math.max(0, dx));

    if (!drag.started && dx > 3) {
      drag.started = true;
      SFX.tearStart();
    }
    if (drag.started) {
      const intensity = clamp(0.18 + p * 0.62 + drag.speed * 1.1, 0, 1);
      const r = pack.getBoundingClientRect();
      const pan = clamp(((e.clientX - (r.left + r.width / 2)) / r.width) * 1.6, -0.9, 0.9);
      SFX.tearUpdate(intensity, pan);
      if (now - drag.lastSpark > 26) {
        drag.lastSpark = now;
        emitCutSparks();
      }
      if (p > 0.55) hintText.textContent = 'Encore un peu… lâche au-delà de 75 %';
      else hintText.textContent = 'Continue vers la droite pour déchirer';
    }
  }

  function onDragEnd() {
    if (!drag) return;
    window.removeEventListener('pointermove', onDragMove);
    window.removeEventListener('pointerup', onDragEnd);
    window.removeEventListener('pointercancel', onDragEnd);
    const started = drag.started;
    const wasDrag = drag;
    drag = null;
    pack.classList.remove('is-dragging');
    if (wasDrag.id !== 'kbd') {
      try { pack.releasePointerCapture(wasDrag.id); } catch (err) {}
    }
    SFX.tearStop();

    if (tearP >= TEAR_THRESHOLD) {
      completeTear();
    } else {
      if (started) {
        SFX.snap();
        hintText.textContent = `Il faut dépasser 75 % — tu es à ${Math.round(tearP * 100)} %`;
        hintPct.classList.remove('hot');
      }
      const from = tearP;
      tween(from, Math.max(from * 0.9, 0.02), 760, easeOutElastic, (v) => setTear(v, Math.max(0, v * wasDrag.travel * 0.1)), () => {
        pack.style.transform = '';
        packFlap.style.transform = '';
      });
    }
  }

  function completeTear() {
    if (state.phase !== 'pack') return;
    state.phase = 'tearing';
    SFX.tearStop();
    tween(tearP, 1, 140, easeOutCubic, (v) => setTear(v, v * 160), openPack);
  }

  function autoTear() {
    if (state.phase !== 'pack') return;
    if (!hasPackToOpen()) { denyNoPack(); return; }
    state.phase = 'tearing';
    SFX.unlock();
    SFX.tearStart();
    const start = performance.now();
    function step(now) {
      const k = clamp((now - start) / 620, 0, 1);
      setTear(k, k * 150);
      SFX.tearUpdate(clamp(k * 0.9, 0, 1), 0);
      if (k < 1) requestAnimationFrame(step);
      else openPack();
    }
    requestAnimationFrame(step);
  }

  /* Affiche la cinématique d'ouverture du pack (overlay plein écran).
     Le thème (titre, image, palette) vient de PACK_OPENING ; le CSS
     module les animations via [data-pack-type] + les variables --po-*. */
  function showPackOpening(type) {
    if (!packOpening) return;
    const theme = packOpeningFor(type);
    packOpening.dataset.packType = type;
    packOpening.hidden = false;
    packOpening.setAttribute('aria-hidden', 'false');
    if (packOpeningImg) packOpeningImg.src = PACK_IMAGES[type] || PACK_IMAGES.classic;
    if (packOpeningTitle) packOpeningTitle.textContent = theme.title;
    if (packOpeningSub) packOpeningSub.textContent = theme.sub;
    if (packOpeningKicker) packOpeningKicker.textContent = `✦ PACK ${theme.title} ✦`;
    packOpening.classList.remove('is-active', 'is-burst');
    void packOpening.offsetWidth;
    packOpening.classList.add('is-active');
  }

  function hidePackOpening() {
    if (!packOpening) return;
    packOpening.classList.remove('is-active', 'is-burst');
    packOpening.hidden = true;
    packOpening.setAttribute('aria-hidden', 'true');
  }

  /* Ouverture atomique : une erreur pendant la cinématique (tirage, image,
     canvas ou animation différée) ne doit jamais laisser le jeu dans un état
     « tearing » bloqué, avec un pack consommé et une page à recharger. On
     garde donc un jeton d'ouverture, les compteurs d'avant ouverture, et on
     sait revenir proprement à l'écran du booster. Le même jeton annule les
     animations en attente si une nouvelle ouverture démarre entre-temps. */
  let openingToken = 0;
  let openingTimers = [];
  const PACK_BUSY_CLASS = 'refs-pack-opening';

  function setPackBusy(busy) {
    if (document.body) document.body.classList.toggle(PACK_BUSY_CLASS, Boolean(busy));
  }

  function openingLater(fn, ms) {
    const token = openingToken;
    const id = window.setTimeout(() => {
      openingTimers = openingTimers.filter((timer) => timer !== id);
      if (token === openingToken) fn();
    }, ms);
    openingTimers.push(id);
    return id;
  }

  function clearOpeningTimers() {
    openingTimers.forEach((id) => window.clearTimeout(id));
    openingTimers = [];
  }

  function recoverPackOpening(error, type, stockBefore, openedBefore, token) {
    if (token !== openingToken) return;
    openingToken += 1;               // annule les animations déjà programmées
    clearOpeningTimers();
    setPackBusy(false);
    console.error('[Refs Cards] ouverture du booster interrompue :', error);
    if (isPackType(type) && !isDemoMode()) {
      /* Le pack n'a pas été ouvert : on le rend, ainsi que le compteur, et on
         réécrit la sauvegarde (save() annule l'écriture différée du pack
         consommé). */
      state.packStock[type] = Math.max(stockBefore, (Number(state.packStock[type]) || 0) + 1);
      state.packsOpened = openedBefore;
      save();
    }
    state.phase = 'pack';
    resetToPack({ quiet: true });
    showToast('Ouverture interrompue : ton booster est intact, réessaie.', 4200);
  }

  function openPack() {
    /* Appels normaux : phase « tearing » après la déchirure. Les tests et
       quelques raccourcis appellent directement depuis « pack ». */
    if (state.phase !== 'pack' && state.phase !== 'tearing') return;
    const type = isPackType(state.currentPackType) ? state.currentPackType : 'classic';
    const stockBefore = state.packStock[type] || 0;
    const openedBefore = state.packsOpened || 0;
    const startPhase = state.phase;
    const token = ++openingToken;
    clearOpeningTimers();
    setPackBusy(true);
    try {
      runPackOpening(type, { stockBefore, openedBefore, token, startPhase });
    } catch (error) {
      recoverPackOpening(error, type, stockBefore, openedBefore, token);
    }
  }

  function runPackOpening(type, { stockBefore, openedBefore, token, startPhase }) {
    const theme = packOpeningFor(type);
    /* Consomme 1 pack de l'inventaire (sauf en démo, où l'ouverture est
       gratuite pour les tests/apercus). */
    if (!isDemoMode()) {
      if ((state.packStock[type] || 0) > 0) {
        state.packStock[type] -= 1;
        state.packsOpened = (state.packsOpened || 0) + 1;
        save();
        renderShop();
        renderPackInventory();
        /* Quête « Premier déchir », « Rythme régulier », « Ouverture intensive »… */
        trackProgress();
      }
    }
    SFX.tearStop();
    SFX.rip();
    pack.classList.add('is-ripped', 'is-pack-ripped');
    pack.dataset.packType = type;
    if (type === 'ultra') pack.classList.add('is-ultra-ripped');
    packFlap.classList.add('is-gone');
    packFlap.style.transform = '';

    /* Jingle signature du pack (audio.js packOpen, repli tolérant). */
    if (SFX && typeof SFX.packOpen === 'function') SFX.packOpen(type);
    else if (type === 'ultra' && SFX && typeof SFX.ultraOpen === 'function') SFX.ultraOpen();

    const r = cut.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const lineY = r.top - s.top;
    const x0 = r.left - s.left;
    const packRect = pack.getBoundingClientRect();
    const cx = packRect.width > 0 ? packRect.left - s.left + packRect.width / 2 : x0 + r.width * 0.5;
    const cy = packRect.height > 0 ? packRect.top - s.top + packRect.height * 0.48 : lineY;
    const colors = theme.colors;

    showPackOpening(type);

    if (!reduceMotion.matches) {
      for (let i = 0; i < theme.sparks; i++) {
        FX.spark(x0 + (r.width * i) / Math.max(1, theme.sparks), lineY + (Math.random() - 0.5) * 8, colors[i % colors.length], {
          speedMin: 140,
          speedMax: 620,
          g: 380,
          size: 3
        });
      }
      for (let i = 0; i < 24; i++) {
        FX.dot(cx, cy, colors[i % colors.length], { speedMin: 30, speedMax: 220, g: -40, size: 4, life: 0.9 });
      }
    }

    openingLater(() => {
      if (packOpening) packOpening.classList.add('is-burst');
      flash.classList.remove('run');
      void flash.offsetWidth;
      flash.classList.add('run');
      if (!reduceMotion.matches) {
        FX.ring(cx, cy, '#ffffff', 420);
        FX.ring(cx, cy, colors[1] || '#ffffff', 320);
        FX.ring(cx, cy, colors[2] || '#ffffff', 230);
        for (let i = 0; i < theme.sparks * 2; i++) {
          FX.spark(cx, cy, colors[i % colors.length], { speedMin: 180, speedMax: 780, g: 240, size: 3.4, life: 1.15 });
        }
        for (let i = 0; i < theme.dots; i++) {
          FX.dot(cx, cy, colors[i % colors.length], { speedMin: 70, speedMax: 520, g: -50, size: 5.5, life: 1.5 });
        }
        FX.confetti(cx, cy, colors, theme.confetti);
        if (theme.rain > 0) FX.rain(colors, theme.rain);
      }
      stage.classList.remove('shake', 'ultra-shake');
      void stage.offsetWidth;
      stage.classList.add(theme.shake);
    }, reduceMotion.matches ? 40 : theme.burstDelay);

    /* La révélation est différée : si elle échoue (donnée de carte invalide,
       Canvas indisponible…), on annule la consommation au lieu de laisser la
       page figée puis de forcer l'utilisateur à recharger. */
    openingLater(() => {
      if (token !== openingToken || (state.phase !== 'tearing' && state.phase !== startPhase)) return;
      try {
        /* Un tirage vide (pool sans carte valide) est aussi une ouverture
           avortée : le pack ne doit pas disparaître de l'inventaire. */
        if (showReveal(type) === false) {
          recoverPackOpening(new Error('tirage vide'), type, stockBefore, openedBefore, token);
        }
      } catch (error) {
        recoverPackOpening(error, type, stockBefore, openedBefore, token);
      } finally {
        setPackBusy(false);
      }
    }, reduceMotion.matches ? 320 : theme.revealDelay);
  }

  on(packArea, 'pointerdown', onDragStart);
  on(packArea, 'pointermove', (e) => {
    if (drag || state.phase !== 'pack' || reduceMotion.matches) return;
    const r = packArea.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1) - 0.5;
    const y = clamp((e.clientY - r.top) / r.height, 0, 1) - 0.5;
    packFloat.style.setProperty('--py', `${(x * 16).toFixed(1)}deg`);
    packFloat.style.setProperty('--px', `${(-y * 12).toFixed(1)}deg`);
  });
  on(packArea, 'pointerleave', () => {
    packFloat.style.setProperty('--py', '0deg');
    packFloat.style.setProperty('--px', '0deg');
  });
  on(pack, 'contextmenu', (e) => e.preventDefault());
  on(pack, 'keydown', (e) => {
    if (state.phase !== 'pack') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      autoTear();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
      if (!hasPackToOpen()) { denyNoPack(); return; }
      SFX.unlock();
      if (!drag) {
        drag = { id: 'kbd', startX: 0, lastX: 0, lastT: 0, travel: 100, speed: 0, started: true, lastSpark: 0 };
        SFX.tearStart();
      }
      setTear(tearP + 0.09, (tearP + 0.09) * 60);
      SFX.tearUpdate(clamp(tearP, 0, 1), 0);
      emitCutSparks();
    }
  });
  on(pack, 'keyup', (e) => {
    if (e.key === 'ArrowRight' && drag && drag.id === 'kbd') {
      drag = null;
      SFX.tearStop();
      if (tearP >= TEAR_THRESHOLD) completeTear();
      else {
        const from = tearP;
        tween(from, 0, 600, easeOutElastic, (v) => setTear(v, v * 20), resetTear);
      }
    }
  });

  /* ============================================================ LES CARTES */

  /* Résout le visuel d'une carte : le premier fichier existant parmi les
     candidats (assets/Cartes/<nom>.png, .jpg, ...). Ne met jamais en cache un
     échec réseau transitoire afin qu'un second affichage puisse réessayer. */
  const resolvedImageCache = new Map();

  function expandAssetUrls(srcs) {
    const out = [];
    const push = (u) => {
      if (u && out.indexOf(u) === -1) out.push(u);
    };
    srcs.forEach((src) => {
      push(src);
      try {
        push(encodeURI(src));
        if (typeof src.normalize === 'function') {
          push(encodeURI(src.normalize('NFC')));
          push(encodeURI(src.normalize('NFD')));
        }
      } catch (error) { /* ignore URI malformée */ }
    });
    return out;
  }

  function cardImageCandidates(card) {
    const raw = typeof cardImageSources === 'function'
      ? cardImageSources(card)
      : card && card.image ? [card.image] : [];
    return expandAssetUrls(raw);
  }

  function resolveCardImage(card) {
    const srcs = cardImageCandidates(card);
    if (!srcs.length) return Promise.resolve(null);
    const key = srcs.join('|');
    if (resolvedImageCache.has(key)) return Promise.resolve(resolvedImageCache.get(key));
    const load = (i) => {
      if (i >= srcs.length) return Promise.resolve(null);
      return new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => {
          resolvedImageCache.set(key, srcs[i]);
          resolve(srcs[i]);
        };
        probe.onerror = () => resolve(load(i + 1));
        probe.src = srcs[i];
      });
    };
    return load(0);
  }

  function attachCardImage(frame, img, video, card) {
    const candidates = cardImageCandidates(card);
    if (!candidates.length) return;
    const key = candidates.join('|');
    const cached = resolvedImageCache.get(key);
    const ordered = cached
      ? [cached, ...candidates.filter((u) => u !== cached)]
      : candidates;

    let idx = 0;
    let retried = false;
    let settled = false;

    const markLoaded = (src) => {
      if (settled) return;
      settled = true;
      if (src) resolvedImageCache.set(key, src);
      frame.classList.add('has-img', 'has-src');
      if (video && src) {
        try { video.poster = src; } catch (error) { /* ignore */ }
      }
    };

    const tryNext = () => {
      if (settled) return;
      if (idx >= ordered.length) {
        if (!retried) {
          retried = true;
          idx = 0;
          setTimeout(tryNext, 300);
          return;
        }
        img.removeAttribute('src');
        frame.classList.remove('has-src', 'has-img');
        return;
      }
      const nextSrc = ordered[idx++];
      img.src = nextSrc;
      if (img.complete && img.naturalWidth > 0) {
        markLoaded(nextSrc);
      }
    };

    on(img, 'load', () => markLoaded(img.getAttribute('src') || ordered[Math.max(0, idx - 1)]));
    on(img, 'error', () => tryNext());
    tryNext();
  }

  /* ------------------------------------------------------- lecteurs vidéo
     Une carte vidéo garde exactement le même cadre que les autres : l'image
     sert d'affiche, le <video> se superpose, et les surcouches de rareté
     (titre, description, holo, effets) restent au-dessus. */

  /* Taux de lecture à appliquer pour atteindre le fps demandé quand le fichier
     source a une autre fréquence (ex. 24 i/s demandées sur un fichier 60 i/s
     → ×0,4, un vrai ralenti). Sans `sourceFps`, on ne devine pas : le fps sert
     de métadonnée et de critère de choix dans `srcByFps`. */
  function cardVideoPlaybackRate(config) {
    if (!config || !config.fps || !config.sourceFps) return 1;
    return clamp(config.fps / config.sourceFps, 0.25, 4);
  }

  /* jsdom et les navigateurs sans décodage vidéo renvoient '' : on évite alors
     d'appeler play() inutilement (et les avertissements de test). */
  function canPlayCardVideo(videoEl) {
    try {
      if (!videoEl || typeof videoEl.canPlayType !== 'function') return false;
      return Boolean(
        videoEl.canPlayType('video/mp4; codecs="avc1.42E01E"')
        || videoEl.canPlayType('video/webm; codecs="vp8, vorbis"')
      );
    } catch (error) { return false; }
  }

  function startCardVideo(videoEl) {
    if (!videoEl || videoEl.dataset.autoplay !== '1') return;
    if (!canPlayCardVideo(videoEl)) return;
    try {
      const played = videoEl.play();
      if (played && typeof played.catch === 'function') played.catch(() => {});
    } catch (error) { /* lecture bloquée : l'affiche reste visible */ }
  }

  /* Les miniatures (collection, récap) ne tournent que si elles sont visibles :
     on évite de décoder vingt vidéos hors écran. */
  let cardVideoObserver = null;
  function observeCardVideo(videoEl) {
    if (!videoEl) return;
    if (typeof IntersectionObserver !== 'function') {
      startCardVideo(videoEl);
      return;
    }
    if (!cardVideoObserver) {
      cardVideoObserver = new IntersectionObserver((entries) => {
        entries.forEach((entry) => {
          const video = entry.target;
          if (entry.isIntersecting) startCardVideo(video);
          else if (typeof video.pause === 'function') video.pause();
        });
      }, { rootMargin: '80px' });
    }
    cardVideoObserver.observe(videoEl);
  }

  /* Active le son des cartes vidéo d'un élément (appelé depuis un clic, seul
     moment où les navigateurs autorisent l'audio). */
  function activateCardAudio(root) {
    if (!root || typeof root.querySelectorAll !== 'function') return;
    root.querySelectorAll('video.cf-video[data-sound="on"]').forEach((video) => {
      try {
        video.muted = false;
        video.dataset.audioActive = 'on';
        const played = video.play();
        if (played && typeof played.catch === 'function') played.catch(() => {});
        const button = video.parentElement && video.parentElement.querySelector('.cf-audio');
        if (button) {
          button.textContent = '🔊';
          button.setAttribute('aria-pressed', 'true');
          button.setAttribute('aria-label', 'Couper le son de la carte');
        }
      } catch (error) { /* son indisponible */ }
    });
  }

  /* Construit le lecteur d'une carte vidéo et le branche sur sa config. */
  function buildCardVideo(card, config, opts) {
    const isStatic = Boolean(opts && opts.staticPreview);
    const video = document.createElement('video');
    video.className = 'cf-video';
    video.playsInline = true;
    video.setAttribute('playsinline', '');
    video.setAttribute('webkit-playsinline', '');
    video.preload = config.preload === 'none' ? 'none' : 'auto';
    video.loop = isStatic ? false : Boolean(config.loop);
    /* Toujours démarrer en muet : c'est la seule façon d'obtenir l'autoplay
       sur tous les navigateurs. Le son s'active au clic (carte ou bouton 🔊). */
    video.muted = true;
    video.defaultMuted = true;
    video.dataset.fps = config.fps == null ? 'auto' : String(config.fps);
    video.dataset.sourceFps = config.sourceFps == null ? '' : String(config.sourceFps);
    video.dataset.sound = !isStatic && config.sound ? 'on' : 'off';
    video.dataset.loop = !isStatic && config.loop ? 'on' : 'off';
    video.dataset.audioActive = 'off';
    video.dataset.autoplay = !isStatic && config.autoplay ? '1' : '0';
    video.setAttribute('aria-label', `Vidéo de la carte ${card.name}${config.sound ? ', avec son' : ', sans son'}${config.loop ? ', en boucle' : ''}`);
    if (config.fps) video.style.setProperty('--video-fps', String(config.fps));

    const rate = cardVideoPlaybackRate(config);
    if (rate !== 1) {
      try { video.playbackRate = rate; } catch (error) { /* ignore */ }
      video.dataset.playbackRate = String(rate);
    }
    const markVideoReady = () => {
      const frame = video.closest('.cf');
      if (frame) frame.classList.add('has-video');
    };
    on(video, 'loadedmetadata', () => {
      if (rate !== 1) {
        try { video.playbackRate = rate; } catch (error) { /* ignore */ }
      }
      if (isStatic) {
        try { video.currentTime = 0.05; } catch (error) { /* ignore */ }
      }
    });
    on(video, 'loadeddata', markVideoReady);
    on(video, 'canplay', markVideoReady);
    on(video, 'seeked', markVideoReady);
    on(video, 'ended', () => {
      const frame = video.closest('.cf');
      if (frame) frame.classList.add('is-video-ended');
    });

    const rawSources = typeof cardVideoSources === 'function' ? cardVideoSources(card) : [];
    const sources = expandAssetUrls(rawSources);
    sources.forEach((src) => {
      const source = document.createElement('source');
      source.src = src;
      source.type = /\.webm$/i.test(src) ? 'video/webm' : 'video/mp4';
      video.append(source);
    });
    if (!sources.length && config.src) video.src = config.src;

    if (!isStatic && config.autoplay) observeCardVideo(video);
    return video;
  }

  /* Bouton son (uniquement si la carte a du son et hors miniature). */
  function buildCardAudioButton(config) {
    if (!config.sound) return null;
    const button = el('button', 'cf-audio', '🔇');
    button.type = 'button';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', 'Activer le son de la carte');
    on(button, 'pointerdown', (event) => event.stopPropagation());
    on(button, 'click', (event) => {
      event.preventDefault();
      event.stopPropagation();
      const frame = button.closest('.cf');
      const video = frame && frame.querySelector('video.cf-video');
      if (!video) return;
      const nextMuted = !video.muted;
      video.muted = nextMuted;
      video.dataset.audioActive = nextMuted ? 'off' : 'on';
      button.textContent = nextMuted ? '🔇' : '🔊';
      button.setAttribute('aria-pressed', String(!nextMuted));
      button.setAttribute('aria-label', nextMuted ? 'Activer le son de la carte' : 'Couper le son de la carte');
      if (!nextMuted) {
        try {
          const played = video.play();
          if (played && typeof played.catch === 'function') played.catch(() => {});
        } catch (error) { /* ignore */ }
      }
    });
    return button;
  }

  function videoTagLabel(config) {
    const parts = [config.fps ? `${config.fps} i/s` : 'vidéo'];
    if (config.sound) parts.push('son');
    if (config.loop) parts.push('boucle');
    return `▶ ${parts.join(' · ')}`;
  }

  /* Cadre d'une carte : image plein cadre (5:7), titre en haut sur dégradé,
     description en bas sur dégradé, ID discret. Le tout réutilisable dans la
     révélation, le récap miniature et l'inspection en grand. */
  function cardFrame(card, opts = {}) {
    const info = RARITIES[card.rarity] || RARITIES.common;
    const videoConfig = cardVideoInfo(card);
    const frame = el('span', 'cf');
    const mutation = CardMutations.definition(card);
    const hasImageCandidate = cardImageCandidates(card).length > 0;
    const showVideo = Boolean(videoConfig && !opts.disableVideo);
    const showStaticVideoPreview = Boolean(videoConfig && opts.disableVideo && !hasImageCandidate);
    if (mutation) {
      frame.classList.add(mutation.cssClass);
      frame.dataset.mutation = mutation.id;
    }
    frame.style.setProperty('--r-color', info.color);
    frame.style.setProperty('--r-ink', info.ink);
    frame.style.setProperty('--r-glow', info.glow);
    frame.dataset.rarity = card.rarity;
    if (showVideo) frame.dataset.video = '1';
    if (opts.mini) frame.classList.add('cf-mini');

    const img = el('img', 'cf-img');
    img.alt = opts.alt || '';
    img.draggable = false;
    img.decoding = 'async';
    img.loading = opts.lazy ? 'lazy' : 'eager';

    const fallback = el('span', 'cf-fallback');
    fallback.style.setProperty('--art', card.color || '#cfd7c5');
    fallback.append(el('span', 'card-emoji', card.emoji || '✦'));

    const top = el('span', 'cf-top');
    const badge = el('span', 'cf-badge', info.label);
    const name = el('span', 'cf-name', card.name);
    top.append(badge, name);
    if (mutation) top.append(el('span', 'cf-mutation', `${mutation.icon} ${mutation.label}`));
    if (opts.mini) top.classList.add('cf-top-mini');

    const bottom = el('span', 'cf-bottom');
    bottom.append(el('span', 'cf-desc', card.description || ''));
    if (showVideo) {
      bottom.append(el('span', 'cf-video-tags', videoTagLabel(videoConfig)));
    }
    const meta = el('span', 'cf-meta');
    meta.append(el('span', 'cf-id', `#${card.id}`));
    if (opts.index != null) meta.append(el('span', 'cf-num', `S01·${String(opts.index + 1).padStart(2, '0')}`));
    bottom.append(meta);

    const video = showVideo
      ? buildCardVideo(card, videoConfig, opts)
      : showStaticVideoPreview
        ? buildCardVideo(card, { ...videoConfig, autoplay: false, sound: false, loop: false }, { ...opts, staticPreview: true })
        : null;
    frame.append(fallback, img);
    if (video) {
      frame.append(video);
      if (video.readyState >= 2) frame.classList.add('has-video');
    }
    frame.append(top, bottom);
    if (!opts.mini) {
      frame.append(el('span', 'cf-holo'), el('span', 'cf-shine'));
    }
    const audioButton = showVideo && !opts.mini ? buildCardAudioButton(videoConfig) : null;
    if (audioButton) frame.append(audioButton);

    attachCardImage(frame, img, video, card);

    return frame;
  }

  function buildCard(card, index) {
    const info = RARITIES[card.rarity] || RARITIES.common;
    const btn = el('div', `card card-${card.rarity}`);
    btn.tabIndex = 0;
    btn.setAttribute('role', 'button');
    btn.dataset.id = card.id;
    btn.dataset.fx = info.fx;
    btn.style.setProperty('--depth', index);
    btn.style.setProperty('--r-color', info.color);
    btn.style.setProperty('--r-ink', info.ink);
    btn.style.setProperty('--r-glow', info.glow);
    btn.setAttribute('aria-label', `Carte ${index + 1} sur ${state.deck.length}. Retourner la carte.`);

    const inner = el('span', 'card-inner');
    const tilt = el('span', 'card-tilt');

    /* dos : derriere.png (bleu) recolore selon la couleur de la carte
       (voir .card-back[data-back=...] dans styles.css et assets/derriere-*.jpg).
       Une carte video a toujours le dos vert, quelle que soit sa rarete. */
    const back = el('span', 'card-face card-back');
    back.dataset.back = cardVideoInfo(card) ? 'video' : card.rarity;
    const backTop = el('span', 'back-row');
    backTop.append(el('span', null, 'REFS CARDS'), el('span', null, '✳'));
    const emblem = el('span', 'back-emblem');
    emblem.append(el('i'), el('i'), el('span', 'back-star', '✳'));
    const numStr = String(index + 1).padStart(2, '0');
    const backBottom = el('span', 'back-row bottom');
    backBottom.append(el('span', null, 'UNE SURPRISE T\'ATTEND'), el('span', null, numStr));
    const backNum = el('span', 'back-num', numStr);
    back.append(backTop, emblem, backBottom, backNum);

    /* face : le visuel plein cadre + les surcouches titre / description / id */
    const front = el('span', 'card-face card-front');
    front.append(cardFrame(card, { index, eager: true }));

    tilt.append(back, front);
    inner.append(tilt);
    btn.append(inner);

    // 1er clic : retourne. 2e clic (après 650 ms, pour éviter le double-clic) : carte suivante.
    on(btn, 'click', () => {
      if (!btn.classList.contains('is-top') || btn.classList.contains('is-flying')) return;
      if (btn.classList.contains('is-charging')) {
        if (performance.now() - Number(btn.dataset.chargeAt || 0) > 600 && btn._skipCharge) btn._skipCharge();
        return;
      }
      if (!btn.classList.contains('is-revealed')) revealCard(btn, card);
      else if (!packCinematic && btn.classList.contains('is-flipped') && performance.now() - Number(btn.dataset.flipAt || 0) > 650) {
        sendToRecap(btn, card);
      }
    });

    // Parallaxe : une seule mise à jour de style par frame.
    let tiltRaf = 0;
    let tiltEv = null;
    on(btn, 'pointermove', (e) => {
      if (reduceMotion.matches || e.pointerType === 'touch' || !btn.classList.contains('is-top')) return;
      tiltEv = e;
      if (tiltRaf) return;
      tiltRaf = requestAnimationFrame(() => {
        tiltRaf = 0;
        if (!tiltEv) return;
        const r = stack.getBoundingClientRect(); // la pile ne s'incline pas : mesure stable
        const x = clamp((tiltEv.clientX - r.left) / r.width, 0, 1);
        const y = clamp((tiltEv.clientY - r.top) / r.height, 0, 1);
        btn.style.setProperty('--rx', `${((0.5 - y) * 14).toFixed(1)}deg`);
        btn.style.setProperty('--ry', `${((x - 0.5) * 16).toFixed(1)}deg`);
        btn.style.setProperty('--mx', `${(x * 100).toFixed(0)}%`);
        btn.style.setProperty('--my', `${(y * 100).toFixed(0)}%`);
        btn.style.setProperty('--sx', `${(x * 100).toFixed(0)}%`);
        btn.style.setProperty('--sy', `${(y * 100).toFixed(0)}%`);
        btn.style.setProperty('--ma', `${(100 + x * 160).toFixed(0)}deg`);
        if (!btn.dataset.hovered && btn.classList.contains('is-flipped')) {
          btn.dataset.hovered = '1';
          SFX.tick();
        }
      });
    });

    on(btn, 'keydown', (event) => {
      if (event.key === 'Enter' && btn.classList.contains('is-flipped') && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        openInspect(card);
      }
    });

    on(btn, 'pointerleave', () => {
      delete btn.dataset.hovered;
      btn.style.setProperty('--rx', '0deg');
      btn.style.setProperty('--ry', '0deg');
    });

    on(btn, 'pointerenter', () => {
      if (btn.classList.contains('is-top') && !btn.classList.contains('is-flipped')) SFX.tick();
    });

    return btn;
  }

  /* ---------------------------------------------------------- mise en scène */

  function clearEffects() {
    stage.querySelectorAll('.suspense-layer').forEach((n) => n.remove());
    rays.classList.remove('on');
    tableGlow.removeAttribute('data-rarity');
    app.classList.remove('slow-mo');
  }

  function shakeStage() {
    if (reduceMotion.matches) return;
    stage.classList.remove('shake');
    void stage.offsetWidth;
    stage.classList.add('shake');
  }

  function flashScreen() {
    flash.classList.remove('run');
    void flash.offsetWidth;
    flash.classList.add('run');
  }

  function cardCenter(btn) {
    const r = btn.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    return { x: r.left - s.left + r.width / 2, y: r.top - s.top + r.height / 2, r, s };
  }

  /* ------------------------------------------------------------ suspense
     Plus la rareté est haute, plus la carte « se charge » longtemps avant
     de se retourner : tremblement, anneaux qui convergent, ombre autour de
     la carte, battements de cœur de plus en plus rapides, flash final.
     Un clic après ~0,6 s permet de passer la mise en scène. */
  const SUSPENSE = {
    rare:      { ms: 450,  tier: 1 },
    superrare: { ms: 650,  tier: 1 },
    epic:      { ms: 1000, tier: 2 },
    ultraepic: { ms: 1300, tier: 2 },
    mythic:    { ms: 1700, tier: 3 },
    legendary: { ms: 2100, tier: 3 },
    divine:    { ms: 2600, tier: 4 },
    secret:    { ms: 3200, tier: 4 },
    ultrasecret:{ ms: 3800, tier: 4 },
    hypersecret:{ ms: 4400, tier: 4 },
    unique:    { ms: 5200, tier: 4 }
  };

  function startCharge(btn, info, cx, cy, sus, done) {
    const layer = el('div', 'suspense-layer');
    layer.dataset.tier = String(sus.tier);
    layer.style.setProperty('--x', `${cx.toFixed(0)}px`);
    layer.style.setProperty('--y', `${cy.toFixed(0)}px`);
    layer.style.setProperty('--dur', `${sus.ms}ms`);
    layer.style.setProperty('--c', info.glow);
    layer.append(el('div', 'suspense-dim'));
    for (let i = 0; i < sus.tier + 1; i++) {
      const ring = el('i', 'charge-ring');
      ring.style.animationDelay = `${(i * 0.7 / (sus.tier + 1)).toFixed(2)}s`;
      layer.append(ring);
    }
    stage.append(layer);

    btn.classList.add('is-charging');
    btn.dataset.tier = String(sus.tier);
    btn.dataset.chargeAt = String(performance.now());
    btn.style.setProperty('--cc', info.glow);
    btn.style.setProperty('--dur', `${sus.ms}ms`);
    tableGlow.setAttribute('data-rarity', info.rank >= RARITIES.legendary.rank ? 'legendary' : info.rank >= RARITIES.epic.rank ? 'epic' : 'rare');
    revealKicker.textContent = '✦ ? ✦';
    revealSub.textContent = 'Quelque chose se prépare…';

    const timers = [];
    let gap = 440;
    const beat = () => {
      SFX.tick();
      gap = Math.max(85, gap * 0.8);
      timers.push(window.setTimeout(beat, gap));
    };
    beat();

    let finished = false;
    const finish = () => {
      if (finished) return;
      finished = true;
      timers.forEach((t) => window.clearTimeout(t));
      layer.classList.add('is-out');
      window.setTimeout(() => layer.remove(), 420);
      if (sus.tier >= 3) { flashScreen(); SFX.whoosh(); }
      if (sus.tier >= 4) window.setTimeout(flashScreen, 140);
      done();
    };
    timers.push(window.setTimeout(finish, sus.ms));
    btn._skipCharge = finish;
  }

  /* Mise en scène d'une rareté autour du point (cx, cy) de la scène : bandeau,
     halo de table, particules, secousse/flash et jingle selon le palier. Sert
     à la révélation manuelle et au coup de projecteur de « Ouvrir tout ». */
  function rarityBurst(card, cx, cy, quiet) {
    const info = RARITIES[card.rarity] || RARITIES.common;
    const fx = info.fx || 'calm';
    revealKicker.innerHTML = `<span>✦</span> ${info.label.toUpperCase()} <span>✦</span>`;
    clearEffects();
    tableGlow.setAttribute('data-rarity', card.rarity);
    app.dataset.rarity = card.rarity;

    if (fx === 'calm') {
      if (!quiet) {
        const n = card.rarity === 'common' ? 10 : 18;
        for (let i = 0; i < n; i++) FX.dot(cx, cy, info.glow, { speedMax: 170, g: -20, size: 3, life: 0.8 });
      }
    } else if (fx === 'rare') {
      if (!quiet) {
        FX.ring(cx, cy, info.glow, 190);
        for (let i = 0; i < 26; i++) FX.spark(cx, cy, i % 2 ? '#ffffff' : info.glow, { speedMax: 380, g: 180, size: 2.4 });
        for (let i = 0; i < 12; i++) FX.dot(cx, cy, info.glow, { speedMax: 220, g: -40, size: 4, life: 1 });
      }
    } else if (fx === 'epic') {
      app.classList.add('slow-mo');
      window.setTimeout(() => app.classList.remove('slow-mo'), 1600);
      window.setTimeout(() => {
        shakeStage();
        flashScreen();
        if (!quiet) {
          FX.ring(cx, cy, info.glow, 260);
          for (let i = 0; i < 46; i++) FX.spark(cx, cy, i % 3 ? info.glow : '#ffffff', { speedMax: 560, g: 320, size: 2.8, life: 0.9 });
          for (let i = 0; i < 18; i++) FX.dot(cx, cy, info.glow, { speedMax: 300, g: -60, size: 5, life: 1.4 });
        }
      }, quiet ? 0 : 420);
    } else {
      rays.classList.add('on');
      if (!quiet) {
        FX.ring(cx, cy, '#ffffff', 300);
        FX.rain([info.color, info.glow, '#ffffff', '#ffe9a3'], 90);
        for (let i = 0; i < 60; i++) FX.spark(cx, cy, i % 2 ? info.glow : '#ffffff', { speedMax: 620, g: 260, size: 3, life: 1.1 });
        FX.confetti(cx, cy, [info.color, info.glow, '#ffffff', '#ffe9a3'], 40);
      }
      window.setTimeout(() => { shakeStage(); flashScreen(); }, quiet ? 0 : 260);
    }

    window.setTimeout(() => SFX.rarity(SOUND_FX[fx] || 'common'), quiet ? 0 : fx === 'epic' ? 460 : 150);
  }

  function revealCard(btn, card) {
    if (btn.classList.contains('is-revealed')) return;
    SFX.unlock();
    /* Clic utilisateur : c'est le bon moment pour activer le son des cartes
       vidéo qui le demandent (les navigateurs bloquent l'audio automatique). */
    if (cardVideoInfo(card)) activateCardAudio(btn);
    btn.dataset.flipAt = String(performance.now());
    btn.classList.add('is-revealed');
    const info = RARITIES[card.rarity];
    const c = cardCenter(btn);
    const cx = c.x;
    const cy = c.y;
    const quiet = reduceMotion.matches;

    btn.setAttribute('aria-label', `Carte ${state.deck.indexOf(card) + 1}. ${card.name}, ${info.label}. ${card.description}. Activez le bouton Carte suivante pour continuer.`);
    footRight.textContent = 'CARTE SUIVANTE POUR CONTINUER →';
    nextCard.hidden = false;
    nextCard.textContent = remaining.length === 1 ? 'TERMINER LE BOOSTER →' : 'CARTE SUIVANTE →';

    const burst = () => rarityBurst(card, cx, cy, quiet);
    const doFlip = () => {
      btn.classList.remove('is-charging');
      delete btn._skipCharge;
      btn.dataset.flipAt = String(performance.now());
      btn.classList.add('is-flipped');
      if (!packCinematic) {
        openAll.disabled = false;
        if (remaining.length > 1) openAll.hidden = false;
      }
      burst();
      if (CardMutations.definition(card)) shinyCinematic(card, quiet);
    };
    const sus = quiet ? null : SUSPENSE[card.rarity];
    if (sus) {
      openAll.disabled = true;
      startCharge(btn, info, cx, cy, sus, doFlip);
    } else doFlip();

    const { isNew, reward } = collectPackCard(card);
    addCoins(reward);
    state.packIndex = state.deck.indexOf(card) + 1;
    pileLabel.textContent = `CARTE ${state.packIndex} / ${state.deck.length} · RÉVÉLÉE`;
    revealSub.textContent = info.rank >= RARITIES.legendary.rank
      ? `${info.label.toUpperCase()} ! Touche la carte ou le bouton pour continuer.`
      : 'Touche la carte ou le bouton pour continuer.';
    btn.dataset.isNew = isNew ? '1' : '0';
    if (!isNew) revealSub.textContent += ' Doublon : gain réduit.';
  }

  function collectPackCard(card) {
    /* On compte les exemplaires AVANT d'ajouter la carte : c'est ce nombre
       qui fixe le gain du doublon (voir cardReward). Aucune pièce n'est
       retirée au joueur, seul le gain est ajusté. */
    const ownedBefore = state.collection.reduce((n, owned) => n + (owned.id === card.id ? 1 : 0), 0);
    const isNew = ownedBefore === 0;
    state.collection.push(card);
    if (isNew) { fresh.add(card.id); tabBadge.hidden = false; }
    return { isNew, reward: cardReward(card, ownedBefore) };
  }

  /* ------------------------------------------------------- inspection grand */

  let inspectReturnFocus = null;
  let inspectCardId = null;

  function cardById(id) {
    return (
      state.collection.find((c) => c.id === id) ||
      CardMutations.resolve(id) ||
      null
    );
  }

  function openInspect(card, stat) {
    if (!card) return;
    const oldCount = qs(inspectCard.parentElement, '.insp-count');
    if (oldCount) oldCount.remove();
    const oldOdds = qs(inspectCard.parentElement, '.insp-odds');
    if (oldOdds) oldOdds.remove();
    const info = RARITIES[card.rarity] || RARITIES.common;
    inspectCard.replaceChildren(cardFrame(card, { eager: true, alt: `${card.name} — ${info.label}` }));
    inspectCard.style.setProperty('--r-color', info.color);
    inspectCard.style.setProperty('--r-glow', info.glow);
    inspectCard.dataset.rarity = card.rarity;
    inspectCard.dataset.fx = info.fx || 'calm';
    if (cardVideoInfo(card)) activateCardAudio(inspectCard);
    inspectCardId = card.id;
    const sellBtn = $('inspect-sell');
    if (sellBtn) sellBtn.hidden = !(countMap().get(card.id) > 0);
    resetInspTilt();
    inspectReturnFocus = document.activeElement;
    inspect.hidden = false;
    void inspect.offsetWidth;
    inspect.classList.add('is-open');
    SFX.tick();
    if (stat) {
      const box = el('div', 'insp-count');
      const mk = (cls, n, label, variant) => {
        const cell = el('button', `ic-cell ${cls}`);
        cell.type = 'button';
        cell.append(el('b', null, String(n)), el('small', null, label));
        cell.disabled = !n || !variant;
        if (variant === card) cell.classList.add('is-on');
        on(cell, 'click', () => {
          inspectCard.replaceChildren(cardFrame(variant, { eager: true, alt: `${variant.name} — ${info.label}` }));
          box.querySelectorAll('.ic-cell').forEach((c) => c.classList.toggle('is-on', c === cell));
          if (sellBtn) sellBtn.hidden = !(countMap().get(variant.id) > 0);
          SFX.tick();
        });
        return cell;
      };
      box.append(
        mk('', stat.normal, 'Normale' + (stat.normal > 1 ? 's' : ''), stat.card),
        mk('ic-shiny', stat.shiny, '✦ Shiny', stat.shinyCard)
      );
      inspectCard.parentElement.append(box);
    }
    const shinyRate = CardMutations.definitions.find((mutation) => mutation.id === 'shiny')?.rates[card.rarity] || 0;
    const odds = el('p', 'insp-odds');
    odds.textContent = shinyRate > 0
      ? `✦ Chance de Shiny : 1 sur ${fmt(Math.round(1 / shinyRate))} (sans boost)`
      : '✦ Chance de Shiny indisponible';
    odds.setAttribute('aria-label', odds.textContent);
    inspectCard.parentElement.append(odds);
    inspectX.focus({ preventScroll: true });
  }

  function closeInspect() {
    if (inspect.hidden) return;
    inspectCardId = null;
    const sellBtn = $('inspect-sell');
    if (sellBtn) sellBtn.hidden = true;
    inspect.classList.remove('is-open');
    window.setTimeout(() => {
      if (!inspect.classList.contains('is-open')) {
        inspect.hidden = true;
        inspectCard.replaceChildren();
      }
    }, 260);
    if (inspectReturnFocus && inspectReturnFocus.focus) inspectReturnFocus.focus({ preventScroll: true });
    inspectReturnFocus = null;
  }

  on(inspectX, 'click', closeInspect);
  on(inspectBackdrop, 'click', closeInspect);
  on($('inspect-sell'), 'click', () => { if (inspectCardId) quickSellCard(inspectCardId); });

  /* ----------------------------------------------------------- vers le butin */

  let flying = false;

  on(nextCard, 'click', () => {
    if (state.phase !== 'reveal' || !current || flying || packCinematic) return;
    if (!current.node.classList.contains('is-flipped')) return;
    sendToRecap(current.node, current.data);
  });

  on(openAll, 'click', () => {
    /* Pendant la cascade, le même bouton devient « Passer ». */
    if (openingAll) { skipOpenAll(); return; }
    if (state.phase !== 'reveal' || openAll.hidden || openAll.disabled || flying || !current) return;
    SFX.unlock();

    /* Rareté au-dessus de Divine encore cachée dans la pile : « Ouvrir tout »
       joue quand même sa mise en scène (retournement + suspense de son rang +
       effet), puis le reste du pack s'ouvre en cascade. */
    const hiddenTop = remaining
      .filter(({ node }) => !node.classList.contains('is-revealed'))
      .map(({ data }) => data)
      .filter((data) => RARITIES[data.rarity] && RARITIES[data.rarity].rank > RARITIES.divine.rank)
      .sort((a, b) => RARITIES[b.rarity].rank - RARITIES[a.rarity].rank)[0];
    if (hiddenTop) {
      cinematicOpenAll(hiddenTop);
      return;
    }
    openAllCascade();
  });

  /* Une carte au-dessus de Divine encore cachée : elle passe devant, se
     retourne avec son suspense habituel, puis le reste du pack est ouvert. */
  let packCinematic = false;

  function cinematicOpenAll(card) {
    const item = remaining.find((r) => r.data === card);
    if (!item) { openAllCascade(); return; }
    packCinematic = true;
    openAll.disabled = true;
    nextCard.hidden = true;
    if (current && current.node !== item.node) current.node.classList.remove('is-top');
    remaining = [item, ...remaining.filter((r) => r !== item)];
    remaining.forEach((r, i) => {
      r.node.style.setProperty('--depth', i);
      r.node.classList.toggle('is-top', r === item);
    });
    current = item;
    const startedAt = performance.now();
    window.setTimeout(() => {
      revealCard(item.node, item.data);
      const waitFlip = () => {
        if (state.phase !== 'reveal' || performance.now() - startedAt > 14000) {
          packCinematic = false;
          if (state.phase === 'reveal') finishOpenAllPack();
          return;
        }
        if (!item.node.classList.contains('is-flipped')) {
          window.setTimeout(waitFlip, 120);
          return;
        }
        openAll.disabled = true;
        nextCard.hidden = true;
        window.setTimeout(() => {
          packCinematic = false;
          if (state.phase === 'reveal') openAllCascade();
        }, reduceMotion.matches ? 200 : 900);
      };
      waitFlip();
    }, reduceMotion.matches ? 30 : 420);
  }

  /* ------------------------------------------ « Ouvrir tout » : la cascade
     Au lieu de faire disparaître la pile d'un coup, les cartes restantes
     s'étalent sur la table, se retournent une à une (de la moins rare à la
     plus rare, qui reçoit sa mise en scène de rareté), puis filent chacune
     vers leur case du butin avant l'affichage du récap. Le bouton « Passer »,
     un toucher sur la table, Entrée, Espace ou Échap sautent directement à
     la fin ; « réduire les animations » garde l'ouverture instantanée. */
  const OPEN_ALL_LABEL = openAll ? openAll.innerHTML : '';
  const SKIP_GRACE_MS = 500; // un double-clic sur « Ouvrir tout » ne doit pas passer la cascade
  let openingAll = false;
  let cascadeStartedAt = 0;
  let cascadeTimers = [];
  let cascadeToken = 0;

  function cascadeLater(fn, ms) {
    const token = cascadeToken;
    cascadeTimers.push(window.setTimeout(() => {
      if (token !== cascadeToken || !openingAll || state.phase !== 'reveal') return;
      try { fn(); } catch (err) { console.error(err); }
    }, ms));
  }

  function clearCascade() {
    cascadeToken++;
    cascadeTimers.forEach((t) => window.clearTimeout(t));
    cascadeTimers = [];
    if (!openingAll) return;
    openingAll = false;
    stack.classList.remove('is-fan');
    openAll.classList.remove('is-skip');
    openAll.innerHTML = OPEN_ALL_LABEL;
  }

  const rarityRank = (card) => (RARITIES[card && card.rarity] || RARITIES.common).rank;

  /* Répartition des cartes sur la table : on essaie chaque nombre de colonnes
     et on garde celui qui laisse les cartes les plus grandes (une rangée sur
     grand écran, deux ou trois sur mobile). Les positions sont relatives au
     centre de la pile ; une légère courbe en éventail donne du relief. */
  function fanLayout(count) {
    const cardW = stack.clientWidth || stack.offsetWidth || 240;
    const cardH = stack.clientHeight || stack.offsetHeight || cardW * 1.4;
    const tw = tableEl.clientWidth || cardW * 1.1;
    const th = tableEl.clientHeight || cardH * 1.05;
    const gapX = Math.max(6, Math.round(tw * 0.016));
    const gapY = 10;
    let best = null;
    for (let cols = 1; cols <= count; cols++) {
      const rows = Math.ceil(count / cols);
      const fitW = (tw * 0.96 - gapX * (cols - 1)) / (cols * cardW);
      const fitH = (th * 0.98 - gapY * (rows - 1)) / (rows * cardH);
      const scale = Math.min(fitW, fitH);
      if (!best || scale > best.scale + 0.01) best = { cols, rows, scale };
    }
    const scale = clamp(best.scale, 0.16, 0.9);
    const stepX = cardW * scale + gapX;
    const stepY = cardH * scale + gapY;
    const slots = [];
    for (let i = 0; i < count; i++) {
      const row = Math.floor(i / best.cols);
      const col = i % best.cols;
      const inRow = Math.min(best.cols, count - row * best.cols);
      const cx = col - (inRow - 1) / 2;
      slots.push({
        x: cx * stepX,
        y: (row - (best.rows - 1) / 2) * stepY + Math.abs(cx) * Math.min(6, stepY * 0.03),
        r: inRow > 1 ? cx * Math.min(4, 10 / inRow) : 0
      });
    }
    return { scale, slots, cols: best.cols, rows: best.rows };
  }

  function openAllCascade() {
    if (openingAll) return;
    const items = remaining.slice().sort((a, b) => rarityRank(a.data) - rarityRank(b.data));
    if (!items.length || reduceMotion.matches) { finishOpenAllPack(); return; }
    openingAll = true;
    cascadeStartedAt = performance.now();
    packCinematic = true;
    openAll.hidden = false;
    openAll.disabled = false;
    openAll.classList.add('is-skip');
    openAll.innerHTML = '<span aria-hidden="true">⏭</span> Passer';
    nextCard.hidden = true;
    setRecapCollapsed(false);
    clearEffects();

    const n = items.length;
    const total = state.deck.length;
    const layout = fanLayout(n);
    revealKicker.innerHTML = '<span>✦</span> OUVERTURE COMPLÈTE <span>✦</span>';
    revealTitle.innerHTML = 'Tout le pack<em>.</em>';
    revealSub.textContent = 'Les cartes se retournent… Touche la table pour passer.';
    footRight.textContent = `✦ ${n} CARTE${n > 1 ? 'S' : ''} D'UN COUP`;
    /* Cartes déjà face visible : celles rangées dans le butin + celle du
       dessus si elle était déjà retournée. */
    let faceUp = total - n + items.filter(({ node }) => node.classList.contains('is-revealed')).length;
    const pileText = () => `${Math.min(faceUp, total)} / ${total} RÉVÉLÉE${faceUp > 1 ? 'S' : ''}`;
    pileLabel.textContent = pileText();

    /* 1. Éventail : la pile s'étale, carte par carte. */
    stack.classList.add('is-fan');
    const fanStep = n > 6 ? 45 : 60;
    items.forEach((item, i) => {
      const { node } = item;
      const p = layout.slots[i];
      node.classList.remove('is-top', 'is-incoming', 'is-ejecting');
      node.style.setProperty('--fan-i', String(i));
      node.style.setProperty('--fan-x', `${p.x.toFixed(1)}px`);
      node.style.setProperty('--fan-y', `${p.y.toFixed(1)}px`);
      node.style.setProperty('--fan-r', `${p.r.toFixed(1)}deg`);
      node.style.setProperty('--fan-s', layout.scale.toFixed(3));
      node.style.setProperty('--fan-delay', `${i * fanStep}ms`);
      node.classList.add('is-fanned');
      cascadeLater(() => SFX.deal(), 40 + i * fanStep);
    });

    /* 2. Retournements en cascade, de la moins rare à la plus rare. */
    const fanDone = 560 + (n - 1) * fanStep;
    const flipStep = n > 6 ? 120 : 170;
    items.forEach((item, i) => {
      cascadeLater(() => {
        item.node.style.setProperty('--fan-delay', '0ms');
        if (cascadeFlip(item)) faceUp++;
        pileLabel.textContent = pileText();
      }, fanDone + i * flipStep);
    });

    /* 3. Coup de projecteur sur la plus rare du lot. */
    const best = items[n - 1];
    const bestInfo = RARITIES[best.data.rarity] || RARITIES.common;
    const bestAt = fanDone + (n - 1) * flipStep + 420;
    cascadeLater(() => cascadeSpotlight(best), bestAt);

    /* 4. Envol vers le butin, puis le récap. */
    const hold = bestInfo.fx === 'gold' ? 1500 : bestInfo.fx === 'epic' ? 1250 : 950;
    const flyAt = bestAt + hold;
    const flyStep = n > 6 ? 70 : 90;
    const firstSlot = state.loot.length;
    items.forEach((item, i) => cascadeLater(() => cascadeFly(item, firstSlot + i, i), flyAt + i * flyStep));
    cascadeLater(finishOpenAllPack, flyAt + (n - 1) * flyStep + 720);
  }

  /* Retourne une carte de la cascade (comptée comme en révélation manuelle)
     et renvoie true si elle n'était pas encore face visible. */
  function cascadeFlip(item) {
    const { node, data } = item;
    const info = RARITIES[data.rarity] || RARITIES.common;
    const firstTime = !node.classList.contains('is-revealed');
    if (firstTime) {
      node.classList.add('is-revealed');
      const { isNew, reward } = collectPackCard(data);
      addCoins(reward);
      node.dataset.isNew = isNew ? '1' : '0';
      if (CardMutations.definition(data)) shinyCinematic(data, false);
    }
    if (!node.classList.contains('is-flipped')) {
      node.dataset.flipAt = String(performance.now());
      node.classList.add('is-flipped');
    }
    node.setAttribute('aria-label', `${data.name}, ${info.label}.`);

    const c = cardCenter(node);
    const fx = info.fx || 'calm';
    const count = fx === 'calm' ? 8 : fx === 'rare' ? 14 : 22;
    for (let k = 0; k < count; k++) {
      FX.dot(c.x, c.y, k % 3 === 2 ? '#ffffff' : info.glow, { speedMax: 150 + count * 6, g: -30, size: fx === 'calm' ? 3 : 4, life: 0.75 });
    }
    if (fx !== 'calm') FX.ring(c.x, c.y, info.glow, Math.max(70, c.r.width * 0.9));
    if (fx === 'epic' || fx === 'gold') {
      for (let k = 0; k < 14; k++) FX.spark(c.x, c.y, k % 2 ? '#ffffff' : info.glow, { speedMax: 320, g: 200, size: 2.4 });
    }
    SFX.tick();
    return firstTime;
  }

  function cascadeSpotlight(item) {
    const { node, data } = item;
    const info = RARITIES[data.rarity] || RARITIES.common;
    node.classList.add('is-best');
    const s = parseFloat(node.style.getPropertyValue('--fan-s')) || 1;
    const y = parseFloat(node.style.getPropertyValue('--fan-y')) || 0;
    node.style.setProperty('--fan-s', (s * 1.12).toFixed(3));
    node.style.setProperty('--fan-y', `${(y - 8).toFixed(1)}px`);
    node.style.setProperty('--fan-r', '0deg');
    const c = cardCenter(node);
    rarityBurst(data, c.x, c.y, false);
    revealTitle.replaceChildren(document.createTextNode(data.name), el('em', null, '.'));
    revealSub.textContent = `La plus rare du pack · ${info.label}`;
  }

  function cascadeFly(item, slotIndex, i) {
    const { node, data } = item;
    const slot = recapSlots.children[slotIndex] || recapSlots.lastElementChild;
    const base = stack.getBoundingClientRect();
    const to = slot ? slot.getBoundingClientRect() : null;
    node.classList.remove('is-fanned', 'is-best');
    let dx = 0;
    let dy = 60;
    let s = 0.25;
    if (to && base.width > 0 && to.width > 0) {
      dx = to.left + to.width / 2 - (base.left + base.width / 2);
      dy = to.top + to.height / 2 - (base.top + base.height / 2);
      s = Math.max(0.12, to.width / base.width);
    }
    node.style.setProperty('--fly-x', `${dx.toFixed(1)}px`);
    node.style.setProperty('--fly-y', `${dy.toFixed(1)}px`);
    node.style.setProperty('--fly-s', s.toFixed(3));
    node.classList.add('is-flying');
    if (i % 2 === 0) SFX.whoosh();
    cascadeLater(() => {
      fillSlot(slotIndex, data);
      recapCount.textContent = `${Math.min(slotIndex + 1, state.deck.length)} / ${state.deck.length}`;
      detachCardNode(node);
    }, 600);
  }

  function detachCardNode(node) {
    node.querySelectorAll('video').forEach((video) => {
      cardVideoObserver?.unobserve(video);
      if (!video.paused) video.pause();
    });
    node.remove();
  }

  function skipOpenAll() {
    if (!openingAll) return;
    if (performance.now() - cascadeStartedAt < SKIP_GRACE_MS) return;
    SFX.unlock();
    finishOpenAllPack();
  }

  function finishOpenAllPack() {
    clearCascade();
    packCinematic = false;
    openAll.disabled = true;
    let reward = 0;
    const newOnes = [];
    for (const { data, node } of remaining) {
      // La carte affichée (ou révélée par la mise en scène) est déjà comptée.
      if (!node.classList.contains('is-revealed')) {
        const got = collectPackCard(data);
        reward += got.reward;
        node.dataset.isNew = got.isNew ? '1' : '0';
      }
      if (node.dataset.isNew === '1') newOnes.push(data);
      state.loot.push(data);
    }
    addCoins(reward);
    state.packIndex = state.deck.length;
    stack.querySelectorAll('video').forEach((video) => {
      cardVideoObserver?.unobserve(video);
      if (!video.paused) video.pause();
    });
    stack.replaceChildren();
    remaining = [];
    current = null;
    finishPack();
    /* L'onglet Collection réagit une fois pour toutes les nouvelles cartes,
       juste après le jingle de fin pour ne pas s'y superposer. */
    if (newOnes.length && !reduceMotion.matches) window.setTimeout(() => bumpCollectionTab(newOnes), 350);
  }

  on(tableEl, 'click', (event) => {
    if (openingAll) { skipOpenAll(); return; }
    if (event.target.closest('.card') || !current || flying || packCinematic || state.phase !== 'reveal') return;
    if (!current.node.classList.contains('is-top') || !current.node.classList.contains('is-flipped')) return;
    sendToRecap(current.node, current.data);
  });

  /* ------------------------------------------- effets : nouvelle carte & shiny */

  /* Étincelle DOM (indépendante du canvas) animée par WAAPI. */
  function domSpark(x, y, color, spread = 70, life = 650) {
    const p = el('i', 'fx-spark');
    p.style.cssText = `left:${x}px;top:${y}px;background:${color};box-shadow:0 0 10px ${color}`;
    document.body.append(p);
    const a = Math.random() * Math.PI * 2;
    const d = spread * (0.4 + Math.random() * 0.8);
    const anim = p.animate([
      { transform: 'translate(-50%,-50%) scale(1)', opacity: 1 },
      { transform: `translate(calc(-50% + ${Math.cos(a) * d}px), calc(-50% + ${Math.sin(a) * d}px)) scale(0.1)`, opacity: 0 }
    ], { duration: life, easing: 'cubic-bezier(.2,.8,.3,1)', fill: 'forwards' });
    anim.onfinish = () => p.remove();
  }

  /* Nouvelle carte : elle quitte la pile, tourne sur elle-même, rétrécit et
     file jusqu'à l'icône Collection de la barre du bas, qui réagit. */
  function flyToCollection(btn, card) {
    const tab = document.querySelector('.tab[data-tab="collection"]');
    const icon = tab && (tab.querySelector('svg') || tab);
    if (!icon) return false;
    const from = btn.getBoundingClientRect();
    const to = icon.getBoundingClientRect();
    if (!from.width) return false;
    const info = RARITIES[card.rarity] || RARITIES.common;
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const end = Math.max(0.06, 26 / from.width);
    const ghost = el('div', 'coll-ghost');
    ghost.style.cssText = `left:${from.left}px;top:${from.top}px;width:${from.width}px;height:${from.height}px;--g:${info.glow}`;
    ghost.append(cardFrame(card, { eager: true, alt: '' }));
    document.body.append(ghost);
    btn.style.visibility = 'hidden';
    const T = (x, y, sc, ry, rz) => `translate(${x}px,${y}px) perspective(900px) rotateY(${ry}deg) rotate(${rz}deg) scale(${sc})`;
    const anim = ghost.animate([
      { transform: T(0, 0, 1, 0, 0), opacity: 1, offset: 0 },
      { transform: T(dx * 0.04, -48, 1.14, 200, -8), opacity: 1, offset: 0.22 },
      { transform: T(dx * 0.62, dy * 0.55 - 40, 0.5, 760, 10), opacity: 1, offset: 0.68 },
      { transform: T(dx, dy, end, 1440, 0), opacity: 0.85, offset: 1 }
    ], { duration: 1150, easing: 'cubic-bezier(.55,.05,.25,1)', fill: 'forwards' });
    const trail = window.setInterval(() => {
      const r = ghost.getBoundingClientRect();
      domSpark(r.left + r.width / 2, r.top + r.height / 2, Math.random() < 0.5 ? info.glow : '#ffffff', 36, 520);
    }, 40);
    anim.onfinish = () => {
      window.clearInterval(trail);
      ghost.remove();
      landOnCollection(to, tab, info);
    };
    return true;
  }

  function landOnCollection(rect, tab, info, text = '✦ Nouvelle carte !') {
    const x = rect.left + rect.width / 2;
    const y = rect.top + rect.height / 2;
    try { SFX.coin(); } catch (e) { /* son indisponible */ }
    for (let i = 0; i < 18; i++) domSpark(x, y, i % 3 ? info.glow : '#ffffff', 64, 700);
    const ring = el('i', 'fx-ring');
    ring.style.cssText = `left:${x}px;top:${y}px;--g:${info.glow}`;
    document.body.append(ring);
    window.setTimeout(() => ring.remove(), 700);
    const label = el('span', 'fx-float', text);
    label.style.cssText = `left:${x}px;top:${rect.top - 8}px`;
    document.body.append(label);
    window.setTimeout(() => label.remove(), 1400);
    if (tab) {
      tab.classList.remove('is-bump');
      void tab.offsetWidth;
      tab.classList.add('is-bump');
      window.setTimeout(() => tab.classList.remove('is-bump'), 800);
    }
  }

  /* « Ouvrir tout » : les nouvelles cartes n'ont pas volé une par une vers
     la Collection ; l'onglet réagit une seule fois pour tout le lot, aux
     couleurs de la plus rare d'entre elles. */
  function bumpCollectionTab(cards) {
    const tab = document.querySelector('.tab[data-tab="collection"]');
    const icon = tab && (tab.querySelector('svg') || tab);
    if (!icon || !cards.length) return false;
    const rect = icon.getBoundingClientRect();
    if (!rect.width) return false;
    const top = cards.reduce((a, b) => (rarityRank(b) > rarityRank(a) ? b : a), cards[0]);
    const info = RARITIES[top.rarity] || RARITIES.common;
    landOnCollection(rect, tab, info, cards.length > 1 ? `✦ ${cards.length} nouvelles cartes !` : '✦ Nouvelle carte !');
    return true;
  }

  /* Cinématique shiny : voile sombre, rayons dorés qui tournent, éclat,
     pluie d'étoiles et titre. Un toucher la ferme. */
  function shinyCinematic(card, quiet) {
    const ov = el('div', 'shiny-cine' + (quiet ? ' is-quiet' : ''));
    ov.setAttribute('role', 'status');
    ov.append(el('div', 'sc-rays'), el('div', 'sc-flare'));
    for (let i = 0; i < (quiet ? 0 : 34); i++) {
      const star = el('i', 'sc-star', i % 3 ? '✦' : '✧');
      star.style.cssText = `left:${(Math.random() * 100).toFixed(1)}%;top:${(Math.random() * 100).toFixed(1)}%;font-size:${(10 + Math.random() * 20).toFixed(0)}px;animation-delay:${(Math.random() * 1.6).toFixed(2)}s`;
      ov.append(star);
    }
    const text = el('div', 'sc-text');
    text.append(el('p', 'sc-kicker', '✦ MUTATION RARE ✦'), el('h2', 'sc-title', 'SHINY !'), el('p', 'sc-name', card.name));
    ov.append(text);
    document.body.append(ov);
    try { SFX.rarity('legendary'); } catch (e) { /* son indisponible */ }
    if (!quiet) { try { shakeStage(); flashScreen(); } catch (e) { /* effets indisponibles */ } }
    let closed = false;
    const close = () => {
      if (closed) return;
      closed = true;
      ov.classList.add('is-out');
      window.setTimeout(() => ov.remove(), 600);
    };
    ov.addEventListener('click', close);
    window.setTimeout(close, quiet ? 1500 : 3000);
  }

  function sendToRecap(btn, card) {
    if (flying) return;
    flying = true;
    nextCard.hidden = true;
    openAll.disabled = true;
    const restoreFocus = document.activeElement === nextCard || document.activeElement === btn;
    SFX.whoosh();
    btn.classList.remove('is-incoming');
    const target = recapSlots.children[state.loot.length] || recapSlots.lastElementChild;
    const from = btn.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const s = Math.max(0.16, to.width / from.width);

    const toCollection = btn.dataset.isNew === '1' && !reduceMotion.matches && flyToCollection(btn, card);
    if (!toCollection) {
      btn.classList.add('is-flying');
      btn.style.setProperty('--fly-x', `${dx.toFixed(1)}px`);
      btn.style.setProperty('--fly-y', `${dy.toFixed(1)}px`);
      btn.style.setProperty('--fly-s', s.toFixed(3));
    }

    window.setTimeout(() => {
      flying = false; // libéré d'abord : une erreur plus bas ne peut plus bloquer le jeu
      openAll.disabled = false;
      try {
      setRecapCollapsed(false);
      fillSlot(state.loot.length, card);
      state.loot.push(card);
      recapCount.textContent = `${state.loot.length} / ${state.deck.length}`;
      btn.remove();
      remaining.shift();
      advanceStack();
      if (restoreFocus && current) current.node.focus({ preventScroll: true });
      if (!remaining.length) finishPack();
      else updateHintForNext();
      } catch (err) { console.error(err); }
    }, reduceMotion.matches ? 120 : 640);
  }

  /* Fond de secours par rareté (utilisé quand la carte n'a pas d'image). */
  const RARITY_BG = Object.fromEntries(
    Object.entries(RARITIES).map(([key, r]) => [key, `linear-gradient(165deg, ${r.color}, ${r.glow})`])
  );

  function setRecapCollapsed(collapsed) {
    recap.classList.toggle('is-collapsed', collapsed);
    // La scène de révélation lui laisse la place : plus de chevauchement.
    const apply = () => {
      const hidden = collapsed || recap.classList.contains('is-idle');
      stage.style.setProperty('--recap-h', hidden ? '0px' : `${Math.max(72, recap.offsetHeight)}px`);
      sizeStage();
    };
    requestAnimationFrame(apply);
    scheduleSizing(24);
    window.setTimeout(apply, 420);
    recapToggle.setAttribute('aria-expanded', String(!collapsed));
    recapToggleLabel.textContent = collapsed ? 'VOIR' : 'MASQUER';
    recapToggle.setAttribute(
      'aria-label',
      collapsed ? 'Afficher la barre récapitulative' : 'Réduire la barre récapitulative'
    );
  }

  function fillSlot(index, card) {
    const slot = recapSlots.children[index];
    if (!slot) return;
    const info = RARITIES[card.rarity] || RARITIES.common;
    slot.classList.add('is-filled', 'is-new');
    slot.style.setProperty('--slot-color', info.glow);
    slot.dataset.rarity = card.rarity;
    slot.replaceChildren();
    const mini = el('span', 'slot-mini');
    mini.style.setProperty('--slot-bg', RARITY_BG[card.rarity] || RARITY_BG.common);
    mini.append(cardFrame(card, { mini: true, alt: `${card.name} — ${info.label}` }));
    slot.append(mini);
    slot.dataset.cardId = card.id;
    slot.tabIndex = 0;
    slot.setAttribute('role', 'button');
    slot.setAttribute('aria-label', `Voir ${card.name} (${info.label}) en grand`);
    window.setTimeout(() => slot.classList.remove('is-new'), 1000);
  }

  /* ------------------------------------------------------------- pile & tour */

  let remaining = [];
  let current = null;

  function showReveal(packType) {
    hidePackOpening();
    stage.classList.remove('ultra-shake');
    if (!cardsDatabase.some((c) => RARITIES[c.rarity])) {
      state.phase = 'pack';
      showToast('Ajoute au moins une carte valide dans cards.js.');
      return false;
    }
    nextCard.hidden = true;
    const boostMode = packType === 'ultra' ? 'ultra' : packType === 'rare';
    state.deck = drawPack(
      boostMode,
      packPool(packType),
      packType
    );
    if (!state.deck.length) {
      /* Pool vide (ex. Pack Vidéo sans aucune carte configurée) : on reste
         sur l'écran du booster au lieu d'ouvrir une pile vide. */
      state.phase = 'pack';
      showToast(packType === 'video'
        ? 'Ajoute au moins une carte vidéo dans cards.js (bloc « video »).'
        : 'Aucune carte à tirer.');
      return false;
    }
    packView.hidden = true;
    revealView.hidden = false;
    revealView.dataset.packType = packType;
    revealView.classList.remove('view-in');
    void revealView.offsetWidth;
    revealView.classList.add('view-in');

    recap.classList.remove('is-idle');
    setRecapCollapsed(false);
    state.loot = [];
    state.packIndex = 0;
    recapCount.textContent = `0 / ${state.deck.length}`;
    const slotCount = state.deck.length;
    while (recapSlots.children.length < slotCount) {
      const slot = document.createElement('span');
      slot.className = 'slot';
      recapSlots.append(slot);
    }
    while (recapSlots.children.length > slotCount) recapSlots.removeChild(recapSlots.lastElementChild);
    [...recapSlots.children].forEach((s) => {
      s.className = 'slot';
      s.style.removeProperty('--slot-color');
      delete s.dataset.rarity;
      delete s.dataset.cardId;
      s.removeAttribute('role');
      s.removeAttribute('aria-label');
      s.removeAttribute('tabindex');
      s.replaceChildren();
    });
    revealKicker.innerHTML = packType === 'classic'
      ? '<span>✦</span> BOOSTER OUVERT <span>✦</span>'
      : `<span>✦</span> PACK ${packOpeningFor(packType).title} OUVERT <span>✦</span>`;
    revealTitle.innerHTML = 'La pile est prête<em>.</em>';
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    footRight.textContent = '← LA PLUS RARE EST AU FOND';
    pileLabel.textContent = `CARTE 1 / ${state.deck.length}`;
    buyBtn.hidden = true;
    fusionChip.hidden = true;
    recapMsg.textContent = '';
    clearEffects();
    rays.classList.remove('on');

    const dealStep = packType === 'ultra' ? 110 : 80;
    stack.replaceChildren();
    state.deck.forEach((card, i) => {
      const node = buildCard(card, i);
      node.classList.add('is-ejecting');
      if (packType === 'ultra') node.classList.add('is-ultra-ejecting');
      node.style.setProperty('--eject-delay', `${reduceMotion.matches ? 0 : i * dealStep}ms`);
      stack.append(node);
      if (!reduceMotion.matches) {
        window.setTimeout(() => SFX.deal(), 260 + i * dealStep);
      }
    });

    remaining = state.deck.map((data, i) => ({ data, node: stack.children[i] }));
    sizeStage();
    scheduleSizing(10);
    current = remaining[0];
    window.setTimeout(() => current && current.node.classList.add('is-top'), reduceMotion.matches ? 10 : 420);
    state.phase = 'reveal';
    return true;
  }

  function advanceStack() {
    remaining.forEach((item, i) => item.node.style.setProperty('--depth', i));
    current = remaining[0] || null;
    if (!current) return;
    current.node.classList.add('is-top', 'is-incoming');
    const incoming = current.node;
    window.setTimeout(() => incoming.classList.remove('is-incoming'), 600);
    const total = state.deck.length;
    pileLabel.textContent = `CARTE ${Math.min(state.packIndex + 1, total)} / ${total}`;
  }

  function updateHintForNext() {
    if (!current) return;
    revealTitle.innerHTML = 'La pile est prête<em>.</em>';
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    clearEffects();
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    footRight.textContent = '← LA PLUS RARE EST AU FOND';
    revealKicker.innerHTML = '<span>✦</span> BOOSTER OUVERT <span>✦</span>';
    const total = state.deck.length;
    pileLabel.textContent = `CARTE ${total - remaining.length + 1} / ${total}`;
  }

  function updateNextPackAction() {
    const type = revealView.dataset.packType;
    const count = state.packStock[type] || 0;
    nextPack.hidden = count <= 0;
    buyBtn.hidden = count > 0;
    recapMsg.textContent = count > 0
      ? `En inventaire : ${count} × pack ${packLabelFr(type)}`
      : `Plus de pack ${packLabelFr(type)} en inventaire.`;
  }

  function finishPack() {
    state.phase = 'done';
    clearEffects();
    openAll.hidden = true;
    nextCard.hidden = true;
    revealTitle.innerHTML = 'Butin complet<em>.</em>';
    revealSub.textContent = state.loot.length === 1
      ? '1 carte obtenue'
      : `${state.loot.length} cartes · De la plus rare à la plus commune`;
    revealKicker.innerHTML = '<span>✦</span> BOOSTER TERMINÉ <span>✦</span>';
    recapCount.textContent = `${state.loot.length} / ${state.deck.length}`;

    const sorted = [...state.loot].sort((a, b) => RARITIES[b.rarity].rank - RARITIES[a.rarity].rank);
    packResultsGrid.replaceChildren(...sorted.map((card, index) => {
      const info = RARITIES[card.rarity];
      const item = el('li', 'pack-result');
      item.style.setProperty('--result-order', index);
      item.style.setProperty('--result-color', info.color);
      if (index === 0) item.append(el('span', 'pack-result-badge', '✦ LA PLUS RARE ✦'));
      const preview = el('button', 'pack-result-card');
      preview.type = 'button';
      preview.setAttribute('aria-label', `Voir ${card.name} (${info.label}) en grand`);
      preview.append(cardFrame(card, { disableVideo: true, eager: index === 0 }));
      on(preview, 'click', () => openInspect(card));
      item.append(preview);
      return item;
    }));
    revealView.classList.add('is-results');
    recap.classList.add('is-results');
    packResults.hidden = false;
    packResults.scrollTop = 0;
    updateNextPackAction();
    renderInventory();
    updateFusionChip();
    setRecapCollapsed(false);
    SFX.coin();
    if (app.dataset.tab === 'pack') revealTitle.focus({ preventScroll: true });

    // Seule la démo de fusion ouvre encore cette fenêtre automatiquement.
    if (new URLSearchParams(window.location.search).get('demo') === 'fusion' && fusionCount() > 0) {
      const finishedDeck = state.deck;
      window.setTimeout(() => {
        if (state.phase === 'done' && state.deck === finishedDeck && app.dataset.tab === 'pack' && inspect.hidden) openFusion();
      }, reduceMotion.matches ? 260 : 1250);
    }
  }

  on(nextPack, 'click', () => {
    const type = revealView.dataset.packType;
    if (state.phase !== 'done' || !isPackType(type)) return;
    if (!(state.packStock[type] > 0)) { updateNextPackAction(); return; }
    resetToPack({ quiet: true });
    selectPackType(type, { silent: true });
    autoTear();
  });

  /* --------------------------------------------------------------- achat
     L'ancien achat direct (100 🪙 depuis le récap) est remplacé par le Shop :
     buyPack() ne fait plus que naviguer vers la boutique. Les achats réels
     passent par buyPacks() (quantité, inventaire). */

  function buyPack() {
    SFX.unlock();
    if (state.phase !== 'done') return;
    SFX.tick();
    setTab('shop');
  }

  function resetToPack({ quiet = false } = {}) {
    state.phase = 'pack';
    recap.classList.remove('is-results');
    revealView.classList.remove('is-results');
    packResults.hidden = true;
    packResultsGrid.replaceChildren();
    openAll.hidden = true;
    openAll.disabled = false;
    nextPack.hidden = true;
    recap.classList.add('is-idle');
    setRecapCollapsed(false);
    buyBtn.hidden = true;
    fusionChip.hidden = true;
    recapMsg.textContent = '';
    revealView.hidden = true;
    packView.hidden = false;
    packView.classList.remove('view-out');
    packView.classList.remove('view-in');
    void packView.offsetWidth;
    packView.classList.add('view-in');

    pack.classList.remove('is-ripped', 'is-ultra-ripped', 'is-pack-ripped', 'is-dragging');
    delete pack.dataset.packType;
    pack.style.transform = '';
    packFlap.classList.remove('is-gone');
    packFlap.style.transform = '';
    hidePackOpening();
    stage.classList.remove('ultra-shake');
    delete revealView.dataset.packType;
    resetTear();
    clearEffects();
    flash.classList.remove('run');
    clearCascade();
    stack.replaceChildren();
    remaining = [];
    current = null;
    packCinematic = false;

    revealTitle.innerHTML = 'La pile est prête<em>.</em>';
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    if (!quiet) SFX.deal();
    scheduleSizing(10);
    if (!quiet && !state.packStock[state.currentPackType] && packTotal() > 0) {
      selectPackType(firstAvailablePackType());
    }
    renderPackInventory();
    if (!quiet) showToast(packTotal() > 0
      ? 'Nouveau booster ! Glisse vers la droite pour déchirer.'
      : 'Aucun booster', 2800);
  }

  /* --------------------------------------------------------------- fusion */

  function countMap() {
    const map = new Map();
    for (const card of state.collection) map.set(card.id, (map.get(card.id) || 0) + 1);
    return map;
  }

  function fusableEntries() {
    const map = countMap();
    const seen = new Set();
    const list = [];
    for (const card of state.collection) {
      if (seen.has(card.id)) continue;
      seen.add(card.id);
      const count = map.get(card.id);
      const info = RARITIES[card.rarity];
      if (count >= 2 && canFuseInto(info) && cardsDatabase.some((c) => c.rarity === info.next)) {
        list.push({ card, count });
      }
    }
    return list;
  }

  function fusionCount() {
    return fusableEntries().length;
  }

  function updateFusionChip() {
    const n = fusionCount();
    const locked = state.phase === 'pack' || state.phase === 'tearing' || state.loot.length === 0;
    fusionChip.hidden = locked;
    fusionChip.classList.toggle('has-doubles', n > 0);
    fusionChip.title = n
      ? `${n} doublon${n > 1 ? 's' : ''} prêt${n > 1 ? 's' : ''} à fusionner`
      : 'Aucun doublon fusionnable pour le moment';
    // La demande de fusion reste accessible depuis la Collection, même après
    // avoir refermé le récap d'un pack : c'est là que vivent les doublons.
    if (collFusion) {
      collFusion.hidden = n === 0;
      if (collFusionLabel) {
        collFusionLabel.textContent = n
          ? `DEMANDE DE FUSION · ${n} DOUBLON${n > 1 ? 'S' : ''}`
          : 'DEMANDE DE FUSION';
      }
    }
  }

  function openFusion() {
    if (state.fusionOpen || (state.phase !== 'done' && !fusionCount())) return;
    SFX.unlock();
    state.fusionOpen = true;
    state.fusionSelection = null;
    fusion.hidden = false;
    document.body.style.overflow = 'hidden';
    renderFusion();
    window.setTimeout(() => fusionLater.focus({ preventScroll: true }), 60);
    SFX.whoosh();
  }

  function closeFusion() {
    if (!state.fusionOpen) return;
    state.fusionOpen = false;
    fusion.hidden = true;
    document.body.style.overflow = '';
    state.fusionSelection = null;
    SFX.snap();
    updateFusionChip();
  }

  function renderFusion() {
    const entries = fusableEntries();
    fusionGrid.replaceChildren();
    fusionGo.hidden = true;
    fusionGo.textContent = 'FUSIONNER';
    fusionBuy.hidden = true;
    fusionDesc.textContent = 'Choisis un doublon : deux exemplaires identiques fusionnent pour donner une carte de la rareté supérieure.';

    if (!entries.length) {
      const empty = el('div', 'fusion-empty');
      empty.innerHTML =
        state.collection.length < 2
          ? 'Pas encore de doublon. <b>Ouvre un booster</b> : deux cartes identiques suffisent pour lancer une fusion.'
          : 'Aucun doublon fusionnable pour l\'instant. Les cartes <b>Ultra épiques</b> sont le sommet de la fusion : impossible d\'aller plus haut.';
      fusionGrid.append(empty);
      renderFusionPreview(null);
      if (state.phase === 'done') {
        fusionBuy.hidden = false;
        fusionBuy.textContent = 'ALLER AU SHOP';
      }
      return;
    }

    for (const entry of entries) {
      const info = RARITIES[entry.card.rarity];
      const next = RARITIES[info.next];
      const row = el('button', 'fusion-row');
      row.type = 'button';
      row.dataset.id = entry.card.id;
      row.style.setProperty('--fr-bg', RARITY_BG[entry.card.rarity] || RARITY_BG.common);
      const emoji = el('span', 'fr-emoji');
      emoji.append(cardFrame(entry.card, { mini: true }));
      const main = el('span', 'fr-main');
      main.append(
        el('span', 'fr-name', CardMutations.label(entry.card)),
        el('span', 'fr-meta', `2 doublons → 1 ${next.label}`)
      );
      row.append(emoji, main, el('span', 'fr-count', `×${entry.count}`));
      on(row, 'click', () => {
        state.fusionSelection = entry.card.id;
        SFX.tick();
        [...fusionGrid.querySelectorAll('.fusion-row')].forEach((r) => r.classList.toggle('is-selected', r === row));
        renderFusionPreview(entry);
        fusionGo.hidden = false;
        fusionGo.textContent = `FUSIONNER · −2 ${CardMutations.label(entry.card)}`;
      });
      fusionGrid.append(row);
    }
    renderFusionPreview(null);
  }

  function renderFusionPreview(entry) {
    fusionStage.replaceChildren();
    fusionGo.disabled = !entry;
    if (!entry) {
      fusionStage.append(el('span', 'fs-empty', 'Sélectionne une carte pour voir le résultat'));
      return;
    }
    const info = RARITIES[entry.card.rarity];
    const nextInfo = RARITIES[info.next];
    const pool = cardsDatabase.filter((c) => c.rarity === info.next);
    const preview = pool[Math.floor(Math.random() * pool.length)];

    const a = el('span', 'fs-card');
    const b = el('span', 'fs-card');
    a.append(cardFrame(entry.card, { mini: true }));
    b.append(cardFrame(entry.card, { mini: true }));
    const plus = el('span', 'fs-plus', '+');
    const arrow = el('span', 'fs-arrow', '→');
    const result = el('span', 'fs-card result');
    if (preview) result.append(cardFrame(preview, { mini: true }));
    else result.append(el('span', null, '✦'));
    result.style.setProperty('--fs-color', nextInfo.glow);
    fusionStage.append(a, plus, b, arrow, result);
    result.title = preview ? `${preview.name} (${nextInfo.label})` : '';
  }

  function doFusion() {
    const id = state.fusionSelection;
    if (!id) return;
    const entry = fusableEntries().find((e) => e.card.id === id);
    if (!entry) return;
    const info = RARITIES[entry.card.rarity];
    if (!canFuseInto(info)) return;
    const pool = cardsDatabase.filter((c) => c.rarity === info.next);
    if (!pool.length) {
      showToast('Aucune carte de rareté supérieure disponible dans cards.js.');
      return;
    }
    const result = CardMutations.roll(pool[Math.floor(Math.random() * pool.length)]);

    // Retire deux exemplaires de la collection.
    let removed = 0;
    state.collection = state.collection.filter((c) => {
      if (c.id === id && removed < 2) {
        removed++;
        return false;
      }
      return true;
    });
    state.collection.push(result);
    save();

    const dlg = qs(fusion, '.fusion-dialog');
    if (dlg) {
      dlg.classList.remove('is-fusing');
      void dlg.offsetWidth;
      dlg.classList.add('is-fusing');
    }
    SFX.pop();
    window.setTimeout(() => SFX.rarity(result.rarity), 120);

    if (!reduceMotion.matches) {
      const r = fusionStage.getBoundingClientRect();
      const s = stage.getBoundingClientRect();
      for (let i = 0; i < 30; i++) {
        FX.spark(r.left - s.left + r.width / 2, r.top - s.top + r.height / 2, i % 2 ? RARITIES[result.rarity].glow : '#ffffff', {
          speedMax: 380,
          g: 200,
          size: 2.6
        });
      }
    }

    state.fusionSelection = null;
    state.fusions = (state.fusions || 0) + 1;
    renderFusion();
    renderRecapFromCollection();
    /* Quête « Doublon radieux », « Alchimiste » + succès fusion. */
    trackProgress();
    window.setTimeout(() => {
      showToast(`Fusion réussie : ${result.name} (${RARITIES[result.rarity].label}) !`, 3600);
      flashScreen();
      updateFusionChip();
      if (!fusableEntries().length) {
        fusionDesc.textContent = 'Plus aucun doublon fusionnable. Ouvre un booster pour en trouver de nouveaux.';
      }
    }, 260);
  }

  function renderRecapFromCollection() {
    const slotCount = recapSlots.children.length || CARD_COUNT;
    const last = state.collection.slice(-slotCount);
    [...recapSlots.children].forEach((s, i) => {
      s.className = 'slot';
      s.style.removeProperty('--slot-color');
      delete s.dataset.rarity;
      delete s.dataset.cardId;
      s.removeAttribute('role');
      s.removeAttribute('aria-label');
      s.removeAttribute('tabindex');
      s.replaceChildren();
      if (last[i]) {
        s.classList.add('is-filled');
        const card = last[i];
        const info = RARITIES[card.rarity];
        s.style.setProperty('--slot-color', info.glow);
        s.dataset.rarity = card.rarity;
        s.dataset.cardId = card.id;
        s.tabIndex = 0;
        s.setAttribute('role', 'button');
        s.setAttribute('aria-label', `Voir ${card.name} (${info.label}) en grand`);
        const mini = el('span', 'slot-mini');
        mini.style.setProperty('--slot-bg', RARITY_BG[card.rarity] || RARITY_BG.common);
        mini.append(cardFrame(card, { mini: true, alt: `${card.name} — ${info.label}` }));
        s.append(mini);
      }
    });
  }

  on(fusionGo, 'click', doFusion);
  on(fusionLater, 'click', closeFusion);
  on($('fusion-x'), 'click', closeFusion);
  on(fusionBuy, 'click', () => {
    closeFusion();
    window.setTimeout(buyPack, 180);
  });
  on($('fusion-backdrop'), 'click', closeFusion);
  on(fusionChip, 'click', openFusion);
  if (collFusion) on(collFusion, 'click', openFusion);

  document.addEventListener('keydown', (e) => {
    if (!currentUser) return;
    if (e.key === 'Escape' && !inspect.hidden) {
      closeInspect();
      return;
    }
    if (e.key === 'Escape' && state.fusionOpen) {
      closeFusion();
      return;
    }
    if (e.key === 'Escape' && confirmSheet && !confirmSheet.hidden) {
      confirmAction = null;
      closeSheet(confirmSheet);
      return;
    }
    if (app.dataset.tab !== 'pack' || state.phase !== 'reveal' || state.fusionOpen || !current) return;
    /* Cascade « Ouvrir tout » : Entrée, Espace ou Échap passent à la fin
       (le bouton « Passer » a déjà son propre clic clavier). */
    if (openingAll) {
      if ((e.key === 'Enter' || e.key === ' ' || e.key === 'Escape') && document.activeElement !== openAll) {
        e.preventDefault();
        skipOpenAll();
      }
      return;
    }
    if (packCinematic) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (document.activeElement === buyBtn || document.activeElement === fusionChip || document.activeElement === recapToggle || document.activeElement === openAll) return;
    e.preventDefault();
    SFX.unlock();
    if (!current.node.classList.contains('is-revealed')) revealCard(current.node, current.data);
    else if (current.node.classList.contains('is-flipped')) sendToRecap(current.node, current.data);
  });

  /* --------------------------------------------------------------- boutons */

  on(buyBtn, 'click', buyPack);
  on(recapToggle, 'click', () => {
    const collapsed = !recap.classList.contains('is-collapsed');
    setRecapCollapsed(collapsed);
    SFX.tick();
  });
  on(buyBtn, 'pointerenter', () => SFX.tick());

  on(soundBtn, 'click', () => {
    SFX.unlock();
    const muted = !SFX.muted;
    SFX.setMuted(muted);
    soundBtn.setAttribute('aria-pressed', String(muted));
    soundBtn.setAttribute('aria-label', muted ? 'Activer le son' : 'Couper le son');
    if (!muted) SFX.tick();
  });

  function unlockOnce(e) {
    SFX.unlock();
    if (!SFX.muted && e.type === 'pointerdown') SFX.tick();
    window.removeEventListener('pointerdown', unlockOnce);
    window.removeEventListener('keydown', unlockOnce);
  }
  window.addEventListener('pointerdown', unlockOnce, { passive: true });
  window.addEventListener('keydown', unlockOnce);

  /* ---------------------------------------------------- dimensionnement */

  let sizeFrame = 0;
  function scheduleSizing(frames = 8) {
    if (sizeFrame) return;
    const step = () => {
      sizeStage();
      sizeFrame++;
      if (sizeFrame >= frames) sizeFrame = 0;
      else requestAnimationFrame(step);
    };
    requestAnimationFrame(step);
  }

  function sizeStage() {
    // La pile : on prend la plus petite des contraintes largeur / hauteur pour
    // que les cinq cartes restent toujours entièrement visibles.
    if (!revealView.hidden) {
      const tw = tableEl.clientWidth;
      const th = tableEl.clientHeight;
      if (tw > 0 && th > 0) {
        const h = Math.min(th - 10, (tw * 0.9) / (5 / 7), 470);
        stack.style.height = `${Math.max(150, h).toFixed(0)}px`;
      }
    }
    // Le paquet : il doit tenir sous le titre, au-dessus des probabilités.
    const areaH = packArea.clientHeight;
    const areaW = packArea.clientWidth;
    if (areaH > 0 && areaW > 0) {
      const w = Math.min(areaW * 0.62, areaH * 0.56, 286);
      pack.style.width = `${Math.max(132, w).toFixed(0)}px`;
    }
  }

  /* --------------------------------------------------------------- resize */

  let resizeTimer = null;
  function handleResize() {
    window.clearTimeout(resizeTimer);
    resizeTimer = window.setTimeout(() => {
      FX.resize();
      Dust.resize();
      sizeStage();
      stage.style.setProperty(
        '--recap-h',
        recap.classList.contains('is-idle') || recap.classList.contains('is-collapsed') ? '0px' : `${Math.max(72, recap.offsetHeight)}px`
      );
    }, 140);
  }
  window.addEventListener('resize', handleResize);
  window.addEventListener('load', () => {
    if (!recap.classList.contains('is-idle')) setRecapCollapsed(recap.classList.contains('is-collapsed'));
  });
  window.addEventListener('orientationchange', handleResize);

  /* Un clic sur une vignette du butin ouvre la carte en grand. */
  on(recapSlots, 'click', (event) => {
    const slot = event.target.closest('.slot');
    if (!slot || !slot.dataset.cardId) return;
    openInspect(cardById(slot.dataset.cardId));
  });

  on(recapSlots, 'keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const slot = event.target.closest('.slot');
    if (!slot || !slot.dataset.cardId) return;
    event.preventDefault();
    openInspect(cardById(slot.dataset.cardId));
  });

  /* Probabilités affichées : moyenne des distributions de chaque slot
     (table du pack + garanties, restreinte au pool). Ce sont exactement les
     chances du tirage (drawPack) : changer PACK_TABLES / PACK_SLOTS met
     l'affichage à jour tout seul. `boosted` est conservé pour compatibilité. */
  function renderOdds(boosted, pool, packType) {
    if (!packOdds) return;
    packOdds.replaceChildren();
    const type = isPackType(packType) ? packType : 'classic';
    const list = pool && pool.length ? pool : packPool(type);
    const slots = packSlotsFor(type);
    const blended = {};
    slots.forEach((slot) => {
      const weights = slotRarityWeights(type, slot, list);
      const total = Object.values(weights).reduce((sum, w) => sum + w, 0);
      if (total <= 0) return;
      Object.entries(weights).forEach(([key, w]) => {
        blended[key] = (blended[key] || 0) + (w / total) / slots.length;
      });
    });
    Object.entries(RARITIES).forEach(([key, r]) => {
      const pct = (blended[key] || 0) * 100;
      if (pct <= 0) return;
      const row = el('span', `odds odds-${key}`);
      const dot = el('i');
      dot.style.background = r.color;
      dot.style.boxShadow = `0 0 6px ${r.glow}`;
      const label = `${r.label} ${pct.toFixed(1).replace(/\.0$/, '').replace('.', ',')} %`;
      row.append(dot, document.createTextNode(label));
      packOdds.append(row);
    });
    if (type === 'ultra') {
      packOdds.append(el('span', 'pack-odds-ultra-note', 'PACK ULTRA RARE : GROSSES RARETÉS MASSIVEMENT BOOSTÉES · SHINY ×7'));
    } else if (type === 'rare' || type === 'doubleRare') {
      packOdds.append(el('span', 'pack-odds-rare-note', 'PACK RARE : RARETÉS ÉLEVÉES PLUS FRÉQUENTES · SHINY ×2'));
    }
    if (type === 'video') {
      packOdds.append(el('span', 'pack-odds-video-note', 'PACK VIDÉO : 2 CARTES ANIMÉES · FPS, SON ET BOUCLE PAR CARTE'));
    }
  }

  /* ---------------------------------------------------------------- début */

  /* ============================================ NAVIGATION · COLLECTION · SAUVEGARDE */

  const tabs = [...document.querySelectorAll('.tab')];
  const collView = $('collection-view');
  const collGrid = $('coll-grid');
  const collCount = $('coll-count');
  const collFill = $('coll-fill');
  const collFilters = $('coll-filters');
  const collSort = $('coll-sort');
  const collSortDir = $('coll-sort-dir');
  const collEmpty = $('coll-empty');
  const tabBadge = $('tab-badge');
  const fresh = new Set(); // cartes obtenues depuis la dernière visite de la collection
  const catalogNewIds = new Set(); // cartes ajoutées au catalogue depuis la dernière visite
  const CATALOG_SEEN_KEY = 'refs-cards:catalog-seen';
  let collFilter = 'all';
  /* Tri courant : critère (`collSortKey`, clé de COLL_SORTS) + sens inversé
     ou non (`collSortDirFlip`, piloté par le bouton ⇅). */
  let collSortKey = 'num';
  let collSortDirFlip = false;

  let firebaseAuth = null;
  let cloudDb = null;
  let currentUser = null;
  let currentEmail = '';
  let saveTimer = 0;
  let saveQueue = Promise.resolve(true);

  /* Délai au bout duquel on considère que la fenêtre Google ne répond pas.
     Sans cela, un pop-up bloqué par le navigateur laissait le bouton inerte
     pour toujours (aucun message, aucun clic possible). */
  const AUTH_POPUP_TIMEOUT = 25000;
  /* Erreurs qui justifient de retenter la connexion par redirection complète. */
  const REDIRECT_FALLBACK = new Set([
    'auth/popup-blocked',
    'auth/operation-not-supported-in-environment',
    'auth/web-storage-unsupported'
  ]);
  /* Un aperçu intégré (iframe) ne peut ni ouvrir de pop-up de façon fiable ni
     partager les cookies de accounts.google.com : il faut alors un onglet. */
  const authEmbedded = (() => {
    try { return window.self !== window.top; } catch (error) { return true; }
  })();
  let authBusy = false;
  let authAttempt = 0;

  const siteLabel = () => window.location.hostname || window.location.host || 'ce site';

  /* Ces retours visuels ne doivent jamais lever d'exception : si l'écran de
     compte manque (HTML en cache obsolète, aperçu partiel), le reste du script
     continue et la connexion reste possible. */
  function setAuthError(message) {
    if (!authError) return;
    authError.textContent = message || '';
    authError.hidden = !message;
  }

  function setAuthStatus(message) {
    if (!authStatus) return;
    authStatus.textContent = message || '';
    authStatus.hidden = !message;
  }

  function setAuthHint(message) {
    if (!authHintText || !authHint) return;
    authHintText.textContent = message || '';
    authHint.hidden = !message;
  }

  function setAuthBusy(busy) {
    authBusy = busy;
    if (googleLabel) googleLabel.textContent = busy ? 'Connexion en cours…' : 'Se connecter avec Google';
    if (!googleSignIn) return;
    if (busy) {
      googleSignIn.setAttribute('aria-busy', 'true');
      googleSignIn.disabled = true;
    } else {
      googleSignIn.removeAttribute('aria-busy');
      googleSignIn.disabled = false;
    }
  }

  function authErrorMessage(error) {
    const messages = {
      'auth/popup-closed-by-user': 'Connexion annulée : la fenêtre Google a été fermée avant la fin.',
      'auth/cancelled-popup-request': 'Une autre fenêtre de connexion est déjà ouverte.',
      'auth/popup-blocked': authEmbedded
        ? 'Le navigateur a bloqué la fenêtre Google dans cet aperçu intégré. Ouvre le jeu dans un onglet, puis réessaie.'
        : 'Le navigateur a bloqué la fenêtre de connexion. Autorise les pop-ups pour ce site, puis réessaie.',
      'auth/network-request-failed': 'Connexion impossible. Vérifie ta connexion internet.',
      'auth/unauthorized-domain': `Ce domaine (${siteLabel()}) n’est pas autorisé. Ajoute-le dans Firebase → Authentication → Settings → Authorized domains.`,
      'auth/operation-not-allowed': 'La connexion Google n’est pas activée dans Firebase Authentication (Sign-in method → Google).',
      'auth/operation-not-supported-in-environment': 'Ce navigateur ne permet pas la connexion par fenêtre Google. Ouvre le jeu dans un onglet ou un autre navigateur.',
      'auth/web-storage-unsupported': 'Le navigateur bloque le stockage nécessaire à la connexion (navigation privée ou cookies bloqués). Autorise les cookies pour ce site, puis réessaie.',
      'auth/internal-error': 'Google a renvoyé une réponse incomplète. Réessaie dans un instant.',
      'permission-denied': 'Accès cloud refusé. Vérifie les règles Firestore publiées (playerSaves/{userId}).'
    };
    const code = error && error.code;
    const message = (code && messages[code]) || (error && error.message) || 'Une erreur est survenue. Réessaie.';
    // Le code technique aide au diagnostic quand l’interface semble ne rien faire.
    return code && !message.includes(code) ? `${message} (${code})` : message;
  }

  function resetAuthFeedback() {
    setAuthError('');
    setAuthStatus('');
    setAuthHint(authEmbedded
      ? 'Aperçu intégré : la connexion Google s’ouvre mieux dans un onglet dédié.'
      : '');
  }

  /* Écran de chargement : affiché à l'ouverture de la page jusqu'à ce que
     Firebase dise si la personne est déjà connectée. Ensuite, soit le jeu
     (connecté), soit la page de connexion (pas de compte / déconnecté). Pendant
     ce temps, ni la connexion ni le jeu ne sont visibles : pas de flash. */
  const LOADING_TIMEOUT = 8000;
  let loadingTimer = 0;
  function hideLoading() {
    window.clearTimeout(loadingTimer);
    loadingTimer = 0;
    if (loadingScreen) loadingScreen.hidden = true;
  }
  function showLoginPage() {
    hideLoading();
    if (authScreen) authScreen.hidden = false;
  }
  function setLoadingText(message) {
    if (loadingText) loadingText.textContent = message || '';
  }

  function applySave(d) {
    /* Une sauvegarde écrite par une ancienne version contient encore
       `freeDate` / `freeUsed` (« 3 gratuits/jour »). Les règles actuelles
       n'autorisent plus ces clés : leur présence fait refuser chaque set
       merge (le document fusionné est jugé à elles), d'où « Accès cloud
       refusé » même app et règles à jour. On les signale pour suppression. */
    legacySaveKeys = Boolean(d) && (Object.prototype.hasOwnProperty.call(d, 'freeDate')
      || Object.prototype.hasOwnProperty.call(d, 'freeUsed'));
    cloudHasDouble = Boolean(d && d.packStock && Object.prototype.hasOwnProperty.call(d.packStock, 'doubleRare'));
    cloudHasUltra = Boolean(d && d.packStock && Object.prototype.hasOwnProperty.call(d.packStock, 'ultra'));
    state.coins = Math.max(0, Math.round(Number(d && d.coins) || 0));
    state.firstPack = !d || d.firstPack !== false;
    state.collection = ((d && d.collection) || [])
      .map((id) => CardMutations.resolve(id))
      .filter(Boolean);
    friends = Array.isArray(d && d.friends)
      ? d.friends.filter((u) => typeof u === 'string')
      : [];
    state.packsOpened = Math.max(0, Number(d && d.packsOpened) || 0);
    leaderboardAnnounced = Boolean(d && d.leaderboardAnnounced);
    /* Compteurs quêtes/succès (absents des anciennes sauvegardes → 0). */
    state.fusions = Math.max(0, Number(d && d.fusions) || 0);
    state.packsBought = Math.max(0, Number(d && d.packsBought) || 0);
    state.freePacks = Math.max(0, Number(d && d.freePacks) || 0);
    state.marketSales = Math.max(0, Number(d && d.marketSales) || 0);
    state.marketEarned = Math.max(0, Number(d && d.marketEarned) || 0);
    state.marketBuys = Math.max(0, Number(d && d.marketBuys) || 0);
    /* Quêtes / succès / niveau / notifications. Une sauvegarde corrompue
       (id étranger, forme improbable) est ignorée sans casser le jeu. */
    questState.completed = (Array.isArray(d && d.quests) ? d.quests : [])
      .filter((id) => typeof id === 'string')
      .filter((id) => Quests.QUESTS.some((q) => q.id === id))
      .slice(0, Math.max(1, Quests.QUESTS.length));
    questState.achievements = (Array.isArray(d && d.achievements) ? d.achievements : [])
      .filter((id) => typeof id === 'string')
      .filter((id) => Quests.ACHIEVEMENTS.some((a) => a.id === id))
      .slice(0, Math.max(1, Quests.ACHIEVEMENTS.length));
    questState.xp = Math.max(0, Math.floor(Number(d && d.xp) || 0));
    questState.notifications = (Array.isArray(d && d.notifications) ? d.notifications : [])
      .filter((n) => n && typeof n === 'object'
        && typeof n.title === 'string'
        && typeof n.message === 'string'
        && Number.isFinite(Number(n.at)))
      .map((n) => ({
        id: typeof n.id === 'string' ? n.id : `n-${notifSeq++}`,
        type: NOTIF_ICONS[n.type] ? n.type : 'system',
        title: n.title.slice(0, 120),
        message: n.message.slice(0, 400),
        at: Number(n.at),
        read: Boolean(n.read)
      }))
      .slice(0, QUEST_NOTIFICATIONS_MAX);
    /* Le champ `questBaseline` des anciennes sauvegardes est simplement
       ignoré : les quêtes se mesurent désormais à vie (valeur absolue), donc
       ce que le joueur avait déjà accompli compte dès maintenant. */
    questReadyNotifiedIds.clear();
    questSeenIds.clear();
    questSeenInitialized = false;
    /* Inventaire : les anciennes sauvegardes n'ont pas packStock ni le
       calendrier de connexion (défauts 0). Le premier pack offert (firstPack)
       devient 1 pack classique en inventaire, une seule fois. */
    const stock = (d && d.packStock) || {};
    state.packStock = packStockFrom(stock);
    if (state.firstPack) {
      state.packStock.classic += 1;
      state.firstPack = false;
    }
    /* Calendrier de connexion (streakDate/streak/claimedDays). Les anciennes
       sauvegardes « 3 gratuits/jour » migrent : un quota déjà entamé aujourd'hui
       compte comme cadeau récupéré, sinon la série repart de zéro. */
    const savedToday = todayKey();
    state.streakDate = typeof (d && d.streakDate) === 'string' ? d.streakDate : '';
    state.streak = clamp(Math.floor(Number(d && d.streak) || 0), 0, 999);
    state.claimedDays = (Array.isArray(d && d.claimedDays) ? d.claimedDays : [])
      .filter((k) => typeof k === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(k))
      .slice(-31);
    if (!state.streakDate && typeof (d && d.freeDate) === 'string') {
      if (d.freeDate === savedToday && Number(d.freeUsed) > 0) {
        state.streakDate = d.freeDate;
        state.streak = clamp(Number(d.freeUsed) || 0, 1, 999);
        noteClaimedDay(d.freeDate);
      }
    }
    /* L'affichage du calendrier ne garde que le mois en cours. */
    const monthPrefix = savedToday.slice(0, 7);
    state.claimedDays = state.claimedDays.filter((k) => k.slice(0, 7) === monthPrefix);
    const previousStreakDate = state.streakDate;
    refreshStreak();
    /* Nouveau jour calendaire : un nouveau cadeau est disponible — on prévient
       (une fois par session) pour ne pas le laisser passer. */
    const newDay = Boolean(previousStreakDate) && previousStreakDate !== savedToday;
    state.currentPackType = firstAvailablePackType();
    if (revealView.classList.contains('is-results')) resetToPack({ quiet: true });
    state.phase = 'pack';
    state.deck = [];
    state.loot = [];
    state.packIndex = 0;
    updateCoins();
    renderCollection();
    renderAccount();
    renderShop();
    renderPackInventory();
    selectPackType(state.currentPackType);
    /* Chargement initial : succès repris en compte (rétroactif), quête
       active mesurée, badges à jour — sans toast ni notification intempestive
       (le joueur vient d'ouvrir la page, il voit l'onglet Quêtes). */
    initQuestProgress({ newDay });
  }

  function saveNow(force = false) {
    if (marketBusy && !force) {
      const uid = currentUser && currentUser.uid;
      return marketDone.then(() => currentUser && currentUser.uid === uid ? saveNow() : false);
    }
    if (!currentUser || !cloudDb) return Promise.resolve(true);
    clearTimeout(saveTimer);
    const userId = currentUser.uid;
    const db = cloudDb;
    const data = withLegacyStrip({
        coins: clamp(Math.round(Number(state.coins) || 0), 0, 1000000000),
        firstPack: Boolean(state.firstPack),
        collection: state.collection.map((c) => c.id),
        friends: friends.slice(0, 500),
        packsOpened: Math.max(0, Math.floor(Number(state.packsOpened) || 0)),
        packStock: cloudPackStock(state.packStock, cloudHasUltra, cloudHasDouble),
        streakDate: String(state.streakDate || '').slice(0, 10),
        streak: clamp(Math.floor(Number(state.streak) || 0), 0, 999),
        claimedDays: (state.claimedDays || []).slice(-31),
        /* Quêtes / succès / niveau / notifications + compteurs alimentant
           leur progression. */
        fusions: Math.max(0, Math.floor(Number(state.fusions) || 0)),
        packsBought: Math.max(0, Math.floor(Number(state.packsBought) || 0)),
        freePacks: Math.max(0, Math.floor(Number(state.freePacks) || 0)),
        marketSales: Math.max(0, Math.floor(Number(state.marketSales) || 0)),
        marketEarned: Math.max(0, Math.floor(Number(state.marketEarned) || 0)),
        marketBuys: Math.max(0, Math.floor(Number(state.marketBuys) || 0)),
        xp: Math.max(0, Math.floor(Number(questState.xp) || 0)),
        quests: questState.completed.slice(),
        achievements: questState.achievements.slice(),
        notifications: questState.notifications.slice(0, QUEST_NOTIFICATIONS_MAX),
        leaderboardAnnounced: leaderboardAnnounced,
        updatedAt: serverTimestamp()
      });
    saveQueue = saveQueue.then(async () => {
      try {
        await db.collection('playerSaves').doc(userId).set(data, { merge: true });
        legacySaveKeys = false;
        if (data.packStock && Object.prototype.hasOwnProperty.call(data.packStock, 'doubleRare')) cloudHasDouble = true;
        if (data.packStock && Object.prototype.hasOwnProperty.call(data.packStock, 'ultra')) {
          cloudHasUltra = true;
        }
        return true;
      } catch (error) {
        if (!noteCloudError('Sauvegarde cloud impossible', error)) {
          showToast('Sauvegarde impossible pour le moment. Vérifie ta connexion.');
        }
        return false;
      }
    });
    return saveQueue;
  }

  function save() {
    if (!currentUser || !cloudDb) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveNow(); }, 250);
    saveProfileSoon();
    if (app.dataset.tab === 'account') renderAccount();
  }

  async function showGame(user, saveData) {
    currentUser = user;
    currentEmail = user.email || '';
    applySave(saveData);
    /* Sauvegarde d'une ancienne version : on retire freeDate/freeUsed du
       document cloud dès l'ouverture (fire-and-forget ; les écritures suivantes
       réessaient via withLegacyStrip si nécessaire). */
    stripLegacySaveKeys().catch(() => { /* déjà signalé par noteCloudError */ });
    syncHudName();
    syncHudAvatar();
    /* Profil public (pseudo, avatar, code ami) chargé AVANT d'afficher le
       jeu : un changement de pseudo ou de photo fait juste après la
       connexion ne doit pas être écrasé par ce chargement (qui réécrit le
       profil cloud avec les anciennes valeurs). */
    await loadProfile();
    loadFriendRequests();
    subscribeFriendRequests();
    /* Échanges désactivés : seul le marché existe (cartes + packs en vente).
       Les anciennes propositions trades/ ne sont plus chargées ni proposées. */
    loadMarket();
    subscribeMarket();
    /* Jeux (pile ou face) : défis entre amis en temps réel. */
    loadFlipGames();
    subscribeFlipGames();
    if (authScreen) authScreen.hidden = true;
    hideLoading();
    gameRegions.forEach((region) => region.removeAttribute('inert'));
    app.classList.add('is-authenticated');
    setAuthBusy(false);
    resetAuthFeedback();
    setTab('pack');
    /* Annonce du catalogue : une fois le jeu affiché, on compare les cartes
       disponibles avec celles de la dernière visite (cf. announceNewCards). */
    announceNewCards();
    if (!leaderboardAnnounced) {
      leaderboardAnnounced = true;
      pushNotification('system', 'Nouveaux classements 🏆', 'Découvre les joueurs les plus riches et ceux qui ont ouvert le plus de boosters dans En ligne → Classement.');
    }
    /* Annonce de sortie du Pack Ultra Rare (−20 % / 24 h). Légèrement
       différée pour laisser l'écran de chargement disparaître, et jamais
       par-dessus l'annonce des nouvelles cartes. */
    window.setTimeout(maybeShowUltraPromo, 900);
    /* Notifications hors jeu : état des réglages (Compte / cloche) puis, si
       la question « que veux-tu recevoir ? » n'a jamais été posée sur cet
       appareil, elle s'ouvre une seule fois — après les annonces du jour. */
    renderPush();
    if (Push && Push.canNotify()) Push.ready().catch(() => { /* facultatif */ });
    schedulePushAsk(6500);
  }

  function showAuth() {
    clearTimeout(saveTimer);
    window.clearTimeout(profileTimer);
    profileTimer = 0;
    window.clearTimeout(pseudoTimer);
    pseudoTimer = 0;
    currentUser = null;
    currentEmail = '';
    profile.pseudo = '';
    profile.avatar = '';
    profile.friendCode = '';
    friends = [];
    friendProfiles.clear();
    friendRequests = [];
    sentRequests = [];
    sentRequestsByUid.clear();
    pendingFriendUids.clear();
    friendRemovalInFlight.clear();
    removedFriendsThisSession.clear();
    knownRequestIds.clear();
    hadRequests = false;
    marketListings = [];
    globalListings = [];
    globalListingsLoaded = false;
    marketGifts = [];
    receivedOffers = []; sentOffers = [];
    sentGifts = [];
    knownGiftIds = new Set();
    hadGiftSnapshot = false;
    unsubscribeMarket();
    unsubscribeFlipGames();
    flipGames = [];
    hadFlipSnapshot = false;
    flipAnimated.clear();
    flipActiveGameId = null;
    flipPushKnown = null;
    offersPushKnown = null;
    hadOffersSnapshot = false;
    selectedFriendUid = null;
    rulesHelpShown = false;
    legacySaveKeys = false;
    cloudHasDouble = false;
    cloudHasUltra = false;
    /* Quêtes / succès / notifications : on repart de zéro à la déconnexion
       pour ne pas laisser traîner l'état d'un autre joueur sur cet appareil. */
    questState.completed = [];
    questState.achievements = [];
    questState.xp = 0;
    questState.notifications = [];
    leaderboardAnnounced = false;
    leaderboardRequest++;
    questReadyNotifiedIds.clear();
    questSeenIds.clear();
    questSeenInitialized = false;
    notifSalesKnown = null;
    notifSalesSnapshot = false;
    state.fusions = 0;
    state.packsBought = 0;
    state.freePacks = 0;
    state.marketSales = 0;
    state.marketEarned = 0;
    state.marketBuys = 0;
    state.packStock = emptyPackStock();
    state.streakDate = '';
    state.streak = 0;
    state.claimedDays = [];
    state.currentPackType = 'classic';
    shopQty.classic = 1;
    shopQty.rare = 1;
    shopQty.doubleRare = 1;
    shopQty.legend = 1;
    shopQty.video = 1;
    renderShop();
    renderPackInventory();
    /* Le panneau d'administration ne doit jamais rester affiché pour un
       autre compte sur le même appareil : on le masque à la déconnexion. */
    renderAdminPanel();
    if (friendRequestsUnsub) {
      try { friendRequestsUnsub(); } catch (error) { /* déjà fermé */ }
      friendRequestsUnsub = null;
    }
    if (friendDetail) friendDetail.hidden = true;
    if (accountEmail) {
      accountEmail.textContent = '';
      accountEmail.removeAttribute('title');
    }
    if (accountAvatar) {
      accountAvatar.removeAttribute('src');
      accountAvatar.hidden = true;
    }
    if (app) app.classList.remove('is-authenticated');
    gameRegions.forEach((region) => region.setAttribute('inert', ''));
    showLoginPage();
    setAuthBusy(false);
    resetAuthFeedback();
    /* Les préférences de notifications sont par compte : à la déconnexion, on
       n'affiche plus celles du joueur qui vient de partir. */
    window.clearTimeout(pushAskTimer);
    renderPush();
  }

  /* La connexion doit toujours donner un retour visible : bouton occupé,
     message d’état, erreur explicite et, en dernier recours, un lien pour
     ouvrir le jeu dans un onglet (les aperçus intégrés ne peuvent pas
     terminer un signInWithPopup). */
  async function signInWithGoogle() {
    if (authBusy) return;
    if (!firebaseAuth) {
      setAuthStatus('');
      setAuthError(window.firebase && window.firebase.auth
        ? 'Le service de comptes n’est pas encore prêt. Recharge la page, puis réessaie.'
        : 'Les scripts Firebase n’ont pas pu être chargés (hors ligne, bloqueur de publicités ou réseau filtré). Vérifie ta connexion, puis recharge la page.');
      setAuthHint('La connexion Google a besoin d’internet et des scripts Firebase.');
      return;
    }

    let provider;
    try {
      provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
    } catch (error) {
      setAuthError(authErrorMessage(error));
      return;
    }

    const attempt = ++authAttempt;
    const current = () => attempt === authAttempt;
    setAuthError('');
    setAuthStatus('Ouverture de la fenêtre Google…');
    setAuthHint(authEmbedded ? 'Aperçu intégré : si rien ne s’ouvre, utilise le lien vers un onglet.' : '');
    setAuthBusy(true);

    // Garde-fou : un pop-up qui ne se ferme jamais ne doit pas bloquer le bouton.
    const watchdog = window.setTimeout(() => {
      if (!current()) return;
      authAttempt += 1;
      setAuthBusy(false);
      setAuthStatus('');
      setAuthError(authEmbedded
        ? 'La fenêtre Google ne répond pas dans cet aperçu intégré. Ouvre le jeu dans un onglet, puis réessaie.'
        : 'La fenêtre Google ne répond pas. Autorise les pop-ups pour ce site, puis réessaie.');
      setAuthHint(authEmbedded
        ? 'La connexion Google ne peut pas aboutir dans un aperçu intégré : passe par un onglet.'
        : 'Tu peux aussi ouvrir le jeu dans un onglet dédié, puis réessayer.');
    }, AUTH_POPUP_TIMEOUT);

    try {
      // GoogleAuthProvider + signInWithPopup : la connexion se fait dans la fenêtre Google.
      await firebaseAuth.signInWithPopup(provider);
      // onAuthStateChanged prend le relais : chargement de la sauvegarde + affichage du jeu.
      if (current()) setAuthStatus('Connexion réussie, chargement de ta collection…');
    } catch (error) {
      if (!current()) return; // tentative déjà abandonnée par le garde-fou
      const code = error && error.code;
      setAuthStatus('');
      if (!authEmbedded && REDIRECT_FALLBACK.has(code) && typeof firebaseAuth.signInWithRedirect === 'function') {
        // Pop-up impossible : on retente en redirection complète.
        setAuthStatus('Redirection vers la page Google…');
        try {
          await firebaseAuth.signInWithRedirect(provider);
          return; // la page se recharge, onAuthStateChanged reprend la main
        } catch (redirectError) {
          setAuthError(authErrorMessage(redirectError));
          return;
        }
      }
      setAuthError(authErrorMessage(error));
      if (code === 'auth/popup-blocked') {
        setAuthHint(authEmbedded
          ? 'La connexion Google ne peut pas aboutir dans un aperçu intégré : ouvre le jeu dans un onglet.'
          : 'Si les pop-ups restent bloqués, ouvre le jeu dans un onglet dédié pour te connecter.');
      } else if (authEmbedded && code === 'auth/popup-closed-by-user') {
        setAuthHint('La connexion Google ne peut pas aboutir dans un aperçu intégré : ouvre le jeu dans un onglet.');
      }
    } finally {
      window.clearTimeout(watchdog);
      if (current()) setAuthBusy(false);
    }
  }

  on(googleSignIn, 'click', () => {
    // Aucune erreur inattendue ne doit laisser le bouton inerte.
    signInWithGoogle().catch((error) => {
      setAuthBusy(false);
      setAuthStatus('');
      setAuthError(authErrorMessage(error));
    });
  });

  on(logoutBtn, 'click', async () => {
    if (!await saveNow()) return;
    try { await firebaseAuth.signOut(); }
    catch (error) { showToast(authErrorMessage(error)); }
  });

  function initializeCloud() {
    if (authOpenTab) authOpenTab.href = window.location.href;
    const config = window.REFS_FIREBASE_CONFIG;
    const configured = config && config.apiKey && config.projectId && config.appId &&
      !Object.values(config).some((value) => typeof value === 'string' && value.includes('REMPLACE_PAR'));
    if (!window.firebase || !window.firebase.auth || !configured) {
      // Le bouton reste cliquable : chaque clic réaffiche la cause au lieu de ne rien faire.
      setAuthError(window.firebase && window.firebase.auth
        ? 'La configuration Firebase est incomplète. Vérifie firebase-config.js (voir la section Firebase du README), puis recharge la page.'
        : 'Les scripts Firebase n’ont pas pu être chargés (hors ligne, bloqueur de publicités ou réseau filtré). Vérifie ta connexion, puis recharge la page.');
      setAuthHint('Sans connexion, ta collection ne peut pas être enregistrée.');
      showLoginPage(); // pas de vérification possible : on montre directement la connexion
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(config);
      firebaseAuth = firebase.auth();
      cloudDb = firebase.firestore();
      resetAuthFeedback();
      // Filet de temps : si Firebase ne répond pas, on n'enferme pas la personne
      // sur l'écran de chargement. La connexion reste utilisable, et le jeu
      // s'ouvrira tout seul si la session est finalement retrouvée.
      window.clearTimeout(loadingTimer);
      loadingTimer = window.setTimeout(() => {
        if (!loadingScreen || loadingScreen.hidden) return;
        showLoginPage();
        setAuthHint('La vérification de ton compte prend plus de temps que prévu. Si tu as déjà un compte, le jeu s’ouvrira dès que la connexion répondra.');
      }, LOADING_TIMEOUT);
      // Connexion par redirection (repli des navigateurs sans pop-up).
      if (typeof firebaseAuth.getRedirectResult === 'function') {
        firebaseAuth.getRedirectResult().then((result) => {
          if (result && result.user) setAuthStatus('Connexion réussie, chargement de ta collection…');
        }).catch((error) => {
          setAuthError(authErrorMessage(error));
        });
      }
      firebaseAuth.onAuthStateChanged(async (user) => {
        if (!user) {
          if (currentUser) showAuth();
          else showLoginPage();
          return;
        }
        currentUser = user;
        setLoadingText('Chargement de ta collection…');
        setAuthStatus('Chargement de ta collection…');
        try {
          const snapshot = await cloudDb.collection('playerSaves').doc(user.uid).get();
          if (!currentUser || currentUser.uid !== user.uid) return;
          await showGame(user, snapshot.exists ? snapshot.data() : null);
        } catch (error) {
          currentUser = null;
          showAuth();
          setAuthError(authErrorMessage(error));
          try { await firebaseAuth.signOut(); } catch (ignored) { /* reste bloqué sur l'écran de compte */ }
        }
      }, (error) => {
        setAuthError(authErrorMessage(error));
      });
    } catch (error) {
      setAuthError(`Configuration Firebase invalide : ${error.message}`);
      setAuthHint('Vérifie les valeurs de firebase-config.js.');
      showLoginPage();
    }
  }

  function setTab(tab) {
    if (app.dataset.tab === tab) return;
    app.dataset.tab = tab;
    tabs.forEach((t) => {
      const on = t.dataset.tab === tab;
      t.classList.toggle('is-active', on);
      if (on) t.setAttribute('aria-current', 'page');
      else t.removeAttribute('aria-current');
    });
    const view = tab === 'collection'
      ? collView
      : tab === 'shop'
        ? shopView
        : tab === 'inventory'
          ? inventoryView
          : tab === 'quests'
            ? questsView
            : state.phase === 'reveal' || state.phase === 'done' ? revealView : packView;
    if (view) {
      view.classList.remove('view-in');
      void view.offsetWidth;
      view.classList.add('view-in');
    }
    if (tab === 'collection') {
      renderCollection();
      fresh.clear();
      tabBadge.hidden = true;
    } else if (tab === 'shop') {
      renderShop();
    } else if (tab === 'inventory') {
      renderInventory();
    } else if (tab === 'quests') {
      renderQuests();
      updateQuestBadges();
    } else if (tab === 'online') {
      renderOnline();
      if (onlinePanel === 'leaderboard') loadLeaderboard();
      loadMarket();
      loadGlobalMarket();
      loadFriendRequests();
      loadFlipGames();
      if (selectedFriendUid) loadFriendListings(selectedFriendUid);
    } else if (tab === 'pack') {
      renderPackInventory();
      // Les vues Pack étaient masquées : on remesure tout.
      if (!recap.classList.contains('is-idle')) setRecapCollapsed(recap.classList.contains('is-collapsed'));
      scheduleSizing(8);
    } else if (tab === 'account') {
      /* Stats à jour à l'ouverture (et panneau admin synchronisé pour le
         compte propriétaire — renderAccount appelle renderAdminPanel). */
      renderAccount();
      if (!recap.classList.contains('is-idle')) setRecapCollapsed(recap.classList.contains('is-collapsed'));
      scheduleSizing(8);
    } else {
      // Les vues Pack étaient masquées : on remesure tout.
      if (!recap.classList.contains('is-idle')) setRecapCollapsed(recap.classList.contains('is-collapsed'));
      scheduleSizing(8);
    }
    SFX.tick();
  }

  function renderFilters() {
    const rarities = Object.keys(RARITIES).filter((r) => cardsDatabase.some((c) => c.rarity === r));
    const defs = [['all', 'Toutes'], ['owned', 'Possédées'], ['shiny', '✦ Shiny'], ...rarities.map((r) => [r, RARITIES[r].label])];
    collFilters.replaceChildren(...defs.map(([key, label]) => {
      const b = el('button', key === collFilter ? 'chip is-active' : 'chip');
      b.type = 'button';
      b.dataset.filter = key;
      b.setAttribute('aria-pressed', String(key === collFilter));
      if (RARITIES[key]) {
        const dot = el('i');
        dot.style.setProperty('--c', RARITIES[key].color);
        b.append(dot);
      }
      b.append(document.createTextNode(label));
      return b;
    }));
  }

  /* Critères de tri de la collection. `dir` est résolu pour chaque critère :
     un « sens naturel » (numéro croissant, rareté de la plus rare à la plus
     commune, etc.) que le bouton ⇅ inverse. `valueOf` renvoie donc toujours
     une grandeur positive, et le sens est appliqué après le calcul. */
  const COLL_SORT_KEY = 'refs-cards:collection-sort';
  const COLL_SORTS = {
    num: { label: 'Numéro', dir: 1 },
    rarity: { label: 'Rareté', dir: -1 },
    count: { label: 'Exemplaires', dir: -1 },
    value: { label: 'Valeur', dir: -1 },
    name: { label: 'Nom', dir: 1 },
    shiny: { label: 'Shiny', dir: -1 },
    recent: { label: 'Ajout récente', dir: -1 }
  };
  const COLL_SORT_DEFAULT = { key: 'num', dir: 1 };
  const collNameCollator = new Intl.Collator('fr', { numeric: true, sensitivity: 'base' });

  function collSortRank(st) {
    const info = RARITIES[st.card.rarity] || RARITIES.common;
    return info.rank * 1000 + (st.shiny > 0 ? 1 : 0);
  }

  function collSortValue(st, key) {
    switch (key) {
      case 'rarity': return collSortRank(st);
      case 'count': return st.normal + st.shiny;
      case 'value': return (CardMutations.multiply(st.card, (RARITIES[st.card.rarity] || RARITIES.common).reward) || 0) * (st.normal + st.shiny);
      case 'name': return String(st.card.name || '').toLocaleLowerCase('fr');
      case 'shiny': return st.shiny;
      case 'recent': return st.lastIndex;
      case 'num':
      default: return st.num;
    }
  }

  function compareColl(a, b) {
    const key = COLL_SORTS[collSortKey] ? collSortKey : COLL_SORT_DEFAULT.key;
    const dir = COLL_SORTS[collSortKey] ? COLL_SORTS[collSortKey].dir : COLL_SORT_DEFAULT.dir;
    const factor = collSortDirFlip ? -dir : dir;
    const va = collSortValue(a, key);
    const vb = collSortValue(b, key);
    let diff = 0;
    if (typeof va === 'string' || typeof vb === 'string') {
      diff = collNameCollator.compare(String(va), String(vb));
    } else {
      diff = Math.sign(va - vb);
    }
    /* Égalité : le numéro de carte garde un ordre stable et lisible. */
    return diff !== 0 ? diff * factor : (a.num - b.num);
  }

  function updateCollSortDirButton() {
    if (!collSortDir) return;
    const key = COLL_SORTS[collSortKey] ? collSortKey : COLL_SORT_DEFAULT.key;
    const dir = COLL_SORTS[collSortKey] ? COLL_SORTS[collSortKey].dir : COLL_SORT_DEFAULT.dir;
    const ascending = (collSortDirFlip ? -dir : dir) > 0;
    collSortDir.classList.toggle('is-flipped', collSortDirFlip);
    collSortDir.setAttribute('aria-pressed', String(collSortDirFlip));
    collSortDir.setAttribute('aria-label', ascending
      ? 'Tri croissant : cliquer pour inverser l’ordre'
      : 'Tri décroissant : cliquer pour inverser l’ordre');
    collSortDir.title = ascending ? 'Ordre croissant' : 'Ordre décroissant';
  }

  function renderSortControls() {
    if (collSort) {
      const entries = Object.keys(COLL_SORTS);
      const active = COLL_SORTS[collSortKey] ? collSortKey : COLL_SORT_DEFAULT.key;
      if (collSort.options.length !== entries.length) {
        collSort.replaceChildren(...entries.map((key) => {
          const option = el('option', '', COLL_SORTS[key].label);
          option.value = key;
          return option;
        }));
      }
      collSort.value = active;
    }
    updateCollSortDirButton();
  }

  function saveCollSort() {
    try {
      window.localStorage.setItem(COLL_SORT_KEY, JSON.stringify({
        key: collSortKey, flipped: collSortDirFlip
      }));
    } catch (error) { /* stockage bloqué : le tri reste valable pour la session */ }
  }

  function loadCollSort() {
    try {
      const raw = window.localStorage.getItem(COLL_SORT_KEY);
      if (!raw) return;
      const saved = JSON.parse(raw);
      if (saved && COLL_SORTS[saved.key]) collSortKey = saved.key;
      collSortDirFlip = Boolean(saved && saved.flipped);
    } catch (error) { /* valeur illisible : on garde le tri par défaut */ }
  }

  function setCollSort(key, flip) {
    collSortKey = COLL_SORTS[key] ? key : COLL_SORT_DEFAULT.key;
    collSortDirFlip = Boolean(flip);
    renderSortControls();
    saveCollSort();
    renderCollection();
  }

  function renderCollection() {
    const owned = countMap();
    const total = cardsDatabase.length;
    const got = new Set(state.collection.map((c) => c.baseId || c.id)).size;
    collCount.textContent = `${got} / ${total}`;
    collFill.style.transform = `scaleX(${total ? got / total : 0})`;
    updateFusionChip();

    const frag = document.createDocumentFragment();
    let shown = 0;
    /* Une seule case par carte de base : normales + shiny comptent ensemble.
       `num` est le numéro de la carte dans la base (ordre d'affichage
       historique) : il sert au tri et au libellé des cartes verrouillées. */
    const lastSeen = new Map();
    state.collection.forEach((c, index) => lastSeen.set(c.baseId || c.id, index));
    const stats = new Map(cardsDatabase.map((c, index) => [c.id, {
      card: c, num: index + 1, lastIndex: lastSeen.has(c.id) ? lastSeen.get(c.id) : -1,
      normal: owned.get(c.id) || 0, shiny: 0, shinyCard: null
    }]));
    for (const v of CardMutations.owned(collectionIds())) {
      if (!v.mutation) continue;
      const st = stats.get(v.baseId || v.id);
      const n = owned.get(v.id) || 0;
      if (st && n) { st.shiny += n; st.shinyCard = v; }
    }
    const visible = [...stats.values()]
      .filter((st) => {
        const n = st.normal + st.shiny;
        if (collFilter === 'all') return true;
        if (!n) return false;
        return collFilter === 'shiny' ? st.shiny > 0 : collFilter === 'owned' ? true : st.card.rarity === collFilter;
      })
      .sort(compareColl);
    visible.forEach((st, i) => {
      const card = st.card;
      const n = st.normal + st.shiny;
      shown++;
      const num = st.num;
      if (!n) {
        const t = el('div', catalogNewIds.has(card.id)
          ? 'coll-tile is-locked catalog-new'
          : 'coll-tile is-locked');
        t.style.setProperty('--i', i);
        t.setAttribute('aria-label', catalogNewIds.has(card.id)
          ? `Nouvelle carte verrouillée, numéro ${num}`
          : `Carte verrouillée, numéro ${num}`);
        t.append(el('span', 'lock-q', '???'), el('span', 'lock-n', `N° ${String(num).padStart(3, '0')}`));
        frag.append(t);
        return;
      }
      const shown_card = st.normal ? card : st.shinyCard;
      const info = RARITIES[card.rarity] || RARITIES.common;
      const t = el('button', 'coll-tile');
      t.type = 'button';
      t.dataset.rarity = card.rarity;
      t.style.setProperty('--i', i);
      t.style.setProperty('--r-color', info.color);
      t.style.setProperty('--r-glow', info.glow);
      t.setAttribute('aria-label', `${card.name}, ${info.label}${n > 1 ? `, ${n} exemplaires` : ''}${st.shiny ? `, dont ${st.shiny} shiny` : ''}. Clic : voir en grand avec le détail normal / shiny.`);
      t.append(cardFrame(shown_card, { mini: true, lazy: true, alt: `${card.name} — ${info.label}` }));
      if (n > 1) t.append(el('span', 'coll-pill', `x${n}`));
      if (st.shiny) t.append(el('span', 'coll-shiny-dot', '✦'));
      if (fresh.has(card.id) || (st.shinyCard && fresh.has(st.shinyCard.id))) t.classList.add('is-fresh');
      on(t, 'click', () => openInspect(shown_card, st));
      frag.append(t);
    });
    collGrid.replaceChildren(frag);
    collEmpty.hidden = shown > 0;
    collEmpty.textContent = collFilter === 'all'
      ? 'Aucune carte dans la base.'
      : collFilter === 'owned'
        ? 'Rien pour l\'instant. Ouvre un booster pour commencer ta collection.'
        : 'Aucune carte de cette rareté pour l\'instant.';
  }

  tabs.forEach((t) => on(t, 'click', () => setTab(t.dataset.tab)));

  /* Shop : quantité, achats, gratuits, choix du pack à ouvrir. */
  on(freeClaim, 'click', claimFreePack);
  on(buyClassic, 'click', () => buyPacks('classic'));
  on(buyRare, 'click', () => buyPacks('rare'));
  on(buyLegend, 'click', () => buyPacks('legend'));
  on(buyVideo, 'click', () => buyPacks('video'));
  on($('buy-doubleRare'), 'click', () => buyPacks('doubleRare'));
  on($('open-doubleRare'), 'click', () => openFromInventory('doubleRare'));
  on(buyUltra, 'click', () => buyPacks('ultra'));
  function openFromInventory(type) {
    if (!(state.packStock[type] > 0) || (state.phase !== 'pack' && state.phase !== 'done')) return;
    if (state.phase === 'done') resetToPack();
    selectPackType(type);
    setTab('pack');
  }
  on(openClassic, 'click', () => openFromInventory('classic'));
  on(openRare, 'click', () => openFromInventory('rare'));
  on(openLegend, 'click', () => openFromInventory('legend'));
  on(openVideo, 'click', () => openFromInventory('video'));
  on(openUltra, 'click', () => openFromInventory('ultra'));
  on(inventoryGoShop, 'click', () => setTab('shop'));
  on($('inventory-sell-link'), 'click', () => openSellPanel());
  on(packGoShop, 'click', () => { SFX.tick(); setTab('shop'); });
  if (inventoryGrid) {
    on(inventoryGrid, 'click', (e) => {
      const sellBtn = e.target.closest('[data-sell-pack]');
      if (sellBtn) { quickSellPack(sellBtn.dataset.sellPack); return; }
      const btn = e.target.closest('[data-open-pack]');
      if (!btn || btn.disabled) return;
      openFromInventory(btn.dataset.openPack);
    });
  }
  if (shopView) {
    on(shopView, 'click', (e) => {
      const qtyBtn = e.target.closest('.qty-btn');
      if (qtyBtn) {
        const type = qtyBtn.dataset.pack;
        shopQty[type] = clamp((shopQty[type] || 1) + Number(qtyBtn.dataset.delta || 0), 1, MAX_QTY);
        SFX.tick();
        renderShop();
        return;
      }
      const chip = e.target.closest('.qty-chip');
      if (chip) {
        const type = chip.dataset.pack;
        shopQty[type] = clamp(Number(chip.dataset.qty) || 1, 1, MAX_QTY);
        SFX.tick();
        renderShop();
      }
    });
  }
  on(collFilters, 'click', (e) => {
    const chip = e.target.closest('.chip');
    if (!chip) return;
    collFilter = chip.dataset.filter;
    collFilters.querySelectorAll('.chip').forEach((c) => {
      c.classList.toggle('is-active', c === chip);
      c.setAttribute('aria-pressed', String(c === chip));
    });
    collGrid.parentElement.scrollTop = 0;
    renderCollection();
    SFX.tick();
  });
  if (collSort) {
    on(collSort, 'change', () => {
      collGrid.parentElement.scrollTop = 0;
      setCollSort(collSort.value, collSortDirFlip);
      SFX.tick();
    });
  }
  on(collSortDir, 'click', () => {
    collGrid.parentElement.scrollTop = 0;
    setCollSort(collSortKey, !collSortDirFlip);
    SFX.tick();
  });

  /* ============================ COMPTE · AMIS · ÉCHANGES ============================ */

  const accountView = $('account-view');
  const onlineView = $('online-view');
  const profileAvatar = $('profile-avatar');
  const profileAvatarFallback = $('profile-avatar-fallback');
  const avatarUploadBtn = $('avatar-upload-btn');
  const avatarInput = $('avatar-input');
  const avatarGoogleBtn = $('avatar-google-btn');
  const profilePseudo = $('profile-pseudo');
  const profileEmail = $('profile-email');
  const friendCodeEl = $('friend-code');
  const friendCodeCopy = $('friend-code-copy');
  const pseudoForm = $('pseudo-form');
  const pseudoInput = $('pseudo-input');
  const profileMsg = $('profile-msg');
  const statsGrid = $('stats-grid');
  const rarityBreakdown = $('rarity-breakdown');
  const addFriendForm = $('add-friend-form');
  const friendCodeInput = $('friend-code-input');
  const addFriendMsg = $('add-friend-msg');
  const addFriendPreview = $('add-friend-preview');
  const friendRequestsIn = $('friend-requests-in');
  const friendRequestsOut = $('friend-requests-out');
  const friendRequestsEmpty = $('friend-requests-empty');
  const friendRequestsCount = $('friend-requests-count');
  const friendsList = $('friends-list');
  const friendsEmpty = $('friends-empty');
  const friendsCount = $('friends-count');
  const friendDetail = $('friend-detail');
  const friendAvatar = $('friend-avatar');
  const friendAvatarFallback = $('friend-avatar-fallback');
  const friendPseudo = $('friend-pseudo');
  const friendCodeLabel = $('friend-code-label');
  const friendStats = $('friend-stats');
  const friendFriends = $('friend-friends');
  const friendFriendsEmpty = $('friend-friends-empty');
  const friendCards = $('friend-cards');
  const friendCardsEmpty = $('friend-cards-empty');
  const friendClose = $('friend-close');
  const confirmSheet = $('confirm-sheet');
  const confirmTitle = $('confirm-title');
  const confirmMessage = $('confirm-message');
  const confirmOk = $('confirm-ok');

  /* Profil public (playerProfiles/{uid}) : pseudo, avatar, code ami, stats et
     collection — c'est ce que les amis voient. La sauvegarde privée
     (playerSaves/{uid}) garde en plus la liste d'amis. */
  const profile = { pseudo: '', avatar: '', friendCode: '' };
  let leaderboardAnnounced = false;
  let leaderboardRequest = 0;
  let friends = [];                  // uids de mes amis (acceptés des deux côtés)
  const friendProfiles = new Map();  // uid -> profil public d'un ami
  let friendRequests = [];           // demandes d'ami où je suis destinataire
  let friendRequestsUnsub = null;
  let sentRequests = [];             // demandes d'ami que j'ai envoyées (requêtes)
  const sentRequestsByUid = new Map(); // uid -> id du document friendRequests
  const pendingFriendUids = new Set(); // uids demandés mais pas encore acceptés
  let selectedFriendUid = null;
  let confirmAction = null;
  let profileTimer = 0;
  let pseudoTimer = 0;              // auto-sauvegarde du pseudo pendant la frappe
  let rulesHelpShown = false;       // un seul toast « règles » par session
  let legacySaveKeys = false;       // sauvegarde chargée d'une ancienne version (freeDate / freeUsed encore présents)
  let cloudHasDouble = false;
  let cloudHasUltra = false;        // packStock.ultra déjà présent dans la sauvegarde cloud

  function snapshotDocs(snap) {
    if (!snap) return [];
    if (Array.isArray(snap.docs)) return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const out = [];
    if (typeof snap.forEach === 'function') snap.forEach((d) => out.push({ id: d.id, data: d.data() }));
    return out;
  }

  function serverTimestamp() {
    try {
      if (window.firebase && firebase.firestore && firebase.firestore.FieldValue) {
        return firebase.firestore.FieldValue.serverTimestamp();
      }
    } catch (error) { /* repli ci-dessous */ }
    return new Date();
  }

  /* Suppression ciblée d'un champ document : FieldValue.delete() retire la clé
     du document cloud malgré le merge, ce qui referme la principale cause
     d'« Accès cloud refusé » chez les comptes anciens (voir legacySaveKeys). */
  function deleteFieldValue() {
    try {
      if (window.firebase && firebase.firestore && firebase.firestore.FieldValue
        && typeof firebase.firestore.FieldValue.delete === 'function') {
        return firebase.firestore.FieldValue.delete();
      }
    } catch (error) { /* repli ci-dessous */ }
    return undefined;
  }

  /* Ajoute la suppression des champs hérités (freeDate / freeUsed) à une
     charge utile de set/update en merge, si la sauvegarde chargée en
     contenait. Renvoie la charge telle quelle sinon. */
  function withLegacyStrip(data) {
    if (!legacySaveKeys) return data;
    const del = deleteFieldValue();
    if (!del) return data;
    return Object.assign({}, data, { freeDate: del, freeUsed: del });
  }

  /* Nettoyage unique juste après le chargement : si la sauvegarde cloud
     contient encore les champs hérités « 3 gratuits/jour », on les supprime
     tout de suite. Sans cela, les règles (hasOnly) refusent TOUTE écriture en
     merge — le joueur voit « Accès cloud refusé » alors que l'app et les
     règles sont à jour. En cas d'échec, chaque écriture réessaie
     (withLegacyStrip). */
  async function stripLegacySaveKeys() {
    if (!legacySaveKeys || !cloudReady()) return;
    const del = deleteFieldValue();
    if (!del) return; // SDK sans FieldValue.delete : la prochaine sauvegarde réessaiera
    const uid = currentUser.uid;
    const db = cloudDb;
    try {
      await db.collection('playerSaves').doc(uid).set({ freeDate: del, freeUsed: del }, { merge: true });
      if (currentUser && currentUser.uid === uid) legacySaveKeys = false;
    } catch (error) {
      noteCloudError('Anciens champs de sauvegarde non supprimés', error);
    }
  }

  function cloudReady() {
    return Boolean(currentUser && cloudDb && typeof cloudDb.collection === 'function');
  }

  /* Les refus « permission-denied » de Firestore ne sont PAS un problème de
     connexion : ils peuvent venir des règles, de la session ou de données /
     requêtes incompatibles. On les détecte pour afficher un message au lieu
     de « vérifie ta connexion », qui envoyait les joueurs sur une mauvaise
     piste (ex. « Recherche impossible pour le moment » alors que le réseau
     fonctionnait). */
  function isPermissionDenied(error) {
    if (!error) return false;
    const code = String(error.code || '').toLowerCase().replace(/_/g, '-');
    const message = String(error.message || '');
    return code === 'permission-denied'
      || /missing or insufficient permissions/i.test(message);
  }

  const RULES_HELP = 'Accès Firestore refusé (permission-denied). Vérifie le projet Firebase, la connexion et les règles publiées ; une opération peut aussi être incompatible avec ces règles. Voir la console et le README.';

  /* Journalise l'erreur cloud et, la première fois qu'un refus de règles
     survient durant la session, affiche un toast explicite. Renvoie true
     quand il s'agissait d'un refus de règles (pour adapter le message). */
  function noteCloudError(context, error) {
    if (isPermissionDenied(error)) {
      console.warn(`${context}: accès Firestore refusé (permission-denied).`, error);
      if (!rulesHelpShown) {
        rulesHelpShown = true;
        showToast(`Accès cloud refusé : ${context}. Voir la console et le README.`);
      }
      return true;
    }
    console.warn(`${context}:`, error);
    return false;
  }

  function collectionIds() {
    return state.collection.map((c) => c.id);
  }

  /* Statistiques calculées depuis une liste d'ids de cartes + un solde. */
  function statsFor(ids, coins) {
    const owned = new Map();
    for (const id of ids) owned.set(id, (owned.get(id) || 0) + 1);
    const total = ids.length;
    const uniqueCards = CardMutations.owned(ids);
    const unique = new Set(uniqueCards.map((c) => c.baseId || c.id)).size;
    let value = 0;
    let best = null;
    for (const card of uniqueCards) {
      const n = owned.get(card.id) || 0;
      if (!n) continue;
      value += CardMutations.multiply(card, RARITIES[card.rarity] ? RARITIES[card.rarity].reward : 0) * n;
      if (!best || RARITIES[card.rarity].rank > RARITIES[best.rarity].rank) best = card;
    }
    return {
      coins: Math.max(0, Number(coins) || 0),
      total,
      unique,
      duplicates: Math.max(0, total - unique),
      value,
      best,
      completion: cardsDatabase.length ? unique / cardsDatabase.length : 0
    };
  }

  function myStats() {
    return statsFor(collectionIds(), state.coins);
  }

  /* Code ami stable, dérivé de l'uid : REFS-XXXXXX (6 caractères). */
  function friendCodeFromUid(uid) {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let h1 = 2166136261;
    let h2 = 5381;
    for (let i = 0; i < uid.length; i++) {
      const c = uid.charCodeAt(i);
      h1 = Math.imul(h1 ^ c, 16777619) >>> 0;
      h2 = (Math.imul(h2, 33) ^ c) >>> 0;
    }
    let out = '';
    for (let i = 0; i < 6; i++) {
      out += chars[(h1 + h2 * (i + 1)) % chars.length];
      h1 = (Math.imul(h1, 31) + h2) >>> 0;
    }
    return 'REFS-' + out;
  }

  function normalizeFriendCode(raw) {
    let code = String(raw || '').trim().toUpperCase().replace(/[\s-]/g, '');
    if (code.startsWith('REFS')) code = code.slice(4);
    return 'REFS-' + code;
  }

  function defaultPseudo() {
    const base = (currentUser && (currentUser.displayName || (currentUser.email || '').split('@')[0])) || 'Joueur';
    const clean = String(base).replace(/\s+/g, ' ').trim().slice(0, 24);
    return clean || 'Joueur';
  }

  /* Crée (ou retrouve) l'entrée d'annuaire friendCodes/{code} -> uid. */
  async function ensureFriendCode() {
    const chars = 'ABCDEFGHJKLMNPQRSTUVWXYZ23456789';
    let code = friendCodeFromUid(currentUser.uid);
    for (let attempt = 0; attempt < 12; attempt++) {
      let free = true;
      try {
        const snap = await cloudDb.collection('friendCodes').doc(code).get();
        free = !snap.exists || (snap.data() && snap.data().uid === currentUser.uid);
      } catch (error) { free = true; noteCloudError('Annuaire des codes ami illisible', error); }
      if (free) {
        try {
          await cloudDb.collection('friendCodes').doc(code).set({ uid: currentUser.uid });
        } catch (error) { noteCloudError('Annuaire des codes ami non créé', error); }
        return code;
      }
      const body = code.slice(5).split('');
      body[5] = chars[(chars.indexOf(body[5]) + 1) % chars.length];
      code = 'REFS-' + body.join('');
    }
    return code;
  }

  async function loadProfile() {
    if (!cloudReady()) return;
    try {
      const snap = await cloudDb.collection('playerProfiles').doc(currentUser.uid).get();
      if (snap.exists) {
        const d = snap.data() || {};
        profile.pseudo = typeof d.pseudo === 'string' ? d.pseudo : '';
        profile.avatar = typeof d.avatar === 'string' ? d.avatar : '';
        profile.friendCode = typeof d.friendCode === 'string' ? d.friendCode : '';
      }
    } catch (error) {
      noteCloudError('Profil illisible', error);
    }
    if (!profile.pseudo) profile.pseudo = defaultPseudo();
    if (!profile.friendCode) profile.friendCode = await ensureFriendCode();
    await saveProfile();
    syncHudName();
    syncHudAvatar();
    renderAccount();
    renderOnline();
  }

  /* Écrit le profil public dans Firestore et renvoie true si l'écriture a
     abouti. Les appelants (pseudo, photo) ne doivent annoncer « mis à jour »
     que sur true : sinon le joueur croit sa modification enregistrée alors
     qu'elle disparaîtra au rechargement. */
  async function saveProfile() {
    if (!cloudReady()) return false;
    /* Les règles Firestore refusent TOUT le document si friendCode ne
       matche pas ^REFS-[A-Z0-9]{6}$ : sans code valide, le pseudo et la
       photo ne seraient jamais persistés. On le régénère avant d'écrire. */
    if (!/^REFS-[A-Z0-9]{6}$/.test(profile.friendCode || '')) {
      profile.friendCode = await ensureFriendCode();
    }
    const stats = myStats();
    try {
      await cloudDb.collection('playerProfiles').doc(currentUser.uid).set({
        pseudo: profile.pseudo.slice(0, 24),
        avatar: profile.avatar || '',
        friendCode: profile.friendCode,
        coins: stats.coins,
        packsOpened: Math.max(0, Math.floor(Number(state.packsOpened) || 0)),
        totalCards: stats.total,
        uniqueCards: stats.unique,
        bestRarity: stats.best ? stats.best.rarity : null,
        collection: collectionIds(),
        /* Liste publique d'amis : c'est ce qui permet d'afficher « ses amis »
           sur le profil d'un joueur et de mettre les amis en commun devant. */
        friends: friends.slice(0, 500),
        /* Drapeau public « créateur » : seul le compte propriétaire (ADMIN_EMAIL)
           l'écrit, et c'est lui qui fait apparaître le marteau à côté de son
           pseudo chez tous les joueurs. Les règles Firestore n'autorisent
           creator: true que pour cet e-mail ; sinon le champ doit être absent
           ou false. */
        ...(isAdmin() ? { creator: true } : {}),
        updatedAt: serverTimestamp()
      }, { merge: true });
      return true;
    } catch (error) {
      noteCloudError('Profil non sauvegardé', error);
      return false;
    }
  }

  function saveProfileSoon() {
    if (!cloudReady()) return;
    window.clearTimeout(profileTimer);
    profileTimer = window.setTimeout(() => { saveProfile(); }, 600);
  }

  /* Vide les sauvegardes différées du profil (pseudo tapé, stats) quand
     l'onglet se ferme ou passe en arrière-plan, pour ne pas perdre un
     changement fait juste avant. */
  function flushProfileSaves() {
    if (profileTimer) {
      window.clearTimeout(profileTimer);
      profileTimer = 0;
      saveProfile();
    }
    if (pseudoTimer) {
      window.clearTimeout(pseudoTimer);
      pseudoTimer = 0;
      const value = (pseudoInput && pseudoInput.value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
      if (value && value !== profile.pseudo) {
        profile.pseudo = value;
        saveProfile();
      }
    }
  }

  function syncHudName() {
    if (accountEmail) {
      accountEmail.textContent = profile.pseudo || currentEmail || 'Joueur';
      withCreatorBadge(accountEmail, null);
      accountEmail.title = currentEmail || profile.pseudo || '';
    }
  }

  /* L'avatar du HUD (en haut de l'écran) suit la photo personnalisée, avec
     repli sur la photo Google. Sans ça, changer de photo ne se voyait pas
     hors de la page Compte et semblait « non sauvegardé ». */
  function syncHudAvatar() {
    if (!accountAvatar) return;
    const googlePhoto = (currentUser && currentUser.photoURL) || '';
    const src = profile.avatar || googlePhoto;
    if (src) {
      accountAvatar.src = src;
      accountAvatar.alt = `Photo de profil de ${profile.pseudo || currentEmail || 'Joueur'}`;
      accountAvatar.hidden = false;
    } else {
      accountAvatar.removeAttribute('src');
      accountAvatar.hidden = true;
    }
  }

  function setProfileMsg(msg) {
    if (profileMsg) profileMsg.textContent = msg || '';
  }

  /* Fermeture d'onglet / passage en arrière-plan : on vide les sauvegardes
     différées du profil pour ne pas perdre un pseudo ou une photo modifiés
     à la dernière seconde. */
  on(window, 'pagehide', flushProfileSaves);
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'hidden') flushProfileSaves();
  });

  function renderAccount() {
    if (!accountView) return;
    syncHudAvatar();
    renderAdminPanel();
    const stats = myStats();
    const googlePhoto = (currentUser && currentUser.photoURL) || '';
    const avatarSrc = profile.avatar || googlePhoto;
    if (profileAvatar) {
      if (avatarSrc) {
        profileAvatar.src = avatarSrc;
        profileAvatar.hidden = false;
        if (profileAvatarFallback) profileAvatarFallback.hidden = true;
      } else {
        profileAvatar.removeAttribute('src');
        profileAvatar.hidden = true;
        if (profileAvatarFallback) profileAvatarFallback.hidden = false;
      }
    }
    if (profilePseudo) {
      profilePseudo.textContent = profile.pseudo || 'Joueur';
      withCreatorBadge(profilePseudo, null);
    }
    if (profileEmail) profileEmail.textContent = currentEmail || '';
    if (friendCodeEl) friendCodeEl.textContent = profile.friendCode || 'REFS-······';
    if (pseudoInput && document.activeElement !== pseudoInput) pseudoInput.value = profile.pseudo || '';
    if (statsGrid) {
      const defs = [
        ['🪙 Pièces', fmt(stats.coins)],
        ['🃏 Cartes', fmt(stats.total)],
        ['✦ Uniques', `${stats.unique} / ${cardsDatabase.length}`],
        ['📋 Doublons', fmt(stats.duplicates)],
        ['💎 Valeur', `${fmt(stats.value)} 🪙`],
        ['👑 Meilleure', stats.best ? RARITIES[stats.best.rarity].label : '—'],
        ['📦 Boosters', fmt(state.packsOpened || 0)],
        ['👥 Amis', fmt(friends.length)],
        ['⭐ Niveau', String(levelInfo().level)],
        ['🗺️ Quêtes', `${questState.completed.length} / ${Quests.QUESTS.length}`]
      ];
      statsGrid.replaceChildren(...defs.map(([label, value]) => {
        const card = el('div', 'stat-card');
        card.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
        return card;
      }));
    }
    if (rarityBreakdown) {
      const owned = countMap();
      const rows = Object.entries(RARITIES)
        .filter(([key]) => cardsDatabase.some((c) => c.rarity === key))
        .sort((a, b) => b[1].rank - a[1].rank)
        .map(([key, info]) => {
          const n = CardMutations.owned(collectionIds())
            .filter((c) => c.rarity === key)
            .reduce((sum, c) => sum + (owned.get(c.id) || 0), 0);
          const row = el('div', 'rarity-row');
          const dot = el('i');
          dot.style.setProperty('--c', info.color);
          row.append(dot, el('span', 'rarity-name', info.label), el('span', 'rarity-n', `x${n}`));
          return row;
        });
      rarityBreakdown.replaceChildren(...rows);
    }
  }

  /* Enregistre un nouveau pseudo dans le profil cloud. L'affichage est mis
     à jour immédiatement, mais si l'écriture échoue (règles Firestore,
     connexion…), l'ancienne valeur est restaurée et un message d'erreur
     l'explique : on ne prétend jamais qu'un pseudo est sauvegardé alors
     qu'il disparaîtra au rechargement. */
  async function savePseudo(value) {
    if (!value || value === profile.pseudo) return true;
    const previous = profile.pseudo;
    profile.pseudo = value;
    syncHudName();
    renderAccount();
    const ok = await saveProfile();
    if (!ok) {
      profile.pseudo = previous;
      syncHudName();
      renderAccount();
      setProfileMsg('Sauvegarde impossible pour le moment. Ton pseudo n’a pas été enregistré — réessaie.');
      return false;
    }
    setProfileMsg('Pseudo mis à jour !');
    showToast(`Pseudo : ${value}`);
    return true;
  }

  on(pseudoForm, 'submit', async (e) => {
    e.preventDefault();
    window.clearTimeout(pseudoTimer);
    pseudoTimer = 0;
    const value = (pseudoInput.value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    if (!value) {
      setProfileMsg('Choisis un pseudo (1 à 24 caractères).');
      return;
    }
    await savePseudo(value);
  });

  /* Auto-sauvegarde : le pseudo est enregistré tout seul après la frappe
     (sans attendre le bouton « Enregistrer »), pour ne pas perdre un
     changement oublié. */
  on(pseudoInput, 'input', () => {
    /* On fige la valeur à la frappe : un rendu intervenu pendant le délai
       (800 ms) peut réinitialiser le champ, et relire le DOM à ce moment-là
       enregistrerait l'ancien pseudo au lieu de celui réellement tapé. */
    const value = (pseudoInput.value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
    window.clearTimeout(pseudoTimer);
    pseudoTimer = window.setTimeout(async () => {
      pseudoTimer = 0;
      if (!value) return;
      await savePseudo(value);
    }, 800);
  });

  on(friendCodeCopy, 'click', async () => {
    const code = profile.friendCode || '';
    if (!code) return;
    try {
      await navigator.clipboard.writeText(code);
      setProfileMsg('Code ami copié !');
    } catch (error) {
      setProfileMsg(`Ton code ami : ${code}`);
    }
  });

  /* Photo de profil : l'image est recadrée en carré et réduite (256 px JPEG)
     avant d'être stockée dans le profil public — pas besoin de Storage. */
  on(avatarUploadBtn, 'click', () => {
    if (avatarInput) avatarInput.click();
  });

  on(avatarInput, 'change', async () => {
    const file = avatarInput.files && avatarInput.files[0];
    avatarInput.value = '';
    if (!file) return;
    if (!/^image\//.test(file.type || '')) {
      setProfileMsg('Choisis une image (PNG, JPG…).');
      return;
    }
    const previous = profile.avatar;
    try {
      profile.avatar = await resizeAvatar(file, 256);
    } catch (error) {
      setProfileMsg('Impossible de lire cette image. Réessaie avec un autre fichier.');
      return;
    }
    renderAccount(); // la nouvelle photo s'affiche tout de suite, partout (page Compte + HUD)
    const ok = await saveProfile();
    if (!ok) {
      profile.avatar = previous;
      renderAccount();
      setProfileMsg('Sauvegarde impossible pour le moment. Ta photo n’a pas été enregistrée — réessaie.');
      return;
    }
    setProfileMsg('Photo de profil mise à jour !');
    showToast('Photo de profil mise à jour');
  });

  function resizeAvatar(file, size) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onerror = () => reject(new Error('lecture'));
      reader.onload = () => {
        const img = new Image();
        img.onerror = () => reject(new Error('image'));
        img.onload = () => {
          try {
            const canvas = document.createElement('canvas');
            canvas.width = size;
            canvas.height = size;
            const ctx = canvas.getContext('2d');
            const side = Math.min(img.naturalWidth, img.naturalHeight);
            const sx = (img.naturalWidth - side) / 2;
            const sy = (img.naturalHeight - side) / 2;
            ctx.drawImage(img, sx, sy, side, side, 0, 0, size, size);
            /* Les règles Firestore limitent l'avatar à 300 000 caractères :
               on baisse la qualité JPEG jusqu'à passer sous la limite, sinon
               l'écriture du profil serait refusée et la photo perdue. */
            let url = canvas.toDataURL('image/jpeg', 0.82);
            for (const quality of [0.7, 0.55, 0.4]) {
              if (url.length <= 290000) break;
              url = canvas.toDataURL('image/jpeg', quality);
            }
            resolve(url);
          } catch (error) {
            reject(error);
          }
        };
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  }

  on(avatarGoogleBtn, 'click', async () => {
    const previous = profile.avatar;
    profile.avatar = '';
    renderAccount();
    const ok = await saveProfile();
    if (!ok) {
      profile.avatar = previous;
      renderAccount();
      setProfileMsg('Sauvegarde impossible pour le moment. Ta photo n’a pas été enregistrée — réessaie.');
      return;
    }
    setProfileMsg('Ta photo Google est de nouveau utilisée.');
  });

  /* -------------------------- administration --------------------------
     Panneau réservé au compte propriétaire du jeu (ADMIN_EMAIL). Il reste
     masqué pour tous les autres joueurs et les actions passent par la
     sauvegarde habituelle (save()) : aucune notification, aucune annonce,
     aucune écriture visible par les autres joueurs — rien ne distingue ces
     modifications d'une progression normale. Les limites respectent les
     règles Firestore publiées (coins ≤ 1 Md, stock ≤ 100 000 par type,
     collection ≤ 10 000 cartes) pour que la sauvegarde soit acceptée. */
  const ADMIN_EMAIL = 'ninotelephone1006@gmail.com';
  const adminPanel = $('admin-panel');
  const adminCoins = $('admin-coins');
  const adminCoinsSet = $('admin-coins-set');
  const adminPacksOpened = $('admin-packs-opened');
  const adminPacksOpenedSet = $('admin-packs-opened-set');
  const adminPackType = $('admin-pack-type');
  const adminPackQty = $('admin-pack-qty');
  const adminPackGive = $('admin-pack-give');
  const adminCard = $('admin-card');
  const adminCardQty = $('admin-card-qty');
  const adminCardShiny = $('admin-card-shiny');
  const adminCardGive = $('admin-card-give');
  const adminMsg = $('admin-msg');

  function isAdmin() {
    return (currentEmail || '').trim().toLowerCase() === ADMIN_EMAIL;
  }

  function setAdminMsg(message) {
    if (adminMsg) adminMsg.textContent = message || '';
  }

  /* Affiche/masque le panneau et le synchronise avec l'état courant. Appelé
     à chaque rendu du compte, à la connexion et à la déconnexion : impossible
     qu'il reste visible pour un autre compte sur le même appareil. */
  function renderAdminPanel() {
    if (!adminPanel) return;
    const allowed = isAdmin();
    adminPanel.hidden = !allowed;
    if (!allowed) {
      setAdminMsg('');
      return;
    }
    /* Les champs reflètent l'état actuel, sauf pendant la saisie (un rendu
       ne doit jamais écraser ce que l'admin est en train de taper). */
    if (adminCoins && document.activeElement !== adminCoins) {
      adminCoins.value = String(Math.max(0, Math.round(Number(state.coins) || 0)));
    }
    if (adminPacksOpened && document.activeElement !== adminPacksOpened) {
      adminPacksOpened.value = String(Math.max(0, Math.floor(Number(state.packsOpened) || 0)));
    }
    /* La liste des cartes ne change jamais en cours de session : on la
       remplit une seule fois, triée par rareté puis par nom. */
    if (adminCard && !adminCard.options.length) {
      const sorted = cardsDatabase.slice().sort((a, b) =>
        ((RARITIES[a.rarity] || RARITIES.common).rank - (RARITIES[b.rarity] || RARITIES.common).rank)
        || a.name.localeCompare(b.name, 'fr'));
      adminCard.replaceChildren(...sorted.map((card) => {
        const option = document.createElement('option');
        option.value = card.id;
        option.textContent = `${card.name} (${(RARITIES[card.rarity] || RARITIES.common).label})`;
        return option;
      }));
    }
  }

  on(adminCoinsSet, 'click', () => {
    if (!isAdmin()) return;
    const value = clamp(Math.round(Number(adminCoins && adminCoins.value) || 0), 0, 1000000000);
    state.coins = value;
    updateCoins();
    renderAccount();
    save();
    setAdminMsg(`Solde défini à ${fmt(value)} 🪙.`);
  });

  on(adminPacksOpenedSet, 'click', () => {
    if (!isAdmin()) return;
    const value = Math.max(0, Math.floor(Number(adminPacksOpened && adminPacksOpened.value) || 0));
    state.packsOpened = value;
    renderAccount();
    save();
    setAdminMsg(`Compteur de boosters ouverts défini à ${fmt(value)}.`);
  });

  on(adminPackGive, 'click', () => {
    if (!isAdmin()) return;
    const type = adminPackType && isPackType(adminPackType.value) ? adminPackType.value : 'classic';
    const qty = clamp(Math.floor(Number(adminPackQty && adminPackQty.value) || 0), 1, 100000);
    state.packStock[type] = clamp((Number(state.packStock[type]) || 0) + qty, 0, 100000);
    renderShop();
    renderPackInventory();
    renderAccount();
    save();
    setAdminMsg(`${fmt(qty)} pack${qty > 1 ? 's' : ''} ${packLabelFr(type)} ajouté${qty > 1 ? 's' : ''} à ton inventaire.`);
  });

  on(adminCardGive, 'click', () => {
    if (!isAdmin()) return;
    const id = adminCard && adminCard.value;
    const cardId = adminCardShiny && adminCardShiny.checked ? `${id}::shiny` : id;
    const card = CardMutations.resolve(cardId);
    if (!card) { setAdminMsg('Carte introuvable.'); return; }
    const qty = clamp(Math.floor(Number(adminCardQty && adminCardQty.value) || 0), 1, 100);
    /* La règle Firestore plafonne la collection à 10 000 entrées : on ne
       dépasse jamais, sinon toute la sauvegarde serait refusée. */
    const n = Math.min(qty, Math.max(0, 10000 - state.collection.length));
    if (n <= 0) { setAdminMsg('Collection pleine (10 000 cartes max).'); return; }
    for (let i = 0; i < n; i++) state.collection.push(card);
    renderCollection();
    renderAccount();
    save();
    setAdminMsg(`${fmt(n)} × ${CardMutations.label(card)} ajoutée${n > 1 ? 's' : ''} à ta collection.`);
  });

  /* ------------------------------------------------------------------ amis */

  async function fetchFriendProfile(uid, { force = false } = {}) {
    if (!force && friendProfiles.has(uid)) return friendProfiles.get(uid);
    const fallback = {
      pseudo: 'Joueur', avatar: '', friendCode: '',
      coins: 0, totalCards: 0, uniqueCards: 0, bestRarity: null, collection: [], friends: [], creator: false
    };
    if (!cloudReady()) return fallback;
    try {
      const snap = await cloudDb.collection('playerProfiles').doc(uid).get();
      if (snap.exists) {
        const d = snap.data() || {};
        const data = {
          pseudo: d.pseudo || 'Joueur',
          avatar: d.avatar || '',
          friendCode: d.friendCode || '',
          coins: Number(d.coins) || 0,
          totalCards: Number(d.totalCards) || 0,
          uniqueCards: Number(d.uniqueCards) || 0,
          bestRarity: d.bestRarity || null,
          collection: Array.isArray(d.collection) ? d.collection : [],
          friends: Array.isArray(d.friends)
            ? d.friends.filter((uid) => typeof uid === 'string' && uid).slice(0, 500)
            : [],
          creator: d.creator === true
        };
        friendProfiles.set(uid, data);
        return data;
      }
    } catch (error) {
      noteCloudError('Profil ami illisible', error);
      // En cas d'échec, on garde la dernière fiche connue plutôt qu'un profil vide.
      if (friendProfiles.has(uid)) return friendProfiles.get(uid);
    }
    if (!friendProfiles.has(uid)) friendProfiles.set(uid, fallback);
    return friendProfiles.get(uid);
  }

  function setAddFriendMsg(msg) {
    if (addFriendMsg) addFriendMsg.textContent = msg || '';
  }

  /* Aperçu du joueur concerné par l'ajout (photo de profil + pseudo), juste
     sous le champ code ami : on voit QUI on vient d'ajouter / d'accepter. */
  function showAddFriendPreview(data, status) {
    if (!addFriendPreview) return;
    if (!data) {
      addFriendPreview.hidden = true;
      addFriendPreview.replaceChildren();
      return;
    }
    const identity = friendIdentity(data);
    const sub = identity.querySelector('.friend-row-sub');
    if (sub) sub.textContent = status || '';
    addFriendPreview.replaceChildren(identity);
    addFriendPreview.hidden = false;
  }

  /* ------------------------------------------- demandes d'ami (acceptation)
     Ajouter quelqu'un ne crée plus un ami dans le dos de l'autre joueur :
     cela envoie une DEMANDE (friendRequests/{fromUid}__{toUid}). Le
     destinataire la voit dans « Demandes reçues » et doit l'accepter ; une
     fois acceptée, les deux joueurs ont chacun l'autre dans sa liste
     d'amis (chacun écrit la sienne, les règles Firestore restant
     « propriétaire uniquement »). L'expéditeur applique sa moitié dès qu'il
     voit la demande acceptée — tout de suite s'il est en ligne, sinon à sa
     prochaine connexion. */

  function friendRequestId(fromUid, toUid) {
    return `${fromUid}__${toUid}`;
  }

  /* Ajoute un uid à ma liste d'amis locale + cloud. Renvoie true si c'est un
     nouvel ami. */
  async function addFriendToList(uid, { announce = true } = {}) {
    if (!uid || uid === (currentUser && currentUser.uid)) return false;
    pendingFriendUids.delete(uid);
    if (friends.includes(uid)) return false;
    friends.push(uid);
    save();
    const data = await fetchFriendProfile(uid);
    if (announce) showToast(`${data.pseudo} : vous êtes maintenant amis !`);
    renderOnline();
    /* Quête « Premier contact », « Popularité » + succès amis. */
    trackProgress();
    return true;
  }

  function applyRequestDoc(id, d) {
    return { id, ...d };
  }

  /* Charge mes demandes reçues (en attente) et envoyées. Traite aussi les
     demandes que J'AI envoyées et qui ont été acceptées pendant que j'étais
     hors ligne : elles deviennent des amis à ce moment-là. */
  async function loadFriendRequests() {
    if (!cloudReady()) return;
    const coll = cloudDb.collection('friendRequests');
    if (!coll || typeof coll.where !== 'function') return;
    const uid = currentUser.uid;
    let incoming = [];
    let outgoing = [];
    try {
      const [inSnap, outSnap] = await Promise.all([
        coll.where('toUid', '==', uid).get(),
        coll.where('fromUid', '==', uid).get()
      ]);
      incoming = snapshotDocs(inSnap).map((d) => applyRequestDoc(d.id, d.data));
      outgoing = snapshotDocs(outSnap).map((d) => applyRequestDoc(d.id, d.data));
    } catch (error) {
      noteCloudError('Demandes d’ami illisibles', error);
      return;
    }
    await ingestFriendRequests(incoming, outgoing);
  }

  /* Met à jour l'état local à partir des documents reçus, puis rafraîchit. */
  const friendRemovalInFlight = new Set();
  const removedFriendsThisSession = new Set();
  let knownRequestIds = new Set(); // pour n'annoncer que les NOUVELLES demandes
  let hadRequests = false;         // false = premier chargement (pas de toast au démarrage)
  async function ingestFriendRequests(incoming, outgoing) {
    const uid = currentUser && currentUser.uid;
    if (!uid) return;
    friendRequests = incoming
      .filter((r) => r.status === 'pending' && r.toUid === uid)
      .sort((a, b) => String(a.createdAt || '').localeCompare(String(b.createdAt || '')));
    sentRequests = outgoing.filter((r) => r.fromUid === uid);

    // Mes demandes envoyées : index + uids encore en attente.
    sentRequestsByUid.clear();
    pendingFriendUids.clear();
    for (const r of sentRequests) {
      if (r.status === 'pending') {
        sentRequestsByUid.set(r.toUid, r.id);
        pendingFriendUids.add(r.toUid);
      }
    }
    /* Une demande acceptée fait foi pour les deux joueurs, même si un ancien
       client a marqué applied avant d'enregistrer la liste. Cela répare aussi
       les sauvegardes interrompues ou échouées. Une suppression volontaire
       est conservée dans removedBy sur la demande. */
    const accepted = [...incoming, ...outgoing].filter((r) =>
      r.status === 'accepted' && (r.fromUid === uid || r.toUid === uid)
      && !(r.removedBy && r.removedBy[uid]));
    const unknown = new Set();
    friendRequests.forEach((r) => unknown.add(r.fromUid));
    pendingFriendUids.forEach((otherUid) => unknown.add(otherUid));
    for (const otherUid of unknown) {
      if (!currentUser || currentUser.uid !== uid) return;
      if (!friendProfiles.has(otherUid)) await fetchFriendProfile(otherUid);
    }

    for (const r of accepted) {
      if (!currentUser || currentUser.uid !== uid) return;
      const otherUid = r.fromUid === uid ? r.toUid : r.fromUid;
      if (!otherUid || friendRemovalInFlight.has(otherUid) || removedFriendsThisSession.has(otherUid)) continue;
      await addFriendToList(otherUid, { announce: true });
    }
    if (!currentUser || currentUser.uid !== uid) return;
    /* Nouvelle demande reçue pendant la session : on prévient tout de suite
       (le joueur peut accepter depuis « Demandes reçues »). */
    const fresh = friendRequests.filter((r) => !knownRequestIds.has(r.id));
    knownRequestIds = new Set(friendRequests.map((r) => r.id));
    if (fresh.length && hadRequests) {
      const who = friendProfiles.get(fresh[0].fromUid);
      const name = who ? who.pseudo : 'Un joueur';
      showToast(`${name} veut t’ajouter en ami — va dans « En ligne » pour accepter.`, 4200);
      /* Notification persistante : la demande survit à la fermeture de la page. */
      pushNotification('friend', 'Demande d’ami reçue',
        `${name} veut t’ajouter en ami. Accepte-la dans « En ligne → Demandes reçues ».`);
    }
    /* Demande reçue pendant que le jeu tournait (toast + cloche ci-dessus) :
       la notification système suit, hors jeu et une seule fois par demande. */
    if (fresh.length && hadRequests) {
      fresh.forEach((r) => {
        const name = (friendProfiles.get(r.fromUid) || {}).pseudo || 'Un joueur';
        notifyKind('friends', 'Demande d’ami', `${name} veut t’ajouter en ami. Accepte-la dans « En ligne → Demandes reçues ».`, { tag: r.id });
      });
    }
    hadRequests = true;
    renderOnline();
  }

  async function updateFriendRequest(id, patch) {
    if (!cloudReady()) return false;
    try {
      await cloudDb.collection('friendRequests').doc(id).update(patch);
      return true;
    } catch (error) {
      noteCloudError('Demande d’ami non mise à jour', error);
      return false;
    }
  }

  function subscribeFriendRequests() {
    if (!cloudReady() || friendRequestsUnsub) return;
    const coll = cloudDb.collection('friendRequests');
    if (!coll || typeof coll.where !== 'function') return;
    const uid = currentUser.uid;
    try {
      const q1 = coll.where('toUid', '==', uid);
      const q2 = coll.where('fromUid', '==', uid);
      if (typeof q1.onSnapshot !== 'function') return;
      // Une demande acceptée doit arriver même si l'onglet est resté ouvert.
      const incoming = new Map();
      const outgoing = new Map();
      const flush = () => {
        ingestFriendRequests([...incoming.values()], [...outgoing.values()])
          .catch(() => { /* signalé par noteCloudError */ });
      };
      const watch = (query, map) => query.onSnapshot(
        (snap) => {
          for (const d of snapshotDocs(snap)) {
            const data = applyRequestDoc(d.id, d.data);
            if (data.status === 'cancelled' || data.status === 'declined') map.delete(d.id);
            else map.set(d.id, data);
          }
          flush();
        },
        (error) => noteCloudError('Demandes d’ami illisibles (temps réel)', error)
      );
      const un1 = watch(q1, incoming);
      const un2 = watch(q2, outgoing);
      friendRequestsUnsub = () => {
        try { if (un1) un1(); } catch (error) { /* déjà fermé */ }
        try { if (un2) un2(); } catch (error) { /* déjà fermé */ }
      };
    } catch (error) { /* temps réel indisponible : loadFriendRequests suffit */ }
  }

  /* Envoie une demande d'ami. Si la personne m'avait déjà envoyé une demande
     en attente, on l'accepte directement : les deux deviennent amis. */
  async function sendFriendRequest(uid) {
    const mine = currentUser.uid;
    const id = friendRequestId(mine, uid);
    try {
      /* Demande inverse déjà en attente ? On s'accepte mutuellement. On
         regarde d'abord les demandes reçues déjà chargées (temps réel) ;
         la lecture cloud n'est qu'un filet de sécurité et, si elle échoue
         (document absent + anciennes règles => permission-denied), on
         continue simplement avec l'envoi d'une demande. */
      let reverse = friendRequests.find((r) => r.fromUid === uid && r.status === 'pending') || null;
      if (!reverse) {
        try {
          const reverseSnap = await cloudDb.collection('friendRequests').doc(friendRequestId(uid, mine)).get();
          if (reverseSnap && reverseSnap.exists) reverse = { id: friendRequestId(uid, mine), ...(reverseSnap.data() || {}) };
        } catch (error) {
          console.warn('Lecture de la demande inverse impossible, envoi direct.', error);
        }
      }
      if (reverse && reverse.status === 'pending' && reverse.fromUid === uid && reverse.toUid === mine) {
        await acceptFriendRequest({ ...reverse, id: reverse.id || friendRequestId(uid, mine) });
        setAddFriendMsg('Vous vous étiez déjà ajoutés : vous êtes maintenant amis !');
        return true;
      }
      await cloudDb.collection('friendRequests').doc(id).set({
        fromUid: mine,
        toUid: uid,
        status: 'pending',
        createdAt: serverTimestamp(),
        applied: {}
      });
      removedFriendsThisSession.delete(uid);
      pendingFriendUids.add(uid);
      sentRequestsByUid.set(uid, id);
      const data = await fetchFriendProfile(uid);
      showAddFriendPreview(data, 'Demande envoyée · en attente d’acceptation');
      setAddFriendMsg(`Demande envoyée à ${data.pseudo}. Elle doit l’accepter pour que vous soyez amis.`);
      showToast(`Demande d’ami envoyée à ${data.pseudo}`);
      renderOnline();
      return true;
    } catch (error) {
      if (isPermissionDenied(error)) {
        setAddFriendMsg(RULES_HELP);
      } else {
        setAddFriendMsg('Impossible d’envoyer la demande. Vérifie ta connexion et réessaie.');
      }
      return false;
    }
  }

  async function acceptFriendRequest(request) {
    if (!request || !request.fromUid) return;
    const uid = currentUser.uid;
    /* On écrit d'abord l'acceptation dans le cloud : si elle échoue, on
       n'ajoute PAS l'ami (sinon l'amitié n'existerait que d'un côté et
       disparaîtrait au rechargement). */
    const ok = await updateFriendRequest(request.id, {
      status: 'accepted',
      applied: { ...(request.applied || {}), [uid]: true }
    });
    if (!ok) {
      setAddFriendMsg('Acceptation impossible pour le moment (règles Firestore ou connexion). Réessaie.');
      renderOnline();
      return;
    }
    removedFriendsThisSession.delete(request.fromUid);
    friendRequests = friendRequests.filter((r) => r.id !== request.id);
    const data = await fetchFriendProfile(request.fromUid);
    await addFriendToList(request.fromUid, { announce: false });
    showAddFriendPreview(data, 'Vous êtes maintenant amis');
    setAddFriendMsg(`${data.pseudo} a été accepté : vous êtes amis.`);
    showToast(`${data.pseudo} et toi êtes maintenant amis !`);
    renderOnline();
  }

  async function declineFriendRequest(request) {
    const ok = await updateFriendRequest(request.id, { status: 'declined', applied: request.applied || {} });
    if (!ok) {
      setAddFriendMsg('Refus impossible pour le moment. Réessaie.');
      renderOnline();
      return;
    }
    friendRequests = friendRequests.filter((r) => r.id !== request.id);
    showToast('Demande refusée.');
    renderOnline();
  }

  async function cancelFriendRequest(uid) {
    const id = sentRequestsByUid.get(uid);
    if (!id) return;
    await updateFriendRequest(id, { status: 'cancelled' });
    pendingFriendUids.delete(uid);
    sentRequestsByUid.delete(uid);
    sentRequests = sentRequests.filter((r) => r.toUid !== uid);
    showToast('Demande annulée.');
    renderOnline();
  }

  async function submitFriendCode() {
    if (!cloudReady()) {
      setAddFriendMsg('Connecte-toi pour ajouter des amis.');
      return;
    }
    const code = normalizeFriendCode(friendCodeInput.value);
    if (!/^REFS-[A-Z0-9]{6}$/.test(code)) {
      setAddFriendMsg('Code invalide : il ressemble à REFS-XXXXXX.');
      return;
    }
    setAddFriendMsg('Recherche de ton ami…');
    showAddFriendPreview(null);
    try {
      const snap = await cloudDb.collection('friendCodes').doc(code).get();
      if (!snap.exists) {
        setAddFriendMsg('Aucun joueur trouvé avec ce code. Vérifie-le et réessaie.');
        return;
      }
      const uid = snap.data() && snap.data().uid;
      if (!uid) {
        setAddFriendMsg('Aucun joueur trouvé avec ce code.');
        return;
      }
      if (uid === currentUser.uid) {
        setAddFriendMsg('C’est ton propre code ami !');
        return;
      }
      const found = await fetchFriendProfile(uid);
      if (friends.includes(uid)) {
        showAddFriendPreview(found, 'Déjà dans ta liste d’amis');
        setAddFriendMsg('Cet ami est déjà dans ta liste.');
        return;
      }
      if (pendingFriendUids.has(uid)) {
        showAddFriendPreview(found, 'Demande déjà envoyée · en attente');
        setAddFriendMsg('Une demande est déjà en attente pour ce joueur.');
        return;
      }
      showAddFriendPreview(found, 'Joueur trouvé · envoi de la demande…');
      const sent = await sendFriendRequest(uid);
      if (sent) friendCodeInput.value = '';
    } catch (error) {
      if (isPermissionDenied(error)) setAddFriendMsg(RULES_HELP);
      else setAddFriendMsg('Recherche impossible pour le moment. Vérifie ta connexion.');
    }
  }

  on(addFriendForm, 'submit', (e) => {
    e.preventDefault();
    submitFriendCode();
  });

  /* Sous-onglets de la page En ligne : un seul panneau visible à la fois, donc
     plus besoin de faire défiler tout le marché, le formulaire de vente, les
     cadeaux et les amis pour trouver ce qu'on cherche. `onlinePanel` garde
     l'onglet courant pour le rouvrir tel quel à la prochaine visite. */
  let onlinePanel = 'market';
  const onlineTabs = [...document.querySelectorAll('[data-online-tab]')];
  const onlineTabCounts = {
    market: $('online-tab-count-market'),
    sell: $('online-tab-count-sell'),
    inbox: $('online-tab-count-inbox'),
    friends: $('online-tab-count-friends'),
    games: $('online-tab-count-games')
  };

  function setOnlineTab(panel, { scroll = false } = {}) {
    if (!onlineView) return;
    const panels = [...onlineView.querySelectorAll('[data-online-panel]')];
    const known = panels.some((p) => p.dataset.onlinePanel === panel);
    onlinePanel = known ? panel : 'market';
    panels.forEach((p) => {
      const active = p.dataset.onlinePanel === onlinePanel;
      p.hidden = !active;
      p.classList.toggle('is-active', active);
    });
    onlineTabs.forEach((tab) => {
      const active = tab.dataset.onlineTab === onlinePanel;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
    });
    if (onlinePanel === 'leaderboard') loadLeaderboard();
    if (scroll) {
      const scroller = onlineView.querySelector('.page-scroll');
      if (scroller) scroller.scrollTop = 0;
    }
  }

  /* Deux requêtes indexées, limitées indépendamment : les profils sans le
     compteur (anciens clients) rejoignent le classement à leur reconnexion. */
  async function loadLeaderboard() {
    const coinsList = $('leaderboard-coins');
    const packsList = $('leaderboard-packs');
    if (!coinsList || !packsList || !cloudReady()) return;
    const uid = currentUser.uid;
    const request = ++leaderboardRequest;
    const lists = [
      { field: 'coins', node: coinsList, unit: '🪙' },
      { field: 'packsOpened', node: packsList, unit: 'boosters' }
    ];
    lists.forEach(({ node }) => node.replaceChildren(el('p', 'online-empty', 'Chargement du classement…')));
    await Promise.all(lists.map(async ({ field, node, unit }) => {
      try {
        const snap = await cloudDb.collection('playerProfiles').orderBy(field, 'desc').limit(20).get();
        if (!currentUser || currentUser.uid !== uid || request !== leaderboardRequest) return;
        const entries = snapshotDocs(snap).filter(({ data }) => data && Number.isFinite(data[field]) && data[field] >= 0);
        if (!entries.length) {
          node.replaceChildren(el('p', 'online-empty', 'Aucun joueur classé pour le moment.'));
          return;
        }
        const list = el('ol', 'leaderboard-list');
        entries.forEach(({ id, data }, index) => {
          const row = el('li', 'leaderboard-row');
          const rank = el('span', 'leaderboard-rank', `#${index + 1}`);
          const name = el('strong', 'leaderboard-name', typeof data.pseudo === 'string' && data.pseudo.trim() ? data.pseudo : 'Joueur');
          withCreatorBadge(name, data);
          if (id === uid) name.append(el('span', 'leaderboard-you', ' · Toi'));
          const value = el('span', 'leaderboard-value', `${fmt(data[field])} ${unit}`);
          row.append(rank, name, value);
          list.append(row);
        });
        node.replaceChildren(list);
      } catch (error) {
        if (!currentUser || currentUser.uid !== uid || request !== leaderboardRequest) return;
        noteCloudError('Classement illisible', error);
        node.replaceChildren(el('p', 'online-empty', 'Classement indisponible. Réessaie avec Actualiser.'));
      }
    }));
  }
  on($('leaderboard-refresh'), 'click', loadLeaderboard);

  /* Raccourci « vendre » : on amène directement sur l'onglet Vendre. */
  function openSellPanel() {
    setTab('online');
    setOnlineTab('sell', { scroll: true });
  }

  function setTabCount(node, value) {
    if (!node) return;
    const n = Number(value) || 0;
    node.textContent = n > 0 ? String(n) : '';
    node.hidden = n <= 0;
  }

  function updateOnlineTabCounts() {
    const myOpen = marketListings.filter((l) => l.status === 'open').length;
    const income = marketListings.filter((l) => l.status === 'sold').length
      + marketGifts.filter((g) => g.status === 'pending').length
      + receivedOffers.filter((o) => o.status === 'pending' && o.turn === 'seller').length
      + sentOffers.filter((o) => (o.status === 'pending' && o.turn === 'buyer') || o.status === 'accepted').length;
    const requests = friendRequests.length + sentRequests.length;
    setTabCount(onlineTabCounts.market, globalMarketCount ? globalMarketCount.textContent : 0);
    setTabCount(onlineTabCounts.sell, myOpen);
    setTabCount(onlineTabCounts.inbox, income);
    setTabCount(onlineTabCounts.friends, requests);
    /* Onglet Jeux : défis à relever + gains à récupérer. */
    const me = currentUser && currentUser.uid;
    const gameAlerts = me ? flipGames.filter((g) =>
      (g.status === 'pending' && g.toUid === me)
      || (g.status === 'finished' && g.winnerUid === me)
      || (g.status === 'declined' && g.fromUid === me)).length : 0;
    setTabCount(onlineTabCounts.games, gameAlerts);
    setTabCount($('my-listings-count'), myOpen);
  }

  onlineTabs.forEach((tab) => {
    on(tab, 'click', () => {
      if (onlinePanel === tab.dataset.onlineTab) return;
      setOnlineTab(tab.dataset.onlineTab, { scroll: true });
      SFX.tick();
    });
  });
  onlineTabs.forEach((tab) => on(tab, 'keydown', (e) => {
    const step = e.key === 'ArrowRight' ? 1 : e.key === 'ArrowLeft' ? -1 : 0;
    if (!step) return;
    e.preventDefault();
    const index = onlineTabs.indexOf(tab);
    const next = onlineTabs[(index + step + onlineTabs.length) % onlineTabs.length];
    if (!next) return;
    setOnlineTab(next.dataset.onlineTab, { scroll: true });
    next.focus();
  }));
  setOnlineTab(onlinePanel);

  function renderOnline() {
    if (!onlineView) return;
    renderMarket();
    renderGlobalMarket();
    if (friendsCount) friendsCount.textContent = String(friends.length);
    if (friendsEmpty) friendsEmpty.hidden = friends.length > 0;
    if (friendsList) {
      const frag = document.createDocumentFragment();
      friends.forEach((uid) => {
        if (!friendProfiles.has(uid)) {
          const owner = currentUser && currentUser.uid;
          fetchFriendProfile(uid).then(() => {
            if (currentUser && currentUser.uid === owner && friends.includes(uid)) renderOnline();
          });
        }
        const data = friendProfiles.get(uid) || {
          pseudo: 'Joueur', avatar: '', totalCards: 0, uniqueCards: 0
        };
        const row = el('div', 'friend-row');
        const img = el('img', 'friend-row-avatar');
        img.alt = '';
        if (data.avatar) img.src = data.avatar;
        else img.hidden = true;
        const fb = el('span', 'friend-row-fallback', (data.pseudo || '?').slice(0, 1).toUpperCase());
        if (data.avatar) fb.hidden = true;
        const idBox = el('div', 'friend-row-id');
        idBox.append(
          withCreatorBadge(el('strong', 'friend-row-pseudo', data.pseudo || 'Joueur'), data),
          el('span', 'friend-row-sub', `${data.uniqueCards || 0} uniques · ${data.totalCards || 0} cartes`)
        );
        const view = el('button', 'mini-btn', 'Voir');
        view.type = 'button';
        on(view, 'click', () => openFriendDetail(uid));
        const remove = el('button', 'mini-btn danger', 'Retirer');
        remove.type = 'button';
        on(remove, 'click', () => removeFriend(uid));
        row.append(img, fb, idBox, view, remove);
        frag.append(row);
      });
      friendsList.replaceChildren(frag);
    }
    renderFriendRequests();
    if (selectedFriendUid) renderFriendDetail(selectedFriendUid);
    renderFlipGames();
    updateOnlineTabCounts();
  }

  /* Mémorise une suppression explicite sur toutes les demandes acceptées
     entre ces joueurs avant d'enlever l'ami localement. Ainsi la réparation
     ne ressuscite pas cette amitié à la prochaine connexion. */
  async function removeFriend(otherUid) {
    if (!cloudReady() || friendRemovalInFlight.has(otherUid)) return;
    const uid = currentUser.uid;
    friendRemovalInFlight.add(otherUid);
    try {
      const coll = cloudDb.collection('friendRequests');
      const [incoming, outgoing] = await Promise.all([
        coll.where('toUid', '==', uid).get(),
        coll.where('fromUid', '==', uid).get()
      ]);
      const requests = [...snapshotDocs(incoming), ...snapshotDocs(outgoing)].filter(({ data }) =>
        data.status === 'accepted' &&
        ((data.fromUid === uid && data.toUid === otherUid) || (data.toUid === uid && data.fromUid === otherUid)));
      // Les UID des comptes Google Firebase sont alphanumériques ; la mise à
      // jour ciblée ne remplace pas les éventuelles suppressions de l'autre.
      for (const request of requests) {
        await coll.doc(request.id).update({ [`removedBy.${uid}`]: true });
      }
      if (!currentUser || currentUser.uid !== uid) return;
      removedFriendsThisSession.add(otherUid);
      friends = friends.filter((u) => u !== otherUid);
      save();
      if (selectedFriendUid === otherUid) closeFriendDetail();
      renderOnline();
      showToast('Ami retiré');
    } catch (error) {
      noteCloudError('Suppression de l’ami impossible', error);
      showToast('Impossible de retirer cet ami. Vérifie ta connexion et réessaie.');
    } finally {
      friendRemovalInFlight.delete(otherUid);
    }
  }

  /* Demandes reçues (Accepter / Refuser) et envoyées (en attente / Annuler).
     Rien n'est « ami » tant que le destinataire n'a pas accepté. */
  function renderFriendRequests() {
    if (friendRequestsCount) friendRequestsCount.textContent = String(friendRequests.length);
    if (friendRequestsEmpty) friendRequestsEmpty.hidden = friendRequests.length > 0;

    if (friendRequestsIn) {
      friendRequestsIn.replaceChildren(...friendRequests.map((request) => {
        const data = friendProfiles.get(request.fromUid) || { pseudo: 'Joueur', avatar: '' };
        const row = el('div', 'request-row');
        row.append(friendIdentity(data));
        const actions = el('div', 'request-actions');
        const ok = el('button', 'mini-btn primary', 'Accepter');
        ok.type = 'button';
        ok.setAttribute('aria-label', `Accepter la demande d’ami de ${data.pseudo || 'ce joueur'}`);
        on(ok, 'click', () => {
          ok.disabled = true;
          acceptFriendRequest(request);
        });
        const no = el('button', 'mini-btn danger', 'Refuser');
        no.type = 'button';
        on(no, 'click', () => declineFriendRequest(request));
        actions.append(ok, no);
        row.append(actions);
        return row;
      }));
    }

    if (friendRequestsOut) {
      const waiting = [...pendingFriendUids];
      if (!waiting.length) {
        friendRequestsOut.replaceChildren(el('p', 'online-empty', 'Aucune demande envoyée en attente.'));
      } else {
        friendRequestsOut.replaceChildren(...waiting.map((uid) => {
          const data = friendProfiles.get(uid) || { pseudo: 'Joueur', avatar: '' };
          const row = el('div', 'request-row');
          row.append(friendIdentity(data), el('span', 'request-status', 'En attente d’acceptation…'));
          const cancel = el('button', 'mini-btn', 'Annuler');
          cancel.type = 'button';
          on(cancel, 'click', () => cancelFriendRequest(uid));
          row.append(cancel);
          return row;
        }));
      }
    }
  }

  /* Pastille avatar + pseudo, brique commune des listes d'amis/demandes. */
  function friendIdentity(data) {
    const box = el('div', 'friend-row-id');
    const img = el('img', 'friend-row-avatar');
    img.alt = '';
    if (data && data.avatar) img.src = data.avatar;
    else img.hidden = true;
    const fb = el('span', 'friend-row-fallback', ((data && data.pseudo) || '?').slice(0, 1).toUpperCase());
    if (data && data.avatar) fb.hidden = true;
    box.append(
      withCreatorBadge(el('strong', 'friend-row-pseudo', (data && data.pseudo) || 'Joueur'), data),
      el('span', 'friend-row-sub', `${(data && data.uniqueCards) || 0} uniques · ${(data && data.totalCards) || 0} cartes`)
    );
    const wrap = el('div', 'request-id');
    wrap.append(img, fb, box);
    return wrap;
  }

  async function openFriendDetail(uid) {
    selectedFriendUid = uid;
    // La fiche détaillée vit dans le sous-onglet « Amis » : on y bascule, sinon
    // le joueur cliquerait « Voir » sans rien voir apparaître.
    setOnlineTab('friends', { scroll: true });
    if (friendDetail) friendDetail.hidden = false;
    // Toujours relire la fiche : le solde affiché doit refléter les pièces
    // reçues (sinon on croit que le transfert n'a rien changé).
    await fetchFriendProfile(uid, { force: true });
    if (selectedFriendUid !== uid) return;
    renderFriendDetail(uid);
    loadFriendListings(uid);
    try {
      if (friendDetail && typeof friendDetail.scrollIntoView === 'function') {
        friendDetail.scrollIntoView({ behavior: reduceMotion.matches ? 'auto' : 'smooth', block: 'start' });
      }
    } catch (error) { /* défilement indisponible : sans gravité */ }
  }

  function closeFriendDetail() {
    selectedFriendUid = null;
    if (friendDetail) friendDetail.hidden = true;
  }

  /* Amis d'un autre joueur, avec ceux qu'on a en commun en premier. Leurs
     profils publics sont chargés à la demande (les amis en commun sont déjà
     en cache) ; la fiche se redessine quand un pseudo/avatar arrive. */
  const friendFriendsFetching = new Set();

  function renderFriendFriends(uid) {
    if (!friendFriends) return;
    const data = friendProfiles.get(uid);
    const mine = currentUser && currentUser.uid;
    const others = ((data && data.friends) || [])
      .filter((other) => other !== uid && other !== mine)
      .map((other) => ({ uid: other, mutual: friends.includes(other) }))
      .sort((a, b) => {
        if (a.mutual !== b.mutual) return a.mutual ? -1 : 1;
        const pa = friendProfiles.get(a.uid);
        const pb = friendProfiles.get(b.uid);
        return String((pa && pa.pseudo) || 'Joueur').localeCompare(
          String((pb && pb.pseudo) || 'Joueur'), 'fr', { sensitivity: 'base' }
        );
      });
    if (friendFriendsEmpty) friendFriendsEmpty.hidden = others.length > 0;
    const frag = document.createDocumentFragment();
    others.forEach(({ uid: otherUid, mutual }) => {
      const info = friendProfiles.get(otherUid) || { pseudo: 'Joueur', avatar: '' };
      const row = el('div', 'friend-row friend-friends-row');
      row.append(friendIdentity(info));
      if (mutual) row.append(el('span', 'friend-mutual-tag', 'En commun'));
      const view = el('button', 'mini-btn', 'Profil');
      view.type = 'button';
      view.setAttribute('aria-label', `Voir le profil de ${info.pseudo || 'ce joueur'}`);
      on(view, 'click', () => openFriendDetail(otherUid));
      row.append(view);
      frag.append(row);
      if (!friendProfiles.has(otherUid) && !friendFriendsFetching.has(otherUid)) {
        friendFriendsFetching.add(otherUid);
        fetchFriendProfile(otherUid).then(() => {
          friendFriendsFetching.delete(otherUid);
          if (selectedFriendUid === uid && friendProfiles.has(uid)) renderFriendDetail(uid);
        });
      }
    });
    friendFriends.replaceChildren(frag);
  }

  function renderFriendDetail(uid) {
    const data = friendProfiles.get(uid);
    if (!data || !friendDetail) return;
    if (friendAvatar) {
      if (data.avatar) {
        friendAvatar.src = data.avatar;
        friendAvatar.hidden = false;
        if (friendAvatarFallback) friendAvatarFallback.hidden = true;
      } else {
        friendAvatar.removeAttribute('src');
        friendAvatar.hidden = true;
        if (friendAvatarFallback) friendAvatarFallback.hidden = false;
      }
    }
    if (friendPseudo) {
      friendPseudo.textContent = data.pseudo || 'Joueur';
      withCreatorBadge(friendPseudo, data);
    }
    if (friendCodeLabel) friendCodeLabel.textContent = data.friendCode ? `Code ami · ${data.friendCode}` : '';
    if (friendStats) {
      const stats = statsFor(data.collection, data.coins);
      const defs = [
        ['🪙 Pièces', fmt(stats.coins)],
        ['🃏 Cartes', fmt(stats.total)],
        ['✦ Uniques', `${stats.unique} / ${cardsDatabase.length}`],
        ['👑 Meilleure', stats.best ? RARITIES[stats.best.rarity].label : '—']
      ];
      friendStats.replaceChildren(...defs.map(([label, value]) => {
        const card = el('div', 'stat-card');
        card.append(el('span', 'stat-label', label), el('span', 'stat-value', value));
        return card;
      }));
    }
    renderFriendFriends(uid);
    if (friendCards) {
      const owned = new Map();
      for (const id of data.collection) owned.set(id, (owned.get(id) || 0) + 1);
      const ownedCards = CardMutations.owned([...owned.keys()]);
      friendCards.replaceChildren(...ownedCards.map((card, i) => {
        const info = RARITIES[card.rarity] || RARITIES.common;
        const tile = el('div', 'friend-card');
        tile.style.setProperty('--i', i);
        tile.style.setProperty('--r-color', info.color);
        tile.style.setProperty('--r-glow', info.glow);
        /* cardFrame() est en position:absolute : sans ce cadre au ratio 5:7,
           les cartes se superposaient et débordaient de la fiche ami. */
        const frame = el('span', 'friend-card-frame');
        frame.append(cardFrame(card, { mini: true, alt: `${card.name} — ${info.label}` }));
        const n = owned.get(card.id) || 0;
        if (n > 1) frame.append(el('span', 'coll-pill', `x${n}`));
        tile.append(frame);
        /* Pas de bouton « Échanger » : on ne peut plus demander une carte
           à un ami. Pour obtenir une de ses cartes, il faut l'acheter dans
           son marché (voir « Son marché » ci-dessus). */
        return tile;
      }));
      if (friendCardsEmpty) friendCardsEmpty.hidden = ownedCards.length > 0;
    }
  }

  on(friendClose, 'click', closeFriendDetail);

  /* --------------------------------------------- fenêtres d'achat / confirmation */

  /* Fenêtres ouvertes hors du contrôle générique de openSheet() (annonces du
     catalogue et promos) : utilisé par maybeAskPush() pour ne jamais empiler
     la question des notifications par-dessus une annonce. */
  function otherSheetOpen() {
    return [newCardsSheet, promoSheet, $('double-promo-sheet'), $('flip-overlay')]
      .some((sheet) => sheet && !sheet.hidden);
  }

  function openSheet(sheet) {
    if (!sheet) return;
    sheet.hidden = false;
    void sheet.offsetWidth;
    sheet.classList.add('is-open');
  }

  function closeSheet(sheet) {
    if (!sheet) return;
    sheet.classList.remove('is-open');
    sheet.hidden = true;
  }

  function askConfirm({ title, message, confirmLabel, onConfirm }) {
    const offerLabel = $('offer-price-label');
    if (offerLabel) offerLabel.hidden = true;
    if (confirmTitle) confirmTitle.textContent = title || 'Confirmer ?';
    if (confirmMessage) confirmMessage.textContent = message || '';
    if (confirmOk) confirmOk.textContent = confirmLabel || 'Confirmer';
    confirmAction = onConfirm || null;
    openSheet(confirmSheet);
  }

  function askOfferPrice(title, message, max, callback) {
    askConfirm({ title, message, confirmLabel: 'Envoyer', onConfirm: () => {
      try {
        const price = marketNumber($('offer-price'), 0);
        if (price >= max) throw new Error('Le prix doit être inférieur au prix de l’annonce.');
        callback(price);
      } catch (error) { marketInfo(error.message); }
    }});
    const label = $('offer-price-label');
    const input = $('offer-price');
    if (label && input) { label.hidden = false; input.value = ''; input.max = String(max - 1); input.focus(); }
  }

  on(confirmOk, 'click', () => {
    const action = confirmAction;
    confirmAction = null;
    closeSheet(confirmSheet);
    if (action) action();
  });

  [confirmSheet].forEach((sheet) => {
    if (!sheet) return;
    sheet.querySelectorAll('[data-close]').forEach((b) => on(b, 'click', () => closeSheet(sheet)));
  });

  /* Demandes d'échange désactivées : les joueurs ne peuvent plus demander
     une carte précise à un ami. Le seul moyen d'obtenir une carte d'un ami
     est d'acheter une annonce de son marché (cartes ou packs en vente). */

  /* Marché : la carte / les pièces sont mises en réserve avant d'être reçues.
     Chaque opération modifie seulement la sauvegarde de son propriétaire et
     le document de réserve, dans une transaction Firestore indivisible. */
  let marketListings = [];
  /* Marché global : toutes les annonces ouvertes du jeu, y compris celles de
     joueurs qui ne sont pas mes amis. Le catalogue regroupe par carte ; les
     pseudos, prix et actions apparaissent quand on ouvre une carte. */
  let globalListings = [];
  let globalListingsLoaded = false;
  let marketGifts = [];
  let receivedOffers = [];
  let sentOffers = [];
  let sentGifts = [];                // cadeaux que J'AI envoyés (encore en attente)
  let marketBusy = false;
  let marketDone = Promise.resolve();
  let finishMarket = null;
  let marketUnsub = null;
  let knownGiftIds = new Set();      // cadeaux déjà annoncés (pas de toast au 1er chargement)
  let hadGiftSnapshot = false;
  const marketMessage = $('market-message');
  const marketCard = $('market-card');
  const marketQty = $('market-qty');
  const marketQtyMinus = $('market-qty-minus');
  const marketQtyPlus = $('market-qty-plus');
  const marketQtyHint = $('market-qty-hint');
  const marketSubmit = $('market-submit');
  const marketPrice = $('market-price');
  /* Marché des packs (boosters) : même principe que les cartes, mais on
     vend des packs de l'inventaire (packStock) au lieu de cartes. */
  const packMarketType = $('pack-market-type');
  const packMarketQty = $('pack-market-qty');
  const packMarketQtyMinus = $('pack-market-qty-minus');
  const packMarketQtyPlus = $('pack-market-qty-plus');
  const packMarketQtyHint = $('pack-market-qty-hint');
  const packMarketSubmit = $('pack-market-submit');
  const packMarketPrice = $('pack-market-price');
  const myListings = $('my-listings');
  const marketInbox = $('market-inbox');
  const marketInboxCount = $('market-inbox-count');
  const marketSent = $('market-sent');
  const friendListings = $('friend-listings');
  const globalMarketList = $('global-market-list');
  const globalMarketCount = $('global-market-count');
  const globalMarketMessage = $('global-market-message');
  const globalMarketSearch = $('global-market-search');
  const globalMarketSort = $('global-market-sort');
  const globalMarketRefresh = $('global-market-refresh');
  const giftAmount = $('gift-amount');
  const MAX_COINS = 1000000000;
  const MAX_MARKET_QTY = 100;

  function marketNumber(input, min) {
    const value = input && input.value.trim();
    const n = Number(value);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > MAX_COINS) {
      throw new Error(`Choisis un nombre entier entre ${fmt(min)} et ${fmt(MAX_COINS)}.`);
    }
    return n;
  }

  function marketQuantity(input, ownedCount) {
    const value = input && input.value.trim();
    const n = Number(value);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) {
      throw new Error('Choisis un nombre entier de cartes supérieur ou égal à 1.');
    }
    if (n > ownedCount) {
      throw new Error(`Tu ne possèdes que ${ownedCount} exemplaire${ownedCount > 1 ? 's' : ''} de cette carte.`);
    }
    if (n > MAX_MARKET_QTY) {
      throw new Error(`Tu peux mettre au maximum ${MAX_MARKET_QTY} exemplaires en vente à la fois.`);
    }
    return n;
  }

  function marketPackQuantity(input, ownedCount) {
    const value = input && input.value.trim();
    const n = Number(value);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) {
      throw new Error('Choisis un nombre entier de packs supérieur ou égal à 1.');
    }
    if (n > ownedCount) {
      throw new Error(`Tu ne possèdes que ${ownedCount} pack${ownedCount > 1 ? 's' : ''} de ce type.`);
    }
    if (n > MAX_MARKET_QTY) {
      throw new Error(`Tu peux mettre au maximum ${MAX_MARKET_QTY} packs en vente à la fois.`);
    }
    return n;
  }

  function marketBuyQuantity(input, availableCount) {
    const value = input && input.value.trim();
    const n = Number(value);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < 1) {
      throw new Error('Choisis une quantité entière à acheter.');
    }
    if (n > availableCount) {
      throw new Error(`Il ne reste que ${availableCount} exemplaire${availableCount > 1 ? 's' : ''} à ce prix.`);
    }
    if (n > MAX_MARKET_QTY) {
      throw new Error(`Tu peux acheter au maximum ${MAX_MARKET_QTY} exemplaires à la fois.`);
    }
    return n;
  }

  /* Une annonce peut être une carte (cardId) ou un pack (packType
     'classic' | 'rare'). Les anciennes annonces n'ont pas de packType :
     ce sont des cartes. */
  function cardName(id) {
    const card = CardMutations.resolve(id);
    return card ? CardMutations.label(card) : 'une carte';
  }

  function isPackListing(listing) {
    return Boolean(listing && isPackType(listing.packType));
  }

  function packName(packType) {
    return packType === 'doubleRare' ? 'Pack Double Rare'
      : packType === 'rare' ? 'Pack Rare doré'
      : packType === 'legend' ? 'Pack Légende'
        : packType === 'video' ? 'Pack Vidéo'
          : packType === 'ultra' ? 'Pack Ultra Rare'
            : 'Pack Classique';
  }

  function listingName(listing) {
    if (isPackListing(listing)) return packName(listing.packType);
    return cardName(listing && listing.cardId);
  }

  function marketInfo(message) {
    if (marketMessage) marketMessage.textContent = message;
    showToast(message);
  }

  /* Prix conseillé : valeur de rareté pour une carte, prix de revente
     raisonnable pour un booster (la moitié de son prix d'achat). */
  function suggestedCardPrice(cardId) {
    const card = CardMutations.resolve(cardId);
    const info = card && RARITIES[card.rarity];
    return info ? info.reward : 50;
  }

  function suggestedPackPrice(type) {
    const base = PACK_PRICES[isPackType(type) ? type : 'classic'] || 500;
    return Math.max(1, Math.round(base / 2));
  }

  /* Vente rapide : un seul clic depuis l'inspection d'une carte (ou depuis
     l'inventaire pour un pack), prix déjà rempli, confirmation comprise. */
  function quickSellCard(cardId) {
    const id = cardId || (marketCard && marketCard.value);
    if (!id || !CardMutations.resolve(id)) { marketInfo('Choisis une carte à vendre.'); return; }
    const ownedCount = countMap().get(id) || 0;
    if (ownedCount < 1) { marketInfo('Tu ne possèdes plus cette carte.'); return; }
    const price = suggestedCardPrice(id);
    closeInspect();
    askConfirm({
      title: 'Vendre cette carte ?',
      message: `Mettre 1 exemplaire de « ${cardName(id)} » en vente pour ${fmt(price)} 🪙 ? Tu en gardes ${ownedCount - 1}.`,
      confirmLabel: 'Vendre',
      onConfirm: () => marketTransaction('list', null, { cardId: id, price, quantity: 1 })
    });
  }

  function quickSellPack(type) {
    const packType = isPackType(type) ? type : 'classic';
    const ownedCount = Math.max(0, Number(state.packStock[packType]) || 0);
    if (ownedCount < 1) { marketInfo(`Tu ne possèdes aucun ${packName(packType)}.`); return; }
    const price = suggestedPackPrice(packType);
    askConfirm({
      title: 'Vendre ce pack ?',
      message: `Mettre 1 « ${packName(packType)} » en vente pour ${fmt(price)} 🪙 ? Tu en gardes ${ownedCount - 1}.`,
      confirmLabel: 'Vendre',
      onConfirm: () => marketTransaction('list', null, { packType, price, quantity: 1 })
    });
  }

  function groupListings(list) {
    const groups = [];
    const byKey = new Map();
    for (const listing of list) {
      const isPack = isPackListing(listing);
      const key = isPack
        ? `pack:${listing.packType}\u0000${listing.price}`
        : `card:${listing.cardId}\u0000${listing.price}`;
      let group = byKey.get(key);
      if (!group) {
        group = { cardId: listing.cardId || '', packType: isPack ? listing.packType : '', price: listing.price, ids: [] };
        byKey.set(key, group);
        groups.push(group);
      }
      group.ids.push(listing.id);
    }
    return groups;
  }

  function syncMarketQty({ reset = false, clampValue = true } = {}) {
    if (!marketCard || !marketQty) return;
    const ownedCount = countMap().get(marketCard.value) || 0;
    const maxSell = Math.min(ownedCount, MAX_MARKET_QTY);
    if (ownedCount < 1) {
      marketQty.value = '1';
      marketQty.min = '1';
      marketQty.max = '1';
      marketQty.disabled = true;
      if (marketQtyMinus) marketQtyMinus.disabled = true;
      if (marketQtyPlus) marketQtyPlus.disabled = true;
      if (marketQtyHint) marketQtyHint.textContent = 'Aucune carte à vendre';
      if (marketSubmit) {
        marketSubmit.disabled = true;
        marketSubmit.textContent = 'Mettre en vente';
      }
      return;
    }
    marketQty.disabled = false;
    marketQty.min = '1';
    marketQty.max = String(maxSell);
    if (marketSubmit) marketSubmit.disabled = false;

    const raw = marketQty.value.trim();
    const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
    let currentQty = parsed;
    if (reset) {
      currentQty = 1;
      marketQty.value = '1';
    } else if (clampValue) {
      currentQty = Number.isSafeInteger(parsed) ? clamp(parsed, 1, maxSell) : 1;
      marketQty.value = String(currentQty);
    }

    const valid = Number.isSafeInteger(currentQty) && currentQty >= 1 && currentQty <= maxSell;
    if (marketQtyMinus) marketQtyMinus.disabled = !valid || currentQty <= 1;
    if (marketQtyPlus) marketQtyPlus.disabled = !valid || currentQty >= maxSell;
    if (marketQtyHint) {
      if (!valid) {
        marketQtyHint.textContent = `Choisis un nombre entre 1 et ${maxSell}`;
      } else {
        const remaining = ownedCount - currentQty;
        marketQtyHint.textContent = `${currentQty} sur ${ownedCount} (il t’en restera ${remaining})`;
      }
    }
    if (marketSubmit) {
      marketSubmit.textContent = valid && currentQty > 1 ? `Mettre en vente (×${currentQty})` : 'Mettre en vente';
    }
  }

  function syncPackMarketQty({ reset = false, clampValue = true } = {}) {
    if (!packMarketType || !packMarketQty) return;
    const type = isPackType(packMarketType.value) ? packMarketType.value : 'classic';
    const ownedCount = Math.max(0, Number(state.packStock[type]) || 0);
    const maxSell = Math.min(ownedCount, MAX_MARKET_QTY);
    if (ownedCount < 1) {
      packMarketQty.value = '1';
      packMarketQty.min = '1';
      packMarketQty.max = '1';
      packMarketQty.disabled = true;
      if (packMarketQtyMinus) packMarketQtyMinus.disabled = true;
      if (packMarketQtyPlus) packMarketQtyPlus.disabled = true;
      if (packMarketQtyHint) packMarketQtyHint.textContent = `Aucun ${packName(type)} à vendre`;
      if (packMarketSubmit) {
        packMarketSubmit.disabled = true;
        packMarketSubmit.textContent = 'Mettre les packs en vente';
      }
      return;
    }
    packMarketQty.disabled = false;
    packMarketQty.min = '1';
    packMarketQty.max = String(maxSell);
    if (packMarketSubmit) packMarketSubmit.disabled = false;
    const raw = packMarketQty.value.trim();
    const parsed = /^\d+$/.test(raw) ? Number(raw) : NaN;
    let currentQty = parsed;
    if (reset) {
      currentQty = 1;
      packMarketQty.value = '1';
    } else if (clampValue) {
      currentQty = Number.isSafeInteger(parsed) ? clamp(parsed, 1, maxSell) : 1;
      packMarketQty.value = String(currentQty);
    }
    const valid = Number.isSafeInteger(currentQty) && currentQty >= 1 && currentQty <= maxSell;
    if (packMarketQtyMinus) packMarketQtyMinus.disabled = !valid || currentQty <= 1;
    if (packMarketQtyPlus) packMarketQtyPlus.disabled = !valid || currentQty >= maxSell;
    if (packMarketQtyHint) {
      if (!valid) {
        packMarketQtyHint.textContent = `Choisis un nombre entre 1 et ${maxSell}`;
      } else {
        const remaining = ownedCount - currentQty;
        packMarketQtyHint.textContent = `${currentQty} sur ${ownedCount} (il t’en restera ${remaining})`;
      }
    }
    if (packMarketSubmit) {
      packMarketSubmit.textContent = valid && currentQty > 1 ? `Mettre les packs en vente (×${currentQty})` : 'Mettre les packs en vente';
    }
  }

  function renderMarket() {
    if (!currentUser) return;
    updateOnlineTabCounts();
    syncPackMarketQty({ clampValue: true });
    if (marketCard) {
      const old = marketCard.value;
      const owned = countMap();
      const options = CardMutations.owned([...owned.keys()]).map((card) => {
        const option = el('option', '', `${CardMutations.label(card)} (x${owned.get(card.id)})`);
        option.value = card.id;
        return option;
      });
      if (!options.length) {
        const option = el('option', '', 'Aucune carte disponible');
        option.value = '';
        options.push(option);
      }
      marketCard.replaceChildren(...options);
      const kept = Boolean(old) && owned.has(old);
      if (kept) marketCard.value = old;
      syncMarketQty({ reset: !kept, clampValue: true });
    }
    if (myListings) {
      const groups = groupListings(marketListings.filter((l) => l.status === 'open'));
      myListings.replaceChildren(...(groups.length ? groups.map((group) => {
        const row = el('div', 'trade-row');
        const count = group.ids.length;
        const isPack = Boolean(group.packType);
        const name = isPack ? packName(group.packType) : cardName(group.cardId);
        const unit = isPack ? 'pack' : 'carte';
        const label = count > 1
          ? `${name} (×${count}) · ${fmt(group.price)} 🪙 / ${unit}`
          : `${name} · ${fmt(group.price)} 🪙`;
        row.append(el('span', 'trade-text', label));
        if (count > 1) {
          const cancelOne = el('button', 'mini-btn', 'Retirer 1');
          cancelOne.type = 'button';
          on(cancelOne, 'click', () => marketTransaction('cancel', group.ids[0]));
          const cancelAll = el('button', 'mini-btn', `Tout retirer (×${count})`);
          cancelAll.type = 'button';
          on(cancelAll, 'click', () => marketTransaction('cancel', null, { ids: group.ids }));
          row.append(cancelOne, cancelAll);
        } else {
          const cancel = el('button', 'mini-btn', 'Retirer de la vente');
          cancel.type = 'button';
          on(cancel, 'click', () => marketTransaction('cancel', group.ids[0]));
          row.append(cancel);
        }
        return row;
      }) : [el('p', 'online-empty', 'Aucune annonce en cours. Crée ton marché ci-dessus : cartes ou packs, nombre et prix comme tu veux.') ]));
    }
    renderOffers();
    if (marketInbox) {
      const income = [
        ...marketListings.filter((l) => l.status === 'sold').map((l) => ({ ...l, kind: 'sale' })),
        ...marketGifts.filter((g) => g.status === 'pending').map((g) => ({ ...g, kind: 'gift' }))
      ];
      if (marketInboxCount) marketInboxCount.textContent = String(income.length);
      marketInbox.replaceChildren(...(income.length ? income.map((item) => {
        const row = el('div', 'trade-row');
        const text = item.kind === 'sale' ? `Vente de « ${listingName(item)} » : ${fmt(item.price)} 🪙` : `Cadeau de pièces : ${fmt(item.amount)} 🪙`;
        row.append(el('span', 'trade-text', text));
        const claim = el('button', 'mini-btn primary', 'Récupérer');
        claim.type = 'button';
        on(claim, 'click', () => marketTransaction(item.kind === 'sale' ? 'claimSale' : 'claimGift', item.id));
        row.append(claim);
        return row;
      }) : [el('p', 'online-empty', 'Rien à récupérer pour le moment.') ]));
    }
    if (marketSent) {
      const pending = sentGifts.filter((g) => g.status === 'pending');
      marketSent.replaceChildren(...(pending.length ? pending.map((gift) => {
        const row = el('div', 'trade-row');
        const who = (friendProfiles.get(gift.toUid) || {}).pseudo || 'ton ami';
        row.append(el('span', 'trade-text', `À ${who} : ${fmt(gift.amount)} 🪙 · en attente`));
        const cancel = el('button', 'mini-btn', 'Annuler');
        cancel.type = 'button';
        cancel.setAttribute('aria-label', `Annuler le cadeau de ${fmt(gift.amount)} pièces à ${who}`);
        on(cancel, 'click', () => marketTransaction('cancelGift', gift.id));
        row.append(cancel);
        return row;
      }) : [el('p', 'online-empty', 'Aucun cadeau en attente.') ]));
    }
  }

  /* Annonces vendues : on prévient (notification + toast) quand une annonce
     passe à « sold » pendant la session. Le premier snapshot ne prévient pas
     (sinon chaque annonce vendue avant l'ouverture ressortirait d'un coup). */
  function announceSoldListings(list) {
    const sold = (list || []).filter((l) => l.status === 'sold');
    const known = notifSalesKnown || new Set();
    const fresh = sold.filter((l) => !known.has(l.id));
    notifSalesKnown = new Set(sold.map((l) => l.id));
    if (!notifSalesSnapshot) {
      notifSalesSnapshot = true;
      return;
    }
    if (!fresh.length) return;
    const total = fresh.reduce((sum, l) => sum + (Number(l.price) || 0), 0);
    pushNotification('market', 'Vente conclue',
      fresh.length === 1
        ? `Une de tes annonces a été achetée : ${fmt(total)} 🪙 à récupérer dans « En ligne ».`
        : `${fresh.length} de tes annonces ont été achetées : ${fmt(total)} 🪙 à récupérer dans « En ligne ».`);
    showToast(`💰 ${fmt(total)} 🪙 de ventes à récupérer !`, 4200);
  }

  /* Charge mes annonces, mes cadeaux reçus et mes cadeaux envoyés.
     Chaque requête est indépendante : un refus de règles sur l'une d'elles
     ne doit pas laisser tout le marché vide (c'était le cas avant : une
     requête refusée masquait aussi les ventes et les cadeaux reçus). */
  async function loadMarket() {
    if (!cloudReady()) return false;
    const uid = currentUser.uid;
    const fetchAll = (collName, field, value, label) => {
      const coll = cloudDb.collection(collName);
      if (typeof coll.where !== 'function') return Promise.resolve(null);
      return coll.where(field, '==', value).get().then(
        (snap) => snapshotDocs(snap).map((d) => ({ id: d.id, ...d.data })),
        (error) => { noteCloudError(label, error); return null; }
      );
    };
    const [listings, gifts, sent, incomingOffers, outgoingOffers] = await Promise.all([
      fetchAll('marketListings', 'sellerUid', uid, 'Mes ventes illisibles'),
      fetchAll('coinGifts', 'toUid', uid, 'Cadeaux reçus illisibles'),
      fetchAll('coinGifts', 'fromUid', uid, 'Cadeaux envoyés illisibles'),
      fetchAll('marketOffers', 'sellerUid', uid, 'Offres reçues illisibles'),
      fetchAll('marketOffers', 'buyerUid', uid, 'Offres envoyées illisibles')
    ]);
    if (!currentUser || currentUser.uid !== uid) return false;
    if (listings) {
      marketListings = listings;
      announceSoldListings(marketListings);
    }
    if (gifts) {
      marketGifts = gifts;
      knownGiftIds = new Set(marketGifts.map((g) => g.id));
      hadGiftSnapshot = true;
    }
    if (sent) sentGifts = sent;
    if (incomingOffers) {
      receivedOffers = incomingOffers;
      announceOffersOutOfGame(receivedOffers, { seller: true, firstSnapshot: !hadOffersSnapshot });
    }
    if (outgoingOffers) {
      sentOffers = outgoingOffers;
      announceOffersOutOfGame(sentOffers, { seller: false, firstSnapshot: !hadOffersSnapshot });
      hadOffersSnapshot = true;
    }
    renderMarket();
    return Boolean(listings || gifts || sent);
  }

  /* Prévenir qu'un cadeau vient d'arriver (tant que la page est ouverte),
     sans spammer au premier chargement. */
  function announceIncomingGifts() {
    const pending = marketGifts.filter((g) => g.status === 'pending');
    const fresh = pending.filter((g) => !knownGiftIds.has(g.id));
    knownGiftIds = new Set(marketGifts.map((g) => g.id));
    if (!hadGiftSnapshot) { hadGiftSnapshot = true; return; }
    if (!fresh.length) return;
    const total = fresh.reduce((sum, g) => sum + (Number(g.amount) || 0), 0);
    const who = (friendProfiles.get(fresh[0].fromUid) || {}).pseudo || 'Un ami';
    showToast(fresh.length === 1
      ? `🪙 ${who} t’a envoyé ${fmt(total)} pièces — « En ligne → Pièces à récupérer ».`
      : `🪙 ${fresh.length} cadeaux reçus (${fmt(total)} pièces) — « En ligne → Pièces à récupérer ».`, 4800);
    /* Hors jeu : les pièces envoyées par un ami sont une vraie nouvelle, même
       si le joueur ne regarde pas l'onglet « En ligne ». */
    notifyKind('market', 'Pièces reçues',
      fresh.length === 1
        ? `${who} t’a envoyé ${fmt(total)} 🪙 — récupère-les dans « En ligne ».`
        : `${fresh.length} cadeaux de pièces (${fmt(total)} 🪙) à récupérer dans « En ligne ».`,
      { tag: `gifts-${fresh.map((g) => g.id).join('-')}`.slice(0, 60) });
  }

  /* Temps réel : les pièces envoyées par un ami apparaissent sans devoir
     cliquer sur « Actualiser ». Les erreurs (règles non publiées) sont
     signalées une fois, sans casser la page. */
  function subscribeMarket() {
    if (!cloudReady() || marketUnsub) return;
    const uid = currentUser.uid;
    const stops = [];
    const watch = (collName, field, value, assign, label) => {
      const coll = cloudDb.collection(collName);
      if (typeof coll.where !== 'function') return;
      const query = coll.where(field, '==', value);
      if (typeof query.onSnapshot !== 'function') return;
      try {
        const stop = query.onSnapshot((snap) => {
          try {
            if (!currentUser || currentUser.uid !== uid) return;
            assign(snapshotDocs(snap).map((d) => ({ id: d.id, ...d.data })));
            if (collName === 'marketListings') announceSoldListings(marketListings);
            if (marketBusy) return; // la transaction en cours va rafraîchir elle-même
            renderMarket();
            announceIncomingGifts();
          } catch (error) { noteCloudError(label, error); }
        }, (error) => noteCloudError(label, error));
        if (typeof stop === 'function') stops.push(stop);
      } catch (error) { /* temps réel indisponible : « Actualiser » suffit */ }
    };
    watch('marketListings', 'sellerUid', uid, (list) => { marketListings = list; }, 'Mes ventes illisibles (temps réel)');
    watch('coinGifts', 'toUid', uid, (list) => { marketGifts = list; }, 'Cadeaux reçus illisibles (temps réel)');
    watch('coinGifts', 'fromUid', uid, (list) => { sentGifts = list; }, 'Cadeaux envoyés illisibles (temps réel)');
    watch('marketOffers', 'sellerUid', uid, (list) => {
      receivedOffers = list;
      announceOffersOutOfGame(receivedOffers, { seller: true, firstSnapshot: !hadOffersSnapshot });
      hadOffersSnapshot = true;
    }, 'Offres reçues illisibles');
    watch('marketOffers', 'buyerUid', uid, (list) => {
      sentOffers = list;
      announceOffersOutOfGame(sentOffers, { seller: false, firstSnapshot: !hadOffersSnapshot });
      hadOffersSnapshot = true;
    }, 'Offres envoyées illisibles');
    if (!stops.length) return;
    marketUnsub = () => {
      marketUnsub = null;
      stops.forEach((stop) => { try { stop(); } catch (error) { /* déjà fermé */ } });
    };
  }

  function unsubscribeMarket() {
    if (marketUnsub) marketUnsub();
    marketUnsub = null;
  }

  /* ========================== JEUX : PILE OU FACE ==========================
     Défi 1v1 entre amis sur la pièce : chaque joueur choisit sa mise (la
     somme qu'il veut) et son côté (pile = P, face = F, textures pixel art).
     Le défi est un document coinFlips/{id} ; les mises sont réservées dans
     la sauvegarde de chaque joueur par transactions atomiques (voir
     firestore.rules, collection coinFlips). Quand l'ami relève le défi, le
     résultat est figé pile/face, la pièce tourne en animation et celui qui a
     choisi le côté qui tombe remporte la somme des deux mises. */
  let flipGames = [];              // défi coinFlips où je suis fromUid ou toUid
  let flipUnsub = null;
  let hadFlipSnapshot = false;     // premier aperçu reçu : sert de base aux animations
  let flipChoice = 'pile';         // côté choisi dans le formulaire de défi
  let flipActiveGameId = null;     // partie affichée dans l'animation de la pièce
  const flipAnimated = new Set();  // parties déjà animées (une animation par résultat)

  const flipFriend = $('flip-friend');
  const flipAmountInput = $('flip-amount');
  const flipMessage = $('flip-message');
  const flipReceived = $('flip-received');
  const flipSent = $('flip-sent');
  const flipHistory = $('flip-history');

  const FLIP_LABELS = { pile: 'PILE', face: 'FACE' };
  const FLIP_MESSAGES = {
    create: 'Défi envoyé ! Ta mise est réservée en attendant que ton ami relève le défi.',
    accept: 'Défi relevé ! La pièce tourne…',
    cancel: 'Défi annulé : ta mise est remboursée.',
    decline: 'Défi refusé.',
    claim: 'Gains récupérés !'
  };

  function flipInfo(message) {
    if (flipMessage) flipMessage.textContent = message || '';
    if (message) showToast(message);
  }

  function flipPseudo(uid) {
    return (friendProfiles.get(uid) || {}).pseudo || 'Ami';
  }

  function flipPot(game) {
    return Math.max(0, Number(game.amount) || 0) + Math.max(0, Number(game.toBet) || 0);
  }

  function flipStamp(game) {
    const t = game && game.createdAt;
    if (!t) return 0;
    if (typeof t.toMillis === 'function') return t.toMillis();
    if (typeof t.seconds === 'number') return t.seconds * 1000;
    if (t instanceof Date) return t.getTime();
    return 0;
  }

  /* Texture de la pièce en pixel art : grille 13×13, anneau doré, damier
     doré subtil, et la lettre P (pile) ou F (face) dessinée pixel par pixel
     (chaque « pixel » est un carré du SVG, net à toutes les tailles). */
  const FLIP_LETTER_PIXELS = {
    pile: ['11110', '10001', '10001', '11110', '10000', '10000', '10000'],
    face: ['11111', '10000', '10000', '11110', '10000', '10000', '10000']
  };

  function flipFaceSvg(kind) {
    const rows = FLIP_LETTER_PIXELS[kind] || FLIP_LETTER_PIXELS.pile;
    const N = 13;
    let rects = '';
    for (let y = 0; y < N; y++) {
      for (let x = 0; x < N; x++) {
        const ring = x === 0 || y === 0 || x === N - 1 || y === N - 1;
        const inner = x === 1 || y === 1 || x === N - 2 || y === N - 2;
        const letter = Boolean(rows[y - 3]) && rows[y - 3][x - 4] === '1';
        let fill;
        if (letter) fill = '#7a4a00';
        else if (ring) fill = '#a8720c';
        else if (inner) fill = '#e0a92a';
        else fill = (x + y) % 2 === 0 ? '#f6c445' : '#efb634';
        rects += `<rect x="${x}" y="${y}" width="1" height="1" fill="${fill}"/>`;
      }
    }
    return `<svg viewBox="0 0 ${N} ${N}" xmlns="http://www.w3.org/2000/svg" shape-rendering="crispEdges" aria-hidden="true">${rects}</svg>`;
  }

  /* Animation de la pièce : rotation 3D (rotateX) sur plusieurs tours puis
     repos sur le côté gagnant (PILE = 0°, FACE = 180°). */
  function playFlipAnimation(game) {
    const overlay = $('flip-overlay');
    const coin = $('flip-coin');
    if (!overlay || !coin || !game) return;
    const me = currentUser && currentUser.uid;
    const opponentUid = me === game.fromUid ? game.toUid : game.fromUid;
    const iAmWinner = Boolean(me) && game.winnerUid === me;
    const pot = flipPot(game);
    flipActiveGameId = game.id;
    $('flip-kicker').textContent = `DÉFI VS ${flipPseudo(opponentUid).toUpperCase()}`;
    $('flip-bets').textContent =
      `Mises : ${fmt(Number(game.amount) || 0)} 🪙 vs ${fmt(Number(game.toBet) || 0)} 🪙 — le gagnant remporte ${fmt(pot)} 🪙`;
    const resultEl = $('flip-result');
    const subEl = $('flip-result-sub');
    const closeBtn = $('flip-close');
    resultEl.hidden = true;
    subEl.hidden = true;
    closeBtn.hidden = true;
    coin.style.transition = 'none';
    coin.style.transform = 'rotateX(0deg)';
    overlay.hidden = false;
    overlay.setAttribute('aria-hidden', 'false');
    void coin.offsetWidth; // reflow : la rotation repart bien de 0
    const turns = 6 + Math.floor(Math.random() * 3);
    const target = turns * 360 + (game.result === 'face' ? 180 : 0);
    coin.style.transition = '';
    coin.style.transform = `rotateX(${target}deg)`;
    window.setTimeout(() => {
      resultEl.textContent = game.result === 'face' ? 'FACE !' : 'PILE !';
      resultEl.hidden = false;
      subEl.textContent = iAmWinner
        ? `Tu remportes ${fmt(pot)} 🪙 (les deux mises réunies) !`
        : `${flipPseudo(game.winnerUid)} remporte ${fmt(pot)} 🪙.`;
      subEl.hidden = false;
      closeBtn.hidden = false;
      closeBtn.focus();
    }, reduceMotion.matches ? 650 : 3350);
  }

  /* Une seule animation par résultat : les parties finies vues au premier
     chargement restent dans l'historique sans rejouer leur lancer. */
  function maybeAnimateNewFlip() {
    const overlay = $('flip-overlay');
    if (overlay && !overlay.hidden) return;
    const game = flipGames.find((g) => g.status === 'finished' && !flipAnimated.has(g.id));
    if (!game) return;
    flipAnimated.add(game.id);
    playFlipAnimation(game);
  }

  function ingestFlipDocs(list) {
    const map = new Map(flipGames.map((g) => [g.id, g]));
    list.forEach((g) => map.set(g.id, g));
    flipGames = [...map.values()];
    if (!hadFlipSnapshot) {
      hadFlipSnapshot = true;
      flipGames.forEach((g) => { if (g.status === 'finished') flipAnimated.add(g.id); });
    }
    /* Notification hors jeu : défi reçu, gagné / perdu, refusé — jamais au
       premier chargement (le joueur ouvre la page, il voit l'onglet Jeux). */
    announceFlipOutOfGame(flipGames, !flipPushKnown);
  }

  /* Transaction du jeu : réserve / rembourse les mises dans la sauvegarde de
     l'auteur de l'action et fait vivre le document coinFlips. Réutilise le
     verrou des transactions du marché (marketBusy) pour ne jamais écraser un
     solde pendant une opération en cours. */
  async function flipTransaction(action, game, value) {
    if (!cloudReady()) { flipInfo('Connecte-toi pour jouer.'); return null; }
    if (marketBusy) { flipInfo('Une autre opération est en cours, réessaie dans un instant.'); return null; }
    if (typeof cloudDb.runTransaction !== 'function') { flipInfo('Transactions indisponibles. Réessaie plus tard.'); return null; }
    const uid = currentUser.uid;
    const db = cloudDb;
    marketBusy = true;
    marketDone = new Promise((resolve) => { finishMarket = resolve; });
    const overlay = el('div', 'market-busy', 'Transaction en cours…');
    overlay.setAttribute('role', 'status');
    document.body.append(overlay);
    gameRegions.forEach((region) => region.setAttribute('inert', ''));
    try {
      if (!await saveNow(true)) throw new Error('Sauvegarde impossible : action annulée.');
      if (!currentUser || currentUser.uid !== uid) return null;
      const saveRef = db.collection('playerSaves').doc(uid);
      const result = await db.runTransaction(async (tx) => {
        const saveSnap = await tx.get(saveRef);
        if (!saveSnap.exists) throw new Error('Sauvegarde introuvable.');
        const coins = Number(saveSnap.data().coins) || 0;
        let nextCoins = coins;
        let gameRef = null;
        let gamePatch = null;
        if (action === 'create') {
          if (coins < value.amount) throw new Error('Tu n’as pas assez de pièces.');
          nextCoins -= value.amount;
          gameRef = db.collection('coinFlips').doc();
          tx.set(gameRef, {
            fromUid: uid,
            toUid: value.toUid,
            fromChoice: value.choice,
            amount: value.amount,
            status: 'pending',
            createdAt: serverTimestamp()
          });
        } else if (action === 'accept') {
          gameRef = db.collection('coinFlips').doc(game.id);
          const snap = await tx.get(gameRef);
          const data = snap.exists ? snap.data() : null;
          if (!data || data.status !== 'pending' || data.toUid !== uid) throw new Error('Ce défi n’est plus disponible.');
          if (coins < value.amount) throw new Error('Tu n’as pas assez de pièces.');
          nextCoins -= value.amount;
          const resultSide = Math.random() < 0.5 ? 'pile' : 'face';
          const winnerUid = resultSide === data.fromChoice ? data.fromUid : uid;
          gamePatch = { toBet: value.amount, toChoice: value.choice, result: resultSide, winnerUid, status: 'finished' };
        } else if (action === 'cancel') {
          gameRef = db.collection('coinFlips').doc(game.id);
          const snap = await tx.get(gameRef);
          const data = snap.exists ? snap.data() : null;
          if (!data || data.status !== 'pending' || data.fromUid !== uid) throw new Error('Ce défi n’est plus annulable.');
          nextCoins += Number(data.amount) || 0;
          gamePatch = { status: 'cancelled' };
        } else if (action === 'decline') {
          gameRef = db.collection('coinFlips').doc(game.id);
          const snap = await tx.get(gameRef);
          const data = snap.exists ? snap.data() : null;
          if (!data || data.status !== 'pending' || data.toUid !== uid) throw new Error('Ce défi n’est plus disponible.');
          gamePatch = { status: 'declined' };
        } else if (action === 'claim') {
          gameRef = db.collection('coinFlips').doc(game.id);
          const snap = await tx.get(gameRef);
          const data = snap.exists ? snap.data() : null;
          if (data && data.status === 'finished' && data.winnerUid === uid) {
            nextCoins += (Number(data.amount) || 0) + (Number(data.toBet) || 0);
          } else if (data && data.status === 'declined' && data.fromUid === uid) {
            nextCoins += Number(data.amount) || 0;
          } else {
            throw new Error('Aucun gain à récupérer ici.');
          }
          gamePatch = { status: 'claimed' };
        } else throw new Error('Action inconnue.');
        if (nextCoins < 0) throw new Error('Tu n’as pas assez de pièces.');
        if (nextCoins > MAX_COINS) throw new Error('Ton solde dépasserait la limite de pièces. Dépense-en avant de récupérer ce montant.');
        if (gamePatch) tx.update(gameRef, gamePatch);
        tx.update(saveRef, { coins: nextCoins, updatedAt: serverTimestamp() });
        return { coins: nextCoins, gameId: gameRef.id, gamePatch };
      });
      if (!currentUser || currentUser.uid !== uid) return null;
      const delta = result.coins - state.coins;
      state.coins = result.coins;
      updateCoins(delta);
      flipInfo(FLIP_MESSAGES[action] || '');
      return result;
    } catch (error) {
      flipInfo(isPermissionDenied(error) ? RULES_HELP : (error.message || 'Action impossible. Réessaie.'));
      return null;
    } finally {
      overlay.remove();
      if (currentUser && currentUser.uid === uid) gameRegions.forEach((region) => region.removeAttribute('inert'));
      marketBusy = false;
      finishMarket();
      finishMarket = null;
      loadFlipGames();
    }
  }

  async function acceptFlip(game, amount, choice) {
    const result = await flipTransaction('accept', game, { amount, choice });
    if (!result || !result.gamePatch) return;
    flipAnimated.add(result.gameId);
    playFlipAnimation({ ...game, ...result.gamePatch, id: result.gameId });
  }

  function flipRow(game, mode) {
    const me = currentUser && currentUser.uid;
    const row = el('div', 'flip-row');
    row.dataset.status = game.status;
    const head = el('div', 'flip-row-head');
    const amount = Math.max(0, Number(game.amount) || 0);
    const toBet = Math.max(0, Number(game.toBet) || 0);
    const pot = flipPot(game);
    const opponentUid = me === game.fromUid ? game.toUid : game.fromUid;

    if (mode === 'received') {
      head.append(
        withCreatorBadge(el('strong', 'flip-row-pseudo', `${flipPseudo(game.fromUid)} te défie`), friendProfiles.get(game.fromUid)),
        el('span', 'flip-bet-pill', `Mise adverse : ${fmt(amount)} 🪙`)
      );
      row.append(head);
      row.append(el('p', 'flip-row-sub', `Sa mise est déjà réservée. Choisis ta mise et ton côté : le gagnant remporte la somme des deux mises.`));
      const form = el('div', 'flip-accept-row');
      const input = el('input', 'flip-accept-input');
      input.type = 'number';
      input.min = '0';
      input.max = '1000000000';
      input.step = '1';
      input.inputMode = 'numeric';
      input.value = String(amount);
      input.setAttribute('aria-label', 'Ta mise en pièces');
      form.append(el('span', 'flip-row-sub', 'Ta mise :'), input);
      ['pile', 'face'].forEach((choice) => {
        const btn = el('button', 'flip-side flip-side-mini');
        btn.type = 'button';
        const icon = el('span', 'flip-side-icon');
        icon.innerHTML = flipFaceSvg(choice);
        btn.append(icon, el('span', '', FLIP_LABELS[choice]));
        btn.setAttribute('aria-label', `Relever le défi sur ${FLIP_LABELS[choice]}`);
        on(btn, 'click', () => {
          let bet = 0;
          try { bet = marketNumber(input, 0); } catch (error) { flipInfo(error.message); return; }
          askConfirm({
            title: 'Relever ce défi ?',
            message: `${flipPseudo(game.fromUid)} parie ${fmt(amount)} 🪙. Tu paries ${fmt(bet)} 🪙 sur ${FLIP_LABELS[choice]} et la pièce tourne : le gagnant remporte ${fmt(amount + bet)} 🪙.`,
            confirmLabel: 'Relever',
            onConfirm: () => acceptFlip(game, bet, choice)
          });
        });
        form.append(btn);
      });
      const decline = el('button', 'mini-btn danger', 'Refuser');
      decline.type = 'button';
      on(decline, 'click', () => flipTransaction('decline', game));
      form.append(decline);
      row.append(form);
      return row;
    }

    if (mode === 'sent') {
      head.append(
        withCreatorBadge(el('strong', 'flip-row-pseudo', `Défi à ${flipPseudo(game.toUid)}`), friendProfiles.get(game.toUid)),
        el('span', 'flip-bet-pill', `Ta mise : ${fmt(amount)} 🪙 (${FLIP_LABELS[game.fromChoice] || '—'})`)
      );
      row.append(head);
      row.append(el('p', 'flip-row-sub', 'En attente que ton ami relève le défi… (ta mise est réservée)'));
      const cancel = el('button', 'mini-btn danger', 'Annuler (remboursé)');
      cancel.type = 'button';
      on(cancel, 'click', () => askConfirm({
        title: 'Annuler ce défi ?',
        message: `Ta mise de ${fmt(amount)} 🪙 te sera remboursée.`,
        confirmLabel: 'Annuler le défi',
        onConfirm: () => flipTransaction('cancel', game)
      }));
      row.append(cancel);
      return row;
    }

    /* Historique : parties finies, annulées, refusées ou encaissées. */
    const decided = game.status === 'finished' || game.status === 'claimed';
    head.append(withCreatorBadge(el('strong', 'flip-row-pseudo', `vs ${flipPseudo(opponentUid)}`), friendProfiles.get(opponentUid)));
    if (decided && game.result) {
      head.append(el('span', 'flip-bet-pill', `Résultat : ${FLIP_LABELS[game.result] || game.result}`));
    }
    row.append(head);
    if (game.toChoice) {
      row.append(el('p', 'flip-row-sub',
        `${flipPseudo(game.fromUid)} : ${fmt(amount)} 🪙 (${FLIP_LABELS[game.fromChoice] || '—'}) · ` +
        `${flipPseudo(game.toUid)} : ${fmt(toBet)} 🪙 (${FLIP_LABELS[game.toChoice] || '—'})`));
    }
    if (decided && game.winnerUid) {
      row.append(el('p', 'flip-row-sub', `🏆 ${flipPseudo(game.winnerUid)} remporte ${fmt(pot)} 🪙 (les deux mises).`));
    } else if (game.status === 'cancelled') {
      row.append(el('p', 'flip-row-sub', 'Défi annulé : la mise du créateur a été remboursée.'));
    } else if (game.status === 'declined') {
      row.append(el('p', 'flip-row-sub', `${flipPseudo(game.toUid)} a refusé le défi.`));
    }
    if (game.status === 'finished' && game.winnerUid === me) {
      const claim = el('button', 'mini-btn primary', `Récupérer ${fmt(pot)} 🪙`);
      claim.type = 'button';
      on(claim, 'click', () => flipTransaction('claim', game));
      row.append(claim);
    } else if (game.status === 'declined' && game.fromUid === me) {
      const claim = el('button', 'mini-btn primary', `Récupérer ma mise (${fmt(amount)} 🪙)`);
      claim.type = 'button';
      on(claim, 'click', () => flipTransaction('claim', game));
      row.append(claim);
    } else if (game.status === 'claimed') {
      row.append(el('p', 'flip-row-sub', game.winnerUid
        ? (game.winnerUid === me ? 'Gains récupérés ✓' : 'Gains versés au gagnant ✓')
        : 'Mise récupérée ✓'));
    }
    return row;
  }

  function renderFlipGames() {
    if (!onlineView || !$('online-games')) return;
    const me = currentUser && currentUser.uid;
    if (!me) return;

    /* Sélecteur d'ami pour le nouveau défi. */
    if (flipFriend) {
      const current = flipFriend.value;
      const frag = document.createDocumentFragment();
      if (!friends.length) {
        const opt = el('option', '', 'Aucun ami — ajoute des amis dans l’onglet Amis');
        opt.value = '';
        frag.append(opt);
      }
      friends.forEach((uid) => {
        const opt = el('option', '', flipPseudo(uid));
        opt.value = uid;
        frag.append(opt);
      });
      flipFriend.replaceChildren(frag);
      if (current && friends.includes(current)) flipFriend.value = current;
    }

    const received = flipGames
      .filter((g) => g.toUid === me && g.status === 'pending')
      .sort((a, b) => flipStamp(b) - flipStamp(a));
    const sent = flipGames
      .filter((g) => g.fromUid === me && g.status === 'pending')
      .sort((a, b) => flipStamp(b) - flipStamp(a));
    const history = flipGames
      .filter((g) => g.status !== 'pending')
      .sort((a, b) => flipStamp(b) - flipStamp(a));

    flipReceived.replaceChildren(...received.map((g) => flipRow(g, 'received')));
    $('flip-received-empty').hidden = received.length > 0;
    flipSent.replaceChildren(...sent.map((g) => flipRow(g, 'sent')));
    $('flip-sent-empty').hidden = sent.length > 0;
    flipHistory.replaceChildren(...history.map((g) => flipRow(g, 'history')));
    $('flip-history-empty').hidden = history.length > 0;
    setTabCount($('flip-received-count'), received.length);
    setTabCount($('flip-sent-count'), sent.length);
    setTabCount($('flip-open-count'), received.length);
    updateOnlineTabCounts();
  }

  async function loadFlipGames() {
    if (!cloudReady()) return;
    const uid = currentUser.uid;
    const coll = cloudDb.collection('coinFlips');
    if (!coll || typeof coll.where !== 'function') return;
    try {
      const [incoming, outgoing] = await Promise.all([
        coll.where('toUid', '==', uid).get(),
        coll.where('fromUid', '==', uid).get()
      ]);
      if (!currentUser || currentUser.uid !== uid) return;
      ingestFlipDocs([...snapshotDocs(incoming), ...snapshotDocs(outgoing)]
        .map((d) => ({ id: d.id, ...d.data })));
      renderFlipGames();
      maybeAnimateNewFlip();
    } catch (error) {
      noteCloudError('Défis illisibles', error);
    }
  }

  /* Temps réel : un défi relevé, refusé ou annulé par un ami apparaît sans
     rechargement — la pièce tourne dès que le résultat tombe. */
  function subscribeFlipGames() {
    if (!cloudReady() || flipUnsub) return;
    const uid = currentUser.uid;
    const stops = [];
    const watch = (field) => {
      const coll = cloudDb.collection('coinFlips');
      if (!coll || typeof coll.where !== 'function') return;
      const query = coll.where(field, '==', uid);
      if (typeof query.onSnapshot !== 'function') return;
      try {
        const stop = query.onSnapshot((snap) => {
          try {
            if (!currentUser || currentUser.uid !== uid) return;
            ingestFlipDocs(snapshotDocs(snap).map((d) => ({ id: d.id, ...d.data })));
            renderFlipGames();
            maybeAnimateNewFlip();
          } catch (error) { noteCloudError('Défis illisibles (temps réel)', error); }
        }, (error) => noteCloudError('Défis illisibles (temps réel)', error));
        if (typeof stop === 'function') stops.push(stop);
      } catch (error) { /* temps réel indisponible : « Actualiser » via rechargement */ }
    };
    watch('toUid');
    watch('fromUid');
    if (!stops.length) return;
    flipUnsub = () => {
      flipUnsub = null;
      stops.forEach((stop) => { try { stop(); } catch (error) { /* déjà fermé */ } });
    };
  }

  function unsubscribeFlipGames() {
    if (flipUnsub) flipUnsub();
    flipUnsub = null;
  }

  /* Formulaire « Défier un ami » : choix du côté pile / face. */
  document.querySelectorAll('[data-flip-choice]').forEach((btn) => {
    on(btn, 'click', () => {
      flipChoice = btn.dataset.flipChoice === 'face' ? 'face' : 'pile';
      document.querySelectorAll('[data-flip-choice]').forEach((b) => {
        const active = b === btn;
        b.classList.toggle('is-active', active);
        b.setAttribute('aria-pressed', String(active));
      });
      SFX.tick();
    });
  });

  /* Textures pixel art dans les boutons et les deux faces de la pièce. */
  document.querySelectorAll('[data-flip-icon]').forEach((icon) => {
    icon.innerHTML = flipFaceSvg(icon.dataset.flipIcon);
  });
  const flipCoinPile = $('flip-coin-pile');
  const flipCoinFace = $('flip-coin-face');
  if (flipCoinPile) flipCoinPile.innerHTML = flipFaceSvg('pile');
  if (flipCoinFace) flipCoinFace.innerHTML = flipFaceSvg('face');

  on($('flip-create-form'), 'submit', (e) => {
    e.preventDefault();
    if (!cloudReady()) { flipInfo('Connecte-toi pour jouer.'); return; }
    const toUid = flipFriend && flipFriend.value;
    if (!toUid || !friends.includes(toUid)) { flipInfo('Choisis un ami à défier.'); return; }
    let amount = 0;
    try { amount = marketNumber(flipAmountInput, 0); } catch (error) { flipInfo(error.message); return; }
    askConfirm({
      title: 'Lancer ce défi ?',
      message: `Défier ${flipPseudo(toUid)} avec une mise de ${fmt(amount)} 🪙 sur ${FLIP_LABELS[flipChoice]} ? Ta mise est réservée jusqu’au résultat.`,
      confirmLabel: 'Défier',
      onConfirm: () => flipTransaction('create', null, { toUid, amount, choice: flipChoice })
    });
  });

  on($('flip-close'), 'click', () => {
    const overlay = $('flip-overlay');
    if (overlay) {
      overlay.hidden = true;
      overlay.setAttribute('aria-hidden', 'true');
    }
    /* Le gagnant récupère la cagnotte dès la fin de l'animation (sinon le
       bouton « Récupérer » de l'historique reste disponible). */
    const me = currentUser && currentUser.uid;
    const game = flipGames.find((g) => g.id === flipActiveGameId
      && g.status === 'finished' && g.winnerUid === me);
    flipActiveGameId = null;
    if (game) flipTransaction('claim', game);
  });

  function globalMarketInfo(message) {
    if (globalMarketMessage) globalMarketMessage.textContent = message || '';
  }

  /* Charge toutes les annonces ouvertes, tous vendeurs confondus. Une seule
     requête (pas de filtre par ami) : c'est ce qui permet de voir le marché
     des joueurs qu'on ne connaît pas encore. Le pseudo du vendeur vient du
     profil public (playerProfiles), mis en cache dans friendProfiles. */
  async function loadGlobalMarket({ keepMessage = false } = {}) {
    if (!cloudReady() || !globalMarketList) return;
    if (!keepMessage) globalMarketInfo('');
    if (!globalListingsLoaded) {
      globalMarketList.replaceChildren(el('p', 'online-empty', 'Chargement du marché global…'));
    }
    try {
      const coll = cloudDb.collection('marketListings');
      if (!coll || typeof coll.where !== 'function') return;
      const snap = await coll.where('status', '==', 'open').get();
      if (!currentUser) return;
      globalListings = snapshotDocs(snap)
        .map((d) => ({ id: d.id, ...d.data }))
        .filter((l) => l.status === 'open' && l.sellerUid);
      globalListingsLoaded = true;
      await Promise.all([...new Set(globalListings.map((l) => l.sellerUid))]
        .filter((uid) => !friendProfiles.has(uid))
        .map((uid) => fetchFriendProfile(uid)));
      if (!currentUser) return;
      renderGlobalMarket();
    } catch (error) {
      globalListingsLoaded = true;
      if (globalMarketList) {
        globalMarketList.replaceChildren(el('p', 'online-empty',
          isPermissionDenied(error)
            ? 'Accès au marché global refusé. Vérifie le projet, la connexion et les règles Firestore (voir le README et la console).'
            : 'Impossible de charger le marché global. Vérifie ta connexion et réessaie.'));
      }
      noteCloudError('Marché global illisible', error);
    }
  }

  /* Le marché global est un catalogue : toutes les annonces d'une même carte
     sont regroupées, quel que soit le vendeur ou le prix. Les mutations Shiny
     ont un cardId distinct (« base::shiny ») et restent donc dans leur section. */
  function groupGlobalListings(list) {
    const byItem = new Map();
    for (const listing of list) {
      if (!listing.sellerUid) continue;
      const isPack = isPackListing(listing);
      const cardId = isPack ? '' : String(listing.cardId || '');
      const card = cardId ? CardMutations.resolve(cardId) : null;
      const key = isPack ? `pack:${listing.packType}` : `card:${cardId}`;
      let item = byItem.get(key);
      if (!item) {
        item = {
          key,
          kind: isPack ? 'pack' : 'card',
          cardId,
          card,
          packType: isPack ? listing.packType : '',
          shiny: Boolean(card && CardMutations.definition(card)),
          listings: []
        };
        byItem.set(key, item);
      }
      item.listings.push(listing);
    }
    return [...byItem.values()];
  }

  function globalMarketItemName(item) {
    if (item.kind === 'pack') return packName(item.packType);
    return item.card ? CardMutations.label(item.card) : cardName(item.cardId);
  }

  function globalMarketOfferGroups(item) {
    const bySellerAndPrice = new Map();
    for (const listing of item.listings) {
      const price = Number(listing.price) || 0;
      const key = JSON.stringify([listing.sellerUid, price]);
      let offer = bySellerAndPrice.get(key);
      if (!offer) {
        offer = {
          uid: listing.sellerUid,
          price,
          ids: [],
          createdAt: listing.createdAt || ''
        };
        bySellerAndPrice.set(key, offer);
      }
      offer.ids.push(listing.id);
      if (String(listing.createdAt || '').localeCompare(String(offer.createdAt || '')) > 0) {
        offer.createdAt = listing.createdAt;
      }
    }
    const sort = (globalMarketSort && globalMarketSort.value) || 'cheap';
    return [...bySellerAndPrice.values()].map((offer) => ({
      ...offer,
      data: friendProfiles.get(offer.uid) || { pseudo: 'Joueur', avatar: '' }
    })).sort((a, b) => {
      if (sort === 'expensive' && a.price !== b.price) return b.price - a.price;
      if (sort === 'recent' && a.createdAt !== b.createdAt) {
        return String(b.createdAt || '').localeCompare(String(a.createdAt || ''));
      }
      if (sort !== 'expensive' && sort !== 'recent' && a.price !== b.price) return a.price - b.price;
      return String((a.data && a.data.pseudo) || '').localeCompare(
        String((b.data && b.data.pseudo) || ''), 'fr', { sensitivity: 'base' }
      ) || a.price - b.price;
    });
  }

  function globalMarketSellerActions(uid, data) {
    const actions = el('div', 'global-market-seller-actions');
    if (friends.includes(uid)) {
      actions.append(el('span', 'global-seller-tag', 'Ami'));
      const view = el('button', 'mini-btn', 'Profil');
      view.type = 'button';
      on(view, 'click', () => openFriendDetail(uid));
      actions.append(view);
    } else if (pendingFriendUids.has(uid)) {
      actions.append(el('span', 'global-seller-tag', 'Demande envoyée'));
    } else {
      const add = el('button', 'mini-btn', 'Ajouter en ami');
      add.type = 'button';
      add.setAttribute('aria-label', `Ajouter ${(data && data.pseudo) || 'ce vendeur'} en ami`);
      on(add, 'click', async () => {
        add.disabled = true;
        const ok = await sendFriendRequest(uid);
        if (!ok) add.disabled = false;
      });
      actions.append(add);
    }
    return actions;
  }

  function globalMarketOfferRow(item, offer) {
    const row = el('div', 'global-market-offer');
    const count = offer.ids.length;
    const isPack = item.kind === 'pack';
    const name = globalMarketItemName(item);
    const unit = isPack ? 'pack' : 'carte';
    row.append(friendIdentity(offer.data));

    const priceBox = el('div', 'global-market-offer-price-box');
    priceBox.dataset.price = String(offer.price);
    priceBox.append(
      el('strong', 'global-market-offer-price', `${fmt(offer.price)} 🪙`),
      el('span', 'global-market-offer-unit', `/ ${unit}`),
      el('span', 'global-market-offer-stock', `${count} disponible${count > 1 ? 's' : ''}`)
    );
    row.append(priceBox, globalMarketSellerActions(offer.uid, offer.data));

    let qtyInput = null;
    const maxQty = Math.min(count, MAX_MARKET_QTY);
    if (count > 1) {
      const qtyWrap = el('div', 'market-row-qty-wrap global-market-qty-wrap');
      const minus = el('button', 'qty-btn market-row-btn', '−');
      minus.type = 'button';
      minus.setAttribute('aria-label', `Acheter ${isPack ? 'un pack' : 'une carte'} de moins`);
      qtyInput = el('input', 'market-row-qty');
      qtyInput.type = 'number';
      qtyInput.min = '1';
      qtyInput.max = String(maxQty);
      qtyInput.step = '1';
      qtyInput.value = '1';
      qtyInput.inputMode = 'numeric';
      qtyInput.setAttribute('aria-label', `Quantité de ${name} à acheter à ${(offer.data && offer.data.pseudo) || 'ce vendeur'}`);
      const plus = el('button', 'qty-btn market-row-btn', '+');
      plus.type = 'button';
      plus.setAttribute('aria-label', `Acheter ${isPack ? 'un pack' : 'une carte'} de plus`);
      const syncRowQty = () => {
        const raw = qtyInput.value.trim();
        const val = /^\d+$/.test(raw) ? Number(raw) : NaN;
        minus.disabled = !Number.isSafeInteger(val) || val <= 1;
        plus.disabled = !Number.isSafeInteger(val) || val >= maxQty;
      };
      on(minus, 'click', () => {
        const cur = /^\d+$/.test(qtyInput.value.trim()) ? Number(qtyInput.value.trim()) : 1;
        qtyInput.value = String(clamp(cur - 1, 1, maxQty));
        syncRowQty();
        SFX.tick();
      });
      on(plus, 'click', () => {
        const cur = /^\d+$/.test(qtyInput.value.trim()) ? Number(qtyInput.value.trim()) : 1;
        qtyInput.value = String(clamp(cur + 1, 1, maxQty));
        syncRowQty();
        SFX.tick();
      });
      on(qtyInput, 'input', syncRowQty);
      syncRowQty();
      qtyWrap.append(minus, qtyInput, plus);
      row.append(qtyWrap);
    }

    const buy = el('button', 'mini-btn primary global-market-buy', 'Acheter');
    buy.type = 'button';
    buy.setAttribute('aria-label', `Acheter ${name} à ${(offer.data && offer.data.pseudo) || 'ce vendeur'} pour ${fmt(offer.price)} pièces`);
    on(buy, 'click', () => {
      try {
        const quantity = qtyInput ? marketBuyQuantity(qtyInput, count) : 1;
        const total = offer.price * quantity;
        if (!Number.isSafeInteger(total)) throw new Error('Montant total trop élevé.');
        const noun = isPack ? 'pack' : 'carte';
        const nounPlural = isPack ? 'packs' : 'cartes';
        const sellerName = (offer.data && offer.data.pseudo) || 'ce joueur';
        const message = quantity === 1
          ? `Acheter « ${name} » à ${sellerName} pour ${fmt(offer.price)} 🪙 ?`
          : `Acheter ${quantity} ${isPack ? 'packs' : 'exemplaires'} de « ${name} » à ${sellerName} pour ${fmt(total)} 🪙 (${fmt(offer.price)} 🪙 / ${unit}) ?`;
        askConfirm({
          title: quantity === 1 ? `Acheter ce ${noun} ?` : `Acheter ces ${nounPlural} ?`,
          message,
          confirmLabel: 'Acheter',
          onConfirm: () => (quantity === 1
            ? marketTransaction('buy', offer.ids[0], null, { fromGlobal: true })
            : marketTransaction('buy', null, { ids: offer.ids, quantity, unitPrice: offer.price }, { fromGlobal: true, sellerUid: offer.uid }))
        });
      } catch (error) { globalMarketInfo(error.message); }
    });
    row.append(buy);
    if (!isPack && offer.price > 0) {
      const negotiate = el('button', 'mini-btn', 'Proposer un prix');
      negotiate.type = 'button';
      on(negotiate, 'click', () => askOfferPrice('Proposer un prix', `Pour une carte « ${name} » : propose moins de ${fmt(offer.price)} 🪙.`, offer.price,
        (price) => createOffer(offer.ids[0], price)));
      row.append(negotiate);
    }
    return row;
  }

  function globalMarketProduct(item) {
    const product = el('article', 'global-market-product');
    const name = globalMarketItemName(item);
    const count = item.listings.length;
    const prices = item.listings.map((listing) => Number(listing.price) || 0);
    const lowestPrice = Math.min(...prices);
    const preview = el('span', 'global-market-card-preview');
    preview.setAttribute('aria-hidden', 'true');
    if (item.card) {
      preview.append(cardFrame(item.card, {
        mini: true,
        disableVideo: true,
        alt: `${name} — ${(RARITIES[item.card.rarity] || RARITIES.common).label}`
      }));
    } else if (item.kind === 'pack') {
      const image = el('img', 'global-market-pack-preview');
      image.src = PACK_IMAGES[item.packType] || PACK_IMAGES.classic;
      image.alt = '';
      image.loading = 'lazy';
      image.draggable = false;
      preview.append(image);
    } else {
      preview.append(el('span', 'global-market-card-fallback', '🃏'));
    }

    const copy = el('span', 'global-market-item-copy');
    const info = item.card ? (RARITIES[item.card.rarity] || RARITIES.common) : null;
    if (info) {
      const rarity = el('span', 'global-market-card-rarity', info.label);
      rarity.dataset.rarity = item.card.rarity;
      copy.append(rarity);
    } else if (item.shiny) {
      copy.append(el('span', 'global-market-card-rarity', '✦ Shiny'));
    } else if (item.kind === 'pack') {
      copy.append(el('span', 'global-market-card-rarity global-market-pack-label', 'BOOSTER'));
    }
    const title = el('strong', 'global-market-card-title', name);
    if (info) {
      title.dataset.rarity = item.card.rarity;
      title.style.setProperty('--market-rarity-color', info.color);
      title.style.setProperty('--market-rarity-glow', info.glow);
    }
    copy.append(title);
    const stats = el('span', 'global-market-item-stats');
    stats.append(
      el('strong', 'global-market-stock', `${count} en vente`),
      el('span', 'global-market-floor', `Dès ${fmt(lowestPrice)} 🪙`)
    );
    copy.append(stats);

    const offersId = `global-market-offers-${encodeURIComponent(item.key)}`;
    const trigger = el('button', 'global-market-product-trigger');
    trigger.type = 'button';
    trigger.setAttribute('aria-expanded', 'false');
    trigger.setAttribute('aria-controls', offersId);
    trigger.setAttribute('aria-label', `${name}, ${count} en vente à partir de ${fmt(lowestPrice)} pièces. Afficher les vendeurs.`);
    trigger.append(preview, copy, el('span', 'global-market-toggle-icon', '⌄'));

    const offers = el('div', 'global-market-offers');
    offers.id = offersId;
    offers.hidden = true;
    on(trigger, 'click', () => {
      const expanded = trigger.getAttribute('aria-expanded') !== 'true';
      trigger.setAttribute('aria-expanded', String(expanded));
      product.classList.toggle('is-expanded', expanded);
      offers.hidden = !expanded;
      if (expanded && offers.dataset.loaded !== 'true') {
        const heading = el('div', 'global-market-offers-heading');
        heading.append(
          el('strong', '', 'Vendeurs'),
          el('span', '', (globalMarketSort && globalMarketSort.value) === 'expensive'
            ? 'du plus cher au moins cher'
            : (globalMarketSort && globalMarketSort.value) === 'recent'
              ? 'annonces les plus récentes'
              : 'du moins cher au plus cher')
        );
        const offerRows = globalMarketOfferGroups(item).map((offer) => globalMarketOfferRow(item, offer));
        offers.replaceChildren(heading, ...offerRows);
        offers.dataset.loaded = 'true';
      }
    });
    product.append(trigger, offers);
    return product;
  }

  function globalMarketSection(kind, title, items) {
    if (!items.length) return null;
    const section = el('section', 'global-market-section');
    section.dataset.marketKind = kind;
    section.setAttribute('aria-label', title);
    const head = el('div', 'global-market-section-head');
    head.append(
      el('h4', 'global-market-section-title', title),
      el('span', 'global-market-section-count', `${items.reduce((sum, item) => sum + item.listings.length, 0)} en vente`)
    );
    const grid = el('div', 'global-market-grid');
    grid.append(...items.map(globalMarketProduct));
    section.append(head, grid);
    return section;
  }

  function renderGlobalMarket() {
    if (!globalMarketList) return;
    const me = currentUser && currentUser.uid;
    const rawQuery = (globalMarketSearch && globalMarketSearch.value || '').trim().toLowerCase();
    const items = groupGlobalListings(globalListings.filter((listing) => listing.sellerUid !== me));
    const filtered = items.filter((item) => {
      if (!rawQuery) return true;
      const name = globalMarketItemName(item).toLowerCase();
      const baseName = item.card ? String(item.card.name || '').toLowerCase() : '';
      if (name.includes(rawQuery) || baseName.includes(rawQuery)) return true;
      return item.listings.some((listing) => {
        const seller = friendProfiles.get(listing.sellerUid);
        return String((seller && seller.pseudo) || '').toLowerCase().includes(rawQuery);
      });
    });
    const openCount = filtered.reduce((total, item) => total + item.listings.length, 0);
    if (globalMarketCount) globalMarketCount.textContent = String(openCount);
    setTabCount(onlineTabCounts.market, openCount);
    if (!filtered.length) {
      globalMarketList.replaceChildren(el('p', 'online-empty', globalListingsLoaded
        ? (rawQuery ? 'Aucune annonce ne correspond à ce filtre.' : 'Aucune annonce d’un autre joueur pour le moment. Mets les tiennes en vente juste au-dessus !')
        : 'Chargement du marché global…'));
      return;
    }

    const byName = (a, b) => globalMarketItemName(a).localeCompare(
      globalMarketItemName(b), 'fr', { sensitivity: 'base' }
    );
    const cards = filtered.filter((item) => item.kind === 'card' && !item.shiny).sort(byName);
    const shiny = filtered.filter((item) => item.kind === 'card' && item.shiny).sort(byName);
    const packs = filtered.filter((item) => item.kind === 'pack').sort(byName);
    const sections = [
      globalMarketSection('cards', '🃏 Cartes', cards),
      globalMarketSection('shiny', '✦ Cartes Shiny', shiny),
      globalMarketSection('packs', '📦 Packs', packs)
    ].filter(Boolean);
    globalMarketList.replaceChildren(...sections);
  }

  async function loadFriendListings(uid) {
    if (!cloudReady() || !friendListings) return;
    friendListings.replaceChildren(el('p', 'online-empty', 'Chargement des ventes…'));
    try {
      // Les règles ne rendent publiques que les annonces ouvertes. Une requête
      // par vendeur seul pourrait inclure ses ventes terminées et est refusée,
      // même si on filtre les résultats après coup. Évite un index composite.
      const snap = await cloudDb.collection('marketListings').where('status', '==', 'open').get();
      if (selectedFriendUid !== uid) return;
      const listings = snapshotDocs(snap).map((d) => ({ id: d.id, ...d.data })).filter((l) => l.status === 'open' && l.sellerUid === uid);
      const groups = groupListings(listings);
      friendListings.replaceChildren(...(groups.length ? groups.map((group) => {
        const row = el('div', 'trade-row');
        const count = group.ids.length;
        const isPack = Boolean(group.packType);
        const name = isPack ? packName(group.packType) : cardName(group.cardId);
        const unit = isPack ? 'pack' : 'carte';
        const label = count > 1
          ? `${name} (×${count} dispo) · ${fmt(group.price)} 🪙 / ${unit}`
          : `${name} · ${fmt(group.price)} 🪙`;
        row.append(el('span', 'trade-text', label));
        let qtyInput = null;
        if (count > 1) {
          const qtyWrap = el('div', 'market-row-qty-wrap');
          const minus = el('button', 'qty-btn market-row-btn', '−');
          minus.type = 'button';
          minus.setAttribute('aria-label', `Acheter ${unit === 'pack' ? 'un pack' : 'une carte'} de moins`);
          qtyInput = el('input', 'market-row-qty');
          qtyInput.type = 'number';
          qtyInput.min = '1';
          qtyInput.max = String(count);
          qtyInput.step = '1';
          qtyInput.value = '1';
          qtyInput.inputMode = 'numeric';
          qtyInput.setAttribute('aria-label', `Quantité de ${name} à acheter`);
          const plus = el('button', 'qty-btn market-row-btn', '+');
          plus.type = 'button';
          plus.setAttribute('aria-label', `Acheter ${unit === 'pack' ? 'un pack' : 'une carte'} de plus`);
          const syncRowQty = () => {
            const raw = qtyInput.value.trim();
            const val = /^\d+$/.test(raw) ? Number(raw) : NaN;
            minus.disabled = !Number.isSafeInteger(val) || val <= 1;
            plus.disabled = !Number.isSafeInteger(val) || val >= count;
          };
          on(minus, 'click', () => {
            const cur = /^\d+$/.test(qtyInput.value.trim()) ? Number(qtyInput.value.trim()) : 1;
            qtyInput.value = String(clamp(cur - 1, 1, count));
            syncRowQty();
            SFX.tick();
          });
          on(plus, 'click', () => {
            const cur = /^\d+$/.test(qtyInput.value.trim()) ? Number(qtyInput.value.trim()) : 1;
            qtyInput.value = String(clamp(cur + 1, 1, count));
            syncRowQty();
            SFX.tick();
          });
          on(qtyInput, 'input', syncRowQty);
          syncRowQty();
          qtyWrap.append(minus, qtyInput, plus);
          row.append(qtyWrap);
        }
        const buy = el('button', 'mini-btn primary', 'Acheter');
        buy.type = 'button';
        on(buy, 'click', () => {
          try {
            const quantity = qtyInput ? (isPack ? marketPackQuantity(qtyInput, count) : marketQuantity(qtyInput, count)) : 1;
            const total = group.price * quantity;
            if (!Number.isSafeInteger(total)) throw new Error('Montant total trop élevé.');
            const noun = isPack ? 'pack' : 'carte';
            const nounPlural = isPack ? 'packs' : 'cartes';
            const msg = quantity === 1
              ? `Acheter « ${name} » pour ${fmt(group.price)} 🪙 ?`
              : `Acheter ${quantity} ${isPack ? 'packs' : 'exemplaires'} de « ${name} » pour ${fmt(total)} 🪙 (${fmt(group.price)} 🪙 / ${noun}) ?`;
            askConfirm({
              title: quantity === 1 ? `Acheter ce ${noun} ?` : `Acheter ces ${nounPlural} ?`,
              message: msg,
              confirmLabel: 'Acheter',
              onConfirm: () => (quantity === 1
                ? marketTransaction('buy', group.ids[0])
                : marketTransaction('buy', null, { ids: group.ids, quantity, unitPrice: group.price }))
            });
          } catch (error) { marketInfo(error.message); }
        });
        row.append(buy);
        if (!isPack && group.price > 0) {
          const negotiate = el('button', 'mini-btn', 'Proposer un prix');
          negotiate.type = 'button';
          on(negotiate, 'click', () => askOfferPrice('Proposer un prix', `Pour une carte « ${name} » : propose moins de ${fmt(group.price)} 🪙.`, group.price,
            (price) => createOffer(group.ids[0], price)));
          row.append(negotiate);
        }
        return row;
      }) : [el('p', 'online-empty', 'Aucune annonce en cours pour le moment.') ]));
    } catch (error) {
      if (selectedFriendUid === uid) friendListings.replaceChildren(el('p', 'online-empty', 'Impossible de charger les ventes. Réessaie.'));
      noteCloudError('Ventes de l’ami illisibles', error);
    }
  }

  async function createOffer(listingId, price) {
    if (!cloudReady()) { marketInfo('Connecte-toi pour proposer un prix.'); return; }
    const uid = currentUser.uid;
    try {
      const listingRef = cloudDb.collection('marketListings').doc(listingId);
      const ref = cloudDb.collection('marketOffers').doc();
      await cloudDb.runTransaction(async (tx) => {
        const snap = await tx.get(listingRef);
        const listing = snap.exists && snap.data();
        if (!listing || listing.status !== 'open' || listing.sellerUid === uid || !listing.cardId || price >= listing.price) throw new Error('Cette annonce n’est plus disponible à ce prix.');
        tx.set(ref, { listingId, sellerUid: listing.sellerUid, buyerUid: uid, cardId: listing.cardId, listingPrice: listing.price, price, status: 'pending', turn: 'seller', createdAt: serverTimestamp() });
      });
      marketInfo('Offre envoyée ! Retrouve-la dans « Récupérer ».');
      await loadMarket();
    } catch (error) { marketInfo(isPermissionDenied(error) ? RULES_HELP : (error.message || 'Offre impossible.')); }
  }

  async function respondOffer(offer, response, price) {
    if (!cloudReady()) return;
    const uid = currentUser.uid;
    try {
      const ref = cloudDb.collection('marketOffers').doc(offer.id);
      await cloudDb.runTransaction(async (tx) => {
        const snap = await tx.get(ref);
        const data = snap.exists && snap.data();
        if (!data || data.status !== 'pending' || (data.turn === 'seller' ? data.sellerUid : data.buyerUid) !== uid) throw new Error('Cette offre a déjà changé.');
        const listingSnap = await tx.get(cloudDb.collection('marketListings').doc(data.listingId));
        if (!listingSnap.exists || listingSnap.data().status !== 'open') throw new Error('Cette carte n’est plus en vente.');
        if (response === 'counter') {
          if (price >= data.listingPrice) throw new Error('Le prix doit rester inférieur au prix de l’annonce.');
          tx.update(ref, { price, turn: data.turn === 'seller' ? 'buyer' : 'seller' });
        } else tx.update(ref, { status: response === 'accept' ? 'accepted' : 'rejected' });
      });
      marketInfo(response === 'accept' ? 'Offre acceptée : l’acheteur peut confirmer son achat.' : response === 'counter' ? 'Contre-offre envoyée.' : 'Offre refusée.');
      await loadMarket();
    } catch (error) { marketInfo(isPermissionDenied(error) ? RULES_HELP : (error.message || 'Réponse impossible.')); }
  }

  function renderOffers() {
    const container = $('market-offers');
    if (!container || !currentUser) return;
    const uid = currentUser.uid;
    const offers = [...receivedOffers, ...sentOffers].filter((o) => o.status === 'pending' || o.status === 'accepted' || o.status === 'rejected');
    container.replaceChildren(...(offers.length ? offers.map((offer) => {
      const row = el('div', 'trade-row');
      const isSeller = offer.sellerUid === uid;
      const myTurn = offer.status === 'pending' && (isSeller ? offer.turn === 'seller' : offer.turn === 'buyer');
      const otherUid = isSeller ? offer.buyerUid : offer.sellerUid;
      const text = el('span', 'trade-text');
      const describe = (pseudo) => { text.textContent = `${isSeller ? 'Offre de' : 'Offre à'} ${pseudo} · ${cardName(offer.cardId)} · ${fmt(offer.price)} 🪙 · ${offer.status === 'rejected' ? 'refusée' : offer.status === 'accepted' ? 'acceptée, achat à confirmer' : myTurn ? 'à toi de répondre' : 'en attente'}`; };
      describe((friendProfiles.get(otherUid) || {}).pseudo || 'Joueur');
      if (!friendProfiles.has(otherUid)) fetchFriendProfile(otherUid).then((profile) => describe(profile.pseudo || 'Joueur'));
      row.append(text);
      if (myTurn) {
        const accept = el('button', 'mini-btn primary', 'Accepter'); accept.type = 'button';
        on(accept, 'click', () => respondOffer(offer, 'accept'));
        const reject = el('button', 'mini-btn', 'Refuser'); reject.type = 'button';
        on(reject, 'click', () => respondOffer(offer, 'reject'));
        const counter = el('button', 'mini-btn', 'Contre-offre'); counter.type = 'button';
        on(counter, 'click', () => askOfferPrice('Faire une contre-offre', `Propose moins de ${fmt(offer.listingPrice)} 🪙 pour cette carte.`, offer.listingPrice, (price) => respondOffer(offer, 'counter', price)));
        row.append(accept, reject, counter);
      }
      if (!isSeller && offer.status === 'accepted') {
        const buy = el('button', 'mini-btn primary', 'Confirmer l’achat'); buy.type = 'button';
        on(buy, 'click', () => askConfirm({ title: 'Confirmer cet achat ?', message: `Acheter « ${cardName(offer.cardId)} » pour ${fmt(offer.price)} 🪙 ?`, confirmLabel: 'Acheter', onConfirm: () => marketTransaction('buyOffer', offer.listingId, { offerId: offer.id }) }));
        row.append(buy);
      }
      return row;
    }) : [el('p', 'online-empty', 'Aucune négociation en cours.') ]));
  }

  async function marketTransaction(action, id, value, options = {}) {
    /* `fromGlobal` : l'achat vient du marché global. Les messages vont alors
       dans ce panneau (et le marché global est rechargé) en plus du marché
       habituel : le joueur voit le résultat là où il a cliqué. */
    const fromGlobal = Boolean(options && options.fromGlobal);
    const report = (message) => {
      marketInfo(message);
      if (fromGlobal) globalMarketInfo(message);
    };
    if (!cloudReady()) { marketInfo('Connexion requise pour envoyer des pièces.'); return; }
    if (marketBusy) { marketInfo('Une autre opération est en cours, réessaie dans un instant.'); return; }
    if (typeof cloudDb.runTransaction !== 'function') { marketInfo('Transactions indisponibles. Réessaie plus tard.'); return; }
    const uid = currentUser.uid;
    const db = cloudDb;
    marketBusy = true;
    marketDone = new Promise((resolve) => { finishMarket = resolve; });
    const overlay = el('div', 'market-busy', 'Transaction en cours…');
    overlay.setAttribute('role', 'status');
    document.body.append(overlay);
    gameRegions.forEach((region) => region.setAttribute('inert', ''));

    const runSingle = (singleAction, singleId, singleValue) => {
      const saveRef = db.collection('playerSaves').doc(uid);
      const collName = singleAction === 'gift' || singleAction === 'claimGift' || singleAction === 'cancelGift'
        ? 'coinGifts'
        : 'marketListings';
      const ref = singleId ? db.collection(collName).doc(singleId) : db.collection(collName).doc();
      return db.runTransaction(async (tx) => {
        const saveSnap = await tx.get(saveRef);
        const itemSnap = singleId ? await tx.get(ref) : null;
        const offerRef = singleAction === 'buyOffer' ? db.collection('marketOffers').doc(singleValue.offerId) : null;
        const offerSnap = offerRef ? await tx.get(offerRef) : null;
        if (!saveSnap.exists) throw new Error('Sauvegarde introuvable.');
        const saveData = saveSnap.data();
        const coins = Number(saveData.coins) || 0;
        const cards = Array.isArray(saveData.collection) ? [...saveData.collection] : [];
        const savedStock = (saveData && saveData.packStock) || {};
        /* On repart de TOUS les types (vidéo comprise) : une transaction sur
           une carte ne doit jamais effacer un stock de packs vidéo. */
        const packStock = packStockFrom(savedStock);
        /* On utilise la liste d'amis ENREGISTRÉE (celle que vérifient les
           règles Firestore), pas l'état mémoire qui peut être en avance. */
        const savedFriends = Array.isArray(saveData.friends) ? saveData.friends : [];
        const item = itemSnap && itemSnap.exists ? itemSnap.data() : null;
        const isPackItem = Boolean(item && (item.packType === 'classic' || item.packType === 'rare'));
        let nextCoins = coins;
        let patch;
        if (singleAction === 'list' && singleValue && singleValue.packType) {
          const type = singleValue.packType === 'rare' ? 'rare' : 'classic';
          if (packStock[type] < 1) throw new Error('Tu ne possèdes plus ce pack.');
          packStock[type] -= 1;
          tx.set(ref, { sellerUid: uid, packType: type, price: singleValue.price, status: 'open', buyerUid: '', createdAt: serverTimestamp() });
        } else if (singleAction === 'list') {
          const index = cards.indexOf(singleValue.cardId);
          if (index < 0) throw new Error('Tu ne possèdes plus cette carte.');
          cards.splice(index, 1);
          tx.set(ref, { sellerUid: uid, cardId: singleValue.cardId, price: singleValue.price, status: 'open', buyerUid: '', createdAt: serverTimestamp() });
        } else if (singleAction === 'gift') {
          if (!savedFriends.includes(singleValue.toUid) || uid === singleValue.toUid) throw new Error('Ce joueur ne fait plus partie de tes amis.');
          if (coins < singleValue.amount) throw new Error('Tu n’as pas assez de pièces.');
          nextCoins -= singleValue.amount;
          tx.set(ref, { fromUid: uid, toUid: singleValue.toUid, amount: singleValue.amount, status: 'pending', createdAt: serverTimestamp() });
        } else if (singleAction === 'cancel') {
          if (!item || item.sellerUid !== uid || item.status !== 'open') throw new Error('Cette annonce n’est plus disponible.');
          if (isPackItem) {
            packStock[item.packType] = Math.min(100000, packStock[item.packType] + 1);
          } else {
            if (cards.length >= 10000) throw new Error('Ta collection est pleine.');
            cards.push(item.cardId);
          }
          patch = { status: 'cancelled' };
        } else if (singleAction === 'buy' || singleAction === 'buyOffer') {
          const negotiated = offerSnap && offerSnap.exists ? offerSnap.data() : null;
          if (singleAction === 'buyOffer' && (!negotiated || negotiated.status !== 'accepted' || negotiated.buyerUid !== uid || negotiated.listingId !== singleId || !item || negotiated.sellerUid !== item.sellerUid)) throw new Error('Cette offre n’est plus disponible.');
          const buyPrice = negotiated ? negotiated.price : item && item.price;
          if (!item || item.status !== 'open' || item.sellerUid === uid) {
            throw new Error(isPackItem ? 'Ce pack n’est plus en vente.' : 'Cette carte n’est plus en vente.');
          }
          /* Le marché global autorise l'achat chez n'importe qui ; l'ancien
             marché « entre amis » ne proposait que des amis. Les règles
             Firestore restent seules juge (voir firestore.rules). */
          if (coins < buyPrice) throw new Error('Tu n’as pas assez de pièces.');
          if (isPackItem) {
            packStock[item.packType] = Math.min(100000, packStock[item.packType] + 1);
          } else {
            if (cards.length >= 10000) throw new Error('Ta collection est pleine.');
            cards.push(item.cardId);
          }
          nextCoins -= buyPrice; patch = { status: 'sold', buyerUid: uid };
          if (negotiated) { patch.price = buyPrice; patch.offerId = singleValue.offerId; tx.update(offerRef, { status: 'completed' }); }
        } else if (singleAction === 'claimSale') {
          if (!item || item.sellerUid !== uid || item.status !== 'sold') throw new Error('Cette vente a déjà été récupérée.');
          nextCoins += item.price; patch = { status: 'completed' };
        } else if (singleAction === 'claimGift') {
          if (!item || item.toUid !== uid || item.status !== 'pending') throw new Error('Ce cadeau a déjà été récupéré.');
          nextCoins += item.amount; patch = { status: 'claimed' };
        } else if (singleAction === 'cancelGift') {
          // Le destinataire n'a pas encore récupéré : l'expéditeur est remboursé.
          if (!item || item.fromUid !== uid || item.status !== 'pending') throw new Error('Ce cadeau n’est plus en attente.');
          nextCoins += item.amount; patch = { status: 'cancelled' };
        } else throw new Error('Action inconnue.');
        if (nextCoins > MAX_COINS) throw new Error('Ton solde dépasserait la limite de pièces. Dépense-en avant de récupérer ce montant.');
        if (patch) tx.update(ref, patch);
        const txPackStock = cloudPackStock(packStock, Object.prototype.hasOwnProperty.call(savedStock, 'ultra'), Object.prototype.hasOwnProperty.call(savedStock, 'doubleRare'));
        tx.update(saveRef, { coins: nextCoins, collection: cards, packStock: txPackStock, updatedAt: serverTimestamp() });
        return { coins: nextCoins, cards, packStock };
      });
    };

    const applyResult = (result) => {
      if (!result || !currentUser || currentUser.uid !== uid) return;
      state.coins = result.coins;
      state.collection = result.cards.map((cardId) => CardMutations.resolve(cardId)).filter(Boolean);
      if (result.packStock) {
        state.packStock = packStockFrom(result.packStock);
        if ((state.packStock[state.currentPackType] || 0) <= 0 && packTotal() > 0) {
          selectPackType(firstAvailablePackType(), { silent: true });
        }
      }
      updateCoins(); renderCollection(); renderShop(); renderAccount(); renderPackInventory(); saveProfileSoon();
    };

    let lastResult = null;
    let doneCount = 0;
    let targetCount = 1;
    try {
      if (!await saveNow(true)) throw new Error('Sauvegarde impossible : transaction annulée.');
      if (action === 'list') {
        const isPackList = Boolean(value && value.packType);
        targetCount = Math.max(1, Number(value && value.quantity) || 1);
        for (let step = 0; step < targetCount; step++) {
          if (!currentUser || currentUser.uid !== uid) return;
          if (targetCount > 1) overlay.textContent = `Mise en vente (${step + 1} / ${targetCount})…`;
          lastResult = await runSingle('list', null, value);
          doneCount++;
        }
        applyResult(lastResult);
        if (isPackList) {
          if (packMarketQty) packMarketQty.value = '1';
          marketInfo(doneCount === 1 ? 'Pack mis en vente !' : `${doneCount} packs mis en vente !`);
        } else {
          if (marketQty) marketQty.value = '1';
          marketInfo(doneCount === 1 ? 'Carte mise en vente !' : `${doneCount} cartes mises en vente !`);
        }
      } else if (action === 'cancel' && value && Array.isArray(value.ids)) {
        targetCount = value.ids.length;
        let lastError = null;
        for (let step = 0; step < targetCount; step++) {
          if (!currentUser || currentUser.uid !== uid) return;
          if (targetCount > 1) overlay.textContent = `Retrait (${step + 1} / ${targetCount})…`;
          try {
            lastResult = await runSingle('cancel', value.ids[step], null);
            doneCount++;
          } catch (err) {
            if (err && err.message === 'Cette annonce n’est plus disponible.') { lastError = err; continue; }
            throw err;
          }
        }
        if (doneCount === 0) throw (lastError || new Error('Cette annonce n’est plus disponible.'));
        applyResult(lastResult);
        marketInfo(doneCount === targetCount
          ? (doneCount === 1 ? 'Annonce retirée : rendu à ton inventaire.' : `${doneCount} annonces retirées : rendus à ton inventaire.`)
          : `${doneCount} annonce${doneCount > 1 ? 's' : ''} retirée${doneCount > 1 ? 's' : ''} (le reste avait déjà été vendu).`);
      } else if (action === 'buy' && value && Array.isArray(value.ids)) {
        targetCount = Math.max(1, Number(value.quantity) || value.ids.length);
        if (typeof value.unitPrice === 'number' && state.coins < value.unitPrice * targetCount) {
          throw new Error('Tu n’as pas assez de pièces.');
        }
        let lastError = null;
        for (const candidateId of value.ids) {
          if (doneCount >= targetCount) break;
          if (!currentUser || currentUser.uid !== uid) return;
          if (targetCount > 1) overlay.textContent = `Achat (${doneCount + 1} / ${targetCount})…`;
          try {
            lastResult = await runSingle('buy', candidateId, null);
            doneCount++;
          } catch (err) {
            if (err && err.message === 'Cette carte n’est plus en vente.') { lastError = err; continue; }
            throw err;
          }
        }
        if (doneCount === 0) throw (lastError || new Error('Cette annonce n’est plus en vente.'));
        applyResult(lastResult);
        report(doneCount === targetCount
          ? (doneCount === 1 ? 'Achat réussi !' : `${doneCount} achats réussis !`)
          : `${doneCount} achat${doneCount > 1 ? 's' : ''} sur ${targetCount} (le reste n’était plus disponible).`);
      } else {
        lastResult = await runSingle(action, id, value);
        doneCount = 1;
        applyResult(lastResult);
        report({
          gift: 'Cadeau envoyé ! Ton ami peut le récupérer dans « Pièces à récupérer » (annulable tant qu’il ne l’a pas fait).',
          cancelGift: 'Cadeau annulé : tes pièces sont rendues.',
          cancel: 'Annonce retirée : rendu à ton inventaire.',
          buy: 'Achat réussi !',
          buyOffer: 'Achat au prix négocié réussi !',
          claimSale: 'Pièces de la vente récupérées !',
          claimGift: 'Cadeau récupéré !'
        }[action]);
      }
      /* Compteurs quêtes/succès : ventes encaissées (paiement récupéré) et
         achats sur le marché. `claimSale` rapporte le prix de l'annonce. */
      if (action === 'claimSale') {
        const sold = marketListings.find((l) => l.id === id);
        state.marketSales = (state.marketSales || 0) + 1;
        state.marketEarned = (state.marketEarned || 0) + Math.max(0, Number(sold && sold.price) || 0);
      } else if (action === 'buy' || action === 'buyOffer') {
        state.marketBuys = (state.marketBuys || 0) + doneCount;
      }
      if (action === 'claimSale' || action === 'buy' || action === 'buyOffer') {
        trackProgress();
        save();
      }
      await loadMarket();
      if (selectedFriendUid) await loadFriendListings(selectedFriendUid);
      if (fromGlobal) await loadGlobalMarket({ keepMessage: true });
    } catch (error) {
      if (lastResult) applyResult(lastResult);
      const baseMsg = isPermissionDenied(error) ? RULES_HELP : (error.message || 'Transaction impossible. Réessaie.');
      report(doneCount > 0 && targetCount > 1 ? `${doneCount} / ${targetCount} traitée${doneCount > 1 ? 's' : ''} : ${baseMsg}` : baseMsg);
      await loadMarket();
      if (selectedFriendUid) await loadFriendListings(selectedFriendUid);
      if (fromGlobal) await loadGlobalMarket({ keepMessage: true });
    } finally {
      overlay.remove();
      if (currentUser && currentUser.uid === uid) gameRegions.forEach((region) => region.removeAttribute('inert'));
      marketBusy = false;
      finishMarket();
      finishMarket = null;
    }
  }

  on(marketCard, 'change', () => {
    syncMarketQty({ reset: true });
    if (marketPrice && marketCard.value) marketPrice.placeholder = `Conseillé : ${fmt(suggestedCardPrice(marketCard.value))} 🪙`;
  });
  on($('market-suggest-price'), 'click', () => {
    const cardId = marketCard && marketCard.value;
    if (!cardId) { marketInfo('Choisis d’abord une carte.'); return; }
    if (marketPrice) marketPrice.value = String(suggestedCardPrice(cardId));
    SFX.tick();
  });
  on($('pack-market-suggest-price'), 'click', () => {
    const type = packMarketType && isPackType(packMarketType.value) ? packMarketType.value : 'classic';
    if (packMarketPrice) packMarketPrice.value = String(suggestedPackPrice(type));
    SFX.tick();
  });
  on(marketQtyMinus, 'click', () => {
    if (!marketQty) return;
    const ownedCount = countMap().get(marketCard && marketCard.value) || 0;
    const maxSell = Math.min(ownedCount, MAX_MARKET_QTY);
    if (maxSell < 1) return;
    const cur = /^\d+$/.test(marketQty.value.trim()) ? Number(marketQty.value.trim()) : 1;
    marketQty.value = String(clamp(cur - 1, 1, maxSell));
    syncMarketQty({ clampValue: true });
    SFX.tick();
  });
  on(marketQtyPlus, 'click', () => {
    if (!marketQty) return;
    const ownedCount = countMap().get(marketCard && marketCard.value) || 0;
    const maxSell = Math.min(ownedCount, MAX_MARKET_QTY);
    if (maxSell < 1) return;
    const cur = /^\d+$/.test(marketQty.value.trim()) ? Number(marketQty.value.trim()) : 1;
    marketQty.value = String(clamp(cur + 1, 1, maxSell));
    syncMarketQty({ clampValue: true });
    SFX.tick();
  });
  on(marketQty, 'input', () => syncMarketQty({ clampValue: false }));

  on($('market-list-form'), 'submit', (e) => {
    e.preventDefault();
    try {
      const cardId = marketCard.value;
      if (!cardId || !CardMutations.resolve(cardId)) throw new Error('Choisis une carte à vendre.');
      const ownedCount = countMap().get(cardId) || 0;
      if (ownedCount < 1) throw new Error('Tu ne possèdes plus cette carte.');
      const quantity = marketQty ? marketQuantity(marketQty, ownedCount) : 1;
      const price = marketNumber(marketPrice, 0);
      const remaining = ownedCount - quantity;
      const msg = quantity === 1
        ? `Réserver 1 exemplaire de « ${cardName(cardId)} » pour ${fmt(price)} 🪙 ? (Il t’en restera ${remaining}.)`
        : `Réserver ${quantity} exemplaires de « ${cardName(cardId)} » à ${fmt(price)} 🪙 pièce ? (Il t’en restera ${remaining}.)`;
      askConfirm({
        title: 'Mettre en vente ?',
        message: msg,
        confirmLabel: 'Mettre en vente',
        onConfirm: () => marketTransaction('list', null, { cardId, price, quantity })
      });
    } catch (error) { marketInfo(error.message); }
  });
  on($('gift-form'), 'submit', (e) => {
    e.preventDefault();
    try {
      const amount = marketNumber(giftAmount, 1);
      const toUid = selectedFriendUid;
      if (!friends.includes(toUid)) throw new Error('Choisis un ami.');
      askConfirm({ title: 'Donner des pièces ?', message: `Envoyer ${fmt(amount)} 🪙 à ${(friendProfiles.get(toUid) || {}).pseudo || 'ton ami'} ?`, confirmLabel: 'Donner', onConfirm: () => marketTransaction('gift', null, { toUid, amount }) });
    } catch (error) { marketInfo(error.message); }
  });
  on($('market-refresh'), 'click', () => {
    loadMarket();
    loadGlobalMarket();
    if (selectedFriendUid) loadFriendListings(selectedFriendUid);
  });
  on(globalMarketRefresh, 'click', () => loadGlobalMarket());
  on(globalMarketSearch, 'input', () => renderGlobalMarket());
  on(globalMarketSort, 'change', () => renderGlobalMarket());

  on(packMarketType, 'change', () => syncPackMarketQty({ reset: true }));
  on(packMarketQtyMinus, 'click', () => {
    if (!packMarketQty || !packMarketType) return;
    const type = isPackType(packMarketType.value) ? packMarketType.value : 'classic';
    const ownedCount = Math.max(0, Number(state.packStock[type]) || 0);
    const maxSell = Math.min(ownedCount, MAX_MARKET_QTY);
    if (maxSell < 1) return;
    const cur = /^\d+$/.test(packMarketQty.value.trim()) ? Number(packMarketQty.value.trim()) : 1;
    packMarketQty.value = String(clamp(cur - 1, 1, maxSell));
    syncPackMarketQty({ clampValue: true });
    SFX.tick();
  });
  on(packMarketQtyPlus, 'click', () => {
    if (!packMarketQty || !packMarketType) return;
    const type = isPackType(packMarketType.value) ? packMarketType.value : 'classic';
    const ownedCount = Math.max(0, Number(state.packStock[type]) || 0);
    const maxSell = Math.min(ownedCount, MAX_MARKET_QTY);
    if (maxSell < 1) return;
    const cur = /^\d+$/.test(packMarketQty.value.trim()) ? Number(packMarketQty.value.trim()) : 1;
    packMarketQty.value = String(clamp(cur + 1, 1, maxSell));
    syncPackMarketQty({ clampValue: true });
    SFX.tick();
  });
  on(packMarketQty, 'input', () => syncPackMarketQty({ clampValue: false }));

  on($('pack-market-form'), 'submit', (e) => {
    e.preventDefault();
    try {
      const type = packMarketType && isPackType(packMarketType.value) ? packMarketType.value : 'classic';
      const ownedCount = Math.max(0, Number(state.packStock[type]) || 0);
      if (ownedCount < 1) throw new Error(`Tu ne possèdes aucun ${packName(type)}.`);
      const quantity = packMarketQty ? marketPackQuantity(packMarketQty, ownedCount) : 1;
      const price = marketNumber(packMarketPrice, 0);
      const remaining = ownedCount - quantity;
      const msg = quantity === 1
        ? `Réserver 1 « ${packName(type)} » pour ${fmt(price)} 🪙 ? (Il t’en restera ${remaining}.)`
        : `Réserver ${quantity} « ${packName(type)} » à ${fmt(price)} 🪙 pièce ? (Il t’en restera ${remaining}.)`;
      askConfirm({
        title: 'Mettre des packs en vente ?',
        message: msg,
        confirmLabel: 'Mettre en vente',
        onConfirm: () => marketTransaction('list', null, { packType: type, price, quantity })
      });
    } catch (error) { marketInfo(error.message); }
  });


  /* Échanges à la demande désactivés : 
     le marché (cartes et packs en vente) est le seul moyen
     d'obtenir les cartes d'un ami. Voir « Mon marché ». */

  /* Inspection : la carte suit le doigt / la souris (tilt + reflet holographique). */
  let inspRaf = 0;
  let inspEv = null;
  function resetInspTilt() {
    const s = inspectCard.style;
    s.setProperty('--rx', '0deg');
    s.setProperty('--ry', '0deg');
    ['--mx', '--my', '--sx', '--sy'].forEach((p) => s.setProperty(p, '50%'));
  }
  on(inspectCard, 'pointermove', (e) => {
    if (reduceMotion.matches) return;
    inspEv = e;
    if (inspRaf) return;
    inspRaf = requestAnimationFrame(() => {
      inspRaf = 0;
      const r = inspectCard.parentElement.getBoundingClientRect(); // parent fixe : pas de jitter
      const x = clamp((inspEv.clientX - r.left) / r.width, 0, 1);
      const y = clamp((inspEv.clientY - r.top) / r.height, 0, 1);
      const s = inspectCard.style;
      s.setProperty('--rx', `${((0.5 - y) * 18).toFixed(1)}deg`);
      s.setProperty('--ry', `${((x - 0.5) * 20).toFixed(1)}deg`);
      s.setProperty('--mx', `${(x * 100).toFixed(0)}%`);
      s.setProperty('--my', `${(y * 100).toFixed(0)}%`);
      s.setProperty('--sx', `${(x * 100).toFixed(0)}%`);
      s.setProperty('--sy', `${(y * 100).toFixed(0)}%`);
      s.setProperty('--ma', `${(100 + x * 160).toFixed(0)}deg`);
    });
  });
  on(inspectCard, 'pointerleave', resetInspTilt);
  on(inspectCard, 'pointercancel', resetInspTilt);

  /* ================================================== QUÊTES · SUCCÈS · NIVEAU
     Les 5 premières quêtes non réclamées se jouent en parallèle, dans
     l'ordre choisi par le joueur. Chaque réclamation libère une place pour
     la suivante. Les succès sont libres et rétroactifs. Les récompenses de
     quêtes rapportent pièces + XP ; les succès rapportent de l'XP.

     Les quêtes comme les succès mesurent des valeurs À VIE : les compteurs
     ne repartent jamais de zéro, donc ce qu'un joueur a fait avant l'arrivée
     des quêtes (ouvrir des boosters, collectionner, ajouter des amis…)
     valide immédiatement les objectifs correspondants. */

  /* Niveau courant, dérivé de l'XP cumulée. */
  function levelInfo() {
    return Quests.levelFromXp(questState.xp);
  }

  /* Toutes les métriques mesurables, calculées depuis l'état du jeu. */
  function questCtx() {
    const owned = CardMutations.owned(collectionIds());
    const uniqueIds = new Set();
    let rarePlus = 0;
    let epicPlus = 0;
    let legendaryPlus = 0;
    let shiny = 0;
    for (const card of owned) {
      uniqueIds.add(card.baseId || card.id);
      const info = RARITIES[card.rarity];
      if (!info) continue;
      if (info.rank >= RARITIES.rare.rank) rarePlus++;
      if (info.rank >= RARITIES.epic.rank) epicPlus++;
      if (info.rank >= RARITIES.legendary.rank) legendaryPlus++;
      if (card.mutation) shiny++;
    }
    return {
      packsOpened: Math.max(0, Number(state.packsOpened) || 0),
      packsBought: Math.max(0, Number(state.packsBought) || 0),
      freePacks: Math.max(0, Number(state.freePacks) || 0),
      fusions: Math.max(0, Number(state.fusions) || 0),
      marketSales: Math.max(0, Number(state.marketSales) || 0),
      marketEarned: Math.max(0, Number(state.marketEarned) || 0),
      marketBuys: Math.max(0, Number(state.marketBuys) || 0),
      friends: friends.length,
      unique: uniqueIds.size,
      total: owned.length,
      rarePlus,
      epicPlus,
      legendaryPlus,
      shiny,
      questsDone: questState.completed.length,
      level: levelInfo().level,
      coins: Math.max(0, Number(state.coins) || 0)
    };
  }

  /* Les cinq premières quêtes non réclamées, quel que soit l'ordre joué. */
  function activeQuests() {
    return Quests.activeQuests(questState.completed);
  }

  function checkQuests({ silent = false } = {}) {
    const ctx = questCtx();
    for (const quest of activeQuests()) {
      if (Quests.questProgress(quest, ctx).done && !questReadyNotifiedIds.has(quest.id)) {
        questReadyNotifiedIds.add(quest.id);
        pushNotification('quest', 'Quête accomplie',
          `« ${quest.title} » est prête : réclame ta récompense dans l’onglet Quêtes.`);
        if (!silent) showToast(`Quête accomplie : ${quest.title} !`, 4000);
      }
    }
    updateQuestBadges();
  }

  /* Débloquage des succès. `silent` évite le toast au chargement (les
     succès repris rétroactivement ne doivent pas affoler le joueur). Les
     succès de niveau débloqués par l'XP gagnée sont rattrapés par l'appel
     récursif (borné). */
  function checkAchievements({ silent = false } = {}, depth = 0) {
    if (!Quests.ACHIEVEMENTS.length || depth > 5) return;
    const ctx = questCtx();
    const fresh = [];
    let xp = 0;
    for (const achievement of Quests.ACHIEVEMENTS) {
      if (questState.achievements.indexOf(achievement.id) >= 0) continue;
      const progress = Quests.achievementProgress(achievement, ctx);
      if (!progress.done) continue;
      questState.achievements.push(achievement.id);
      fresh.push(achievement);
      xp += Math.max(0, Math.floor(Number(achievement.xp) || 0));
    }
    if (!fresh.length) return;
    fresh.forEach((achievement) => {
      pushNotification('achievement', 'Succès débloqué',
        `${achievement.icon || '🏆'} ${achievement.title} — +${fmt(achievement.xp)} XP.`);
    });
    if (!silent) {
      showToast(fresh.length === 1
        ? `Succès débloqué : ${fresh[0].title} !`
        : `${fresh.length} succès débloqués !`, 4200);
    }
    if (xp) gainXp(xp, { silent: true });
    checkAchievements({ silent: true }, depth + 1);
  }

  /* L'XP fait monter le niveau. Le niveau est sa propre récompense (prestige,
     succès associés) : il ne crédite pas de pièces, pour ne pas brouiller
     l'économie du marché ni les soldes affichés. */
  function gainXp(amount, { silent = false } = {}) {
    const xp = Math.max(0, Math.floor(Number(amount) || 0));
    if (!xp) return;
    const before = levelInfo().level;
    questState.xp += xp;
    const after = levelInfo().level;
    if (after > before) {
      pushNotification('level', `Niveau ${after} atteint !`,
        'Les quêtes et les succès continuent à rapporter de l’XP.');
      if (!silent) showToast(`Niveau ${after} atteint !`, 4200);
    }
    updateQuestBadges();
  }

  /* Appelé après chaque action qui peut faire progresser quêtes et succès. */
  function trackProgress({ silent = false } = {}) {
    if (!questsView) return;
    checkQuests({ silent });
    checkAchievements({ silent });
    if (app && app.dataset.tab === 'quests') renderQuests();
  }

  /* Ajoute à l'inventaire les boosters offerts par une quête
     (`{ rare: 1, video: 2 }`). Renvoie le nombre de packs ajoutés : 0 quand la
     quête ne donne que des pièces / de l'XP. Si le pack courant n'est plus en
     stock, on bascule sur le premier type disponible pour que l'onglet Pack
     reste jouable. */
  function grantQuestPacks(packs) {
    if (!packs || typeof packs !== 'object') return 0;
    let added = 0;
    for (const type of PACK_TYPES) {
      const qty = Math.max(0, Math.floor(Number(packs[type]) || 0));
      if (!qty) continue;
      state.packStock[type] = Math.max(0, Number(state.packStock[type]) || 0) + qty;
      added += qty;
    }
    if (added && (state.packStock[state.currentPackType] || 0) <= 0) {
      const first = PACK_TYPES.find((type) => (Number(state.packStock[type]) || 0) > 0);
      if (first) selectPackType(first, { silent: true });
    }
    return added;
  }

  /* Réclamation libre parmi les cinq actives : la suivante prend sa place. */
  function claimActiveQuest(id) {
    const quest = activeQuests().find((q) => q.id === id);
    if (!quest) return;
    const progress = Quests.questProgress(quest, questCtx());
    if (!progress.done) {
      showToast('Objectif pas encore atteint : termine d’abord cette quête.');
      return;
    }
    if (questState.completed.indexOf(quest.id) >= 0) return;
    questState.completed.push(quest.id);
    questReadyNotifiedIds.delete(quest.id);
    /* Récompense normalisée : pièces, XP et/ou boosters (certaines quêtes ne
       donnent AUCUNE pièce, seulement de l'XP et des packs). */
    const questReward = Quests.questReward(quest);
    const coins = questReward.coins;
    const xp = questReward.xp;
    const packs = questReward.packs;
    const packText = Quests.packRewardLabel(packs);
    const parts = [];
    if (coins) parts.push(`+${fmt(coins)} 🪙`);
    if (xp) parts.push(`+${fmt(xp)} XP`);
    if (packText) parts.push(`+${packText}`);
    const rewardSummary = parts.join(' et ') || 'récompense récupérée';
    if (coins) addCoins(coins);
    if (grantQuestPacks(packs) && (app.dataset.tab === 'pack' || app.dataset.tab === 'shop')) {
      renderShop();
      renderPackInventory();
    }
    pushNotification('quest', 'Quête terminée',
      `« ${quest.title} » : ${rewardSummary}.`);
    if (xp) gainXp(xp);
    if (SFX && typeof SFX.chaChing === 'function') SFX.chaChing();
    showToast(`Quête terminée : ${quest.title} ! ${rewardSummary}`, 3800);
    save();
    checkAchievements();
    checkQuests();
    renderQuests();
    updateQuestBadges();
  }

  /* « Récupérer tout » : réclame d'un coup toutes les quêtes actives prêtes,
     en réutilisant claimActiveQuest (une récompense complète par quête). */
  function claimAllActiveQuests() {
    const ctx = questCtx();
    const ready = activeQuests().filter((quest) => Quests.questProgress(quest, ctx).done);
    if (!ready.length) {
      showToast('Aucune quête prête à être réclamée pour l’instant.');
      return;
    }
    ready.forEach((quest) => claimActiveQuest(quest.id));
  }

  /* ----------------------------------------------------------- notifications
     Historique persisté (50 max, plus récent en tête). Le badge de la cloche
     compte les non lues ; le badge de l'onglet Quêtes signale une récompense
     à réclamer. */

  function pushNotification(type, title, message, extra) {
    questState.notifications.unshift({
      id: `n-${Date.now()}-${++notifSeq}`,
      type: NOTIF_ICONS[type] ? type : 'system',
      title: String(title || ''),
      message: String(message || ''),
      at: Date.now(),
      read: false
    });
    questState.notifications = questState.notifications.slice(0, QUEST_NOTIFICATIONS_MAX);
    updateNotifBadge();
    save();
    /* Même évènement, mais HORS JEU : notification du téléphone si le joueur
       l'a demandée pour cette catégorie et si le jeu n'est pas sous ses yeux.
       `extra` permet d'imposer une catégorie (le cadeau du jour n'est pas une
       promo) ou un regroupement. */
    notifyOutOfGame(type, title, message, extra);
  }

  /* ------------------------------------------------- notifications hors jeu
     Vraies notifications du système (bandeau Android, bannière iOS 16.4+,
     notification Windows/macOS), affichées par le service worker `sw.js`.
     Le joueur choisit lui-même CE QU'IL VEUT recevoir : panneau « Notifications
     du téléphone » (Compte → « Choisir mes notifications »), ligne « Choisir »
     en haut de la cloche, ou la question posée une fois à sa première visite.
     Voir push.js. */

  /* Type de notification interne → catégorie choisie par l'utilisateur. */
  const PUSH_KIND_OF_TYPE = {
    quest: 'quests',
    achievement: 'achievements',
    level: 'levels',
    friend: 'friends',
    market: 'market',
    system: 'news'
  };
  /* Textes affichés par la notification système : le titre y gagne un emoji
     (le bandeau n'a pas d'icône de catégorie) et le corps reste court. */
  const PUSH_KIND_EMOJI = {
    quests: '🗺️', achievements: '🏆', levels: '⭐', friends: '👥',
    market: '🪙', games: '🎲', gift: '🎁', news: '📣'
  };

  function pushUid() {
    return (currentUser && currentUser.uid) || '';
  }

  function notifyOutOfGame(type, title, message, extra) {
    if (!Push) return;
    const kind = (extra && extra.kind) || PUSH_KIND_OF_TYPE[type] || 'news';
    try {
      Push.notify({
        uid: pushUid(),
        kind,
        title: `${PUSH_KIND_EMOJI[kind] || '✦'} ${title || 'Refs Cards'}`,
        body: message,
        tag: (extra && extra.tag) || undefined,
        url: (extra && extra.url) || './',
        force: Boolean(extra && extra.force)
      }).catch(() => { /* jamais bloquant pour le jeu */ });
    } catch (error) { /* notifications indisponibles : le jeu continue */ }
  }

  /* Notification « libre » (pas d'entrée dans la cloche) : sert aux
     évènements multi-joueurs instantanés (défi reçu, pièces envoyées…). */
  function notifyKind(kind, title, message, extra) {
    notifyOutOfGame(kind, title, message, Object.assign({ kind }, extra || {}));
  }

  function pushSystemNotice() {
    if (!Push) return '';
    const info = Push.support();
    if (!info.api) return 'Ce navigateur ne sait pas afficher de notifications du système. La cloche du jeu reste disponible.';
    if (!info.secure) return 'Les notifications du téléphone demandent une adresse sécurisée (https). Ici, la cloche du jeu reste disponible.';
    if (info.needsInstall) return 'Sur iPhone / iPad, ajoute d’abord Refs Cards à l’écran d’accueil (Partager → « Sur l’écran d’accueil ») : iOS n’autorise les notifications que pour une application installée.';
    if (info.permission === 'denied') return 'Les notifications sont bloquées pour ce site. Réautorise-les dans les réglages du navigateur (icône à gauche de l’adresse), puis reviens ici.';
    if (!info.serviceWorker) return 'Ton navigateur affichera les notifications tant que le jeu reste ouvert dans un onglet.';
    return '';
  }

  function pushPrefs() {
    if (!Push) return { enabled: false, asked: false, kinds: {} };
    return Push.prefs(pushUid());
  }

  /* Résumé en une phrase de ce que le joueur va recevoir. */
  function pushSummaryText(prefs) {
    if (!Push) return 'Notifications du téléphone indisponibles dans cette version.';
    const state = prefs || pushPrefs();
    if (!state.enabled) return 'Désactivées. Choisis ci-dessous les notifications que tu veux recevoir sur ton téléphone.';
    const on = Push.KINDS.filter((kind) => state.kinds[kind.id] !== false);
    if (!on.length) return 'Activées, mais aucune catégorie n’est cochée : rien ne sera envoyé.';
    return `Activées : ${on.map((kind) => kind.label).join(' · ')}.`;
  }

  /* Construit la liste des interrupteurs (panneau « hors jeu »). */
  function renderPushKinds() {
    if (!pushKinds || !Push) return;
    const state = pushPrefs();
    pushKinds.replaceChildren(...Push.KINDS.map((kind) => {
      const row = el('label', 'push-kind');
      const input = el('input');
      input.type = 'checkbox';
      input.className = 'push-kind-input';
      input.dataset.pushKind = kind.id;
      input.checked = state.kinds[kind.id] !== false;
      const box = el('span', 'push-kind-box');
      box.setAttribute('aria-hidden', 'true');
      const text = el('span', 'push-kind-text');
      text.append(
        el('strong', 'push-kind-title', `${kind.icon} ${kind.label}`),
        el('span', 'push-kind-desc', kind.desc)
      );
      row.append(input, box, text);
      return row;
    }));
  }

  /* Met à jour l'état affiché (panneau + accès depuis la cloche + Compte). */
  function renderPush() {
    const info = Push ? Push.support() : null;
    const state = pushPrefs();
    const active = Boolean(info && info.permission === 'granted' && state.enabled);
    if (pushSheet) {
      renderPushKinds();
      if (pushMsg) pushMsg.textContent = pushSummaryText(state);
      if (pushSystemMsg) pushSystemMsg.textContent = pushSystemNotice();
      const granted = Boolean(info && info.permission === 'granted');
      if (pushEnable) {
        /* La permission du navigateur est acquise mais la préférence est
           coupée : le bouton sert à tout réactiver sans redemander. */
        pushEnable.hidden = active;
        pushEnable.disabled = Boolean(info && (info.needsInstall || !info.api || !info.secure));
        pushEnable.textContent = info && info.permission === 'denied'
          ? 'Notifications bloquées'
          : granted ? 'Réactiver les notifications' : 'Activer les notifications';
      }
      if (pushDisable) pushDisable.hidden = !active;
      if (pushTest) {
        pushTest.disabled = !granted;
        pushTest.hidden = !active;
      }
      if (pushHint) {
        pushHint.textContent = active
          ? 'Elles s’affichent quand le jeu n’est pas au premier plan. Le bouton « Tester » en envoie une tout de suite, même jeu ouvert.'
          : 'Aucune demande n’est faite sans ton accord : la permission du navigateur n’est demandée qu’en cliquant sur « Activer les notifications ».';
      }
      if (pushKinds) pushKinds.dataset.inactive = active ? '0' : '1';
    }
    if (pushSummary) pushSummary.textContent = pushSummaryText(state);
    if (notifPhoneRow && notifPhoneState) {
      notifPhoneRow.hidden = !Push;
      notifPhoneState.textContent = !Push
        ? ''
        : active
          ? 'Activées'
          : state.enabled
            ? 'À réautoriser'
            : 'Désactivées';
      notifPhoneRow.dataset.state = active ? 'on' : state.enabled ? 'warn' : 'off';
    }
  }

  function setPushMsg(message) {
    if (pushMsg) pushMsg.textContent = message || pushSummaryText();
    if (message) showToast(message, 3600);
  }

  /* Active tout : permission du navigateur puis préférence « activées ». */
  async function enablePush({ force = false } = {}) {
    if (!Push) return false;
    const info = Push.support();
    if (info.needsInstall) {
      Push.markAsked(pushUid());
      setPushMsg('Ajoute Refs Cards à l’écran d’accueil (Partager → « Sur l’écran d’accueil »), rouvre le jeu depuis cette icône, puis reviens activer les notifications.');
      return false;
    }
    if (!info.api || !info.secure) {
      setPushMsg(pushSystemNotice());
      return false;
    }
    let permission = info.permission;
    if (permission !== 'granted') permission = await Push.askPermission();
    Push.markAsked(pushUid());
    if (permission !== 'granted') {
      setPushMsg(permission === 'denied'
        ? 'Le navigateur a refusé les notifications. Réautorise-les dans ses réglages pour ce site, puis réessaie.'
        : 'Autorisation non accordée : tu peux réessayer quand tu veux.');
      renderPush();
      return false;
    }
    Push.setEnabled(pushUid(), true);
    /* Un service worker est nécessaire pour les notifications Android : on
       l'enregistre tout de suite (sans bloquer si l'activation traîne). */
    Push.ready().catch(() => {});
    renderPush();
    {
      /* Message de bienvenue immédiat : il confirme au joueur que ça marche,
         même jeu ouvert (seul le bouton « Tester » force ainsi l'affichage). */
      const sent = await Push.notify({
        uid: pushUid(),
        kind: 'news',
        title: '🔔 Notifications activées',
        body: 'Refs Cards te préviendra hors du jeu : quêtes prêtes, amis, ventes. Tu peux régler chaque catégorie ici.',
        tag: 'welcome',
        force: true
      });
      setPushMsg(sent
        ? 'Notifications activées. Une notification de bienvenue vient de partir.'
        : 'Notifications activées, mais le navigateur n’a pas pu les afficher. Vérifie les réglages du système (mode silencieux / notifications du navigateur).');
    }
    return true;
  }

  function disablePush() {
    if (!Push) return;
    Push.setEnabled(pushUid(), false);
    Push.markAsked(pushUid());
    renderPush();
    setPushMsg('Notifications du téléphone désactivées. La cloche du jeu continue de tout enregistrer.');
  }

  async function testPush() {
    if (!Push) return;
    const prefs = pushPrefs();
    if (!prefs.enabled) {
      setPushMsg('Active d’abord les notifications du téléphone avec le bouton ci-dessus.');
      return;
    }
    const sent = await Push.notify({
      uid: pushUid(),
      kind: 'news',
      title: '🔔 Ceci est un test',
      body: 'Si tu vois ce message hors du jeu, tout fonctionne. Désactive les catégories inutiles dans « Notifications ».',
      tag: 'test',
      force: true
    });
    setPushMsg(sent
      ? 'Test envoyé ! Il apparaît même si le jeu est ouvert — c’est le bouton de test qui force l’envoi.'
      : 'Impossible d’afficher la notification : vérifie l’autorisation du navigateur et, sur iPhone, que le jeu est bien installé sur l’écran d’accueil.');
  }

  function openPushSheet() {
    if (!pushSheet) return;
    renderPush();
    openSheet(pushSheet);
    const first = pushEnable && !pushEnable.hidden ? pushEnable : (pushKinds && pushKinds.querySelector('input'));
    if (first && typeof first.focus === 'function') {
      window.setTimeout(() => { if (!pushSheet.hidden) first.focus({ preventScroll: true }); }, 80);
    }
  }

  function closePushSheet() {
    closeSheet(pushSheet);
    renderPush();
  }

  /* Question posée UNE fois, à la première visite (après une petite attente,
     pour ne pas surgir par-dessus la connexion ou une annonce). Elle demande
     simplement quelles notifications le joueur veut : refuser ou fermer ne
     redemande rien avant 7 jours — et jamais pendant une ouverture de pack. */
  function readFlag(key) {
    try { return window.localStorage.getItem(key) || ''; } catch (error) { return ''; }
  }

  function writeFlag(key, value) {
    try { window.localStorage.setItem(key, value); } catch (error) { /* stockage bloqué */ }
  }

  function maybeAskPush() {
    if (!Push || !pushSheet) return;
    const info = Push.support();
    if (!info.api || !info.secure || info.needsInstall || info.permission === 'denied') return;
    const prefs = pushPrefs();
    if (prefs.asked || prefs.enabled) return;
    const last = Number(readFlag(PUSH_LAST_PROMPT_KEY)) || 0;
    if (last && Date.now() - last < PUSH_ASK_COOLDOWN) return;
    /* Ne jamais interrompre le joueur : ni pendant une ouverture/révélation
       (`state` = état du jeu), ni par-dessus une autre fenêtre (catalogue,
       promo, panneau, défi). */
    if (state.phase !== 'pack' || app.dataset.tab !== 'pack') return;
    if (document.querySelector('.sheet:not([hidden])') || otherSheetOpen()) return;
    Push.markAsked(pushUid());
    writeFlag(PUSH_LAST_PROMPT_KEY, String(Date.now()));
    openPushSheet();
  }

  /* Déclencheurs automatiques des notifications hors jeu, en plus de celles
     émises par pushNotification() (quête prête, succès, niveau, ami, vente,
     cadeau du jour) : les évènements multi-joueurs instantanés. */
  /* Étapes déjà connues, pour n'annoncer QUE ce qui vient d'arriver pendant la
     session (comme les ventes et les cadeaux). Remplis par les écoutes temps
     réel Firestore, déclenchés dans ingestFlipDocs / loadMarket. */
  let flipPushKnown = null;       // `${id}:${status}` des défis déjà vus
  let offersPushKnown = null;     // `${id}:${status}:${turn}` des offres déjà vues
  let hadOffersSnapshot = false;  // premier chargement des offres : pas de rafale

  function announceFlipOutOfGame(list, firstSnapshot) {
    if (!Push || !currentUser) return;
    const me = currentUser.uid;
    const known = flipPushKnown || new Set();
    const fresh = (list || []).filter((game) => !known.has(`${game.id}:${game.status}`));
    flipPushKnown = new Set((list || []).map((game) => `${game.id}:${game.status}`));
    if (firstSnapshot) return; // premier chargement : pas de rafale
    fresh.forEach((game) => {
      const pot = flipPot(game);
      if (game.status === 'pending' && game.toUid === me) {
        notifyKind('games', 'Défi pile ou face reçu', `${flipPseudo(game.fromUid)} parie ${fmt(game.amount || 0)} 🪙 : à toi de relever le défi.`, { tag: game.id });
      } else if (game.status === 'finished' && game.toUid === me && game.winnerUid) {
        notifyKind('games', game.winnerUid === me ? 'Défi gagné !' : 'Défi perdu',
          game.winnerUid === me
            ? `${fmt(pot)} 🪙 à récupérer : ton côté est tombé.`
            : `${flipPseudo(game.winnerUid)} remporte ${fmt(pot)} 🪙.`, { tag: game.id });
      } else if (game.status === 'declined' && game.fromUid === me) {
        notifyKind('games', 'Défi refusé', `${flipPseudo(game.toUid)} a refusé ton défi : ta mise de ${fmt(game.amount || 0)} 🪙 est à récupérer.`, { tag: game.id });
      }
    });
  }

  function announceOffersOutOfGame(list, { seller = true, firstSnapshot = false } = {}) {
    if (!Push || !currentUser) return;
    const me = currentUser.uid;
    const known = offersPushKnown || new Set();
    const fresh = (list || []).filter((offer) => !known.has(`${offer.id}:${offer.status}:${offer.turn}`));
    offersPushKnown = new Set((list || []).map((offer) => `${offer.id}:${offer.status}:${offer.turn}`));
    if (firstSnapshot) return;
    fresh.forEach((offer) => {
      const mine = seller ? offer.sellerUid === me : offer.buyerUid === me;
      if (!mine || offer.status !== 'pending' || offer.turn !== (seller ? 'seller' : 'buyer')) return;
      const pseudo = (friendProfiles.get(seller ? offer.buyerUid : offer.sellerUid) || {}).pseudo || 'Un joueur';
      notifyKind('market', seller ? 'Offre reçue' : 'Réponse à ton offre',
        `${pseudo} · ${cardName(offer.cardId)} · ${fmt(offer.price)} 🪙 : à toi de répondre dans « Récupérer ».`,
        { tag: offer.id });
    });
  }

  function unreadNotificationCount() {
    return questState.notifications.reduce((sum, n) => sum + (n.read ? 0 : 1), 0);
  }

  function updateNotifBadge() {
    if (!notifBadge) return;
    const count = unreadNotificationCount();
    notifBadge.hidden = count <= 0;
    notifBadge.textContent = count > 99 ? '99+' : String(count);
  }

  /* Badge de l'onglet Quêtes : allumé dès qu’une quête active est accomplie
     et attend sa récompense. On recalcule la condition (et on ne se fie pas
     au seul drapeau de notification) pour que la pastille reste juste même
     quand une quête déjà valide se débloque juste après une réclamation. */
  function updateQuestBadges() {
    if (tabBadgeQuests) {
      const ctx = questCtx();
      const ready = activeQuests().some((quest) => Quests.questProgress(quest, ctx).done);
      tabBadgeQuests.hidden = !ready;
    }
    updateNotifBadge();
  }

  function timeAgo(timestamp) {
    const diff = Math.max(0, Date.now() - Number(timestamp || 0));
    const minutes = Math.floor(diff / 60000);
    if (minutes < 1) return 'à l’instant';
    if (minutes < 60) return `il y a ${minutes} min`;
    const hours = Math.floor(minutes / 60);
    if (hours < 24) return `il y a ${hours} h`;
    return `il y a ${Math.floor(hours / 24)} j`;
  }

  function renderNotifications() {
    if (!notifList) return;
    if (!questState.notifications.length) {
      notifList.replaceChildren(el('p', 'notif-empty',
        'Aucune notification pour le moment. Tes quêtes, tes succès et tes récompenses apparaîtront ici.'));
      return;
    }
    const frag = document.createDocumentFragment();
    questState.notifications.forEach((notification) => {
      const row = el('div', 'notif-row' + (notification.read ? '' : ' is-unread'));
      row.append(el('span', 'notif-icon', NOTIF_ICONS[notification.type] || '✦'));
      const body = el('div', 'notif-body');
      body.append(
        el('p', 'notif-title', notification.title),
        el('p', 'notif-msg', notification.message),
        el('p', 'notif-time', timeAgo(notification.at))
      );
      row.append(body);
      if (!notification.read) row.append(el('span', 'notif-unread-dot'));
      frag.append(row);
    });
    notifList.replaceChildren(frag);
  }

  function markAllNotificationsRead() {
    questState.notifications.forEach((notification) => { notification.read = true; });
    updateNotifBadge();
    renderNotifications();
    save();
  }

  function openNotifSheet() {
    renderNotifications();
    openSheet(notifSheet);
    if (notifBtn) notifBtn.setAttribute('aria-expanded', 'true');
  }

  function closeNotifSheet() {
    closeSheet(notifSheet);
    if (notifBtn) notifBtn.setAttribute('aria-expanded', 'false');
  }

  /* ------------------------------------------------------------- rendu quêtes */

  function renderQuests() {
    if (!questsView) return;
    const info = levelInfo();
    if (levelValue) levelValue.textContent = String(info.level);
    if (levelXp) levelXp.textContent = `${fmt(info.into)} / ${fmt(info.needed)} XP`;
    if (levelFill) {
      levelFill.style.transform = `scaleX(${info.needed ? clamp(info.into / info.needed, 0, 1) : 0})`;
    }
    const doneCount = questState.completed.length;
    if (questsCount) {
      const ctx = questCtx();
      const ready = activeQuests().some((quest) => Quests.questProgress(quest, ctx).done);
      questsCount.textContent = !Quests.QUESTS.length
        ? 'Quêtes indisponibles'
        : doneCount >= Quests.QUESTS.length
          ? `Toutes les quêtes sont terminées (${Quests.QUESTS.length} / ${Quests.QUESTS.length})`
          : `${doneCount} / ${Quests.QUESTS.length} terminées · ${activeQuests().length} en cours${ready ? ' · récompense prête' : ''}`;
    }
    if (achCount) achCount.textContent = `${questState.achievements.length} / ${Quests.ACHIEVEMENTS.length}`;
    renderQuestPanel();
    renderAchPanel();
  }

  let questCategory = null;

  /* Petites étincelles au moment de la réclamation. */
  function questBurst(card) {
    if (reduceMotion.matches) return;
    for (let i = 0; i < 14; i++) {
      const p = el('i', 'quest-spark');
      const angle = (i / 14) * Math.PI * 2;
      p.style.setProperty('--dx', `${Math.cos(angle) * (60 + Math.random() * 50)}px`);
      p.style.setProperty('--dy', `${Math.sin(angle) * (40 + Math.random() * 40)}px`);
      card.append(p);
    }
  }

  function renderQuestPanel() {
    if (!questPanel) return;
    const ctx = questCtx();
    const active = activeQuests();
    const cats = Quests.CATEGORIES || [];
    const isReady = (q) => Quests.questProgress(q, ctx).done;
    if (!cats.length) { questPanel.replaceChildren(); return; }
    if (!questCategory || !cats.some((c) => c.id === questCategory)) {
      const withReady = cats.find((c) => active.some((q) => Quests.categoryOf(q) === c.id && isReady(q)));
      questCategory = (withReady || cats[0]).id;
    }
    const frag = document.createDocumentFragment();

    /* Barre d’action : réclame d’un coup toutes les quêtes prêtes. */
    const readyList = active.filter(isReady);
    const toolbar = el('div', 'quest-toolbar');
    const readyNote = el('span', 'quest-toolbar-note', readyList.length
      ? `${readyList.length} récompense${readyList.length > 1 ? 's' : ''} prête${readyList.length > 1 ? 's' : ''}`
      : 'Aucune récompense prête pour l’instant');
    const claimAll = el('button', 'quest-claim-all', `Récupérer tout${readyList.length ? ` (${readyList.length})` : ''}`);
    claimAll.type = 'button';
    claimAll.disabled = !readyList.length;
    claimAll.setAttribute('aria-label', readyList.length
      ? `Récupérer toutes les récompenses prêtes (${readyList.length})`
      : 'Aucune récompense prête à récupérer');
    on(claimAll, 'click', () => {
      claimAll.disabled = true;
      SFX.tick();
      claimAllActiveQuests();
    });
    toolbar.append(readyNote, claimAll);
    frag.append(toolbar);

    const tabs = el('div', 'quest-cats');
    tabs.setAttribute('role', 'tablist');
    cats.forEach((cat) => {
      const list = active.filter((q) => Quests.categoryOf(q) === cat.id);
      const ready = list.filter(isReady).length;
      const b = el('button', 'quest-cat' + (cat.id === questCategory ? ' is-active' : ''));
      b.type = 'button';
      b.setAttribute('role', 'tab');
      b.setAttribute('aria-selected', String(cat.id === questCategory));
      b.append(el('span', 'quest-cat-icon', cat.icon), el('span', 'quest-cat-label', cat.label));
      if (ready) b.append(el('i', 'quest-cat-dot', String(ready)));
      on(b, 'click', () => { questCategory = cat.id; SFX.tick(); renderQuestPanel(); });
      tabs.append(b);
    });
    frag.append(tabs);

    const current = active.filter((q) => Quests.categoryOf(q) === questCategory);
    const grid = el('div', 'quest-grid');
    current.sort((x, y) => Number(isReady(y)) - Number(isReady(x)));
    current.forEach((quest, index) => {
      const reward = Quests.questReward(quest);
      const packText = Quests.packRewardLabel(reward.packs);
      const progress = Quests.questProgress(quest, ctx);
      const chain = Quests.chainInfo(quest);
      const next = Quests.nextInChain(quest, questState.completed);
      const card = el('article', 'quest-card' + (progress.done ? ' is-ready' : ''));
      card.dataset.questId = quest.id;
      card.style.setProperty('--i', String(index));
      const head = el('div', 'quest-head');
      head.append(el('span', 'quest-icon', quest.icon || '🎯'));
      const hText = el('div', 'quest-head-text');
      hText.append(el('h3', 'quest-title', quest.title), el('p', 'quest-step', `Étape ${chain.step} sur ${chain.total}`));
      head.append(hText);
      card.append(head, el('p', 'quest-desc', quest.desc));
      const pips = el('div', 'quest-pips');
      for (let i = 1; i <= chain.total; i++) pips.append(el('i', i < chain.step ? 'is-done' : i === chain.step ? 'is-now' : ''));
      card.append(pips);
      const bar = el('div', 'quest-bar');
      const fill = el('i');
      fill.style.transform = `scaleX(${progress.target ? clamp(progress.value / progress.target, 0, 1) : 0})`;
      bar.append(fill);
      const top = el('div', 'quest-progress-top');
      top.append(el('span', '', Quests.metricLabel(quest.metric)), el('b', '', `${fmt(progress.value)} / ${fmt(progress.target)}`));
      card.append(el('div', 'quest-progress'));
      card.lastChild.append(top, bar);
      const meta = el('div', 'quest-meta');
      const rewards = el('div', 'quest-rewards');
      if (reward.coins) rewards.append(el('span', 'quest-reward', `🪙 ${fmt(reward.coins)}`));
      if (reward.xp) rewards.append(el('span', 'quest-reward quest-reward-xp', `⭐ ${fmt(reward.xp)} XP`));
      if (packText) rewards.append(el('span', 'quest-reward quest-reward-pack', `📦 ${packText}`));
      const claim = el('button', 'quest-claim', progress.done ? 'Réclamer' : 'En cours');
      claim.type = 'button';
      claim.disabled = !progress.done;
      claim.setAttribute('aria-label', progress.done ? `Réclamer la récompense de ${quest.title}` : `${quest.title} en cours`);
      on(claim, 'click', () => {
        claim.disabled = true;
        card.classList.add('is-claiming');
        questBurst(card);
        window.setTimeout(() => claimActiveQuest(quest.id), reduceMotion.matches ? 0 : 520);
      });
      meta.append(rewards, claim);
      card.append(meta);
      if (next) card.append(el('p', 'quest-next', `Ensuite : ${next.title}`));
      grid.append(card);
    });
    if (!current.length) {
      grid.append(el('div', 'quest-all-done', '✓ Catégorie terminée. Bravo, tu as tout réclamé ici !'));
    }
    frag.append(grid);

    const done = questState.completed.slice().reverse();
    if (done.length) {
      const details = document.createElement('details');
      details.className = 'quest-done';
      details.append(el('summary', 'quest-done-title', `Quêtes terminées · ${done.length}`));
      const list = el('div', 'quest-done-list');
      done.forEach((id) => {
        const definition = Quests.QUESTS.find((q) => q.id === id);
        if (!definition) return;
        const row = el('div', 'quest-done-row');
        const r = Quests.questReward(definition);
        const parts = [];
        if (r.coins) parts.push(`+${fmt(r.coins)} 🪙`);
        if (r.xp) parts.push(`+${fmt(r.xp)} XP`);
        const p = Quests.packRewardLabel(r.packs);
        if (p) parts.push(`+${p}`);
        row.append(el('span', 'quest-icon', definition.icon || '🎯'), el('span', '', definition.title),
          el('span', 'quest-done-reward', parts.join(' · ')), el('span', 'quest-done-check', '✓'));
        list.append(row);
      });
      details.append(list);
      frag.append(details);
    }
    questPanel.replaceChildren(frag);
  }

  function renderAchPanel() {
    if (!achPanel) return;
    const ctx = questCtx();
    const frag = document.createDocumentFragment();
    frag.append(el('p', 'ach-summary',
      `${questState.achievements.length} succès débloqué${questState.achievements.length > 1 ? 's' : ''} sur ${Quests.ACHIEVEMENTS.length} · chaque succès rapporte de l’XP.`));
    const grid = el('div', 'ach-grid');
    Quests.ACHIEVEMENTS.forEach((achievement) => {
      const unlocked = questState.achievements.indexOf(achievement.id) >= 0;
      const progress = Quests.achievementProgress(achievement, ctx);
      const tile = el('article', 'ach-tile ' + (unlocked ? 'is-unlocked' : 'is-locked'));
      tile.append(el('span', 'ach-state', unlocked ? '✓' : '🔒'));
      tile.append(el('div', 'ach-icon', achievement.icon || '🏆'));
      tile.append(el('h3', 'ach-title', achievement.title));
      tile.append(el('p', 'ach-desc', achievement.desc));
      const meta = el('p', 'ach-meta');
      meta.append(el('span', 'ach-xp', `+${fmt(achievement.xp)} XP`));
      if (!unlocked && progress.target > 1) {
        meta.append(document.createTextNode(` · ${fmt(progress.value)}/${fmt(progress.target)}`));
      }
      tile.append(meta);
      grid.append(tile);
    });
    frag.append(grid);
    achPanel.replaceChildren(frag);
  }

  /* Chargement initial (appelé depuis applySave) : succès repris en compte,
     quête active mesurée, badges à jour — sans toast. */
  function initQuestProgress({ newDay = false } = {}) {
    if (questsView) {
      checkQuests({ silent: true });
      checkAchievements({ silent: true });
      renderQuests();
      updateQuestBadges();
    }
    if (newDay) {
      pushNotification('system', 'Cadeau de connexion disponible',
        'Un nouveau jour du calendrier t’attend dans le Shop : récupère ton cadeau gratuit.',
        { kind: 'gift' });
    }
  }

  /* Écouteurs du panneau de notifications et des onglets Quêtes / Succès. */
  on(notifBtn, 'click', () => { SFX.unlock(); openNotifSheet(); });
  on(notifReadAll, 'click', markAllNotificationsRead);

  /* --------- réglages des notifications hors jeu (push.js + sw.js) --------- */
  on(notifPhoneBtn, 'click', () => { closeNotifSheet(); openPushSheet(); });
  on(notifSettingsOpen, 'click', () => openPushSheet());
  on(pushEnable, 'click', () => { enablePush().catch(() => {}); });
  on(pushDisable, 'click', disablePush);
  on(pushTest, 'click', () => { testPush().catch(() => {}); });
  on(pushKinds, 'change', (event) => {
    const input = event.target && event.target.closest ? event.target.closest('[data-push-kind]') : null;
    if (!input || !Push) return;
    Push.setKind(pushUid(), input.dataset.pushKind, input.checked);
    /* renderPush() reconstruit la liste : on relit l'absence de choix dans les
       préférences (jamais depuis le DOM, reconstruit justement). */
    renderPush();
    if (pushMsg) pushMsg.textContent = pushSummaryText();
  });
  if (pushSheet) {
    pushSheet.querySelectorAll('[data-close-push]').forEach((button) => {
      on(button, 'click', closePushSheet);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && pushSheet && !pushSheet.hidden) closePushSheet();
  });
  /* Le navigateur peut changer d'avis (autorisation accordée depuis ses
     réglages) : on rafraîchit l'affichage à chaque retour sur l'onglet, et on
     redemande la question si elle n'a jamais été posée. */
  let pushAskTimer = 0;
  function schedulePushAsk(delay = 4000) {
    window.clearTimeout(pushAskTimer);
    if (!Push) return;
    pushAskTimer = window.setTimeout(() => {
      try {
        maybeAskPush();
        /* La question a été REPOUSSÉE (le joueur est dans une annonce, une
           ouverture de pack…) : on retente plus tard au lieu de la perdre. */
        if (!pushPrefs().asked) schedulePushAsk(Math.max(delay, 20000));
      } catch (error) { /* jamais bloquant */ }
    }, delay);
  }
  on(document, 'visibilitychange', () => {
    if (document.visibilityState === 'visible' && currentUser) renderPush();
  });

  if (notifSheet) {
    notifSheet.querySelectorAll('[data-close-notif]').forEach((button) => {
      on(button, 'click', closeNotifSheet);
    });
  }
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && notifSheet && !notifSheet.hidden) closeNotifSheet();
  });
  document.querySelectorAll('[data-quest-tab]').forEach((tab) => {
    on(tab, 'click', () => {
      document.querySelectorAll('[data-quest-tab]').forEach((other) => {
        const active = other === tab;
        other.classList.toggle('is-active', active);
        other.setAttribute('aria-selected', String(active));
      });
      if (questPanel) questPanel.hidden = tab.dataset.questTab !== 'quests';
      if (achPanel) achPanel.hidden = tab.dataset.questTab !== 'achievements';
      SFX.tick();
    });
  });

  function boot() {
    // Sans ces deux éléments, la page n'est pas celle attendue (ancien HTML en
    // cache, bloc supprimé…) : on l'explique au lieu de planter en silence.
    if (!app || !googleSignIn) {
      reportStartupProblem('La page Refs Cards est incomplète : recharge-la avec Ctrl+Maj+R (ou vide le cache du navigateur).');
      return;
    }
    updateCoins();
    loadCollSort();
    renderFilters();
    renderSortControls();
    renderOdds(false);
    renderShop();
    renderPackInventory();
    FX.resize();
    Dust.resize();
    Dust.start();
    resetTear();
    recap.classList.add('is-idle');
    sizeStage();
    scheduleSizing(6);
    const demoParam = new URLSearchParams(window.location.search).get('demo');
    if (demoParam === '1') {
      sessionStorage.setItem('refs-demo', '1');
      showToast('Mode démo : un aperçu des raretés.', 2600);
    } else if (demoParam === 'fusion') {
      sessionStorage.setItem('refs-demo', 'fusion');
      showToast('Mode démo fusion : ouvre le pack, un doublon prêt à fusionner t’attend.', 3600);
    } else if (demoParam === 'video') {
      sessionStorage.setItem('refs-demo', 'video');
      selectPackType('video', { silent: true });
      showToast('Mode démo vidéo : ouvre le Pack Vidéo pour voir fps, son et boucle.', 3800);
    }
    if (!cardsDatabase.length) {
      showToast('Ajoute des cartes dans cards.js pour commencer.');
    }
  }

  /* Message visible même quand le reste du script ne peut pas s'initialiser. */
  function reportStartupProblem(message) {
    try {
      const host = document.querySelector('.auth-card') || document.body;
      if (!host) return;
      let box = document.getElementById('startup-error');
      if (!box) {
        box = el('p', 'auth-error');
        box.id = 'startup-error';
        box.setAttribute('role', 'alert');
        host.insertBefore(box, host.firstChild);
      }
      box.textContent = message;
    } catch (error) {
      console.error('[Refs Cards]', message, error);
    }
  }

  /* Les scripts de index.html sont classiques et chargés en `defer` : le DOM est
     donc prêt. Ce garde-fou couvre aussi le cas d'un script placé dans <head>
     sans defer, pour que la connexion Google soit branchée dans tous les cas. */
  function start() {
    try {
      boot();
    } catch (error) {
      console.error('[Refs Cards] démarrage du jeu impossible :', error);
      reportStartupProblem('Le jeu n’a pas pu démarrer complètement. Recharge la page avec Ctrl+Maj+R.');
    }
    try {
      initializeCloud();
    } catch (error) {
      console.error('[Refs Cards] initialisation Firebase impossible :', error);
      setAuthError(authErrorMessage(error));
      showLoginPage();
    }
    // Signale au filet de sécurité de index.html que les écouteurs sont posés.
    window.REFS_CARDS_READY = true;
  }

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
