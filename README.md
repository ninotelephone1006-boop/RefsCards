# Refs Cards

Expérience mobile-first d'ouverture de boosters, en HTML, CSS et JavaScript sans dépendances ni build. Ouvrir `index.html` dans un navigateur ou servir le dossier avec un serveur statique (par exemple `python3 -m http.server 8000`).

Le premier booster est offert ; chaque booster suivant coûte 100 pièces, déduites au moment de l'achat. Le solde et les cartes ne sont conservés que pendant la session : il n'y a pas encore de boutique ni d'album.

## Déroulé d'une ouverture

1. **Découpe manuelle** : le booster flotte au centre (parallaxe souris, `touch-action: none`). Une ligne de découpe lumineuse, guidée par une flèche, attend à 15 % du haut. Glisser vers la droite (doigt ou souris) fait progresser la coupe de 0 à 100 % : trait incandescent, gerbe d'étincelles, rabat soulevé en `clip-path`, bruit de papier/plastique dont le timbre suit la vitesse du geste.
2. **Seuil** : relâché avant 75 %, le paquet revient en place avec un rebond élastique (et un léger craquement). À partir de 75 %, la déchirure s'achève : le haut s'envole en tournoyant dans un flash, éjecte la pile de cinq cartes et déclenche le *pop* d'ouverture.
3. **Pile de cartes** : les cinq cartes sont triées de la moins rare à la plus rare, la plus rare au fond. Un clic retourne la carte du dessus (`rotateY`), avec parallaxe/tilt et reflet holographique qui suit le curseur. Les raretés ont leur mise en scène : halo bleu électrique (Rare), ralenti + tremblement d'écran + explosion violette (Épique), rayons dorés rotatifs + pluie de confettis + hologramme arc-en-ciel (Légendaire).
4. **Rangement** : un second clic fait glisser la carte dans la barre récapitulative du bas (whoosh) et dévoile la suivante. Une fois les cinq cartes rangées, le bouton de rachat animé apparaît (`100 🪙`, premier booster offert).
5. **Fusion** : à la fin du booster, une **demande de fusion** s'ouvre : chaque paire de cartes identiques peut être échangée contre une carte de la rareté supérieure (la fusion est sans risque, les légendaires étant au sommet).

## Son

Tout est synthétisé en direct avec la Web Audio API (aucun fichier audio) : déchirement continu modulé par la vitesse, étincelles, *pop* d'ouverture, *whoosh*, *tick* au survol, `cha-ching` à l'achat, et un jingle propre à chaque rareté (accord simple, carillon cristallin, impact dramatique, fanfare épique). Le bouton haut-parleur coupe/rétablit le son.

## Paramètres utiles

- `?demo=1` : force un tirage de démonstration contenant une carte de chaque rareté.
- Clavier : `Entrée`/`Espace` sur le booster ouvre la déchirure, `→` fait progresser la coupe, `Échap` ferme la fusion.

## Personnaliser les cartes

Modifier le tableau `cardsDatabase` dans `cards.js`. Chaque objet possède un identifiant, un nom, une description, une rareté (`common`, `rare`, `epic` ou `legendary`), un emoji, une couleur et un chemin d'image facultatif. Exemple :

```js
{ id: 'ma-carte', name: 'Ma carte', description: 'Ma description', rarity: 'rare', emoji: '😎', image: 'assets/ma-carte.png', color: '#a2d8ef' }
```

Les images remplacent les emojis ; si une image est absente ou ne charge pas, l'emoji est utilisé. Les cartes sont tirées avec remise. Les probabilités par rareté sont définies dans `app.js` (60 % commune, 25 % rare, 12 % épique, 3 % légendaire). Si une rareté ne contient aucune carte, ses chances sont redistribuées proportionnellement.

Les récompenses en pièces par rareté (`RARITIES` dans `app.js`) et le tableau `demoDraw` de `cards.js` (tirage de démonstration) sont également modifiables.

L'image `assets/packet.png` fournie ici est un visuel temporaire créé pour le prototype : remplacez-la par votre propre image en conservant le même chemin.
