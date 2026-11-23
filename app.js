/* ==========================================================================
   Refs Cards — logique de jeu
   Découpe au doigt/souris · pile de cartes · révélations par rareté ·
   bruitages Web Audio · butin · demande de fusion.
   ========================================================================== */
(() => {
  'use strict';

  /* Boutique : les packs s'achètent dans le Shop et vont dans l'inventaire
     (onglet Pack). Les prix sont réglés AU-DESSUS de la valeur moyenne d'un
     pack (classique ≈ 394 🪙, rare ≈ 447 🪙 pour 5 cartes) : à 100 🪙,
     chaque ouverture rapportait en moyenne ~294 🪙 et l'argent devenait
     infini. À 500 / 1 000 🪙, acheter fait perdre un peu en moyenne — il
     faut jouer, fusionner et récupérer les 3 packs gratuits quotidiens. */
  const PACK_PRICES = { classic: 500, rare: 1000 };
  const PACK_PRICE = PACK_PRICES.classic; // compat : ancien prix unique (100) abandonné
  const RARE_BOOST = 1.2; // pack rare : chances d'obtenir une rareté Rare+ multipliées par 1,2 (+20 % réels)
  const FREE_PER_DAY = 3; // packs classiques gratuits par jour, à récupérer dans le Shop
  const MAX_QTY = 10; // quantité max par achat (on peut racheter ensuite)
  const PACK_IMAGES = { classic: 'assets/packet.png', rare: 'assets/packetrare.png' };
  const CARD_COUNT = 5;
  const TEAR_THRESHOLD = 0.75;

  /* Dix raretés, du plus courant au plus rare. `weight` est la probabilité de
     tirage (en %), `fx` le niveau de mise en scène (calm | rare | epic | gold)
     et `next` la rareté obtenue par fusion. Les couleurs servent au cadre, au
     badge, au titre et aux lueurs de la carte. */
  const RARITIES = {
    common:     { label: 'Commune',      rank: 0, weight: 30,  color: '#e6ebdf', ink: '#20261b', glow: '#e6ebdf', reward: 20,  fx: 'calm', next: 'uncommon' },
    uncommon:   { label: 'Inhabituelle', rank: 1, weight: 22,  color: '#6fe0a8', ink: '#04251a', glow: '#57d39a', reward: 35,  fx: 'calm', next: 'rare' },
    rare:       { label: 'Rare',         rank: 2, weight: 16,  color: '#5fb8ff', ink: '#06243a', glow: '#4aa8ff', reward: 55,  fx: 'rare', next: 'superrare' },
    superrare:  { label: 'Super Rare',   rank: 3, weight: 11,  color: '#67e0d0', ink: '#032a26', glow: '#3fd8c8', reward: 80,  fx: 'rare', next: 'epic' },
    epic:       { label: 'Épique',       rank: 4, weight: 8,   color: '#b47bff', ink: '#24093c', glow: '#a457ff', reward: 120, fx: 'epic', next: 'ultraepic' },
    ultraepic:  { label: 'Ultra épique', rank: 5, weight: 5,   color: '#ff8ccb', ink: '#3a0524', glow: '#ff5cb8', reward: 175, fx: 'epic', next: 'mythic' },
    mythic:     { label: 'Mythique',     rank: 6, weight: 3.5, color: '#ffa469', ink: '#331204', glow: '#ff8a3d', reward: 240, fx: 'gold', next: 'legendary' },
    legendary:  { label: 'Légendaire',   rank: 7, weight: 2.5, color: '#ffd45e', ink: '#3a2600', glow: '#ffb347', reward: 340, fx: 'gold', next: 'divine' },
    divine:     { label: 'Divine',       rank: 8, weight: 1.5, color: '#a7f3ff', ink: '#032830', glow: '#7ce8ff', reward: 520, fx: 'gold', next: 'secret' },
    secret:     { label: 'Secrète',      rank: 9, weight: 0.5, color: '#e9d4ff', ink: '#231035', glow: '#c79bff', reward: 900, fx: 'gold', next: null }
  };

  const SOUND_FX = { calm: 'common', rare: 'rare', epic: 'epic', gold: 'legendary' };

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
  const buyLabel = qs(buyBtn, '.buy-label');
  const buyPrice = qs(buyBtn, '.buy-price');
  const fusionLater = $('fusion-later');
  const fusionDesc = $('fusion-desc');
  const collFusion = $('coll-fusion');
  const collFusionLabel = $('coll-fusion-label');
  const toast = $('toast');
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
  const freeClaim = $('free-claim');
  const freeLabel = $('free-label');
  const freeDots = $('free-dots');
  const freeMsg = $('free-msg');
  const shopStockClassic = $('shop-stock-classic');
  const shopStockRare = $('shop-stock-rare');
  const qtyClassic = $('qty-classic');
  const qtyRare = $('qty-rare');
  const buyClassic = $('buy-classic');
  const buyRare = $('buy-rare');
  const shopInventoryLabel = $('shop-inventory-label');
  const openClassic = $('open-classic');
  const openRare = $('open-rare');
  const shopMsg = $('shop-msg');
  const tabBadgeShop = $('tab-badge-shop');
  const inventoryView = $('inventory-view');
  const inventoryGrid = $('inventory-grid');
  const inventorySummary = $('inventory-summary');
  const inventoryEmpty = $('inventory-empty');
  const inventoryGoShop = $('inventory-go-shop');
  const tabBadgeInventory = $('tab-badge-inventory');
  const shopQty = { classic: 1, rare: 1 };

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
    /* Inventaire de packs (achetés dans le Shop + gratuits quotidiens).
       Ouvrir un pack en consomme 1. `currentPackType` = pack choisi dans
       l'onglet Pack. `freeDate`/`freeUsed` = quota quotidien (date locale
       AAAA-MM-JJ + nombre déjà récupérés, 0..FREE_PER_DAY). */
    packStock: { classic: 0, rare: 0 },
    currentPackType: 'classic',
    freeDate: '',
    freeUsed: 0,
    packsOpened: 0
  };

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
    state.coins = Math.max(0, state.coins + n);
    updateCoins(n);
    save();
  }

  let toastTimer = null;
  function showToast(message, duration = 3200) {
    toast.textContent = message;
    toast.classList.add('show');
    window.clearTimeout(toastTimer);
    toastTimer = window.setTimeout(() => toast.classList.remove('show'), duration);
  }

  /* ====================================================== SHOP · INVENTAIRE
     Les packs ne s'achètent plus en un clic depuis le récap : ils vont dans
     l'inventaire (state.packStock) et s'ouvrent depuis l'onglet Pack.
     - Achat : plusieurs d'un coup (quantité 1..MAX_QTY), prix PACK_PRICES.
     - Gratuit : FREE_PER_DAY packs classiques par jour calendaire local,
       à récupérer un par un dans le Shop (freeDate/freeUsed persistés).
     - Ouverture : consomme 1 pack du type choisi (currentPackType). */

  function todayKey() {
    const now = new Date();
    const m = String(now.getMonth() + 1).padStart(2, '0');
    const d = String(now.getDate()).padStart(2, '0');
    return `${now.getFullYear()}-${m}-${d}`;
  }

  function refreshFreeQuota() {
    const today = todayKey();
    if (state.freeDate !== today) {
      state.freeDate = today;
      state.freeUsed = 0;
    }
    state.freeUsed = clamp(Number(state.freeUsed) || 0, 0, FREE_PER_DAY);
  }

  function freeRemaining() {
    refreshFreeQuota();
    return Math.max(0, FREE_PER_DAY - state.freeUsed);
  }

  function packTotal() {
    return (state.packStock.classic || 0) + (state.packStock.rare || 0);
  }

  function isDemoMode() {
    try {
      const params = new URLSearchParams(window.location.search);
      return params.get('demo') === '1' || params.get('demo') === 'fusion'
        || sessionStorage.getItem('refs-demo') === '1'
        || sessionStorage.getItem('refs-demo') === 'fusion';
    } catch (error) { return false; }
  }

  function setShopMsg(message) {
    if (shopMsg) shopMsg.textContent = message || '';
  }

  function setFreeMsg(message) {
    if (freeMsg) freeMsg.textContent = message || '';
  }

  function renderShop() {
    refreshFreeQuota();
    const remaining = freeRemaining();
    if (freeClaim) {
      freeClaim.disabled = remaining <= 0;
      freeClaim.textContent = remaining > 0
        ? `RÉCUPÉRER · ${remaining} RESTANT${remaining > 1 ? 'S' : ''}`
        : 'GRATUITS ÉPUISÉS · REVIENS DEMAIN';
    }
    if (freeLabel) {
      freeLabel.textContent = remaining > 0
        ? `${state.freeUsed}/${FREE_PER_DAY} récupérés aujourd'hui · se réinitialise à minuit.`
        : `Tu as récupéré tes ${FREE_PER_DAY} packs du jour. Se réinitialise à minuit.`;
    }
    if (freeDots) {
      [...freeDots.children].forEach((dot, i) => dot.classList.toggle('is-taken', i < state.freeUsed));
    }
    if (tabBadgeShop) tabBadgeShop.hidden = remaining <= 0;

    const stockText = (n) => `Tu en as ${n}`;
    if (shopStockClassic) shopStockClassic.textContent = stockText(state.packStock.classic || 0);
    if (shopStockRare) shopStockRare.textContent = stockText(state.packStock.rare || 0);

    const updateBuy = (type, qtyEl, btn) => {
      const qty = clamp(shopQty[type] || 1, 1, MAX_QTY);
      if (qtyEl) qtyEl.textContent = String(qty);
      if (btn) {
        const total = PACK_PRICES[type] * qty;
        btn.textContent = `ACHETER · ${fmt(total)} 🪙`;
        btn.disabled = state.coins < total;
      }
      document.querySelectorAll(`.qty-chip[data-pack="${type}"]`).forEach((chip) => {
        chip.classList.toggle('is-active', Number(chip.dataset.qty) === qty);
      });
    };
    updateBuy('classic', qtyClassic, buyClassic);
    updateBuy('rare', qtyRare, buyRare);

    const total = packTotal();
    if (shopInventoryLabel) {
      shopInventoryLabel.textContent = total > 0
        ? `Inventaire : ${state.packStock.classic || 0} classique${(state.packStock.classic || 0) > 1 ? 's' : ''} · ${state.packStock.rare || 0} rare${(state.packStock.rare || 0) > 1 ? 's' : ''}`
        : 'Inventaire vide — achète ou récupère tes packs gratuits.';
    }
    [[openClassic, 'classic', 'CLASSIQUE'], [openRare, 'rare', 'RARE']].forEach(([button, type, label]) => {
      if (!button) return;
      const count = state.packStock[type] || 0;
      button.textContent = `OUVRIR ${label} · ×${count} →`;
      button.disabled = count <= 0 || (state.phase !== 'pack' && state.phase !== 'done');
    });
  }

  function renderPackInventory() {
    const classic = state.packStock.classic || 0;
    const rare = state.packStock.rare || 0;
    const type = state.currentPackType === 'rare' ? 'rare' : 'classic';
    const selected = type === 'rare' ? rare : classic;
    const empty = selected <= 0 && !isDemoMode() && state.phase === 'pack';
    const head = document.querySelector('.pack-head');
    if (head) head.hidden = classic + rare === 0 && !isDemoMode() && state.phase === 'pack';
    if (packStockLabel) packStockLabel.textContent = classic + rare === 0 && !isDemoMode() ? 'Aucun booster' : '';
    if (packArea) packArea.hidden = empty;
    if (packOdds) packOdds.hidden = empty;
    if (pack) {
      pack.classList.toggle('is-empty', empty);
      pack.setAttribute('aria-label', `Booster ${type === 'rare' ? 'rare' : 'classique'}. Fais glisser vers la droite pour le déchirer.`);
    }
    renderOdds(type === 'rare');
    renderInventory();
  }

  function renderInventory() {
    const classic = state.packStock.classic || 0;
    const rare = state.packStock.rare || 0;
    const total = classic + rare;
    if (tabBadgeInventory) tabBadgeInventory.hidden = total <= 0;
    if (inventorySummary) {
      inventorySummary.textContent = total > 0
        ? `Tu as ${total} pack${total > 1 ? 's' : ''} prêt${total > 1 ? 's' : ''} à être ouvert${total > 1 ? 's' : ''}.`
        : 'Aucun pack en inventaire.';
    }
    if (inventoryEmpty) inventoryEmpty.hidden = total > 0;
    if (!inventoryGrid) return;
    inventoryGrid.hidden = total === 0;
    if (total === 0) {
      inventoryGrid.innerHTML = '';
      return;
    }
    const items = [
      {
        type: 'classic',
        count: classic,
        title: 'Booster Classique',
        desc: '5 cartes aléatoires · Chances standard de rareté.',
        img: PACK_IMAGES.classic,
        rare: false,
      },
      {
        type: 'rare',
        count: rare,
        title: 'Booster Rare',
        desc: '5 cartes aléatoires · +20 % de chances sur les raretés.',
        img: PACK_IMAGES.rare,
        rare: true,
      },
    ].filter((item) => item.count > 0);
    const canOpen = state.phase === 'pack' || state.phase === 'done';
    inventoryGrid.innerHTML = items.map((item) => `
      <article class="inventory-card${item.rare ? ' inventory-card-rare' : ''}" data-pack-type="${item.type}">
        <span class="inventory-qty-badge">×${item.count}</span>
        <img class="inventory-card-img" src="${item.img}" alt="${item.title}">
        <h3 class="inventory-card-title">${item.title}</h3>
        <p class="inventory-card-desc">${item.desc}</p>
        <button class="inventory-open-btn" type="button" data-open-pack="${item.type}" ${canOpen ? '' : 'disabled'}>
          OUVRIR UN PACK →
        </button>
      </article>
    `).join('');
  }

  function selectPackType(type) {
    if (type !== 'classic' && type !== 'rare') return;
    state.currentPackType = type;
    const src = PACK_IMAGES[type];
    if (packImgMain) packImgMain.src = src;
    if (packImgFlap) packImgFlap.src = src;
    SFX.tick();
    renderPackInventory();
  }

  function claimFreePack() {
    SFX.unlock();
    const remaining = freeRemaining();
    if (remaining <= 0) {
      SFX.snap();
      setFreeMsg('Tu as déjà récupéré tes 3 packs gratuits du jour. Reviens demain !');
      return;
    }
    state.freeUsed += 1;
    state.packStock.classic = (state.packStock.classic || 0) + 1;
    SFX.chaChing();
    setFreeMsg(`Pack gratuit ajouté à ton inventaire (${freeRemaining()} restant${freeRemaining() > 1 ? 's' : ''} aujourd'hui).`);
    showToast('Pack gratuit ajouté à ton inventaire !');
    save();
    renderShop();
    renderPackInventory();
  }

  function buyPacks(type) {
    SFX.unlock();
    const qty = clamp(shopQty[type] || 1, 1, MAX_QTY);
    const total = PACK_PRICES[type] * qty;
    if (state.coins < total) {
      SFX.snap();
      setShopMsg(`Pas assez de pièces : il te manque ${fmt(total - state.coins)} 🪙 pour ${qty} pack${qty > 1 ? 's' : ''} ${type === 'rare' ? 'rare' : 'classique'}${qty > 1 ? 's' : ''}.`);
      return;
    }
    SFX.chaChing();
    addCoins(-total);
    state.packStock[type] = (state.packStock[type] || 0) + qty;
    setShopMsg(`${qty} pack${qty > 1 ? 's' : ''} ${type === 'rare' ? 'rare' : 'classique'}${qty > 1 ? 's' : ''} ajouté${qty > 1 ? 's' : ''} à ton inventaire !`);
    showToast(`${qty} pack${qty > 1 ? 's' : ''} ${type === 'rare' ? 'rare' : 'classique'}${qty > 1 ? 's' : ''} dans l'inventaire !`);
    save();
    renderShop();
    renderPackInventory();
  }

  /* --------------------------------------------------------------- tirage */

  /* Pourcentage effectif d'une rareté pour un type de pack. Pack rare : la
     chance d'obtenir chaque rareté Rare et plus (rank >= 2) est réellement
     multipliée par RARE_BOOST (1,2 = +20 % de chances, ex. Légendaire 2,5 %
     → 3 %). Le surplus est pris sur les Communes/Inhabituelles, dont les
     pourcentages sont réduits au prorata : le total reste égal à 100 %. */
  const HIGH_RANK = RARITIES.rare.rank;
  const LOW_BASE = Object.values(RARITIES).filter((r) => r.rank < HIGH_RANK).reduce((s, r) => s + r.weight, 0);
  const HIGH_BASE = Object.values(RARITIES).filter((r) => r.rank >= HIGH_RANK).reduce((s, r) => s + r.weight, 0);
  const LOW_BOOSTED_FACTOR = (LOW_BASE + HIGH_BASE - HIGH_BASE * RARE_BOOST) / LOW_BASE;

  function rarityWeight(key, boosted) {
    const info = RARITIES[key];
    if (!info) return 0;
    if (!boosted) return info.weight;
    return info.rank >= HIGH_RANK ? info.weight * RARE_BOOST : info.weight * LOW_BOOSTED_FACTOR;
  }

  function pickCard(forcedRarity, boosted) {
    const available = Object.keys(RARITIES).filter((r) => cardsDatabase.some((c) => c.rarity === r));
    if (!available.length) return null;
    let rarity = forcedRarity;
    if (!rarity || !available.includes(rarity)) {
      // Tirage pondéré : chaque rareté garde exactement son pourcentage annoncé,
      // puis la carte est tirée au hasard à l'intérieur de la rareté.
      const total = available.reduce((sum, r) => sum + rarityWeight(r, boosted), 0);
      let roll = Math.random() * total;
      rarity = available[available.length - 1];
      for (const r of available) {
        if ((roll -= rarityWeight(r, boosted)) < 0) {
          rarity = r;
          break;
        }
      }
    }
    const pool = cardsDatabase.filter((c) => c.rarity === rarity);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function drawPack(boosted) {
    const drawn = [];
    const params = new URLSearchParams(window.location.search);
    const demoMode = params.get('demo') || sessionStorage.getItem('refs-demo');
    const wantsDemo = demoMode === '1' || demoMode === 'fusion';
    if (wantsDemo) {
      sessionStorage.setItem('refs-demo', demoMode === 'fusion' ? 'fusion' : '1');
      const demoList = demoMode === 'fusion' && typeof fusionDemoDraw !== 'undefined'
        ? fusionDemoDraw
        : (typeof demoDraw !== 'undefined' ? demoDraw : []);
      demoList.slice(0, CARD_COUNT).forEach((id) => {
        const found = cardsDatabase.find((c) => c.id === id);
        if (found) drawn.push(found);
      });
    }
    while (drawn.length < CARD_COUNT) {
      const card = pickCard(null, boosted);
      if (!card) break;
      drawn.push(card);
    }
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

  function openPack() {
    /* Consomme 1 pack de l'inventaire (sauf en démo, où l'ouverture est
       gratuite pour les tests/apercus). Le tirage utilise ensuite le type
       choisi (rare = chances +20 %). */
    if (!isDemoMode()) {
      const type = state.currentPackType === 'rare' ? 'rare' : 'classic';
      if ((state.packStock[type] || 0) > 0) {
        state.packStock[type] -= 1;
        state.packsOpened = (state.packsOpened || 0) + 1;
        save();
        renderPackInventory();
      }
    }
    SFX.tearStop();
    SFX.rip();
    pack.classList.add('is-ripped');
    packFlap.classList.add('is-gone');
    packFlap.style.transform = '';

    const r = cut.getBoundingClientRect();
    const s = stage.getBoundingClientRect();
    const lineY = r.top - s.top;
    const x0 = r.left - s.left;
    if (!reduceMotion.matches) {
      for (let i = 0; i < 26; i++) {
        FX.spark(x0 + (r.width * i) / 26, lineY + (Math.random() - 0.5) * 6, i % 3 ? '#ffffff' : '#b388ff', {
          speedMin: 120,
          speedMax: 520,
          g: 520,
          size: 2.6
        });
      }
    }

    window.setTimeout(() => {
      SFX.pop();
      flash.classList.remove('run');
      void flash.offsetWidth;
      flash.classList.add('run');
      if (!reduceMotion.matches) {
        FX.ring(x0 + r.width * 0.5, lineY, '#e6d9ff', 320);
        for (let i = 0; i < 40; i++) {
          FX.dot(x0 + r.width * 0.5, lineY, i % 2 ? '#ffffff' : '#b388ff', { speedMax: 420, g: -60, size: 4, life: 1.2 });
        }
        const glow = pack.getBoundingClientRect();
        FX.confetti(glow.left - s.left + glow.width / 2, glow.top - s.top + glow.height * 0.4, ['#b388ff', '#ffffff', '#f0abfc'], 26);
      }
      stage.classList.remove('shake');
      void stage.offsetWidth;
      stage.classList.add('shake');
    }, 260);

    window.setTimeout(showReveal, reduceMotion.matches ? 320 : 720);
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
     candidats (assets/Cartes/<nom>.png, .jpg, ...). Renvoie une Promise qui
     résout sur l'URL chargée, ou null si aucun visuel n'est disponible. */
  const imageCache = new Map();
  function resolveCardImage(card) {
    const srcs = typeof cardImageSources === 'function' ? cardImageSources(card) : card.image ? [card.image] : [];
    if (!srcs.length) return Promise.resolve(null);
    const key = srcs.join('|');
    if (imageCache.has(key)) return imageCache.get(key);
    const tried = [];
    const load = (i) => {
      if (i >= srcs.length) return Promise.resolve(null);
      tried.push(srcs[i]);
      return new Promise((resolve) => {
        const probe = new Image();
        probe.onload = () => resolve(srcs[i]);
        probe.onerror = () => resolve(load(i + 1));
        probe.src = srcs[i];
      });
    };
    const promise = load(0);
    imageCache.set(key, promise);
    return promise;
  }

  /* Cadre d'une carte : image plein cadre (5:7), titre en haut sur dégradé,
     description en bas sur dégradé, ID discret. Le tout réutilisable dans la
     révélation, le récap miniature et l'inspection en grand. */
  function cardFrame(card, opts = {}) {
    const info = RARITIES[card.rarity] || RARITIES.common;
    const frame = el('span', 'cf');
    frame.style.setProperty('--r-color', info.color);
    frame.style.setProperty('--r-ink', info.ink);
    frame.style.setProperty('--r-glow', info.glow);
    frame.dataset.rarity = card.rarity;
    if (opts.mini) frame.classList.add('cf-mini');

    const img = el('img', 'cf-img');
    img.alt = opts.alt || '';
    img.draggable = false;
    img.decoding = 'async';
    img.loading = opts.eager ? 'eager' : 'lazy';

    const fallback = el('span', 'cf-fallback');
    fallback.style.setProperty('--art', card.color || '#cfd7c5');
    fallback.append(el('span', 'card-emoji', card.emoji || '✦'));

    const top = el('span', 'cf-top');
    const badge = el('span', 'cf-badge', info.label);
    const name = el('span', 'cf-name', card.name);
    top.append(badge, name);
    if (opts.mini) top.classList.add('cf-top-mini');

    const bottom = el('span', 'cf-bottom');
    bottom.append(el('span', 'cf-desc', card.description || ''));
    const meta = el('span', 'cf-meta');
    meta.append(el('span', 'cf-id', `#${card.id}`));
    if (opts.index != null) meta.append(el('span', 'cf-num', `S01·${String(opts.index + 1).padStart(2, '0')}`));
    bottom.append(meta);

    frame.append(fallback, img, top, bottom);
    if (!opts.mini) {
      frame.append(el('span', 'cf-holo'), el('span', 'cf-shine'));
    }

    resolveCardImage(card).then((src) => {
      if (!src) return;
      img.src = src;
      on(img, 'load', () => frame.classList.add('has-img'), { once: true });
      frame.classList.add('has-src');
    });

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
    btn.setAttribute('aria-label', `Carte ${index + 1} sur ${CARD_COUNT}. Retourner la carte.`);

    const inner = el('span', 'card-inner');
    const tilt = el('span', 'card-tilt');

    /* dos */
    const back = el('span', 'card-face card-back');
    const backTop = el('span', 'back-row');
    backTop.append(el('span', null, 'REFS CARDS'), el('span', null, '✳'));
    const emblem = el('span', 'back-emblem');
    emblem.append(el('i'), el('i'), el('span', 'back-star', '✳'));
    const backBottom = el('span', 'back-row bottom');
    backBottom.append(el('span', null, 'UNE SURPRISE T\'ATTEND'), el('span', null, `0${index + 1}`));
    const backNum = el('span', 'back-num', `0${index + 1}`);
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
      if (!btn.classList.contains('is-revealed')) revealCard(btn, card);
      else if (btn.classList.contains('is-flipped') && performance.now() - Number(btn.dataset.flipAt || 0) > 650) {
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

  function revealCard(btn, card) {
    if (btn.classList.contains('is-revealed')) return;
    SFX.unlock();
    btn.dataset.flipAt = String(performance.now());
    btn.classList.add('is-revealed');
    if (card.rarity === 'epic') {
      // Petit suspense : la carte marque un temps d'arrêt avant de se retourner.
      btn.classList.add('is-hesitating');
      window.setTimeout(() => {
        btn.classList.remove('is-hesitating');
        btn.classList.add('is-flipped');
      }, reduceMotion.matches ? 0 : 340);
    } else {
      btn.classList.add('is-flipped');
    }
    const info = RARITIES[card.rarity];
    const c = cardCenter(btn);
    const cx = c.x;
    const cy = c.y;
    const quiet = reduceMotion.matches;

    btn.setAttribute('aria-label', `Carte ${state.deck.indexOf(card) + 1}. ${card.name}, ${info.label}. ${card.description}. Activez le bouton Carte suivante pour continuer.`);
    revealKicker.innerHTML = `<span>✦</span> ${info.label.toUpperCase()} <span>✦</span>`;
    footRight.textContent = 'CARTE SUIVANTE POUR CONTINUER →';
    nextCard.hidden = false;
    nextCard.textContent = remaining.length === 1 ? 'TERMINER LE BOOSTER →' : 'CARTE SUIVANTE →';

    clearEffects();

    const fx = info.fx || 'calm';
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

    const isNew = !state.collection.some((c) => c.id === card.id);
    state.collection.push(card);
    if (isNew) { fresh.add(card.id); tabBadge.hidden = false; }
    addCoins(info.reward);
    state.packIndex = state.deck.indexOf(card) + 1;
    pileLabel.textContent = `CARTE ${state.packIndex} / ${CARD_COUNT} · RÉVÉLÉE`;
    revealSub.textContent = info.rank >= RARITIES.legendary.rank
      ? `${info.label.toUpperCase()} ! Touche la carte ou le bouton pour continuer.`
      : 'Touche la carte ou le bouton pour continuer.';
  }

  /* ------------------------------------------------------- inspection grand */

  let inspectReturnFocus = null;

  function cardById(id) {
    return (
      state.collection.find((c) => c.id === id) ||
      cardsDatabase.find((c) => c.id === id) ||
      null
    );
  }

  function openInspect(card) {
    if (!card) return;
    const info = RARITIES[card.rarity] || RARITIES.common;
    inspectCard.replaceChildren(cardFrame(card, { eager: true, alt: `${card.name} — ${info.label}` }));
    inspectCard.style.setProperty('--r-color', info.color);
    inspectCard.style.setProperty('--r-glow', info.glow);
    inspectCard.dataset.rarity = card.rarity;
    inspectCard.dataset.fx = info.fx || 'calm';
    resetInspTilt();
    inspectReturnFocus = document.activeElement;
    inspect.hidden = false;
    void inspect.offsetWidth;
    inspect.classList.add('is-open');
    SFX.tick();
    inspectX.focus({ preventScroll: true });
  }

  function closeInspect() {
    if (inspect.hidden) return;
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

  /* ----------------------------------------------------------- vers le butin */

  let flying = false;

  on(nextCard, 'click', () => {
    if (state.phase !== 'reveal' || !current || flying) return;
    if (!current.node.classList.contains('is-flipped')) return;
    sendToRecap(current.node, current.data);
  });

  on(tableEl, 'click', (event) => {
    if (event.target.closest('.card') || !current || flying || state.phase !== 'reveal') return;
    if (!current.node.classList.contains('is-top') || !current.node.classList.contains('is-flipped')) return;
    sendToRecap(current.node, current.data);
  });

  function sendToRecap(btn, card) {
    if (flying) return;
    flying = true;
    nextCard.hidden = true;
    const restoreFocus = document.activeElement === nextCard || document.activeElement === btn;
    SFX.whoosh();
    btn.classList.remove('is-incoming');
    const target = recapSlots.children[state.loot.length] || recapSlots.lastElementChild;
    const from = btn.getBoundingClientRect();
    const to = target.getBoundingClientRect();
    const dx = to.left + to.width / 2 - (from.left + from.width / 2);
    const dy = to.top + to.height / 2 - (from.top + from.height / 2);
    const s = Math.max(0.16, to.width / from.width);

    btn.classList.add('is-flying');
    btn.style.setProperty('--fly-x', `${dx.toFixed(1)}px`);
    btn.style.setProperty('--fly-y', `${dy.toFixed(1)}px`);
    btn.style.setProperty('--fly-s', s.toFixed(3));

    window.setTimeout(() => {
      flying = false; // libéré d'abord : une erreur plus bas ne peut plus bloquer le jeu
      try {
      setRecapCollapsed(false);
      fillSlot(state.loot.length, card);
      state.loot.push(card);
      recapCount.textContent = `${state.loot.length} / ${CARD_COUNT}`;
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

  function showReveal() {
    if (!cardsDatabase.some((c) => RARITIES[c.rarity])) {
      state.phase = 'pack';
      showToast('Ajoute au moins une carte valide dans cards.js.');
      return;
    }
    nextCard.hidden = true;
    state.deck = drawPack(state.currentPackType === 'rare');
    packView.hidden = true;
    revealView.hidden = false;
    revealView.classList.remove('view-in');
    void revealView.offsetWidth;
    revealView.classList.add('view-in');

    recap.classList.remove('is-idle');
    setRecapCollapsed(false);
    state.loot = [];
    state.packIndex = 0;
    recapCount.textContent = `0 / ${CARD_COUNT}`;
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
    revealKicker.innerHTML = '<span>✦</span> BOOSTER OUVERT <span>✦</span>';
    revealTitle.innerHTML = 'La pile est prête<em>.</em>';
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    footRight.textContent = '← LA PLUS RARE EST AU FOND';
    pileLabel.textContent = `CARTE 1 / ${CARD_COUNT}`;
    buyBtn.hidden = true;
    fusionChip.hidden = true;
    recapMsg.textContent = '';
    clearEffects();
    rays.classList.remove('on');

    stack.replaceChildren();
    state.deck.forEach((card, i) => {
      const node = buildCard(card, i);
      node.classList.add('is-ejecting');
      node.style.setProperty('--eject-delay', `${reduceMotion.matches ? 0 : i * 80}ms`);
      stack.append(node);
      if (!reduceMotion.matches) {
        window.setTimeout(() => SFX.deal(), 260 + i * 80);
      }
    });

    remaining = state.deck.map((data, i) => ({ data, node: stack.children[i] }));
    sizeStage();
    scheduleSizing(10);
    current = remaining[0];
    window.setTimeout(() => current && current.node.classList.add('is-top'), reduceMotion.matches ? 10 : 420);
    state.phase = 'reveal';
  }

  function advanceStack() {
    remaining.forEach((item, i) => item.node.style.setProperty('--depth', i));
    current = remaining[0] || null;
    if (!current) return;
    current.node.classList.add('is-top', 'is-incoming');
    const incoming = current.node;
    window.setTimeout(() => incoming.classList.remove('is-incoming'), 600);
    pileLabel.textContent = `CARTE ${state.packIndex + 1 > CARD_COUNT ? CARD_COUNT : state.packIndex + 1} / ${CARD_COUNT}`;
  }

  function updateHintForNext() {
    if (!current) return;
    revealTitle.innerHTML = 'La pile est prête<em>.</em>';
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    clearEffects();
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    footRight.textContent = '← LA PLUS RARE EST AU FOND';
    revealKicker.innerHTML = '<span>✦</span> BOOSTER OUVERT <span>✦</span>';
    pileLabel.textContent = `CARTE ${CARD_COUNT - remaining.length + 1} / ${CARD_COUNT}`;
  }

  function finishPack() {
    state.phase = 'done';
    clearEffects();
    revealTitle.innerHTML = 'Butin complet<em>.</em>';
    revealSub.textContent = 'Toutes les cartes sont à toi. Ouvre un autre booster ou tente une fusion.';
    revealKicker.innerHTML = '<span>✦</span> BOOSTER TERMINÉ <span>✦</span>';
    pileLabel.textContent = `${CARD_COUNT} / ${CARD_COUNT} CARTES`;
    footRight.textContent = '✳ COLLECTION ENREGISTRÉE';
    recapCount.textContent = `${state.loot.length} / ${CARD_COUNT}`;

    window.setTimeout(() => {
      SFX.coin();
      /* Plus d'achat direct ici : le bouton renvoie au Shop (les packs
         achetés vont dans l'inventaire, onglet Pack). */
      buyBtn.hidden = false;
      buyBtn.disabled = false;
      buyBtn.classList.remove('is-denied', 'is-free');
      if (buyLabel) buyLabel.textContent = 'ALLER AU SHOP';
      if (buyPrice) buyPrice.hidden = true;
      const total = packTotal();
      recapMsg.textContent = total > 0
        ? `Tu as ${total} pack${total > 1 ? 's' : ''} en inventaire — ouvre-les dans l'onglet Pack !`
        : 'Plus de packs ? Le Shop t\'attend (3 gratuits par jour).';
      updateFusionChip();
      if (!fusionChip.hidden) {
        fusionChip.animate?.(
          [{ transform: 'translateY(10px)', opacity: 0 }, { transform: 'none', opacity: 1 }],
          { duration: 500, easing: 'cubic-bezier(.22,1,.36,1)', delay: 120, fill: 'backwards' }
        );
      }
      if (fusionCount() > 0) window.setTimeout(() => openFusion(true), reduceMotion.matches ? 260 : 1250);
    }, reduceMotion.matches ? 120 : 480);
  }

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

  function resetToPack() {
    state.phase = 'pack';
    recap.classList.add('is-idle');
    setRecapCollapsed(false);
    buyBtn.hidden = true;
    fusionChip.hidden = true;
    recapMsg.textContent = '';
    recap.classList.add('is-idle');
    revealView.hidden = true;
    packView.hidden = false;
    packView.classList.remove('view-out');
    packView.hidden = false;
    packView.classList.remove('view-in');
    void packView.offsetWidth;
    packView.classList.add('view-in');

    pack.classList.remove('is-ripped', 'is-dragging');
    pack.style.transform = '';
    packFlap.classList.remove('is-gone');
    packFlap.style.transform = '';
    resetTear();
    clearEffects();
    flash.classList.remove('run');
    stack.replaceChildren();
    remaining = [];
    current = null;

    window.setTimeout(() => {
      [...recapSlots.children].forEach((s) => {
        s.className = 'slot';
        s.style.removeProperty('--slot-color');
        s.replaceChildren();
      });
      recapCount.textContent = `0 / ${CARD_COUNT}`;
    }, 420);

    revealTitle.innerHTML = 'La pile est prête<em>.</em>';
    revealSub.textContent = 'Touche la carte du dessus pour la retourner.';
    SFX.deal();
    scheduleSizing(10);
    if (!state.packStock[state.currentPackType] && packTotal() > 0) {
      selectPackType(state.packStock.classic > 0 ? 'classic' : 'rare');
    }
    renderPackInventory();
    showToast(packTotal() > 0
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
      if (count >= 2 && info && info.next && cardsDatabase.some((c) => c.rarity === info.next)) {
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

  function openFusion(auto = false) {
    if (state.fusionOpen) return;
    /* Auto (fin de pack) : uniquement depuis l'onglet Pack, une fois les cinq
       cartes rangées. Manuel (récap ou Collection) : dès qu'un doublon existe,
       même hors de la phase de révélation. */
    if (auto) {
      if (state.phase !== 'done' || app.dataset.tab !== 'pack') return;
    } else if (state.phase !== 'done' && !fusionCount()) {
      return;
    }
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
          : 'Aucun doublon fusionnable pour l\'instant. Les <b>légendaires</b> sont au sommet : impossible de les fusionner.';
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
        el('span', 'fr-name', entry.card.name),
        el('span', 'fr-meta', `2 doublons → 1 ${next.label}`)
      );
      row.append(emoji, main, el('span', 'fr-count', `×${entry.count}`));
      on(row, 'click', () => {
        state.fusionSelection = entry.card.id;
        SFX.tick();
        [...fusionGrid.querySelectorAll('.fusion-row')].forEach((r) => r.classList.toggle('is-selected', r === row));
        renderFusionPreview(entry);
        fusionGo.hidden = false;
        fusionGo.textContent = `FUSIONNER · −2 ${entry.card.name}`;
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
    const pool = cardsDatabase.filter((c) => c.rarity === info.next);
    if (!pool.length) {
      showToast('Aucune carte de rareté supérieure disponible dans cards.js.');
      return;
    }
    const result = pool[Math.floor(Math.random() * pool.length)];

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
    renderFusion();
    renderRecapFromCollection();
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
    const last = state.collection.slice(-CARD_COUNT);
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
  on(fusionChip, 'click', () => openFusion(false));
  if (collFusion) on(collFusion, 'click', () => openFusion(false));

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
    if (e.key === 'Escape' && tradeSheet && !tradeSheet.hidden) {
      closeSheet(tradeSheet);
      return;
    }
    if (e.key === 'Escape' && confirmSheet && !confirmSheet.hidden) {
      confirmAction = null;
      closeSheet(confirmSheet);
      return;
    }
    if (app.dataset.tab !== 'pack' || state.phase !== 'reveal' || state.fusionOpen || !current) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (document.activeElement === buyBtn || document.activeElement === fusionChip || document.activeElement === recapToggle) return;
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

  /* Probabilités : générées depuis RARITIES pour rester toujours justes.
     En pack rare : +20 % de chances sur chaque rareté Rare+ (voir rarityWeight). */
  function renderOdds(boosted) {
    if (!packOdds) return;
    packOdds.replaceChildren();
    const total = Object.keys(RARITIES).reduce((sum, key) => sum + rarityWeight(key, boosted), 0);
    Object.entries(RARITIES).forEach(([key, r]) => {
      const row = el('span', `odds odds-${key}`);
      const dot = el('i');
      dot.style.background = r.color;
      dot.style.boxShadow = `0 0 6px ${r.glow}`;
      const pct = boosted ? (rarityWeight(key, true) / total) * 100 : r.weight;
      const label = boosted
        ? `${r.label} ${pct.toFixed(1).replace('.', ',')} %`
        : `${r.label} ${String(r.weight).replace('.', ',')} %`;
      row.append(dot, document.createTextNode(label));
      packOdds.append(row);
    });
    if (boosted) {
      packOdds.append(el('span', 'pack-odds-rare-note', 'PACK RARE : +20 % DE CHANCES SUR RARE+'));
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
  const collEmpty = $('coll-empty');
  const tabBadge = $('tab-badge');
  const fresh = new Set(); // cartes obtenues depuis la dernière visite de la collection
  let collFilter = 'all';

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

  function applySave(d) {
    state.coins = Math.max(0, Number(d && d.coins) || 0);
    state.firstPack = !d || d.firstPack !== false;
    state.collection = ((d && d.collection) || [])
      .map((id) => cardsDatabase.find((c) => c.id === id))
      .filter(Boolean);
    friends = Array.isArray(d && d.friends)
      ? d.friends.filter((u) => typeof u === 'string')
      : [];
    state.packsOpened = Math.max(0, Number(d && d.packsOpened) || 0);
    /* Inventaire : les anciennes sauvegardes n'ont pas packStock/freeDate/
       freeUsed (défauts 0). Le premier pack offert (firstPack) devient
       1 pack classique en inventaire, une seule fois. */
    const stock = (d && d.packStock) || {};
    state.packStock = {
      classic: Math.max(0, Number(stock.classic) || 0),
      rare: Math.max(0, Number(stock.rare) || 0)
    };
    if (state.firstPack) {
      state.packStock.classic += 1;
      state.firstPack = false;
    }
    state.freeDate = typeof (d && d.freeDate) === 'string' ? d.freeDate : '';
    state.freeUsed = clamp(Number(d && d.freeUsed) || 0, 0, FREE_PER_DAY);
    refreshFreeQuota();
    state.currentPackType = state.packStock.rare > 0 && state.packStock.classic <= 0 ? 'rare' : 'classic';
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
    const data = {
        coins: state.coins,
        firstPack: state.firstPack,
        collection: state.collection.map((c) => c.id),
        friends,
        packsOpened: state.packsOpened || 0,
        packStock: {
          classic: Math.max(0, Number(state.packStock.classic) || 0),
          rare: Math.max(0, Number(state.packStock.rare) || 0)
        },
        freeDate: state.freeDate || todayKey(),
        freeUsed: clamp(Number(state.freeUsed) || 0, 0, FREE_PER_DAY),
        updatedAt: serverTimestamp()
      };
    saveQueue = saveQueue.then(async () => {
      try {
        await db.collection('playerSaves').doc(userId).set(data, { merge: true });
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
    syncHudName();
    syncHudAvatar();
    /* Profil public (pseudo, avatar, code ami) chargé AVANT d'afficher le
       jeu : un changement de pseudo ou de photo fait juste après la
       connexion ne doit pas être écrasé par ce chargement (qui réécrit le
       profil cloud avec les anciennes valeurs). */
    await loadProfile();
    loadFriendRequests();
    subscribeFriendRequests();
    loadTrades();
    subscribeTrades();
    loadMarket();
    if (authScreen) authScreen.hidden = true;
    gameRegions.forEach((region) => region.removeAttribute('inert'));
    app.classList.add('is-authenticated');
    setAuthBusy(false);
    resetAuthFeedback();
    setTab('pack');
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
    trades = [];
    marketListings = [];
    marketGifts = [];
    selectedFriendUid = null;
    rulesHelpShown = false;
    state.packStock = { classic: 0, rare: 0 };
    state.freeDate = '';
    state.freeUsed = 0;
    state.currentPackType = 'classic';
    shopQty.classic = 1;
    shopQty.rare = 1;
    renderShop();
    renderPackInventory();
    if (tradesUnsub) {
      try { tradesUnsub(); } catch (error) { /* déjà fermé */ }
      tradesUnsub = null;
    }
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
    if (authScreen) authScreen.hidden = false;
    setAuthBusy(false);
    resetAuthFeedback();
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
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(config);
      firebaseAuth = firebase.auth();
      cloudDb = firebase.firestore();
      resetAuthFeedback();
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
          return;
        }
        currentUser = user;
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
    } else if (tab === 'online') {
      renderOnline();
      loadMarket();
      loadFriendRequests();
      if (selectedFriendUid) loadFriendListings(selectedFriendUid);
    } else if (tab === 'pack') {
      renderPackInventory();
      // Les vues Pack étaient masquées : on remesure tout.
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
    const defs = [['all', 'Toutes'], ['owned', 'Possédées'], ...rarities.map((r) => [r, RARITIES[r].label])];
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

  function renderCollection() {
    const owned = countMap();
    const total = cardsDatabase.length;
    const got = cardsDatabase.filter((c) => owned.has(c.id)).length;
    collCount.textContent = `${got} / ${total}`;
    collFill.style.transform = `scaleX(${total ? got / total : 0})`;
    updateFusionChip();

    const frag = document.createDocumentFragment();
    let shown = 0;
    cardsDatabase.forEach((card, i) => {
      const n = owned.get(card.id) || 0;
      // Filtre de rareté / possédées : jamais de carte verrouillée, pour ne rien dévoiler.
      if (collFilter !== 'all' && (!n || (collFilter !== 'owned' && card.rarity !== collFilter))) return;
      shown++;
      if (!n) {
        const t = el('div', 'coll-tile is-locked');
        t.style.setProperty('--i', i);
        t.setAttribute('aria-label', `Carte verrouillée, numéro ${i + 1}`);
        t.append(el('span', 'lock-q', '???'), el('span', 'lock-n', `N° ${String(i + 1).padStart(3, '0')}`));
        frag.append(t);
        return;
      }
      const info = RARITIES[card.rarity] || RARITIES.common;
      const t = el('button', 'coll-tile');
      t.type = 'button';
      t.dataset.rarity = card.rarity;
      t.style.setProperty('--i', i);
      t.style.setProperty('--r-color', info.color);
      t.style.setProperty('--r-glow', info.glow);
      t.setAttribute('aria-label', `${card.name}, ${info.label}${n > 1 ? `, ${n} exemplaires` : ''}. Voir en grand.`);
      t.append(cardFrame(card, { mini: true, alt: `${card.name} — ${info.label}` }));
      if (n > 1) t.append(el('span', 'coll-pill', `x${n}`));
      if (fresh.has(card.id)) t.classList.add('is-fresh');
      on(t, 'click', () => openInspect(card));
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
  function openFromInventory(type) {
    if (!(state.packStock[type] > 0) || (state.phase !== 'pack' && state.phase !== 'done')) return;
    if (state.phase === 'done') resetToPack();
    selectPackType(type);
    setTab('pack');
  }
  on(openClassic, 'click', () => openFromInventory('classic'));
  on(openRare, 'click', () => openFromInventory('rare'));
  on(inventoryGoShop, 'click', () => setTab('shop'));
  if (inventoryGrid) {
    on(inventoryGrid, 'click', (e) => {
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
  const tradesIn = $('trades-in');
  const tradesOut = $('trades-out');
  const friendsList = $('friends-list');
  const friendsEmpty = $('friends-empty');
  const friendsCount = $('friends-count');
  const friendDetail = $('friend-detail');
  const friendAvatar = $('friend-avatar');
  const friendAvatarFallback = $('friend-avatar-fallback');
  const friendPseudo = $('friend-pseudo');
  const friendCodeLabel = $('friend-code-label');
  const friendStats = $('friend-stats');
  const friendCards = $('friend-cards');
  const friendCardsEmpty = $('friend-cards-empty');
  const friendClose = $('friend-close');
  const tradeSheet = $('trade-sheet');
  const tradeSheetSub = $('trade-sheet-sub');
  const tradePicker = $('trade-picker');
  const confirmSheet = $('confirm-sheet');
  const confirmTitle = $('confirm-title');
  const confirmMessage = $('confirm-message');
  const confirmOk = $('confirm-ok');

  /* Profil public (playerProfiles/{uid}) : pseudo, avatar, code ami, stats et
     collection — c'est ce que les amis voient. La sauvegarde privée
     (playerSaves/{uid}) garde en plus la liste d'amis. */
  const profile = { pseudo: '', avatar: '', friendCode: '' };
  let friends = [];                  // uids de mes amis (acceptés des deux côtés)
  const friendProfiles = new Map();  // uid -> profil public d'un ami
  let friendRequests = [];           // demandes d'ami où je suis destinataire
  let friendRequestsUnsub = null;
  let trades = [];                   // échanges où je suis partie
  let tradesUnsub = null;
  let sentRequests = [];             // demandes d'ami que j'ai envoyées (requêtes)
  const sentRequestsByUid = new Map(); // uid -> id du document friendRequests
  const pendingFriendUids = new Set(); // uids demandés mais pas encore acceptés
  let selectedFriendUid = null;
  let tradeTarget = null;            // {uid, cardId} : carte visée par l'échange en cours
  let confirmAction = null;
  let profileTimer = 0;
  let pseudoTimer = 0;              // auto-sauvegarde du pseudo pendant la frappe
  let rulesHelpShown = false;       // un seul toast « règles » par session

  function serverTimestamp() {
    try {
      if (window.firebase && firebase.firestore && firebase.firestore.FieldValue) {
        return firebase.firestore.FieldValue.serverTimestamp();
      }
    } catch (error) { /* repli ci-dessous */ }
    return new Date();
  }

  function cloudReady() {
    return Boolean(currentUser && cloudDb && typeof cloudDb.collection === 'function');
  }

  /* Les refus « permission-denied » de Firestore ne sont PAS un problème de
     connexion : ils signalent des règles non publiées (ou trop strictes) sur
     le projet. On les détecte pour afficher un message actionnable au lieu
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

  const RULES_HELP = 'Règles Firestore refusent l’accès (permission-denied). Republie-les avec « firebase deploy --only firestore:rules » (ou Firebase Console → Firestore Database → Rules → Publier), puis recharge la page.';

  /* Journalise l'erreur cloud et, la première fois qu'un refus de règles
     survient durant la session, affiche un toast explicite. Renvoie true
     quand il s'agissait d'un refus de règles (pour adapter le message). */
  function noteCloudError(context, error) {
    if (isPermissionDenied(error)) {
      console.warn(`${context}: règles Firestore insuffisantes (permission-denied).`, error);
      if (!rulesHelpShown) {
        rulesHelpShown = true;
        showToast('Accès cloud refusé par les règles Firestore : republie firestore.rules (voir le README).');
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
    const unique = cardsDatabase.filter((c) => owned.has(c.id)).length;
    let value = 0;
    let best = null;
    for (const card of cardsDatabase) {
      const n = owned.get(card.id) || 0;
      if (!n) continue;
      value += (RARITIES[card.rarity] ? RARITIES[card.rarity].reward : 0) * n;
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
        totalCards: stats.total,
        uniqueCards: stats.unique,
        bestRarity: stats.best ? stats.best.rarity : null,
        collection: collectionIds(),
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
    if (profilePseudo) profilePseudo.textContent = profile.pseudo || 'Joueur';
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
        ['👥 Amis', fmt(friends.length)]
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
          const n = cardsDatabase
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
    window.clearTimeout(pseudoTimer);
    pseudoTimer = window.setTimeout(async () => {
      pseudoTimer = 0;
      const value = (pseudoInput.value || '').replace(/\s+/g, ' ').trim().slice(0, 24);
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

  /* ------------------------------------------------------------------ amis */

  async function fetchFriendProfile(uid) {
    if (friendProfiles.has(uid)) return friendProfiles.get(uid);
    const fallback = {
      pseudo: 'Joueur', avatar: '', friendCode: '',
      coins: 0, totalCards: 0, uniqueCards: 0, bestRarity: null, collection: []
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
          collection: Array.isArray(d.collection) ? d.collection : []
        };
        friendProfiles.set(uid, data);
        return data;
      }
    } catch (error) {
      noteCloudError('Profil ami illisible', error);
    }
    friendProfiles.set(uid, fallback);
    return fallback;
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
      showToast(`${who ? who.pseudo : 'Un joueur'} veut t’ajouter en ami — va dans « En ligne » pour accepter.`, 4200);
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

  function renderOnline() {
    if (!onlineView) return;
    renderMarket();
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
          el('strong', 'friend-row-pseudo', data.pseudo || 'Joueur'),
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
    renderTrades();
    if (selectedFriendUid) renderFriendDetail(selectedFriendUid);
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
      el('strong', 'friend-row-pseudo', (data && data.pseudo) || 'Joueur'),
      el('span', 'friend-row-sub', `${(data && data.uniqueCards) || 0} uniques · ${(data && data.totalCards) || 0} cartes`)
    );
    const wrap = el('div', 'request-id');
    wrap.append(img, fb, box);
    return wrap;
  }

  async function openFriendDetail(uid) {
    selectedFriendUid = uid;
    if (friendDetail) friendDetail.hidden = false;
    await fetchFriendProfile(uid);
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
    if (friendPseudo) friendPseudo.textContent = data.pseudo || 'Joueur';
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
    if (friendCards) {
      const owned = new Map();
      for (const id of data.collection) owned.set(id, (owned.get(id) || 0) + 1);
      const ownedCards = cardsDatabase.filter((c) => owned.has(c.id));
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
        const actions = el('div', 'friend-card-actions');
        const swap = el('button', 'mini-btn', 'Échanger');
        swap.type = 'button';
        on(swap, 'click', () => openTradePicker(uid, card.id));
        actions.append(swap);
        tile.append(actions);
        return tile;
      }));
      if (friendCardsEmpty) friendCardsEmpty.hidden = ownedCards.length > 0;
    }
  }

  on(friendClose, 'click', closeFriendDetail);

  /* ------------------------------------------------- fenêtres d'échange/achat */

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
    if (confirmTitle) confirmTitle.textContent = title || 'Confirmer ?';
    if (confirmMessage) confirmMessage.textContent = message || '';
    if (confirmOk) confirmOk.textContent = confirmLabel || 'Confirmer';
    confirmAction = onConfirm || null;
    openSheet(confirmSheet);
  }

  on(confirmOk, 'click', () => {
    const action = confirmAction;
    confirmAction = null;
    closeSheet(confirmSheet);
    if (action) action();
  });

  [tradeSheet, confirmSheet].forEach((sheet) => {
    if (!sheet) return;
    sheet.querySelectorAll('[data-close]').forEach((b) => on(b, 'click', () => closeSheet(sheet)));
  });

  function openTradePicker(uid, cardId) {
    const data = friendProfiles.get(uid);
    const wanted = cardsDatabase.find((c) => c.id === cardId);
    if (!wanted) return;
    tradeTarget = { uid, cardId };
    const who = data ? data.pseudo : 'Ton ami';
    if (tradeSheetSub) {
      tradeSheetSub.textContent = `${who} te donne « ${wanted.name} ». Choisis une de tes cartes à lui donner en échange :`;
    }
    const owned = countMap();
    const mine = cardsDatabase.filter((c) => owned.has(c.id));
    if (tradePicker) {
      tradePicker.replaceChildren(...mine.map((card) => {
        const info = RARITIES[card.rarity] || RARITIES.common;
        const n = owned.get(card.id) || 0;
        const b = el('button', 'picker-tile');
        b.type = 'button';
        b.style.setProperty('--r-color', info.color);
        b.style.setProperty('--r-glow', info.glow);
        b.append(cardFrame(card, { mini: true, alt: card.name }));
        if (n > 1) b.append(el('span', 'coll-pill', `x${n}`));
        on(b, 'click', () => {
          closeSheet(tradeSheet);
          askConfirm({
            title: 'Proposer l’échange ?',
            message: `Tu donnes « ${card.name} » et tu reçois « ${wanted.name} » de ${who}. ${who} pourra accepter ou refuser.`,
            confirmLabel: 'Proposer',
            onConfirm: () => createTrade({ toUid: uid, giveId: card.id, receiveId: wanted.id, price: 0 })
          });
        });
        return b;
      }));
    }
    openSheet(tradeSheet);
  }

  /* Marché : la carte / les pièces sont mises en réserve avant d'être reçues.
     Chaque opération modifie seulement la sauvegarde de son propriétaire et
     le document de réserve, dans une transaction Firestore indivisible. */
  let marketListings = [];
  let marketGifts = [];
  let marketBusy = false;
  let marketDone = Promise.resolve();
  let finishMarket = null;
  const marketMessage = $('market-message');
  const marketCard = $('market-card');
  const marketPrice = $('market-price');
  const myListings = $('my-listings');
  const marketInbox = $('market-inbox');
  const friendListings = $('friend-listings');
  const giftAmount = $('gift-amount');
  const MAX_COINS = 1000000000;

  function marketNumber(input, min) {
    const value = input && input.value.trim();
    const n = Number(value);
    if (!value || !/^\d+$/.test(value) || !Number.isSafeInteger(n) || n < min || n > MAX_COINS) {
      throw new Error(`Choisis un nombre entier entre ${fmt(min)} et ${fmt(MAX_COINS)}.`);
    }
    return n;
  }

  function marketInfo(message) {
    if (marketMessage) marketMessage.textContent = message;
    showToast(message);
  }

  function renderMarket() {
    if (!currentUser) return;
    if (marketCard) {
      const old = marketCard.value;
      const owned = countMap();
      const options = cardsDatabase.filter((c) => owned.has(c.id)).map((card) => {
        const option = el('option', '', `${card.name} (x${owned.get(card.id)})`);
        option.value = card.id;
        return option;
      });
      if (!options.length) {
        const option = el('option', '', 'Aucune carte disponible');
        option.value = '';
        options.push(option);
      }
      marketCard.replaceChildren(...options);
      if (owned.has(old)) marketCard.value = old;
    }
    if (myListings) {
      const active = marketListings.filter((l) => l.status === 'open');
      myListings.replaceChildren(...(active.length ? active.map((listing) => {
        const row = el('div', 'trade-row');
        row.append(el('span', 'trade-text', `${cardName(listing.cardId)} · ${fmt(listing.price)} 🪙`));
        const cancel = el('button', 'mini-btn', 'Retirer de la vente');
        cancel.type = 'button';
        on(cancel, 'click', () => marketTransaction('cancel', listing.id));
        row.append(cancel);
        return row;
      }) : [el('p', 'online-empty', 'Aucune carte en vente.') ]));
    }
    if (marketInbox) {
      const income = [
        ...marketListings.filter((l) => l.status === 'sold').map((l) => ({ ...l, kind: 'sale' })),
        ...marketGifts.filter((g) => g.status === 'pending').map((g) => ({ ...g, kind: 'gift' }))
      ];
      marketInbox.replaceChildren(...(income.length ? income.map((item) => {
        const row = el('div', 'trade-row');
        const text = item.kind === 'sale' ? `Vente de « ${cardName(item.cardId)} » : ${fmt(item.price)} 🪙` : `Cadeau de pièces : ${fmt(item.amount)} 🪙`;
        row.append(el('span', 'trade-text', text));
        const claim = el('button', 'mini-btn primary', 'Récupérer');
        claim.type = 'button';
        on(claim, 'click', () => marketTransaction(item.kind === 'sale' ? 'claimSale' : 'claimGift', item.id));
        row.append(claim);
        return row;
      }) : [el('p', 'online-empty', 'Rien à récupérer pour le moment.') ]));
    }
  }

  async function loadMarket() {
    if (!cloudReady()) return;
    if (typeof cloudDb.collection('marketListings').where !== 'function' || typeof cloudDb.collection('coinGifts').where !== 'function') return;
    const uid = currentUser.uid;
    try {
      const [listings, gifts] = await Promise.all([
        cloudDb.collection('marketListings').where('sellerUid', '==', uid).get(),
        cloudDb.collection('coinGifts').where('toUid', '==', uid).get()
      ]);
      if (!currentUser || currentUser.uid !== uid) return;
      marketListings = snapshotDocs(listings).map((d) => ({ id: d.id, ...d.data }));
      marketGifts = snapshotDocs(gifts).map((d) => ({ id: d.id, ...d.data }));
      renderMarket();
    } catch (error) { noteCloudError('Marché illisible', error); }
  }

  async function loadFriendListings(uid) {
    if (!cloudReady() || !friendListings) return;
    friendListings.replaceChildren(el('p', 'online-empty', 'Chargement des ventes…'));
    try {
      const snap = await cloudDb.collection('marketListings').where('sellerUid', '==', uid).get();
      if (selectedFriendUid !== uid) return;
      const listings = snapshotDocs(snap).map((d) => ({ id: d.id, ...d.data })).filter((l) => l.status === 'open');
      friendListings.replaceChildren(...(listings.length ? listings.map((listing) => {
        const row = el('div', 'trade-row');
        row.append(el('span', 'trade-text', `${cardName(listing.cardId)} · ${fmt(listing.price)} 🪙`));
        const buy = el('button', 'mini-btn primary', 'Acheter');
        buy.type = 'button';
        on(buy, 'click', () => askConfirm({
          title: 'Acheter cette carte ?',
          message: `Acheter « ${cardName(listing.cardId)} » pour ${fmt(listing.price)} 🪙 ?`,
          confirmLabel: 'Acheter',
          onConfirm: () => marketTransaction('buy', listing.id)
        }));
        row.append(buy);
        return row;
      }) : [el('p', 'online-empty', 'Aucune carte en vente pour le moment.') ]));
    } catch (error) {
      if (selectedFriendUid === uid) friendListings.replaceChildren(el('p', 'online-empty', 'Impossible de charger les ventes. Réessaie.'));
      noteCloudError('Ventes de l’ami illisibles', error);
    }
  }

  async function marketTransaction(action, id, value) {
    if (!cloudReady() || marketBusy) return;
    if (typeof cloudDb.runTransaction !== 'function') { marketInfo('Transactions indisponibles. Réessaie plus tard.'); return; }
    const uid = currentUser.uid;
    const db = cloudDb;
    marketBusy = true;
    marketDone = new Promise((resolve) => { finishMarket = resolve; });
    const overlay = el('div', 'market-busy', 'Transaction en cours…');
    overlay.setAttribute('role', 'status');
    document.body.append(overlay);
    gameRegions.forEach((region) => region.setAttribute('inert', ''));
    try {
      if (!await saveNow(true)) throw new Error('Sauvegarde impossible : transaction annulée.');
      const saveRef = db.collection('playerSaves').doc(uid);
      const collName = action === 'gift' || action === 'claimGift' ? 'coinGifts' : 'marketListings';
      const ref = id ? db.collection(collName).doc(id) : db.collection(collName).doc();
      const result = await db.runTransaction(async (tx) => {
        const saveSnap = await tx.get(saveRef);
        const itemSnap = id ? await tx.get(ref) : null;
        if (!saveSnap.exists) throw new Error('Sauvegarde introuvable.');
        const saveData = saveSnap.data();
        const coins = saveData.coins;
        const cards = [...saveData.collection];
        const item = itemSnap && itemSnap.exists ? itemSnap.data() : null;
        let nextCoins = coins;
        let patch;
        if (action === 'list') {
          const index = cards.indexOf(value.cardId);
          if (index < 0) throw new Error('Tu ne possèdes plus cette carte.');
          cards.splice(index, 1);
          tx.set(ref, { sellerUid: uid, cardId: value.cardId, price: value.price, status: 'open', buyerUid: '', createdAt: serverTimestamp() });
        } else if (action === 'gift') {
          if (!saveData.friends.includes(value.toUid) || uid === value.toUid) throw new Error('Ce joueur ne fait plus partie de tes amis.');
          if (coins < value.amount) throw new Error('Tu n’as pas assez de pièces.');
          nextCoins -= value.amount;
          tx.set(ref, { fromUid: uid, toUid: value.toUid, amount: value.amount, status: 'pending', createdAt: serverTimestamp() });
        } else if (action === 'cancel') {
          if (!item || item.sellerUid !== uid || item.status !== 'open') throw new Error('Cette annonce n’est plus disponible.');
          if (cards.length >= 10000) throw new Error('Ta collection est pleine.');
          cards.push(item.cardId); patch = { status: 'cancelled' };
        } else if (action === 'buy') {
          if (!item || item.status !== 'open' || item.sellerUid === uid) throw new Error('Cette carte n’est plus en vente.');
          if (!friends.includes(item.sellerUid)) throw new Error('Cette vente est réservée à tes amis.');
          if (coins < item.price) throw new Error('Tu n’as pas assez de pièces.');
          if (cards.length >= 10000) throw new Error('Ta collection est pleine.');
          nextCoins -= item.price; cards.push(item.cardId); patch = { status: 'sold', buyerUid: uid };
        } else if (action === 'claimSale') {
          if (!item || item.sellerUid !== uid || item.status !== 'sold') throw new Error('Cette vente a déjà été récupérée.');
          nextCoins += item.price; patch = { status: 'completed' };
        } else if (action === 'claimGift') {
          if (!item || item.toUid !== uid || item.status !== 'pending') throw new Error('Ce cadeau a déjà été récupéré.');
          nextCoins += item.amount; patch = { status: 'claimed' };
        } else throw new Error('Action inconnue.');
        if (nextCoins > MAX_COINS) throw new Error('Ton solde dépasserait la limite de pièces. Dépense-en avant de récupérer ce montant.');
        if (patch) tx.update(ref, patch);
        tx.update(saveRef, { coins: nextCoins, collection: cards, updatedAt: serverTimestamp() });
        return { coins: nextCoins, cards };
      });
      if (!currentUser || currentUser.uid !== uid) return;
      state.coins = result.coins;
      state.collection = result.cards.map((cardId) => cardsDatabase.find((c) => c.id === cardId)).filter(Boolean);
      updateCoins(); renderCollection(); renderShop(); renderAccount(); saveProfileSoon();
      marketInfo({ list: 'Carte mise en vente !', gift: 'Cadeau envoyé ! Ton ami pourra le récupérer.', cancel: 'Carte rendue à ta collection.', buy: 'Carte achetée !', claimSale: 'Pièces de la vente récupérées !', claimGift: 'Cadeau récupéré !' }[action]);
      await loadMarket();
      if (selectedFriendUid) await loadFriendListings(selectedFriendUid);
    } catch (error) {
      marketInfo(isPermissionDenied(error) ? RULES_HELP : (error.message || 'Transaction impossible. Réessaie.'));
      await loadMarket();
      if (selectedFriendUid) await loadFriendListings(selectedFriendUid);
    } finally {
      overlay.remove();
      if (currentUser && currentUser.uid === uid) gameRegions.forEach((region) => region.removeAttribute('inert'));
      marketBusy = false;
      finishMarket();
      finishMarket = null;
    }
  }

  on($('market-list-form'), 'submit', (e) => {
    e.preventDefault();
    try {
      const price = marketNumber(marketPrice, 0);
      const cardId = marketCard.value;
      if (!cardId || !cardsDatabase.some((c) => c.id === cardId)) throw new Error('Choisis une carte à vendre.');
      askConfirm({ title: 'Mettre en vente ?', message: `Réserver « ${cardName(cardId)} » pour ${fmt(price)} 🪙 ?`, confirmLabel: 'Mettre en vente', onConfirm: () => marketTransaction('list', null, { cardId, price }) });
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
  on($('market-refresh'), 'click', () => { loadMarket(); if (selectedFriendUid) loadFriendListings(selectedFriendUid); });


  /* ---------------------------------------------------------------- échanges
     Un échange est un document trades/{id} partagé par les deux joueurs.
     Chacun applique sa propre moitié dans SA sauvegarde (les règles
     Firestore restent « propriétaire uniquement ») : quand les deux
     moitiés sont appliquées, l'échange passe à « done ». Si l'autre joueur
     est hors ligne, sa moitié s'applique à sa prochaine connexion. */

  async function createTrade({ toUid, giveId, receiveId, price }) {
    if (!cloudReady()) {
      showToast('Connexion requise pour échanger.');
      return;
    }
    const id = `${currentUser.uid}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 8)}`;
    try {
      await cloudDb.collection('trades').doc(id).set({
        fromUid: currentUser.uid,
        toUid,
        giveId: giveId || null,
        receiveId: receiveId || null,
        price: Number(price) || 0,
        status: 'pending',
        createdAt: serverTimestamp(),
        applied: {}
      });
      showToast('Échange proposé ! Ton ami le verra dans « En ligne ».');
      await loadTrades();
      renderOnline();
    } catch (error) {
      if (isPermissionDenied(error)) showToast(RULES_HELP);
      else showToast('Impossible d’envoyer la proposition. Réessaie.');
    }
  }

  async function updateTrade(id, patch) {
    if (!cloudReady()) return;
    try {
      await cloudDb.collection('trades').doc(id).update(patch);
    } catch (error) {
      noteCloudError('Échange non mis à jour', error);
    }
  }

  function snapshotDocs(snap) {
    if (!snap) return [];
    if (Array.isArray(snap.docs)) return snap.docs.map((d) => ({ id: d.id, data: d.data() }));
    const out = [];
    if (typeof snap.forEach === 'function') snap.forEach((d) => out.push({ id: d.id, data: d.data() }));
    return out;
  }

  async function loadTrades() {
    if (!cloudReady()) return;
    const tradesColl = cloudDb.collection('trades');
    if (!tradesColl || typeof tradesColl.where !== 'function') return;
    const uid = currentUser.uid;
    const found = new Map();
    try {
      const q1 = tradesColl.where('fromUid', '==', uid);
      const q2 = tradesColl.where('toUid', '==', uid);
      const [s1, s2] = await Promise.all([q1.get(), q2.get()]);
      for (const t of [...snapshotDocs(s1), ...snapshotDocs(s2)]) {
        found.set(t.id, { id: t.id, ...t.data });
      }
    } catch (error) {
      noteCloudError('Échanges illisibles', error);
      return;
    }
    trades = [...found.values()];
    for (const trade of trades) {
      if (trade.status === 'accepted' && !(trade.applied && trade.applied[uid])) {
        await applyMyHalf(trade);
      }
    }
    if (app.dataset.tab === 'online') renderOnline();
  }

  function subscribeTrades() {
    if (!cloudReady() || tradesUnsub) return;
    const uid = currentUser.uid;
    try {
      const onSnap = (snap) => {
        const found = new Map(trades.map((t) => [t.id, t]));
        for (const t of snapshotDocs(snap)) found.set(t.id, { id: t.id, ...t.data });
        trades = [...found.values()];
        if (app.dataset.tab === 'online') renderOnline();
      };
      const q1 = cloudDb.collection('trades').where('fromUid', '==', uid);
      const q2 = cloudDb.collection('trades').where('toUid', '==', uid);
      if (typeof q1.onSnapshot === 'function') {
        const onSnapError = (error) => noteCloudError('Échanges illisibles (temps réel)', error);
        const un1 = q1.onSnapshot(onSnap, onSnapError);
        const un2 = typeof q2.onSnapshot === 'function' ? q2.onSnapshot(onSnap, onSnapError) : null;
        tradesUnsub = () => {
          try { if (un1) un1(); } catch (error) { /* déjà fermé */ }
          try { if (un2) un2(); } catch (error) { /* déjà fermé */ }
        };
      }
    } catch (error) { /* temps réel indisponible : loadTrades suffit */ }
  }

  async function applyMyHalf(trade) {
    const uid = currentUser.uid;
    const applied = { ...(trade.applied || {}), [uid]: true };
    const ids = collectionIds();
    const removeOne = (id) => {
      const i = ids.indexOf(id);
      if (i >= 0) ids.splice(i, 1);
    };
    const addOne = (id) => {
      if (cardsDatabase.some((c) => c.id === id)) ids.push(id);
    };

    if (trade.price > 0) {
      if (trade.fromUid === uid) {
        // Je suis l'acheteur : je paie et je reçois la carte.
        if (state.coins < trade.price) {
          await updateTrade(trade.id, { status: 'declined', applied });
          showToast('Échange refusé : pièces insuffisantes.');
          return;
        }
        addOne(trade.receiveId);
        state.collection = ids.map((id) => cardsDatabase.find((c) => c.id === id)).filter(Boolean);
        addCoins(-trade.price);
      } else {
        // Je suis le vendeur : je donne la carte et je reçois les pièces.
        if (!ids.includes(trade.receiveId)) {
          await updateTrade(trade.id, { status: 'declined', applied });
          showToast('Échange refusé : tu n’as plus cette carte.');
          return;
        }
        removeOne(trade.receiveId);
        state.collection = ids.map((id) => cardsDatabase.find((c) => c.id === id)).filter(Boolean);
        addCoins(trade.price);
      }
    } else {
      // Échange : je donne giveId, je reçois receiveId.
      if (!ids.includes(trade.giveId)) {
        await updateTrade(trade.id, { status: 'declined', applied });
        showToast('Échange refusé : tu n’as plus cette carte.');
        return;
      }
      removeOne(trade.giveId);
      addOne(trade.receiveId);
      state.collection = ids.map((id) => cardsDatabase.find((c) => c.id === id)).filter(Boolean);
      save();
    }
    saveProfileSoon();
    renderCollection();
    const done = Object.keys(applied).length >= 2;
    await updateTrade(trade.id, { applied, status: done ? 'done' : 'accepted' });
    trade.applied = applied;
    trade.status = done ? 'done' : 'accepted';
    showToast('Échange terminé !');
  }

  async function acceptTrade(trade) {
    await updateTrade(trade.id, { status: 'accepted' });
    trade.status = 'accepted';
    await applyMyHalf(trade);
    renderOnline();
  }

  async function declineTrade(trade) {
    await updateTrade(trade.id, { status: 'declined' });
    trade.status = 'declined';
    renderOnline();
  }

  async function cancelTrade(trade) {
    await updateTrade(trade.id, { status: 'cancelled' });
    trade.status = 'cancelled';
    renderOnline();
  }

  function cardName(id) {
    const card = cardsDatabase.find((c) => c.id === id);
    return card ? card.name : 'une carte';
  }

  function tradeText(trade, incoming) {
    const otherUid = incoming ? trade.fromUid : trade.toUid;
    const other = friendProfiles.get(otherUid);
    const who = other ? other.pseudo : 'Ton ami';
    if (trade.price > 0) {
      return incoming
        ? `${who} te vend « ${cardName(trade.receiveId)} » pour ${fmt(trade.price)} 🪙`
        : `Tu achètes « ${cardName(trade.receiveId)} » à ${who} pour ${fmt(trade.price)} 🪙`;
    }
    return incoming
      ? `${who} t’offre « ${cardName(trade.receiveId)} » contre ton « ${cardName(trade.giveId)} »`
      : `Tu proposes ton « ${cardName(trade.giveId)} » contre « ${cardName(trade.receiveId)} » à ${who}`;
  }

  function renderTrades() {
    if (!tradesIn || !tradesOut) return;
    const uid = currentUser && currentUser.uid;
    // Profils des autres joueurs inconnus : on les charge puis on rafraîchit.
    trades.forEach((t) => {
      const other = t.toUid === uid ? t.fromUid : t.toUid;
      if (other && !friendProfiles.has(other)) {
        fetchFriendProfile(other).then(() => {
          if (app.dataset.tab === 'online') renderOnline();
        });
      }
    });
    const incoming = trades.filter((t) => t.toUid === uid && (t.status === 'pending' || t.status === 'accepted'));
    const outgoing = trades.filter((t) => t.fromUid === uid && (t.status === 'pending' || t.status === 'accepted'));
    const build = (list, isIncoming) => {
      if (!list.length) {
        return [el('p', 'online-empty', isIncoming ? 'Aucune proposition reçue.' : 'Aucune proposition envoyée.')];
      }
      return list.map((trade) => {
        const row = el('div', 'trade-row');
        row.append(el('span', 'trade-text', tradeText(trade, isIncoming)));
        if (trade.status === 'pending') {
          if (isIncoming) {
            const ok = el('button', 'mini-btn primary', 'Accepter');
            ok.type = 'button';
            on(ok, 'click', () => acceptTrade(trade));
            const no = el('button', 'mini-btn danger', 'Refuser');
            no.type = 'button';
            on(no, 'click', () => declineTrade(trade));
            row.append(ok, no);
          } else {
            const cancel = el('button', 'mini-btn', 'Annuler');
            cancel.type = 'button';
            on(cancel, 'click', () => cancelTrade(trade));
            row.append(cancel);
          }
        } else {
          row.append(el('span', 'trade-status', 'En attente de l’autre joueur…'));
        }
        return row;
      });
    };
    tradesIn.replaceChildren(...build(incoming, true));
    tradesOut.replaceChildren(...build(outgoing, false));
  }

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

  function boot() {
    // Sans ces deux éléments, la page n'est pas celle attendue (ancien HTML en
    // cache, bloc supprimé…) : on l'explique au lieu de planter en silence.
    if (!app || !googleSignIn) {
      reportStartupProblem('La page Refs Cards est incomplète : recharge-la avec Ctrl+Maj+R (ou vide le cache du navigateur).');
      return;
    }
    updateCoins();
    renderFilters();
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
