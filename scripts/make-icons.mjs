// Draws the home-screen icons in assets/icons/ from FullVision's logo
// (favicon.svg: a blue square with four rising bars).
//
//   node scripts/make-icons.mjs
//
// Run it again only if the logo changes. It renders in Playwright's Chromium,
// so it needs no image tools beyond what the e2e tests already install.
//
// - icon-192.png, icon-512.png: the logo as it is, rounded corners and all
//   (manifest, purpose "any").
// - icon-maskable-192.png, icon-maskable-512.png: blue to the edges, bars
//   shrunk to sit inside the middle 80% circle that Android may crop to
//   (manifest, purpose "maskable").
// - apple-touch-icon.png (180): blue to the edges with no transparency,
//   because iOS rounds the corners itself and fills clear pixels with black.
import { chromium } from 'playwright';
import { mkdirSync, readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const out = resolve(root, 'assets/icons');
const logo = readFileSync(resolve(root, 'favicon.svg'), 'utf-8');

// The four bars from favicon.svg, without the rounded background square.
const bars = logo.match(/<rect x="13"[\s\S]*<\/svg>/)[0].replace('</svg>', '');
if ((bars.match(/<rect/g) || []).length !== 4) throw new Error('favicon.svg no longer has four bars');

const square = '<rect width="64" height="64" fill="#0071e3"/>';
const svg = inner => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 64 64">${inner}</svg>`;
// Shrink the bars toward the centre of the square.
const shrink = scale => `<g transform="translate(32 32) scale(${scale}) translate(-32 -32)">${bars}</g>`;

const icons = [
  { file: 'icon-192.png', size: 192, svg: logo },
  { file: 'icon-512.png', size: 512, svg: logo },
  { file: 'icon-maskable-192.png', size: 192, svg: svg(square + shrink(0.8)) },
  { file: 'icon-maskable-512.png', size: 512, svg: svg(square + shrink(0.8)) },
  { file: 'apple-touch-icon.png', size: 180, svg: svg(square + bars) },
];

mkdirSync(out, { recursive: true });
const browser = await chromium.launch();
try {
  for (const icon of icons) {
    const page = await browser.newPage({ viewport: { width: icon.size, height: icon.size } });
    const body = icon.svg.replace('<svg ', `<svg width="${icon.size}" height="${icon.size}" `);
    await page.setContent(`<style>html,body{margin:0;background:transparent}svg{display:block}</style>${body}`);
    await page.screenshot({ path: resolve(out, icon.file), omitBackground: true });
    await page.close();
    console.log('assets/icons/' + icon.file);
  }
} finally {
  await browser.close();
}
