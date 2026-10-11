import { chromium } from 'playwright';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const EXT = path.resolve(__dirname, '..');
const SHOTS = path.join(__dirname, 'shots');
fs.rmSync(SHOTS, { recursive: true, force: true });
fs.mkdirSync(SHOTS, { recursive: true });

const results = [];
const record = (name, pass, detail = '') => {
  results.push({ name, pass, detail });
  console.log(`${pass ? 'PASS' : 'FAIL'}  ${name}${detail ? `  :: ${detail}` : ''}`);
};

// Serve the fixture over http so the content script matches without file:// permissions.
const fixture = fs.readFileSync(path.join(__dirname, 'fixture.html'));
const server = http.createServer((req, res) => {
  res.writeHead(200, { 'content-type': 'text/html; charset=utf-8' });
  res.end(fixture);
});
await new Promise((r) => server.listen(0, '127.0.0.1', r));
const ORIGIN = `http://127.0.0.1:${server.address().port}`;

const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'snipbar-profile-'));
const context = await chromium.launchPersistentContext(profile, {
  headless: false,
  viewport: { width: 1100, height: 720 },
  args: [`--disable-extensions-except=${EXT}`, `--load-extension=${EXT}`, '--lang=en-US'],
});
await context.grantPermissions(['clipboard-read', 'clipboard-write'], { origin: ORIGIN });
// Never hit real search engines: swallow every non-local navigation.
await context.route(/^https?:\/\/(?!127\.0\.0\.1)/, (route) =>
  route.fulfill({ status: 200, contentType: 'text/html', body: '<title>stub</title>' })
);

const page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(8000);
await page.goto(ORIGIN);
await page.waitForSelector('snipbar-host', { state: 'attached' });
// ---- helpers ----
const barState = (p = page) =>
  p.evaluate(() => {
    const bar = document.querySelector('snipbar-host').shadowRoot.querySelector('.bar');
    const r = bar.getBoundingClientRect();
    return {
      visible: bar.classList.contains('show'),
      above: bar.classList.contains('above'),
      left: r.left, top: r.top, width: r.width, height: r.height, bottom: r.bottom,
      copyLabel: bar.querySelector('[data-action="copy"] span').textContent,
      engineLabel: bar.querySelector('[data-label="engine"]').textContent,
      assistantLabel: bar.querySelector('[data-label="assistant"]').textContent,
    };
  });
const selRect = (p = page) =>
  p.evaluate(() => {
    const r = document.getSelection().getRangeAt(0).getBoundingClientRect();
    return { left: r.left, right: r.right, top: r.top, bottom: r.bottom };
  });
const settle = (ms = 300) => page.waitForTimeout(ms);
const clickBar = (action, p = page) =>
  p.evaluate((a) => document.querySelector('snipbar-host').shadowRoot.querySelector(`[data-action="${a}"]`).click(), action);
const waitBar = async (want, p = page) => {
  await p.waitForFunction(
    (w) => document.querySelector('snipbar-host').shadowRoot.querySelector('.bar').classList.contains('show') === w,
    want
  );
  return barState(p);
};
// Drag-select from the first word to the fifth word of an element.
async function dragSelect(selector, fromWord = 0, toWord = 5) {
  // Dragging over already selected text starts a native text drag, so clear first.
  await page.evaluate(() => document.getSelection().removeAllRanges());
  await page.waitForTimeout(50);
  const pts = await page.evaluate(({ selector, fromWord, toWord }) => {
    const el = document.querySelector(selector);
    const node = el.firstChild;
    const text = node.textContent;
    const idx = (n) => {
      let i = 0;
      for (let k = 0; k < n; k++) i = text.indexOf(' ', i) + 1;
      return i;
    };
    const rectAt = (i) => {
      const r = document.createRange();
      r.setStart(node, i);
      r.setEnd(node, i + 1);
      const b = r.getBoundingClientRect();
      return { x: b.left + 1, y: b.top + b.height / 2 };
    };
    return { from: rectAt(idx(fromWord)), to: rectAt(Math.max(0, idx(toWord) - 2)) };
  }, { selector, fromWord, toWord });
  await page.mouse.move(pts.from.x, pts.from.y);
  await page.mouse.down();
  await page.mouse.move(pts.to.x, pts.to.y, { steps: 8 });
  await page.mouse.up();
}
const clipboard = () => page.evaluate(() => navigator.clipboard.readText());
const waitForNewPage = async (trigger) => {
  const [np] = await Promise.all([context.waitForEvent('page'), trigger()]);
  await np.waitForLoadState('domcontentloaded').catch(() => {});
  const url = np.url();
  await np.close();
  await page.bringToFront();
  return url;
};

// ---- 1. no bar at rest ----
{
  const s = await barState();
  record('bar hidden before any selection', !s.visible);
}

// ---- 2. mouse drag shows bar below, centred ----
{
  await dragSelect('#p1', 0, 5);
  const s = await waitBar(true);
  const r = await selRect();
  const selCenter = (r.left + r.right) / 2;
  const barCenter = s.left + s.width / 2;
  record('drag selection shows bar', s.visible, `${s.width}x${s.height}`);
  record('bar sits below the selection', s.top > r.bottom && s.top - r.bottom < 20, `gap=${(s.top - r.bottom).toFixed(1)}`);
  record('bar centred under selection', Math.abs(selCenter - barCenter) < 4, `delta=${(selCenter - barCenter).toFixed(1)}`);
  record('default labels', s.engineLabel === 'Google' && s.assistantLabel === 'ChatGPT', `${s.engineLabel}/${s.assistantLabel}`);
  await page.screenshot({ path: path.join(SHOTS, 'bar-below.png') });
}

// ---- 3. copy ----
{
  await page.evaluate(() => navigator.clipboard.writeText(''));
  const selected = await page.evaluate(() => document.getSelection().toString());
  await clickBar('copy');
  await settle(150);
  const mid = await barState();
  record('copy shows Copied feedback', mid.copyLabel === 'Copied', mid.copyLabel);
  const clip = await clipboard();
  record('copy puts selection on clipboard', clip === selected, JSON.stringify(clip));
  const after = await waitBar(false);
  record('bar hides after copy', !after.visible);
}

// ---- 4. search opens engine URL in new tab ----
{
  await dragSelect('#p2', 0, 4);
  await waitBar(true);
  const selected = await page.evaluate(() => document.getSelection().toString());
  const url = await waitForNewPage(() => clickBar('search'));
  const want = 'https://www.google.com/search?q=' + encodeURIComponent(selected.replace(/\s+/g, ' ').trim());
  record('search opens Google with encoded query', url === want, url);
  await settle(400);
  record('bar hides after search', !(await barState()).visible);
}

// ---- 5. ask opens ChatGPT ----
{
  await dragSelect('#p2', 0, 3);
  await waitBar(true);
  const selected = await page.evaluate(() => document.getSelection().toString());
  const url = await waitForNewPage(() => clickBar('ask'));
  const want = 'https://chatgpt.com/?q=' + encodeURIComponent(selected.replace(/\s+/g, ' ').trim());
  record('ask opens ChatGPT with ?q= query', url === want, url);
}

// ---- 6. click away hides, Escape hides ----
{
  await dragSelect('#p1', 2, 6);
  await waitBar(true);
  await page.mouse.click(30, 30);
  const s = await waitBar(false);
  record('click elsewhere hides bar', !s.visible);

  await dragSelect('#p1', 2, 6);
  await waitBar(true);
  await page.keyboard.press('Escape');
  const s2 = await waitBar(false);
  const stillSelected = await page.evaluate(() => !document.getSelection().isCollapsed);
  record('Escape hides bar but keeps selection', !s2.visible && stillSelected);
  await page.mouse.click(30, 30);
  await waitBar(false);
}

// ---- 7. keyboard selection ----
{
  await page.mouse.click(30, 30);
  await waitBar(false).catch(() => {});
  await page.keyboard.press('ControlOrMeta+a');
  const s = await waitBar(true);
  record('keyboard select-all shows bar without mouse', s.visible);
  await page.keyboard.press('Escape');
  await waitBar(false);
}

// ---- 8. whitespace-only selection does not show ----
{
  await page.evaluate(() => {
    const node = document.querySelector('#p1').firstChild;
    const i = node.textContent.indexOf(' ');
    const r = document.createRange();
    r.setStart(node, i);
    r.setEnd(node, i + 1);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await settle(400);
  record('whitespace-only selection stays hidden', !(await barState()).visible);
  await page.mouse.click(30, 30);
}

// ---- 9. textarea selection ----
{
  const ta = page.locator('#ta');
  const box = await ta.boundingBox();
  await ta.click();
  await page.evaluate(() => {
    const t = document.querySelector('#ta');
    t.setSelectionRange(0, 8);
  });
  await page.mouse.move(box.x + 40, box.y + 20);
  await page.mouse.down();
  await page.mouse.up();
  await page.evaluate(() => document.querySelector('#ta').setSelectionRange(0, 8));
  const s = await waitBar(true);
  record('textarea selection shows bar', s.visible);
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await clickBar('copy');
  await settle(150);
  record('copy from textarea copies field text', (await clipboard()) === 'Textarea', JSON.stringify(await clipboard()));
  await waitBar(false);
  await page.mouse.click(30, 30);
}

// ---- 10. same-origin iframe ----
{
  const frame = page.frames().find((f) => f !== page.mainFrame());
  await frame.waitForSelector('snipbar-host', { state: 'attached' });
  const fp = frame.locator('#fp');
  await fp.click({ clickCount: 3 });
  const s = await waitBar(true, frame);
  record('selection inside iframe shows bar in frame', s.visible);
  await page.keyboard.press('Escape');
  await page.mouse.click(30, 30);
  await waitBar(false, frame).catch(() => {});
}

// ---- 10b. beautify (proxy mocked inside the service worker) ----
{
  const sw = context.serviceWorkers()[0] ?? (await context.waitForEvent('serviceworker'));
  const mockProxy = (status, body) =>
    sw.evaluate(({ status, body }) => {
      self.__calls = [];
      self.fetch = async (url, opts) => {
        const { text } = JSON.parse(opts.body);
        self.__calls.push({ url: String(url), text });
        const out = body ?? { text: 'POLISHED: ' + text.toUpperCase() };
        return new Response(JSON.stringify(out), { status, headers: { 'content-type': 'application/json' } });
      };
    }, { status, body });
  const shadow = (fn, arg) => page.evaluate(fn, arg);
  const beautifyLabel = () =>
    shadow(() => document.querySelector('snipbar-host').shadowRoot.querySelector('[data-action="beautify"] span').textContent);
  const cardState = () =>
    shadow(() => {
      const c = document.querySelector('snipbar-host').shadowRoot.querySelector('.card');
      return { open: !c.hidden && c.offsetHeight > 0, text: c.querySelector('.card-text').textContent };
    });
  await mockProxy(200);
  await page.evaluate(() => window.scrollTo(0, 0));

  // static page text -> result card
  await dragSelect('#p1', 0, 4);
  await waitBar(true);
  const selected = await page.evaluate(() => document.getSelection().toString());
  await clickBar('beautify');
  await page.waitForFunction(() => !document.querySelector('snipbar-host').shadowRoot.querySelector('.card').hidden);
  const c = await cardState();
  record('beautify on page text shows result card', c.open && c.text === 'POLISHED: ' + selected.toUpperCase(), JSON.stringify(c.text));
  const calls = await sw.evaluate(() => self.__calls);
  record('beautify posts to the snipbar proxy', calls.length === 1 && calls[0].url === 'https://snipbar.vercel.app/api/beautify', JSON.stringify(calls));
  await settle(300);
  await page.screenshot({ path: path.join(SHOTS, 'beautify-card.png'), clip: { x: 150, y: 0, width: 800, height: 400 } });
  await page.evaluate(() => navigator.clipboard.writeText(''));
  await shadow(() => document.querySelector('snipbar-host').shadowRoot.querySelector('[data-card="copy"]').click());
  await settle(150);
  record('card Copy copies the polished text', (await clipboard()) === c.text);
  await waitBar(false);
  record('card closes with the bar', !(await cardState()).open);

  // textarea -> replaced in place, undoable
  await page.evaluate(() => {
    const t = document.querySelector('#ta');
    t.value = 'helo world';
    t.focus();
    t.setSelectionRange(0, t.value.length);
  });
  await waitBar(true);
  await clickBar('beautify');
  await page.waitForFunction(() => document.querySelector('#ta').value.startsWith('POLISHED'));
  record('beautify replaces textarea selection', (await page.inputValue('#ta')) === 'POLISHED: HELO WORLD', await page.inputValue('#ta'));
  await page.keyboard.press('ControlOrMeta+z');
  record('undo restores the original text', (await page.inputValue('#ta')) === 'helo world', await page.inputValue('#ta'));
  await page.mouse.click(30, 30);

  // contenteditable -> replaced in place
  await page.locator('#ce').scrollIntoViewIfNeeded();
  await page.evaluate(() => {
    const el = document.querySelector('#ce');
    el.focus();
    const r = document.createRange();
    r.selectNodeContents(el);
    const sel = document.getSelection();
    sel.removeAllRanges();
    sel.addRange(r);
  });
  await waitBar(true);
  await clickBar('beautify');
  await page.waitForFunction(() => document.querySelector('#ce').textContent.startsWith('POLISHED'));
  const ce = await page.evaluate(() => document.querySelector('#ce').textContent);
  record('beautify replaces contenteditable selection', ce === 'POLISHED: EDITABLE TEXT THAT NEEDS SOME POLISH HERE.', ce);
  await page.mouse.click(30, 30);

  // password field -> no Beautify button
  await page.evaluate(() => {
    const el = document.querySelector('#pw');
    el.focus();
    el.setSelectionRange(0, el.value.length);
  });
  await waitBar(true);
  const pwHidden = await shadow(() => document.querySelector('snipbar-host').shadowRoot.querySelector('[data-action="beautify"]').offsetWidth === 0);
  record('Beautify is hidden in password fields', pwHidden);
  await page.keyboard.press('Escape');
  await page.mouse.click(30, 30);

  // proxy rate limit -> friendly label
  await mockProxy(429, { error: 'busy' });
  await page.evaluate(() => window.scrollTo(0, 0));
  await dragSelect('#p2', 0, 3);
  await waitBar(true);
  await clickBar('beautify');
  await page.waitForFunction(() => document.querySelector('snipbar-host').shadowRoot.querySelector('[data-action="beautify"] span').textContent === 'Busy, retry');
  record('rate-limited proxy shows Busy, retry', (await beautifyLabel()) === 'Busy, retry');
  await page.mouse.click(30, 30);
  await waitBar(false);
}

// ---- 11. scroll keeps bar attached ----
{
  await page.locator('#p3').scrollIntoViewIfNeeded();
  await settle(100);
  await dragSelect('#p3', 0, 4);
  const before = await waitBar(true);
  await page.mouse.wheel(0, 120);
  await settle(300);
  const after = await barState();
  const r = await selRect();
  record('bar follows selection on scroll', after.visible && Math.abs(after.top - (r.bottom + 8)) < 3, `top=${after.top.toFixed(1)} selBottom=${r.bottom.toFixed(1)} before=${before.top.toFixed(1)}`);
  await page.mouse.click(30, 300);
  await waitBar(false);
}

// ---- 12. flips above near bottom edge ----
{
  await page.evaluate(() => {
    const p = document.querySelector('#p4');
    const y = p.getBoundingClientRect().bottom + window.scrollY - window.innerHeight + 14;
    window.scrollTo(0, y);
  });
  await settle(200);
  await dragSelect('#p4', 0, 4);
  const s = await waitBar(true);
  const r = await selRect();
  record('bar flips above when no room below', s.above && s.bottom < r.top, `above=${s.above} barBottom=${s.bottom.toFixed(1)} selTop=${r.top.toFixed(1)}`);
  await page.screenshot({ path: path.join(SHOTS, 'bar-above.png') });
  await page.mouse.click(30, 300);
  await waitBar(false);
}

// ---- 13. popup changes engine + assistant ----
{
  const extPage = await context.newPage();
  await extPage.goto('chrome://extensions');
  const id = await extPage.evaluate(() => {
    const mgr = document.querySelector('extensions-manager');
    const list = mgr.shadowRoot.querySelector('extensions-item-list');
    const item = list.shadowRoot.querySelector('extensions-item');
    return item?.id;
  });
  record('extension id resolved', !!id, id);
  await extPage.goto(`chrome-extension://${id}/popup.html`);
  const title = await extPage.locator('h1').textContent();
  const gh = await extPage.locator('footer a').getAttribute('href');
  record('popup shows name and GitHub link', title === 'Snipbar' && gh === 'https://github.com/AviroopPaul/snipbar', `${title} ${gh}`);
  await extPage.screenshot({ path: path.join(SHOTS, 'popup.png') });
  await extPage.selectOption('#engine', 'duckduckgo');
  await extPage.selectOption('#assistant', 'claude');
  await extPage.waitForSelector('#saved.on');
  await extPage.close();

  await page.bringToFront();
  await page.evaluate(() => window.scrollTo(0, 0));
  await dragSelect('#p1', 0, 4);
  const s = await waitBar(true);
  record('bar reflects new engine + assistant', s.engineLabel === 'DuckDuckGo' && s.assistantLabel === 'Claude', `${s.engineLabel}/${s.assistantLabel}`);
  const selected = await page.evaluate(() => document.getSelection().toString());
  const url = await waitForNewPage(() => clickBar('search'));
  record('search uses DuckDuckGo after change', url === 'https://duckduckgo.com/?q=' + encodeURIComponent(selected.trim()), url);
  await dragSelect('#p1', 0, 4);
  await waitBar(true);
  const url2 = await waitForNewPage(() => clickBar('ask'));
  record('ask uses Claude after change', url2 === 'https://claude.ai/new?q=' + encodeURIComponent(selected.trim()), url2);
}

// ---- 14. no console errors from the content script ----
{
  const errors = [];
  page.on('pageerror', (e) => errors.push(String(e)));
  await page.reload();
  await page.waitForSelector('snipbar-host', { state: 'attached' });
  await dragSelect('#p1', 0, 3);
  await waitBar(true);
  await clickBar('copy');
  await settle(900);
  record('no page errors during a full cycle', errors.length === 0, errors.join(' | '));
}

await context.close();
server.close();
fs.rmSync(profile, { recursive: true, force: true });

const passed = results.filter((r) => r.pass).length;
console.log(`\n${passed}/${results.length} passed`);
process.exit(passed === results.length ? 0 : 1);
