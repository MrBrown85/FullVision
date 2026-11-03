import { test, expect } from '@playwright/test';

// Demo Mode's Science 8: sci8a19 is graded on an Advanced rubric with a
// checklist on each level tile. Clicking a checklist line's text ticks its
// box, in the gradebook's dialog and on the Assignments page. One student's
// view of every assessment has no repeated ids, and each Comment / Score
// label points at its own box.
test.use({ viewport: { width: 1440, height: 900 } });

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}
const ticks = page => page.evaluate(() => getRubricCheckIds('sci8', 'st1', 'sci8a19').length);

test('clicking a checklist line ticks its box in the dialog and on the page', async ({ page }) => {
  await demo(page);
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.locator('#gb-data td.gb-scores-cell[data-aid="sci8a19"][data-sid="st1"]').click();
  const dialog = page.locator('#grader-overlay .grader-dialog');
  const line = dialog.locator('label.grdt-check').first();
  const before = await ticks(page);
  const wasOn = await line.locator('input').isChecked();
  await line.locator('span').first().click();
  await expect.poll(() => ticks(page)).toBe(before + (wasOn ? -1 : 1));
  await page.locator('#grader-overlay .grader-done').click();

  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('#gb-roster-list .student-row[data-sid="st1"]').click();
  const inline = page.locator('#ac-sci8a19 label.grdt-check').first();
  await inline.scrollIntoViewIfNeeded();
  const n0 = await ticks(page);
  const on0 = await inline.locator('input').isChecked();
  await inline.locator('span').first().click();
  await expect.poll(() => ticks(page)).toBe(n0 + (on0 ? -1 : 1));
});

test('one student on every assessment: no repeated ids, labels find their box', async ({ page }) => {
  await demo(page);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('#gb-roster-list .student-row[data-sid="st1"]').click();
  await expect(page.locator('.assess-card.open .grader-inline').first()).toBeVisible();
  const report = await page.evaluate(() => {
    var seen = {};
    var dups = [];
    document.querySelectorAll('[id]').forEach(function (el) {
      if (seen[el.id]) dups.push(el.id);
      seen[el.id] = true;
    });
    var orphans = [];
    document.querySelectorAll('.grader-inline label[for]').forEach(function (l) {
      var box = document.getElementById(l.htmlFor);
      if (!box || box.closest('.assess-card') !== l.closest('.assess-card')) orphans.push(l.htmlFor);
    });
    return {
      points: document.querySelectorAll('.grader-inline .grdp-input').length,
      dups: Array.from(new Set(dups)),
      orphans: orphans,
    };
  });
  expect(report.points).toBeGreaterThan(1);
  expect(report.dups).toEqual([]);
  expect(report.orphans).toEqual([]);
});
