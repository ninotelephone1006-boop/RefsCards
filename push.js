/* ==========================================================================
   Refs Cards — notifications « hors jeu » (vraies notifications du téléphone)

   Chargement : script classique avant app.js (index.html), comme cards.js et
   quests.js. Expose l'objet global `RefsPush`, lu par app.js et par les tests
   jsdom.

   Le jeu a déjà sa cloche interne (historique dans la sauvegarde). Ce module
   ajoute une seconde couche, HORS JEU : une notification du système (bandeau
   Android, bannière iOS, notification de bureau), affichée par le service
   worker `sw.js` même quand l'onglet du jeu n'est pas au premier plan.

   Principes :
   - L'utilisateur CHOISIT ce qu'il reçoit : chaque catégorie (quêtes, succès,
     niveaux, amis, marché, défis, cadeau du jour, nouveautés) a son
     interrupteur. Les préférences sont rangées dans le navigateur, par compte
     (aucune donnée de réglage envoyée au serveur).
   - Rien n'est demandé sans geste : la permission du navigateur n'est
     sollicitée qu'après un clic sur « Activer les notifications ».
   - Le jeu ouvert au premier plan ne déclenche pas de notification système
     (l'interface le montre déjà) : c'est le sens de « hors jeu ». Le bouton
     « Tester » force volontairement l'envoi, pour vérifier que tout marche.
   - Aucune erreur ne remonte : sans permission, sans service worker ou dans
     un navigateur qui ne sait pas faire, `notify()` renvoie simplement false.

   Limite assumée (documentée dans le README) : sans serveur de push (Firebase
   Cloud Messaging + Cloud Functions), la notification ne peut être affichée
   que tant que le jeu est ouvert dans un onglet, même réduit. Les évènements
   multi-joueurs (demande d'ami, vente, défi) arrivent par les écoutes temps
   réel Firestore, qui continuent de fonctionner onglet en arrière-plan.
   `sw.js` écoute déjà l'évènement `push` : brancher FCM plus tard n'exigera
   aucune modification de cette API.
   ========================================================================== */
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.RefsPush) return; // script chargé deux fois

  const STORAGE_PREFIX = 'refs-cards:push:';
  const ICON = 'assets/icons/icon-192.png';
  const BADGE = 'assets/icons/favicon-32.png';
  const SW_URL = './sw.js';

  /* Catégories proposées à l'utilisateur. L'ordre est celui de l'interface. */
  const KINDS = [
    { id: 'quests', icon: '🗺️', label: 'Quêtes prêtes', desc: 'Une quête est accomplie et attend sa récompense.' },
    { id: 'achievements', icon: '🏆', label: 'Succès', desc: 'Un succès se débloque et rapporte de l’XP.' },
    { id: 'levels', icon: '⭐', label: 'Niveaux', desc: 'Tu passes un niveau.' },
    { id: 'friends', icon: '👥', label: 'Demandes d’ami', desc: 'Un joueur veut t’ajouter en ami.' },
    { id: 'market', icon: '🪙', label: 'Marché', desc: 'Vente conclue, offre reçue, pièces envoyées par un ami.' },
    { id: 'games', icon: '🎲', label: 'Défis pile ou face', desc: 'Un ami te lance un défi avec une mise.' },
    { id: 'gift', icon: '🎁', label: 'Cadeau de connexion', desc: 'Un nouveau jour du calendrier t’attend.' },
    { id: 'news', icon: '📣', label: 'Nouveautés et promos', desc: 'Nouvelles cartes, offres limitées. Désactivé par défaut.' }
  ];
  const KIND_IDS = KINDS.map((kind) => kind.id);
  /* Tout est actif d'emblée sauf le marketing : le joueur peut tout décocher. */
  const DEFAULT_KINDS = { news: false };

  function defaultState(asked) {
    const kinds = {};
    KIND_IDS.forEach((id) => { kinds[id] = DEFAULT_KINDS[id] !== false; });
    return { enabled: false, asked: Boolean(asked), kinds };
  }

  function isSecure() {
    const host = (window.location && window.location.hostname) || '';
    return window.location.protocol === 'https:'
      || host === 'localhost' || host === '127.0.0.1' || host === '[::1]';
  }

  function isAppleMobile() {
    const nav = window.navigator || {};
    const ua = String(nav.userAgent || '');
    return /iPad|iPhone|iPod/.test(ua)
      || (nav.platform === 'MacIntel' && Number(nav.maxTouchPoints) > 1);
  }

  function isStandalone() {
    try {
      if (window.navigator && window.navigator.standalone) return true;
      if (typeof window.matchMedia === 'function') {
        if (window.matchMedia('(display-mode: standalone)').matches) return true;
        if (window.matchMedia('(display-mode: fullscreen)').matches) return true;
      }
    } catch (error) { /* matchMedia indisponible : ce n'est pas bloquant */ }
    return false;
  }

  /* État du support, sans jamais toucher à la permission (aucune demande). */
  function support() {
    const hasApi = typeof window.Notification === 'function';
    const permission = hasApi && typeof window.Notification.permission === 'string'
      ? window.Notification.permission
      : 'default';
    const secure = isSecure();
    const serviceWorker = Boolean(window.navigator && 'serviceWorker' in window.navigator);
    const ios = isAppleMobile();
    const standalone = isStandalone();
    /* Sur iPhone/iPad, Safari n'accepte les notifications que pour une
       application ajoutée à l'écran d'accueil (iOS 16.4+). */
    const needsInstall = ios && !standalone;
    return {
      api: hasApi,
      permission,
      secure,
      serviceWorker,
      ios,
      standalone,
      needsInstall,
      canAsk: hasApi && secure && !needsInstall && permission === 'default',
      granted: hasApi && permission === 'granted'
    };
  }

  /* ------------------------------------------------------ préférences par compte */

  function storageKey(uid) {
    return STORAGE_PREFIX + String(uid || 'invite');
  }

  function readRaw(uid) {
    try {
      const raw = window.localStorage.getItem(storageKey(uid));
      if (!raw) return null;
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === 'object' ? parsed : null;
    } catch (error) {
      return null; // stockage bloqué (navigation privée) : réglages par défaut
    }
  }

  function writeRaw(uid, value) {
    try {
      window.localStorage.setItem(storageKey(uid), JSON.stringify(value));
      return true;
    } catch (error) {
      return false;
    }
  }

  /* Préférences complètes et normalisées (jamais un objet partagé : l'appelant
     peut les modifier sans effet de bord). */
  function prefs(uid) {
    const saved = readRaw(uid);
    const base = defaultState(saved && saved.asked);
    if (!saved) return base;
    const kinds = {};
    KIND_IDS.forEach((id) => {
      const value = saved.kinds && saved.kinds[id];
      kinds[id] = typeof value === 'boolean' ? value : base.kinds[id];
    });
    return { enabled: Boolean(saved.enabled), asked: Boolean(saved.asked), kinds };
  }

  function save(uid, patch) {
    const next = prefs(uid);
    if (patch && typeof patch === 'object') {
      if (typeof patch.enabled === 'boolean') next.enabled = patch.enabled;
      if (typeof patch.asked === 'boolean') next.asked = patch.asked;
      if (patch.kinds && typeof patch.kinds === 'object') {
        KIND_IDS.forEach((id) => {
          if (typeof patch.kinds[id] === 'boolean') next.kinds[id] = patch.kinds[id];
        });
      }
    }
    writeRaw(uid, { enabled: next.enabled, asked: next.asked, kinds: next.kinds });
    return next;
  }

  function setEnabled(uid, value) { return save(uid, { enabled: Boolean(value) }); }
  function setKind(uid, kind, value) {
    if (KIND_IDS.indexOf(kind) < 0) return prefs(uid);
    const kinds = {};
    kinds[kind] = Boolean(value);
    return save(uid, { kinds });
  }
  function markAsked(uid) { return save(uid, { asked: true }); }

  function kindEnabled(uid, kind) {
    const state = prefs(uid);
    if (!state.enabled) return false;
    if (KIND_IDS.indexOf(kind) < 0) return true;
    return state.kinds[kind] !== false;
  }

  function enabledKindCount(uid) {
    const state = prefs(uid);
    if (!state.enabled) return 0;
    return KIND_IDS.reduce((sum, id) => sum + (state.kinds[id] === false ? 0 : 1), 0);
  }

  /* --------------------------------------------------------------- permission */

  async function askPermission() {
    const state = support();
    if (!state.api || !state.secure || state.needsInstall) return 'unsupported';
    if (state.permission === 'granted') return 'granted';
    if (state.permission === 'denied') return 'denied';
    try {
      const result = await window.Notification.requestPermission();
      return result || window.Notification.permission || 'default';
    } catch (error) {
      return 'denied';
    }
  }

  /* ------------------------------------------------------------ service worker */

  let registrationPromise = null;

  function delay(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  /* Enregistre `sw.js` une seule fois. Le service worker est indispensable sur
     Android (Notification constructor interdit) ; sur ordinateur, l'objet
     Notification suffit — on retombe dessus si l'enregistrement échoue. */
  function ready() {
    if (registrationPromise) return registrationPromise;
    const nav = window.navigator || {};
    if (!nav.serviceWorker || typeof nav.serviceWorker.register !== 'function' || !isSecure()) {
      registrationPromise = Promise.resolve(null);
      return registrationPromise;
    }
    registrationPromise = (async () => {
      try {
        const registration = await nav.serviceWorker.register(SW_URL, { scope: './' });
        if (nav.serviceWorker.ready && typeof nav.serviceWorker.ready.then === 'function') {
          /* `ready` ne se résout qu'à l'activation : on ne bloque pas
             indéfiniment une notification si l'activation traîne. */
          await Promise.race([nav.serviceWorker.ready, delay(3000)]);
        }
        return registration || null;
      } catch (error) {
        return null;
      }
    })();
    return registrationPromise;
  }

  /* ------------------------------------------------------------- envoi */

  /* Le jeu est-il sous les yeux du joueur ? (sinon : notification système) */
  function pageVisible() {
    try {
      if (document.visibilityState === 'hidden') return false;
      if (document.hidden === true) return false;
      return true;
    } catch (error) {
      return true;
    }
  }

  function canNotify() {
    const state = support();
    return Boolean(state.api && state.secure && !state.needsInstall && state.permission === 'granted');
  }

  /* Affiche une vraie notification du système.
     options : { uid, kind, title, body, tag, url, force }
     - `kind` filtre selon les préférences de l'utilisateur ;
     - `tag` regroupe / remplace une notification de même nature (une seule
       bannière pour une vente donnée, par exemple) ;
     - `force` ignore les filtres de préférence et de visibilité (bouton
       « Tester »). La permission reste évidemment obligatoire.
     Renvoie true si la notification a été confiée au navigateur. */
  async function notify(options) {
    const opts = options || {};
    const kind = KIND_IDS.indexOf(opts.kind) >= 0 ? opts.kind : 'news';
    const uid = opts.uid;
    if (!opts.force) {
      if (!kindEnabled(uid, kind)) return false;
      if (pageVisible()) return false; // le jeu est sous les yeux : la cloche suffit
    }
    if (!canNotify()) return false;
    const title = String(opts.title || 'Refs Cards').slice(0, 120) || 'Refs Cards';
    const body = String(opts.body || '').slice(0, 400);
    const data = { url: String(opts.url || './'), kind, at: Date.now() };
    const notificationOptions = {
      body,
      tag: opts.tag ? `refs-${kind}-${opts.tag}` : `refs-${kind}`,
      data,
      icon: ICON,
      badge: BADGE
    };
    try {
      const registration = await ready();
      if (registration && typeof registration.showNotification === 'function') {
        await registration.showNotification(title, notificationOptions);
        return true;
      }
    } catch (error) { /* on tente l'objet Notification ci-dessous */ }
    try {
      if (typeof window.Notification === 'function') {
        const instance = new window.Notification(title, notificationOptions);
        if (instance && typeof instance.close !== 'function') return true;
        return true;
      }
    } catch (error) { /* navigateur qui refuse : rien à faire */ }
    return false;
  }

  window.RefsPush = {
    KINDS,
    KIND_IDS,
    support,
    prefs,
    save,
    setEnabled,
    setKind,
    markAsked,
    kindEnabled,
    enabledKindCount,
    askPermission,
    canNotify,
    pageVisible,
    ready,
    notify
  };
})();
