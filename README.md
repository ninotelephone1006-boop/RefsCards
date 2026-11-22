# Refs Cards

Jeu mobile-first d'ouverture de boosters. Les comptes et les sauvegardes sont stockés dans **Firebase Authentication + Cloud Firestore** : il ne s'agit pas de données liées au serveur local ou à un appareil. Le même compte retrouve ses cartes et son argent sur n'importe quel appareil connecté à Internet. Le navigateur ne contient que la configuration publique du projet et le jeton de connexion Firebase ; les sauvegardes sont isolées par identifiant de compte par les règles Firestore.

## Configuration cloud (à faire une fois)

Il faut un projet Firebase partagé par toutes les versions du jeu. Le plan Spark gratuit suffit pour commencer, dans ses limites d'utilisation.

1. Crée un projet sur [Firebase Console](https://console.firebase.google.com/).
2. Dans **Authentication → Sign-in method**, active le fournisseur **Google**. Note : `localhost` est autorisé par défaut ; pour la mise en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains** (étape 5).
3. Dans **Firestore Database**, crée la base (choisis la région proche de tes joueurs) et ouvre **Rules**. Publie ces règles pour que chaque personne puisse lire et modifier uniquement sa sauvegarde :

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {
    match /playerSaves/{userId} {
      function ownsSave() {
        return request.auth != null && request.auth.uid == userId;
      }
      allow read: if ownsSave();
      allow create, update: if ownsSave()
        && request.resource.data.keys().hasOnly(['coins', 'firstPack', 'collection', 'updatedAt'])
        && request.resource.data.coins is int
        && request.resource.data.coins >= 0
        && request.resource.data.coins <= 1000000000
        && request.resource.data.firstPack is bool
        && request.resource.data.collection is list
        && request.resource.data.collection.size() <= 10000
        && request.resource.data.updatedAt is timestamp;
      allow delete: if false;
    }
  }
}
```

4. Dans **Project settings → Your apps**, crée une application Web. Sa configuration est déjà renseignée dans `firebase-config.js` (exposition via `window.REFS_FIREBASE_CONFIG`) ; si tu recrées le projet, remplace simplement les valeurs de ce fichier par celles de ta nouvelle application. Ces paramètres Firebase pour le navigateur sont publics (ce ne sont pas des mots de passe) ; **les règles Firestore ci-dessus sont la protection des données**.
5. Les règles équivalentes sont aussi dans `firestore.rules`. Pour les publier avec le CLI et mettre le jeu en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains**, installe `firebase-tools`, puis lance `firebase login`, `firebase use --add` et `firebase deploy --only hosting,firestore:rules`. `firebase.json` est déjà configuré pour Firebase Hosting. N'importe quel hébergeur statique HTTPS convient aussi, tant qu'il utilise le même projet Firebase et que les règles sont publiées.

## Lancer en local

`npm start` sert le site à <http://localhost:8000>. Ce serveur ne crée ni comptes ni sauvegardes : l'authentification et les données restent dans le projet Firebase. La connexion se fait exclusivement avec Google (`GoogleAuthProvider` + `signInWithPopup`). Sans configuration Firebase valide, la connexion est volontairement bloquée.

Le premier booster est offert ; chaque booster suivant coûte 100 pièces, déduites au moment de l'achat.

## Déroulé d'une ouverture

1. **Découpe manuelle** : le booster flotte au centre (parallaxe souris, `touch-action: none`). Une ligne de découpe lumineuse, guidée par une flèche, attend à 15 % du haut. Glisser vers la droite (doigt ou souris) fait progresser la coupe de 0 à 100 % : trait incandescent, gerbe d'étincelles, rabat soulevé en `clip-path`, bruit de papier/plastique dont le timbre suit la vitesse du geste.
2. **Seuil** : relâché avant 75 %, le paquet revient en place avec un rebond élastique (et un léger craquement). À partir de 75 %, la déchirure s'achève : le haut s'envole en tournoyant dans un flash, éjecte la pile de cinq cartes et déclenche le *pop* d'ouverture.
3. **Pile de cartes** : les cinq cartes sont triées de la moins rare à la plus rare, la plus rare au fond. Un clic retourne la carte du dessus (`rotateY`), avec parallaxe/tilt et reflet holographique qui suit le curseur. Les dix raretés ont leur mise en scène, regroupée en trois paliers d'effets : halo coloré (Commune, Inhabituelle), anneau + étincelles (Rare, Super Rare), ralenti + tremblement d'écran (Épique, Ultra épique), rayons rotatifs + pluie + hologramme (Mythique, Légendaire, Divine, Secrète).
4. **Rangement** : après l'avoir révélée, touche la carte pour la manipuler (tilt/parallaxe), puis appuie sur **Carte suivante** (ou clique à côté dans la table) pour la faire glisser vers le récapitulatif (whoosh) et dévoiler la suivante. Au clavier, Entrée/Espace range la carte révélée. Une fois les cinq cartes rangées, le bouton de rachat animé apparaît (`100 🪙`, premier booster offert).
5. **Fusion** : à la fin du booster, une **demande de fusion** s'ouvre : chaque paire de cartes identiques peut être échangée contre une carte de la rareté supérieure (la fusion est sans risque, les légendaires étant au sommet).

## Son

Tout est synthétisé en direct avec la Web Audio API (aucun fichier audio) : déchirement continu modulé par la vitesse, étincelles, *pop* d'ouverture, *whoosh*, *tick* au survol, `cha-ching` à l'achat, et un jingle propre à chaque rareté (accord simple, carillon cristallin, impact dramatique, fanfare épique). Le bouton haut-parleur coupe/rétablit le son.

## Paramètres utiles

- `?demo=1` : force un tirage de démonstration (aperçu de plusieurs raretés).
- Clavier : `Entrée`/`Espace` sur le booster ouvre la déchirure, `→` fait progresser la coupe, `Maj+Entrée` sur une carte révélée l'ouvre en grand, `Échap` ferme l'inspection ou la fusion.
- Inspection : double-clic (ou double-tap) sur une carte révélée, ou clic sur une vignette du butin, pour l'afficher en grand.

## Personnaliser les cartes

Les cartes sont définies dans `cards.js` (`cardsDatabase`) et leurs visuels vivent dans `assets/Cartes/`.

Chaque carte possède un identifiant, un nom, une description, une rareté, un emoji de secours, une couleur de fond de secours et un visuel :

```js
{
  id: 'ma-carte',              // identifiant unique, affiché en tout petit sur la carte
  name: 'Ma carte',            // titre affiché en haut
  description: 'Ma description', // affichée en bas
  rarity: 'rare',              // voir les dix raretés ci-dessous
  emoji: '😎',                 // secours si le visuel manque
  image: 'ma-carte',           // nom de fichier dans assets/Cartes/ (sans extension)
  color: '#a2d8ef'             // fond de secours
}
```

`image` peut être un simple nom de fichier ou un chemin complet (`assets/Cartes/ma-carte.jpg`). Sans extension, l'application essaie automatiquement `.png`, `.jpg`, `.jpeg`, `.webp` puis `.avif` : il suffit donc de déposer `assets/Cartes/ma-carte.png` pour que la carte l'utilise. Si aucun visuel n'est trouvé, l'emoji et la couleur de secours prennent le relais.

**Format d'une carte** : ratio strict **5:7** partout (révélation, miniature du butin, inspection en grand, aperçus de fusion), coins arrondis, image plein cadre en `object-fit: cover`. Le titre est posé en haut sur un dégradé sombre avec un badge de rareté coloré ; la description est posée en bas sur un dégradé progressif ; l'identifiant apparaît en tout petit en bas à droite. Les effets de rareté (bordure, reflet holographique, lueurs, rayons) passent par-dessus ou autour de l'image sans la masquer.

### Les dix raretés

| Clé | Libellé | Tirage | Récompense | Palier d'effets |
| --- | --- | --- | --- | --- |
| `common` | Commune | 30 % | 20 🪙 | calm |
| `uncommon` | Inhabituelle | 22 % | 35 🪙 | calm |
| `rare` | Rare | 16 % | 55 🪙 | rare |
| `superrare` | Super Rare | 11 % | 80 🪙 | rare |
| `epic` | Épique | 8 % | 120 🪙 | epic |
| `ultraepic` | Ultra épique | 5 % | 175 🪙 | epic |
| `mythic` | Mythique | 3,5 % | 240 🪙 | gold |
| `legendary` | Légendaire | 2,5 % | 340 🪙 | gold |
| `divine` | Divine | 1,5 % | 520 🪙 | gold |
| `secret` | Secrète | 0,5 % | 900 🪙 | gold |

Le tirage est pondéré par `weight` dans `RARITIES` (`app.js`) : si une rareté ne contient aucune carte, son poids est simplement ignoré et les autres se partagent le tirage. La fusion remonte la chaîne `next` (une Commune fusionne vers une Inhabituelle, etc.), la Secrète étant au sommet. Les couleurs de cadre, de badge et de lueur viennent aussi de `RARITIES`.

L'image `assets/packet.png` fournie ici est un visuel temporaire créé pour le prototype : remplacez-la par votre propre image en conservant le même chemin.

> **Visuels de démonstration** : le dossier `assets/Cartes/` contient pour l'instant des images de substitution aux bonnes dimensions (500 × 700, soit 5:7) et aux bons noms de fichiers. Remplacez chaque fichier par le vrai visuel en gardant le même nom, sans rien changer au code.
