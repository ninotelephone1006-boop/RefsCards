/* ==========================================================================
   Refs Cards — base de données des cartes
   --------------------------------------------------------------------------
   Chaque carte possède :
     • id          identifiant unique (sert aussi d'ID affiché, en tout petit)
     • name        titre affiché en haut de la carte
     • description courte affichée en bas
     • rarity      clé de rareté (voir RARITIES dans app.js)
     • emoji       secours visuel si l'image manque
     • color       fond de secours (dégradé) si l'image manque
     • image       nom de fichier (sans extension) dans assets/Cartes/
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
    description: 'Ça donne envie de les lécher.',
    rarity: 'uncommon',
    emoji: '🦅',
    image: 'pieds-de-rapace',
    color: '#8fb6a6'
  },
  {
    id: 'royer-rizz',
    name: 'Royer Rizz',
    description: 'Je tombe amoureux.',
    rarity: 'ultraepic',
    emoji: '😍',
    image: 'royer-rizz',
    color: '#ff8fd1'
  },
  {
    id: 'chasseur-royer',
    name: 'Chasseur Royer',
    description: 'Il chasse la gazelle.',
    rarity: 'common',
    emoji: '🏹',
    image: 'chasseur-royer',
    color: '#c8b48c'
  },
  {
    id: 'gros-plan-royer',
    name: 'Gros plan Royer',
    description: 'Skibidi shooting.',
    rarity: 'rare',
    emoji: '📸',
    image: 'gros-plan-royer',
    color: '#8fc8ef'
  },
  {
    id: 'bierry-patrick',
    name: 'Bierry Patrick',
    description: 'Grand fan.',
    rarity: 'superrare',
    emoji: '⭐',
    image: 'bierry-patrick',
    color: '#67e0d0'
  },
  {
    id: 'kawai-rapace',
    name: 'Kawai Rapace',
    description: 'UwU',
    rarity: 'epic',
    emoji: '🌸',
    image: 'kawai-rapace',
    color: '#c6a0eb'
  },
  {
    id: 'karate-fagar',
    name: 'Karate Fagar',
    description: 'Fagar a des talents.',
    rarity: 'legendary',
    emoji: '🥋',
    image: 'karate-fagar',
    color: '#f5d979'
  },
  {
    id: 'toilet-call',
    name: 'Toilet Call',
    description: "C'est… intéressant.",
    rarity: 'uncommon',
    emoji: '🚽',
    image: 'toilet-call',
    color: '#9dbfc4'
  },
  {
    id: 'artiste-brazile',
    name: 'Artiste Brazile',
    description: 'Grand peintre.',
    rarity: 'divine',
    emoji: '🎨',
    image: 'artiste-brazile',
    color: '#bff3ff'
  },
  {
    id: 'petite-degustation',
    name: 'Petite dégustation',
    description: "Y'avait pas de cuillère.",
    rarity: 'rare',
    emoji: '🍨',
    image: 'petite-degustation',
    color: '#8fc8ef'
  },
  {
    id: 'babault-musique',
    name: 'Babault Musique',
    description: 'Grand musicien.',
    rarity: 'secret',
    emoji: '🎼',
    image: 'babault-musique',
    color: '#e6c8ff'
  },
  {
    id: 'marker-bierry',
    name: 'Marker Bierry',
    description: 'Maquilleur pro.',
    rarity: 'mythic',
    emoji: '🖌️',
    image: 'marker-bierry',
    color: '#ffb372'
  },
  {
    id: 'shock-brazil',
    name: 'Shock Brazil',
    description: 'Brazil is shocked.',
    rarity: 'superrare',
    emoji: '😱',
    image: 'shock-brazil',
    color: '#67e0d0'
  }
];

/* Tirages de démonstration : utilisés par le bouton « Démo » (ou ?
   demo=1 dans l'URL) pour montrer plusieurs raretés d'un seul booster. */
const demoDraw = ['chasseur-royer', 'gros-plan-royer', 'kawai-rapace', 'karate-fagar', 'babault-musique'];

/* Résout les chemins d'image possibles pour une carte : chemin explicite,
   ou nom de fichier sans extension décliné sur les extensions courantes.
   L'application essaie chaque candidat jusqu'à trouver le visuel. */
function cardImageSources(card) {
  if (!card || !card.image) return [];
  if (card.image.includes('/') || /\.[a-z0-9]{2,4}$/i.test(card.image)) return [card.image];
  const base = CARTE_DIR + card.image;
  return CARTE_EXTENSIONS.map((ext) => `${base}.${ext}`);
}
