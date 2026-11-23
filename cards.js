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
    image: 'assets/Cartes/fagarzoom.jpeg',
    color: '#8fc8ef'
  }
];

/* Tirages de démonstration : utilisés par le bouton « Démo » (ou ?
   demo=1 dans l'URL) pour montrer plusieurs raretés d'un seul booster. */
const demoDraw = ['chasseur-royer', 'gros-plan-royer', 'kawai-rapace', 'karate-fagar', 'babault-musique'];

/* Tirage de démonstration « fusion » : utilisé par ?demo=fusion (ou le bouton
   Démo) pour montrer la demande de fusion sans devoir farmer un doublon.
   Contient deux paires fusionnables : chasseur-royer (commune) ×2 et
   toilet-call (inhabituelle) ×2, plus une rare pour varier les visuels. */
const fusionDemoDraw = ['chasseur-royer', 'chasseur-royer', 'toilet-call', 'toilet-call', 'gros-plan-royer'];

/* Résout les chemins d'image possibles pour une carte : chemin explicite,
   ou nom de fichier sans extension décliné sur les extensions courantes.
   L'application essaie chaque candidat jusqu'à trouver le visuel. */
function cardImageSources(card) {
  if (!card || !card.image) return [];
  if (card.image.includes('/') || /\.[a-z0-9]{2,4}$/i.test(card.image)) return [card.image];
  const base = CARTE_DIR + card.image;
  return CARTE_EXTENSIONS.map((ext) => `${base}.${ext}`);
}
