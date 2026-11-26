// Run with NODE_PATH pointing to a local jsdom installation: node tests/sounds-github.cjs
// Vérifie les bruitages « sons de GitHub » (audio.js + assets/sounds/) :
// - chaque cue de la table CUES a bien son fichier .mp3 téléchargé depuis
//   microsoft/vscode, et aucun fichier orphelin traîne dans le dossier ;
// - provenance et licence documentées (CREDITS.md + LICENSE-vscode.txt) ;
// - la table CUES est cohérente (fenêtres in < out, crêtes > 0, cues de
//   préchargement connues) ;
// - l'API publique de Sound est complète : toutes les méthodes appelées par
//   app.js (SFX.*) existent, et aucun appel ne lève d'exception même sans
//   AudioContext (le jeu doit continuer sans son) ;
// - la version de lecture des mp3 (?v= SOUND_VERSION) est bien celle
//   déclarée dans index.html : mettre à jour un son sans toucher au ?v=
//   laisserait les anciens fichiers en cache.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const SOUND_DIR = 'assets/sounds';

function loadSound() {
  const src = fs.readFileSync('audio.js', 'utf8');
  const context = vm.createContext({});
  vm.runInContext(src, context);
  // `const Sound` n'est pas exposé sur l'objet global : on le lit dans le
  // même contexte, comme le ferait le script suivant de la page.
  const Sound = vm.runInContext('Sound', context);
  return { src, Sound };
}

function cuesTable(src) {
  const match = src.match(/const CUES = (\{[\s\S]*?\n  \});/);
  assert.ok(match, 'table CUES trouvée dans audio.js');
  return vm.runInContext(`(${match[1]})`, vm.createContext({}));
}

(async () => {
  const { src, Sound } = loadSound();
  const cues = cuesTable(src);

  /* 1. Fichiers : tout cue a son mp3, tout mp3 est utilisé. */
  const files = fs.readdirSync(SOUND_DIR).filter((name) => name.endsWith('.mp3'));
  assert.ok(files.length >= 20, `au moins 20 bruitages téléchargés ( trouvé: ${files.length} )`);
  for (const name of Object.keys(cues)) {
    const file = path.join(SOUND_DIR, `${name}.mp3`);
    assert.ok(fs.existsSync(file), `fichier présent : ${file}`);
    const data = fs.readFileSync(file);
    assert.ok(data.length > 1000, `${name}.mp3 non vide (${data.length} octets)`);
    const isId3 = data.slice(0, 3).toString('latin1') === 'ID3';
    const isFrameSync = data[0] === 0xff && (data[1] & 0xe0) === 0xe0;
    assert.ok(isId3 || isFrameSync, `${name}.mp3 est bien un mp3`);
  }
  for (const file of files) {
    assert.ok(Object.prototype.hasOwnProperty.call(cues, file.replace(/\.mp3$/, '')),
      `${file} est référencé par la table CUES (pas d'orphelin)`);
  }
  console.log(`PASS banque : ${files.length} mp3 de GitHub, tous référencés`);

  /* 2. Provenance et licence. */
  const credits = fs.readFileSync(path.join(SOUND_DIR, 'CREDITS.md'), 'utf8');
  assert.match(credits, /microsoft\/vscode/, 'CREDITS.md cite le dépôt source');
  assert.match(credits, /MIT/, 'CREDITS.md cite la licence MIT');
  assert.match(credits, /bd3842eb9529ca882b0b38b9e373d7e1a54d77a3|commit/i,
    'CREDITS.md fige la provenance (commit ou mention explicite)');
  assert.ok(fs.existsSync(path.join(SOUND_DIR, 'LICENSE-vscode.txt')),
    'licence MIT de VS Code copiée à côté des sons');
  console.log('PASS provenance : CREDITS.md + licence MIT');

  /* 3. Table CUES cohérente. */
  for (const [name, cue] of Object.entries(cues)) {
    assert.ok(typeof cue.in === 'number' && typeof cue.out === 'number', `${name} : fenêtre numérique`);
    assert.ok(cue.in >= 0, `${name} : in >= 0`);
    assert.ok(cue.out > cue.in, `${name} : out > in (${cue.in} → ${cue.out})`);
    assert.ok(cue.peak > 0 && cue.peak <= 2, `${name} : crête plausible (${cue.peak})`);
  }
  const firstLoad = src.match(/const FIRST_LOAD = (\[[^\]]*\])/);
  assert.ok(firstLoad, 'liste de préchargement trouvée');
  const preload = vm.runInContext(firstLoad[1], vm.createContext({}));
  assert.ok(preload.length >= 3, 'le préchargement couvre plusieurs cues');
  for (const name of preload) {
    assert.ok(Object.prototype.hasOwnProperty.call(cues, name), `préchargement connu : ${name}`);
  }
  console.log(`PASS table CUES : ${Object.keys(cues).length} cues, fenêtres et crêtes valides`);

  /* 4. API publique : tout ce que app.js appelle existe, sans exception. */
  const appSrc = fs.readFileSync('app.js', 'utf8');
  const used = new Set();
  for (const match of appSrc.matchAll(/\bSFX\.([A-Za-z_$][\w$]*)\b/g)) used.add(match[1]);
  assert.ok(used.size >= 10, `app.js appelle bien SFX.* (${used.size} noms)`);
  for (const name of used) {
    assert.ok(name in Sound, `Sound exposé : SFX.${name}`);
  }
  /* Aucun appel ne doit lever, même sans AudioContext (moteur muet). */
  Sound.unlock();
  Sound.setMuted(true);
  Sound.setMuted(false);
  assert.equal(Sound.muted, false, 'muted lisible');
  Sound.tearStart();
  Sound.tearUpdate(0.5, 0);
  Sound.tearStop();
  for (const name of ['rip', 'pop', 'whoosh', 'deal', 'tick', 'snap', 'coin', 'chaChing', 'ultraOpen']) {
    Sound[name]();
  }
  Sound.packOpen('ultra');
  Sound.packOpen('legend');
  Sound.packOpen('rare');
  Sound.packOpen('video');
  Sound.packOpen('classic');
  for (const rarity of ['common', 'rare', 'epic', 'legendary', 'inconnue']) Sound.rarity(rarity);
  Sound.setMuted(true);
  Sound.tick();
  Sound.setMuted(false);
  console.log(`PASS API : ${used.size} méthodes appelées par app.js, aucun appel n'échoue`);

  /* 5. Cache-busting : index.html et audio.js partagent la même version. */
  const html = fs.readFileSync('index.html', 'utf8');
  const tag = html.match(/audio\.js\?v=([^"&]+)/);
  assert.ok(tag, 'script audio.js porte un ?v=');
  const version = src.match(/SOUND_VERSION = '([^']+)'/);
  assert.ok(version, 'SOUND_VERSION déclaré dans audio.js');
  assert.equal(tag[1], version[1],
    `?v= du script audio.js (${tag[1]}) = SOUND_VERSION (${version[1]}) : la lecture des mp3 suit la page`);
  console.log(`PASS version : audio.js?v=${tag[1]}`);

  console.log('PASS sounds github (banque, provenance, table, API, version)');
})().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
