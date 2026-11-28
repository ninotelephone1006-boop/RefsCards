# Refs Cards

Jeu mobile-first d'ouverture de boosters. Les comptes et les sauvegardes sont stockés dans **Firebase Authentication + Cloud Firestore** : il ne s'agit pas de données liées au serveur local ou à un appareil. Le même compte retrouve ses cartes et son argent sur n'importe quel appareil connecté à Internet. Le navigateur ne contient que la configuration publique du projet et le jeton de connexion Firebase ; les sauvegardes sont isolées par identifiant de compte par les règles Firestore.

## Configuration cloud (à faire une fois)

Il faut un projet Firebase partagé par toutes les versions du jeu. Le plan Spark gratuit suffit pour commencer, dans ses limites d'utilisation : **50 000 lectures et 20 000 écritures Firestore par jour**, 1 Gio stocké, 10 Go d'hébergement et ~360 Mo de téléchargement par jour. Ces compteurs se remettent à zéro à **minuit heure du Pacifique** (environ 9 h en France). Le jeu est réglé pour rester dans le quota gratuit (voir « Quota gratuit Firestore » plus bas) ; quand il est atteint, Firestore refuse les opérations (`resource-exhausted`) et le jeu l'explique clairement au joueur au lieu de parler des règles.

1. Crée un projet sur [Firebase Console](https://console.firebase.google.com/).
2. Dans **Authentication → Sign-in method**, active le fournisseur **Google**. Note : `localhost` est autorisé par défaut ; pour la mise en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains** (étape 5).
3. Dans **Firestore Database**, crée la base, ouvre **Rules**, puis publie le contenu complet de [`firestore.rules`](firestore.rules). Ce fichier est la référence pour les sauvegardes, les amis, les ventes (cartes et packs) et les cadeaux. Il faut le republier après toute mise à jour des règles.

4. Dans **Project settings → Your apps**, crée une application Web. Sa configuration est déjà renseignée dans `firebase-config.js` (exposition via `window.REFS_FIREBASE_CONFIG`) ; si tu recrées le projet, remplace simplement les valeurs de ce fichier par celles de ta nouvelle application. Ces paramètres Firebase pour le navigateur sont publics (ce ne sont pas des mots de passe) ; **les règles Firestore protègent l’accès aux données**.
5. Les règles sont dans `firestore.rules`. Pour les publier avec le CLI et mettre le jeu en ligne, ajoute ton domaine dans **Authentication → Settings → Authorized domains**, installe `firebase-tools`, puis lance `firebase login`, `firebase use --add` et `firebase deploy --only hosting,firestore:rules`. `firebase.json` est déjà configuré pour Firebase Hosting. N'importe quel hébergeur statique HTTPS convient aussi, tant qu'il utilise le même projet Firebase et que les règles sont publiées.

## Lancer en local

`npm start` sert le site à <http://localhost:8000>. Ce serveur ne crée ni comptes ni sauvegardes : l'authentification et les données restent dans le projet Firebase. La connexion se fait exclusivement avec Google (`GoogleAuthProvider` + `signInWithPopup`). Sans configuration Firebase valide, le bouton reste cliquable mais explique ce qui manque (voir le dépannage ci-dessous).

Le premier pack est offert (il arrive dans l'inventaire). Ensuite, les packs s'achètent dans la **boutique (onglet Shop)** et vont dans l'**inventaire** (onglet Pack) : Pack Classique **500 🪙** (5 cartes), Pack Rare doré **1 000 🪙** (5 cartes, raretés élevées beaucoup plus fréquentes), Pack Double Rare **1 800 🪙** (10 cartes aux chances du Pack Rare), Pack Légende **800 🪙** (`assets/packetlegende.png`, 10 cartes), Pack Vidéo **600 🪙** (`assets/packetvideo.png`, 2 cartes animées) et Pack Ultra Rare **2 200 🪙** (5 cartes, aucune commune). **Aucune garantie** : chaque carte est tirée indépendamment selon la table de son pack, et **tous les packs rendent en moyenne entre 63 % et 73 % de leur prix** (par exemple ≈ 313 🪙 pour 500 🪙 en classique, ≈ 653 🪙 pour 1 000 🪙 en rare). Ouvrir un booster fait donc perdre des pièces en moyenne : les pièces viennent des quêtes, du cadeau quotidien et de la revente, pas du tirage (voir « Équilibrage des packs »). Chaque jour, un **cadeau de connexion gratuit** est à récupérer dans le Shop : un **calendrier** dont les récompenses s'améliorent à chaque jour de connexion d'affilée (cycle de 7 jours, le 7ᵉ est le jackpot ; une journée sautée remet le compteur au jour 1). On peut acheter plusieurs packs d'un coup (quantité 1 à 10 par achat).

## Chargement des scripts

`index.html` charge sept fichiers locaux **comme scripts classiques, en `defer`**, dans cet ordre : `firebase-config.js`, `cards.js`, `quests.js`, `audio.js`, `push.js`, `version-check.js`, puis `app.js`.

- **Pas de `type="module"`** : `cards.js`, `quests.js`, `audio.js` et `app.js` partagent des variables globales (`cardsDatabase`, `RefsQuests`, `Sound`, `demoDraw`, `window.REFS_FIREBASE_CONFIG`). En modules ES, chaque fichier aurait sa propre portée et `app.js` ne verrait plus ces variables. Aucun fichier n'utilise `import`/`export`, donc un script classique est le bon mode de chargement.
- **`defer`** : les scripts s'exécutent après l'analyse du DOM, sans bloquer l'affichage. `app.js` ajoute en plus un garde-fou (`DOMContentLoaded`) au cas où il serait déplacé dans `<head>` sans `defer`.
- **`?v=…` sur chaque URL locale** : évite qu'un navigateur rejoue un ancien script resté en cache après une mise à jour. Incrémente le numéro (dans `index.html`) du fichier modifié (`app.js`, `cards.js`, `quests.js`, `audio.js`, `version-check.js` ou `styles.css`) en production. Ces `?v=` servent aussi de signature à la détection de mise à jour (voir plus bas).
- **Aucun `addEventListener` sur un élément nul** : `app.js` passe par les helpers `on()` / `qs()`, qui se contentent d'un avertissement si un élément manque, et l'écran de compte comme le bouton Google restent fonctionnels.
- **Filet de sécurité** : un petit script inline de `index.html` affiche un message dans l'écran de compte si `app.js` n'a pas démarré (cache obsolète, script bloqué). `app.js` signale son démarrage via `window.REFS_CARDS_READY`.

## Logo et icône de l'application (écran d'accueil iPhone / Android)

Le logo « RF » doré dessiné en pixel art sur fond bleu est le visuel officiel du jeu. Le fichier source `assets/icons/logo-refs-cards.png` sert partout, et les déclinaisons sont déjà générées dans `assets/icons/` :

| Fichier | Usage |
| --- | --- |
| `logo-refs-cards.png` | logo affiché dans le jeu (écran de chargement, accueil de l'onglet Booster) |
| `icon-192.png` / `icon-512.png` | icônes d'application (Android, fenêtre installée, en-tête du jeu) |
| `icon-maskable-512.png` | icône « maskable » Android : logo réduit, fond bleu plein, rien n'est rogné par la forme de l'icône |
| `apple-touch-icon.png` | icône de l'écran d'accueil iPhone/iPad (180×180, **sans transparence**) |
| `favicon-32.png` / `favicon-16.png` | icône de l'onglet du navigateur |

- **Dans le jeu** : le logo remplace l'ancien ✳ de l'en-tête (HUD et page de connexion), s'affiche en grand sur l'écran de chargement et à l'accueil de l'onglet Booster (`.brand-logo`, `.loading-logo`, `.game-logo` dans `styles.css`). Sur les écrans de moins de 640 px de haut, le logo d'accueil est masqué pour laisser la place au booster.
- **iPhone / iPad** : `index.html` déclare `<link rel="apple-touch-icon">`, `<meta name="apple-mobile-web-app-capable">`, `apple-mobile-web-app-title` (« Refs Cards ») et `apple-mobile-web-app-status-bar-style`. Ajouter le site à l'écran d'accueil (Safari → Partager → « Sur l'écran d'accueil ») installe donc le logo et ouvre le jeu en plein écran, sans barre d'adresse. En mode autonome, `styles.css` réserve la zone sûre du haut (`display-mode: standalone`) pour que la marque et les pièces ne passent pas sous l'heure ni l'encoche.
- **Manifeste** : `manifest.webmanifest` (nom, nom court, `display: standalone`, `orientation: portrait`, couleurs, icônes). Il est lié depuis `index.html` : Chrome/Edge/Android proposent l'installation, et Safari 16.4+ lit aussi le manifeste. `scope` et `start_url` sont relatifs (`./`), le jeu fonctionne donc aussi bien à la racine que dans un sous-dossier.
- **Remplacer le logo** : dépose le nouveau carré dans `assets/icons/logo-refs-cards.png`, puis régénère les tailles (ImageMagick) :
  `convert logo-refs-cards.png -filter Lanczos -resize 180x180 -depth 8 -colors 256 -strip assets/icons/apple-touch-icon.png` (idem 192, 512, 32, 16 ; pour `icon-maskable-512.png`, place le logo redimensionné à ~80 % au centre d'un carré `#0016fd`).
- **Vérification** : `node tests/app-icon.cjs` (lancé par `npm test`) contrôle les balises, le manifeste, la taille et l'opacité réelles des PNG, et la présence du logo dans le jeu.
- **Hébergement** : le manifeste et les icônes sont des fichiers statiques servis comme le reste du site (`server.js` renvoie `manifest.webmanifest` en `application/manifest+json`). Sur Firebase Hosting, aucun réglage supplémentaire n'est nécessaire.

## Écran de chargement à l'ouverture

À l'ouverture, un écran de chargement (`#loading-screen`, dans `index.html`) s'affiche immédiatement, le temps de savoir si une session Google est déjà active :

- **Session active** : le jeu s'ouvre directement, sans passer par la page de connexion.
- **Pas de session** : la page de connexion (`#auth-screen`) s'affiche.
- **Firebase absent ou en erreur** : la page de connexion s'affiche avec le message d'explication.
- **Firebase muet** : après 8 s, la page de connexion s'affiche avec un avertissement ; si la session est finalement retrouvée, le jeu prend le relais.

Le contrôle est fait par `app.js` (`showLoginPage()` / `hideLoading()`). `tests/loading-screen.cjs` couvre ces cas.

## Mises à jour : bandeau « Nouvelle version disponible »

Le site est statique : un onglet déjà ouvert continue d'exécuter les fichiers de son ancienne version après un déploiement. `version-check.js` compare donc la version chargée avec celle du `index.html` **en ligne** et, si elles diffèrent, affiche un bandeau en bas de l'écran : **« Nouvelle version disponible »** avec les boutons **Recharger** et **Plus tard**.

- **Ce qui est comparé** : une signature composée du contenu de `<meta name="app-version">` (repère lisible, rappelé dans l'infobulle) et des URL locales de `index.html` (`styles.css?v=…`, `app.js?v=…`, …). Incrémenter n'importe quel `?v=` suffit donc à déclencher le bandeau ; la meta couvre une mise à jour purement HTML. Les URL absolues (SDK Firebase, Google Fonts, scripts d'extensions) sont ignorées, pour éviter les fausses alertes.
- **Quand** : ~8 s après le chargement, puis toutes les 60 s, au retour sur l'onglet, au retour du focus et à la reconnexion réseau. La requête relit la page avec `cache: 'no-store'` (paramètre `_refs_update` en plus) : un `index.html` gardé en cache par l'hébergeur — Firebase Hosting applique un `max-age` par défaut — ne peut pas masquer un déploiement.
- **Aucun rechargement automatique** : une ouverture de booster, une révélation ou une saisie en cours ne sont jamais interrompues. C'est le joueur qui clique sur **Recharger** (`location.reload()`, donc avec revalidation des fichiers et conservation de l'URL, `?demo=…` compris).
- **Plus tard** : masque le bandeau pour cette version pendant la session (`sessionStorage`, clé `refs-cards:update-dismissed`). Un déploiement plus récent le réaffiche ; au prochain chargement de page, la vérification repart de zéro.
- **Silencieux en cas de problème** : hors ligne, `fetch` indisponible (fichier local), réponse non-HTML ou page vide → aucune alerte, la page continue de fonctionner. Le bandeau s'affiche aussi par-dessus l'écran de compte (z-index 110), et le toast remonte (`body.has-update-banner`) pour ne pas être masqué.
- **En déploiement** : à chaque mise en production, incrémente les `?v=` des fichiers modifiés **et** `<meta name="app-version">` dans `index.html`. Le bandeau n'apparaît que chez les onglets déjà ouverts : c'est exactement son rôle — les visiteurs qui arrivent après le déploiement reçoivent directement la nouvelle version.
- **Réglages** : les constantes `FIRST_CHECK_DELAY`, `CHECK_INTERVAL` et `MIN_GAP` sont en tête de `version-check.js`. L'API `window.REFS_CARDS_VERSION_CHECK` expose `check(force)`, `state()`, `dismiss()` et `reload()` (utilisée par les tests et par les boutons).
- **Pendant une ouverture** : `app.js` pose `body.refs-pack-opening` dès la déchirure. Si le joueur appuie malgré tout sur **Recharger**, `version-check.js` attend la fin de la cinématique (au plus 4 s) au lieu de couper l'ouverture en cours.

## Nouveautés du jeu : brouillons privés et « release »

Le jeu a un journal de mises à jour, **Compte → 📰 Nouveautés**. Le compte propriétaire (`ADMIN_EMAIL` dans `app.js`) rédige ce qui arrive, le relit, puis décide du moment de la sortie : **tant qu'il n'a pas publié, aucun autre joueur ne voit la nouveauté**. Ce n'est pas un masquage dans la page : les brouillons ne quittent pas le serveur.

**Deux documents Firestore, collection `gameNews`**

| Document | Contenu | Qui peut le lire |
| --- | --- | --- |
| `gameNews/published` | Les nouveautés **sorties** (`entries: [{ id, title, body, version, date }]`) | Tout le monde, même sans compte |
| `gameNews/drafts` | Les nouveautés **à venir** (même forme) | Le seul compte propriétaire |

- **Rédiger** : panneau Administration → **📰 Nouveautés · brouillon privé**. Titre, version facultative, détails (une ligne par nouveauté, `- ` pour une puce). **Enregistrer en brouillon** écrit dans `gameNews/drafts` ; rien ne change pour les joueurs.
- **Relire** : **Relire mes brouillons →** ouvre le journal. Le bloc **🔒 Brouillons · toi seulement** montre le rendu exact, avec **Publier (release)** et **Supprimer**.
- **Release** : **Publier** copie l'entrée en tête de `gameNews/published`, puis la retire des brouillons. À partir de là, elle s'affiche chez tous les joueurs (au plus tard 2 minutes après, ou à l'ouverture du journal). **Publier (release)** depuis le panneau fait la même chose sans passer par le brouillon.
- **Retirer** : sur une entrée publiée, le propriétaire voit **Retirer du journal** (confirmation). L'entrée disparaît du document public ; le brouillon n'est pas recréé.
- **Badge** : le bouton du Compte affiche **NOUVEAU** quand la dernière entrée publiée n'a pas encore été lue. La lecture est mémorisée par compte dans `localStorage` (`refs-cards:news-seen:<uid>`).
- **Quota** : un joueur lit un seul document (`published`), une fois par connexion puis au plus toutes les 2 minutes (`NEWS_TTL_MS`) ; l'admin lit aussi `drafts`. Aucune écoute temps réel (`onSnapshot`) : le journal n'a pas besoin d'être instantané.
- **Règles Firestore** : `gameNews/published` est lisible par tous (`get`), `gameNews/drafts` seulement par le propriétaire, et l'écriture (brouillon, publication, retrait) est réservée à ce compte. **Déploie `firestore.rules` avant la nouvelle version du site** : sans ces règles, la collection est refusée (`permission-denied`) et le jeu affiche « Nouveautés indisponibles : publie firestore.rules sur Firebase. » au lieu de planter.
- **Déconnexion** : le journal et les brouillons sont vidés à la déconnexion (`resetNews()`), comme le panneau d'administration.
- **Le journal est lui-même un aperçu** (`data-preview="journal-nouveautes"`) : il reste invisible pour les joueurs tant que tu ne l'as pas publié dans **Administration → 🧪 Aperçus**. Pour qu'ils y aient accès tout de suite, ouvre cette section et clique sur **Publier pour tous**.
- **Test** : `node tests/news-flow.cjs` vérifie qu'un joueur ne lit ni n'affiche jamais `gameNews/drafts`, qu'un brouillon ne publie rien, et que la release rend l'entrée visible par les autres.

## Aperçus : masquer une fonctionnalité à tout le monde sauf soi

Pour préparer une nouveauté **directement en production** sans que personne ne la voie, il suffit de marquer son bloc dans `index.html` :

```html
<section id="pack-du-mois" data-preview="pack-du-mois" data-preview-label="Pack du mois">
  …
</section>
```

- **Effet immédiat** : le bloc est masqué pour tous les joueurs (`styles.css` applique `[data-preview-locked]{display:none!important}`, donc même un bloc en `flex`/`grid` disparaît). Le compte propriétaire, lui, le voit toujours : il peut relire et tester son aperçu en conditions réelles.
- **Rien à déployer en plus** : l'attribut peut être ajouté à un bloc **déjà en jeu** pour le retirer aux joueurs le temps de le retravailler, puis le remettre.
- **Publier** : Administration → **🧪 Aperçus · fonctionnalités futures** liste tous les blocs `data-preview` de la page (libellé + identifiant + état). **Publier pour tous** l'ajoute à `released` dans `gameNews/published` ; **Repasser en privé** le retire. **🚀 Tout publier (release)** relâche toute la mise à jour d'un coup. Les joueurs voient le changement au chargement suivant (ou dans les 2 minutes).
- **Code aussi concerné** : si la fonctionnalité a des gestionnaires ou un état à neutraliser, entoure-les de `previewVisible('pack-du-mois')` (renvoie `true` pour le propriétaire et pour tout aperçu publié, `false` sinon).
- **Privé par défaut** : la liste `released` est mise en cache local (`refs-cards:preview-released`) et appliquée dès le chargement, avant la réponse de Firestore. Un aperçu oublié dans le document ne devient donc jamais public par accident : sans identifiant dans `released`, il est masqué.
- **Coût** : aucun lecture supplémentaire — `released` voyage dans le document `gameNews/published` déjà lu pour le journal.
- **Règles Firestore** : `released` est validé par la règle `gameNews` (liste de 50 identifiants max). Écriture toujours réservée au propriétaire : un joueur ne peut pas se publier un aperçu lui-même, même en modifiant la page.
- **Test** : `node tests/preview-flow.cjs` (joueur verrouillé, publication individuelle, release global, retour en privé, cache et règle CSS).

## Ouverture de booster : pas de plantage ni de booster perdu

Une erreur pendant la cinématique (tirage vide, image ou Canvas indisponible, animation différée qui échoue) ne doit pas laisser le jeu figé avec un booster déjà consommé, obligé de recharger la page. L'ouverture est donc **atomique** dans `app.js` :

- `openPack()` n'agit que pendant la déchirure (ou depuis l'écran du booster pour les tests), mémorise le stock et le compteur d'avant ouverture, et annule les animations en attente avec un jeton (`openingToken`) si une autre ouverture démarre.
- Les animations diffusées (`burst`, révélation) passent par `openingLater()` : une ancienne ouverture ne peut plus révéler ses cartes par-dessus la nouvelle.
- Si `showReveal()` lève une erreur **ou** ne peut pas tirer de carte, `recoverPackOpening()` rend le booster et le compteur, réécrit la sauvegarde, revient à l'écran du booster et affiche un toast. Aucun rechargement n'est nécessaire.
- Le drapeau `body.refs-pack-opening` est retiré à la fin, y compris en cas d'erreur, pour que le bandeau de mise à jour redevienne utilisable.

`node tests/pack-open-recovery.cjs` (dans `npm test`) couvre l'erreur de révélation, le tirage vide et le report du bouton **Recharger**.

## Arrivée de nouvelles cartes

Quand des cartes sont ajoutées à `cards.js`, le joueur est accueilli par une annonce **« Nouvelles cartes »** dès son retour dans le jeu (connexion Google ou session déjà active) :

- **Détection** : `app.js` compare les identifiants du catalogue avec la liste mémorisée dans le navigateur (`localStorage`, clé `refs-cards:catalog-seen`). La toute première visite apprend simplement le catalogue, sans annonce. Ajouter une carte au tableau `cardsDatabase` suffit : rien d'autre à déclarer. Les cartes retirées du catalogue sont oubliées à la visite suivante.
- **Animation** : les nouvelles cartes arrivent une par une, en gris, avec `???` et leur numéro (`N° 001`, `N° 002`, …) — leur identité reste un secret à découvrir dans les boosters. Le titre, les vignettes et le halo s'animent en cascade ; `prefers-reduced-motion` affiche tout sans animation.
- **Suite** : « VOIR MA COLLECTION → » ouvre l'onglet Collection, où ces mêmes cases grisées portent un badge **NOUVEAU** pendant la session. « Plus tard », le bouton ✕, le fond et Échap ferment l'annonce sans rien changer d'autre. L'annonce ne joue qu'une fois : la liste des cartes connues est mise à jour dès l'affichage.
- **Aucun effet de bord** : ni carte offerte, ni pièce débitée, ni pack ajouté — l'annonce ne fait que présenter le catalogue. Le stockage local est protégé par `try/catch` : en navigation privée ou si `localStorage` est bloqué, le jeu démarre normalement (simplement sans annonce).

## Offre de sortie : Pack Ultra Rare à −20 % pendant 24 h

Pour la sortie du Pack Ultra Rare, le jeu affiche à l'entrée une annonce **« Sortie officielle »** (fenêtre `#promo-sheet`) et applique une vraie remise de **20 %** sur ce pack pendant **24 h** :

- **Fenêtre de l'offre** : constante `ULTRA_PROMO` en tête de `app.js` (`startAt`, `durationMs: 24 h`, `discount: 0.2`, `pack: 'ultra'`). Changer `startAt` suffit à rejouer ou prolonger l'offre ; passé l'échéance, tout revient au prix normal sans nettoyage à faire.
- **Remise réelle** : `promoUnitPrice('ultra')` (20 000 → 16 000 🪙) est utilisé partout — bouton du Shop (`ACHETER · 16 000 🪙 · −20 %`), ligne « SORTIE » de la carte Ultra, compte à rebours, débit des pièces dans `buyPacks()`. Aucun prix n'est écrit dans la sauvegarde : l'offre dépend seulement de l'heure.
- **Annonce unique** : comme l'annonce du catalogue, elle apparaît une seule fois par navigateur (clé `refs-cards:promo-seen`, valeur = identifiant de l'offre), après l'annonce « Nouvelles cartes » si celle-ci est affichée. Elle ajoute aussi une notification dans la cloche (⚡ `system`) avec le prix remisé.
- **Habillage** : aurore animée, rayons tournants, étincelles, badge `−20 %`, pack flottant, prix barré, compte à rebours vivant et jauge qui se vide. `prefers-reduced-motion` coupe les animations.
- **Fin d'offre** : à zéro, la fenêtre se ferme d'elle-même, un toast prévient le joueur et le Shop réaffiche les prix normaux.

## Économie : pas d'argent pris, mais moins d'argent créé

Les packs restent au-dessus de la valeur moyenne de leur contenu, et aucun solde n'est jamais réduit automatiquement (pas d'amende, pas de reset, pas de taxe). En revanche, le gain de pièces à la révélation d'un doublon diminue : `cardReward()` paie le premier exemplaire plein tarif, puis multiplie par `0,72` par exemplaire déjà possédé, avec un plancher à `35 %` du gain de base. Le message « Doublon : gain réduit. » l'indique pendant la révélation. Fermer cette robinet des doublons évite qu'un joueur s'enrichisse indéfiniment en ouvrant toujours la même carte, sans toucher à l'argent déjà gagné ni ajouter des packs ou des cartes.

## Dépannage : « je clique sur Se connecter avec Google et rien ne se passe »

L'écran de compte affiche désormais toujours la cause d'un échec (message d'erreur, code technique `auth/…`). Correspondances utiles :

- **`Uncaught SyntaxError: Cannot use import statement outside a module`** puis **`Cannot read properties of null (reading 'addEventListener')`** → le navigateur exécute un ancien `app.js` (ou un ancien `index.html` qui le déclarait en `type="module"`) resté en cache. Les scripts actuels sont classiques et versionnés (`app.js?v=…`) : recharge avec **Ctrl+Maj+R** (ou `Cmd+Maj+R`), ou vide le cache du site. Si le message persiste, vérifie qu'aucun `type="module"` ni `import` n'a été ajouté à `index.html` / `app.js` (`npm test` le contrôle).
- **Rien ne s'ouvre, aucun message** → les scripts Firebase n'ont pas pu être chargés (hors ligne, bloqueur de publicités, réseau filtré). Recharge la page et vérifie l'accès à `www.gstatic.com`. Le bouton reste cliquable : un nouveau clic réaffiche le diagnostic.
- **« La fenêtre Google ne répond pas »** → le navigateur bloque les pop-ups, ou les cookies tiers sont bloqués (fréquent en navigation privée et dans un aperçu intégré). Autorise les pop-ups pour le site, ou ouvre le jeu dans un onglet dédié. Un garde-fou de 25 s réactive le bouton.
- **« Le navigateur a bloqué la fenêtre Google dans cet aperçu intégré »** → tu utilises l'aperçu dans une iframe (Arena, panneau de prévisualisation…). Google refuse d'afficher sa page de connexion encadrée : clique sur **Ouvrir dans un nouvel onglet**, puis connecte-toi depuis l'onglet. Sur un site publié (Firebase Hosting, domaine HTTPS), le problème disparaît.
- **« Ce domaine (mon-domaine) n'est pas autorisé »** → ajoute exactement ce domaine (sans chemin, sans `https://`) dans **Firebase → Authentication → Settings → Authorized domains**. `localhost` y est déjà par défaut ; un domaine d'aperçu changeant doit être ajouté à chaque nouveau nom.
- **« La connexion Google n'est pas activée »** → active le fournisseur **Google** dans **Authentication → Sign-in method**.
- **« Accès cloud refusé »** : un refus ne signifie pas forcément que les règles sont obsolètes. Dans la console du navigateur, relève le contexte et le code `permission-denied` ; vérifie la session, le projet (`refscard` dans `firebase-config.js`) et les données ou requêtes concernées. Compare ensuite les règles publiées sur ce même projet avec `firestore.rules` ; ne les republie que si elles diffèrent. Les ventes d’un ami sont recherchées parmi les annonces ouvertes, car ses ventes terminées sont privées.
- **« Accès cloud refusé » alors que tout est à jour (ancien compte)** : les sauvegardes écrites par les anciennes versions contiennent encore `freeDate` et `freeUsed` (« 3 gratuits/jour », remplacés depuis par `streakDate`/`streak`/`claimedDays`). Les règles jugent le document **fusionné** : une seule de ces clés encore présentes fait refuser **toute** écriture, même sans ces champs dans la charge utile. Depuis ce correctif, le jeu supprime lui-même `freeDate`/`freeUsed` du document cloud au chargement (`FieldValue.delete`, avec nouvelle tentative à chaque écriture via `withLegacyStrip`) : il suffit de recharger la page avec la dernière version. Les règles tolèrent aussi ces deux clés (comme `questBaseline`), donc la republication de `firestore.rules` n'est plus nécessaire dans ce cas précis — mais elle reste conseillée après toute modification des règles.
- **Les pièces envoyées à un ami n'arrivent pas** → les cadeaux sont des documents `coinGifts` : les règles doivent contenir le bloc `match /coinGifts/{giftId}` (lecture par l'expéditeur et par le destinataire, récupération par le destinataire, annulation/remboursement par l'expéditeur). Republie `firestore.rules`, puis recharge la page. Côté interface, un cadeau reçu s'affiche tout seul (temps réel) et reste dans « En ligne → Pièces à récupérer » après une reconnexion ; l'expéditeur retrouve ses cadeaux en attente dans « Cadeaux envoyés » et peut les annuler (remboursement immédiat) tant qu'ils ne sont pas récupérés.
- **`Missing or insufficient permissions` dans la console** → identifie la collection et l’opération signalées ; vérifie que les règles de ce projet autorisent cette requête ou écriture. Une règle à jour peut refuser une requête trop large ou des données invalides. Si les règles publiées diffèrent de `firestore.rules`, publie le bon fichier puis recharge.
- **`VM30:1 Failed to execute script … (reading 'appendChild')`** → ce n'est pas le jeu : aucune ligne du code n'utilise `appendChild` (les scripts sont classiques, `defer`, versionnés). C'est un script injecté par une extension du navigateur (bloqueur, assistant…). Vérifie en navigation privée, extensions désactivées ; si l'erreur persiste sans extension, copie la trace entière.

Quand c'est possible, le jeu retente automatiquement la connexion par redirection complète (`signInWithRedirect`) si la fenêtre Google est bloquée ; une redirection réussie ramène directement sur la collection du joueur.

### Tests

```bash
npm install --no-save jsdom          # uniquement pour les tests
npm test                             # toute la suite
node tests/auth-flow.cjs             # états du bouton de connexion Google
node tests/script-loading.cjs        # scripts classiques + defer + cache-busting
node tests/version-update.cjs        # bandeau « nouvelle version » : détection, Plus tard, Recharger
node tests/news-flow.cjs            # journal Nouveautés : brouillons privés (admin), release, badge NOUVEAU
node tests/preview-flow.cjs         # aperçus : fonctionnalité masquée aux joueurs jusqu'à la publication
node tests/card-flow.cjs             # ouverture de booster + chemins d'images
node tests/open-all-cascade.cjs      # « Ouvrir tout le pack » : éventail, cascade, Passer, mouvement réduit
node tests/social-flow.cjs           # page Compte / En ligne (amis, profil, achat marché)
node tests/deco-everywhere.cjs       # décor équipé visible partout (HUD, Compte, amis, marché, classements)
node tests/market-flow.cjs           # marché : ventes de cartes et de packs, cadeaux, récupération
node tests/global-market.cjs         # marché global : vendeurs non-amis, ajout en ami, achat direct
node tests/coin-transfer.cjs         # transfert de pièces de bout en bout (temps réel, annulation)
node tests/friend-requests.cjs       # demandes d'ami : acceptation/refus, fiche ami
node tests/permission-denied.cjs     # règles non publiées : message explicite, pas de crash
node tests/legacy-save-cleanup.cjs  # ancienne sauvegarde (freeDate/freeUsed) : champs supprimés du cloud, sauvegarde à jour acceptée
node tests/profile-save.cjs          # pseudo et photo persistés (bouton, auto-sauvegarde, HUD, échec)
node tests/shop-flow.cjs             # boutique : achats multiples, inventaire, calendrier de connexion, pack rare boosté par rang
node tests/video-pack.cjs            # Pack Vidéo : config fps/son/boucle, tirage, lecteur <video>
node tests/fusion-flow.cjs           # demande de fusion : Collection, auto-ouverture, ?demo=fusion
node tests/quest-flow.cjs            # 260 quêtes (récompenses en packs), une par chaîne, succès, niveaux, notifications
node tests/sounds-github.cjs         # bruitages GitHub : banque mp3, provenance, API Sound, cache-busting
```

## Tri de la collection

L'onglet **Collection** se trie selon plusieurs critères, juste sous les filtres de rareté : **numéro de carte**, **rareté**, **exemplaires possédés**, **valeur des exemplaires**, **nom**, **shiny** ou **ajout récente** (dernière carte obtenue). Chaque critère a un sens naturel (numéro croissant, rareté de la plus rare à la plus commune, exemplaires du plus au moins…) ; le bouton rond **⇅** inverse ce sens d'un clic. Les filtres (possédées, shiny, rareté) et le tri se combinent, et le choix est mémorisé dans le navigateur (`localStorage`, clé `refs-cards:collection-sort`) : la collection se rouvre triée comme la dernière fois. Les cartes verrouillées suivent le même tri et affichent toujours leur numéro de carte (`N° 007`), pas leur position à l'écran.

## Page Shop (boutique + inventaire)

La barre de navigation compte sept onglets : **Pack**, **Shop**, **Inventaire**, **Collection**, **En ligne**, **Quêtes** et **Compte**.

- **Ouverture depuis l’inventaire** : chaque ouverture consomme un pack. Après la première carte, « Ouvrir tout le pack » révèle le reste en une **cascade animée** (voir « Déroulé d'une ouverture »). Le récap présente les grandes cartes de la plus rare à la plus commune ; « Passer au pack suivant » lance directement un autre pack du même type, s’il en reste. Sinon, « Aller au Shop » prend le relais.
- **Six packs achetables** : **Pack Classique** (`assets/packet.png`, **500 🪙**, 5 cartes, table de référence), **Pack Rare doré** (`assets/packetrare.png`, **1 000 🪙**, 5 cartes, raretés élevées beaucoup plus fréquentes) , **Pack Double Rare** (`assets/Packraredouble.png`, **1 800 🪙**, 10 cartes aux chances du Pack Rare), **Pack Légende** (`assets/packetlegende.png`, **800 🪙**, 10 cartes, table plus basse mais deux fois plus de volume), **Pack Vidéo** (`assets/packetvideo.png`, **600 🪙**, 2 cartes animées) et **Pack Ultra Rare** (`assets/packetultra.png`, **2 200 🪙**, 5 cartes, aucune commune ni inhabituelle). Les pourcentages affichés sous le pack suivent le type choisi. Aucune garantie sur aucun palier : chaque carte est tirée indépendamment, et **aucun pack ne rembourse son prix en moyenne** (63 % à 73 % de la valeur, cf. « Équilibrage des packs »). Les cartes vidéo ne sortent jamais des autres boosters : elles restent exclusives au Pack Vidéo (visibles, verrouillées, dans la collection).
- **Achats multiples** : sélecteur de quantité (1 à 10, raccourcis ×1 / ×5 / ×10) par pack ; le bouton affiche le total et se désactive si le solde est insuffisant.
- **Calendrier de connexion** : un cadeau gratuit par jour dans la bannière 🎁 du Shop, avec un vrai calendrier mensuel (jours récupérés cochés ✓, date du jour entourée) et le défilé des 7 récompenses du cycle. Les cadeaux s'améliorent à chaque jour de connexion d'affilée : J1 1 pack classique + 150 🪙, J2 2 classiques + 200 🪙, J3 1 rare + 250 🪙, J4 700 🪙, J5 1 rare + 1 classique + 300 🪙, J6 1 légende + 400 🪙, J7 jackpot (1 vidéo + 1 légende + 1 000 🪙), puis le cycle recommence. Une journée sans connexion remet la série au J1. Sauvegarde : `playerSaves/{uid}` gagne `streakDate` (dernier cadeau récupéré), `streak` (jours d'affilée) et `claimedDays` (dates cochées du mois affiché) ; les anciennes sauvegardes « 3 gratuits/jour » (`freeDate`/`freeUsed`) migrent automatiquement (quota entamé = cadeau du jour déjà pris) et ne sont plus écrites. Pastille sur l'onglet Shop tant que le cadeau du jour n'est pas récupéré. Le premier pack offert des nouveaux comptes arrive aussi dans l'inventaire. **Republie `firestore.rules`** pour autoriser les nouveaux champs.
- **Sauvegarde** : `playerSaves/{uid}` gagne `packStock {classic, rare, legend, video}`, `freeDate` et `freeUsed` (les anciennes sauvegardes sans ces champs démarrent à 0, avec migration du premier pack offert). **Republie `firestore.rules`** pour les autoriser.

## Quêtes, succès et niveaux

- L’onglet **Quêtes** propose **260 objectifs** à difficulté croissante (66 historiques — les 4 quêtes liées aux « packs gratuits » ont été retirées —, 193 de la saison 3 et la quête légendaire « Mille boosters », 1000 boosters ouverts, peu importe lesquels → 200 XP + 1 Pack Ultra). La **première étape non réclamée de chaque chaîne** est active, regroupée en six catégories (Boosters, Collection, Raretés, Fusion & marché, Amis & niveau, Fortune) : 16 quêtes progressent en parallèle. Choisis librement leur ordre de réclamation : dès qu’une récompense est récupérée, l’étape suivante de la chaîne prend sa place. Le bouton **« Récupérer tout »** en haut du panneau réclame d’un coup toutes les récompenses prêtes (toutes catégories confondues). Les quêtes terminées restent visibles dans l’historique.
- **Récompenses variées** : en plus des pièces et de l’XP, de nombreuses quêtes offrent des **boosters** (`reward.packs`, ex. `{ rare: 1 }` ou `{ legend: 2, video: 1 }`) qui arrivent directement dans l’inventaire de l’onglet Pack. Certaines quêtes ne paient **que** des packs (ou des packs + de l’XP), sans aucune pièce : `reward.coins` vaut alors `0` et la pastille 🪙 n’est pas affichée sur la carte. Les lots en packs sont détaillés sur la carte (« 📦 1 Pack Rare + 2 Pack Vidéo ») et dans la notification de réclamation.
- **Objectifs rétroactifs (à vie)** : les quêtes se mesurent sur les valeurs absolues du compte, jamais remises à zéro. Un joueur qui avait déjà 5 cartes différentes, 30 boosters ouverts ou 3 amis avant l’arrivée des quêtes voit ces objectifs déjà validés et peut réclamer sa récompense immédiatement, sans devoir refaire l’action une seconde fois. Les récompenses prêtes restent réclamables dans n’importe quel ordre (l’en-tête affiche « · récompense prête » et la pastille de l’onglet reste allumée tant qu’une récompense attend).
- Les actions du jeu mettent les objectifs à jour automatiquement : ouvertures et achats de packs, fusions, collection, raretés, amis et ventes encaissées sur le marché. Chaque quête terminée donne les **pièces et/ou l’XP** indiquées sur sa carte, parfois uniquement des boosters.
- Les **28 succès** sont indépendants de l’ordre des quêtes : ils se débloquent dès que leur condition est remplie et rapportent de l’XP. Les succès déjà accomplis par un ancien compte sont repris silencieusement au premier chargement du système.
- L’XP des quêtes et des succès fait progresser les niveaux. Il faut 100 XP pour passer du niveau 1 au niveau 2, puis 200 XP supplémentaires pour le niveau 3, 300 pour le niveau 4, etc. Le niveau donne une progression et des succès dédiés ; il ne crédite pas de pièces.
- La cloche ouvre l’historique des **50 notifications les plus récentes** (quêtes prêtes ou réclamées, succès, niveaux, demandes d’ami, ventes encaissées et cadeaux de connexion). Le badge compte les notifications non lues ; « Tout marquer comme lu » les acquitte. Pour de **vraies notifications du téléphone** (bandeau système, hors du jeu), voir la section « Notifications hors jeu » : le joueur y choisit lui-même les catégories qu’il veut recevoir.
- **Sauvegarde cloud** : quêtes terminées, succès, XP, notifications et compteurs cumulés sont enregistrés dans `playerSaves/{uid}`. Les compteurs (`packsOpened`, `fusions`, `packsBought`, `marketSales`, `marketEarned`, `marketBuys`) valident les quêtes et les succès dès le premier chargement du système, sans base de progression séparée : l’ancien champ `questBaseline` n’est plus écrit et reste simplement toléré (il est ignoré) pour les anciennes sauvegardes ; les anciens champs `freeDate`/`freeUsed` sont supprimés du document au chargement et également tolérés par les règles. Republie `firestore.rules` après modification des règles Firestore.

## Classements

Dans **En ligne → Classement**, deux top 20 affichent le solde actuel et le nombre cumulé de boosters ouverts, avec actualisation manuelle et à l'ouverture. Les données proviennent des profils publics `playerProfiles`, déjà lisibles par les joueurs connectés : elles ne donnent pas accès aux sauvegardes privées. Les profils sont actualisés lors de la connexion et des sauvegardes du joueur ; ils ne sont donc pas en temps réel et les anciens profils sans compteur de boosters n'apparaissent dans ce classement qu'après la prochaine connexion de leur propriétaire. Comme les autres statistiques du jeu, ces données sont produites par le client et ne constituent pas un classement anti-triche. Les ex æquo sont départagés par l'ordre des documents Firestore.

Une notification dans la cloche annonce la nouveauté une fois par compte lors de sa prochaine connexion. **Déployer `firestore.rules` avant la nouvelle version du site** (`firebase deploy --only firestore:rules`) : le marqueur `leaderboardAnnounced` est ajouté aux sauvegardes et sans ces règles leurs écritures seraient refusées. Les notifications système suivent les réglages « nouveautés » existants et ne sont pas des push à destination des joueurs hors ligne.

## Notifications hors jeu (vraies notifications du téléphone)

En plus de la cloche interne (historique des 50 dernières notifications, dans la sauvegarde), le jeu peut envoyer de **vraies notifications du système** — bandeau Android, bannière iOS, notification Windows/macOS — quand le joueur n'est pas dans le jeu.

- **Le joueur choisit ce qu'il reçoit.** Une fenêtre « Quelles notifications veux-tu recevoir ? » liste huit catégories, chacune avec son interrupteur : 🗺️ quêtes prêtes, 🏆 succès, ⭐ niveaux, 👥 demandes d'ami, 🪙 marché (vente conclue, offre reçue, pièces envoyées), 🎲 défis pile ou face, 🎁 cadeau de connexion, 📣 nouveautés et promos (cochée **désactivée** par défaut : le marketing n'est jamais imposé). La question est posée **une seule fois**, à la première visite, jamais par-dessus une annonce ou une ouverture de pack, et le bouton « Tester » vérifie immédiatement que tout marche. Les réglages sont ensuite accessibles à tout moment depuis la **cloche → « Choisir »** et depuis **Compte → Notifications du téléphone**, avec « Activer / Réactiver », « Désactiver » et « Tester ».
- **La permission n'est jamais demandée sans geste** : elle ne l'est qu'au clic sur « Activer les notifications ». Sur iPhone/iPad (iOS 16.4+), iOS n'autorise les notifications que pour une application **ajoutée à l'écran d'accueil** : le panneau l'explique avec la marche à suivre (Partager → « Sur l'écran d'accueil »). Sur ordinateur et Android, le jeu demande simplement l'autorisation du navigateur.
- **« Hors jeu » veut dire hors du jeu** : une notification système n'est envoyée que si le jeu n'est pas sous les yeux (`document.visibilityState === 'hidden'`). Jeu ouvert au premier plan, la cloche et les toasts suffisent — sauf le bouton « Tester », qui force volontairement l'envoi. Les catégories décochées ne produisent jamais de notification, même en arrière-plan.
- **Réglages par compte, sur l'appareil** : `push.js` enregistre les préférences dans `localStorage` (`refs-cards:push:<uid>`), sans rien envoyer au serveur et sans modifier `firestore.rules`.
- **Service worker `sw.js`** (obligatoire sur Android, où `new Notification()` est refusé) : il affiche les notifications (`registration.showNotification`) et, au clic, ramène le joueur dans le jeu (`notificationclick` → onglet existant remis au premier plan, sinon ouverture). Il ne gère **aucun cache** et n'intercepte aucune requête : la mise à jour du site reste celle de `version-check.js`. `firebase.json` et `server.js` servent `sw.js` avec `Cache-Control: no-cache`.
- **Déclencheurs** : quête prête, quête réclamée, succès, niveau, demande d'ami reçue, vente conclue, pièces / cadeaux reçus, offre reçue ou acceptée, défi pile ou face reçu / gagné / perdu / refusé, cadeau du jour, nouvelles cartes et promos. Chaque nature a son `tag` : une nouvelle notification de la même famille **remplace** la précédente au lieu d'empiler les bannières.
- **Limite assumée** : sans serveur de push (Firebase Cloud Messaging + Cloud Functions), la notification ne peut partir que **tant que le jeu est ouvert dans un onglet**, même réduit ou en arrière-plan — c'est là que les écoutes temps réel Firestore signalent une demande d'ami, une vente ou un défi. `sw.js` écoute déjà l'évènement `push` (format `{ title, body, url, kind }`) : brancher FCM plus tard n'exigera aucune modification du code du jeu.
- Test : `node tests/push-notifications.cjs` (catégories, préférences par compte, filtres hors jeu, service worker, interface, dégradations).

## Pages Compte et En ligne (amis, marché, achats)

### Page Compte

- **Photo de profil en grand** en haut : bouton 📷 pour téléverser une image (recadrée en carré, réduite à 256 px en JPEG, stockée dans le profil public — pas besoin de Firebase Storage). La photo est écrite dans le profil cloud dès le choix du fichier et s'affiche partout (page Compte **et** avatar du HUD) ; si l'écriture échoue, l'ancienne photo est restaurée et un message l'explique.
- **Avatar par défaut** : un joueur **sans photo** (aucune image choisie) affiche l'image de base du jeu, `assets/default-avatar.png` — partout où une photo apparaît : HUD, page Compte, listes d'amis et de demandes, fiche d'un ami, vendeurs du marché global et classements. La photo Google **n'est plus utilisée** comme repli (le bouton « Utiliser ma photo Google » a été retiré) : les comptes Google qui n'ont qu'une image « initiale » ne montrent plus de rond bleu. Une photo Google cassée ou supprimée retombe aussi sur l'image de base (`onerror`). Le fichier est remplaçable tel quel (même nom) et sert également de socle à l'aperçu de l'éditeur de chapeaux.
- **Pseudo modifiable** (1 à 24 caractères), affiché en haut de la page et dans le HUD à la place de l'adresse e-mail. Cliquer sur l'avatar ou le nom dans le HUD ouvre cette page. Le pseudo est sauvegardé dans le profil cloud via le bouton « Enregistrer » **et automatiquement** après la frappe (sans attendre le bouton) ; en cas d'échec de sauvegarde, l'ancien pseudo est restauré avec un message d'erreur plutôt qu'un faux « mis à jour ».
- **Code ami** stable de la forme `REFS-XXXXXX`, dérivé de l'uid du compte, avec bouton « Copier ». Il est enregistré dans l'annuaire `friendCodes/{code}` pour être retrouvé par les amis.
- **Statistiques** : pièces, cartes totales, cartes uniques (x / total), doublons, valeur de la collection (somme des récompenses), meilleure rareté, boosters ouverts, amis, niveau et quêtes terminées, plus le détail des cartes par rareté.
- **Décor équipé, visible partout** : les chapeaux du Shop → Déco (**Chapeau de Noël**, **Chapeau de cowboy**, **Sombrero**, **Béret rouge** et **Chapeau One Piece**, 1 500 🪙 pièce) ne restent plus sur l'onglet Compte. Une fois équipé, le chapeau se pose **sur** ta photo, bien cadré sur le haut du visage **partout** : HUD en haut de l'écran, page Compte, listes d'amis et de demandes d'ami, fiche d'un ami, vendeurs du marché global et classements. Un seul décor est équipé à la fois : en choisir un autre remplace le précédent. Le décor des autres joueurs arrive avec leur profil public (champ `deco` de `playerProfiles`), donc chacun voit le chapeau de ses amis. Depuis l'onglet **Déco**, chaque chapeau s'achète puis s'équipe ou se retire à tout moment. Pour en ajouter un : une image dans `assets/deco/`, une entrée dans `DECO_IMAGES` / `DECO_PRICES` / `DECO_LABELS` de `app.js` (le registre `DECO_TYPES` pilote le Shop, les boutons et l'éditeur), une carte `.deco-card[data-deco]` dans `index.html`, et incrémenter `app.js?v=` + `<meta name="app-version">`. Test : `node tests/deco-everywhere.cjs`.
- **Éditeur de chapeaux (administration)** : dans **Compte → 🛠️ Administration**, le compte propriétaire (`ninotelephone1006@gmail.com`) voit un aperçu de photo de profil et quatre curseurs par chapeau (position horizontale, position verticale, taille, rotation) — le chapeau se glisse aussi directement sur l'aperçu. Choisir un chapeau dans la liste (ou le taper au clavier, ex. « chapeau one piece ») charge son propre réglage et son visuel. **« Enregistrer » publie tous les réglages d'un coup pour tout le monde** dans le profil public du créateur (`playerProfiles.decoLayout`, lu par tous les joueurs connectés) : les chapeaux bougent immédiatement chez les joueurs en ligne via l'écoute temps réel, restent en place après rechargement / déconnexion, et **aucune notification, annonce ou toast n'est émis**. Le rendu suit le réglage partout (HUD, Compte, amis, marché global, classements) grâce aux variables CSS `--deco-*` ; `scale` est un multiplicateur, ce qui conserve les tailles propres à chaque contexte. « Réinitialiser » remet le chapeau sélectionné aux valeurs d'origine (il faut enregistrer pour publier). Si les règles Firestore sont redéployées, seul ce compte peut écrire `decoLayout`.

### Page En ligne

- **Demande d'ami par code** : saisis le code ami d'un joueur (`REFS-XXXXXX`, le préfixe, les tirets et la casse sont tolérés), l'annuaire retrouve son uid et une **demande d'ami** est créée (`friendRequests/{moi}__{lui}`, statut `pending`). Personne n'est ajouté d'office : le destinataire doit **accepter**.
- **Demandes reçues / envoyées** : la page En ligne liste les demandes reçues avec **Accepter** / **Refuser** et les demandes envoyées en attente (avec **Annuler**). Quand le destinataire accepte, **les deux joueurs deviennent amis** : chacun enregistre l'autre dans sa propre liste (`friends` de sa sauvegarde privée) — immédiatement si l'expéditeur est en ligne (temps réel), sinon à sa prochaine connexion. Une demande refusée n'ajoute aucun ami. Les demandes acceptées servent aussi à réparer automatiquement une liste d'amis manquante, y compris pour les anciens comptes où `applied` avait été marqué trop tôt. Un retrait volontaire est mémorisé sur les demandes afin de ne pas réajouter l'ami. Les retraits effectués avant cette correction n'ayant pas été enregistrés sur les demandes, une ancienne amitié acceptée peut toutefois réapparaître une fois et être retirée à nouveau.
- **Profil d'un ami** : photo, pseudo, statistiques (relues à chaque ouverture, pour que le solde affiché suive les pièces reçues), **ses amis** (les amis que tu as en commun avec lui en premier, avec un badge « En commun », puis les autres par pseudo) et collection — **sans aucun bouton « Échanger »** : on ne peut plus demander une carte précise à un ami. Son marché figure séparément dans « Son marché ».
- **Créer son marché** : dans « Mon marché », choisis librement quoi vendre. Pour les **cartes** : la carte, le nombre d'exemplaires à vendre (1 par défaut, de 1 jusqu'à ton stock) et le prix par carte (entier libre de 0 à 1 milliard de pièces). Pour les **packs** : le type (Pack Classique ou Pack Rare doré), le nombre de packs et le prix par pack, tout aussi libre. Seules les quantités choisies sont retirées de la collection / de l'inventaire et réservées ; « Retirer de la vente » / « Retirer 1 » / « Tout retirer » les rend tant qu'elles n'ont pas été achetées.
- **Marché global** : la section « 🌍 Marché global » de la page En ligne liste **toutes les annonces du jeu**, y compris celles de joueurs qui ne sont pas tes amis. Chaque vendeur apparaît avec son pseudo (et sa photo), ses offres groupées (« ×3 dispo »), le prix et un bouton **Acheter** direct ; s'il n'est pas déjà ton ami, un bouton **Ajouter en ami** envoie la demande habituelle (à accepter), et l'état « Demande envoyée » s'affiche ensuite. Un champ de filtre (carte, pack ou pseudo) et un tri (plus récentes / prix croissant / prix décroissant) facilitent la recherche, « Actualiser » recharge la liste. Tes propres annonces ne sont pas listées ici : elles restent dans « Mes annonces en cours ».
- **Le marché de l'ami** : sur son profil, « Son marché » liste tout ce que cet ami propose (cartes et packs), avec le nombre disponible et son prix. Choisis combien en acheter (1 par défaut quand plusieurs copies sont disponibles) et confirme. Chaque achat débite l'acheteur et lui remet la carte (ou les packs, qui arrivent dans l'onglet Pack) en une transaction. Le vendeur récupère ensuite les pièces dans « Pièces à récupérer », même après une déconnexion. Utilise « Actualiser » pour voir les nouvelles ventes et les cadeaux.
- **Donner des pièces** : ouvre le profil d'un ami, indique un montant entier positif et confirme. Les pièces sont débitées immédiatement et restent réservées jusqu'à leur récupération par le destinataire. Un solde insuffisant, une carte déjà vendue ou une collection pleine bloque l'opération.
- **Arrivée en temps réel** : tant que l'onglet « En ligne » est affiché, le destinataire n'a pas besoin de cliquer sur « Actualiser » ni de recharger la page. Les cadeaux reçus arrivent tout seuls (`onSnapshot` sur `coinGifts` filtré par `toUid`), un message prévient « Un tel t'a envoyé N pièces » et le compteur « Pièces à récupérer » se met à jour. La page En ligne recharge aussi ces données à chaque ouverture de l'onglet, et chaque requête (mes ventes, cadeaux reçus, cadeaux envoyés) est indépendante : un refus de règles sur l'une d'elles n'efface plus les autres. **Le temps réel n'est branché que lorsque l'onglet « En ligne » est ouvert** (et que la page est visible) : c'est volontaire, voir « Quota gratuit Firestore ».
- **Cadeaux envoyés · Annuler** : la section « Cadeaux envoyés » liste les pièces encore en attente, avec **Annuler**. Tant que le destinataire n'a pas récupéré le cadeau, l'annulation le rembourse immédiatement (transaction atomique). Plus aucune pièce n'est perdue si le destinataire ne récupère jamais.
- **Échanges à la demande désactivés** : il n'y a plus de moyen de demander une carte précise à un ami (l'ancien système `trades/` a été retiré de l'interface, des règles et du code). Pour obtenir une carte ou un pack, il faut acheter une annonce : dans le marché global (n'importe quel vendeur) ou sur le profil d'un ami.
- **🎲 Jeux · Pile ou face** : un onglet « Jeux » propose un défi 1v1 entre amis sur une pièce. Le créateur choisit sa mise (la somme qu'il veut) et son côté (pile ou face) ; la mise est réservée à l'envoi. L'ami voit la mise adverse, choisit la sienne et son côté, puis relève le défi (ou le refuse, ou le créateur annule et est remboursé). La pièce tourne alors en animation — deux textures pixel art, **P** pour pile et **F** pour face — et celui qui a choisi le côté qui tombe remporte la somme des deux mises, qu'il récupère après la partie. Les parties en cours et l'historique s'affichent en temps réel.

Les annonces (`marketListings`, une annonce porte soit `cardId`, soit `packType` pour un pack), cadeaux (`coinGifts`) et défis de pile ou face (`coinFlips`) sont enregistrés dans Firestore. Chaque mise en réserve, achat, annulation ou récupération est une transaction atomique ; les annonces en vente sont lisibles par tout joueur connecté et achetables par n'importe qui (marché global), et les règles limitent les changements d'état aux parties concernées (`claimed` par le destinataire, `cancelled` par l'expéditeur, qui est alors remboursé) et vérifient la modification de leur sauvegarde. Il faut publier les nouvelles règles avec `firebase deploy --only firestore:rules`. Les transactions nécessitent une connexion Internet. La limite de solde est de 1 milliard de pièces ; si la réception la dépasse, dépense d'abord des pièces puis récupère le montant.

**Limite de sécurité existante :** la logique de jeu et la sauvegarde personnelle restent contrôlées par le client, qui peut modifier ses propres pièces et cartes. Les transactions évitent les achats simultanés et les récupérations répétées dans le fonctionnement normal, mais ne constituent pas une protection anti-triche complète ; une économie fiable exige un serveur de confiance et des règles de sauvegarde plus restrictives. Évite aussi de jouer au même compte sur plusieurs appareils simultanément : les sauvegardes classiques ne sont pas synchronisées entre sessions.

## Quota gratuit Firestore : rester sous les 50 000 lectures/jour

Le plan Spark compte **chaque document lu** (y compris l'instantané initial d'un `onSnapshot` et chaque mise à jour reçue) et **chaque document écrit**. Bien avant d'être plein en stockage, un jeu qui garde des écoutes ouvertes peut donc épuiser ses lectures — et Firestore refuse alors les transactions (`resource-exhausted`), ce qui se voit surtout quand on envoie des pièces ou qu'on achète. Le jeu applique donc ces règles :

- **Le réseau social n'est branché que sur l'onglet « En ligne ».** À la connexion, seules la sauvegarde, le profil, les demandes d'ami et les défis sont lus (quelques documents). Les 10 écoutes temps réel (marché, cadeaux, offres, demandes, défis) démarrent à l'ouverture de « En ligne » (`openSocialHub()`) et sont **fermées** quand on quitte l'onglet ou que la page passe en arrière-plan (`teardownSocialLive()`). En arrière-plan prolongé, un rafraîchissement espacé (4 min) suffit aux badges et aux notifications hors jeu.
- **Une seule requête « annonces ouvertes » partagée.** Le marché global et les ventes de la fiche d'un ami utilisent la même requête (une lecture par annonce ouverte). Elle est partagée entre appelants simultanés (`fetchGlobalListings`), gardée en cache 2 minutes et invalidée par les transactions plutôt que relue à chaque visite (`GLOBAL_MARKET_TTL_MS`, `invalidateGlobalMarket`).
- **Les profils déjà connus ne sont pas relus.** Les pseudos/avatars des amis et des vendeurs restent en cache (`friendProfiles`) ; la fiche d'un ami est relue seulement à l'ouverture (pour afficher un solde à jour).
- **Les salves sont groupées.** Un cadeau ou une offre reçue déclenche un rafraîchissement unique après 2,5 s (`refreshSocialLive`), pas une relecture par document.
- **Un message adapté en cas de quota épuisé.** `isQuotaExceeded()` reconnaît `resource-exhausted` ; les actions (envoyer des pièces, acheter, relever un défi) affichent alors « Quota gratuit Firestore atteint… remise à zéro à minuit heure du Pacifique » au lieu du message des règles Firestore. `noteCloudError()` prévient une fois par session.
- **Vérification** : `node tests/read-budget.cjs` (lancé par `npm test`) compte les lectures d'une session simulée et contrôle ces économies. Si le quota est atteint malgré tout, deux leviers : alléger les visuels (WebP, voir la taille des `assets/`), ou héberger le site statique chez un hébergeur gratuit à bande passante illimitée (Cloudflare Pages, GitHub Pages) en gardant Firebase uniquement pour la connexion Google et Firestore — il faut alors ajouter le nouveau domaine dans **Authentication → Settings → Authorized domains**.

## Déroulé d'une ouverture

1. **Découpe manuelle** : le booster flotte au centre (parallaxe souris, `touch-action: none`). Une ligne de découpe lumineuse, guidée par une flèche, attend à 15 % du haut. Glisser vers la droite (doigt ou souris) fait progresser la coupe de 0 à 100 % : trait incandescent, gerbe d'étincelles, rabat soulevé en `clip-path`, bruit de papier/plastique dont le timbre suit la vitesse du geste.
2. **Seuil** : relâché avant 75 %, le paquet revient en place avec un rebond élastique (et un léger craquement). À partir de 75 %, la déchirure s'achève : le haut s'envole en tournoyant dans un flash, éjecte la pile de cinq cartes et déclenche le *pop* d'ouverture.
3. **Pile de cartes** : les cinq cartes sont triées de la moins rare à la plus rare, la plus rare au fond. Un clic retourne la carte du dessus (`rotateY`), avec parallaxe/tilt et reflet holographique qui suit le curseur. Les treize raretés ont leur mise en scène, regroupée en trois paliers d'effets : halo coloré (Commune, Inhabituelle), anneau + étincelles (Rare, Super Rare), ralenti + tremblement d'écran (Épique, Ultra épique), rayons rotatifs + pluie + hologramme (Légendaire, Mythique, Divine, Secrète).
4. **Rangement** : après l'avoir révélée, touche la carte pour la manipuler (tilt/parallaxe), puis appuie sur **Carte suivante** (ou clique à côté dans la table) pour la faire glisser vers le récapitulatif (whoosh) et dévoiler la suivante. Au clavier, Entrée/Espace range la carte révélée. Une fois les cinq cartes rangées, le bouton **Aller au Shop** apparaît (les packs s'achètent dans la boutique et vont dans l'inventaire).
5. **Ouvrir tout le pack** : dès la première carte retournée, ce bouton ouvre le reste de la pile en une cascade. Les cartes restantes **s'étalent sur la table** (une rangée sur grand écran, deux ou trois sur mobile, taille calculée pour que tout reste visible), **se retournent une à une** de la moins rare à la plus rare, chacune avec sa gerbe de particules ; la **plus rare du lot** est mise en avant (agrandie, halo, bandeau, jingle et effets de son palier), puis les cartes **filent l'une après l'autre vers leur case du butin** avant l'affichage du récap. Les pièces et la collection se mettent à jour au rythme des retournements, exactement comme en révélation manuelle. Pendant la cascade, le bouton devient **« Passer »** : lui, un toucher sur la table, Entrée, Espace ou Échap sautent directement au récap (le double-clic sur « Ouvrir tout » est protégé par un court délai). Une carte au-dessus de Divine encore cachée joue d'abord sa mise en scène complète, puis la cascade enchaîne. Avec `prefers-reduced-motion`, l'ouverture reste instantanée. Si le lot contient de nouvelles cartes, l'onglet Collection réagit une seule fois (« ✦ N nouvelles cartes ! »).
6. **Demande de fusion** : à la fin du booster (ou dès qu'un doublon existe), une **demande de fusion** s'ouvre : chaque paire de cartes identiques peut être échangée contre une carte de la rareté supérieure (la fusion est sans risque, les légendaires étant au sommet). Elle est aussi accessible à tout moment depuis l'onglet **Collection**, via le bouton `DEMANDE DE FUSION · N DOUBLON(S)` affiché au-dessus de la grille.

## Mise en page : barre d'onglets toujours collée en bas

La barre de navigation est le dernier élément de la colonne `.app` : elle ne reste en bas que si la coquille fait **exactement** la hauteur de l'écran. Sur mobile, `100dvh` n'est pas toujours recalculé quand la barre d'adresse se replie, quand un rebond de scroll est en cours ou quand le clavier s'ouvre — la barre « décrochait » alors et tout le contenu sautait.

- **Le document ne défile jamais** : `html` et `body` sont verrouillés (`height: 100%`, `max-height: 100%`, `overflow: hidden`). Ce sont les vues qui défilent (`.page-scroll`, `.coll-scroll`, `.inventory-view`…), chacune avec `overscroll-behavior: contain`.
- **Hauteur mesurée, pas devinée** : `app.js` publie la hauteur réellement visible dans la variable CSS `--app-h` (écoutée sur `resize`, `orientationchange`, `visualViewport` `resize`/`scroll` et un `ResizeObserver` sur `<html>`). `.app` l'utilise (`height: var(--app-h, 100dvh)`), avec `100dvh` en repli si le script n'a pas encore tourné.
- **Clavier ouvert** : une zone visible nettement plus courte que la mise en page (clavier, zoom de saisie) est ignorée, sinon la coquille se replierait et la barre d'onglets remonterait au milieu de l'écran pendant une saisie (pseudo, prix, recherche…). Les feuilles de dialogue restent limitées à `82dvh` et défilent d'elles-mêmes.
- **Vérification** : `node tests/tabbar-stability.cjs` (lancé par `npm test`) contrôle le verrouillage du document, la mise à jour de `--app-h` (barre d'adresse, clavier, rebond) et le repli sur `innerHeight` sans `visualViewport`.

## Son

Tous les bruitages sont de **vrais fichiers audio téléchargés depuis GitHub** : les signaux sonores de Visual Studio Code (dépôt public [`microsoft/vscode`](https://github.com/microsoft/vscode), licence MIT), rangés dans `assets/sounds/` avec leur provenance complète (`CREDITS.md` : fichier, usage, lien au commit figé ; `LICENSE-vscode.txt` : la licence). Déchirement continu du booster (boucle modulée par la vitesse du geste, craquements tirés des blips de diff), *pop* d'ouverture, *whoosh* de rangement, *tick* au survol, `cha-ching` à l'achat, et un jingle propre à chaque rareté (du simple « commande réussie » jusqu'à « tâche terminée + confettis + carillons »). Le moteur `audio.js` décode les mp3 en Web Audio API, cale chaque couche à l'heure près, applique les fenêtres de lecture utiles (les fichiers d'origine ont du silence en tête et une longue traîne muette) et égalise les volumes entre eux. Si un fichier manque ou si le navigateur n'a pas d'AudioContext, le jeu continue simplement sans bruitage. Le bouton haut-parleur coupe/rétablit le son.

Pour changer un son : déposer le mp3 dans `assets/sounds/`, re-mesurer sa fenêtre utile et sa crête (voir `CREDITS.md`), mettre à jour la table `CUES` et `SOUND_VERSION` dans `audio.js`, puis incrémenter le `?v=` d'`audio.js` dans `index.html` — `node tests/sounds-github.cjs` (dans `npm test`) vérifie la cohérence de tout ça.

### Son sur iPhone / iPad (Safari)

Le Web Audio de Safari a trois particularités qui rendaient le jeu muet sur iPhone ; `audio.js` les traite toutes les trois :

- **Déblocage.** Safari ne compte pas `pointerdown` (le doigt qui se pose) comme geste d'activation : un `AudioContext` créé là reste « suspended ». `Sound.gesture()` est donc appelé par `app.js` sur `pointerup`, `touchend`, `click` et `keydown`, et le contexte est repris à chaque geste tant qu'il ne tourne pas (un échantillon muet est joué dans le geste, et un petit *tick* confirme que le son est bien actif).
- **Interruptions.** Après un appel, un verrouillage ou un passage dans une autre app, iOS laisse le contexte dans l'état « interrupted » (ni « running » ni « suspended ») : il est repris au geste suivant, au retour dans le jeu (`visibilitychange`, `pageshow`, `focus`) et dès qu'un son est demandé.
- **Bouton silencieux.** iOS joue le Web Audio sur le canal « ambient », que le bouton silencieux coupe. Le moteur demande donc le canal « playback » (`navigator.audioSession.type = 'playback'`, Safari 16.4+) et, sur les iOS plus anciens, entretient une boucle `<audio playsinline>` (0,12 s de silence WAV intégré en base64, média audible mais fichier silencieux — iOS n’accorde le canal média qu’à un média audible) qui bascule la page sur le canal média : les bruitages sortent même avec l'iPhone en silencieux, comme une vidéo. Le bouton haut-parleur du HUD reste le seul interrupteur du son du jeu.

`node tests/ios-audio.cjs` (dans `npm test`) simule un iPhone : contexte suspendu puis « interrupted », `audioSession` présent ou non, absence de doublon de la boucle muette, et vérifie que `app.js` écoute bien le doigt levé et non plus seulement `pointerdown`.

## Paramètres utiles

- `?demo=1` : force un tirage de démonstration (aperçu de plusieurs raretés).
- `?demo=fusion` : pack de démonstration contenant deux paires identiques ; la **demande de fusion** s'ouvre toute seule après les cinq cartes (aucun pack consommé).
- `?demo=video` : sélectionne le **Pack Vidéo** et ouvre une démo des deux premières cartes vidéo configurées dans `cards.js` (quelles qu'elles soient).
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
  rarity: 'rare',              // voir les treize raretés ci-dessous
  emoji: '😎',                 // secours si le visuel manque
  image: 'ma-carte',           // nom de fichier dans assets/Cartes/ (sans extension)
  color: '#a2d8ef'             // fond de secours
}
```

`image` peut être un simple nom de fichier ou un chemin complet (`assets/Cartes/ma-carte.jpg`). Sans extension, l'application essaie automatiquement `.png`, `.jpg`, `.jpeg`, `.webp` puis `.avif` : il suffit donc de déposer `assets/Cartes/ma-carte.png` pour que la carte l'utilise. Si aucun visuel n'est trouvé, l'emoji et la couleur de secours prennent le relais.

**Format d'une carte** : ratio strict **5:7** partout (révélation, miniature du butin, inspection en grand, aperçus de fusion), coins arrondis, image plein cadre en `object-fit: cover`. Le titre est posé en haut sur un dégradé sombre avec un badge de rareté coloré ; la description est posée en bas sur un dégradé progressif ; l'identifiant apparaît en tout petit en bas à droite. Les effets de rareté (bordure, reflet holographique, lueurs, rayons) passent par-dessus ou autour de l'image sans la masquer.


### Cartes vidéo (Pack Vidéo)

Une carte reste une carte normale : on ajoute simplement un bloc `video`. Elle conserve donc sa rareté, sa récompense, ses effets, la fusion, la collection et le marché. Le projet livre une carte vidéo : **Le Sapin George** (`sapin-george`), rare, « skibidi sapin », 30 i/s avec son et en boucle (`assets/Cartes/videos/GeorgeSapin.mp4`) — sans image de secours, la vidéo est elle-même la couverture de la carte. Pour en ajouter d'autres, dépose tes fichiers `.mp4` (ou `.webm`) dans `assets/Cartes/videos/` et configure les cartes. Le Pack Vidéo ne tire que les cartes qui possèdent un bloc `video` valide. Ces cartes ne sortent jamais des autres boosters : elles restent exclusives au Pack Vidéo (visibles, verrouillées, dans la collection). Une carte vidéo peut aussi être **Shiny** : la mutation conserve le lecteur et les réglages `fps` / `sound` / `loop`.

```js
{
  id: 'mon-clip',
  name: 'Mon clip',
  description: 'Une carte qui bouge.',
  rarity: 'epic',
  emoji: '🎬',
  image: 'assets/Cartes/mon-affiche.jpg', // affiche fixe + secours (optionnel)
  color: '#b47bff',
  video: {
    src: 'mon-clip',                  // → assets/Cartes/videos/mon-clip.mp4
    fps: 30,                         // 24, 30, 60 ou null (fréquence native)
    sound: true,                     // false par défaut
    loop: true                       // true par défaut
  }
}
```

| Clé `video` | Rôle | Défaut |
| --- | --- | --- |
| `src` | Source principale. Nom simple → `assets/Cartes/videos/<nom>.mp4` (puis `.webm`) ; un chemin complet est utilisé tel quel. | — |
| `srcByFps` | Variantes par fréquence, ex. `{ 24: 'clip-24', 60: 'clip-60' }`. Le lecteur prend la variante qui correspond à `fps` (la plus proche sinon). | `{}` |
| `fps` | Fréquence demandée. Choisit la variante `srcByFps` ; affichée sur la carte. `null` = native. | `null` |
| `sourceFps` | Fréquence réelle du fichier. Si elle diffère de `fps`, la vitesse de lecture est ajustée (`playbackRate = fps / sourceFps`) : 24 i/s sur un fichier 60 i/s donne un vrai ralenti ×0,4. | `null` |
| `sound` (ou `hasAudio`) | Active le son. Le lecteur démarre **muet** (politique d'autoplay des navigateurs) puis un bouton 🔊 ou le clic de révélation active l'audio. | `false` |
| `loop` | Lecture en boucle. `false` laisse la vidéo s'arrêter sur sa dernière image. | `true` |
| `poster` | Affiche fixe explicite. Sinon `image` sert d'affiche. | `image` |
| `autoplay` | Lecture automatique (muette) dès que la carte est visible. | `true` |
| `preload` | `metadata`, `auto` ou `none`, transmis au `<video>`. | `metadata` |

**Raccourcis** : `video: 'mon-clip'` équivaut à `video: { src: 'mon-clip' }` ; `video: true` cherche automatiquement `assets/Cartes/videos/<id de la carte>.mp4` (pratique quand le fichier porte le même nom que la carte).

Le lecteur est utilisé partout : révélation, récap miniature, collection, inspection en grand. Les miniatures ne décodent la vidéo que lorsqu'elles sont visibles, et le son ne se cumule jamais : il faut un clic sur la carte ou sur 🔊. Les vidéos vivent dans `assets/Cartes/videos/` : toutes les cartes dotées d'un bloc `video` valide entrent automatiquement dans le Pack Vidéo, et `?demo=video` ouvre les deux premières. Voir aussi `assets/Cartes/videos/LISEZ-MOI.txt`.

> **Règles Firestore** : `packStock` accepte maintenant la clé `video`. Republie `firestore.rules` (`firebase deploy --only firestore:rules`) avant de sauvegarder un Pack Vidéo, sinon le cloud refusera l'écriture.

### Les raretés

L'échelle compte **treize paliers strictement croissants** : chaque palier est à
la fois plus rare et plus précieux que le précédent, sans exception. « Légendaire »
passe **avant** « Mythique » (le mythe est au-dessus de la légende) et les trois
paliers « Secrète » ferment la marche, au-delà du tirage normal. Une carte ne
change jamais de palier : seule sa valeur de revente varie avec les doublons.

| Rang | Clé | Libellé | Récompense | Palier d'effets |
| ---: | --- | --- | ---: | --- |
| 0 | `common` | Commune | 35 🪙 | calm |
| 1 | `uncommon` | Inhabituelle | 55 🪙 | calm |
| 2 | `rare` | Rare | 100 🪙 | rare |
| 3 | `superrare` | Super Rare | 165 🪙 | rare |
| 4 | `epic` | Épique | 285 🪙 | epic |
| 5 | `ultraepic` | Ultra épique | 470 🪙 | epic |
| 6 | `legendary` | Légendaire | 770 🪙 | gold |
| 7 | `mythic` | Mythique | 1 250 🪙 | gold |
| 8 | `divine` | Divine | 2 000 🪙 | gold |
| 9 | `secret` | Secrète | 3 300 🪙 | gold |
| 10 | `ultrasecret` | Ultra Secrète | 5 200 🪙 | gold |
| 11 | `hypersecret` | Hyper Secrète | 8 800 🪙 | gold |
| 12 | `unique` | Unique | 14 000 🪙 | gold |

Les valeurs montent d'environ **×1,6 par palier**, avec un vrai saut sur les
Secrètes : une Unique vaut 400 fois une Commune. C'est ce qui rend l'échelle
lisible — chaque cran se voit dans la revente, la fusion et le butin.

La colonne `weight` de `RARITIES` n'est qu'un repère historique : **le tirage
utilise uniquement `PACK_TABLES`**. `PACK_SLOTS` décrit un slot par carte
(tous « standard » : aucun palier n'est offert, la structure accepte un
`minRank` pour une future offre). Si une rareté manque dans le pool (pack
vidéo), les poids sont renormalisés sur les raretés présentes.

La **fusion** combine deux cartes identiques en une carte du palier `next`,
plafonnée à **Ultra épique** (`FUSION_MAX_RANK`) : Légendaire et au-delà ne
s'obtiennent qu'en ouvrant des boosters.

### Équilibrage des packs

Taux par carte (les poids sont relatifs, renormalisés sur 100 %) :

| Rareté | Classique | Rare / Double Rare | Légende | Vidéo | Ultra |
| --- | ---: | ---: | ---: | ---: | ---: |
| Commune | 55,61 % | 21,18 % | 63,86 % | — | — |
| Inhabituelle | 24,75 % | 25 % | 23,24 % | — | — |
| Rare | 12,38 % | 25 % | 9,30 % | 39,85 % | 19,95 % |
| Super Rare | 4,95 % | 15 % | 2,71 % | — | 21,94 % |
| Épique | 1,73 % | 8 % | 0,70 % | 60,07 % | 30,92 % |
| Ultra épique | 0,43 % | 4 % | 0,155 % | — | 20,95 % |
| Légendaire | 0,10 % | 1,3 % | 0,031 % | — | 4,59 % |
| Mythique | 0,03 % | 0,4 % | 0,008 % | — | 1,20 % |
| Divine | 0,008 % | 0,09 % | 0,0015 % | — | 0,35 % |
| Secrète | 0,002 % | 0,02 % | 0,0003 % | — | 0,08 % |
| Ultra Secrète | 0,0006 % | 0,005 % | 0,0001 % | — | 0,02 % |
| Hyper Secrète | 0,00015 % | 0,0012 % | 0,00002 % | 0,08 % | 0,005 % |
| Unique | 0,004 % | 0,001 % | 0,0004 % | — | 0,0015 % |

Conséquences par pack (mesurées sur 12 000 tirages par type) :

| Pack | Prix | Cartes | Valeur moyenne | Part du prix | Légendaire+ | Divine+ | Unique |
| --- | ---: | ---: | ---: | ---: | ---: | ---: | ---: |
| Classique | 500 🪙 | 5 | ≈ 313 🪙 | 63 % | 0,7 % | 0,07 % | 1 / 5 000 packs |
| Rare | 1 000 🪙 | 5 | ≈ 653 🪙 | 65 % | 8,7 % | 0,6 % | 1 / 20 000 packs |
| Double Rare | 1 800 🪙 | 10 | ≈ 1 306 🪙 | 73 % | 17 % | 1,2 % | 1 / 10 000 packs |
| Légende | 800 🪙 | 10 | ≈ 521 🪙 | 65 % | 0,4 % | 0,02 % | 1 / 25 000 packs |
| Vidéo | 600 🪙 | 2 | ≈ 438 🪙 | 73 % | 0,16 % | 0,16 % | — |
| Ultra | 2 200 🪙 | 5 | ≈ 1 531 🪙 | 70 % | 27 % | 2,3 % | 1 / 13 000 packs |

Principes de la refonte :

1. **Aucune garantie, aucun bonus.** Les anciennes garanties (1 Rare+, 1 Épique+,
   Mythique+…) et le « coup de pouce rentabilité » (`PACK_PROFIT_CHANCE` /
   `boostPackProfit`, supprimés) offraient des paliers élevés sans tirage : le
   Pack Rare sortait une Divine dans **50 %** des packs et l'Ultra une Unique
   dans **33 %**. Désormais la probabilité affichée est la probabilité réelle.
2. **Aucun pack rentable.** La valeur moyenne d'un pack est toujours inférieure
   à son prix (63 % à 73 %) : ouvrir ne fabrique plus de pièces.
3. **Les hautes raretés redeviennent des événements.** En Pack Rare : Divine
   tous les 170 packs environ, Secrète+ tous les 700, Unique tous les 20 000 ;
   en Classique, l'Unique tombe une fois sur 5 000 packs.
4. **Les prix suivent la valeur.** Les packs chers ont été recalibrés
   (Vidéo 600 🪙 au lieu de 1 000, Ultra 2 200 🪙 au lieu de 10 000, Double Rare
   1 800 🪙) pour rester des paris cohérents, pas des pièges.
5. **Le barème des doublons ne change pas** : 100 % → 72 % → 52 % → 37 % →
   plancher 35 % de la récompense de rareté (`cardReward`).

L'image `assets/packet.png` fournie ici est un visuel temporaire créé pour le prototype : remplacez-la par votre propre image en conservant le même chemin. Le Pack Vidéo utilise `assets/packetvideo.png` : remplacez ce fichier par votre visuel en gardant le même chemin.

> **Visuels de démonstration** : le dossier `assets/Cartes/` contient pour l'instant des images de substitution aux bonnes dimensions (500 × 700, soit 5:7) et aux bons noms de fichiers. Remplacez chaque fichier par le vrai visuel en gardant le même nom, sans rien changer au code.

## Mutations de cartes

Le module `CardMutations` (section dédiée dans `cards.js`) est indépendant du
catalogue et des poids de rareté. Chaque carte de booster reçoit **un seul tirage
de mutation après sa sélection** ; les créations par fusion aussi. Recharger une
sauvegarde, inspecter une carte, acheter, offrir ou récupérer une carte du marché
ne déclenche jamais de nouveau tirage.

### Shiny

| Rareté de la carte | Chance conditionnelle Shiny |
| --- | ---: |
| Commune | 1 % |
| Inhabituelle | 0,8 % |
| Rare | 0,6 % |
| Super Rare | 0,45 % |
| Épique | 0,3 % |
| Ultra épique | 0,2 % |
| Mythique | 0,12 % |
| Légendaire | 0,08 % |
| Divine | 0,05 % |
| Secrète | 0,02 % |

Ces probabilités sont conditionnelles à la rareté déjà choisie, sans boost du
pack rare. Les poids et l'équilibrage actuels des cartes restent inchangés
(les poids de rareté du jeu sont appliqués par carte, pas par palier).
La rareté, le nom, la description et les valeurs d'origine ne sont pas écrasés.
Shiny ajoute un badge et un reflet irisé, y compris dans la collection, le récap,
l'inspection et les collections d'amis. Un filtre « Shiny » est disponible.
L'animation respecte `prefers-reduced-motion`.

Aucun multiplicateur économique Shiny n'ayant été spécifié, les multiplicateurs
`valueMultiplier` (valeur de collection) et `rewardMultiplier` (pièces de révélation)
valent **1**. Les prix du marché restent fixés librement par le vendeur.

### Identité, sauvegarde et fusion

- Les cartes normales conservent leur identifiant historique.
- Une variante est sérialisée sous forme `baseId::mutationId`, par exemple
  `chasseur-royer::shiny`. En mémoire, elle expose également `baseId` et `mutation`.
- Les sauvegardes existantes restent lisibles sans migration ni tirage rétroactif.
- Les quantités normales/Shiny sont distinctes, tout comme les annonces de marché.
  La variante reste attachée à la carte lors des transferts.
- Une fusion exige deux copies de la **même variante**, les consomme et crée une
  nouvelle carte de rareté supérieure avec son propre tirage de mutation : la
  mutation des ingrédients n'est pas transmise automatiquement.
- La complétion du catalogue compte les cartes de base, quelle que soit la variante.
- Le format Firestore reste une liste de chaînes : aucun nouveau champ requis.

### Ajouter Gold, Shadow ou Glitch

Ajouter une définition dans `CardMutations.definitions` avec un `id` stable
(sans `::`), un `label`, une `icon`, une `cssClass`, des `rates` par rareté
(fractions : `0.01` = 1 %) et les deux multiplicateurs. Ajouter le style associé
dans `styles.css`. Les badges, la sauvegarde, la résolution des variantes, le
marché et la fusion utilisent automatiquement le registre. Pour un filtre dédié,
ajouter une entrée dans `renderFilters()`.

Les mutations sont **exclusives**, non cumulables : un unique nombre aléatoire
est comparé à des intervalles disjoints, dans l'ordre du registre. Chaque taux
reste absolu ; la somme des taux d'une rareté doit rester inférieure ou égale à 1.
La probabilité restante correspond à une carte normale. Ne pas supprimer ou
renommer un identifiant déjà utilisé dans les sauvegardes.

Tests : `npm test` inclut `tests/mutations.cjs` (dix taux, bornes déterministes,
préservation du catalogue, collection, séparation des fusions, sauvegarde et
absence de nouveau tirage à la lecture).
