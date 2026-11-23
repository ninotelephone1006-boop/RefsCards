# Refs Cards

Jeu mobile-first d'ouverture de boosters. Les comptes et les sauvegardes sont stockés dans **Firebase Authentication + Cloud Firestore** : il ne s'agit pas de données liées au serveur local ou à un appareil. Le même compte retrouve ses cartes et son argent sur n'importe quel appareil connecté à Internet. Le navigateur ne contient que la configuration publique du projet et le jeton de connexion Firebase ; les sauvegardes sont isolées par identifiant de compte par les règles Firestore.

## Configuration cloud (à faire une fois)

Il faut un projet Firebase partagé par toutes les versions du jeu. Le plan Spark gratuit suffit pour commencer, dans ses limites d'utilisation.

1. Crée un projet sur [Firebase Console](https://console.firebase.google.com/).
2. Dans **Authentication → Sign-in method**, active le fournisseur **Google**. Note : `localhost` est autorisé par défaut ; pour la mise en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains** (étape 5).
3. Dans **Firestore Database**, crée la base, ouvre **Rules**, puis publie le contenu complet de [`firestore.rules`](firestore.rules). Ce fichier est la référence pour les sauvegardes, les amis, les échanges, les ventes et les cadeaux. Il faut le republier après toute mise à jour des règles.

4. Dans **Project settings → Your apps**, crée une application Web. Sa configuration est déjà renseignée dans `firebase-config.js` (exposition via `window.REFS_FIREBASE_CONFIG`) ; si tu recrées le projet, remplace simplement les valeurs de ce fichier par celles de ta nouvelle application. Ces paramètres Firebase pour le navigateur sont publics (ce ne sont pas des mots de passe) ; **les règles Firestore protègent l’accès aux données**.
5. Les règles sont dans `firestore.rules`. Pour les publier avec le CLI et mettre le jeu en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains**, installe `firebase-tools`, puis lance `firebase login`, `firebase use --add` et `firebase deploy --only hosting,firestore:rules`. `firebase.json` est déjà configuré pour Firebase Hosting. N'importe quel hébergeur statique HTTPS convient aussi, tant qu'il utilise le même projet Firebase et que les règles sont publiées.

## Lancer en local

`npm start` sert le site à <http://localhost:8000>. Ce serveur ne crée ni comptes ni sauvegardes : l'authentification et les données restent dans le projet Firebase. La connexion se fait exclusivement avec Google (`GoogleAuthProvider` + `signInWithPopup`). Sans configuration Firebase valide, le bouton reste cliquable mais explique ce qui manque (voir le dépannage ci-dessous).

Le premier pack est offert (il arrive dans l'inventaire). Ensuite, les packs s'achètent dans la **boutique (onglet Shop)** et vont dans l'**inventaire** (onglet Pack) : Pack Classique **500 🪙** (5 cartes), Pack Rare doré **1 000 🪙** (5 cartes, chances Rare et plus **+20 %**) et Pack Légende **800 🪙** (`assets/packetlegende.png`, 10 cartes, chances standards). Les prix sont au-dessus de la valeur moyenne d'un pack (≈ 394 🪙 en classique, ≈ 419 🪙 en rare, ≈ 788 🪙 en légende pour 10 cartes) pour que l'argent reste un défi — à l'ancien prix de 100 🪙, chaque ouverture rapportait en moyenne ~294 🪙 et l'argent devenait infini. Chaque jour, **3 packs classiques gratuits** sont à récupérer dans le Shop (un par un, se réinitialisent à minuit). On peut acheter plusieurs packs d'un coup (quantité 1 à 10 par achat).

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
- **Les pièces envoyées à un ami n'arrivent pas** → les cadeaux sont des documents `coinGifts` : les règles doivent contenir le bloc `match /coinGifts/{giftId}` (lecture par l'expéditeur et par le destinataire, récupération par le destinataire, annulation/remboursement par l'expéditeur). Republie `firestore.rules`, puis recharge la page. Côté interface, un cadeau reçu s'affiche tout seul (temps réel) et reste dans « En ligne → Pièces à récupérer » après une reconnexion ; l'expéditeur retrouve ses cadeaux en attente dans « Cadeaux envoyés » et peut les annuler (remboursement immédiat) tant qu'ils ne sont pas récupérés.
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
node tests/social-flow.cjs           # page Compte / En ligne (amis, échanges)
node tests/market-flow.cjs           # ventes, cadeaux, récupération
node tests/coin-transfer.cjs         # transfert de pièces de bout en bout (temps réel, annulation)
node tests/friend-requests.cjs       # demandes d'ami : acceptation/refus, fiche ami
node tests/permission-denied.cjs     # règles non publiées : message explicite, pas de crash
node tests/profile-save.cjs          # pseudo et photo persistés (bouton, auto-sauvegarde, HUD, échec)
node tests/shop-flow.cjs             # boutique : achats multiples, inventaire, gratuits quotidiens, pack rare +20 %
node tests/fusion-flow.cjs           # demande de fusion : Collection, auto-ouverture, ?demo=fusion
```

## Page Shop (boutique + inventaire)

La barre de navigation compte cinq onglets : **Pack**, **Shop**, **Collection**, **En ligne** et **Compte**.

- **Achat direct supprimé** : le bouton « Ouvrir un booster » du récap (et celui de la fusion) renvoie désormais au Shop. Les packs achetés vont dans l'**inventaire** (compteur dans l'onglet Pack) et s'ouvrent depuis là — ouvrir un pack en consomme 1. Sans pack en inventaire, la déchirure est bloquée et un bouton « Aller au Shop » apparaît.
- **Trois packs** : **Pack Classique** (`assets/packet.png`, **500 🪙**, 5 cartes), **Pack Rare doré** (`assets/packetrare.png`, **1 000 🪙**, 5 cartes, chances Rare et plus **+20 %** relatives, renormalisées — les pourcentages affichés sous le pack suivent le type choisi) et **Pack Légende** (`assets/packetlegende.png`, **800 🪙**, 10 cartes, chances standards). Les prix sont au-dessus de la valeur moyenne d'un pack (≈ 394 🪙 classique, ≈ 419 🪙 rare, ≈ 788 🪙 légende pour 10 cartes ; 800 🪙 se situe juste au-dessus) pour éviter l'argent infini de l'ancien prix à 100 🪙.
- **Achats multiples** : sélecteur de quantité (1 à 10, raccourcis ×1 / ×5 / ×10) par pack ; le bouton affiche le total et se désactive si le solde est insuffisant.
- **3 gratuits par jour** : 3 packs classiques à récupérer un par un dans le Shop (bannière 🎁, pastilles de progression, quota `freeDate`/`freeUsed` par jour calendaire local, réinitialisé à minuit, pastille sur l'onglet Shop tant qu'il en reste). Le premier pack offert des nouveaux comptes arrive aussi dans l'inventaire.
- **Sauvegarde** : `playerSaves/{uid}` gagne `packStock {classic, rare, legend}`, `freeDate` et `freeUsed` (les anciennes sauvegardes sans ces champs démarrent à 0, avec migration du premier pack offert). **Republie `firestore.rules`** pour les autoriser.

## Pages Compte et En ligne (amis, échanges, achats)

### Page Compte

- **Photo de profil en grand** en haut : bouton 📷 pour téléverser une image (recadrée en carré, réduite à 256 px en JPEG, stockée dans le profil public — pas besoin de Firebase Storage). Bouton « Utiliser ma photo Google » pour revenir à la photo du compte Google. La photo est écrite dans le profil cloud dès le choix du fichier et s'affiche partout (page Compte **et** avatar du HUD) ; si l'écriture échoue, l'ancienne photo est restaurée et un message l'explique.
- **Pseudo modifiable** (1 à 24 caractères), affiché en haut de la page et dans le HUD à la place de l'adresse e-mail. Cliquer sur l'avatar ou le nom dans le HUD ouvre cette page. Le pseudo est sauvegardé dans le profil cloud via le bouton « Enregistrer » **et automatiquement** après la frappe (sans attendre le bouton) ; en cas d'échec de sauvegarde, l'ancien pseudo est restauré avec un message d'erreur plutôt qu'un faux « mis à jour ».
- **Code ami** stable de la forme `REFS-XXXXXX`, dérivé de l'uid du compte, avec bouton « Copier ». Il est enregistré dans l'annuaire `friendCodes/{code}` pour être retrouvé par les amis.
- **Statistiques** : pièces, cartes totales, cartes uniques (x / total), doublons, valeur de la collection (somme des récompenses), meilleure rareté, boosters ouverts, nombre d'amis, plus le détail des cartes par rareté.

### Page En ligne

- **Demande d'ami par code** : saisis le code ami d'un joueur (`REFS-XXXXXX`, le préfixe, les tirets et la casse sont tolérés), l'annuaire retrouve son uid et une **demande d'ami** est créée (`friendRequests/{moi}__{lui}`, statut `pending`). Personne n'est ajouté d'office : le destinataire doit **accepter**.
- **Demandes reçues / envoyées** : la page En ligne liste les demandes reçues avec **Accepter** / **Refuser** et les demandes envoyées en attente (avec **Annuler**). Quand le destinataire accepte, **les deux joueurs deviennent amis** : chacun enregistre l'autre dans sa propre liste (`friends` de sa sauvegarde privée) — immédiatement si l'expéditeur est en ligne (temps réel), sinon à sa prochaine connexion. Une demande refusée n'ajoute aucun ami. Les demandes acceptées servent aussi à réparer automatiquement une liste d'amis manquante, y compris pour les anciens comptes où `applied` avait été marqué trop tôt. Un retrait volontaire est mémorisé sur les demandes afin de ne pas réajouter l'ami. Les retraits effectués avant cette correction n'ayant pas été enregistrés sur les demandes, une ancienne amitié acceptée peut toutefois réapparaître une fois et être retirée à nouveau.
- **Profil d'un ami** : photo, pseudo, statistiques (relues à chaque ouverture, pour que le solde affiché suive les pièces reçues), collection et propositions d'échange. Ses annonces figurent séparément dans « Ses cartes à vendre ».
- **Mettre en vente** : dans « Mes cartes à vendre », choisis la carte, la quantité d'exemplaires à vendre (1 par défaut, de 1 jusqu'à ton stock, sans tout vendre d'un coup) et le prix par carte (entier libre de 0 à 1 milliard de pièces). Seuls les exemplaires choisis sont retirés de la collection et réservés ; « Retirer de la vente » / « Retirer 1 » / « Tout retirer » les rend tant qu'ils n'ont pas été achetés.
- **Acheter** : ouvre le profil d'un ami, choisis combien d'exemplaires acheter (1 par défaut quand plusieurs copies sont disponibles) et confirme. Chaque achat débite l'acheteur et lui remet la carte en une transaction. Le vendeur récupère ensuite les pièces dans « Pièces à récupérer », même après une déconnexion. Utilise « Actualiser » pour voir les nouvelles ventes et les cadeaux.
- **Donner des pièces** : ouvre le profil d'un ami, indique un montant entier positif et confirme. Les pièces sont débitées immédiatement et restent réservées jusqu'à leur récupération par le destinataire. Un solde insuffisant, une carte déjà vendue ou une collection pleine bloque l'opération.
- **Arrivée en temps réel** : le destinataire n'a plus besoin de cliquer sur « Actualiser » ni de recharger la page. Les cadeaux reçus arrivent tout seuls (`onSnapshot` sur `coinGifts` filtré par `toUid`), un message prévient « Un tel t'a envoyé N pièces » et le compteur « Pièces à récupérer » se met à jour. La page En ligne recharge aussi ces données à chaque ouverture de l'onglet, et chaque requête (mes ventes, cadeaux reçus, cadeaux envoyés) est indépendante : un refus de règles sur l'une d'elles n'efface plus les autres.
- **Cadeaux envoyés · Annuler** : la section « Cadeaux envoyés » liste les pièces encore en attente, avec **Annuler**. Tant que le destinataire n'a pas récupéré le cadeau, l'annulation le rembourse immédiatement (transaction atomique). Plus aucune pièce n'est perdue si le destinataire ne récupère jamais.
- **Échanger** : l'ancien système de propositions reste disponible depuis la collection de l'ami ; il ne fait pas partie du nouveau marché.

Les annonces (`marketListings`) et cadeaux (`coinGifts`) sont enregistrés dans Firestore. Chaque mise en réserve, achat, annulation ou récupération est une transaction atomique ; les règles limitent les changements d'état aux parties concernées (`claimed` par le destinataire, `cancelled` par l'expéditeur, qui est alors remboursé) et vérifient la modification de leur sauvegarde. Il faut publier les nouvelles règles avec `firebase deploy --only firestore:rules`. Les transactions nécessitent une connexion Internet. La limite de solde est de 1 milliard de pièces ; si la réception la dépasse, dépense d'abord des pièces puis récupère le montant.

**Limite de sécurité existante :** la logique de jeu et la sauvegarde personnelle restent contrôlées par le client, qui peut modifier ses propres pièces et cartes. Les transactions évitent les achats simultanés et les récupérations répétées dans le fonctionnement normal, mais ne constituent pas une protection anti-triche complète ; une économie fiable exige un serveur de confiance et des règles de sauvegarde plus restrictives. Évite aussi de jouer au même compte sur plusieurs appareils simultanément : les sauvegardes classiques ne sont pas synchronisées entre sessions.

## Déroulé d'une ouverture

1. **Découpe manuelle** : le booster flotte au centre (parallaxe souris, `touch-action: none`). Une ligne de découpe lumineuse, guidée par une flèche, attend à 15 % du haut. Glisser vers la droite (doigt ou souris) fait progresser la coupe de 0 à 100 % : trait incandescent, gerbe d'étincelles, rabat soulevé en `clip-path`, bruit de papier/plastique dont le timbre suit la vitesse du geste.
2. **Seuil** : relâché avant 75 %, le paquet revient en place avec un rebond élastique (et un léger craquement). À partir de 75 %, la déchirure s'achève : le haut s'envole en tournoyant dans un flash, éjecte la pile de cinq cartes et déclenche le *pop* d'ouverture.
3. **Pile de cartes** : les cinq cartes sont triées de la moins rare à la plus rare, la plus rare au fond. Un clic retourne la carte du dessus (`rotateY`), avec parallaxe/tilt et reflet holographique qui suit le curseur. Les dix raretés ont leur mise en scène, regroupée en trois paliers d'effets : halo coloré (Commune, Inhabituelle), anneau + étincelles (Rare, Super Rare), ralenti + tremblement d'écran (Épique, Ultra épique), rayons rotatifs + pluie + hologramme (Mythique, Légendaire, Divine, Secrète).
4. **Rangement** : après l'avoir révélée, touche la carte pour la manipuler (tilt/parallaxe), puis appuie sur **Carte suivante** (ou clique à côté dans la table) pour la faire glisser vers le récapitulatif (whoosh) et dévoiler la suivante. Au clavier, Entrée/Espace range la carte révélée. Une fois les cinq cartes rangées, le bouton **Aller au Shop** apparaît (les packs s'achètent dans la boutique et vont dans l'inventaire).
5. **Demande de fusion** : à la fin du booster (ou dès qu'un doublon existe), une **demande de fusion** s'ouvre : chaque paire de cartes identiques peut être échangée contre une carte de la rareté supérieure (la fusion est sans risque, les légendaires étant au sommet). Elle est aussi accessible à tout moment depuis l'onglet **Collection**, via le bouton `DEMANDE DE FUSION · N DOUBLON(S)` affiché au-dessus de la grille.

## Son

Tout est synthétisé en direct avec la Web Audio API (aucun fichier audio) : déchirement continu modulé par la vitesse, étincelles, *pop* d'ouverture, *whoosh*, *tick* au survol, `cha-ching` à l'achat, et un jingle propre à chaque rareté (accord simple, carillon cristallin, impact dramatique, fanfare épique). Le bouton haut-parleur coupe/rétablit le son.

## Paramètres utiles

- `?demo=1` : force un tirage de démonstration (aperçu de plusieurs raretés).
- `?demo=fusion` : pack de démonstration contenant deux paires identiques ; la **demande de fusion** s'ouvre toute seule après les cinq cartes (aucun pack consommé).
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
