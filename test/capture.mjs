// Captures marketing screenshots of the bar into docs/assets.
import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const OUT = path.join(EXT, 'docs', 'assets');

const html = `<!DOCTYPE html><html><head><meta charset="utf-8">
<link href="https://fonts.googleapis.com/css2?family=Newsreader:opsz,wght@6..72,400;6..72,500&display=swap" rel="stylesheet">
<style>
  html,body{margin:0;background:#f6f3ec;overflow:hidden}
  body{font:20px/1.65 "Newsreader",Georgia,serif;color:#1d1c1a;padding:56px 64px;width:640px;box-sizing:border-box}
  h2{font-weight:500;font-size:30px;line-height:1.2;margin:0 0 22px;letter-spacing:-.01em}
  p{margin:0 0 18px}
  ::selection{background:#ffe066;color:#1d1c1a}
</style></head><body>
<h2>Why we still read on paper</h2>
<p id="a">Screens are faster, but paper remembers. Studies keep finding that readers recall the <span id="sel">position of an idea on a physical page</span> long after the words themselves have faded, a kind of spatial memory that scrolling quietly erases.</p>
<p>Perhaps that is why the habit of underlining survives every format change: it is less about the mark and more about the moment of deciding something matters.</p>
</body></html>`;

const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(html);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snipbar-cap-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 640, height: 400 },
  deviceScaleFactor: 2,
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`],
});
const page = context.pages()[0] ?? (await context.newPage());
await page.goto(ORIGIN);
await page.waitForSelector('snipbar-host', { state: 'attached' });
await page.evaluate(() => document.fonts.ready);
await page.waitForTimeout(300);

const box = await page.locator('#sel').boundingBox();
await page.mouse.move(box.x + 1, box.y + box.height / 2);
await page.mouse.down();
await page.mouse.move(box.x + box.width - 2, box.y + box.height / 2, { steps: 10 });
await page.mouse.up();
await page.waitForTimeout(500);
await page.screenshot({ path: path.join(OUT, 'shot-bar.png') });
console.log('shot-bar.png');

// Hover state on the Copy button.
const hostBox = await page.evaluate(() => {
  const r = document.querySelector('snipbar-host').shadowRoot.querySelector('[data-action="copy"]').getBoundingClientRect();
  return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
});
await page.mouse.move(hostBox.x, hostBox.y);
await page.waitForTimeout(200);
await page.screenshot({ path: path.join(OUT, 'shot-bar-hover.png') });
console.log('shot-bar-hover.png');

// Popup at 2x for the landing page.
const extPage = await context.newPage();
await extPage.goto('chrome://extensions');
const id = await extPage.evaluate(() => {
  const mgr = document.querySelector('extensions-manager');
  return mgr.shadowRoot.querySelector('extensions-item-list').shadowRoot.querySelector('extensions-item')?.id;
});
await extPage.goto(`chrome-extension://${id}/popup.html`);
await extPage.waitForTimeout(200);
const size = await extPage.evaluate(() => ({ w: document.body.offsetWidth, h: document.body.offsetHeight }));
await extPage.setViewportSize({ width: size.w, height: size.h });
await extPage.screenshot({ path: path.join(OUT, 'shot-popup.png') });
console.log('shot-popup.png');

await context.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });
