/* ==========================================================================
   Refs Cards — service worker des notifications « hors jeu »

   Rôle unique : afficher les notifications du téléphone demandées par app.js
   (via push.js → registration.showNotification) et ramener le joueur dans le
   jeu quand il touche la notification.

   Volontairement SANS gestion du cache : le site se met déjà à jour tout seul
   (version-check.js affiche le bandeau « Nouvelle version »). Un service
   worker qui garderait des fichiers en cache ferait réapparaître d'anciennes
   versions, exactement ce que le jeu évite avec ses `?v=`.
   Il n'intercepte donc aucune requête (`fetch`).
   ========================================================================== */
'use strict';

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

/* Ouvre (ou ramène au premier plan) l'onglet du jeu, éventuellement sur
   l'adresse fournie dans la notification. */
function openApp(url) {
  const target = url || './';
  return self.clients.matchAll({ type: 'window', includeUncontrolled: true })
    .then((clientList) => {
      for (const client of clientList) {
        if (typeof client.focus === 'function') {
          const focused = client.focus();
          if (client.navigate && url) {
            return Promise.resolve(focused).then(() => client.navigate(target).catch(() => client));
          }
          return focused;
        }
      }
      return self.clients.openWindow(target);
    })
    .catch(() => {
      if (self.clients.openWindow) return self.clients.openWindow(target);
      return null;
    });
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const data = event.notification.data || {};
  event.waitUntil(openApp(data.url));
});

/* Prêt pour Firebase Cloud Messaging / Web Push : si un jour un serveur
   d'envoi est branché, les notifications arriveront ici, sans rien changer
   côté page. Le format attendu est un JSON simple :
   { "title": "...", "body": "...", "url": "./", "kind": "friends" } */
self.addEventListener('push', (event) => {
  let payload = {};
  try {
    payload = event.data ? event.data.json() : {};
  } catch (error) {
    payload = { title: 'Refs Cards', body: event.data ? event.data.text() : '' };
  }
  const title = payload.title || 'Refs Cards';
  const options = {
    body: payload.body || '',
    icon: 'assets/icons/icon-192.png',
    badge: 'assets/icons/favicon-32.png',
    tag: payload.tag ? `refs-push-${payload.tag}` : 'refs-push',
    data: { url: payload.url || './' }
  };
  event.waitUntil(self.registration.showNotification(title, options));
});
