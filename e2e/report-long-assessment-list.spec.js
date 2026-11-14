/**
 * Reports: a report with a long assessment list never runs past its page
 * (One Report's layout, teacher/report-one.js, cutting tables with
 * teacher/report-sheets.js pack()). The table starts where it is and goes
 * on side by side, so no side is left blank between the report and the
 * rest of the table.
 *
 * The Conference Pack lists every assessment as a row of its Assessments
 * table. Demo Mode's Science 8 has 37; with 38 the continued side's
 * content was once 1010 px tall in a 996 px sheet, so the printed page was
 * clipped. Here the class is given 38 and 100 assessments (copies of its
 * own, on this page only) and every side of every student must hold its
 * content. The list in groups and side by side (what Assignment Grades
 * printed, folded into Assessments on Nov 13) is checked in each of its
 * layouts and on its own under the letterhead.
 */
import { test, expect } from '@playwright/test';

// 27 students' reports with 100 rows each take a while on a CI runner.
test.describe.configure({ mode: 'parallel', timeout: 120_000 });

// The same font everywhere.
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

/* The letterhead and Assignment Grades, nothing else: what a new Build
   Your Own report started as in Page Studio. Saved like this, it opens as
   the Assessments part by month, newest first (report-one.js _fold). */
const GRADES_ONLY = { parts: ['header', 'grade-table'], feedback: {} };

/* The rows the Assessments part lists for the student previewed, and the
   rows printed for them (a row names its assessment, data-row). */
async function previewRows(page) {
  const student = page.locator('#rb-preview .sheet-student').first();
  return assessmentRows(page, student);
}

/* Demo Mode with the class at `total` assessments: copies of its own,
   dated across the year so they fall in Year to Date. `setup`: a One
   Report Setup's id, or a model to save as the class's report. */
async function openWith(page, total, setup = 'conference-pack') {
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
    // Every habit rated, so Work Habits prints in full.
    const habits = { completes: 4, ready: 3, others: 4, part: 3, feedback: 3, devices: 4 };
    getStudents(cid).forEach(s => upsertTermRating(cid, s.id, ReportBlocks.getTermId(), { habits }));
    return getAssessments(cid).length;
  }, total);
  expect(n).toBe(total);
  await useModel(page, setup);
}

/* Saves `setup` (a Setup's id or a model) as the class's One Report and
   opens Progress Reports on it. */
async function useModel(page, setup) {
  // ReportOne loads with the Reports page.
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.waitForFunction(() => typeof window.ReportOne === 'object');
  await page.evaluate(setup => {
    const one = typeof setup === 'string' ? ReportOne.fromSetup(setup) : ReportOne.normalize(setup);
    saveReportConfig('sci8', Object.assign({}, getReportConfig('sci8'), { one }));
  }, setup);
  await page.evaluate(r => window.Router.navigate(r), '/dashboard');
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Print Reports' }).click();
  await expect(page.locator('#studio.studio-one')).toBeVisible();
  await expect(page.locator('#studio-fit')).not.toBeEmpty();
}

/* The Assessments rows the Conference Pack lists for the student shown
   first, and the rows printed for them. */
async function assessmentRows(page, student) {
  const sid = await student.getAttribute('data-sid');
  const listed = await page.evaluate(sid => {
    const st = getStudents('sci8').find(x => x.id === sid);
    return ReportOne.rowsOf(
      ReportOne.modelFor(getReportConfig('sci8')),
      'assessments',
      'sci8',
      st,
      ReportBlocks.reportContext(),
    ).length;
  }, sid);
  const printed = await student
    .locator('.sheet-cell[data-part="assessments"] .gr-row[data-row]')
    .evaluateAll(rows => rows.map(r => r.dataset.row));
  return { listed, printed };
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

for (const total of [38, 100]) {
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
    expect(await first.locator('.sheet-label', { hasText: /After the Report/ }).count()).toBe(0);
    const { listed, printed } = await assessmentRows(page, first);
    expect(listed).toBeGreaterThanOrEqual(total - 5);
    expect(printed.length).toBe(listed);
    expect(new Set(printed).size).toBe(listed);
    const pieces = first.locator('.sheet-cell[data-part="assessments"]');
    expect(await pieces.count()).toBeGreaterThan(1);
    await expect(pieces.nth(1).locator('.report-block-title')).toHaveText('Assessments (continued)');
  });
}

// The table's other layouts cut the same way: two columns, and by category.
// One class with 100 assessments, each layout checked on the previewed student.
test('100 assessments, in two columns by category, two by date and one by category: none overflows, none lost', async ({
  page,
}) => {
  await openWith(page, 100, GRADES_ONLY);
  await page.locator('#studio-palette [data-action="oneOpen"][data-part="assessments"]').click();
  const bar = page.locator('#one-opts-assessments');
  await expect(bar).toBeVisible();
  for (const [columns, organize] of [
    ['Two', 'Category'],
    ['Two', 'Month'],
    ['One', 'Category'],
  ]) {
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
    expect(await overflowing(page), columns + ' by ' + organize).toEqual([]);
    const first = page.locator('#rb-preview');
    expect(await first.locator('.sheet-cell[data-part="assessments"]').count()).toBeGreaterThan(1);
    if (columns === 'Two') expect(await first.locator('.gr-cols').count()).toBeGreaterThan(1);
    const { listed, printed } = await previewRows(page);
    expect(printed.length, columns + ' by ' + organize).toBe(listed);
    expect(new Set(printed).size).toBe(listed);
    // A later piece carries on under its name.
    await expect(
      first.locator('.sheet-cell[data-part="assessments"]').nth(1).locator('.report-block-title'),
    ).toHaveText('Assessments (continued)');
  }
});

// The letterhead and Assignment Grades, as a new Build Your Own report
// started (now the Assessments part by month). A list longer than the
// Front starts under the name and goes on onto the Back, then a new sheet:
// never a blank Back with the list on a second sheet (PR 1094's "After
// main moved"). Its rows are the Assessments list's, shorter than
// Assignment Grades' were, so it takes more work to fill a side.
test('a saved Assignment Grades alone, 60 assessments: the Front, then the Back, one sheet', async ({ page }) => {
  await openWith(page, 60, GRADES_ONLY);
  expect(await sidesOf(page)).toEqual([
    ['Front', ['header', 'assessments']],
    ['Back', ['assessments']],
  ]);
  await expect(page.locator('#rb-preview .sheet-zoom').nth(1).locator('.report-block-title').first()).toHaveText(
    'Assessments (continued)',
  );
  // By month: the month the Back starts in carries on under its name.
  await expect(page.locator('#rb-preview .sheet-zoom').nth(1).locator('.gr-ghead').first()).toBeVisible();
  expect(await overflowing(page)).toEqual([]);
  const { listed, printed } = await previewRows(page);
  expect(printed.length).toBe(listed);
  // Every student: one sheet, nothing blank between, nothing over.
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS, { timeout: 30_000 });
  expect(await blankBetween(page)).toEqual([]);
  expect(await overflowing(page)).toEqual([]);
  expect(await page.locator('.sheet-student[data-sheets="1"]').count()).toBe(STUDENTS);
});

test('a saved Assignment Grades alone, 120 assessments: the Front, the Back, then a new sheet, with no blank side', async ({
  page,
}) => {
  await openWith(page, 120, GRADES_ONLY);
  expect(await sidesOf(page)).toEqual([
    ['Sheet 1 · Front', ['header', 'assessments']],
    ['Sheet 1 · Back', ['assessments']],
    ['Sheet 2 · Front', ['assessments']],
    ['Sheet 2 · Back · Blank', []],
  ]);
  expect(await overflowing(page)).toEqual([]);
  const { listed, printed } = await previewRows(page);
  expect(printed.length).toBe(listed);
  expect(new Set(printed).size).toBe(listed);
  await page.locator('.studio-view [data-view="all"]').click();
  await expect(page.locator('.sheet-student')).toHaveCount(STUDENTS, { timeout: 30_000 });
  expect(await blankBetween(page)).toEqual([]);
  expect(await overflowing(page)).toEqual([]);
});
