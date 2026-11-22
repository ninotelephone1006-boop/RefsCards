/* ==========================================================================
   Refs Cards — logique de jeu
   Découpe au doigt/souris · pile de cartes · révélations par rareté ·
   bruitages Web Audio · butin · demande de fusion.
   ========================================================================== */
(() => {
  'use strict';

  const PACK_PRICE = 100;
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
  const gapGlow = pack.querySelector('.gap-glow');
  const gapCards = pack.querySelector('.gap-cards');
  const packSave = pack.querySelector('.pack-and-save');
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
  const buyLabel = buyBtn.querySelector('.buy-label');
  const fusionLater = $('fusion-later');
  const fusionDesc = $('fusion-desc');
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
  const accountAvatar = $('account-avatar');
  const accountEmail = $('account-email');
  const logoutBtn = $('logout-btn');
  const gameRegions = document.querySelectorAll('.hud, #stage, #tabbar, .toast');

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
    firstPack: true
  };

  /* --------------------------------------------------------------- comptes */

  function updateCoins(delta) {
    coinsEl.textContent = fmt(state.coins);
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

  /* --------------------------------------------------------------- tirage */

  function pickCard(forcedRarity) {
    const available = Object.keys(RARITIES).filter((r) => cardsDatabase.some((c) => c.rarity === r));
    if (!available.length) return null;
    let rarity = forcedRarity;
    if (!rarity || !available.includes(rarity)) {
      // Tirage pondéré : chaque rareté garde exactement son pourcentage annoncé,
      // puis la carte est tirée au hasard à l'intérieur de la rareté.
      const total = available.reduce((sum, r) => sum + RARITIES[r].weight, 0);
      let roll = Math.random() * total;
      rarity = available[available.length - 1];
      for (const r of available) {
        if ((roll -= RARITIES[r].weight) < 0) {
          rarity = r;
          break;
        }
      }
    }
    const pool = cardsDatabase.filter((c) => c.rarity === rarity);
    return pool[Math.floor(Math.random() * pool.length)];
  }

  function drawPack() {
    const drawn = [];
    const params = new URLSearchParams(window.location.search);
    const wantsDemo = params.get('demo') === '1' || sessionStorage.getItem('refs-demo') === '1';
    if (wantsDemo && typeof demoDraw !== 'undefined') {
      sessionStorage.setItem('refs-demo', '1');
      demoDraw.slice(0, CARD_COUNT).forEach((id) => {
        const found = cardsDatabase.find((c) => c.id === id);
        if (found) drawn.push(found);
      });
    }
    while (drawn.length < CARD_COUNT) {
      const card = pickCard();
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
    gapGlow.style.opacity = tearP > 0.02 ? String(Math.min(1, tearP * 1.8)) : '0';
    gapGlow.style.transform = `scaleX(${tearP})`;
    gapCards.style.opacity = tearP > 0.32 ? '1' : '0';
    gapCards.style.transform = `translateY(${(6 - tearP * 14).toFixed(1)}px)`;
    packSave.style.opacity = String(clamp(1 - tearP * 2.4, 0, 1));
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

  function onDragStart(e) {
    if (state.phase !== 'pack' || drag) return;
    SFX.unlock();
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

  packArea.addEventListener('pointerdown', onDragStart);
  packArea.addEventListener('pointermove', (e) => {
    if (drag || state.phase !== 'pack' || reduceMotion.matches) return;
    const r = packArea.getBoundingClientRect();
    const x = clamp((e.clientX - r.left) / r.width, 0, 1) - 0.5;
    const y = clamp((e.clientY - r.top) / r.height, 0, 1) - 0.5;
    packFloat.style.setProperty('--py', `${(x * 16).toFixed(1)}deg`);
    packFloat.style.setProperty('--px', `${(-y * 12).toFixed(1)}deg`);
  });
  packArea.addEventListener('pointerleave', () => {
    packFloat.style.setProperty('--py', '0deg');
    packFloat.style.setProperty('--px', '0deg');
  });
  pack.addEventListener('contextmenu', (e) => e.preventDefault());
  pack.addEventListener('keydown', (e) => {
    if (state.phase !== 'pack') return;
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      autoTear();
    } else if (e.key === 'ArrowRight') {
      e.preventDefault();
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
  pack.addEventListener('keyup', (e) => {
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
      img.addEventListener('load', () => frame.classList.add('has-img'), { once: true });
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
    btn.addEventListener('click', () => {
      if (!btn.classList.contains('is-top') || btn.classList.contains('is-flying')) return;
      if (!btn.classList.contains('is-revealed')) revealCard(btn, card);
      else if (btn.classList.contains('is-flipped') && performance.now() - Number(btn.dataset.flipAt || 0) > 650) {
        sendToRecap(btn, card);
      }
    });

    // Parallaxe : une seule mise à jour de style par frame.
    let tiltRaf = 0;
    let tiltEv = null;
    btn.addEventListener('pointermove', (e) => {
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

    btn.addEventListener('keydown', (event) => {
      if (event.key === 'Enter' && btn.classList.contains('is-flipped') && event.shiftKey) {
        event.preventDefault();
        event.stopPropagation();
        openInspect(card);
      }
    });

    btn.addEventListener('pointerleave', () => {
      delete btn.dataset.hovered;
      btn.style.setProperty('--rx', '0deg');
      btn.style.setProperty('--ry', '0deg');
    });

    btn.addEventListener('pointerenter', () => {
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

  inspectX.addEventListener('click', closeInspect);
  inspectBackdrop.addEventListener('click', closeInspect);

  /* ----------------------------------------------------------- vers le butin */

  let flying = false;

  nextCard.addEventListener('click', () => {
    if (state.phase !== 'reveal' || !current || flying) return;
    if (!current.node.classList.contains('is-flipped')) return;
    sendToRecap(current.node, current.data);
  });

  tableEl.addEventListener('click', (event) => {
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
    state.deck = drawPack();
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
      buyBtn.hidden = false;
      buyBtn.disabled = false;
      buyBtn.classList.remove('is-denied');
      buyLabel.textContent = state.firstPack ? 'PREMIER BOOSTER OFFERT' : 'OUVRIR UN BOOSTER';
      if (state.firstPack) buyBtn.classList.add('is-free');
      else buyBtn.classList.remove('is-free');
      buyBtn.querySelector('.buy-price').innerHTML = state.firstPack
        ? '<span class="free-tag">OFFERT</span>'
        : '<span class="coin-glyph" aria-hidden="true">🪙</span>100';
      if (state.firstPack) buyBtn.disabled = false;
      else if (state.coins < PACK_PRICE) {
        buyBtn.disabled = true;
        recapMsg.textContent = `Il te manque ${fmt(PACK_PRICE - state.coins)} 🪙 pour un nouveau booster.`;
      } else {
        recapMsg.textContent = '';
      }
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

  /* --------------------------------------------------------------- achat */

  function buyPack() {
    SFX.unlock();
    if (state.phase !== 'done') return;
    if (state.firstPack) {
      SFX.chaChing();
      state.firstPack = false;
      save();
      resetToPack();
      return;
    }
    if (state.coins < PACK_PRICE) {
      SFX.snap();
      recapMsg.textContent = `Pas assez de pièces : il te manque ${fmt(PACK_PRICE - state.coins)} 🪙.`;
      buyBtn.classList.remove('is-denied');
      void buyBtn.offsetWidth;
      buyBtn.classList.add('is-denied');
      return;
    }
    SFX.chaChing();
    addCoins(-PACK_PRICE);
    state.firstPack = false;
      save();
    resetToPack();
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
    showToast('Nouveau booster ! Glisse vers la droite pour déchirer.', 2800);
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
  }

  function openFusion(auto = false) {
    if (state.fusionOpen || state.phase !== 'done') return;
    if (auto && app.dataset.tab !== 'pack') return;
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
        fusionBuy.textContent = state.firstPack || state.coins >= PACK_PRICE ? 'OUVRIR UN BOOSTER' : `OUVRIR UN BOOSTER · 100 🪙`;
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
      row.addEventListener('click', () => {
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

    const dlg = fusion.querySelector('.fusion-dialog');
    dlg.classList.remove('is-fusing');
    void dlg.offsetWidth;
    dlg.classList.add('is-fusing');
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

  fusionGo.addEventListener('click', doFusion);
  fusionLater.addEventListener('click', closeFusion);
  $('fusion-x').addEventListener('click', closeFusion);
  fusionBuy.addEventListener('click', () => {
    closeFusion();
    window.setTimeout(buyPack, 180);
  });
  $('fusion-backdrop').addEventListener('click', closeFusion);
  fusionChip.addEventListener('click', () => openFusion(false));

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
    if (app.dataset.tab !== 'pack' || state.phase !== 'reveal' || state.fusionOpen || !current) return;
    if (e.key !== 'Enter' && e.key !== ' ') return;
    if (document.activeElement === buyBtn || document.activeElement === fusionChip || document.activeElement === recapToggle) return;
    e.preventDefault();
    SFX.unlock();
    if (!current.node.classList.contains('is-revealed')) revealCard(current.node, current.data);
    else if (current.node.classList.contains('is-flipped')) sendToRecap(current.node, current.data);
  });

  /* --------------------------------------------------------------- boutons */

  buyBtn.addEventListener('click', buyPack);
  recapToggle.addEventListener('click', () => {
    const collapsed = !recap.classList.contains('is-collapsed');
    setRecapCollapsed(collapsed);
    SFX.tick();
  });
  buyBtn.addEventListener('pointerenter', () => SFX.tick());

  soundBtn.addEventListener('click', () => {
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
  recapSlots.addEventListener('click', (event) => {
    const slot = event.target.closest('.slot');
    if (!slot || !slot.dataset.cardId) return;
    openInspect(cardById(slot.dataset.cardId));
  });

  recapSlots.addEventListener('keydown', (event) => {
    if (event.key !== 'Enter' && event.key !== ' ') return;
    const slot = event.target.closest('.slot');
    if (!slot || !slot.dataset.cardId) return;
    event.preventDefault();
    openInspect(cardById(slot.dataset.cardId));
  });

  /* Probabilités : générées depuis RARITIES pour rester toujours justes. */
  function renderOdds() {
    if (!packOdds) return;
    packOdds.replaceChildren();
    Object.entries(RARITIES).forEach(([key, r]) => {
      const row = el('span', `odds odds-${key}`);
      const dot = el('i');
      dot.style.background = r.color;
      dot.style.boxShadow = `0 0 6px ${r.glow}`;
      row.append(dot, document.createTextNode(`${r.label} ${String(r.weight).replace('.', ',')} %`));
      packOdds.append(row);
    });
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

  function setAuthError(message) {
    authError.textContent = message || '';
    authError.hidden = !message;
  }

  function authErrorMessage(error) {
    const messages = {
      'auth/popup-closed-by-user': 'Connexion annulée : la fenêtre Google a été fermée avant la fin.',
      'auth/cancelled-popup-request': 'Une autre fenêtre de connexion est déjà ouverte.',
      'auth/popup-blocked': 'Le navigateur a bloqué la fenêtre de connexion. Autorise les pop-ups pour ce site, puis réessaie.',
      'auth/network-request-failed': 'Connexion impossible. Vérifie ta connexion internet.',
      'auth/unauthorized-domain': 'Ce domaine n’est pas autorisé. Ajoute-le dans Firebase → Authentication → Settings → Authorized domains.',
      'auth/operation-not-allowed': 'La connexion Google n’est pas activée dans Firebase Authentication (Sign-in method → Google).',
      'permission-denied': 'Accès cloud refusé. Vérifie les règles Firestore publiées (playerSaves/{userId}).'
    };
    return messages[error && error.code] || (error && error.message) || 'Une erreur est survenue. Réessaie.';
  }

  function applySave(d) {
    state.coins = Math.max(0, Number(d && d.coins) || 0);
    state.firstPack = !d || d.firstPack !== false;
    state.collection = ((d && d.collection) || [])
      .map((id) => cardsDatabase.find((c) => c.id === id))
      .filter(Boolean);
    state.phase = 'pack';
    state.deck = [];
    state.loot = [];
    state.packIndex = 0;
    updateCoins();
    renderCollection();
  }

  async function saveNow() {
    if (!currentUser || !cloudDb) return true;
    clearTimeout(saveTimer);
    const userId = currentUser.uid;
    try {
      await cloudDb.collection('playerSaves').doc(userId).set({
        coins: state.coins,
        firstPack: state.firstPack,
        collection: state.collection.map((c) => c.id),
        updatedAt: firebase.firestore.FieldValue.serverTimestamp()
      }, { merge: true });
      return true;
    } catch (error) {
      console.warn('Sauvegarde cloud impossible:', error);
      showToast('Sauvegarde impossible pour le moment. Vérifie ta connexion.');
      return false;
    }
  }

  function save() {
    if (!currentUser || !cloudDb) return;
    clearTimeout(saveTimer);
    saveTimer = window.setTimeout(() => { saveNow(); }, 250);
  }

  function showGame(user, saveData) {
    currentUser = user;
    currentEmail = user.email || '';
    const displayName = user.displayName || currentEmail || 'Joueur';
    accountEmail.textContent = displayName;
    accountEmail.title = currentEmail || displayName;
    if (user.photoURL) {
      accountAvatar.src = user.photoURL;
      accountAvatar.alt = `Photo de profil de ${displayName}`;
      accountAvatar.hidden = false;
    } else {
      accountAvatar.removeAttribute('src');
      accountAvatar.hidden = true;
    }
    applySave(saveData);
    authScreen.hidden = true;
    gameRegions.forEach((region) => region.removeAttribute('inert'));
    app.classList.add('is-authenticated');
    setAuthError('');
    setTab('pack');
  }

  function showAuth() {
    clearTimeout(saveTimer);
    currentUser = null;
    currentEmail = '';
    accountEmail.textContent = '';
    accountEmail.removeAttribute('title');
    accountAvatar.removeAttribute('src');
    accountAvatar.hidden = true;
    app.classList.remove('is-authenticated');
    gameRegions.forEach((region) => region.setAttribute('inert', ''));
    authScreen.hidden = false;
    googleSignIn.disabled = !firebaseAuth;
  }

  googleSignIn.addEventListener('click', async () => {
    if (!firebaseAuth) {
      setAuthError('Le service de comptes cloud n’est pas configuré. Consulte la section Firebase du README.');
      return;
    }
    googleSignIn.disabled = true;
    setAuthError('');
    try {
      const provider = new firebase.auth.GoogleAuthProvider();
      provider.setCustomParameters({ prompt: 'select_account' });
      // GoogleAuthProvider + signInWithPopup : la connexion se fait dans la fenêtre Google.
      await firebaseAuth.signInWithPopup(provider);
      // onAuthStateChanged prend le relais : chargement de la sauvegarde + affichage du jeu.
    } catch (error) {
      setAuthError(authErrorMessage(error));
    } finally {
      googleSignIn.disabled = false;
    }
  });

  logoutBtn.addEventListener('click', async () => {
    if (!await saveNow()) return;
    try { await firebaseAuth.signOut(); }
    catch (error) { showToast(authErrorMessage(error)); }
  });

  function initializeCloud() {
    const config = window.REFS_FIREBASE_CONFIG;
    const configured = config && config.apiKey && config.projectId && config.appId &&
      !Object.values(config).some((value) => typeof value === 'string' && value.includes('REMPLACE_PAR'));
    if (!window.firebase || !configured) {
      googleSignIn.disabled = true;
      setAuthError('Le compte cloud n’est pas encore configuré. Suis les étapes Firebase du README, puis recharge cette page.');
      return;
    }
    try {
      if (!firebase.apps.length) firebase.initializeApp(config);
      firebaseAuth = firebase.auth();
      cloudDb = firebase.firestore();
      googleSignIn.disabled = false;
      firebaseAuth.onAuthStateChanged(async (user) => {
        if (!user) {
          if (currentUser) showAuth();
          return;
        }
        currentUser = user;
        try {
          const snapshot = await cloudDb.collection('playerSaves').doc(user.uid).get();
          if (!currentUser || currentUser.uid !== user.uid) return;
          showGame(user, snapshot.exists ? snapshot.data() : null);
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
      googleSignIn.disabled = true;
      setAuthError(`Configuration Firebase invalide : ${error.message}`);
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
      : state.phase === 'reveal' || state.phase === 'done' ? revealView : packView;
    view.classList.remove('view-in');
    void view.offsetWidth;
    view.classList.add('view-in');
    if (tab === 'collection') {
      renderCollection();
      fresh.clear();
      tabBadge.hidden = true;
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
      t.addEventListener('click', () => openInspect(card));
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

  tabs.forEach((t) => t.addEventListener('click', () => setTab(t.dataset.tab)));
  collFilters.addEventListener('click', (e) => {
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

  /* Inspection : la carte suit le doigt / la souris (tilt + reflet holographique). */
  let inspRaf = 0;
  let inspEv = null;
  function resetInspTilt() {
    const s = inspectCard.style;
    s.setProperty('--rx', '0deg');
    s.setProperty('--ry', '0deg');
    ['--mx', '--my', '--sx', '--sy'].forEach((p) => s.setProperty(p, '50%'));
  }
  inspectCard.addEventListener('pointermove', (e) => {
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
  inspectCard.addEventListener('pointerleave', resetInspTilt);
  inspectCard.addEventListener('pointercancel', resetInspTilt);

  function boot() {
    updateCoins();
    renderFilters();
    renderOdds();
    FX.resize();
    Dust.resize();
    Dust.start();
    resetTear();
    recap.classList.add('is-idle');
    sizeStage();
    scheduleSizing(6);
    if (new URLSearchParams(window.location.search).get('demo') === '1') {
      sessionStorage.setItem('refs-demo', '1');
      showToast('Mode démo : un aperçu des raretés.', 2600);
    }
    if (!cardsDatabase.length) {
      showToast('Ajoute des cartes dans cards.js pour commencer.');
    }
  }

  boot();
  initializeCloud();
})();
