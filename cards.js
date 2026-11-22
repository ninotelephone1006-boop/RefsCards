/* Ajoutez vos cartes ici. L'image est facultative : laissez image vide pour
   afficher l'emoji. Les raretés possibles sont common, rare, epic et legendary. */
const cardsDatabase = [
  { id: 'cafe', name: 'Le café de trop', description: 'Prêt à conquérir le monde. Ou à faire une sieste.', rarity: 'common', emoji: '☕', image: '', color: '#c8a985' },
  { id: 'chat', name: 'Chat alors', description: 'Il juge. En silence. Comme toujours.', rarity: 'common', emoji: '🐱', image: '', color: '#d6b5a3' },
  { id: 'flemme', name: 'La flemme', description: 'On verra ça demain. Peut-être.', rarity: 'common', emoji: '🦥', image: '', color: '#b4bda0' },
  { id: 'pizza', name: 'Dernière part', description: 'Une amitié mise à rude épreuve.', rarity: 'common', emoji: '🍕', image: '', color: '#e0b183' },
  { id: 'cerveau', name: 'Big brain', description: 'Une idée de génie. Enfin presque.', rarity: 'rare', emoji: '🧠', image: '', color: '#a2d8ef' },
  { id: 'lunaire', name: 'À l’ouest', description: 'Présent physiquement, ailleurs mentalement.', rarity: 'rare', emoji: '🌙', image: '', color: '#9ebae9' },
  { id: 'cosmique', name: 'Mood cosmique', description: 'Vibre sur une autre fréquence.', rarity: 'epic', emoji: '👾', image: '', color: '#c6a0eb' },
  { id: 'magique', name: 'Coup de chance', description: 'Quand tout se passe comme prévu. Incroyable.', rarity: 'epic', emoji: '🔮', image: '', color: '#d0a2ec' },
  { id: 'roi', name: 'Le boss final', description: 'La légende raconte qu’il répond aux messages.', rarity: 'legendary', emoji: '👑', image: '', color: '#f5d979' },
  { id: 'chance', name: 'Chance ultime', description: 'Tu peux maintenant te vanter un peu.', rarity: 'legendary', emoji: '✨', image: '', color: '#f5d979' }
];

/* Tirages de démonstration : utilisés par le bouton « Démo » (ou ?
   demo=1 dans l'URL) pour montrer les quatre raretés d'un seul booster. */
const demoDraw = ['chat', 'cerveau', 'cosmique', 'roi', 'magique'];
