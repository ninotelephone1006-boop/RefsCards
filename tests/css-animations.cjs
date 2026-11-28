// Intégrité des animations CSS : chaque nom cité par `animation` doit avoir
// ses @keyframes, aucun doublon de keyframes (le dernier écraserait
// silencieusement le premier), et les animations ajoutées pour les vols /
// retours de carte sont bien présentes. Exécuter : node tests/css-animations.cjs
const fs = require('node:fs');
const assert = require('node:assert/strict');

const css = fs.readFileSync('styles.css', 'utf8');
const app = fs.readFileSync('app.js', 'utf8');

const keyframes = [...css.matchAll(/@keyframes\s+([\w-]+)/g)].map((match) => match[1]);
const counts = new Map();
for (const name of keyframes) counts.set(name, (counts.get(name) || 0) + 1);
const duplicates = [...counts].filter(([, count]) => count > 1).map(([name]) => name);
assert.deepEqual(duplicates, [], `keyframes dupliqués (le dernier écrase le premier) : ${duplicates.join(', ')}`);

/* Mots-clés de la syntaxe `animation` : ce ne sont pas des keyframes. */
const KEYWORDS = new Set([
  'none', 'normal', 'reverse', 'alternate', 'alternate-reverse', 'forwards',
  'backwards', 'both', 'running', 'paused', 'ease', 'linear', 'ease-in',
  'ease-out', 'ease-in-out', 'step-start', 'step-end', 'infinite', 'important',
  'start', 'end', 'steps', 'cubic-bezier'
]);

const known = new Set(keyframes);
const missing = new Set();
for (const match of css.matchAll(/animation(?:-name)?\s*:\s*([^;}]+)/g)) {
  let value = match[1]
    .replace(/var\([^)]*\)/g, ' ')
    .replace(/(?:cubic-bezier|steps)\([^)]*\)/g, ' ')
    .replace(/\d*\.?\d+(?:ms|s|deg|%)?/g, ' ');
  for (const token of value.split(/[\s,]+/)) {
    if (!/^[a-z][\w-]*$/i.test(token)) continue;
    if (KEYWORDS.has(token.toLowerCase())) continue;
    if (!known.has(token)) missing.add(token);
  }
}
assert.deepEqual([...missing], [], `animations sans @keyframes : ${[...missing].join(', ')}`);

/* Régressions corrigées. */
assert.match(css, /@keyframes\s+ultra-shimmer/, 'le reflet du Pack Ultra a ses keyframes');
assert.match(css, /@keyframes\s+fusion-result-burst/, 'la fusion a sa propre animation de résultat');
assert.match(css, /@keyframes\s+idle-aura/, 'le halo de la carte du dessus respire');
assert.match(css, /\.card\.is-top:not\(\.is-flipped\):not\(\.is-charging\)::before\{[^}]*idle-aura/, 'le halo idle est branché sur la carte du dessus');
assert.match(css, /\.card-inner\{transition:transform var\(--flip-dur/, 'la durée du retournement lit --flip-dur');
assert.match(app, /setProperty\('--flip-dur'/, 'app.js fournit la durée de retournement par rareté');
assert.match(css, /\.card\.is-top\.is-flipped:not\(\.is-flying\)\{animation:card-settle/, 'la carte révélée se pose (card-settle)');
assert.match(css, /@keyframes\s+card-settle/, 'la pose de carte a ses keyframes');
assert.match(css, /@keyframes\s+charge-float\{0%\{rotate:-[^}]+\}50%\{rotate:[^}]+\}/, 'la charge balance au lieu de tourner de 0° à 0°');
assert.match(css, /\.fx-spark-css\{animation:fx-spark-fly/, 'les étincelles ont un repli CSS animé');
assert.match(css, /@keyframes\s+fx-spark-fly/, 'le repli des étincelles a ses keyframes');
assert.match(css, /@media \(prefers-reduced-motion: reduce\) \{\s*\*, \*::before, \*::after \{\s*animation-duration: 0\.001ms !important/, 'les animations restent coupées avec prefers-reduced-motion');

console.log('PASS animations CSS : keyframes définis (aucun doublon), durée de retournement par rareté, pose de carte, halos, charge et replis d’étincelles');
