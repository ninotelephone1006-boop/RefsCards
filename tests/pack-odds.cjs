const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {url:'https://example.test/', runScripts:'outside-only'});
const w = dom.window;
w.matchMedia = () => ({matches:true, addEventListener(){}});
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, {get:()=>()=>{}, set:()=>true});
w.Sound = new Proxy({}, {get:()=>()=>{}});
const ctx = dom.getInternalVMContext();
for (const file of ['cards.js', 'quests.js']) vm.runInContext(fs.readFileSync(file, 'utf8'), ctx);
vm.runInContext(fs.readFileSync('app.js','utf8').replace(/\}\)\(\);\s*$/, `window.__odds = { packPool, slotRarityShares, packSlotsFor, packTableFor, drawPack, renderOdds, RARITIES, PACK_TABLES, PACK_PRICES, cardCountFor, packAverageValue }; })();`), ctx);
const api = w.__odds;

/* 1. La table du Pack Classique est exactement celle de PACK_TABLES. */
const declared = {common:55.61, uncommon:24.75, rare:12.38, superrare:4.95, epic:1.73, ultraepic:0.43, legendary:0.10, mythic:0.03, divine:0.008, secret:0.002, ultrasecret:0.0006, hypersecret:0.00015, unique:0.004};
/* Les poids sont relatifs : le tirage les renormalise sur leur somme. */
const declaredTotal = Object.values(declared).reduce((sum, weight) => sum + weight, 0);
const expected = Object.fromEntries(Object.entries(declared).map(([key, weight]) => [key, (weight / declaredTotal) * 100]));
const pool = api.packPool('classic');
for (const slot of api.packSlotsFor('classic')) {
  const shares = api.slotRarityShares('classic', slot, pool);
  for (const [key, pct] of Object.entries(expected)) assert.ok(Math.abs(shares[key] * 100 - pct) < 1e-9, key);
  assert.equal(Object.keys(shares).length, Object.keys(expected).length, 'aucune rareté en trop');
}

/* 2. Aucune garantie : tous les slots sont standards dans tous les packs. */
for (const type of ['classic','rare','doubleRare','legend','video','ultra']) {
  for (const slot of api.packSlotsFor(type)) assert.equal(slot, 'std', `${type} sans palier garanti`);
  assert.equal(api.packSlotsFor(type).length, api.cardCountFor(type), `${type} : un slot par carte`);
}

/* 3. Pas de bonus de rentabilité : le pack classique reste 100 % aléatoire. */
w.Math.random = () => 0;
assert.ok(api.drawPack(false, pool, 'classic').every(c => c.rarity === 'common'));

/* 4. Affichage : les taux affichés sont ceux de la table, y compris les très rares. */
api.renderOdds(false, pool, 'classic');
const text = w.document.getElementById('pack-odds').textContent;
assert.match(text, /Commune 55,61 %/);
assert.match(text, /Légendaire 0,1 %/);
assert.match(text, /Unique 0,004 %/);
api.renderOdds(false, api.packPool('rare'), 'rare');
const rareText = w.document.getElementById('pack-odds').textContent;
assert.match(rareText, /Taux de base/);
assert.match(rareText, /aucun palier garanti/);

/* 5. Économie : aucun pack ne rembourse son prix en moyenne, et l'échelle
   des récompenses est strictement croissante avec le rang. */
const ranks = Object.values(api.RARITIES).sort((a, b) => a.rank - b.rank);
for (let i = 1; i < ranks.length; i++) {
  assert.ok(ranks[i].reward > ranks[i - 1].reward,
    `${ranks[i].label} doit valoir plus que ${ranks[i - 1].label}`);
}
for (const [type, table] of Object.entries(api.PACK_TABLES)) {
  const total = Object.values(table).reduce((sum, weight) => sum + weight, 0);
  const ev = Object.keys(table).reduce((sum, key) => {
    const reward = api.RARITIES[key] ? api.RARITIES[key].reward : 0;
    return sum + (table[key] / total) * reward;
  }, 0);
  const perPack = ev * api.cardCountFor(type);
  const ratio = perPack / api.PACK_PRICES[type];
  assert.ok(ratio > 0.55 && ratio < 0.85,
    `${type} : valeur moyenne ${ratio.toFixed(0)} % du prix (attendu 55-85 %)`);
}

/* 6. Les valeurs moyennes annoncées dans le Shop sont recalculées depuis les
   tables : elles restent vraies après n'importe quel réglage d'équilibrage. */
const shown = { classic: 313, rare: 653, doubleRare: 1305, legend: 521, video: 436, ultra: 1522 };
for (const [type, value] of Object.entries(shown)) {
  assert.ok(Math.abs(api.packAverageValue(type) - value) <= 2,
    `${type} : valeur moyenne ${api.packAverageValue(type)} au lieu de ${value}`);
}

/* 7. Hiérarchie : le pack Rare est nettement plus généreux que le classique. */
const rarePool = api.packPool('rare');
const classicShare = Object.values(api.packSlotsFor('classic')).reduce((acc, slot) => {
  const shares = api.slotRarityShares('classic', slot, pool);
  return acc + ['epic','ultraepic','legendary','mythic','divine','secret','ultrasecret','hypersecret','unique']
    .reduce((sum, key) => sum + (shares[key] || 0), 0) / api.packSlotsFor('classic').length;
}, 0);
const rareShare = Object.values(api.packSlotsFor('rare')).reduce((acc, slot) => {
  const shares = api.slotRarityShares('rare', slot, rarePool);
  return acc + ['epic','ultraepic','legendary','mythic','divine','secret','ultrasecret','hypersecret','unique']
    .reduce((sum, key) => sum + (shares[key] || 0), 0) / api.packSlotsFor('rare').length;
}, 0);
assert.ok(rareShare > classicShare * 2, 'le Pack Rare doit dominer le classique sur Épique+');

dom.window.close();
console.log('PASS tables de taux exactes, aucun palier garanti, aucun bonus, aucun pack rentable');
