# Refs Cards

Prototype mobile-first d'ouverture de boosters, en HTML, CSS et JavaScript sans dépendances. Ouvrir `index.html` dans un navigateur ou servir le dossier avec un serveur statique (par exemple `python3 -m http.server 8000`).

Le premier booster est offert ; chaque booster suivant coûte 100 pièces, déduites au moment où l'on demande un nouveau booster. Le solde et les cartes ne sont conservés que pendant la session : il n'y a pas encore de boutique ni d'album.

## Personnaliser les cartes

Modifier le tableau `cardsDatabase` dans `cards.js`. Chaque objet possède un identifiant, un nom, une description, une rareté (`common`, `rare`, `epic` ou `legendary`), un emoji, une couleur et un chemin d'image facultatif. Exemple :

```js
{ id: 'ma-carte', name: 'Ma carte', description: 'Ma description', rarity: 'rare', emoji: '😎', image: 'assets/ma-carte.png', color: '#a2d8ef' }
```

Les images remplacent les emojis ; si une image est absente ou ne charge pas, l'emoji est utilisé. Les cartes sont tirées avec remise. Les probabilités par rareté sont définies dans `app.js` (60 % commune, 25 % rare, 12 % épique, 3 % légendaire). Si une rareté ne contient aucune carte, ses chances sont redistribuées proportionnellement.

L'image `assets/packet.png` fournie ici est un visuel temporaire créé pour le prototype : remplacez-la par votre propre image en conservant le même chemin.
