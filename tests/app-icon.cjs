// Run with NODE_PATH pointing to a local jsdom installation: node tests/app-icon.cjs
// Vérifie le logo « RF » et son intégration comme icône d'application :
//  - index.html déclare favicon, apple-touch-icon, manifeste et métas iPhone ;
//  - manifest.webmanifest est valide, en mode standalone, et ses icônes
//    (192, 512, maskable) existent réellement avec la bonne taille ;
//  - l'icône iPhone est bien du 180×180 sans transparence (iOS ajoute un fond
//    noir aux coins transparents) ;
//  - le logo est présent dans le jeu : écran de chargement, en-tête, page de
//    connexion, et logo d'accueil de l'onglet Booster.
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const path = require('node:path');
const assert = require('node:assert/strict');

const html = fs.readFileSync('index.html', 'utf8');
const doc = new JSDOM(html).window.document;

/* ---------------------------------------------------------- PNG minimal */

function pngInfo(file) {
  const buffer = fs.readFileSync(file);
  assert.equal(buffer.subarray(1, 4).toString('ascii'), 'PNG', `${file} doit être un PNG`);
  const width = buffer.readUInt32BE(16);
  const height = buffer.readUInt32BE(20);
  const bitDepth = buffer[24];
  const colorType = buffer[25];
  // 0 = niveaux de gris, 2 = RVB, 3 = palette, 4 = gris + alpha, 6 = RVB + alpha
  const hasAlpha = colorType === 4 || colorType === 6;
  return { width, height, bitDepth, colorType, hasAlpha, size: buffer.length };
}

function assertIcon(file, size, { opaque = false } = {}) {
  const full = path.join(process.cwd(), file);
  assert.ok(fs.existsSync(full), `${file} doit exister (icône déclarée dans le manifeste)`);
  const info = pngInfo(full);
  assert.equal(info.width, size, `${file} doit faire ${size} px de large`);
  assert.equal(info.height, size, `${file} doit faire ${size} px de haut`);
  assert.equal(info.bitDepth, 8, `${file} doit être en 8 bits par canal`);
  if (opaque) assert.equal(info.hasAlpha, false, `${file} ne doit pas avoir de transparence`);
  assert.ok(info.size < 400 * 1024, `${file} doit rester léger (< 400 Ko)`);
  return info;
}

/* ------------------------------------------------ 1. balises de index.html */

const head = doc.head;
const link = (rel, extra = '') => [...head.querySelectorAll(`link[rel="${rel}"]${extra}`)];
const meta = (name) => head.querySelector(`meta[name="${name}"]`);

const manifestLink = link('manifest')[0];
assert.ok(manifestLink, 'index.html doit lier manifest.webmanifest (installation PWA)');
assert.equal(manifestLink.getAttribute('href'), 'manifest.webmanifest');

const appleIcon = link('apple-touch-icon')[0];
assert.ok(appleIcon, 'index.html doit déclarer <link rel="apple-touch-icon"> pour l’écran d’accueil iPhone');
assert.match(appleIcon.getAttribute('href'), /assets\/icons\/apple-touch-icon\.png$/);
assert.equal(appleIcon.getAttribute('sizes'), '180x180');

assert.ok(link('icon', '[sizes="32x32"]').length, 'favicon 32×32 attendu');
assert.ok(link('icon', '[sizes="16x16"]').length, 'favicon 16×16 attendu');
assert.equal((meta('apple-mobile-web-app-capable') || {}).content, 'yes',
  'la méta apple-mobile-web-app-capable doit être présente (ouverture plein écran)');
assert.match((meta('apple-mobile-web-app-title') || {}).content || '', /Refs Cards/);
assert.ok((meta('theme-color') || {}).content, 'la couleur de barre d’état doit rester déclarée');
assert.ok((meta('application-name') || {}).content, 'le nom d’application doit être déclaré');

/* ------------------------------------------- 2. manifeste et fichiers PNG */

const manifest = JSON.parse(fs.readFileSync('manifest.webmanifest', 'utf8'));
assert.equal(manifest.short_name, 'Refs Cards');
assert.equal(manifest.display, 'standalone', 'l’application doit s’ouvrir sans la barre de Safari');
assert.equal(manifest.scope, './', 'le périmètre doit couvrir tout le jeu');
assert.equal(manifest.start_url, './');
assert.equal(manifest.orientation, 'portrait');
assert.match(manifest.background_color, /^#[0-9a-f]{6}$/i);
assert.match(manifest.theme_color, /^#[0-9a-f]{6}$/i);

const sizes = new Set(manifest.icons.map((icon) => icon.sizes));
assert.ok(sizes.has('192x192'), 'icône 192×192 attendue dans le manifeste');
assert.ok(sizes.has('512x512'), 'icône 512×512 attendue dans le manifeste');
assert.ok(manifest.icons.some((icon) => icon.purpose === 'maskable'),
  'une icône maskable est nécessaire pour Android');

for (const icon of manifest.icons) {
  const [w, h] = icon.sizes.split('x').map(Number);
  assert.equal(w, h, `${icon.src} : une icône d'application doit être carrée`);
  assertIcon(icon.src, w);
  assert.equal(icon.type, 'image/png');
}

/* L'icône iPhone : 180×180, opaque (iOS remplit les coins transparents en noir). */
assertIcon('assets/icons/apple-touch-icon.png', 180, { opaque: true });
assertIcon(link('icon', '[sizes="32x32"]')[0].getAttribute('href'), 32);
assertIcon(link('icon', '[sizes="16x16"]')[0].getAttribute('href'), 16);

/* Le grand logo affiché dans le jeu. */
const logo = pngInfo('assets/icons/logo-refs-cards.png');
assert.equal(logo.width, logo.height, 'le logo du jeu doit être carré');
assert.ok(logo.width >= 512, 'le logo du jeu doit rester grand pour les écrans haute densité');
assertIcon('assets/icons/logo-refs-cards.png', logo.width, { opaque: true });

/* ------------------------------------------------- 3. logo dans le jeu */

const logoMark = (node) => /assets\/icons\/(icon-192|logo-refs-cards)\.png$/.test(node.getAttribute('src') || '');

const loadingLogo = doc.querySelectorAll('.loading-screen img[src*="assets/icons/"]');
assert.ok(loadingLogo.length, 'l’écran de chargement doit afficher le logo');
assert.match(loadingLogo[0].getAttribute('src'), /logo-refs-cards\.png$/);
assert.equal(loadingLogo[0].getAttribute('alt'), '', 'logo décoratif : alt vide (le nom est déjà écrit)');

assert.ok([...doc.querySelectorAll('.brand img')].filter(logoMark).length >= 2,
  'en-tête du jeu et page de connexion doivent afficher le logo à la place du ✳');

const gameLogo = doc.querySelector('.pack-view .game-logo');
assert.ok(gameLogo, 'l’accueil de l’onglet Booster doit afficher le logo du jeu');
assert.match(gameLogo.getAttribute('src'), /logo-refs-cards\.png$/);
assert.equal(gameLogo.getAttribute('alt'), 'Refs Cards', 'le logo d’accueil porte le nom du jeu');

const css = fs.readFileSync('styles.css', 'utf8');
for (const rule of ['.brand-logo', '.loading-logo', '.game-logo']) {
  assert.ok(css.includes(rule), `${rule} doit être stylé dans styles.css`);
}
assert.match(css, /display-mode:\s*standalone/,
  'la zone sûre de l’écran d’accueil iPhone doit être réservée (mode standalone)');

console.log('PASS logo RF : icônes iPhone/Android, manifeste, écran de chargement, en-tête et accueil');

/* ------------------------------- 4. serveur local : manifeste bien typé */

const server = fs.readFileSync('server.js', 'utf8');
assert.match(server, /'\.webmanifest'\s*:\s*'application\/manifest\+json/,
  'server.js doit servir manifest.webmanifest en application/manifest+json');
