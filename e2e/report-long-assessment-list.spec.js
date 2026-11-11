/**
 * Reports: a Conference Pack with a long assessment list never runs past
 * its page (Page Studio's pagination, teacher/report-sheets.js pack()).
 * The table starts where it is and goes on side by side, so no side is
 * left blank between the report and the rest of the table.
 *
 * The Conference Pack lists every assessment as a row of its grade table.
 * Demo Mode's Science 8 has 37; with 38 the continued side's content was
 * 1010 px tall in a 996 px sheet, so the printed page was clipped. Here the
 * class is given 38, 60 and 100 assessments (copies of its own, on this
 * page only) and every side of every student must hold its content.
 */
import { test, expect } from '@playwright/test';

// 27 students' reports with 100 rows each take a while on a CI runner.
test.describe.configure({ mode: 'parallel', timeout: 90_000 });

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
   dated across the year so they fall in Year to Date. `starter`: the
   template to apply, or null for a new Build Your Own report (the name and
   Assignment Grades on the Front, an empty Back). */
async function openWith(page, total, starter = 'conference-pack') {
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
  if (starter) {
    await page.locator('[data-action="studioTab"][data-tab="templates"]').click();
    await page.locator(`[data-action="studioTemplate"][data-starter="${starter}"]`).click();
    await page.locator('[data-action="studioTab"][data-tab="blocks"]').click();
  }
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
}

/* Each student's sides that print nothing before a side that does: a
   blank side in the middle of a report. (The last side of an odd count is
   left blank for duplex, and is not one.) */
async function blankBetween(page) {
  return page.locator('.sheet-student').evaluateAll(students =>
    students.flatMap(st => {
      const who = st.querySelector('.sheet-student-name')?.textContent || '?';
      const prints = [...st.querySelectorAll('.report-sheet')].map(
        s => s.querySelectorAll('.sheet-row:not(.sheet-row-empty)').length > 0,
      );
      const lastPrinting = prints.lastIndexOf(true);
      return prints.flatMap((p, i) => (!p && i < lastPrinting ? [who + ' · side ' + (i + 1) + ' is blank'] : []));
    }),
  );
}

/* The labels over the previewed student's sides, and the blocks on each. */
async function sidesOf(page) {
  return page
    .locator('#rb-preview .sheet-zoom')
    .evaluateAll(zooms =>
      zooms.map(z => [
        z.querySelector('.sheet-label')?.textContent,
        [...z.querySelectorAll('.sheet-row:not(.sheet-row-empty) > .sheet-cell')].map(c => c.dataset.block),
      ]),
    );
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
    expect(await blankBetween(page)).toEqual([]);
    // The table was cut at its rows onto further sides, going on from the
    // Back (not held for after the report), and every assessment it lists
    // is printed once: none is lost or doubled at a cut.
    const first = page.locator('.sheet-student').first();
    expect(await first.locator('.sheet-label', { hasText: /^After the Report$/ }).count()).toBe(0);
    expect(await first.locator('.sheet-label', { hasText: /^Continued$/ }).count()).toBeGreaterThan(0);
    const meta = await first.locator('.report-grades .report-prof-meta').first().textContent();
    const listed = Number((meta.match(/(\d+) assessments/) || [])[1]);
    expect(listed).toBeGreaterThanOrEqual(total - 5);
    const titles = await first.locator('.report-grades-row .report-grades-title').allTextContents();
    expect(titles.length).toBe(listed);
    expect(await first.locator('.report-grades').count()).toBeGreaterThan(1);
  });
}

// The table's other layouts cut the same way: two columns, and by category.
// Each is checked on the previewed student.
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
    // The previewed student, the longest report (the length tests above
    // check every student).
    expect(await overflowing(page)).toEqual([]);
    const first = page.locator('#rb-preview');
    expect(await first.locator('.report-grades').count()).toBeGreaterThan(1);
    const meta = await first.locator('.report-grades .report-prof-meta').first().textContent();
    const listed = Number((meta.match(/(\d+) assessments/) || [])[1]);
    expect(await first.locator('.report-grades-row').count()).toBe(listed);
  });
}

// A new Build Your Own report: the name and Assignment Grades on the Front,
// an empty Back. A table longer than the Front starts under the name and
// goes on onto the Back, then a new sheet: never a blank Back with the
// table on a second sheet (PR 1094's "After main moved").
test('Build Your Own, Demo Mode’s 38 assessments: the Front, then the Back, one sheet', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  expect(await page.evaluate(() => getAssessments('sci8').length)).toBe(38);
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await page.getByRole('radio', { name: 'Custom' }).click();
  await expect(page.locator('.studio-blk.placed')).toHaveCount(1);
  await expect(page.locator('#studio-fit')).toHaveText('1 sheet for all 27 students');
  expect(await sidesOf(page)).toEqual([
    ['Front', ['header', 'grade-table']],
    ['Back', ['grade-table']],
  ]);
  await expect(page.locator('#rb-preview .sheet-zoom').nth(1).locator('.report-block-title').first()).toHaveText(
    'Assignment Grades (continued)',
  );
  expect(await overflowing(page)).toEqual([]);
  const meta = await page.locator('#rb-preview .report-grades .report-prof-meta').first().textContent();
  const listed = Number((meta.match(/(\d+) assessments/) || [])[1]);
  expect(await page.locator('#rb-preview .report-grades-row').count()).toBe(listed);
  // Every student: one sheet, nothing blank between, nothing over.
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS, { timeout: 30_000 });
  expect(await blankBetween(page)).toEqual([]);
  expect(await overflowing(page)).toEqual([]);
  expect(await page.locator('.sheet-student[data-sheets="1"]').count()).toBe(STUDENTS);
});

test('Build Your Own, 80 assessments: the Front, the Back, then a new sheet, with no blank side', async ({ page }) => {
  await openWith(page, 80, null);
  expect(await sidesOf(page)).toEqual([
    ['Front', ['header', 'grade-table']],
    ['Back', ['grade-table']],
    ['Continued', ['grade-table']],
    ['Blank', []],
  ]);
  expect(await overflowing(page)).toEqual([]);
  const meta = await page.locator('#rb-preview .report-grades .report-prof-meta').first().textContent();
  const listed = Number((meta.match(/(\d+) assessments/) || [])[1]);
  expect(await page.locator('#rb-preview .report-grades-row').count()).toBe(listed);
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS, { timeout: 30_000 });
  expect(await blankBetween(page)).toEqual([]);
  expect(await overflowing(page)).toEqual([]);
});
