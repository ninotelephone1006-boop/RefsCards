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
vm.runInContext(fs.readFileSync('app.js','utf8').replace(/\}\)\(\);\s*$/, `window.__odds = { packPool, slotRarityShares, packSlotsFor, drawPack, renderOdds, packProfitChanceFor }; })();`), ctx);
const api = w.__odds;
const expected = {common:45.30, uncommon:22, rare:15, superrare:7, epic:5, ultraepic:2.5, mythic:1.2, legendary:0.8, divine:0.4, secret:0.35, ultrasecret:0.25, hypersecret:0.17, unique:0.03};
const pool = api.packPool('classic');
assert.equal(api.packProfitChanceFor('classic'), 0);
for (const slot of api.packSlotsFor('classic')) {
  const shares = api.slotRarityShares('classic', slot, pool);
  for (const [key, pct] of Object.entries(expected)) assert.ok(Math.abs(shares[key] * 100 - pct) < 1e-9, key);
}
api.renderOdds(false, pool, 'classic');
const text = w.document.getElementById('pack-odds').textContent;
assert.match(text, /Commune 45,3 %/);
assert.match(text, /Unique 0,03 %/);
api.renderOdds(false, api.packPool('rare'), 'rare');
assert.match(w.document.getElementById('pack-odds').textContent, /Taux de base/);
// Forcer toujours la première commune prouve que le plafond et le bonus ne modifient pas le tirage.
w.Math.random = () => 0;
assert.ok(api.drawPack(false, pool, 'classic').every(c => c.rarity === 'common'));
dom.window.close();
console.log('PASS taux classiques exacts, affichage et tirage sans modifications');
