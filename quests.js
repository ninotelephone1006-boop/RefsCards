/* ==========================================================================
   Refs Cards — quêtes, succès et niveaux (données pures, sans DOM)

   Chargement : script classique avant app.js (index.html). Expose l'objet
   global `RefsQuests` lu par app.js ; les tests jsdom le chargent aussi.

   - `QUESTS` : 20 quêtes jouées DANS L'ORDRE. Chaque quête pose un objectif
     (`metric` + `target`) et une récompense (`coins`, `xp`). Tant qu'une
     quête n'est pas réclamée, la suivante reste verrouillée : app.js ne
     montre que les quêtes terminées et la quête en cours.
   - `ACHIEVEMENTS` : 30 succès, libres (non séquentiels). Ils se débloquent
     automatiquement dès que leur condition est remplie.
   - Progression : les quêtes sont mesurées sur des compteurs CUMULÉS
     (boosters ouverts, fusions…). Pour qu'un joueur qui a déjà beaucoup joué
     ne retrouve pas toutes ses quêtes déjà faites, app.js fige un « baseline »
     (valeur des compteurs au déploiement du système) et la progression compte
     depuis cette base. Les succès, eux, restent des accomplissements absolus.
   ========================================================================== */
const RefsQuests = (() => {
  'use strict';

  /* Métriques mesurables. app.js construit un objet `ctx` qui porte ces clés
     (valeurs numériques) ; quests.js ne fait que les lire. */
  const METRICS = [
    'packsOpened',   // boosters ouverts
    'packsBought',   // packs achetés dans le Shop
    'freePacks',     // packs gratuits quotidiens récupérés
    'fusions',       // fusions réalisées
    'marketSales',   // ventes du marché récupérées (paiement encaissé)
    'marketEarned',  // pièces cumulées gagnées grâce aux ventes
    'marketBuys',    // achats sur le marché
    'friends',       // amis (demandes acceptées)
    'unique',        // cartes différentes possédées
    'total',         // exemplaires possédés
    'rarePlus',      // exemplaires de rareté Rare ou plus
    'epicPlus',      // exemplaires de rareté Épique ou plus
    'legendaryPlus', // exemplaires de rareté Légendaire ou plus
    'shiny',         // cartes shiny / mutées
    'questsDone',    // quêtes réclamées
    'level',         // niveau actuel
    'coins'          // solde de pièces
  ];

  const METRIC_LABELS = {
    packsOpened: 'booster(s) ouvert(s)',
    packsBought: 'pack(s) acheté(s)',
    freePacks: 'pack(s) gratuit(s) récupéré(s)',
    fusions: 'fusion(s)',
    marketSales: 'vente(s) encaissée(s)',
    marketEarned: 'pièces gagnées en vendant',
    marketBuys: 'achat(s) sur le marché',
    friends: 'ami(s)',
    unique: 'carte(s) différente(s)',
    total: 'carte(s) en tout',
    rarePlus: 'carte(s) Rare ou plus',
    epicPlus: 'carte(s) Épique ou plus',
    legendaryPlus: 'carte(s) Légendaire ou plus',
    shiny: 'carte(s) shiny',
    questsDone: 'quête(s) terminée(s)',
    level: 'niveau(x)',
    coins: 'pièce(s) en poche'
  };

  /* ------------------------------------------------------------- les 20 quêtes
     Ordre croissant de difficulté : les premières se bouclent en quelques
     minutes, les dernières demandent une vraie collection (et donc de
     fusionner, vendre, ouvrir beaucoup de boosters). */
  const QUESTS = [
    {
      id: 'q01', icon: '🎯', title: 'Premier déchir',
      desc: 'Ouvre ton tout premier booster.',
      metric: 'packsOpened', target: 1, reward: { coins: 100, xp: 50 }
    },
    {
      id: 'q02', icon: '🃏', title: 'Petite collection',
      desc: 'Possède 5 cartes différentes.',
      metric: 'unique', target: 5, reward: { coins: 150, xp: 60 }
    },
    {
      id: 'q03', icon: '🎁', title: 'Le gratuit d’abord',
      desc: 'Récupère un pack gratuit dans le Shop.',
      metric: 'freePacks', target: 1, reward: { coins: 100, xp: 40 }
    },
    {
      id: 'q04', icon: '⚗️', title: 'Doublon radieux',
      desc: 'Réalise une fusion pour obtenir une carte de rareté supérieure.',
      metric: 'fusions', target: 1, reward: { coins: 200, xp: 80 }
    },
    {
      id: 'q05', icon: '📦', title: 'Rythme régulier',
      desc: 'Ouvre 5 boosters.',
      metric: 'packsOpened', target: 5, reward: { coins: 250, xp: 100 }
    },
    {
      id: 'q06', icon: '🛒', title: 'Premier achat',
      desc: 'Achète un pack dans le Shop.',
      metric: 'packsBought', target: 1, reward: { coins: 150, xp: 70 }
    },
    {
      id: 'q07', icon: '🔵', title: 'Chasseur de rareté',
      desc: 'Possède 3 cartes Rares ou plus.',
      metric: 'rarePlus', target: 3, reward: { coins: 300, xp: 120 }
    },
    {
      id: 'q08', icon: '👥', title: 'Premier contact',
      desc: 'Ajoute un ami (sa demande doit être acceptée).',
      metric: 'friends', target: 1, reward: { coins: 200, xp: 90 }
    },
    {
      id: 'q09', icon: '📚', title: 'Belle collection',
      desc: 'Possède 10 cartes différentes.',
      metric: 'unique', target: 10, reward: { coins: 350, xp: 140 }
    },
    {
      id: 'q10', icon: '🏷️', title: 'Marchand des rues',
      desc: 'Vends une carte sur le marché et récupère ton paiement.',
      metric: 'marketSales', target: 1, reward: { coins: 250, xp: 110 }
    },
    {
      id: 'q11', icon: '🗂️', title: 'Collectionneur confirmé',
      desc: 'Possède 15 cartes différentes.',
      metric: 'unique', target: 15, reward: { coins: 400, xp: 160 }
    },
    {
      id: 'q12', icon: '🟣', title: 'Épique !',
      desc: 'Possède 2 cartes Épiques ou plus.',
      metric: 'epicPlus', target: 2, reward: { coins: 500, xp: 200 }
    },
    {
      id: 'q13', icon: '🧪', title: 'Alchimiste',
      desc: 'Réalise 5 fusions.',
      metric: 'fusions', target: 5, reward: { coins: 400, xp: 180 }
    },
    {
      id: 'q14', icon: '📦', title: 'Ouverture intensive',
      desc: 'Ouvre 15 boosters.',
      metric: 'packsOpened', target: 15, reward: { coins: 600, xp: 240 }
    },
    {
      id: 'q15', icon: '🤝', title: 'Popularité',
      desc: 'Aie 3 amis.',
      metric: 'friends', target: 3, reward: { coins: 300, xp: 150 }
    },
    {
      id: 'q16', icon: '🛍️', title: 'Grossiste',
      desc: 'Achète 10 packs dans le Shop.',
      metric: 'packsBought', target: 10, reward: { coins: 500, xp: 200 }
    },
    {
      id: 'q17', icon: '👑', title: 'Légende vivante',
      desc: 'Possède une carte Légendaire ou plus.',
      metric: 'legendaryPlus', target: 1, reward: { coins: 800, xp: 300 }
    },
    {
      id: 'q18', icon: '💼', title: 'L’homme d’affaires',
      desc: 'Gagne 2 000 pièces grâce à tes ventes du marché.',
      metric: 'marketEarned', target: 2000, reward: { coins: 500, xp: 250 }
    },
    {
      id: 'q19', icon: '🏆', title: 'Complétionniste',
      desc: 'Possède 25 cartes différentes.',
      metric: 'unique', target: 25, reward: { coins: 750, xp: 350 }
    },
    {
      id: 'q20', icon: '🌟', title: 'Maître des cartes',
      desc: 'Ouvre 30 boosters.',
      metric: 'packsOpened', target: 30, reward: { coins: 1500, xp: 500 }
    }
  ];

  /* ------------------------------------------------------------ les 30 succès
     Non séquentiels : chacun se débloquera dès que sa condition sera vraie,
     y compris rétroactivement pour un joueur qui a déjà beaucoup progressé. */
  const ACHIEVEMENTS = [
    { id: 'a01', icon: '🎯', title: 'Premier déchir', desc: 'Ouvre ton premier booster.', metric: 'packsOpened', target: 1, xp: 50 },
    { id: 'a02', icon: '🃏', title: 'Apprenti collectionneur', desc: 'Possède 5 cartes différentes.', metric: 'unique', target: 5, xp: 60 },
    { id: 'a03', icon: '📚', title: 'Collectionneur', desc: 'Possède 15 cartes différentes.', metric: 'unique', target: 15, xp: 120 },
    { id: 'a04', icon: '🏛️', title: 'Complétionniste', desc: 'Possède 30 cartes différentes.', metric: 'unique', target: 30, xp: 250 },
    { id: 'a05', icon: '⚗️', title: 'Doublon radieux', desc: 'Réalise ta première fusion.', metric: 'fusions', target: 1, xp: 80 },
    { id: 'a06', icon: '🧪', title: 'Alchimiste', desc: 'Réalise 5 fusions.', metric: 'fusions', target: 5, xp: 150 },
    { id: 'a07', icon: '⚗️', title: 'Fusion master', desc: 'Réalise 15 fusions.', metric: 'fusions', target: 15, xp: 300 },
    { id: 'a08', icon: '🛒', title: 'Client', desc: 'Achète ton premier pack.', metric: 'packsBought', target: 1, xp: 50 },
    { id: 'a09', icon: '🛍️', title: 'Accro au shopping', desc: 'Achète 10 packs.', metric: 'packsBought', target: 10, xp: 150 },
    { id: 'a10', icon: '🏬', title: 'Grossiste', desc: 'Achète 25 packs.', metric: 'packsBought', target: 25, xp: 300 },
    { id: 'a11', icon: '🎁', title: 'Quotidien', desc: 'Récupère 3 packs gratuits.', metric: 'freePacks', target: 3, xp: 60 },
    { id: 'a12', icon: '📅', title: 'Fidèle au rendez-vous', desc: 'Récupère 10 packs gratuits.', metric: 'freePacks', target: 10, xp: 150 },
    { id: 'a13', icon: '👋', title: 'Premier ami', desc: 'Ajoute ton premier ami.', metric: 'friends', target: 1, xp: 50 },
    { id: 'a14', icon: '👥', title: 'Sociable', desc: 'Aie 3 amis.', metric: 'friends', target: 3, xp: 100 },
    { id: 'a15', icon: '🌟', title: 'Star du jeu', desc: 'Aie 5 amis.', metric: 'friends', target: 5, xp: 200 },
    { id: 'a16', icon: '🏷️', title: 'Marchand', desc: 'Encaisse ta première vente.', metric: 'marketSales', target: 1, xp: 80 },
    { id: 'a17', icon: '💱', title: 'Commercial', desc: 'Encaisse 5 ventes.', metric: 'marketSales', target: 5, xp: 150 },
    { id: 'a18', icon: '💰', title: 'Magnat', desc: 'Encaisse 10 ventes.', metric: 'marketSales', target: 10, xp: 300 },
    { id: 'a19', icon: '🪙', title: 'Affluent', desc: 'Gagne 5 000 pièces avec tes ventes.', metric: 'marketEarned', target: 5000, xp: 250 },
    { id: 'a20', icon: '🛒', title: 'Acheteur', desc: 'Achète ta première carte sur le marché.', metric: 'marketBuys', target: 1, xp: 50 },
    { id: 'a21', icon: '🤑', title: 'Connaisseur', desc: 'Achète 5 cartes sur le marché.', metric: 'marketBuys', target: 5, xp: 150 },
    { id: 'a22', icon: '🔵', title: 'Raretés', desc: 'Possède 3 cartes Rares ou plus.', metric: 'rarePlus', target: 3, xp: 80 },
    { id: 'a23', icon: '🟣', title: 'Épique', desc: 'Possède 2 cartes Épiques ou plus.', metric: 'epicPlus', target: 2, xp: 150 },
    { id: 'a24', icon: '👑', title: 'Légende', desc: 'Possède une carte Légendaire ou plus.', metric: 'legendaryPlus', target: 1, xp: 300 },
    { id: 'a25', icon: '✦', title: 'Shiny !', desc: 'Obtiens une carte shiny.', metric: 'shiny', target: 1, xp: 200 },
    { id: 'a26', icon: '⭐', title: 'Niveau 2', desc: 'Atteins le niveau 2.', metric: 'level', target: 2, xp: 50 },
    { id: 'a27', icon: '⭐', title: 'Niveau 5', desc: 'Atteins le niveau 5.', metric: 'level', target: 5, xp: 150 },
    { id: 'a28', icon: '🌟', title: 'Niveau 10', desc: 'Atteins le niveau 10.', metric: 'level', target: 10, xp: 400 },
    { id: 'a29', icon: '🗺️', title: 'Baroudeur', desc: 'Termine 5 quêtes.', metric: 'questsDone', target: 5, xp: 150 },
    { id: 'a30', icon: '🏆', title: 'Maître des quêtes', desc: 'Termine les 20 quêtes.', metric: 'questsDone', target: 20, xp: 500 }
  ];

  /* Niveaux : le passage au niveau n coûte 100 × n XP. xpForLevel(n) renvoie
     l'XP cumulée pour ATTEINDRE le niveau n (0 pour le niveau 1). */
  function xpForLevel(level) {
    const n = Math.max(1, Math.floor(Number(level) || 1));
    return 50 * n * (n - 1);
  }

  /* Décompose l'XP cumulée : niveau atteint, XP dans le niveau, XP avant le
     suivant. Ex. 250 XP → niveau 2, 150 / 200. */
  function levelFromXp(xp) {
    let level = 1;
    let rest = Math.max(0, Math.floor(Number(xp) || 0));
    while (rest >= 100 * level) {
      rest -= 100 * level;
      level += 1;
    }
    return { level, into: rest, needed: 100 * level };
  }

  function metricValue(metric, ctx) {
    const v = ctx && Object.prototype.hasOwnProperty.call(ctx, metric) ? ctx[metric] : 0;
    return Math.max(0, Math.floor(Number(v) || 0));
  }

  function metricLabel(metric) {
    return METRIC_LABELS[metric] || metric;
  }

  /* Progression d'une quête : valeur mesurée MOINS la base figée au
     déploiement (baseline). `done` = objectif atteint (récompense réclamable). */
  function questProgress(quest, ctx, baseline) {
    const raw = metricValue(quest.metric, ctx);
    const base = metricValue(quest.metric, baseline || {});
    const target = Math.max(1, Math.floor(Number(quest.target) || 1));
    const value = Math.max(0, Math.min(raw - base, target));
    return { value, target, done: raw - base >= target };
  }

  /* Progression d'un succès : valeur absolue (pas de baseline). */
  function achievementProgress(achievement, ctx) {
    const target = Math.max(1, Math.floor(Number(achievement.target) || 1));
    const value = Math.min(metricValue(achievement.metric, ctx), target);
    return { value, target, done: value >= target };
  }

  return {
    METRICS,
    METRIC_LABELS,
    QUESTS,
    ACHIEVEMENTS,
    xpForLevel,
    levelFromXp,
    metricValue,
    metricLabel,
    questProgress,
    achievementProgress
  };
})();
