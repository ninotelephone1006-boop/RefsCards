// Requires playwright-core and a Chromium executable (CHROME_PATH), or
// @sparticuz/chromium. Run: node tests/card-flip-browser.cjs
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const { chromium } = require('playwright-core');

(async () => {
  const root = path.resolve(__dirname, '..');
  const server = http.createServer((req, res) => {
    const pathname = decodeURIComponent(new URL(req.url, 'http://localhost').pathname);
    const file = path.resolve(root, '.' + (pathname === '/' ? '/index.html' : pathname));
    if (!file.startsWith(root + path.sep)) { res.writeHead(403).end(); return; }
    fs.readFile(file, (err, content) => {
      if (err) { res.writeHead(404).end(); return; }
      const types = { '.html': 'text/html', '.css': 'text/css', '.js': 'text/javascript', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg', '.png': 'image/png' };
      res.writeHead(200, { 'Content-Type': types[path.extname(file)] || 'application/octet-stream' }).end(content);
    });
  });
  const executablePath = process.env.CHROME_PATH || await require('@sparticuz/chromium').default.executablePath();
  const browser = await chromium.launch({ executablePath, headless: true, args: ['--no-sandbox'] });
  try {
    await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
    for (const [width, reducedMotion] of [[390, 'no-preference'], [1440, 'reduce']]) {
      const page = await browser.newPage({ viewport: { width, height: 850 }, reducedMotion });
      const errors = [];
      page.on('pageerror', error => errors.push(error));
      await page.goto(`http://127.0.0.1:${server.address().port}/?demo=1`);
      await page.locator('#pack').focus();
      await page.keyboard.press('Enter');
      await page.locator('.card.is-top').waitFor();
      for (let i = 0; i < 5; i++) {
        const card = page.locator('.card.is-top');
        // Click twice during epic suspense, without generating a double-click.
        await card.click();
        if (i === 2 && reducedMotion === 'no-preference') {
          const coins = await page.locator('#coins').textContent();
          await card.dispatchEvent('click', { detail: 1 });
          await card.focus();
          await page.keyboard.press('Enter');
          assert.equal(await page.locator('#coins').textContent(), coins, 'suspense must not award coins twice');
        }
        if (!i && reducedMotion === 'no-preference') {
          await page.waitForTimeout(220);
          const angle = await card.locator('.card-inner').evaluate(el => new DOMMatrix(getComputedStyle(el).transform).m11);
          assert.ok(angle < 0.99 && angle > -0.99, `flip should animate, got ${angle}`);
        }
        await page.waitForTimeout(reducedMotion === 'reduce' ? 500 : 2100);
        const result = await card.evaluate(el => {
          const inner = el.querySelector('.card-inner');
          const front = el.querySelector('.card-front');
          const r = el.getBoundingClientRect();
          const hit = document.elementFromPoint(r.left + r.width / 2, r.top + r.height / 2);
          return {
            angle: new DOMMatrix(getComputedStyle(inner).transform).m11,
            faceVisible: front.contains(hit),
            imageLoaded: front.querySelector('.cf').classList.contains('has-img'),
            label: el.getAttribute('aria-label'), classes: el.className, innerAnimation: getComputedStyle(inner).animationName, transform: getComputedStyle(inner).transform, flip: getComputedStyle(inner).getPropertyValue('--flip'), transition: getComputedStyle(inner).transitionDuration
          };
        });
        assert.ok(result.angle < -0.99, `card must finish rotated: ${JSON.stringify(result)}`);
        assert.ok(result.faceVisible, 'the revealed face must be visible and on top');
        assert.ok(result.imageLoaded, 'card image must load');
        assert.ok(result.label.includes('Carte suivante'));
        await page.locator('#next-card').click();
        await page.waitForFunction(count => document.querySelectorAll('.slot.is-filled').length === count, i + 1, { timeout: 4000 });
      }
      assert.equal(await page.locator('#pile-label').textContent(), '5 / 5 CARTES');
      assert.deepEqual(errors, [], 'the flow must not produce browser errors');
      await page.close();
      console.log(`PASS browser flip at width ${width}, reduced motion: ${reducedMotion}`);
    }
  } finally {
    await browser.close();
    await new Promise(resolve => server.close(resolve));
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
