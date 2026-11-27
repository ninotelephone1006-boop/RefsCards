/* ==========================================================================
   Refs Cards — quêtes, succès et niveaux (données pures, sans DOM)

   Chargement : script classique avant app.js (index.html). Expose l'objet
   global `RefsQuests` lu par app.js ; les tests jsdom le chargent aussi.

   - `QUESTS` : quêtes jouées 5 PAR 5 (q01 → q270 générées, plus la quête
     légendaire q271 « Mille boosters »). Chaque quête pose un objectif
     (`metric` + `target`) et une récompense : `coins`, `xp` et/ou `packs`
     (ex. `packs: { rare: 1 }`). Certaines quêtes ne donnent donc PAS de
     pièces : elles offrent de l'XP et des boosters à ouvrir. app.js affiche
     en même temps les 5 premières quêtes pas encore réclamées : le joueur
     choisit l'ordre dans lequel il les fait (et les réclame dans n'importe
     quel ordre). Dès qu'une quête est réclamée, la suivante « pop » pour
     prendre sa place, de sorte qu'il y a toujours 5 quêtes en cours
     (jusqu'à épuisement des 70). Les quêtes au-delà de la fenêtre restent
     invisibles tant qu'elles ne sont pas entrées dans les 5.
   - `ACHIEVEMENTS` : 30 succès, libres (non séquentiels). Ils se débloquent
     automatiquement dès que leur condition est remplie.
   - Progression : les quêtes sont mesurées sur des valeurs À VIE (absolues),
     exactement comme les succès. Le système a été ajouté après coup : tout ce
     que le joueur a déjà fait avant (boosters ouverts, cartes possédées,
     amis, ventes, fusions…) compte donc immédiatement. Un objectif déjà
     atteint est réclamable tout de suite, sans devoir le refaire une seconde
     fois ; les quêtes suivantes se débloquent une par une, à la réclamation.
   ========================================================================== */
const RefsQuests = (() => {
  'use strict';

  /* Métriques mesurables. app.js construit un objet `ctx` qui porte ces clés
     (valeurs numériques) ; quests.js ne fait que les lire. */
  const METRICS = [
    'packsOpened',   // boosters ouverts
    'packsBought',   // packs achetés dans le Shop
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

  /* Nombre de quêtes visibles / faisables en même temps. Quand l'une des 5
     est réclamée, la suivante de la liste pop pour la remplacer. */
  const QUEST_WINDOW = 5;

  /* Types de boosters pouvant être offerts par une quête (clés de
     `state.packStock` dans app.js). */
  const PACK_KEYS = ['classic', 'rare', 'legend', 'video', 'ultra'];

  const PACK_LABELS = {
    classic: 'Pack Classique',
    rare: 'Pack Rare',
    legend: 'Pack Légende',
    video: 'Pack Vidéo',
    ultra: 'Pack Ultra Rare'
  };

  /* ------------------------------------------------------------- les 70 quêtes
     Ordre croissant de difficulté : les premières se bouclent en quelques
     minutes, les dernières demandent une vraie collection (et donc de
     fusionner, vendre, ouvrir beaucoup de boosters). L'ordre ne bloque plus
     : les 5 premières non réclamées sont actives en parallèle, dans n'importe
     quel ordre de réclamation.
     Récompenses : `coins` et `xp` restent facultatifs (`coins: 0` = quête
     sans argent) et `packs` offre des boosters directement dans l'inventaire,
     par exemple `packs: { rare: 1 }`. Une quête peut donc donner uniquement
     de l'XP, uniquement des packs, ou les deux. */
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
    },

    /* ---- Saison 2 : 50 quêtes de plus (q21 → q70). Beaucoup ne paient pas
       en pièces mais en boosters (`packs`), pour varier les récompenses. ---- */
    {
      id: 'q21', icon: '🎁', title: 'Booster offert',
      desc: 'Ouvre 2 boosters.',
      metric: 'packsOpened', target: 2, reward: { coins: 0, xp: 60, packs: { classic: 1 } }
    },
    {
      id: 'q22', icon: '🃏', title: 'Petit tas',
      desc: 'Possède 8 cartes différentes.',
      metric: 'unique', target: 8, reward: { coins: 0, xp: 90, packs: { classic: 1 } }
    },
    {
      id: 'q23', icon: '👥', title: 'Deuxième contact',
      desc: 'Aie 2 amis.',
      metric: 'friends', target: 2, reward: { coins: 0, xp: 110, packs: { classic: 1 } }
    },
    {
      id: 'q24', icon: '⚗️', title: 'Double fusion',
      desc: 'Réalise 2 fusions.',
      metric: 'fusions', target: 2, reward: { coins: 0, xp: 120, packs: { classic: 1 } }
    },
    {
      id: 'q25', icon: '🛒', title: 'Deuxième achat',
      desc: 'Achète 3 packs dans le Shop.',
      metric: 'packsBought', target: 3, reward: { coins: 0, xp: 130, packs: { classic: 1 } }
    },
    {
      id: 'q26', icon: '📦', title: 'Le rythme continue',
      desc: 'Ouvre 7 boosters.',
      metric: 'packsOpened', target: 7, reward: { coins: 0, xp: 150, packs: { rare: 1 } }
    },
    {
      id: 'q27', icon: '🔵', title: 'Trois Rares',
      desc: 'Possède 5 cartes Rares ou plus.',
      metric: 'rarePlus', target: 5, reward: { coins: 0, xp: 170, packs: { rare: 1 } }
    },
    {
      id: 'q28', icon: '🏷️', title: 'Deuxième vente',
      desc: 'Encaisse 2 ventes sur le marché.',
      metric: 'marketSales', target: 2, reward: { coins: 0, xp: 160, packs: { classic: 2 } }
    },
    {
      id: 'q30', icon: '📚', title: 'Douze en tout',
      desc: 'Possède 12 cartes différentes.',
      metric: 'unique', target: 12, reward: { coins: 0, xp: 180, packs: { classic: 2 } }
    },
    {
      id: 'q31', icon: '🎬', title: 'Vidéo amateur',
      desc: 'Ouvre 10 boosters.',
      metric: 'packsOpened', target: 10, reward: { coins: 0, xp: 200, packs: { video: 1 } }
    },
    {
      id: 'q32', icon: '🟣', title: 'Trois Épiques',
      desc: 'Possède 3 cartes Épiques ou plus.',
      metric: 'epicPlus', target: 3, reward: { coins: 0, xp: 220, packs: { rare: 1 } }
    },
    {
      id: 'q33', icon: '🧪', title: 'Fusionneur',
      desc: 'Réalise 8 fusions.',
      metric: 'fusions', target: 8, reward: { coins: 0, xp: 240, packs: { legend: 1 } }
    },
    {
      id: 'q34', icon: '🤝', title: 'Quatre amis',
      desc: 'Aie 4 amis.',
      metric: 'friends', target: 4, reward: { coins: 0, xp: 220, packs: { classic: 2 } }
    },
    {
      id: 'q35', icon: '💼', title: 'Petit commerce',
      desc: 'Gagne 500 pièces grâce à tes ventes.',
      metric: 'marketEarned', target: 500, reward: { coins: 0, xp: 200, packs: { rare: 1 } }
    },
    {
      id: 'q36', icon: '🛍️', title: 'Acheteur régulier',
      desc: 'Achète 6 packs dans le Shop.',
      metric: 'packsBought', target: 6, reward: { coins: 0, xp: 230, packs: { classic: 2 } }
    },
    {
      id: 'q37', icon: '🃏', title: 'Trente exemplaires',
      desc: 'Possède 30 cartes en tout (doublons compris).',
      metric: 'total', target: 30, reward: { coins: 0, xp: 250, packs: { rare: 1 } }
    },
    {
      id: 'q38', icon: '✦', title: 'Première shiny',
      desc: 'Obtiens une carte shiny.',
      metric: 'shiny', target: 1, reward: { coins: 0, xp: 300, packs: { video: 1 } }
    },
    {
      id: 'q39', icon: '📦', title: 'Ouverture sérieuse',
      desc: 'Ouvre 20 boosters.',
      metric: 'packsOpened', target: 20, reward: { coins: 0, xp: 320, packs: { legend: 1 } }
    },
    {
      id: 'q40', icon: '🔵', title: 'Huit Rares',
      desc: 'Possède 8 cartes Rares ou plus.',
      metric: 'rarePlus', target: 8, reward: { coins: 0, xp: 300, packs: { rare: 2 } }
    },
    {
      id: 'q41', icon: '🏷️', title: 'Vendeur actif',
      desc: 'Encaisse 4 ventes sur le marché.',
      metric: 'marketSales', target: 4, reward: { coins: 0, xp: 280, packs: { classic: 2 } }
    },
    {
      id: 'q42', icon: '🛒', title: 'Chineur',
      desc: 'Achète 2 cartes sur le marché.',
      metric: 'marketBuys', target: 2, reward: { coins: 0, xp: 260, packs: { classic: 2 } }
    },
    {
      id: 'q44', icon: '👑', title: 'Deux Légendaires',
      desc: 'Possède 2 cartes Légendaires ou plus.',
      metric: 'legendaryPlus', target: 2, reward: { coins: 0, xp: 400, packs: { legend: 1 } }
    },
    {
      id: 'q45', icon: '📚', title: 'Dix-huit uniques',
      desc: 'Possède 18 cartes différentes.',
      metric: 'unique', target: 18, reward: { coins: 0, xp: 380, packs: { rare: 2 } }
    },
    {
      id: 'q46', icon: '⚗️', title: 'Fusion experte',
      desc: 'Réalise 12 fusions.',
      metric: 'fusions', target: 12, reward: { coins: 0, xp: 380, packs: { legend: 1 } }
    },
    {
      id: 'q47', icon: '🤝', title: 'Cercle d’amis',
      desc: 'Aie 5 amis.',
      metric: 'friends', target: 5, reward: { coins: 0, xp: 350, packs: { classic: 2, rare: 1 } }
    },
    {
      id: 'q48', icon: '📦', title: 'Vingt-cinq boosters',
      desc: 'Ouvre 25 boosters.',
      metric: 'packsOpened', target: 25, reward: { coins: 0, xp: 420, packs: { video: 1 } }
    },
    {
      id: 'q49', icon: '⭐', title: 'Niveau 3',
      desc: 'Atteins le niveau 3.',
      metric: 'level', target: 3, reward: { coins: 0, xp: 0, packs: { rare: 1 } }
    },
    {
      id: 'q50', icon: '💎', title: 'Cinquante exemplaires',
      desc: 'Possède 50 cartes en tout.',
      metric: 'total', target: 50, reward: { coins: 0, xp: 450, packs: { rare: 2 } }
    },
    {
      id: 'q51', icon: '🟣', title: 'Cinq Épiques',
      desc: 'Possède 5 cartes Épiques ou plus.',
      metric: 'epicPlus', target: 5, reward: { coins: 0, xp: 450, packs: { legend: 1 } }
    },
    {
      id: 'q52', icon: '🛍️', title: 'Quinze achats',
      desc: 'Achète 15 packs dans le Shop.',
      metric: 'packsBought', target: 15, reward: { coins: 500, xp: 400, packs: { classic: 3 } }
    },
    {
      id: 'q53', icon: '🏷️', title: 'Six ventes',
      desc: 'Encaisse 6 ventes sur le marché.',
      metric: 'marketSales', target: 6, reward: { coins: 0, xp: 400, packs: { rare: 2 } }
    },
    {
      id: 'q54', icon: '✦', title: 'Deux shiny',
      desc: 'Possède 2 cartes shiny.',
      metric: 'shiny', target: 2, reward: { coins: 0, xp: 500, packs: { legend: 1 } }
    },
    {
      id: 'q56', icon: '📚', title: 'Vingt-deux uniques',
      desc: 'Possède 22 cartes différentes.',
      metric: 'unique', target: 22, reward: { coins: 600, xp: 420, packs: { rare: 2 } }
    },
    {
      id: 'q57', icon: '💼', title: 'Commerce sérieux',
      desc: 'Gagne 1 500 pièces grâce à tes ventes.',
      metric: 'marketEarned', target: 1500, reward: { coins: 0, xp: 420, packs: { legend: 1 } }
    },
    {
      id: 'q58', icon: '🔵', title: 'Douze Rares',
      desc: 'Possède 12 cartes Rares ou plus.',
      metric: 'rarePlus', target: 12, reward: { coins: 0, xp: 450, packs: { rare: 3 } }
    },
    {
      id: 'q59', icon: '📦', title: 'Trente-cinq boosters',
      desc: 'Ouvre 35 boosters.',
      metric: 'packsOpened', target: 35, reward: { coins: 0, xp: 500, packs: { legend: 1 } }
    },
    {
      id: 'q60', icon: '⭐', title: 'Niveau 5',
      desc: 'Atteins le niveau 5.',
      metric: 'level', target: 5, reward: { coins: 0, xp: 0, packs: { legend: 1, video: 1 } }
    },
    {
      id: 'q61', icon: '🛒', title: 'Vrai collectionneur',
      desc: 'Achète 5 cartes sur le marché.',
      metric: 'marketBuys', target: 5, reward: { coins: 0, xp: 500, packs: { rare: 2 } }
    },
    {
      id: 'q62', icon: '⚗️', title: 'Fusion industrielle',
      desc: 'Réalise 18 fusions.',
      metric: 'fusions', target: 18, reward: { coins: 0, xp: 550, packs: { legend: 1 } }
    },
    {
      id: 'q63', icon: '👥', title: 'Six amis',
      desc: 'Aie 6 amis.',
      metric: 'friends', target: 6, reward: { coins: 0, xp: 500, packs: { rare: 2 } }
    },
    {
      id: 'q64', icon: '🏆', title: 'Quinze quêtes',
      desc: 'Termine 15 quêtes.',
      metric: 'questsDone', target: 15, reward: { coins: 0, xp: 600, packs: { legend: 2 } }
    },
    {
      id: 'q65', icon: '👑', title: 'Trois Légendaires',
      desc: 'Possède 3 cartes Légendaires ou plus.',
      metric: 'legendaryPlus', target: 3, reward: { coins: 0, xp: 650, packs: { legend: 1, video: 1 } }
    },
    {
      id: 'q66', icon: '🪙', title: 'Dix ventes',
      desc: 'Encaisse 10 ventes sur le marché.',
      metric: 'marketSales', target: 10, reward: { coins: 1200, xp: 600, packs: { legend: 1 } }
    },
    {
      id: 'q67', icon: '📦', title: 'Quarante boosters',
      desc: 'Ouvre 40 boosters.',
      metric: 'packsOpened', target: 40, reward: { coins: 0, xp: 650, packs: { video: 2 } }
    },
    {
      id: 'q68', icon: '🃏', title: 'Quatre-vingts exemplaires',
      desc: 'Possède 80 cartes en tout.',
      metric: 'total', target: 80, reward: { coins: 0, xp: 700, packs: { legend: 2 } }
    },
    {
      id: 'q69', icon: '⭐', title: 'Niveau 8',
      desc: 'Atteins le niveau 8.',
      metric: 'level', target: 8, reward: { coins: 0, xp: 0, packs: { legend: 2, video: 1 } }
    },
    {
      id: 'q70', icon: '🌍', title: 'Légende de Refs',
      desc: 'Possède 30 cartes différentes.',
      metric: 'unique', target: 30, reward: { coins: 2500, xp: 1000, packs: { legend: 2, video: 2 } }
    }
  ];


  /* ---- Saison 3 : 200 quêtes générées (q71 → q270). Chaque chaîne continue
     au-delà de ses étapes existantes, avec des objectifs croissants et des
     récompenses qui montent d'un cran à chaque étape. ---- */
  (function addSeason3() {
    const fr = (n) => Number(n).toLocaleString('fr-FR');
    const TIERS = ['Habitué', 'Passionné', 'Confirmé', 'Vétéran', 'Expert', 'Maître', 'Grand maître',
      'Champion', 'Élite', 'Légende', 'Mythique', 'Immortel', 'Titan', 'Divin'];
    const SPEC = [
      ['packsOpened', '📦', 'Boosters', (n) => `Ouvre ${fr(n)} boosters.`,
        [45, 50, 55, 60, 65, 70, 75, 80, 90, 100, 110, 120, 130, 140, 150, 160, 175, 180, 200, 225, 250, 275, 300, 350, 400, 450, 500]],
      ['packsBought', '🛍️', 'Acheteur', (n) => `Achète ${fr(n)} packs dans le Shop.`,
        [20, 25, 30, 35, 40, 45, 50, 60, 65, 75, 80, 90, 100, 110, 125, 150]],
      ['fusions', '⚗️', 'Alchimiste', (n) => `Réalise ${fr(n)} fusions.`,
        [25, 30, 35, 40, 45, 50, 55, 60, 65, 70, 80, 90, 100, 110, 125, 150]],
      ['marketSales', '🏷️', 'Marchand', (n) => `Encaisse ${fr(n)} ventes sur le marché.`, [15, 20, 30, 40, 50, 75, 100, 150]],
      ['marketEarned', '💼', 'Négociant', (n) => `Gagne ${fr(n)} pièces grâce à tes ventes.`,
        [3000, 5000, 10000, 20000, 50000, 100000, 250000, 500000, 1000000]],
      ['marketBuys', '🛒', 'Chineur', (n) => `Achète ${fr(n)} cartes sur le marché.`, [8, 10, 15, 20, 30, 40, 50, 75, 100]],
      ['friends', '🤝', 'Sociable', (n) => `Aie ${fr(n)} amis.`, [7, 8, 9, 10, 11, 12, 15, 20, 25, 30, 40, 50]],
      ['total', '🃏', 'Accumulateur', (n) => `Possède ${fr(n)} cartes en tout (doublons compris).`,
        [100, 125, 150, 175, 200, 250, 300, 350, 400, 500, 600, 750, 900, 1000]],
      ['rarePlus', '🔵', 'Chasseur', (n) => `Possède ${fr(n)} cartes Rares ou plus.`,
        [15, 20, 25, 30, 35, 40, 45, 50, 60, 75, 90, 100, 125, 150, 200]],
      ['epicPlus', '🟣', 'Épique', (n) => `Possède ${fr(n)} cartes Épiques ou plus.`, [7, 10, 12, 15, 20, 25, 30, 40, 50, 75, 100]],
      ['legendaryPlus', '👑', 'Légendaire', (n) => `Possède ${fr(n)} cartes Légendaires ou plus.`,
        [4, 5, 6, 8, 10, 12, 15, 20, 25, 30, 40, 50]],
      ['shiny', '✦', 'Éclat', (n) => `Possède ${fr(n)} cartes shiny.`, [3, 4, 5, 7, 10, 15, 20, 25, 30, 40, 50]],
      ['level', '⭐', 'Ascension', (n) => `Atteins le niveau ${fr(n)}.`, [10, 12, 15, 18, 20, 25, 30, 35, 40, 50]],
      ['questsDone', '🏆', 'Aventurier', (n) => `Termine ${fr(n)} quêtes.`, [20, 30, 40, 50, 60, 80, 100, 125, 150, 175, 200, 225, 250]],
      ['coins', '💰', 'Fortune', (n) => `Aie ${fr(n)} pièces en poche.`, [1000, 2500, 5000, 10000, 25000, 50000, 100000, 250000, 500000, 1000000]]
    ];
    /* Les identifiants des quêtes restent stables même si on retire une
       chaîne entière : les sauvegardes gardent leurs quêtes terminées. */
    let seq = Math.max(70, QUESTS.length);
    let k = 0;
    for (const [metric, icon, noun, desc, targets] of SPEC) {
      targets.slice().sort((a, b) => a - b).forEach((target, i, all) => {
        const t = (i + 1) / all.length;
        const xp = Math.round((400 + 1600 * t) / 10) * 10;
        const coins = Math.round((500 + 2500 * t) / 50) * 50;
        const big = 1 + Math.floor(t * 2);
        const rewards = [
          { coins, xp },
          { coins: 0, xp, packs: { rare: big } },
          { coins: 0, xp, packs: { legend: big } },
          { coins: Math.round(coins / 2 / 50) * 50, xp, packs: { video: 1 } }
        ];
        seq += 1;
        QUESTS.push({
          id: 'q' + seq, icon,
          title: `${noun} : ${TIERS[Math.min(TIERS.length - 1, Math.floor(i * TIERS.length / all.length))]}`,
          desc: desc(target), metric, target, reward: rewards[k % 4]
        });
        k += 1;
      });
    }
  })();

  /* ---- Quête légendaire : la plus longue du jeu. 1000 boosters, peu
     importe lesquels, récompense en XP + un Pack Ultra. ---- */
  QUESTS.push({
    id: 'q271', icon: '🌌', title: 'Mille boosters',
    desc: 'Ouvre 1 000 boosters, peu importe lesquels.',
    metric: 'packsOpened', target: 1000, reward: { coins: 0, xp: 200, packs: { ultra: 1 } }
  });

  /* ---- Saison 4 : 50 quêtes supplémentaires (q272 → q321), toutes faisables
     à ce stade du jeu (la collection complète s'adapte au nombre réel de
     cartes dans cardsDatabase, 59 actuellement). ---- */
  const TOTAL_UNIQUE_CARDS = (typeof cardsDatabase !== 'undefined' && Array.isArray(cardsDatabase) && cardsDatabase.length)
    ? cardsDatabase.length
    : 59;

  QUESTS.push(
    /* Collection de cartes différentes (jusqu'à toutes les cartes du jeu) */
    {
      id: 'q272', icon: '📚', title: 'Grand collectionneur',
      desc: 'Possède 33 cartes différentes.',
      metric: 'unique', target: 33, reward: { coins: 1500, xp: 800, packs: { rare: 2 } }
    },
    {
      id: 'q273', icon: '🗂️', title: 'Album bien rempli',
      desc: 'Possède 36 cartes différentes.',
      metric: 'unique', target: 36, reward: { coins: 0, xp: 900, packs: { legend: 2 } }
    },
    {
      id: 'q274', icon: '🃏', title: 'Quarante visages',
      desc: 'Possède 40 cartes différentes.',
      metric: 'unique', target: 40, reward: { coins: 2000, xp: 1000, packs: { video: 1, legend: 1 } }
    },
    {
      id: 'q275', icon: '🧭', title: 'Chasseur d’inédits',
      desc: 'Possède 44 cartes différentes.',
      metric: 'unique', target: 44, reward: { coins: 0, xp: 1200, packs: { legend: 2, video: 1 } }
    },
    {
      id: 'q276', icon: '🏛️', title: 'Presque au bout',
      desc: 'Possède 48 cartes différentes.',
      metric: 'unique', target: 48, reward: { coins: 3000, xp: 1400, packs: { legend: 3 } }
    },
    {
      id: 'q277', icon: '🌟', title: 'Dernière ligne droite',
      desc: 'Possède 52 cartes différentes.',
      metric: 'unique', target: 52, reward: { coins: 0, xp: 1600, packs: { video: 2, legend: 2 } }
    },
    {
      id: 'q278', icon: '👑', title: 'Collection complète',
      desc: `Possède toutes les ${TOTAL_UNIQUE_CARDS} cartes différentes du jeu.`,
      metric: 'unique', target: TOTAL_UNIQUE_CARDS, reward: { coins: 5000, xp: 2500, packs: { ultra: 1, legend: 2 } }
    },

    /* Boosters ouverts (paliers intermédiaires jusqu'à 900) */
    {
      id: 'q279', icon: '📦', title: 'Déchireur acharné',
      desc: 'Ouvre 325 boosters.',
      metric: 'packsOpened', target: 325, reward: { coins: 0, xp: 1300, packs: { rare: 3 } }
    },
    {
      id: 'q280', icon: '📦', title: 'Demi-millier dépassé',
      desc: 'Ouvre 550 boosters.',
      metric: 'packsOpened', target: 550, reward: { coins: 2500, xp: 1600, packs: { legend: 2 } }
    },
    {
      id: 'q281', icon: '📦', title: 'Six cents boosters',
      desc: 'Ouvre 600 boosters.',
      metric: 'packsOpened', target: 600, reward: { coins: 0, xp: 1700, packs: { video: 2 } }
    },
    {
      id: 'q282', icon: '📦', title: 'Sept cents boosters',
      desc: 'Ouvre 700 boosters.',
      metric: 'packsOpened', target: 700, reward: { coins: 3000, xp: 1850, packs: { legend: 3 } }
    },
    {
      id: 'q283', icon: '📦', title: 'Huit cents boosters',
      desc: 'Ouvre 800 boosters.',
      metric: 'packsOpened', target: 800, reward: { coins: 0, xp: 2000, packs: { legend: 2, video: 2 } }
    },
    {
      id: 'q284', icon: '📦', title: 'Aux portes des mille',
      desc: 'Ouvre 900 boosters.',
      metric: 'packsOpened', target: 900, reward: { coins: 4000, xp: 2200, packs: { legend: 3, video: 1 } }
    },

    /* Cartes en tout (doublons compris) */
    {
      id: 'q285', icon: '🃏', title: 'Montagne de cartes',
      desc: 'Possède 1 200 cartes en tout (doublons compris).',
      metric: 'total', target: 1200, reward: { coins: 2000, xp: 1500, packs: { rare: 3 } }
    },
    {
      id: 'q286', icon: '🃏', title: 'Archives géantes',
      desc: 'Possède 1 500 cartes en tout (doublons compris).',
      metric: 'total', target: 1500, reward: { coins: 0, xp: 1700, packs: { legend: 3 } }
    },
    {
      id: 'q287', icon: '🃏', title: 'Deux mille exemplaires',
      desc: 'Possède 2 000 cartes en tout (doublons compris).',
      metric: 'total', target: 2000, reward: { coins: 3500, xp: 1900, packs: { legend: 2, video: 1 } }
    },
    {
      id: 'q288', icon: '🃏', title: 'Coffre-fort plein',
      desc: 'Possède 2 500 cartes en tout (doublons compris).',
      metric: 'total', target: 2500, reward: { coins: 0, xp: 2100, packs: { legend: 3, video: 2 } }
    },
    {
      id: 'q289', icon: '🃏', title: 'Trois mille cartes',
      desc: 'Possède 3 000 cartes en tout (doublons compris).',
      metric: 'total', target: 3000, reward: { coins: 5000, xp: 2300, packs: { legend: 4 } }
    },
    {
      id: 'q290', icon: '🏛️', title: 'Bibliothèque infinie',
      desc: 'Possède 5 000 cartes en tout (doublons compris).',
      metric: 'total', target: 5000, reward: { coins: 0, xp: 2600, packs: { ultra: 1, legend: 2 } }
    },

    /* Cartes shiny */
    {
      id: 'q291', icon: '✦', title: 'Six étincelles',
      desc: 'Possède 6 cartes shiny.',
      metric: 'shiny', target: 6, reward: { coins: 0, xp: 900, packs: { rare: 2 } }
    },
    {
      id: 'q292', icon: '✦', title: 'Huit étincelles',
      desc: 'Possède 8 cartes shiny.',
      metric: 'shiny', target: 8, reward: { coins: 1500, xp: 1100, packs: { legend: 1 } }
    },
    {
      id: 'q293', icon: '✦', title: 'Douzaine brillante',
      desc: 'Possède 12 cartes shiny.',
      metric: 'shiny', target: 12, reward: { coins: 0, xp: 1400, packs: { legend: 2, video: 1 } }
    },
    {
      id: 'q294', icon: '✦', title: 'Constellation shiny',
      desc: 'Possède 18 cartes shiny.',
      metric: 'shiny', target: 18, reward: { coins: 2500, xp: 1700, packs: { legend: 3 } }
    },

    /* Raretés (exemplaires possédés) */
    {
      id: 'q295', icon: '🔵', title: 'Raretés en pagaille',
      desc: 'Possède 250 cartes Rares ou plus.',
      metric: 'rarePlus', target: 250, reward: { coins: 2000, xp: 1500, packs: { rare: 3 } }
    },
    {
      id: 'q296', icon: '🔵', title: 'Déluge de Rares',
      desc: 'Possède 350 cartes Rares ou plus.',
      metric: 'rarePlus', target: 350, reward: { coins: 0, xp: 1700, packs: { legend: 3 } }
    },
    {
      id: 'q297', icon: '🔵', title: 'Cinq cents Rares',
      desc: 'Possède 500 cartes Rares ou plus.',
      metric: 'rarePlus', target: 500, reward: { coins: 3500, xp: 2000, packs: { legend: 2, video: 1 } }
    },
    {
      id: 'q298', icon: '🔵', title: 'Océan de raretés',
      desc: 'Possède 750 cartes Rares ou plus.',
      metric: 'rarePlus', target: 750, reward: { coins: 0, xp: 2300, packs: { legend: 4 } }
    },
    {
      id: 'q299', icon: '🟣', title: 'Tempête épique',
      desc: 'Possède 125 cartes Épiques ou plus.',
      metric: 'epicPlus', target: 125, reward: { coins: 2000, xp: 1600, packs: { legend: 2 } }
    },
    {
      id: 'q300', icon: '🟣', title: 'Cent cinquante Épiques',
      desc: 'Possède 150 cartes Épiques ou plus.',
      metric: 'epicPlus', target: 150, reward: { coins: 0, xp: 1800, packs: { legend: 2, video: 1 } }
    },
    {
      id: 'q301', icon: '🟣', title: 'Deux cents Épiques',
      desc: 'Possède 200 cartes Épiques ou plus.',
      metric: 'epicPlus', target: 200, reward: { coins: 3500, xp: 2000, packs: { legend: 3 } }
    },
    {
      id: 'q302', icon: '🟣', title: 'Empire épique',
      desc: 'Possède 300 cartes Épiques ou plus.',
      metric: 'epicPlus', target: 300, reward: { coins: 0, xp: 2300, packs: { legend: 3, video: 2 } }
    },
    {
      id: 'q303', icon: '👑', title: 'Soixante Légendaires',
      desc: 'Possède 60 cartes Légendaires ou plus.',
      metric: 'legendaryPlus', target: 60, reward: { coins: 3000, xp: 1900, packs: { legend: 2 } }
    },
    {
      id: 'q304', icon: '👑', title: 'Panthéon doré',
      desc: 'Possède 75 cartes Légendaires ou plus.',
      metric: 'legendaryPlus', target: 75, reward: { coins: 0, xp: 2100, packs: { legend: 3, video: 1 } }
    },
    {
      id: 'q305', icon: '👑', title: 'Cent Légendaires',
      desc: 'Possède 100 cartes Légendaires ou plus.',
      metric: 'legendaryPlus', target: 100, reward: { coins: 5000, xp: 2500, packs: { ultra: 1 } }
    },

    /* Packs achetés dans le Shop */
    {
      id: 'q306', icon: '🛍️', title: 'Client VIP',
      desc: 'Achète 175 packs dans le Shop.',
      metric: 'packsBought', target: 175, reward: { coins: 0, xp: 1500, packs: { rare: 3 } }
    },
    {
      id: 'q307', icon: '🛍️', title: 'Deux cents achats',
      desc: 'Achète 200 packs dans le Shop.',
      metric: 'packsBought', target: 200, reward: { coins: 2500, xp: 1700, packs: { legend: 2 } }
    },
    {
      id: 'q308', icon: '🛍️', title: 'Roi du Shop',
      desc: 'Achète 250 packs dans le Shop.',
      metric: 'packsBought', target: 250, reward: { coins: 0, xp: 1900, packs: { legend: 3 } }
    },
    {
      id: 'q309', icon: '🛍️', title: 'Trois cents packs achetés',
      desc: 'Achète 300 packs dans le Shop.',
      metric: 'packsBought', target: 300, reward: { coins: 4000, xp: 2200, packs: { legend: 2, video: 2 } }
    },

    /* Fusions */
    {
      id: 'q310', icon: '⚗️', title: 'Maître de la forge',
      desc: 'Réalise 175 fusions.',
      metric: 'fusions', target: 175, reward: { coins: 2000, xp: 1600, packs: { rare: 3 } }
    },
    {
      id: 'q311', icon: '⚗️', title: 'Deux cents fusions',
      desc: 'Réalise 200 fusions.',
      metric: 'fusions', target: 200, reward: { coins: 0, xp: 1850, packs: { legend: 3 } }
    },
    {
      id: 'q312', icon: '⚗️', title: 'Grand alchimiste',
      desc: 'Réalise 250 fusions.',
      metric: 'fusions', target: 250, reward: { coins: 3500, xp: 2100, packs: { legend: 2, video: 2 } }
    },

    /* Marché */
    {
      id: 'q313', icon: '🏷️', title: 'Vingt-cinq ventes',
      desc: 'Encaisse 25 ventes sur le marché.',
      metric: 'marketSales', target: 25, reward: { coins: 0, xp: 900, packs: { rare: 2 } }
    },
    {
      id: 'q314', icon: '🏷️', title: 'Empire commercial',
      desc: 'Encaisse 200 ventes sur le marché.',
      metric: 'marketSales', target: 200, reward: { coins: 4000, xp: 2000, packs: { legend: 3 } }
    },
    {
      id: 'q315', icon: '🛒', title: 'Douze trouvailles',
      desc: 'Achète 12 cartes sur le marché.',
      metric: 'marketBuys', target: 12, reward: { coins: 0, xp: 750, packs: { rare: 2 } }
    },
    {
      id: 'q316', icon: '🛒', title: 'Collectionneur du marché',
      desc: 'Achète 125 cartes sur le marché.',
      metric: 'marketBuys', target: 125, reward: { coins: 3000, xp: 1900, packs: { legend: 2, video: 1 } }
    },

    /* Quêtes terminées & niveaux */
    {
      id: 'q317', icon: '🏆', title: 'Héros des quêtes',
      desc: 'Termine 275 quêtes.',
      metric: 'questsDone', target: 275, reward: { coins: 3000, xp: 2000, packs: { legend: 3 } }
    },
    {
      id: 'q318', icon: '🏆', title: 'Trois cents quêtes',
      desc: 'Termine 300 quêtes.',
      metric: 'questsDone', target: 300, reward: { coins: 5000, xp: 2500, packs: { ultra: 1, video: 2 } }
    },
    {
      id: 'q319', icon: '⭐', title: 'Niveau 55',
      desc: 'Atteins le niveau 55.',
      metric: 'level', target: 55, reward: { coins: 0, xp: 0, packs: { legend: 3 } }
    },
    {
      id: 'q320', icon: '⭐', title: 'Niveau 60',
      desc: 'Atteins le niveau 60.',
      metric: 'level', target: 60, reward: { coins: 0, xp: 0, packs: { legend: 2, video: 2 } }
    },
    {
      id: 'q321', icon: '🌟', title: 'Niveau 65',
      desc: 'Atteins le niveau 65.',
      metric: 'level', target: 65, reward: { coins: 0, xp: 0, packs: { ultra: 1, legend: 2 } }
    }
  );

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
    { id: 'a30', icon: '🏆', title: 'Maître des quêtes', desc: 'Termine 70 quêtes.', metric: 'questsDone', target: 70, xp: 500 }
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

  /* Progression d'une quête : valeur ABSOLUE (à vie), pas de remise à zéro.
     Les compteurs comptent depuis le début du compte, donc une quête déjà
     accomplie avant l'arrivée du système est immédiatement réclamable.
     `done` = objectif atteint (récompense réclamable). */
  function questProgress(quest, ctx) {
    const target = Math.max(1, Math.floor(Number(quest.target) || 1));
    const value = Math.min(metricValue(quest.metric, ctx), target);
    return { value, target, done: value >= target };
  }

  /* Catégories : chaque catégorie regroupe des « chaînes ». Une chaîne = toutes
     les quêtes d'une même métrique, triées par objectif croissant (étape 1, 2,
     3…). Seule l'étape en cours de chaque chaîne est active, et l'étape
     suivante est annoncée : rien n'est débloqué en cachette. */
  const CATEGORIES = [
    { id: 'boosters', icon: '📦', label: 'Boosters', metrics: ['packsOpened', 'packsBought'] },
    { id: 'collection', icon: '📚', label: 'Collection', metrics: ['unique', 'total'] },
    { id: 'rarity', icon: '💎', label: 'Raretés', metrics: ['rarePlus', 'epicPlus', 'legendaryPlus', 'shiny'] },
    { id: 'trade', icon: '⚗️', label: 'Fusion & marché', metrics: ['fusions', 'marketSales', 'marketEarned', 'marketBuys'] },
    { id: 'social', icon: '👥', label: 'Amis & niveau', metrics: ['friends', 'level', 'questsDone'] },
    { id: 'wealth', icon: '💰', label: 'Fortune', metrics: ['coins'] }
  ];

  const CATEGORY_BY_METRIC = new Map();
  const QUEST_CHAINS = new Map();
  const QUEST_INDEX_BY_ID = new Map();
  for (const category of CATEGORIES) {
    for (const metric of category.metrics) CATEGORY_BY_METRIC.set(metric, category.id);
  }
  for (const quest of QUESTS) {
    if (!QUEST_CHAINS.has(quest.metric)) QUEST_CHAINS.set(quest.metric, []);
    QUEST_CHAINS.get(quest.metric).push(quest);
  }
  for (const chain of QUEST_CHAINS.values()) {
    chain.sort((a, b) => a.target - b.target || a.id.localeCompare(b.id));
    chain.forEach((quest, index) => QUEST_INDEX_BY_ID.set(quest.id, index));
  }

  function categoryOf(quest) {
    return CATEGORY_BY_METRIC.get(quest && quest.metric) || CATEGORIES[0].id;
  }

  function chainOf(quest) {
    return QUEST_CHAINS.get(quest && quest.metric) || [];
  }

  /* { step, total } d'une quête dans sa chaîne. */
  function chainInfo(quest) {
    const chain = chainOf(quest);
    const index = QUEST_INDEX_BY_ID.get(quest && quest.id);
    return { step: index === undefined ? 0 : index + 1, total: chain.length };
  }

  /* Étape suivante de la chaîne (annoncée, jamais cachée), ou null. */
  function nextInChain(quest, completedIds) {
    const done = new Set(Array.isArray(completedIds) ? completedIds : []);
    const chain = chainOf(quest);
    const index = QUEST_INDEX_BY_ID.get(quest && quest.id);
    if (index === undefined) return chain.find((entry) => !done.has(entry.id)) || null;
    for (let i = index + 1; i < chain.length; i++) {
      if (!done.has(chain[i].id)) return chain[i];
    }
    return null;
  }

  /* Quêtes actives : première étape non réclamée par chaîne. Les chaînes sont
     triées une seule fois au chargement, plutôt qu'à chaque rendu du panneau. */
  function activeQuests(completedIds) {
    const done = new Set(Array.isArray(completedIds) ? completedIds : []);
    const active = [];
    for (const cat of CATEGORIES) {
      for (const metric of cat.metrics) {
        const chain = QUEST_CHAINS.get(metric);
        if (!chain) continue;
        const first = chain.find((quest) => !done.has(quest.id));
        if (first) active.push(first);
      }
    }
    return active;
  }

  /* Récompense d'une quête, normalisée : `{ coins, xp, packs }`.
     - `coins` / `xp` : entiers >= 0 (0 = la quête n'en donne pas) ;
     - `packs` : objet { classic?, rare?, legend?, video? } d'entiers > 0,
       vide si la quête ne donne pas de booster. Une quête peut donc donner
       uniquement de l'XP, uniquement des packs, ou tout à la fois. */
  function questReward(quest) {
    const raw = (quest && quest.reward) || {};
    const packs = {};
    const rawPacks = raw.packs && typeof raw.packs === 'object' ? raw.packs : {};
    for (const key of PACK_KEYS) {
      const n = Math.max(0, Math.floor(Number(rawPacks[key]) || 0));
      if (n > 0) packs[key] = n;
    }
    return {
      coins: Math.max(0, Math.floor(Number(raw.coins) || 0)),
      xp: Math.max(0, Math.floor(Number(raw.xp) || 0)),
      packs
    };
  }

  /* Liste lisible des packs d'une récompense : « 1 Pack Rare + 2 Pack Vidéo ».
     Chaîne vide si la quête ne donne aucun booster. */
  function packRewardLabel(packs) {
    const source = packs && typeof packs === 'object' ? packs : {};
    return PACK_KEYS
      .filter((key) => Number(source[key]) > 0)
      .map((key) => `${Math.floor(Number(source[key]))} ${PACK_LABELS[key] || key}`)
      .join(' + ');
  }

  /* Progression d'un succès : même mesure absolue que les quêtes. */
  function achievementProgress(achievement, ctx) {
    const target = Math.max(1, Math.floor(Number(achievement.target) || 1));
    const value = Math.min(metricValue(achievement.metric, ctx), target);
    return { value, target, done: value >= target };
  }

  return {
    METRICS,
    METRIC_LABELS,
    QUESTS,
    QUEST_WINDOW,
    activeQuests,
    CATEGORIES,
    categoryOf,
    chainInfo,
    nextInChain,
    ACHIEVEMENTS,
    xpForLevel,
    levelFromXp,
    metricValue,
    metricLabel,
    questProgress,
    achievementProgress,
    PACK_KEYS,
    PACK_LABELS,
    questReward,
    packRewardLabel
  };
})();
