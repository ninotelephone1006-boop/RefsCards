/* Refs Cards — détection de mise à jour (bandeau « Nouvelle version »)
   ---------------------------------------------------------------------
   Le site est statique : un onglet déjà ouvert continue d'exécuter les
   fichiers de son ancienne version, même après un déploiement. Ce script
   compare la version de la page chargée avec celle du index.html en ligne et,
   si elles diffèrent, affiche un bandeau avec un bouton « Recharger ». Il ne
   recharge jamais tout seul : une ouverture de booster en cours ne doit pas
   être perdue, et le joueur reste maître du moment.

   La version comparée est une « signature » composée de deux éléments :
     - le contenu de <meta name="app-version"> (lisible, affiché dans le titre) ;
     - les URL locales de index.html (styles.css?v=…, app.js?v=…, etc.).
   Incrémenter n'importe quel ?v= suffit donc à déclencher la détection ; le
   meta sert de repère lisible et couvre une mise à jour purement HTML.

   Vérifications : peu après le démarrage, toutes les 60 s, au retour sur
   l'onglet, au retour du focus et à la reconnexion réseau. La requête utilise
   `cache: 'no-store'` : un index.html en cache ne peut pas masquer un
   déploiement (utile sur Firebase Hosting, qui applique un max-age par défaut).
*/
(function () {
  'use strict';

  if (typeof window === 'undefined' || typeof document === 'undefined') return;
  if (window.REFS_CARDS_VERSION_CHECK) return; // script chargé deux fois

  const META_SELECTOR = 'meta[name="app-version"]';
  const DISMISS_KEY = 'refs-cards:update-dismissed';
  const BODY_CLASS = 'has-update-banner';
  const FIRST_CHECK_DELAY = 8 * 1000;   // laisse le jeu démarrer tranquillement
  const CHECK_INTERVAL = 60 * 1000;     // vérification périodique
  const MIN_GAP = 20 * 1000;            // pas deux vérifications d'affilée
  const BANNER_ID = 'update-banner';

  let banner = null;
  let wired = false;
  let lastCheck = 0;
  let inFlight = null;
  let update = null;                    // { remote, version } quand une MAJ existe

  /* ------------------------------------------------------------ signatures */

  function readMeta(doc) {
    const meta = doc.querySelector(META_SELECTOR);
    return meta ? (meta.getAttribute('content') || '').trim() : '';
  }

  /* URL locales déclarées par index.html : ce sont elles qui portent les ?v=
     et donc la version des fichiers réellement exécutés. Les URL absolues
     (SDK Firebase, Google Fonts, scripts d'extensions greffés au document)
     sont ignorées : elles ne dépendent pas de notre déploiement. */
  function localAssets(doc) {
    const urls = [];
    const nodes = doc.querySelectorAll('script[src], link[rel="stylesheet"][href]');
    for (const node of nodes) {
      const url = (node.getAttribute('src') || node.getAttribute('href') || '').trim();
      if (!url) continue;
      if (url.startsWith('//')) continue;
      if (/^[a-z][a-z0-9+.-]*:/i.test(url)) continue; // https:, chrome-extension:…
      urls.push(url);
    }
    return urls.join(' ');
  }

  function joinSignature(meta, assets) {
    return `${meta} :: ${assets}`.trim();
  }

  function signature(doc) {
    return joinSignature(readMeta(doc), localAssets(doc));
  }

  const currentSignature = signature(document);
  const canCheck = Boolean(readMeta(document) || localAssets(document)) &&
    typeof window.fetch === 'function' &&
    typeof window.DOMParser === 'function';

  /* ------------------------------------------------------------------ UI */

  function ensureBanner() {
    if (banner && banner.isConnected) return banner;
    banner = document.getElementById(BANNER_ID);
    if (banner) { wire(); return banner; }

    /* Filet de sécurité : le balisage est normalement dans index.html, mais le
       bandeau reste fonctionnel si la page vient d'une autre version. */
    const host = document.getElementById('app') || document.body;
    if (!host) return null;
    banner = document.createElement('aside');
    banner.id = BANNER_ID;
    banner.className = 'update-banner';
    banner.setAttribute('role', 'status');
    banner.setAttribute('aria-live', 'polite');
    banner.hidden = true;
    banner.innerHTML =
      '<span class="update-banner-icon" aria-hidden="true">✦</span>' +
      '<div class="update-banner-text">' +
        '<strong class="update-banner-title">Nouvelle version disponible</strong>' +
        '<span class="update-banner-msg">Le jeu a été mis à jour. Recharge la page pour en profiter.</span>' +
      '</div>' +
      '<div class="update-banner-actions">' +
        '<button class="update-banner-reload" type="button">Recharger</button>' +
        '<button class="update-banner-later" type="button">Plus tard</button>' +
      '</div>';
    host.appendChild(banner);
    wire();
    return banner;
  }

  function wire() {
    if (wired || !banner) return;
    wired = true;
    const reloadBtn = banner.querySelector('.update-banner-reload');
    const laterBtn = banner.querySelector('.update-banner-later');
    if (reloadBtn) reloadBtn.addEventListener('click', () => api.reload());
    if (laterBtn) laterBtn.addEventListener('click', () => dismiss());
  }

  function showBanner() {
    const node = ensureBanner();
    if (!node) return;
    if (update && update.version) {
      node.setAttribute('title', `Version en ligne : ${update.version}`);
    }
    node.hidden = false;
    if (document.body) document.body.classList.add(BODY_CLASS);
    try {
      window.dispatchEvent(new CustomEvent('refs:update-available', {
        detail: { current: currentSignature, remote: update ? update.remote : '', version: update ? update.version : '' }
      }));
    } catch (error) { /* CustomEvent absent : le bandeau suffit */ }
  }

  function hideBanner() {
    const node = (banner && banner.isConnected) ? banner : document.getElementById(BANNER_ID);
    if (node) node.hidden = true;
    if (document.body) document.body.classList.remove(BODY_CLASS);
  }

  function readDismissed() {
    try { return window.sessionStorage.getItem(DISMISS_KEY) || ''; } catch (error) { return ''; }
  }

  /* « Plus tard » : le bandeau ne revient pas pour cette version pendant la
     session, mais un déploiement plus récent le réaffiche. */
  function dismiss() {
    if (update && update.remote) {
      try { window.sessionStorage.setItem(DISMISS_KEY, update.remote); } catch (error) { /* mode privé */ }
    }
    hideBanner();
  }

  function reloadPage() {
    try {
      window.location.reload();
    } catch (error) {
      window.location.href = window.location.href;
    }
  }

  /* -------------------------------------------------------------- détection */

  function markUpdate(remote, version) {
    const changed = !update || update.remote !== remote;
    update = { remote, version: version || '' };
    if (!changed) return;               // déjà signalée : ne pas rejouer le bandeau
    if (readDismissed() === remote) return;
    showBanner();
  }

  function clearUpdate() {
    update = null;
    hideBanner();
  }

  function checkForUpdate(force) {
    if (!canCheck) return Promise.resolve(false);
    if (inFlight) return inFlight;
    const now = Date.now();
    if (!force && now - lastCheck < MIN_GAP) return Promise.resolve(Boolean(update));
    lastCheck = now;

    /* On relit la page courante (index.html, ou « / » si c'est l'URL servie)
       en contournant le cache : seul le HTML frais indique la vraie version. */
    let target;
    try {
      target = new URL(window.location.href);
      target.hash = '';
      target.searchParams.set('_refs_update', String(now));
    } catch (error) {
      return Promise.resolve(Boolean(update));
    }

    inFlight = (async () => {
      try {
        const response = await window.fetch(target.href, {
          cache: 'no-store',
          credentials: 'same-origin',
          redirect: 'follow'
        });
        if (!response || !response.ok) return Boolean(update);
        const html = await response.text();
        const remoteDoc = new window.DOMParser().parseFromString(html, 'text/html');
        const remoteVersion = readMeta(remoteDoc);
        const remoteAssets = localAssets(remoteDoc);
        /* Page vide / erreur / login proxy : rien de comparable, on n'alerte pas. */
        if (!remoteVersion && !remoteAssets) return Boolean(update);
        const remote = joinSignature(remoteVersion, remoteAssets);
        if (remote === currentSignature) {
          if (update) clearUpdate();     // retour à la version chargée : plus rien à faire
          return false;
        }
        markUpdate(remote, remoteVersion);
        return true;
      } catch (error) {
        return Boolean(update);          // hors ligne / fichier local : on réessaiera
      } finally {
        inFlight = null;
      }
    })();
    return inFlight;
  }

  /* ----------------------------------------------------------- ordonnanceur */

  function start() {
    if (!canCheck) return;
    window.setTimeout(() => { checkForUpdate(true); }, FIRST_CHECK_DELAY);
    window.setInterval(() => {
      if (!document.hidden) checkForUpdate(false);
    }, CHECK_INTERVAL);
    document.addEventListener('visibilitychange', () => {
      if (!document.hidden) checkForUpdate(false);
    });
    window.addEventListener('online', () => checkForUpdate(true));
    window.addEventListener('focus', () => checkForUpdate(false));
  }

  /* -------------------------------------------------------------- API publique */

  const api = {
    /* Version lisible de la page chargée (meta app-version). */
    get version() { return readMeta(document); },
    get signature() { return currentSignature; },
    state() {
      const node = banner || document.getElementById(BANNER_ID);
      return {
        current: currentSignature,
        remote: update ? update.remote : '',
        version: update ? update.version : '',
        available: Boolean(update),
        visible: Boolean(node && !node.hidden)
      };
    },
    check: checkForUpdate,
    dismiss,
    reload: reloadPage
  };

  /* Remplaçable par les tests (et par un autre module) : les boutons passent
     toujours par api.reload / api.dismiss, jamais par une copie figée. */
  window.REFS_CARDS_VERSION_CHECK = api;

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', start, { once: true });
  } else {
    start();
  }
})();
