(() => {
  'use strict';
  const PACK_PRICE = 100;
  const CARD_COUNT = 5;
  const rarityInfo = {
    common: { label: 'Commune', weight: 60 },
    rare: { label: 'Rare', weight: 25 },
    epic: { label: 'Épique', weight: 12 },
    legendary: { label: 'Légendaire', weight: 3 }
  };
  let coins = 1000;
  let state = 'ready';
  let revealed = 0;
  const $ = id => document.getElementById(id);
  const pack = $('pack-button');
  const packScene = $('pack-scene');
  const revealScene = $('reveal-scene');
  const cards = $('cards');
  const stage = $('stage');
  const again = $('again-button');
  const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)');

  function updateCoins() { $('coins').textContent = new Intl.NumberFormat('fr-FR').format(coins); }
  function pickCard() {
    // Les raretés sans cartes sont ignorées et leurs chances redistribuées.
    const available = Object.keys(rarityInfo).filter(rarity => cardsDatabase.some(card => card.rarity === rarity));
    const total = available.reduce((sum, rarity) => sum + rarityInfo[rarity].weight, 0);
    let roll = Math.random() * total;
    const rarity = available.find(key => (roll -= rarityInfo[key].weight) < 0) || available[0];
    const pool = cardsDatabase.filter(card => card.rarity === rarity);
    return pool[Math.floor(Math.random() * pool.length)];
  }
  function burst(x, y, color = '#d4ff3f', count = 22) {
    if (reducedMotion.matches) return;
    const container = $('particles');
    for (let i = 0; i < count; i++) {
      const particle = document.createElement('span');
      const angle = Math.random() * Math.PI * 2;
      const distance = 45 + Math.random() * 140;
      particle.className = 'particle';
      particle.style.cssText = `left:${x}px;top:${y}px;--x:${Math.cos(angle) * distance}px;--y:${Math.sin(angle) * distance}px;--particle-color:${color};--duration:${500 + Math.random() * 500}ms`;
      container.appendChild(particle);
      particle.addEventListener('animationend', () => particle.remove(), { once: true });
    }
  }
  function makeCard(data, index) {
    const info = rarityInfo[data.rarity];
    const button = document.createElement('button');
    button.className = `card card-${data.rarity}`;
    button.type = 'button';
    button.style.setProperty('--delay', `${index * 90}ms`);
    button.style.setProperty('--art-color', data.color || '#c9c9c9');
    button.setAttribute('aria-label', `Retourner la carte ${index + 1}`);
    // Les données sont insérées comme texte, jamais comme HTML.
    button.innerHTML = `<span class="card-inner"><span class="card-back"><span class="back-top">REFS CARDS <span>✳</span></span><span class="back-emblem"><span>✳</span></span><span class="back-bottom">UNE SURPRISE T'ATTEND <span>0${index + 1}</span></span></span><span class="card-front"><span class="front-top"><span class="rarity-name"></span><span>✦</span></span><span class="card-art"><span class="card-emoji"></span></span><span class="card-details"><strong class="card-name"></strong><span class="card-description"></span></span><span class="front-bottom"><span>REFS CARDS</span><span>0${index + 1} / 05</span></span></span></span><span class="card-glare"></span>`;
    button.querySelector('.rarity-name').textContent = info.label;
    button.querySelector('.card-name').textContent = data.name;
    button.querySelector('.card-description').textContent = data.description;
    const art = button.querySelector('.card-art');
    if (data.image) {
      const img = document.createElement('img');
      img.src = data.image; img.alt = ''; img.draggable = false;
      img.addEventListener('error', () => { img.remove(); button.querySelector('.card-emoji').textContent = data.emoji || '✦'; });
      art.prepend(img);
    } else button.querySelector('.card-emoji').textContent = data.emoji || '✦';
    button.addEventListener('click', () => {
      if (button.classList.contains('is-flipped')) return;
      button.classList.add('is-flipped');
      button.setAttribute('aria-label', `${data.name}, ${info.label}. ${data.description}`);
      revealed++;
      $('progress-text').textContent = `${revealed} / ${CARD_COUNT} CARTES RÉVÉLÉES`;
      $('progress-bar').style.width = `${revealed / CARD_COUNT * 100}%`;
      if (data.rarity !== 'common') {
        button.classList.add('special-reveal');
        const r = button.getBoundingClientRect(), s = stage.getBoundingClientRect();
        burst(r.left - s.left + r.width / 2, r.top - s.top + r.height / 2, data.rarity === 'rare' ? '#68bfff' : data.rarity === 'epic' ? '#c58aff' : '#ffe171', 14);
      }
      if (revealed === CARD_COUNT) {
        $('reveal-instruction').textContent = 'Bien joué ! Voici tes nouvelles cartes.';
        again.hidden = false;
        if (coins < PACK_PRICE) { again.disabled = true; $('balance-message').textContent = 'Pas assez de pièces pour ouvrir un autre booster.'; }
      }
    });
    button.addEventListener('pointermove', e => {
      if (e.pointerType === 'touch' || reducedMotion.matches) return;
      const rect = button.getBoundingClientRect();
      const x = (e.clientX - rect.left) / rect.width, y = (e.clientY - rect.top) / rect.height;
      button.style.setProperty('--rx', `${(0.5 - y) * 12}deg`);
      button.style.setProperty('--ry', `${(x - 0.5) * 12}deg`);
      button.style.setProperty('--glare-x', `${x * 100}%`);
      button.style.setProperty('--glare-y', `${y * 100}%`);
    });
    button.addEventListener('pointerleave', () => { button.style.setProperty('--rx', '0deg'); button.style.setProperty('--ry', '0deg'); });
    return button;
  }
  function openPack() {
    if (state !== 'ready') return;
    if (!cardsDatabase.some(card => rarityInfo[card.rarity])) {
      packScene.querySelector('.action-hint div span').textContent = 'Ajoute au moins une carte valide dans cards.js.';
      return;
    }
    state = 'opening'; pack.disabled = true; packScene.classList.add('opening');
    window.setTimeout(() => {
      const r = pack.getBoundingClientRect(), s = stage.getBoundingClientRect();
      burst(r.left - s.left + r.width / 2, r.top - s.top + r.height / 2);
      $('flash').classList.add('active');
      cards.replaceChildren();
      for (let i = 0; i < CARD_COUNT; i++) cards.appendChild(makeCard(pickCard(), i));
      packScene.hidden = true; revealScene.hidden = false; state = 'revealing';
      window.setTimeout(() => $('flash').classList.remove('active'), 650);
    }, reducedMotion.matches ? 0 : 750);
  }
  pack.addEventListener('click', openPack);
  let touchStart = null;
  pack.addEventListener('touchstart', e => { touchStart = { x: e.touches[0].clientX, y: e.touches[0].clientY }; }, { passive: true });
  pack.addEventListener('touchend', e => {
    if (!touchStart) return;
    const touch = e.changedTouches[0];
    if (Math.hypot(touch.clientX - touchStart.x, touch.clientY - touchStart.y) > 35) openPack();
    touchStart = null;
  }, { passive: true });
  again.addEventListener('click', () => {
    if (revealed !== CARD_COUNT || coins < PACK_PRICE) return;
    coins -= PACK_PRICE; updateCoins(); revealed = 0; state = 'ready';
    $('progress-text').textContent = `0 / ${CARD_COUNT} CARTES RÉVÉLÉES`;
    $('progress-bar').style.width = '0%'; $('reveal-instruction').textContent = 'Touche chaque carte pour la révéler.';
    $('balance-message').textContent = ''; again.hidden = true; again.disabled = false;
    revealScene.hidden = true; packScene.hidden = false; packScene.classList.remove('opening'); pack.disabled = false;
    pack.focus({ preventScroll: true });
  });
  updateCoins();
})();
