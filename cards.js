/* ==========================================================================
   Refs Cards — base de données des cartes
   --------------------------------------------------------------------------
   Chaque carte possède :
- id          identifiant unique (sert aussi d'ID affiché, en tout petit)
- name        titre affiché en haut de la carte
- description courte affichée en bas
- rarity      clé de rareté (voir RARITIES dans app.js)
- emoji       secours visuel si l'image manque
- color       fond de secours (dégradé) si l'image manque
- image       nom de fichier (sans extension) dans assets/Cartes/
                   ex. 'pieds-de-rapace' → assets/Cartes/pieds-de-rapace.png
                   On peut aussi y mettre un chemin complet :
                   'assets/Cartes/mon-visuel.jpg'.

   Les visuels bruts vivent dans assets/Cartes/. Le texte, le cadre et les
   effets de rareté sont ajoutés par-dessus par l'application : les images
   n'ont donc besoin d'aucun texte intégré.
   ========================================================================== */

const CARTE_DIR = 'assets/Cartes/';

/* Extensions testées, dans l'ordre, quand `image` est donné sans extension. */
const CARTE_EXTENSIONS = ['png', 'jpg', 'jpeg', 'webp', 'avif'];

/* ==========================================================================
   CARTES VIDÉO (Pack Vidéo)
   --------------------------------------------------------------------------
   Une carte peut rester une simple image (rien ne change) OU porter en plus un
   bloc `video`. Une carte avec `video` valide devient une carte vidéo : elle
   s'affiche avec un lecteur <video> dans la révélation, le récap, l'inventaire
   et l'aperçu grand format, tout en gardant sa rareté, sa valeur, ses effets
   et la fusion.

   Pour utiliser ses propres vidéos : déposer les fichiers .mp4 / .webm dans
   assets/Cartes/videos/, puis configurer la carte. Deux raccourcis existent :
   `video: 'ma-video'` (= { src: 'ma-video' }) et `video: true` (cherche
   assets/Cartes/videos/<id de la carte>.mp4).

   Configuration par carte (tout est optionnel sauf une source) :

   video: {
     src: 'assets/Cartes/videos/ma-video.mp4', // source principale
     srcByFps: { 24: '...mp4', 60: '...mp4' }, // variantes par fréquence
     fps: 30 | 24 | 60 | null,                 // null = fréquence native
     sourceFps: 60,                            // fps du fichier : ajuste la
                                               // vitesse de lecture (fps/sourceFps)
     sound: true | false,                      // son activé ?
     hasAudio: true | false,                   // alias accepté de `sound`
     loop: true | false,                       // lecture en boucle ?
     poster: 'assets/Cartes/mon-affiche.jpg',  // image fixe de secours
     autoplay: true | false,                   // lecture auto (défaut : true)
     preload: 'metadata' | 'auto' | 'none'
   }

   Si `src` est un simple nom de fichier (« ma-video »), il est cherché dans
   assets/Cartes/videos/ avec les extensions .mp4 et .webm. Sans `poster`, la
   propriété `image` de la carte sert d'affiche fixe.
   ========================================================================== */

const CARTE_VIDEO_DIR = 'assets/Cartes/videos/';
const CARTE_VIDEO_EXTENSIONS = ['mp4', 'webm'];
/* Fréquences proposées dans l'interface ; une autre valeur reste acceptée. */
const VIDEO_FPS_PRESETS = [24, 30, 60];

/* Normalise le bloc `video` d'une carte. Renvoie null si la carte n'a pas de
   vidéo exploitable, sinon un objet complet et sûr à lire pour l'affichage. */
function normalizeVideoConfig(video) {
  if (!video || typeof video !== 'object' || Array.isArray(video)) return null;
  const src = typeof video.src === 'string' ? video.src.trim() : '';
  const srcByFps = {};
  if (video.srcByFps && typeof video.srcByFps === 'object' && !Array.isArray(video.srcByFps)) {
    Object.keys(video.srcByFps).forEach((key) => {
      const fps = Number(key);
      const value = video.srcByFps[key];
      if (Number.isFinite(fps) && fps > 0 && typeof value === 'string' && value.trim()) {
        srcByFps[fps] = value.trim();
      }
    });
  }
  if (!src && !Object.keys(srcByFps).length) return null;

  const fpsValue = video.fps == null || video.fps === '' ? null : Number(video.fps);
  const sourceFpsValue = video.sourceFps == null || video.sourceFps === '' ? null : Number(video.sourceFps);
  const fps = Number.isFinite(fpsValue) && fpsValue > 0 ? fpsValue : null;
  const sourceFps = Number.isFinite(sourceFpsValue) && sourceFpsValue > 0 ? sourceFpsValue : null;
  /* `sound` est la clé officielle ; `hasAudio` reste accepté (alias demandé). */
  const sound = typeof video.sound === 'boolean'
    ? video.sound
    : typeof video.hasAudio === 'boolean'
      ? video.hasAudio
      : false;

  return {
    src,
    srcByFps,
    poster: typeof video.poster === 'string' ? video.poster.trim() : '',
    fps,
    sourceFps,
    sound,
    loop: typeof video.loop === 'boolean' ? video.loop : true,
    autoplay: video.autoplay !== false,
    preload: typeof video.preload === 'string' ? video.preload : 'metadata'
  };
}

/* Raccourci : config normalisée d'une carte, ou null pour une carte image.
   `video: 'ma-video'` est accepté comme alias de `{ src: 'ma-video' }` et
   `video: true` cherche le fichier `assets/Cartes/videos/<id>.mp4`. */
function cardVideoConfig(card) {
  const raw = card && card.video;
  if (typeof raw === 'string') return normalizeVideoConfig({ src: raw });
  if (raw === true && card && card.id) return normalizeVideoConfig({ src: String(card.id) });
  return normalizeVideoConfig(raw);
}

function isVideoCard(card) {
  return Boolean(cardVideoConfig(card));
}

/* Chemin complet d'une source vidéo (chemin explicite ou fichier du dossier). */
function cardVideoPath(value) {
  const src = String(value || '').trim();
  if (!src) return '';
  if (/^([a-z]+:|\/)/i.test(src) || src.includes('/')) return src;
  return CARTE_VIDEO_DIR + src;
}

/* Liste ordonnée des sources à essayer pour une carte vidéo :
1. la variante `srcByFps` la plus proche de `fps` (correspondance exacte
      d'abord), 2. la source principale `src`. Les chemins sans extension sont
      déclinés en .mp4 puis .webm. */
function cardVideoSources(card) {
  const config = cardVideoConfig(card);
  if (!config) return [];
  const target = config.fps;
  const variants = Object.keys(config.srcByFps)
    .map((key) => ({ fps: Number(key), src: config.srcByFps[key] }))
    .sort((a, b) => {
      if (target == null) return b.fps - a.fps;
      return Math.abs(a.fps - target) - Math.abs(b.fps - target);
    })
    .map((entry) => entry.src);
  const raw = [...variants, config.src].filter(Boolean);
  const expanded = [];
  raw.forEach((value) => {
    const path = cardVideoPath(value);
    if (!path) return;
    if (/\.[a-z0-9]{2,4}$/i.test(path)) {
      expanded.push(path);
    } else {
      CARTE_VIDEO_EXTENSIONS.forEach((ext) => expanded.push(`${path}.${ext}`));
    }
  });
  return expanded.filter((src, i) => expanded.indexOf(src) === i);
}

/* Source vidéo « nominale » (celle que le lecteur tentera en premier), utile
   pour l'aperçu et les tests. */
function cardVideoSource(card) {
  const sources = cardVideoSources(card);
  return sources.length ? sources[0] : '';
}

const cardsDatabase = [
  {
    id: 'pieds-de-rapace',
    name: 'Les pieds de rapace',
    description: 'LES GROS PIEDS DE RAPACE LA PUTAIN !!',
    rarity: 'uncommon',
    emoji: '🦅',
    image: 'assets/Cartes/pieds-de-rapace.jpg',
    color: '#8fb6a6'
  },
  {
    id: 'royer-rizz',
    name: 'Royer Rizz',
    description: 'Ma grand-mère est amoureuse',
    rarity: 'ultraepic',
    emoji: '😍',
    image: 'assets/Cartes/royer-rizz.jpg',
    color: '#ff8fd1'
  },
  {
    id: 'chasseur-royer',
    name: 'Chasseur Royer',
    description: "Il a l'œil affuté.",
    rarity: 'common',
    emoji: '🏹',
    image: 'assets/Cartes/chasseur-royer.jpg',
    color: '#c8b48c'
  },
  {
    id: 'gros-plan-royer',
    name: 'Gros plan Royer',
    description: 'Un visage de dieu grec',
    rarity: 'rare',
    emoji: '📸',
    image: 'assets/Cartes/gros-plan-royer.jpg',
    color: '#8fc8ef'
  },
  {
    id: 'bierry-patrick',
    name: 'Bierry Patrick',
    description: "L'aura de Patrick dans ses yeux…",
    rarity: 'superrare',
    emoji: '⭐',
    image: 'assets/Cartes/bierry-patrick.jpg',
    color: '#67e0d0'
  },
  {
    id: 'kawai-rapace',
    name: 'Kawai Rapace',
    description: 'oni-chan',
    rarity: 'epic',
    emoji: '🌸',
    image: 'assets/Cartes/kawai-rapace.jpg',
    color: '#c6a0eb'
  },
  {
    id: 'karate-fagar',
    name: 'Karate Fagar',
    description: 'Cette homme est dangereux',
    rarity: 'legendary',
    emoji: '🥋',
    image: 'assets/Cartes/karate-fagar.jpg',
    color: '#f5d979'
  },
  {
    id: 'toilet-call',
    name: 'Toilet Call',
    description: 'Meeting de la plus haute importance',
    rarity: 'uncommon',
    emoji: '🚽',
    image: 'assets/Cartes/toilet-call.jpg',
    color: '#9dbfc4'
  },
  {
    id: 'artiste-brazile',
    name: 'Artiste Brazile',
    description: 'Hommage à un célèbre peintre allemand…',
    rarity: 'divine',
    emoji: '🎨',
    image: 'assets/Cartes/artiste-brazile.jpg',
    color: '#bff3ff'
  },
  {
    id: 'petite-degustation',
    name: 'Petite dégustation',
    description: 'Deux Critiques Gastronomique de renom',
    rarity: 'rare',
    emoji: '🍨',
    image: 'assets/Cartes/petite-degustation.jpg',
    color: '#8fc8ef'
  },
  {
    id: 'babault-musique',
    name: 'Babault Musique',
    description: "Homme polyvalent(Acteur,Musicien,Prof d'histoire…)",
    rarity: 'secret',
    emoji: '🎼',
    image: 'assets/Cartes/babault-musique.png',
    color: '#e6c8ff'
  },
  {
    id: 'marker-bierry',
    name: 'Marker Bierry',
    description: "Styliste qui farm l'aura",
    rarity: 'mythic',
    emoji: '🖌️',
    image: 'assets/Cartes/marker-bierry.jpg',
    color: '#ffb372'
  },
  {
    id: 'shock-brazil',
    name: 'Shock Brazil',
    description: 'Brazil est outré',
    rarity: 'superrare',
    emoji: '😱',
    image: 'assets/Cartes/shock-brazil.jpeg',
    color: '#67e0d0'
  },
  {
    id: 'bierry-feministe',
    name: 'Bierry Feministe',
    description: 'skibidi robe',
    rarity: 'epic',
    emoji: '👗',
    image: 'assets/Cartes/Bierry Feministe.jpg',
    color: '#c6a0eb'
  },
  {
    id: 'piter-selfie',
    name: 'Piter Selfie',
    description: "Bro m'a volé mon tel",
    rarity: 'rare',
    emoji: '🤳',
    image: 'assets/Cartes/Piter selfie.jpg',
    color: '#8fc8ef'
  },
  {
    id: 'mathis-date',
    name: 'Mathis Date',
    description: 'un gay refouler',
    rarity: 'uncommon',
    emoji: '💘',
    image: 'assets/Cartes/mathis date.jpg',
    color: '#9dbfc4'
  },
  {
    id: 'sigma-babault',
    name: 'Sigma Babault',
    description: 'CowBoy amaury',
    rarity: 'legendary',
    emoji: '🤠',
    image: 'assets/Cartes/sigma babault.jpg',
    color: '#f5d979'
  },
  {
    id: 'fagar-gros-plan',
    name: 'Fagar gros plan',
    description: 'skibidi gros plan de fagar',
    rarity: 'rare',
    emoji: '🔍',
    image: 'assets/Cartes/fagarzoom.JPEG',
    color: '#8fc8ef'
  },
  {
    id: 'ford-bierry',
    name: 'Ford Bierry',
    description: 'le cylindrée de bierry',
    rarity: 'epic',
    emoji: '🚗',
    image: 'assets/Cartes/fordbierry.JPEG',
    color: '#c6a0eb'
  },
  {
    id: 'chiki-fagar',
    name: 'Chiki Fagar',
    description: 'Fagar en mode chiki',
    rarity: 'epic',
    emoji: '😎',
    image: 'assets/Cartes/chikifagar.PNG',
    color: '#c6a0eb'
  },
  {
    id: 'babault-dancing',
    name: 'Babault Dancing',
    description: 'pas de bourré',
    rarity: 'divine',
    emoji: '🕺',
    image: 'assets/Cartes/babaultdancing.png',
    color: '#bff3ff'
  },
  {
    id: 'le-cul-de-mathis',
    name: 'Le cul de mathis',
    description: 'joli fessier',
    rarity: 'secret',
    emoji: '🍑',
    image: 'assets/Cartes/Mathiscul.jpeg',
    color: '#bff3ff'
  },
  {
    id: 'sapin-george',
    name: 'Le Sapin George',
    description: 'skibidi sapin',
    rarity: 'epic',
    emoji: '🎄',
    color: '#8fc8ef',
    video: {
      src: 'assets/Cartes/videos/GeorgeSapin.mp4',
      fps: 30,
      sound: true,
      loop: true
    }
  },
  {
    id: 'piter-la-br',
    name: 'Piter la Br',
    description: "il m'excite beaucoup",
    rarity: 'rare',
    emoji: '🎬',
    color: '#8fc8ef',
    video: {
      src: 'assets/Cartes/videos/BrPiter.mp4',
      fps: 30,
      sound: true,
      loop: true
    }
  },
  {
    id: 'kipa-demachy',
    name: 'Kipa Demachy',
    description: 'Hava Nagila',
    rarity: 'secret',
    emoji: '✡️',
    image: 'assets/Cartes/kipa-demachy.jpeg',
    color: '#e6c8ff'
  },
  {
    id: 'zoom-mathis',
    name: 'Zoom Mathis',
    description: 'zoooooom',
    rarity: 'rare',
    emoji: '🔍',
    image: 'assets/Cartes/mathiszoom.jpg',
    color: '#8fc8ef'
  },
  {
    id: 'ilanus',
    name: 'ilanus zoom',
    description: 'ZOOOMING',
    rarity: 'legendary',
    emoji: '🔍',
    image: 'assets/Cartes/Ilanus.JPEG',
    color: '#f5d979'
  },
   {
    id: 'king-mathis',
    name: 'King Mathis',
    description: 'il est de droite',
    rarity: 'legendary',
    emoji: '👑',
    image: 'assets/Cartes/king-mathis.jpeg',
    color: '#f5d979'
  },
  {
    id: 'cochon-bierry',
    name: 'Cochon Bierry',
    description: "c'est hallal",
    rarity: 'mythic',
    emoji: '🐷',
    image: 'assets/Cartes/cochon-bierry.jpeg',
    color: '#ffb372'
  },
  {
    id: 'king-nino',
    name: 'King Nino',
    description: 'il est de droite (encore plus)',
    rarity: 'legendary',
    emoji: '👑',
    image: 'assets/Cartes/king-nino.jpeg',
    color: '#f5d979'
  },
  {
    id: 'daleu-de-gazelle',
    name: 'Daleu de gazelle',
    description: 'bonsoir demoiselle',
    rarity: 'epic',
    emoji: '🦌',
    image: 'assets/Cartes/daleu-de-gazelle.jpeg',
    color: '#c6a0eb'
  },
  {
    id: 'urbex-in-the-chiote',
    name: 'Urbex in the chiote',
    description: 'ils ont etain la lumiere',
    rarity: 'rare',
    emoji: '🔦',
    color: '#8fc8ef',
    video: {
      src: 'assets/Cartes/videos/urbexchiote.MP4',
      fps: 30,
      sound: true,
      loop: true
    }
  },
  {
    id: 'lance-de-bettrave',
    name: 'Lancé de bettrave',
    description: 'skibidi lancé',
    rarity: 'epic',
    emoji: '🥬',
    color: '#c6a0eb',
    video: {
      src: 'assets/Cartes/videos/lancédebettrave.MP4',
      fps: 30,
      sound: true,
      loop: true
    }
  }
];

/* Une carte vidéo est livrée avec le projet : « Le Sapin George »
   (`sapin-george`), rare, 30 i/s, avec son, en boucle (fichier
   `assets/Cartes/videos/GeorgeSapin.mp4`). Pour ajouter les siennes : bloc
   `video` dans cardsDatabase (voir l'en-tête de ce fichier) et fichiers dans
   assets/Cartes/videos/. Le Pack Vidéo tire alors automatiquement toutes les
   cartes ainsi configurées — et uniquement elles : ces cartes ne sortent pas
   des autres boosters. Sans `image` ni `poster`, la vidéo est elle-même la
   couverture de la carte (l'emoji de secours reste affiché le temps du
   chargement). */

/* Tirages de démonstration : utilisés par le bouton « Démo » (ou ?
   demo=1 dans l'URL) pour montrer plusieurs raretés d'un seul booster. */
const demoDraw = ['chasseur-royer', 'gros-plan-royer', 'kawai-rapace', 'karate-fagar', 'babault-musique', 'babault-dancing'];

/* Tirage de démonstration « fusion » : utilisé par ?demo=fusion (ou le bouton
   Démo) pour montrer la demande de fusion sans devoir farmer un doublon.
   Contient deux paires fusionnables : chasseur-royer (commune) ×2 et
   toilet-call (inhabituelle) ×2, plus une rare pour varier les visuels. */
const fusionDemoDraw = ['chasseur-royer', 'chasseur-royer', 'toilet-call', 'toilet-call', 'gros-plan-royer'];

/* Tirage de démonstration du Pack Vidéo : ?demo=video (ou le bouton Démo)
   ouvre jusqu'à deux cartes vidéo configurées dans cardsDatabase, quelles
   qu'elles soient — aucune liste d'identifiants n'est codée en dur. */
function videoDemoIds() {
  return cardsDatabase
    .filter((card) => cardVideoConfig(card))
    .slice(0, 2)
    .map((card) => card.id);
}

/* Résout les chemins d'image possibles pour une carte : chemin explicite,
   ou nom de fichier sans extension décliné sur les extensions courantes.
   L'application essaie chaque candidat jusqu'à trouver le visuel. */
function cardImageSources(card) {
  if (!card || !card.image) return [];
  if (card.image.includes('/') || /\.[a-z0-9]{2,4}$/i.test(card.image)) return [card.image];
  const base = CARTE_DIR + card.image;
  return CARTE_EXTENSIONS.map((ext) => `${base}.${ext}`);
}

/* Mutations : couche indépendante du catalogue et du tirage de rareté.
   Les identifiants persistés restent des chaînes : baseId::mutationId.
   Une seule mutation par obtention ; intervalles disjoints, taux absolus.
   Aucun tirage à la lecture d'une sauvegarde ou lors d'un achat. */
const CardMutations = (() => {
  const definitions = Object.freeze([
    Object.freeze({
      id: 'shiny', label: 'Shiny', icon: '✦', cssClass: 'mutation-shiny',
      // Pas de bonus économique implicite : changer explicitement ces facteurs.
      valueMultiplier: 1, rewardMultiplier: 1,
      rates: Object.freeze({
        common: 0.01, uncommon: 0.008, rare: 0.006, superrare: 0.0045,
        epic: 0.003, ultraepic: 0.002, mythic: 0.0012,
        legendary: 0.0008, divine: 0.0005, secret: 0.0002
      })
    })
  ]);
  function definition(card) {
    return definitions.find((m) => m.id === card?.mutation) || null;
  }
  function apply(base, mutation) {
    return { ...base, baseId: base.id, id: `${base.id}::${mutation.id}`, mutation: mutation.id };
  }
  function roll(card, random = Math.random) {
    if (!card || card.mutation) return card;
    const roll = random();
    let threshold = 0;
    for (const mutation of definitions) {
      threshold += mutation.rates[card.rarity] || 0;
      if (roll < threshold) return apply(card, mutation);
    }
    return { ...card };
  }
  function resolve(id) {
    if (typeof id !== 'string') return null;
    const [baseId, mutationId, extra] = id.split('::');
    const base = cardsDatabase.find((c) => c.id === baseId);
    if (!base || extra !== undefined) return null;
    if (mutationId === undefined) return base;
    const mutation = definitions.find((m) => m.id === mutationId);
    return mutation ? apply(base, mutation) : null;
  }
  function label(card) {
    const mutation = definition(card);
    return mutation ? `${card.name} · ${mutation.label}` : card.name;
  }
  function multiply(card, value, effect = 'value') {
    return value * (definition(card)?.[`${effect}Multiplier`] ?? 1);
  }
  function owned(ids) {
    return [...new Set(ids)].map(resolve).filter(Boolean);
  }
  return Object.freeze({ definitions, definition, roll, resolve, label, multiply, owned });
})();
