import { test, expect } from '@playwright/test';
import { readFileSync } from 'node:fs';
import { PHONE } from './student-card-fake.js';

/* Save or Print on an open handout (shared/handout-out.js,
   shared/handout-pdf.js), in Demo Mode on a phone. A button at the right of
   the handout's top bar opens a sheet of two rows: Save to Phone and Print.
   The Quick Check's Study Guide has two pages (the site's own pictures).
   Nothing is sent: the print sheet and the share sheet are stood in for, and
   a download is caught. HANDOUT_OUT_SHOTS=<folder> saves the open handout at
   390 × 844, light and dark, sheet closed and open. */

const SHOTS = process.env.HANDOUT_OUT_SHOTS || '';

// A wide face as a Chromebook, Android or CI's Linux draws it, forced on every element.
const WIDE =
  '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';

test.use(PHONE);

async function openStudyGuide(page) {
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
  const card = page.locator('.sp-piece[data-piece="demo-quick"]');
  await card.locator('.sp-car-slide').first().click();
  const pane = page.locator('.sp-handout');
  await expect(pane.getByRole('heading', { name: 'Study Guide' })).toBeVisible();
  return pane;
}

// The button in the top bar opens the sheet; the sheet's own buttons.
async function openSheet(page, pane) {
  await pane.getByRole('button', { name: 'Save or Print' }).click();
  const sheet = page.getByRole('dialog', { name: 'Save or Print' });
  await expect(sheet).toBeVisible();
  return sheet;
}

// The pieces of a PDF a test can read as text.
const pdfText = bytes => Buffer.from(bytes).toString('latin1');

test('the top bar has one Save or Print button on the right, and no buttons along the bottom', async ({ page }) => {
  const pane = await openStudyGuide(page);
  const bar = pane.locator('.sp-work-head');
  const button = bar.getByRole('button', { name: 'Save or Print' });
  await expect(button).toBeVisible();
  const [b, w] = await Promise.all([button.boundingBox(), bar.boundingBox()]);
  // At the right end of the bar, on one line.
  expect(b.x + b.width).toBeGreaterThan(w.x + w.width - 24);
  expect(b.height).toBeLessThan(60);
  await expect(pane.getByRole('button', { name: 'Print', exact: true })).toHaveCount(0);
  await expect(page.getByRole('dialog', { name: 'Save or Print' })).toHaveCount(0);
});

test('the button stays on one line, and the title wraps, in a wide font', async ({ page }) => {
  const pane = await openStudyGuide(page);
  await page.addStyleTag({ content: WIDE });
  const button = pane.getByRole('button', { name: 'Save or Print' });
  const [b, w] = await Promise.all([button.boundingBox(), pane.locator('.sp-work-head').boundingBox()]);
  expect(b.height).toBeLessThan(60);
  expect(b.x + b.width).toBeLessThanOrEqual(w.x + w.width + 1);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
});

test('the sheet holds Save to Phone, Print and Cancel, with no line under a row; focus and Escape', async ({
  page,
}) => {
  const pane = await openStudyGuide(page);
  const sheet = await openSheet(page, pane);
  await expect(sheet.getByRole('heading', { name: 'Save or Print' })).toBeVisible();
  await expect(sheet.getByRole('button')).toHaveText(['Save to Phone', 'Print', 'Cancel']);
  await expect(sheet.locator('.sp-class-sub')).toHaveCount(0);
  // Each row has an icon and a row at least 56 px tall.
  await expect(sheet.locator('.sp-out-row svg')).toHaveCount(2);
  const row = await sheet.getByRole('button', { name: 'Print' }).boundingBox();
  expect(row.height).toBeGreaterThanOrEqual(56);
  // Focus moved into the sheet.
  expect(await page.evaluate(() => !!document.activeElement.closest('.sp-handout-sheet'))).toBe(true);
  // Escape closes it and gives focus back to the button.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Save or Print' })).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Save or Print' })).toBeFocused();
  // Cancel closes it too.
  const again = await openSheet(page, pane);
  await again.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Save or Print' })).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Save or Print' })).toBeFocused();
});

test('Print draws every page in the print sheet, one to a sheet, and takes it away after', async ({
  page,
  browserName,
}) => {
  await page.addInitScript(() => {
    window.print = () => {
      const imgs = [...document.querySelectorAll('body > .fv-print-sheet img.fv-print-page')];
      window.__printed = {
        count: imgs.length,
        loaded: imgs.every(i => i.complete && i.naturalWidth > 0),
        srcs: imgs.map(i => i.src.split(':')[0]),
        printing: document.body.classList.contains('fv-printing'),
      };
      // The sheet closes, as it does when the student is done.
      setTimeout(() => window.dispatchEvent(new Event('afterprint')), 0);
    };
  });
  const pane = await openStudyGuide(page);
  const sheet = await openSheet(page, pane);
  await sheet.getByRole('button', { name: 'Print' }).click();
  await expect
    .poll(() => page.evaluate(() => window.__printed || null))
    .toEqual({ count: 2, loaded: true, srcs: ['http', 'http'], printing: true });
  await expect(page.locator('.fv-print-sheet')).toHaveCount(0);
  expect(await page.evaluate(() => document.body.classList.contains('fv-printing'))).toBe(false);
  // The sheet closed once the pages were here, and the button has the keyboard.
  await expect(page.getByRole('dialog', { name: 'Save or Print' })).toHaveCount(0);
  await expect(pane.getByRole('button', { name: 'Save or Print' })).toBeFocused();
  expect(browserName).toBeTruthy();
});

test('the print sheet shows only the pages, one to a sheet (Chromium prints it to a PDF)', async ({
  page,
  browserName,
}) => {
  test.skip(browserName !== 'chromium', 'page.pdf is Chromium only');
  await page.addInitScript(() => {
    window.print = () => {
      window.__printing = true;
    };
  });
  const pane = await openStudyGuide(page);
  const sheet = await openSheet(page, pane);
  await sheet.getByRole('button', { name: 'Print' }).click();
  await expect.poll(() => page.evaluate(() => !!window.__printing)).toBe(true);
  const pdf = await page.pdf({ format: 'Letter', printBackground: true });
  const s = pdf.toString('latin1');
  expect((s.match(/\/Type\s*\/Page\b(?!s)/g) || []).length).toBe(2);
});

test('Save to Phone makes one PDF of every page and hands it to the share sheet', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = d => !!(d && d.files && d.files.length);
    navigator.share = async d => {
      const f = d.files[0];
      window.__shared = {
        title: d.title,
        name: f.name,
        type: f.type,
        bytes: Array.from(new Uint8Array(await f.arrayBuffer())),
      };
    };
  });
  const pane = await openStudyGuide(page);
  const sheet = await openSheet(page, pane);
  await sheet.getByRole('button', { name: 'Save to Phone' }).click();
  await expect.poll(() => page.evaluate(() => !!window.__shared)).toBe(true);
  const got = await page.evaluate(() => window.__shared);
  expect([got.title, got.name, got.type]).toEqual(['Study Guide', 'Study Guide.pdf', 'application/pdf']);
  const s = pdfText(got.bytes);
  expect(s.slice(0, 8)).toBe('%PDF-1.4');
  expect(s).toContain('/Count 2');
  expect((s.match(/\/Filter \/DCTDecode/g) || []).length).toBe(2);
  // Each picture inside begins as a JPEG does.
  expect((s.match(/stream\n\xff\xd8\xff/g) || []).length).toBe(2);
  await expect(page.getByRole('dialog', { name: 'Save or Print' })).toHaveCount(0);
  await expect(pane.getByRole('alert')).toHaveCount(0);
});

test('closing the share sheet says nothing', async ({ page }) => {
  await page.addInitScript(() => {
    navigator.canShare = () => true;
    navigator.share = () => {
      window.__asked = true;
      return Promise.reject(new DOMException('closed', 'AbortError'));
    };
  });
  const pane = await openStudyGuide(page);
  const sheet = await openSheet(page, pane);
  await sheet.getByRole('button', { name: 'Save to Phone' }).click();
  await expect.poll(() => page.evaluate(() => !!window.__asked)).toBe(true);
  await expect(pane.getByRole('button', { name: 'Save or Print' })).toBeEnabled();
  await expect(page.getByRole('alert')).toHaveCount(0);
});

test('with no share sheet, Save to Phone downloads the PDF', async ({ page }) => {
  await page.addInitScript(() => {
    Object.defineProperty(navigator, 'canShare', { value: undefined, configurable: true });
    Object.defineProperty(navigator, 'share', { value: undefined, configurable: true });
  });
  const pane = await openStudyGuide(page);
  const sheet = await openSheet(page, pane);
  const [download] = await Promise.all([
    page.waitForEvent('download'),
    sheet.getByRole('button', { name: 'Save to Phone' }).click(),
  ]);
  expect(download.suggestedFilename()).toBe('Study Guide.pdf');
  const s = pdfText(readFileSync(await download.path()));
  expect(s.slice(0, 8)).toBe('%PDF-1.4');
  expect(s).toContain('/Count 2');
});

test('a page that does not come is said in the row, and the sheet stays open', async ({ page }) => {
  const pane = await openStudyGuide(page);
  // Demo pages are on the device, so make the file fail where the PDF is made.
  await page.evaluate(() => {
    window.HandoutOut.save = () => Promise.reject(new Error('no'));
  });
  const sheet = await openSheet(page, pane);
  await sheet.getByRole('button', { name: 'Save to Phone' }).click();
  // The sheet stays, the row's name is the sentence, nothing else changes.
  await expect(sheet.getByRole('button')).toHaveCount(3);
  await expect(sheet.getByRole('button').first()).toHaveText(
    'The handout didn’t load. Check your internet and try again.',
  );
  await expect(sheet.getByRole('button').nth(1)).toHaveText('Print');
});

test('shots: the open handout at 390 × 844, sheet closed and open, light and dark', async ({ page, browserName }) => {
  test.skip(!SHOTS, 'screenshots only when HANDOUT_OUT_SHOTS is set');
  await page.setViewportSize({ width: 390, height: 844 });
  for (const scheme of ['light', 'dark']) {
    await page.goto('about:blank');
    await page.emulateMedia({ colorScheme: scheme });
    const pane = await openStudyGuide(page);
    await expect
      .poll(() => pane.locator('img.sp-work-img').evaluate(el => el.complete && el.naturalWidth > 0))
      .toBe(true);
    await page.screenshot({ path: SHOTS + '/handout-390-closed-' + scheme + '-' + browserName + '.png' });
    await openSheet(page, pane);
    await page.waitForTimeout(400);
    await page.screenshot({ path: SHOTS + '/handout-390-sheet-' + scheme + '-' + browserName + '.png' });
  }
});
