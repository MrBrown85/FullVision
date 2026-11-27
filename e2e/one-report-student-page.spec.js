import { test, expect } from '@playwright/test';
import { readFileSync } from 'fs';

/* The Student Page on a printed report (teacher/report-student-page.js;
   DECISIONS, "The Student Page on a printed report", 2026-11-27): the
   Letterhead's Student Page Code, and the Student Page part. Both off at
   first. The code must scan as well as the printed card's: each square at
   least 0.045 in, and at least 0.14 in of white round it (its own one-square
   margin counted), checked by reading it back from a picture of the page at
   its printed size. Demo Mode's Science 8, whose Student Page is on, one
   student, picked by name; in the page's own font and a wide one. */

const NAME = 'Cece Adeyemi';
const ADDRESS = 'HTTPS://FULLVISION.CA/S';
const JSQR = readFileSync('vendor/jsqr/jsQR.js', 'utf-8');
test.setTimeout(120_000);

const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}
#studio-palette, #studio-palette * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.04em !important;
}`;
const SLOW = { timeout: 20_000 };

async function openCard(page, wide) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  if (wide) await page.addStyleTag({ content: WIDE_FONT });
  for (const first of [true, false]) {
    if (!first) await page.evaluate(r => window.Router.navigate(r), '/dashboard');
    await page.evaluate(r => window.Router.navigate(r), '/reports');
    await page.getByRole('tab', { name: 'Print Reports' }).click();
    await expect(page.locator('#studio.studio-one')).toBeVisible();
    if (first)
      await page.evaluate(() => {
        saveReportConfig(
          'sci8',
          Object.assign({}, getReportConfig('sci8'), { one: ReportOne.fromSetup('report-card') }),
        );
      });
  }
  await page.getByRole('button', { name: 'Select students' }).click();
  const list = page.locator('#picker-dropdown');
  await list.getByRole('button', { name: 'Deselect All' }).click();
  await list.locator('.student-picker-item', { hasText: NAME }).click();
  await page.getByRole('button', { name: 'Select students' }).click();
  await expect(page.locator('#rb-preview .sheet-student')).toContainText(NAME);
  return errors;
}

const front = page => page.locator('#rb-preview .sheet-student .report-sheet').first();

/* The code's size and the white round it, in inches of the printed page
   (the sheet is 8.5 in wide, whatever the preview's zoom), as it prints:
   the nearest text or rule on any side, plus the code's own one-square
   margin. */
async function measure(page, qr) {
  await page.emulateMedia({ media: 'print' });
  const m = await qr.evaluate(el => {
    const sheet = el.closest('.report-sheet');
    const inch = sheet.getBoundingClientRect().width / 8.5;
    const r = el.getBoundingClientRect();
    const square = r.width / el.querySelector('svg').viewBox.baseVal.width;
    const away = b => Math.max(b.left - r.right, r.left - b.right, b.top - r.bottom, r.top - b.bottom, 0);
    let gap = Infinity;
    const walk = document.createTreeWalker(sheet, NodeFilter.SHOW_TEXT);
    for (let n = walk.nextNode(); n; n = walk.nextNode()) {
      if (!n.textContent.trim()) continue;
      const range = document.createRange();
      range.selectNodeContents(n);
      [...range.getClientRects()].forEach(b => (gap = Math.min(gap, away(b))));
    }
    // Every rule drawn on the page: each border as a thin box.
    sheet.querySelectorAll('*').forEach(o => {
      if (el.contains(o)) return;
      const cs = getComputedStyle(o);
      const b = o.getBoundingClientRect();
      const t = parseFloat(cs.borderTopWidth) || 0;
      const bo = parseFloat(cs.borderBottomWidth) || 0;
      const l = parseFloat(cs.borderLeftWidth) || 0;
      const ri = parseFloat(cs.borderRightWidth) || 0;
      if (t) gap = Math.min(gap, away({ left: b.left, right: b.right, top: b.top, bottom: b.top + t }));
      if (bo) gap = Math.min(gap, away({ left: b.left, right: b.right, top: b.bottom - bo, bottom: b.bottom }));
      if (l) gap = Math.min(gap, away({ left: b.left, right: b.left + l, top: b.top, bottom: b.bottom }));
      if (ri) gap = Math.min(gap, away({ left: b.right - ri, right: b.right, top: b.top, bottom: b.bottom }));
    });
    return {
      size: r.width / inch,
      square: square / inch,
      quiet: (square + gap) / inch,
      fromEdge: (sheet.getBoundingClientRect().right - r.right) / inch,
    };
  });
  await page.emulateMedia({ media: 'screen' });
  return m;
}

/* Reads the code from a picture of it at its printed size, at 300 dots to
   the inch, with 0.14 in of the page round it: anything printed that close
   would spoil the read. */
async function scan(page, qr) {
  await page.emulateMedia({ media: 'print' });
  await qr.scrollIntoViewIfNeeded();
  const box = await qr.boundingBox();
  const inch = await qr.evaluate(el => el.closest('.report-sheet').getBoundingClientRect().width / 8.5);
  const pad = 0.095 * inch;
  const shot = await page.screenshot({
    clip: { x: box.x - pad, y: box.y - pad, width: box.width + pad * 2, height: box.height + pad * 2 },
    scale: 'device',
  });
  await page.emulateMedia({ media: 'screen' });
  const blank = await page.context().newPage();
  await blank.setContent('<canvas id="c"></canvas>');
  await blank.addScriptTag({ content: JSQR });
  const read = await blank.evaluate(async b64 => {
    const img = new Image();
    img.src = 'data:image/png;base64,' + b64;
    await img.decode();
    // White round the picture, as the rest of the page is.
    const c = document.getElementById('c');
    c.width = img.width + 40;
    c.height = img.height + 40;
    const g = c.getContext('2d');
    g.fillStyle = '#fff';
    g.fillRect(0, 0, c.width, c.height);
    g.drawImage(img, 20, 20);
    const d = g.getImageData(0, 0, c.width, c.height);
    const out = window.jsQR(d.data, d.width, d.height);
    return out && out.data;
  }, shot.toString('base64'));
  await blank.close();
  return read;
}

function expectScans(m) {
  expect(m.size).toBeGreaterThanOrEqual(1.0);
  expect(m.size).toBeLessThanOrEqual(1.1);
  expect(m.square).toBeGreaterThanOrEqual(0.045);
  expect(m.quiet).toBeGreaterThanOrEqual(0.14);
}

for (const wide of [false, true]) {
  const font = wide ? ' (a wider font)' : '';

  test.describe('the Student Page on a printed report' + font, () => {
    test.use({ deviceScaleFactor: 3 });

    test(
      'the Letterhead’s Student Page Code is off at first, and prints a code that scans' + font,
      async ({ page }) => {
        test.slow();
        const errors = await openCard(page, wide);
        const head = front(page).locator('.sheet-cell[data-part="header"]');
        await expect(head.locator('.report-code-qr')).toHaveCount(0);
        const before = await head.evaluate(h => h.getBoundingClientRect().height);

        await page.locator('#studio-palette [data-action="oneOpen"][data-part="header"]').click();
        const chip = page.locator('#one-opts-header').getByRole('button', { name: 'Student Page Code' });
        await expect(chip).toHaveAttribute('aria-pressed', 'false');
        await chip.click();
        await expect(head.locator('.report-code-qr')).toHaveCount(1, SLOW);
        await expect(head).toContainText('fullvision.ca/s');
        await expect(head).toContainText(NAME);

        const qr = head.locator('.report-code-qr');
        const m = await measure(page, qr);
        expectScans(m);
        expect(m.fromEdge).toBeGreaterThanOrEqual(0.45);
        // The letterhead grows by the code's height, no more.
        const after = await head.evaluate(h => h.getBoundingClientRect().height);
        const inch = await front(page).evaluate(s => s.getBoundingClientRect().width / 8.5);
        expect((after - before) / inch).toBeLessThan(0.75);
        // Nothing in the letterhead runs into the code or off the page.
        const tidy = await head.evaluate(h => {
          const q = h.querySelector('.report-code-qr').getBoundingClientRect();
          const main = h.querySelector('.report-header-main').getBoundingClientRect();
          const label = h.querySelector('.report-header-code-label').getBoundingClientRect();
          return main.right <= label.left && label.right <= q.left && h.scrollWidth <= h.clientWidth + 1;
        });
        expect(tidy).toBe(true);
        expect(await scan(page, qr)).toBe(ADDRESS);

        // Off again: the letterhead as it was.
        await chip.click();
        await expect(head.locator('.report-code-qr')).toHaveCount(0, SLOW);
        expect(errors).toEqual([]);
      },
    );

    test('the Student Page part prints the code, the steps and the card’s last day' + font, async ({ page }) => {
      test.slow();
      const errors = await openCard(page, wide);
      const part = page.locator('#rb-preview .sheet-cell[data-part="student-page"]');
      await expect(part).toHaveCount(0);
      await page.locator('#studio-palette .one-sec-h[data-value="add"]').click();
      await page.locator('#studio-palette [data-action="oneAdd"][data-part="student-page"]').click();
      await expect(part).toHaveCount(1, SLOW);
      await expect(part).toContainText('Your Student Page');
      await expect(part).toContainText('Scan or type the code on your Student Card.');
      await expect(part).toContainText(/Works until [A-Z][a-z]{2} \d{1,2}, \d{4}/);
      // The steps and the card fit their columns.
      const fits = await part.evaluate(p =>
        [...p.querySelectorAll('.report-sp-steps, .report-sp-card')].every(
          b => b.scrollWidth <= b.clientWidth + 1 && b.scrollHeight <= b.clientHeight + 1,
        ),
      );
      expect(fits).toBe(true);
      const qr = part.locator('.report-code-qr');
      expectScans(await measure(page, qr));
      expect(await scan(page, qr)).toBe(ADDRESS);
      expect(errors).toEqual([]);
    });
  });
}
