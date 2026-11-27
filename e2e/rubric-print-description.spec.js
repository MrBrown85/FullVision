import { test, expect } from '@playwright/test';

// Print Rubrics: Include's Assignment Description prints the assessment's
// Description under the name and above the rubric, on blank and completed
// rubrics, at 1, 2 and 4 per page (Colin, 2026-11-27, board A). It is off by
// default, so handouts print as before, and an assessment with no
// description has no box. A description as long as the longest in use
// (961 characters on 8 lines) still fits 4 per page, in the page's font and in a wide
// one (docs/testing.md), by shrinking the text as a long rubric does.

const WIDE =
  '*, *::before, *::after { font-family: Verdana, "DejaVu Sans", sans-serif !important; letter-spacing: 0.04em !important; }';
// The longest in use (Nov 27): 961 characters on 8 lines. This is a little longer.
const LONG = Array.from({ length: 8 }, (_, i) =>
  ('Part ' + (i + 1) + ': ' + 'what the poster needs to show, and how it will be assessed. '.repeat(2)).trim(),
).join('\n');

async function openDemo(page, wide) {
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  if (wide) await page.addStyleTag({ content: WIDE });
  await page.evaluate(() => {
    localStorage.removeItem('rubric-print-options');
    window.print = () => {};
  });
}

async function setDescription(page, text) {
  await page.evaluate(text => {
    getAssessments('sci8').find(a => a.id === 'sci8a3').description = text;
  }, text);
}

async function openDialog(page, opts) {
  await page.evaluate(opts => RubricPrint.open('sci8', 'sci8a3', opts), opts || {});
  const dialog = page.getByRole('dialog', { name: 'Print Rubrics' });
  await expect(dialog).toBeVisible();
  return dialog;
}

test('no description: no Assignment Description box, and the sheets print as before', async ({ page }) => {
  await openDemo(page);
  await setDescription(page, '');
  const dialog = await openDialog(page);
  await expect(dialog.getByRole('checkbox', { name: 'Assignment Description' })).toHaveCount(0);
  await expect(page.locator('#rubric-print-root .rubric-desc')).toHaveCount(0);
});

test('Assignment Description is off by default and prints above the rubric when ticked', async ({ page }) => {
  await openDemo(page);
  await setDescription(page, 'Plan a fair test.\nUse two trials.');
  const dialog = await openDialog(page, { mode: 'blank' });
  const box = dialog.getByRole('checkbox', { name: 'Assignment Description' });
  await expect(box).not.toBeChecked();
  // First in Include, as it prints first.
  await expect(dialog.locator('fieldset:has(legend:text-is("Include")) input').first()).toHaveAttribute(
    'data-include',
    'description',
  );
  await expect(page.locator('#rubric-print-root .rubric-desc')).toHaveCount(0);
  await box.check();
  const desc = page.locator('#rubric-print-root .rubric-sheet').first().locator('.rubric-desc');
  await expect(desc).toHaveText('Plan a fair test.\nUse two trials.', { useInnerText: true });
  expect(await desc.evaluate(el => getComputedStyle(el).whiteSpace)).toBe('pre-line');
  // Under the head, above the rubric.
  const order = await page.evaluate(() => {
    const inner = document.querySelector('#rubric-print-root .rubric-sheet-inner');
    return [...inner.children].map(el => el.className.split(' ')[0]);
  });
  expect(order.slice(0, 3)).toEqual(['rubric-head', 'rubric-desc', 'rubric-table']);
  // Completed rubrics offer it too, and remember the choice.
  await dialog.getByRole('radio', { name: /Completed Rubrics/ }).check({ force: true });
  await expect(dialog.getByRole('checkbox', { name: 'Assignment Description' })).toBeChecked();
  await expect(page.locator('#rubric-print-root .rubric-sheet .rubric-desc').first()).toContainText(
    'Plan a fair test.',
  );
});

for (const wide of [false, true]) {
  test(`a description as long as the longest in use fits 2 and 4 per page${wide ? ', wide font' : ''}`, async ({
    page,
  }) => {
    expect(LONG.length).toBeGreaterThan(961);
    await openDemo(page, wide);
    await setDescription(page, LONG);
    await page.evaluate(() =>
      localStorage.setItem('rubric-print-options', JSON.stringify({ layout: 'full', include: { description: true } })),
    );
    const dialog = await openDialog(page);
    for (const layout of ['half', 'quarter']) {
      await dialog.locator(`input[name="rp-layout"][value="${layout}"]`).check({ force: true });
      await expect(page.locator(`#rubric-print-root .rubric-page.layout-${layout}`)).not.toHaveCount(0);
      const fit = await page.evaluate(() => {
        const sheets = [...document.querySelectorAll('#rubric-print-root .rubric-sheet:not(.is-blank)')];
        return {
          sheets: sheets.length,
          withDesc: sheets.filter(s => s.querySelector('.rubric-desc')).length,
          over: sheets.filter(s => s.classList.contains('is-overflowing')).length,
        };
      });
      expect(fit.sheets).toBeGreaterThan(1);
      expect(fit.withDesc).toBe(fit.sheets);
      expect(fit.over).toBe(0);
      await expect(dialog.locator('#rp-status')).not.toContainText('cut off');
    }
  });
}
