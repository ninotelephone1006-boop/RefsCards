const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
  url: 'https://example.test/', runScripts: 'outside-only', pretendToBeVisual: true
});
const w = dom.window;
w.matchMedia = () => ({ matches: true, addEventListener() {} });
const noop = () => {};
w.HTMLCanvasElement.prototype.getContext = () => new Proxy({}, { get: () => noop, set: () => true });
w.Sound = new Proxy({}, { get: () => noop });
const context = dom.getInternalVMContext();
vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
vm.runInContext(fs.readFileSync('quests.js', 'utf8'), context);
vm.runInContext(`
  const expectedRates = {
    common: .01, uncommon: .008, rare: .006, superrare: .0045,
    epic: .003, ultraepic: .002, mythic: .0012, legendary: .0008,
    divine: .0005, secret: .0002
  };
  for (const [rarity, rate] of Object.entries(expectedRates)) {
    if (CardMutations.definitions[0].rates[rarity] !== rate) throw Error('Taux incorrect');
    const base = { id: 'test', name: 'Test', description: 'Originale', rarity, value: 42 };
    const shiny = CardMutations.roll(base, () => rate - 1e-10);
    if (shiny.mutation !== 'shiny') throw Error('Borne basse');
    if (CardMutations.roll(base, () => rate).mutation) throw Error('Borne haute');
    if (base.mutation || base.id !== 'test') throw Error('Catalogue modifié');
    if (shiny.description !== base.description || shiny.rarity !== rarity || shiny.value !== 42) throw Error('Original perdu');
    if (CardMutations.roll(shiny, () => { throw Error('Nouveau tirage'); }) !== shiny) throw Error('Double mutation');
  }
`, context);
vm.runInContext(fs.readFileSync('app.js', 'utf8').replace(/\}\)\(\);\s*$/, `
  window.testMutations = { state, applySave, renderCollection, countMap, fusableEntries,
    statsFor, cardFrame, drawPack, collectionIds };
})();`), context);
const api = w.testMutations;
api.applySave({ collection: ['chasseur-royer', 'chasseur-royer::shiny', 'chasseur-royer::shiny', 'unknown::shiny'] });
assert.equal(api.state.collection.length, 3);
assert.equal(api.countMap().get('chasseur-royer'), 1);
assert.equal(api.countMap().get('chasseur-royer::shiny'), 2);
assert.equal(api.fusableEntries().length, 1);
assert.equal(api.fusableEntries()[0].card.mutation, 'shiny');
assert.equal(JSON.stringify(api.collectionIds()), JSON.stringify(['chasseur-royer', 'chasseur-royer::shiny', 'chasseur-royer::shiny']));
api.renderCollection();
// Une vignette possédée à la fois en normal et en shiny montre la carte
// normale avec une pastille ✦ (le détail shiny reste visible à l'inspection).
assert.ok(w.document.querySelector('#coll-grid .coll-shiny-dot'), 'pastille shiny attendue sur la vignette');
assert.equal(w.document.querySelector('#coll-grid .coll-pill').textContent, 'x3', 'les 3 exemplaires sont comptés');
const shiny = api.state.collection[1];
assert.ok(api.cardFrame(shiny).querySelector('.cf-mutation').textContent.includes('Shiny'));
const stats = api.statsFor(api.collectionIds(), 0);
assert.equal(stats.total, 3);
assert.equal(stats.unique, 1);
// A reload resolves variants without using the random source.
w.Math.random = () => { throw Error('No random on load'); };
api.applySave({ collection: JSON.parse(JSON.stringify(api.collectionIds())) });
assert.equal(api.state.collection[1].mutation, 'shiny');
w.Math.random = () => 0;
const pack = api.drawPack(false);
assert.ok(pack.every(c => c.mutation === 'shiny'));
assert.equal(new Set(pack.map(c => c.id)).size, new Set(pack.map(c => c.baseId)).size);
dom.window.close();
console.log('PASS mutations : dix taux exacts, bornes, originaux, variantes, fusion, collection, sauvegarde et tirage');
