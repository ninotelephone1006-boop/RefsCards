# Refs Cards

Jeu mobile-first d'ouverture de boosters. Les comptes et les sauvegardes sont stockés dans **Firebase Authentication + Cloud Firestore** : il ne s'agit pas de données liées au serveur local ou à un appareil. Le même compte retrouve ses cartes et son argent sur n'importe quel appareil connecté à Internet. Le navigateur ne contient que la configuration publique du projet et le jeton de connexion Firebase ; les sauvegardes sont isolées par identifiant de compte par les règles Firestore.

## Configuration cloud (à faire une fois)

Il faut un projet Firebase partagé par toutes les versions du jeu. Le plan Spark gratuit suffit pour commencer, dans ses limites d'utilisation.

1. Crée un projet sur [Firebase Console](https://console.firebase.google.com/).
2. Dans **Authentication → Sign-in method**, active le fournisseur **Google**. Note : `localhost` est autorisé par défaut ; pour la mise en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains** (étape 5).
3. Dans **Firestore Database**, crée la base (choisis la région proche de tes joueurs) et ouvre **Rules**. Publie ces règles : chaque personne ne peut modifier que sa propre sauvegarde, les profils publics sont lisibles par tout joueur connecté, et les échanges sont réservés aux deux parties concernées :

```text
rules_version = '2';
service cloud.firestore {
  match /databases/{database}/documents {

    // Sauvegarde privée du joueur : pièces, collection, liste d'amis, compteurs.
    match /playerSaves/{userId} {
      function ownsSave() {
        return request.auth != null && request.auth.uid == userId;
      }
      allow read: if ownsSave();
      allow create, update: if ownsSave()
        && request.resource.data.keys().hasOnly(['coins', 'firstPack', 'collection', 'friends', 'packsOpened', 'updatedAt'])
        && request.resource.data.coins is int
        && request.resource.data.coins >= 0
        && request.resource.data.coins <= 1000000000
        && request.resource.data.firstPack is bool
        && request.resource.data.collection is list
        && request.resource.data.collection.size() <= 10000
        && request.resource.data.friends is list
        && request.resource.data.friends.size() <= 500
        && request.resource.data.packsOpened is int
        && request.resource.data.packsOpened >= 0
        && request.resource.data.updatedAt is timestamp;
      allow delete: if false;
    }

    // Profil public (pseudo, avatar, code ami, stats, collection) : lisible par
    // tout joueur connecté (c'est ce que voient les amis), modifiable uniquement
    // par son propriétaire.
    match /playerProfiles/{userId} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null
        && request.auth.uid == userId
        && request.resource.data.pseudo is string
        && request.resource.data.pseudo.size() <= 24
        && request.resource.data.avatar is string
        && request.resource.data.avatar.size() <= 300000
        && request.resource.data.friendCode is string
        && request.resource.data.friendCode.matches('^REFS-[A-Z0-9]{6}$');
      allow delete: if false;
    }

    // Annuaire code ami -> uid (recherche d'amis par code).
    match /friendCodes/{code} {
      allow read: if request.auth != null;
      allow create, update: if request.auth != null
        && request.resource.data.uid == request.auth.uid;
      allow delete: if false;
    }

    // Échanges / achats entre deux joueurs : seules les deux parties peuvent
    // lire et modifier la proposition. Chaque joueur applique sa moitié dans
    // sa propre sauvegarde (playerSaves reste « propriétaire uniquement »).
    match /trades/{tradeId} {
      function isParty() {
        return request.auth != null
          && (request.auth.uid == resource.data.fromUid
              || request.auth.uid == resource.data.toUid);
      }
      allow read: if isParty();
      allow create: if request.auth != null
        && request.resource.data.fromUid == request.auth.uid
        && request.resource.data.toUid != request.auth.uid
        && request.resource.data.status == 'pending';
      allow update: if isParty();
      allow delete: if false;
    }
  }
}
```

4. Dans **Project settings → Your apps**, crée une application Web. Sa configuration est déjà renseignée dans `firebase-config.js` (exposition via `window.REFS_FIREBASE_CONFIG`) ; si tu recrées le projet, remplace simplement les valeurs de ce fichier par celles de ta nouvelle application. Ces paramètres Firebase pour le navigateur sont publics (ce ne sont pas des mots de passe) ; **les règles Firestore ci-dessus sont la protection des données**.
5. Les règles équivalentes sont aussi dans `firestore.rules`. Pour les publier avec le CLI et mettre le jeu en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains**, installe `firebase-tools`, puis lance `firebase login`, `firebase use --add` et `firebase deploy --only hosting,firestore:rules`. `firebase.json` est déjà configuré pour Firebase Hosting. N'importe quel hébergeur statique HTTPS convient aussi, tant qu'il utilise le même projet Firebase et que les règles sont publiées.

## Lancer en local

`npm start` sert le site à <http://localhost:8000>. Ce serveur ne crée ni comptes ni sauvegardes : l'authentification et les données restent dans le projet Firebase. La connexion se fait exclusivement avec Google (`GoogleAuthProvider` + `signInWithPopup`). Sans configuration Firebase valide, le bouton reste cliquable mais explique ce qui manque (voir le dépannage ci-dessous).

Le premier booster est offert ; chaque booster suivant coûte 100 pièces, déduites au moment de l'achat.

## Chargement des scripts

`index.html` charge quatre fichiers locaux **comme scripts classiques, en `defer`**, dans cet ordre : `firebase-config.js`, `cards.js`, `audio.js`, puis `app.js`.

- **Pas de `type="module"`** : `cards.js`, `audio.js` et `app.js` partagent des variables globales (`cardsDatabase`, `Sound`, `demoDraw`, `window.REFS_FIREBASE_CONFIG`). En modules ES, chaque fichier aurait sa propre portée et `app.js` ne verrait plus ces variables. Aucun fichier n'utilise `import`/`export`, donc un script classique est le bon mode de chargement.
- **`defer`** : les scripts s'exécutent après l'analyse du DOM, sans bloquer l'affichage. `app.js` ajoute en plus un garde-fou (`DOMContentLoaded`) au cas où il serait déplacé dans `<head>` sans `defer`.
- **`?v=…` sur chaque URL locale** : évite qu'un navigateur rejoue un ancien `app.js` resté en cache après une mise à jour. Incrémente ce numéro (dans `index.html`) quand tu modifies `app.js`, `cards.js` ou `audio.js` en production.
- **Aucun `addEventListener` sur un élément nul** : `app.js` passe par les helpers `on()` / `qs()`, qui se contentent d'un avertissement si un élément manque, et l'écran de compte comme le bouton Google restent fonctionnels.
- **Filet de sécurité** : un petit script inline de `index.html` affiche un message dans l'écran de compte si `app.js` n'a pas démarré (cache obsolète, script bloqué). `app.js` signale son démarrage via `window.REFS_CARDS_READY`.

## Dépannage : « je clique sur Se connecter avec Google et rien ne se passe »

L'écran de compte affiche désormais toujours la cause d'un échec (message d'erreur, code technique `auth/…`). Correspondances utiles :

- **`Uncaught SyntaxError: Cannot use import statement outside a module`** puis **`Cannot read properties of null (reading 'addEventListener')`** → le navigateur exécute un ancien `app.js` (ou un ancien `index.html` qui le déclarait en `type="module"`) resté en cache. Les scripts actuels sont classiques et versionnés (`app.js?v=…`) : recharge avec **Ctrl+Maj+R** (ou `Cmd+Maj+R`), ou vide le cache du site. Si le message persiste, vérifie qu'aucun `type="module"` ni `import` n'a été ajouté à `index.html` / `app.js` (`npm test` le contrôle).
- **Rien ne s'ouvre, aucun message** → les scripts Firebase n'ont pas pu être chargés (hors ligne, bloqueur de publicités, réseau filtré). Recharge la page et vérifie l'accès à `www.gstatic.com`. Le bouton reste cliquable : un nouveau clic réaffiche le diagnostic.
- **« La fenêtre Google ne répond pas »** → le navigateur bloque les pop-ups, ou les cookies tiers sont bloqués (fréquent en navigation privée et dans un aperçu intégré). Autorise les pop-ups pour le site, ou ouvre le jeu dans un onglet dédié. Un garde-fou de 25 s réactive le bouton.
- **« Le navigateur a bloqué la fenêtre Google dans cet aperçu intégré »** → tu utilises l'aperçu dans une iframe (Arena, panneau de prévisualisation…). Google refuse d'afficher sa page de connexion encadrée : clique sur **Ouvrir dans un nouvel onglet**, puis connecte-toi depuis l'onglet. Sur un site publié (Firebase Hosting, domaine HTTPS), le problème disparaît.
- **« Ce domaine (mon-domaine) n'est pas autorisé »** → ajoute exactement ce domaine (sans chemin, sans `https://`) dans **Firebase → Authentication → Settings → Authorized domains**. `localhost` y est déjà par défaut ; un domaine d'aperçu changeant doit être ajouté à chaque nouveau nom.
- **« La connexion Google n'est pas activée »** → active le fournisseur **Google** dans **Authentication → Sign-in method**.
- **« Accès cloud refusé »** → republie les règles Firestore (`firebase deploy --only firestore:rules`).
- **`Missing or insufficient permissions` dans la console** (sur `playerProfiles/…`, `friendCodes/…`, `trades` — messages « Profil illisible », « Profil non sauvegardé », « Échanges illisibles ») ou **« Recherche impossible pour le moment alors que ta connexion fonctionne** → le projet Firebase n'a pas les règles à jour : celles-ci autorisent `playerProfiles`, `friendCodes` et `trades`, absents des versions publiées avant l'ajout des pages Compte et En ligne. Republie-les (`firebase deploy --only firestore:rules`, ou Firebase Console → **Firestore Database → Rules** → colle le contenu de `firestore.rules` → **Publier**), puis recharge. Le jeu détecte ce refus et affiche désormais un message explicite au lieu de « vérifie ta connexion ».
- **`VM30:1 Failed to execute script … (reading 'appendChild')`** → ce n'est pas le jeu : aucune ligne du code n'utilise `appendChild` (les scripts sont classiques, `defer`, versionnés). C'est un script injecté par une extension du navigateur (bloqueur, assistant…). Vérifie en navigation privée, extensions désactivées ; si l'erreur persiste sans extension, copie la trace entière.

Quand c'est possible, le jeu retente automatiquement la connexion par redirection complète (`signInWithRedirect`) si la fenêtre Google est bloquée ; une redirection réussie ramène directement sur la collection du joueur.

### Tests

```bash
npm install --no-save jsdom          # uniquement pour les tests
npm test                             # toute la suite
node tests/auth-flow.cjs             # états du bouton de connexion Google
node tests/script-loading.cjs        # scripts classiques + defer + cache-busting
node tests/card-flow.cjs             # ouverture de booster + chemins d'images
node tests/social-flow.cjs           # page Compte / En ligne (amis, échanges, achats)
node tests/permission-denied.cjs     # règles non publiées : message explicite, pas de crash
```

## Pages Compte et En ligne (amis, échanges, achats)

La barre de navigation compte quatre onglets : **Pack**, **Collection**, **En ligne** et **Compte**.

### Page Compte

- **Photo de profil en grand** en haut : bouton 📷 pour téléverser une image (recadrée en carré, réduite à 256 px en JPEG, stockée dans le profil public — pas besoin de Firebase Storage). Bouton « Utiliser ma photo Google » pour revenir à la photo du compte Google.
- **Pseudo modifiable** (1 à 24 caractères), affiché en haut de la page et dans le HUD à la place de l'adresse e-mail. Cliquer sur l'avatar ou le nom dans le HUD ouvre cette page.
- **Code ami** stable de la forme `REFS-XXXXXX`, dérivé de l'uid du compte, avec bouton « Copier ». Il est enregistré dans l'annuaire `friendCodes/{code}` pour être retrouvé par les amis.
- **Statistiques** : pièces, cartes totales, cartes uniques (x / total), doublons, valeur de la collection (somme des récompenses), meilleure rareté, boosters ouverts, nombre d'amis, plus le détail des cartes par rareté.

### Page En ligne

- **Ajout d'ami par code** : saisis le code ami d'un joueur (`REFS-XXXXXX`, le préfixe et les tirets sont tolérés), l'annuaire retrouve son uid et son profil public est ajouté à ta liste d'amis (stockée dans ta sauvegarde privée, champ `friends`).
- **Profil d'un ami** : photo, pseudo, code ami, stats (pièces, cartes, uniques, meilleure rareté) et **ses cartes** avec leurs exemplaires.
- **Échanger** : sur une carte d'un ami, choisis une de tes cartes à lui donner ; une proposition d'échange est créée (`trades/{id}`, statut `pending`). L'ami la voit dans « Échanges reçus » et peut accepter ou refuser.
- **Acheter** : le prix d'une carte vaut **le double de sa récompense de rareté** (Commune 40 🪙, Inhabituelle 70 🪙, Rare 110 🪙, Super Rare 160 🪙, Épique 240 🪙, Ultra épique 350 🪙, Mythique 480 🪙, Légendaire 680 🪙, Divine 1 040 🪙, Secrète 1 800 🪙). Le bouton est désactivé si ton solde est insuffisant.
- **Acceptation** : quand un joueur accepte, il applique sa moitié dans **sa propre** sauvegarde (il donne sa carte / paie, et reçoit l'autre carte / les pièces), puis marque l'échange comme appliqué de son côté. L'autre joueur applique sa moitié à son tour — immédiatement s'il est en ligne, sinon à sa prochaine connexion (`loadTrades` rejoue les moitiés en attente). Quand les deux moitiés sont appliquées, l'échange passe à `done`. Les échanges reçus/envoyés se mettent à jour en temps réel (`onSnapshot`).

Documents Firestore utilisés : `playerSaves/{uid}` (privé, + `friends` et `packsOpened`), `playerProfiles/{uid}` (public pour les joueurs connectés), `friendCodes/{code}` (annuaire), `trades/{id}` (propositions réservées aux deux parties). Les règles correspondantes sont dans `firestore.rules` — **republie-les** (`firebase deploy --only firestore:rules`) pour activer les nouvelles pages.

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
