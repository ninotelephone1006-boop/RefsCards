// Run with NODE_PATH pointing to a local jsdom installation: node tests/card-flow.cjs
const { JSDOM } = require('jsdom');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
(async () => {
  for (const width of [390, 1440]) {
    const dom = new JSDOM(fs.readFileSync('index.html', 'utf8'), {
      url: 'https://example.test/?demo=1', runScripts: 'outside-only', pretendToBeVisual: true
    });
    const w = dom.window;
    w.innerWidth = width;
    w.matchMedia = () => ({ matches: true, addEventListener() {} });
    const noop = () => {};
    const ctx = new Proxy({}, { get: () => noop, set: () => true });
    w.HTMLCanvasElement.prototype.getContext = () => ctx;
    w.Sound = new Proxy({}, { get: () => noop });
    const context = dom.getInternalVMContext();
    vm.runInContext(fs.readFileSync('cards.js', 'utf8'), context);
    const sources = vm.runInContext('cardsDatabase.flatMap(cardImageSources)', context);
    assert.equal(sources.length, 14);
    for (const src of sources) assert.ok(fs.existsSync(src), src);
    // Start the reveal directly; the pack tear is unrelated to this regression.
    vm.runInContext(fs.readFileSync('app.js', 'utf8').replace('  boot();', '  boot(); showReveal();'), context);
    const wait = ms => new Promise(resolve => setTimeout(resolve, ms));
    await wait(30);
    const next = w.document.getElementById('next-card');
    assert.ok(next.hidden);
    for (let i = 0; i < 5; i++) {
      const card = w.document.querySelector('.card.is-top');
      assert.ok(card);
      card.click();
      await wait(15);
      assert.ok(!next.hidden);
      next.click();
      next.click(); // repeated taps must not collect twice
      assert.ok(next.hidden);
      await wait(160);
      assert.equal(w.document.querySelectorAll('.slot.is-filled').length, i + 1);
      assert.equal(w.document.querySelectorAll('#stack .card').length, 4 - i);
    }
    assert.equal(w.document.getElementById('pile-label').textContent, '5 / 5 CARTES');
    dom.window.close();
    console.log(`PASS card flow and image paths at viewport width ${width} (DOM simulation)`);
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
