import { chromium } from 'playwright';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '..');
const svg = fs.readFileSync(path.join(root, 'docs', 'assets', 'logo.svg'), 'utf8');

const browser = await chromium.launch();
const page = await browser.newPage();
for (const size of [16, 32, 48, 128]) {
  await page.setViewportSize({ width: size, height: size });
  await page.setContent(
    `<style>html,body{margin:0;background:transparent}svg{display:block}</style>` +
      svg.replace('<svg ', `<svg width="${size}" height="${size}" `)
  );
  await page.screenshot({ path: path.join(root, 'icons', `icon${size}.png`), omitBackground: true });
  console.log(`icon${size}.png`);
}
await browser.close();
