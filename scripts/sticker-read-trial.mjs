#!/usr/bin/env node
/* A made-up trial of whether a sticker this small reads
 * (docs/plans/add-work-for-class-plan.md, B4).
 *
 * MADE-UP PAGES, NOT THE SCHOOL COPIER. Each trial draws a letter page as a
 * copier would scan it (200 or 300 dots per inch), with a sticker on it: an
 * Avery 5167 label (1.75 by 0.5 inches) carrying a QR code (version 1, level
 * Q, FVS + a 12-character code) of a given size, the student's first name
 * and last initial and the class. The page has lines of made-up writing and
 * a handout's own QR code at the top. Then, as the case says: slight blur,
 * noise, a few degrees of skew, the page fed in upside down. The scan is a
 * JPEG (as the copier's PDF holds), shrunk by the app's own
 * PhotoShrink.prepare (about 2000 px on the long side, as every page is)
 * and read with the app's own ScanLabelRead.read.
 *
 * Nothing here is a real scan, and no file is written.
 *
 *   node scripts/sticker-read-trial.mjs [trials per case, default 10]
 *
 * Prints one line per QR size, scan resolution and case: how many read
 * back as the right code (and the right way up), and the time a read took. */
/* global window, document, qrcode, PhotoShrink, ScanLabelRead -- the evaluate below runs in the page */
import { chromium } from 'playwright';
import { readFileSync } from 'fs';
import { dirname, resolve } from 'path';
import { fileURLToPath } from 'url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const TRIALS = Number(process.argv[2]) || 10;
const SIZES = [0.25, 0.3, 0.35, 0.4, 0.44]; // inches, the QR's side (0.44 fills a 0.5 inch label but for a thin edge)
const DPIS = [200, 300];
const CASES = [
  { name: 'clean' },
  { name: 'blur', blur: true },
  { name: 'noise', noise: true },
  { name: 'skew 3°', skew: 3 },
  { name: 'upside down', skew: 1, flip: true },
  { name: 'all together', blur: true, noise: true, skew: -2.5, flip: true },
];

const browser = await chromium.launch();
const page = await browser.newPage();
page.on('console', m => process.stderr.write(m.text() + '\n'));
// A secure origin, so PhotoShrink can hash pages (crypto.subtle). Nothing leaves the machine:
// the one address is answered here.
await page.route('https://trial.localhost/', route =>
  route.fulfill({ contentType: 'text/html', body: '<!doctype html><html><body></body></html>' }),
);
await page.goto('https://trial.localhost/');
for (const file of ['vendor/qrcode.js', 'vendor/jsqr/jsQR.js', 'shared/photo-shrink.js', 'shared/scan-label-read.js']) {
  await page.addScriptTag({ content: readFileSync(resolve(root, file), 'utf-8') });
}

const results = await page.evaluate(
  async ({ SIZES, DPIS, CASES, TRIALS }) => {
    ScanLabelRead.configure({ load: () => Promise.resolve(window.jsQR) });
    const ALPHA = '23456789ABCDEFGHJKLMNPQRSTUVWXYZ';
    let seed = 20261117;
    const rand = () => (seed = (seed * 1103515245 + 12345) % 2147483648) / 2147483648;
    const code12 = () => Array.from({ length: 12 }, () => ALPHA[Math.floor(rand() * ALPHA.length)]).join('');

    function drawQr(ctx, text, mode, version, level, x, y, side) {
      const qr = qrcode(version, level);
      qr.addData(text, mode);
      qr.make();
      const n = qr.getModuleCount();
      const m = side / n;
      ctx.fillStyle = '#111';
      for (let r = 0; r < n; r++)
        for (let c = 0; c < n; c++) if (qr.isDark(r, c)) ctx.fillRect(x + c * m, y + r * m, m + 0.02, m + 0.02);
    }

    // One scanned page as a JPEG blob.
    async function scan(dpi, qrIn, code, kase) {
      const W = Math.round(8.5 * dpi);
      const H = Math.round(11 * dpi);
      const cv = document.createElement('canvas');
      cv.width = W;
      cv.height = H;
      const ctx = cv.getContext('2d', { willReadFrequently: true });
      ctx.fillStyle = '#fff';
      ctx.fillRect(0, 0, W, H);
      ctx.save();
      ctx.translate(W / 2, H / 2);
      ctx.rotate((((kase.flip ? 180 : 0) + (kase.skew || 0)) * Math.PI) / 180);
      ctx.translate(-W / 2, -H / 2);
      const d = dpi;
      // Lines of made-up writing.
      ctx.fillStyle = '#333';
      for (let line = 0; line < 26; line++) {
        let x = 0.9 * d;
        const y = (2.2 + line * 0.33) * d;
        while (x < 7.6 * d) {
          const w = (0.15 + rand() * 0.6) * d;
          ctx.fillRect(x, y, w, 0.035 * d + rand() * 0.04 * d);
          x += w + 0.08 * d;
        }
      }
      ctx.fillText && (ctx.font = Math.round(0.2 * d) + 'px sans-serif');
      ctx.fillText('Unit 3 Reflection', 0.9 * d, 1.1 * d);
      // The handout's own QR code, top left.
      drawQr(ctx, 'https://example.com/handouts/unit-3', 'Byte', 0, 'M', 0.6 * d, 0.3 * d, 0.6 * d);
      // The sticker, somewhere along the top right, stuck the right way up.
      const lx = (4.5 + rand() * 2) * d;
      const ly = (0.3 + rand() * 0.9) * d;
      ctx.fillStyle = '#fff';
      ctx.fillRect(lx, ly, 1.75 * d, 0.5 * d);
      ctx.strokeStyle = '#ddd';
      ctx.lineWidth = Math.max(1, 0.004 * d);
      ctx.strokeRect(lx, ly, 1.75 * d, 0.5 * d);
      const pad = (0.5 - qrIn) / 2;
      drawQr(ctx, 'FVS' + code, 'Alphanumeric', 1, 'Q', lx + Math.max(pad, 0.04) * d, ly + pad * d, qrIn * d);
      ctx.fillStyle = '#111';
      ctx.font = 'bold ' + Math.round(0.17 * d) + 'px sans-serif';
      ctx.fillText('Jas B.', lx + (qrIn + 0.14) * d, ly + 0.25 * d);
      ctx.font = Math.round(0.1 * d) + 'px sans-serif';
      ctx.fillText('Socials 10 · C', lx + (qrIn + 0.14) * d, ly + 0.4 * d);
      ctx.restore();
      if (kase.blur) {
        // About a hundredth of a centimetre of blur, over the whole page at once.
        const copy = document.createElement('canvas');
        copy.width = W;
        copy.height = H;
        const cctx = copy.getContext('2d');
        cctx.filter = 'blur(' + (0.004 * dpi).toFixed(2) + 'px)';
        cctx.drawImage(cv, 0, 0);
        ctx.drawImage(copy, 0, 0);
        copy.width = copy.height = 0;
      }
      if (kase.noise) {
        const img = ctx.getImageData(0, 0, W, H);
        const p = img.data;
        for (let i = 0; i < p.length; i += 4) {
          const n = (rand() + rand() + rand() - 1.5) * 34;
          p[i] = Math.max(0, Math.min(255, p[i] + n));
          p[i + 1] = Math.max(0, Math.min(255, p[i + 1] + n));
          p[i + 2] = Math.max(0, Math.min(255, p[i + 2] + n));
        }
        ctx.putImageData(img, 0, 0);
      }
      const blob = await new Promise(r => cv.toBlob(r, 'image/jpeg', 0.7));
      cv.width = cv.height = 0;
      return blob;
    }

    const out = [];
    for (const size of SIZES) {
      for (const dpi of DPIS) {
        for (const kase of CASES) {
          let ok = 0;
          let wrongWay = 0;
          let ms = 0;
          for (let t = 0; t < TRIALS; t++) {
            const code = code12();
            const jpeg = await scan(dpi, size, code, kase);
            const prepared = await PhotoShrink.prepare(new File([jpeg], 'scan.jpg', { type: 'image/jpeg' }));
            if (!prepared || !prepared.ok) throw new Error('PhotoShrink refused the page: ' + JSON.stringify(prepared));
            const pg = prepared.pages[0];
            const t0 = performance.now();
            const got = await ScanLabelRead.read(pg);
            ms += performance.now() - t0;
            if (got && got.code === code) {
              if (got.upsideDown === !!kase.flip) ok++;
              else wrongWay++;
            } else if (got) throw new Error('A wrong code was read: ' + got.code + ' for ' + code);
          }
          out.push({ size, dpi, kase: kase.name, ok, wrongWay, trials: TRIALS, ms: Math.round(ms / TRIALS) });
          console.log(JSON.stringify(out[out.length - 1]));
        }
      }
    }
    return out;
  },
  { SIZES, DPIS, CASES, TRIALS },
);
await browser.close();

console.log('MADE-UP PAGES, NOT THE SCHOOL COPIER. ' + TRIALS + ' pages per line.');
console.log('QR side  scan     case            read   time per page');
for (const r of results) {
  console.log(
    (r.size.toFixed(2) + ' in').padEnd(9) +
      (r.dpi + ' dpi').padEnd(9) +
      r.kase.padEnd(16) +
      (r.ok + '/' + r.trials + (r.wrongWay ? ' (' + r.wrongWay + ' wrong way up)' : '')).padEnd(7) +
      r.ms +
      ' ms',
  );
}
const always = SIZES.filter(s => results.filter(r => r.size === s).every(r => r.ok === r.trials));
console.log('Smallest QR side that read every page: ' + (always.length ? always[0].toFixed(2) + ' in' : 'none'));
