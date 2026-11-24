import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { WORK } from '../tests/helpers/fake-student-submit.js';
import { CORS, PHONE, serve, school, signIn } from './student-card-fake.js';

/* Open as PDF, and Save to Phone and Print using the original (migration
   2026112408, the route `handout-original`), on a real card with the route
   stood in for both ways. The pages and the original PDF come from signed
   links on a storage host, also stood in for. Nothing real is called.
   HANDOUT_ORIGINAL_SHOTS=<folder> saves the three-row sheet at 390 × 844. */

const SHOTS = process.env.HANDOUT_ORIGINAL_SHOTS || '';
const RES = '00000099-0000-4000-8000-000000000000';
const JPEG = readFileSync('assets/sample-handouts/poster-checklist-1.jpg');
const ORIGINAL = Buffer.from(
  '%PDF-1.4\n% the teacher’s own file, with a mark to look for: ORIGINAL-7731\n%%EOF\n',
  'utf8',
);

test.use(PHONE);

async function open(page, { original, hold } = {}) {
  const fn = school();
  fn.state.dirty = reply => {
    reply.assessments.forEach(a => {
      a.resources =
        a.id === WORK.quick ? [{ id: RES, kind: 'pdf', title: 'Study Guide', url: null, page_count: 2 }] : [];
    });
    return reply;
  };
  const asked = [];
  const posts = await serve(page, fn, {
    answer: async body => {
      if (body.route === 'handout-links') {
        const pages = [1, 2].map(n => ({ page: n, url: 'https://x.supabase.co/sign/page' + n }));
        return { status: 200, json: { ok: true, pages } };
      }
      if (body.route === 'handout-original') {
        asked.push(body);
        return { status: 200, json: original };
      }
      return null;
    },
  });
  await page.route('https://x.supabase.co/**', async route => {
    if (route.request().method() === 'OPTIONS') return route.fulfill({ status: 204, headers: CORS });
    if (/\/missing/.test(route.request().url())) return route.fulfill({ status: 404, headers: CORS, body: '' });
    const isOriginal = /\/original/.test(route.request().url());
    if (isOriginal && hold) await new Promise(r => setTimeout(r, hold));
    return route.fulfill({
      status: 200,
      headers: { ...CORS, 'content-type': isOriginal ? 'application/pdf' : 'image/jpeg' },
      body: isOriginal ? ORIGINAL : JPEG,
    });
  });
  // The share sheet and a tab opened by a link are stood in for; what they were given is kept.
  await page.addInitScript(() => {
    window.__blobs = [];
    const make = URL.createObjectURL.bind(URL);
    URL.createObjectURL = b => {
      window.__blobs.push(b);
      return make(b);
    };
    window.__tabs = [];
    HTMLAnchorElement.prototype.click = function () {
      if (this.target === '_blank')
        window.__tabs.push({ href: this.href, rel: this.rel, blob: window.__blobs.slice(-1)[0] });
    };
    navigator.canShare = d => !!(d && d.files && d.files.length);
    navigator.share = async d => {
      window.__shared = { name: d.files[0].name, type: d.files[0].type, text: await d.files[0].text() };
    };
  });
  await signIn(page);
  await page
    .locator('.sp-piece[data-piece="' + WORK.quick + '"] .sp-car-slide')
    .first()
    .click();
  const pane = page.locator('.sp-handout');
  await expect(pane.getByRole('heading', { name: 'Study Guide' })).toBeVisible();
  await expect(pane.locator('img.sp-work-img')).toBeVisible();
  await pane.getByRole('button', { name: 'Save or Print' }).click();
  const sheet = page.getByRole('dialog', { name: 'Save or Print' });
  await expect(sheet).toBeVisible();
  return { pane, sheet, asked, posts };
}

const WITH = {
  ok: true,
  original: true,
  bytes: ORIGINAL.length,
  title: 'Study Guide',
  url: 'https://x.supabase.co/sign/original',
};

test.describe('a handout with no stored original', () => {
  test('two rows, asked once, and Save to Phone rebuilds the PDF from the pages', async ({ page }) => {
    const { sheet, asked } = await open(page, { original: { ok: true, original: false } });
    await expect(sheet.getByRole('button')).toHaveText(['Save to Phone', 'Print', 'Cancel']);
    expect(asked).toHaveLength(1);
    await sheet.getByRole('button', { name: 'Save to Phone' }).click();
    await expect.poll(() => page.evaluate(() => !!window.__shared)).toBe(true);
    const got = await page.evaluate(() => window.__shared);
    expect(got.name).toBe('Study Guide.pdf');
    expect(got.text).toContain('/Count 2');
    expect(got.text).not.toContain('ORIGINAL-7731');
  });
});

test.describe('a handout with its original', () => {
  test('three rows, Open as PDF first, and the sheet looks right at 390', async ({ page, browserName }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    const { sheet } = await open(page, { original: WITH });
    await expect(sheet.getByRole('button')).toHaveText(['Open as PDF', 'Save to Phone', 'Print', 'Cancel']);
    await expect(sheet.locator('.sp-class-sub')).toHaveCount(0);
    await expect(sheet.locator('.sp-out-row svg')).toHaveCount(3);
    if (SHOTS) {
      await page.waitForTimeout(500);
      await page.screenshot({ path: SHOTS + '/open-as-pdf-sheet-390-' + browserName + '.png' });
    }
  });

  test('Open as PDF opens the original in a tab, in the press itself', async ({ page }) => {
    const { sheet } = await open(page, { original: WITH });
    // The file is fetched ahead, so the press can open it at once.
    await expect.poll(() => page.evaluate(() => window.__blobs.length)).toBeGreaterThanOrEqual(0);
    await page.waitForTimeout(400);
    await sheet.getByRole('button', { name: 'Open as PDF' }).click();
    await expect.poll(() => page.evaluate(() => window.__tabs.length)).toBe(1);
    const tab = await page.evaluate(async () => ({
      href: window.__tabs[0].href.split(':')[0],
      rel: window.__tabs[0].rel,
      type: window.__tabs[0].blob.type,
      text: await window.__tabs[0].blob.text(),
    }));
    expect([tab.href, tab.rel, tab.type]).toEqual(['blob', 'noopener', 'application/pdf']);
    expect(tab.text).toContain('ORIGINAL-7731');
    // The sheet closed, and the keyboard is on the button.
    await expect(page.getByRole('dialog', { name: 'Save or Print' })).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Save or Print' })).toBeFocused();
  });

  test('Print opens the original too, in the viewer that has Print', async ({ page }) => {
    const { sheet } = await open(page, { original: WITH });
    await page.waitForTimeout(400);
    await sheet.getByRole('button', { name: 'Print' }).click();
    await expect.poll(() => page.evaluate(() => window.__tabs.length)).toBe(1);
    expect(await page.evaluate(() => window.__tabs[0].blob.text())).toContain('ORIGINAL-7731');
    expect(await page.evaluate(() => document.querySelectorAll('.fv-print-sheet').length)).toBe(0);
  });

  test('Save to Phone shares the original file as it is', async ({ page }) => {
    const { sheet } = await open(page, { original: WITH });
    await page.waitForTimeout(400);
    await sheet.getByRole('button', { name: 'Save to Phone' }).click();
    await expect.poll(() => page.evaluate(() => !!window.__shared)).toBe(true);
    const got = await page.evaluate(() => window.__shared);
    expect([got.name, got.type]).toEqual(['Study Guide.pdf', 'application/pdf']);
    expect(got.text).toBe(ORIGINAL.toString('utf8'));
  });

  test('pressed before the file is here, the row says Getting the PDF…', async ({ page }) => {
    const { sheet } = await open(page, { original: WITH, hold: 1500 });
    await sheet.getByRole('button', { name: 'Open as PDF' }).click();
    await expect(sheet.getByRole('button').first()).toHaveText('Getting the PDF…');
    await expect(page.getByRole('dialog', { name: 'Save or Print' })).toHaveCount(0, { timeout: 8000 });
    await expect.poll(() => page.evaluate(() => window.__tabs.length)).toBe(1);
  });

  test('on Android, which has no viewer in its browser, Open as PDF gives the share sheet', async ({ browser }) => {
    const ctx = await browser.newContext({
      ...PHONE,
      userAgent: 'Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 Chrome/126.0 Mobile Safari/537.36',
    });
    const page = await ctx.newPage();
    const { sheet } = await open(page, { original: WITH });
    await page.waitForTimeout(400);
    await sheet.getByRole('button', { name: 'Open as PDF' }).click();
    await expect.poll(() => page.evaluate(() => !!window.__shared)).toBe(true);
    expect((await page.evaluate(() => window.__shared)).text).toContain('ORIGINAL-7731');
    expect(await page.evaluate(() => window.__tabs.length)).toBe(0);
    await ctx.close();
  });

  test('when the original will not come, Save to Phone still gives the pages', async ({ page }) => {
    const { sheet } = await open(page, { original: { ...WITH, url: 'https://x.supabase.co/sign/missing' } });
    await page.waitForTimeout(400);
    await sheet.getByRole('button', { name: 'Save to Phone' }).click();
    await expect.poll(() => page.evaluate(() => !!window.__shared)).toBe(true);
    expect((await page.evaluate(() => window.__shared)).text).toContain('/Count 2');
  });
});
