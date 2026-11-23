// Run with NODE_PATH pointing to a local jsdom installation: node tests/version-update.cjs
// Vérifie le bandeau « nouvelle version » : détection de la mise à jour (meta
// app-version et/ou ?v= des fichiers), affichage, « Plus tard » mémorisé pour la
// session, « Recharger », et silence total quand le site n'a pas changé.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const script = fs.readFileSync('version-check.js', 'utf8');

function boot({ fetch, url = 'https://refs-cards.test/' } = {}) {
  const dom = new JSDOM(html, { url, runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  if (fetch) win.fetch = fetch;
  else delete win.fetch;
  vm.runInContext(script, dom.getInternalVMContext());
  return dom;
}

/* Un index.html « déployé » : on modifie la meta et/ou un ?v= comme le ferait
   une mise en production. */
function deploy({ version = '2026.11.24-11', appJs = '2026.11.24-9' } = {}) {
  return html
    .replace(/<meta name="app-version" content="[^"]*">/, `<meta name="app-version" content="${version}">`)
    .replace(/app\.js\?v=[^"]+/, `app.js?v=${appJs}`);
}

(async () => {
  /* 1. Le balisage et le script sont bien dans index.html. */
  assert.match(html, /<meta name="app-version" content="\d{4}\.\d{2}\.\d{2}-\d+">/,
    'index.html doit déclarer <meta name="app-version"> (repère de version)');
  assert.match(html, /<script src="version-check\.js\?v=[^"]+" defer><\/script>/,
    'version-check.js doit être chargé, versionné et différé');
  assert.ok(html.indexOf('version-check.js') < html.indexOf('app.js?v='),
    'version-check.js doit passer avant app.js');
  const domBase = new JSDOM(html);
  const doc = domBase.window.document;
  assert.ok(doc.getElementById('update-banner'), 'le bandeau doit exister dans index.html');
  assert.equal(doc.getElementById('update-banner').hidden, true, 'le bandeau doit être masqué au chargement');
  assert.ok(doc.querySelector('#update-banner .update-banner-reload'), 'bouton Recharger attendu');
  assert.ok(doc.querySelector('#update-banner .update-banner-later'), 'bouton Plus tard attendu');
  assert.match(doc.getElementById('update-banner').textContent, /nouvelle version/i);
  domBase.window.close();

  /* 2. Même version en ligne : rien ne s'affiche. */
  let served = html;
  const calls = [];
  let dom = boot({
    fetch: async (url, init) => {
      calls.push({ url, init });
      return { ok: true, text: async () => served };
    }
  });
  let win = dom.window;
  let api = win.REFS_CARDS_VERSION_CHECK;
  assert.ok(api, 'window.REFS_CARDS_VERSION_CHECK doit être exposé');
  assert.equal(api.state().available, false);

  let banner = win.document.getElementById('update-banner');
  assert.equal(await api.check(true), false);
  assert.equal(banner.hidden, true, 'aucun bandeau quand le site est identique');
  assert.ok(calls.length >= 1, 'la vérification doit interroger le serveur');
  assert.equal(calls[0].init.cache, 'no-store', 'la page en ligne doit être relue sans cache');
  assert.match(calls[0].url, /_refs_update=\d+/, 'l’URL de contrôle doit être anti-cache');

  /* 3. Nouveau déploiement (meta + app.js?v=) : le bandeau apparaît. */
  served = deploy({ version: '2026.11.24-12', appJs: '2026.11.24-10' });
  assert.equal(await api.check(true), true);
  assert.equal(banner.hidden, false, 'le bandeau doit s’afficher après une mise à jour');
  assert.match(banner.textContent, /Recharger/);
  assert.equal(api.state().visible, true);
  assert.ok(win.document.body.classList.contains('has-update-banner'),
    'le corps doit signaler le bandeau (décalage du toast)');
  assert.match(banner.getAttribute('title') || '', /2026\.11\.24-12/,
    'la version en ligne doit être rappelée dans l’infobulle');

  /* 4. Une mise à jour déjà signalée ne rejoue pas le bandeau en boucle. */
  banner.hidden = true;
  win.document.body.classList.remove('has-update-banner');
  assert.equal(await api.check(true), true, 'la mise à jour reste connue');
  assert.equal(banner.hidden, true, 'pas de réaffichage intempestif de la même version');

  /* 5. « Plus tard » masque le bandeau pour cette version, pendant la session. */
  served = deploy({ version: '2026.11.24-13', appJs: '2026.11.24-11' });
  assert.equal(await api.check(true), true);
  assert.equal(banner.hidden, false, 'une nouvelle version doit réafficher le bandeau');
  banner.querySelector('.update-banner-later').click();
  assert.equal(banner.hidden, true, 'Plus tard doit masquer le bandeau');
  assert.ok(win.sessionStorage.getItem('refs-cards:update-dismissed'),
    'la version ignorée doit être mémorisée pour la session');
  assert.equal(win.document.body.classList.contains('has-update-banner'), false);
  assert.equal(await api.check(true), true, 'la mise à jour reste connue après « Plus tard »');
  assert.equal(banner.hidden, true, '« Plus tard » tient jusqu’à la prochaine version');

  /* 6. Un déploiement encore plus récent réaffiche le bandeau, même ignoré. */
  served = deploy({ version: '2026.11.25-1', appJs: '2026.11.25-1' });
  assert.equal(await api.check(true), true);
  assert.equal(banner.hidden, false, 'une version plus récente doit réafficher le bandeau');

  /* 7. « Recharger » passe par api.reload (remplaçable, donc testable). */
  let reloads = 0;
  api.reload = () => { reloads += 1; };
  banner.querySelector('.update-banner-reload').click();
  assert.equal(reloads, 1, 'le bouton Recharger doit recharger la page');

  /* 8. Un simple ?v= incrémenté suffit (même meta). */
  const dom2 = boot({
    fetch: async () => ({ ok: true, text: async () => deploy({ version: '2026.11.24-11', appJs: '2026.11.24-10' }) })
  });
  const win2 = dom2.window;
  assert.equal(await win2.REFS_CARDS_VERSION_CHECK.check(true), true,
    'incrémenter app.js?v= doit déclencher la détection');
  assert.equal(win2.document.getElementById('update-banner').hidden, false);
  win2.close();

  /* 9. Sans fetch (fichier local, navigateur ancien) : aucun crash, aucun bruit. */
  const dom3 = boot();
  const win3 = dom3.window;
  assert.equal(await win3.REFS_CARDS_VERSION_CHECK.check(true), false);
  assert.equal(win3.document.getElementById('update-banner').hidden, true);
  /* Un échec réseau ne doit pas casser la page non plus. */
  const dom4 = boot({ fetch: async () => { throw new Error('offline'); } });
  const win4 = dom4.window;
  assert.equal(await win4.REFS_CARDS_VERSION_CHECK.check(true), false);
  assert.equal(win4.document.getElementById('update-banner').hidden, true);
  win4.close();
  win3.close();

  win.close();
  console.log('PASS bandeau « nouvelle version » : détection, Plus tard, Recharger, hors ligne');
})().catch((error) => { console.error(error); process.exit(1); });
