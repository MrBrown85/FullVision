import { test, expect } from '@playwright/test';
import { pagesPdf, lockedPdf, damagedPdf } from '../tests/fixtures/pdf-fixtures.mjs';

/* A PDF becomes pages in the browser (S5 PDF): shared/photo-readers.js gives
   PhotoShrink its openPdf, backed by pdf.js in vendor/pdfjs/. Run against the
   built site with the live site's CSP (scripts/e2e-server.mjs), in Demo
   Mode: the library is not fetched until a PDF is opened, it loads and runs
   under the policy as it is, and nothing breaks it. */

const PDFJS = /\/vendor\/pdfjs\//;

function watch(page) {
  const pdfjs = [];
  const csp = [];
  const errors = [];
  page.on('request', req => {
    if (PDFJS.test(req.url())) pdfjs.push(new URL(req.url()).pathname);
  });
  page.on('console', m => {
    if (/Content Security Policy|Refused to/i.test(m.text())) csp.push(m.text());
  });
  page.on('pageerror', e => errors.push(String(e)));
  return { pdfjs, csp, errors };
}

async function cspOf(page, path) {
  const res = await page.request.get(path);
  const header = res.headers()['content-security-policy'] || '';
  expect(header).toMatch(/script-src 'self' 'nonce-[0-9a-f-]+'/);
  // The policy as it is: no eval, no blob: or data: script, no WebAssembly
  // switch, and workers only from this site.
  expect(header).not.toMatch(/unsafe-eval/);
  const directive = name => (header.split(';').find(d => d.trim().startsWith(name + ' ')) || '').trim();
  expect(directive('script-src')).not.toMatch(/blob:|data:/);
  expect(directive('worker-src')).toBe("worker-src 'self'");
  return header;
}

/* Turn a PDF into pages through PhotoShrink with our openPdf, and describe
   each page: size, type, and whether the black box and the "Page n" text
   were drawn where the fixture puts them. */
async function convert(page, bytes, name = 'Lab Report.pdf') {
  return page.evaluate(
    async ({ bytes, name }) => {
      const violations = [];
      document.addEventListener('securitypolicyviolation', e =>
        violations.push(e.violatedDirective + ' ' + e.blockedURI),
      );
      const file = new File([new Uint8Array(bytes)], name, { type: 'application/pdf' });
      const res = await PhotoShrink.prepare(file, { openPdf: PhotoReaders.openPdf });
      if (!res.ok) return { ok: false, reason: res.reason, locked: !!res.locked, pageCount: res.pageCount, violations };
      const pages = [];
      for (const p of res.pages) {
        const head = new Uint8Array(await p.blob.slice(0, 3).arrayBuffer());
        const bmp = await createImageBitmap(p.blob);
        const c = document.createElement('canvas');
        c.width = bmp.width;
        c.height = bmp.height;
        const ctx = c.getContext('2d');
        ctx.drawImage(bmp, 0, 0);
        const pt = p.height / 792; // pixels per PDF point
        const at = (x, y) => ctx.getImageData(Math.round(x * pt), Math.round(y * pt), 1, 1).data[0];
        // "Page n" in 36 pt Helvetica, baseline 300 pt from the bottom.
        const band = ctx.getImageData(
          Math.round(36 * pt),
          Math.round(462 * pt),
          Math.round(160 * pt),
          Math.round(30 * pt),
        );
        let dark = 0;
        for (let i = 0; i < band.data.length; i += 4) if (band.data[i] < 100) dark++;
        pages.push({
          width: p.width,
          height: p.height,
          type: p.blob.type,
          jpeg: head[0] === 0xff && head[1] === 0xd8 && head[2] === 0xff,
          bytes: p.bytes,
          name: p.name,
          box: at(100, 100),
          paper: at(500, 700),
          textDark: dark,
        });
      }
      return { ok: true, kind: res.kind, pages, violations };
    },
    { bytes: Array.from(bytes), name },
  );
}

function expectTwoPages(res) {
  expect(res.ok).toBe(true);
  expect(res.kind).toBe('pdf');
  expect(res.pages).toHaveLength(2);
  res.pages.forEach((p, i) => {
    // A Letter page (612 × 792 pt) with its long side at 2000 px.
    expect([p.width, p.height]).toEqual([1545, 2000]);
    expect(p.type).toBe('image/jpeg');
    expect(p.jpeg).toBe(true);
    expect(p.bytes).toBeLessThan(500 * 1000);
    expect(p.name).toBe('Lab Report-page-' + (i + 1) + '.jpg');
    expect(p.box).toBeLessThan(40); // the black box
    expect(p.paper).toBeGreaterThan(220); // white paper
    expect(p.textDark).toBeGreaterThan(200); // the words were drawn
  });
  expect(res.violations).toEqual([]);
}

test('desktop, Demo Mode: pdf.js is fetched only when a PDF is opened, and a two-page PDF becomes two JPEG pages under the live CSP', async ({
  page,
}) => {
  const seen = watch(page);
  await cspOf(page, '/teacher/app.html');
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await expect(page.getByRole('button', { name: 'Class Settings' }).first()).toBeVisible();
  expect(await page.evaluate(() => typeof PhotoReaders.openPdf === 'function' && !PhotoReaders.loaded())).toBe(true);
  expect(seen.pdfjs).toEqual([]);

  expectTwoPages(await convert(page, pagesPdf(2)));
  expect(seen.pdfjs).toContain('/vendor/pdfjs/pdf.min.js');
  expect(seen.pdfjs).toContain('/vendor/pdfjs/pdf.worker.min.js');

  const many = await convert(page, pagesPdf(21));
  expect(many).toMatchObject({ ok: false, reason: 'too_many_pages', pageCount: 21 });
  const locked = await convert(page, lockedPdf());
  expect(locked).toMatchObject({ ok: false, reason: 'unreadable', locked: true });
  const damaged = await convert(page, damagedPdf());
  expect(damaged).toMatchObject({ ok: false, reason: 'unreadable', locked: false });
  const notPdf = await convert(page, new TextEncoder().encode('This is a note, not a PDF.'), 'notes.pdf');
  expect(notPdf).toMatchObject({ ok: false, reason: 'unreadable' });

  expect(seen.csp).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('phone, Demo Mode: the reader is there and pdf.js is not fetched on load', async ({ page }) => {
  const seen = watch(page);
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto('/login.html?demo=1');
  await page.goto('/teacher-mobile/');
  await expect(page.locator('#m-loading')).toBeHidden({ timeout: 15000 });
  expect(await page.evaluate(() => typeof PhotoReaders.openPdf === 'function' && !PhotoReaders.loaded())).toBe(true);
  expect(seen.pdfjs).toEqual([]);
  expectTwoPages(await convert(page, pagesPdf(2)));
  expect(seen.csp).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('student page: nothing of the reader loads with the page; fetched the way a send fetches photo-shrink.js, it works under the same CSP', async ({
  page,
}) => {
  const seen = watch(page);
  await cspOf(page, '/s/index.html');
  await page.goto('/s/#demo-card-send');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  expect(await page.evaluate(() => typeof window.PhotoReaders)).toBe('undefined');
  expect(seen.pdfjs).toEqual([]);

  await page.evaluate(() =>
    Promise.all(
      ['../shared/photo-shrink.js', '../shared/photo-readers.js'].map(
        src =>
          new Promise((done, fail) => {
            const el = document.createElement('script');
            el.src = src;
            el.onload = done;
            el.onerror = fail;
            document.head.appendChild(el);
          }),
      ),
    ),
  );
  expect(seen.pdfjs).toEqual([]);
  expectTwoPages(await convert(page, pagesPdf(2)));
  expect(seen.csp).toEqual([]);
  expect(seen.errors).toEqual([]);
});

test('offline: on a device that has loaded the app, a PDF chosen offline still becomes pages', async ({
  page,
  context,
}) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => navigator.serviceWorker.ready);
  // The worker controls the page after a reload; then the network goes.
  await page.reload();
  await expect(page.getByRole('button', { name: 'Class Settings' }).first()).toBeVisible();
  expect(await page.evaluate(() => !!navigator.serviceWorker.controller)).toBe(true);
  expect(await page.evaluate(() => PhotoReaders.loaded())).toBe(false);
  await context.setOffline(true);
  const res = await convert(page, pagesPdf(2));
  await context.setOffline(false);
  expect(res.ok).toBe(true);
  expect(res.pages.map(p => [p.width, p.height])).toEqual([
    [1545, 2000],
    [1545, 2000],
  ]);
  expect(res.pages.every(p => p.jpeg && p.box < 40)).toBe(true);
});
