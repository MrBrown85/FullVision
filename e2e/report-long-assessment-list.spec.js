/**
 * Reports: a Conference Pack with a long assessment list never runs past
 * its page (Page Studio's pagination, teacher/report-sheets.js pack()).
 *
 * The Conference Pack lists every assessment as a row of its grade table.
 * Demo Mode's Science 8 has 37; with 38 the continued side's content was
 * 1010 px tall in a 996 px sheet, so the printed page was clipped. Here the
 * class is given 38, 60 and 100 assessments (copies of its own, on this
 * page only) and every side of every student must hold its content.
 */
import { test, expect } from '@playwright/test';

test.describe.configure({ mode: 'parallel' });

// The same font everywhere, as e2e/report-studio.spec.js sets it.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    new MutationObserver((_, observer) => {
      if (!document.documentElement) return;
      document.documentElement.style.setProperty('--font-base', "Arial, 'Liberation Sans', sans-serif");
      observer.disconnect();
    }).observe(document, { childList: true });
  });
});

const STUDENTS = 27;

/* Demo Mode with the class at `total` assessments: copies of its own,
   dated across the year so they fall in Year to Date. */
async function openWith(page, total) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  const n = await page.evaluate(total => {
    const cid = 'sci8';
    const list = getAssessments(cid);
    const extra = [];
    for (let i = list.length; i < total; i++) {
      const from = list[i % list.length];
      extra.push(Object.assign({}, from, { id: 'e2e-long-' + i, title: 'Extra Piece ' + (i + 1) }));
    }
    saveAssessments(cid, list.concat(extra));
    // Every habit rated, as e2e/report-studio.spec.js's rateEveryone does.
    const habits = { completes: 4, ready: 3, others: 4, part: 3, feedback: 3, devices: 4 };
    getStudents(cid).forEach(s => upsertTermRating(cid, s.id, ReportBlocks.getTermId(), { habits }));
    return getAssessments(cid).length;
  }, total);
  expect(n).toBe(total);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
  // Build Your Own, then the Conference Pack starter, as report-studio.spec.js opens it.
  await page.getByRole('radio', { name: 'Custom' }).click();
  await expect(page.locator('.studio-blk.placed')).toHaveCount(1);
  await page.locator('[data-action="studioTab"][data-tab="templates"]').click();
  await page.locator('[data-action="studioTemplate"][data-starter="conference-pack"]').click();
  await page.locator('[data-action="studioTab"][data-tab="blocks"]').click();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
}

/* Sides whose content runs past the sheet: the body, or the last placed
   row's bottom below the body's bottom. */
async function overflowing(page) {
  return page.locator('.report-sheet').evaluateAll(sheets =>
    sheets.flatMap((s, i) => {
      const who = s.closest('.sheet-student')?.querySelector('.sheet-student-name')?.textContent || 'side ' + i;
      const body = s.querySelector('.sheet-body');
      if (!body) return [];
      const out = [];
      if (body.scrollHeight > body.clientHeight + 1)
        out.push(who + ' · body ' + body.scrollHeight + '/' + body.clientHeight);
      const bottom = body.getBoundingClientRect().bottom;
      [...body.querySelectorAll('.sheet-row')].forEach(r => {
        const b = r.getBoundingClientRect().bottom;
        if (b > bottom + 1) out.push(who + ' · row ends ' + Math.round(b - bottom) + ' px past the sheet');
      });
      return out;
    }),
  );
}

for (const total of [38, 60, 100]) {
  test(`${total} assessments: the Conference Pack flows to further sides and none overflows`, async ({ page }) => {
    await openWith(page, total);
    // The preview (the longest report) first, then every student.
    expect(await overflowing(page)).toEqual([]);
    expect(await page.locator('.report-sheet.sheet-overflow').count()).toBe(0);
    await page.locator('.studio-view [data-view="all"]').click();
    await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS, { timeout: 30_000 });
    expect(await overflowing(page)).toEqual([]);
    expect(await page.locator('.report-sheet.sheet-overflow').count()).toBe(0);
    // The table was cut at its rows onto further sides, and every
    // assessment it lists is printed once: none is lost or doubled at a cut.
    const first = page.locator('.sheet-student').first();
    expect(await first.locator('.sheet-label', { hasText: /^After the Report$/ }).count()).toBeGreaterThan(0);
    const meta = await first.locator('.report-grades .report-prof-meta').first().textContent();
    const listed = Number((meta.match(/(\d+) assessments/) || [])[1]);
    expect(listed).toBeGreaterThanOrEqual(total - 5);
    const titles = await first.locator('.report-grades-row .report-grades-title').allTextContents();
    expect(titles.length).toBe(listed);
    expect(await first.locator('.report-grades').count()).toBeGreaterThan(1);
  });
}

// The table's other layouts cut the same way: two columns, and by category.
for (const [columns, organize] of [
  ['Two', 'Category'],
  ['Two', 'Date'],
  ['One', 'Category'],
]) {
  test(`100 assessments, ${columns} column(s) by ${organize}: none overflows, none lost`, async ({ page }) => {
    await openWith(page, 100);
    await page.locator('#rb-preview .sheet-cell[data-block="grade-table"]').first().click();
    const bar = page.locator('.studio-bar');
    await expect(bar).toBeVisible();
    for (const [group, choice] of [
      ['Columns', columns],
      ['Organize By', organize],
    ]) {
      const radio = bar.getByRole('radiogroup', { name: group }).getByRole('radio', { name: choice });
      await radio.click();
      await expect(radio).toHaveAttribute('aria-checked', 'true');
    }
    await page.locator('.studio-view [data-view="all"]').click();
    await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS, { timeout: 30_000 });
    expect(await overflowing(page)).toEqual([]);
    const first = page.locator('.sheet-student').first();
    const meta = await first.locator('.report-grades .report-prof-meta').first().textContent();
    const listed = Number((meta.match(/(\d+) assessments/) || [])[1]);
    expect(await first.locator('.report-grades-row').count()).toBe(listed);
  });
}
