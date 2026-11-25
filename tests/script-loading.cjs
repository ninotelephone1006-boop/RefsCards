// Run with NODE_PATH pointing to a local jsdom installation: node tests/script-loading.cjs
// Vérifie le chargement des scripts de index.html et le filet de sécurité du
// bouton Google. Empêche de réintroduire un `type="module"` ou un `import`
// dans un fichier servi comme script classique — c'était la cause de
// « Uncaught SyntaxError: Cannot use import statement outside a module ».
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const wait = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

(async () => {
  const html = fs.readFileSync('index.html', 'utf8');
  const dom = new JSDOM(html, { url: 'https://refs-cards.test/', runScripts: 'outside-only', pretendToBeVisual: true });
  const win = dom.window;
  const doc = win.document;

  /* 1. Les scripts locaux sont classiques, différés, versionnés et dans l'ordre. */
  const local = [...doc.querySelectorAll('script[src]')]
    .filter((script) => !/^https?:/i.test(script.getAttribute('src')));
  assert.ok(local.length >= 7, 'firebase-config.js, cards.js, quests.js, audio.js, push.js, version-check.js et app.js doivent être chargés');
  for (const script of local) {
    const src = script.getAttribute('src');
    assert.notEqual(script.getAttribute('type'), 'module', `${src} ne doit pas être un module ES`);
    assert.ok(script.hasAttribute('defer'), `${src} doit être chargé en defer (DOM prêt)`);
    assert.match(src, /\?v=/, `${src} doit porter un numéro de version pour éviter le cache`);
  }
  assert.match(local[local.length - 1].getAttribute('src'), /^app\.js\?v=/,
    'app.js doit être le dernier script (il dépend de cards.js et audio.js)');

  /* 2. Aucun fichier local n'utilise la syntaxe réservée aux modules. */
  for (const file of ['firebase-config.js', 'cards.js', 'quests.js', 'audio.js', 'push.js', 'version-check.js', 'app.js']) {
    assert.doesNotThrow(
      () => new vm.Script(fs.readFileSync(file, 'utf8'), { filename: file }),
      `${file} contient du syntaxe de module (import/export) : impossible dans un script classique`
    );
  }

  /* 3. Filet de sécurité : si app.js ne démarre pas, un clic sur Google explique. */
  const inline = [...doc.querySelectorAll('script:not([src])')]
    .map((script) => script.textContent).join('\n');
  assert.match(inline, /REFS_CARDS_READY/, 'index.html doit embarquer le filet de sécurité du bouton Google');
  win.eval(inline);
  // Les scripts classiques sont déjà « chargés » : on rejoue les évènements.
  doc.dispatchEvent(new win.Event('DOMContentLoaded'));

  const button = doc.getElementById('google-signin');
  const error = doc.getElementById('auth-error');
  button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(500);
  assert.equal(error.hidden, false, 'un clic sans app.js doit afficher un message');
  assert.match(error.textContent, /cache|démarrer/i);

  /* 4. Quand app.js est bien initialisé, le filet de sécurité reste muet. */
  error.textContent = '';
  error.hidden = true;
  win.REFS_CARDS_READY = true;
  button.dispatchEvent(new win.MouseEvent('click', { bubbles: true }));
  await wait(500);
  assert.equal(error.hidden, true, 'aucun message parasite quand le jeu a démarré');

  win.close();
  console.log('PASS scripts classiques + defer + versionnés, filet de sécurité du bouton Google');
})().catch((error) => { console.error(error); process.exitCode = 1; });
