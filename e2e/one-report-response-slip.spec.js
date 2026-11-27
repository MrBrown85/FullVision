import { test, expect } from '@playwright/test';

/* The Parent / Guardian Response's place and options (teacher/report-one.js,
   teacher/report-blocks.js; DECISIONS, "The Parent / Guardian Response's
   place and options", 2026-11-27). It docks at the bottom of the report's
   last page, as it always did, or prints straight after the part above it
   and moves in the panel like any part. Demo Mode's Science 8, one
   student, picked by name. */

const NAME = 'Cece Adeyemi';
test.setTimeout(120_000);

const WIDE_FONT = `.report-sheet, .report-sheet * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.03em !important;
}
#studio-palette, #studio-palette * {
  font-family: Verdana, 'DejaVu Sans', sans-serif !important;
  letter-spacing: 0.04em !important;
}`;
// A whole-class layout follows each change and blocks the page for seconds
// on a loaded runner (e2e/one-report.spec.js).
const SLOW = { timeout: 20_000 };

async function openCard(page, wide) {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0 && getAssessments('sci8').length > 0);
  if (wide) await page.addStyleTag({ content: WIDE_FONT });
  // ReportOne loads with the Reporting page.
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

const slip = page => page.locator('#rb-preview .sheet-cell[data-part="parent-response"]');
const order = page => page.evaluate(() => getReportConfig('sci8').one.parts);

/* Where the slip sits on its side: how far below the row above it, how far
   above the side's foot, whether it is the docked row, and the parts that
   print on that side. */
async function where(page) {
  return slip(page).evaluate(cell => {
    const row = cell.closest('.sheet-row');
    const body = cell.closest('.sheet-body');
    const prev = row.previousElementSibling;
    const r = row.getBoundingClientRect();
    return {
      docked: row.classList.contains('sheet-pinned'),
      afterPrev: prev ? Math.round(r.top - prev.getBoundingClientRect().bottom) : null,
      aboveFoot: Math.round(body.getBoundingClientRect().bottom - r.bottom),
      past: Math.max(0, body.scrollHeight - body.clientHeight),
      parts: Array.from(body.querySelectorAll('.sheet-cell[data-part]'), c => c.dataset.part),
    };
  });
}

async function openSlipOptions(page) {
  await page.locator('#studio-palette [data-action="oneOpen"][data-part="parent-response"]').click();
  await expect(page.locator('#one-opts-parent-response')).toBeVisible();
}

for (const wide of [false, true]) {
  const font = wide ? ' (a wider font)' : '';

  test(
    'the response docks at the bottom, or follows the part above and moves like any part' + font,
    async ({ page }) => {
      test.slow();
      const errors = await openCard(page, wide);
      // As it always printed: docked, at the foot of the last side, not movable.
      let w = await where(page);
      expect(w.docked).toBe(true);
      expect(Math.abs(w.aboveFoot)).toBeLessThanOrEqual(1);
      const handle = page.locator('#studio-palette [data-action="oneDrag"][data-part="parent-response"]');
      await expect(handle).toHaveCount(0);

      await openSlipOptions(page);
      const place = page.locator('#one-opts-parent-response').getByRole('radiogroup', { name: 'Place' });
      await expect(place.getByRole('radio', { name: 'Bottom' })).toHaveAttribute('aria-checked', 'true');
      // Both choices on one line, in the panel's width.
      const tops = await place
        .getByRole('radio')
        .evaluateAll(bs => bs.map(b => Math.round(b.getBoundingClientRect().top)));
      expect(new Set(tops).size).toBe(1);
      await place.getByRole('radio', { name: 'After Part Above' }).click();
      await expect
        .poll(() => page.evaluate(() => getReportConfig('sci8').one.options['parent-response'].place), SLOW)
        .toBe('follow');
      // Straight after the part above it, with the page's usual gap.
      await expect.poll(async () => (await where(page)).docked, SLOW).toBe(false);
      w = await where(page);
      expect(w.afterPrev).toBeGreaterThanOrEqual(0);
      expect(w.afterPrev).toBeLessThanOrEqual(24);
      expect(w.past).toBe(0);
      expect((await order(page)).slice(-1)).toEqual(['parent-response']);

      // It moves in the panel now: up above the Assessments list.
      await expect(handle).toHaveCount(1);
      await handle.focus();
      await page.keyboard.press('ArrowUp');
      await expect
        .poll(async () => {
          const o = await order(page);
          return o.indexOf('parent-response') < o.indexOf('assessments');
        }, SLOW)
        .toBe(true);
      const printed = await page
        .locator('#rb-preview .sheet-student .sheet-cell[data-part]')
        .evaluateAll(cells => [...new Set(cells.map(c => c.dataset.part))]);
      expect(printed.indexOf('parent-response')).toBeLessThan(printed.indexOf('assessments'));
      // One piece: never split between two sides.
      await expect(slip(page)).toHaveCount(1);
      await expect(slip(page).locator('.report-parent-comments-box')).toHaveCount(1);
      w = await where(page);
      expect(w.docked).toBe(false);
      expect(w.past).toBe(0);

      // Back to the bottom: last again, docked at the foot.
      await place.getByRole('radio', { name: 'Bottom' }).click();
      await expect.poll(async () => (await where(page)).docked, SLOW).toBe(true);
      w = await where(page);
      expect(Math.abs(w.aboveFoot)).toBeLessThanOrEqual(1);
      expect(w.parts.slice(-1)).toEqual(['parent-response']);
      await expect(handle).toHaveCount(0);
      expect(errors).toEqual([]);
    },
  );

  test('the student’s name, a cut line and a return-by date print on the slip' + font, async ({ page }) => {
    const errors = await openCard(page, wide);
    await openSlipOptions(page);
    const opts = page.locator('#one-opts-parent-response');
    await opts.getByRole('button', { name: 'Student’s Name' }).click();
    await expect(slip(page).locator('.report-parent-who')).toContainText(NAME, SLOW);
    await opts.getByRole('button', { name: 'Cut Line' }).click();
    await expect(slip(page).locator('.report-parent-cut')).toHaveCount(1, SLOW);
    // A date a week from today, in the device's own calendar.
    const due = await page.evaluate(() => {
      const d = new Date(Date.now() + 7 * 864e5);
      return [d.getFullYear(), String(d.getMonth() + 1).padStart(2, '0'), String(d.getDate()).padStart(2, '0')].join(
        '-',
      );
    });
    const day = await page.evaluate(iso => {
      const [y, m, d] = iso.split('-').map(Number);
      return new Date(Date.UTC(y, m - 1, d, 12)).toLocaleDateString('en-CA', {
        weekday: 'long',
        month: 'long',
        day: 'numeric',
        timeZone: 'UTC',
      });
    }, due);
    await opts.getByLabel('Return By').fill(due);
    await opts.getByLabel('Return By').dispatchEvent('change');
    await expect(slip(page).locator('.report-parent-intro')).toContainText('by ' + day + '.', SLOW);
    // Still at the bottom of the last side, and nothing runs past it.
    const w = await where(page);
    expect(w.docked).toBe(true);
    expect(w.past).toBe(0);
    // The name fits on the heading's line.
    const fits = await slip(page)
      .locator('.report-parent-head')
      .evaluate(h => h.scrollWidth <= h.clientWidth + 1 && h.getBoundingClientRect().height < 40);
    expect(fits).toBe(true);
    expect(errors).toEqual([]);
  });
}
