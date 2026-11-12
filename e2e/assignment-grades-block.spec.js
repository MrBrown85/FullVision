import { test, expect } from '@playwright/test';

/* The Progress Report's Assignment Grades block matches the Quick Report
   (DECISIONS, "Student-facing levels are proficiencies", Assignment Grades,
   2026-11-12): points read "7 / 10" with no proficiency word beside them in
   a Proficiency class, and a piece with no mark yet has a blank mark cell,
   not a dash. Demo Mode's Science 8 is a Proficiency class; Ethan Dubois,
   picked by name, has points work, Missing work and work with no mark. */

const NAME = 'Ethan Dubois';

/* A report with the header and Assignment Grades, Proficiency Word on. */
const GRADES = {
  progressMode: 'build',
  form: {
    v: 6,
    id: 'custom',
    name: 'Custom',
    type: 'standard',
    sides: [
      {
        rows: [
          { cells: [{ block: 'header', size: 'row' }] },
          { cells: [{ block: 'grade-table', size: 'row', options: { word: true } }] },
        ],
      },
    ],
    perStudent: {},
  },
  preset: 'standard',
};

test('Assignment Grades: points read "7 / 10" with no word, and no mark is blank', async ({ page }) => {
  test.setTimeout(60_000);
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getStudents('sci8').length > 0);
  // From the scores, not the page: a points piece Ethan has, and one with no mark yet.
  const at = await page.evaluate(name => {
    const cid = 'sci8';
    const st = getStudents(cid).find(s => displayNameWithLast(s) === name);
    const today = courseToday(cid);
    const due = getAssessments(cid).filter(a => !a.date || a.date <= today);
    const cell = a => assessmentCellValue(cid, st.id, a);
    const pts = due.find(a => cell(a).kind === 'points');
    const none = due.find(a => cell(a).kind === 'none');
    return {
      mode: courseGradeMode(cid),
      points: { title: pts.title, mark: formatPoints(cell(pts).value) + ' / ' + formatPoints(pts.maxPoints) },
      none: none.title,
    };
  }, NAME);
  expect(at.mode).toBe('proficiency');
  await page.evaluate(layout => saveReportConfig('sci8', layout), GRADES);
  await page.reload();
  await page.evaluate(r => window.Router.navigate(r), '/reports');
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('.sheet-cell[data-block="grade-table"]').first()).toBeVisible();

  // This student alone, as the teacher picks one in Select Students.
  await page.getByRole('button', { name: 'Select students' }).click();
  const list = page.locator('#picker-dropdown');
  await list.getByRole('button', { name: 'Deselect All' }).click();
  await list.locator('.student-picker-item', { hasText: NAME }).click();
  await page.getByRole('button', { name: 'Select students' }).click();
  await expect(list).not.toHaveClass(/open/);
  await expect(page.locator('.report-sheet').first()).toContainText(NAME);

  const row = title =>
    page
      .locator('.report-grades-row', {
        has: page.locator('.report-grades-title', {
          hasText: new RegExp('^' + title.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + '$'),
        }),
      })
      .first();
  const pts = row(at.points.title);
  await expect(pts.locator('.report-grades-figs')).toHaveText(at.points.mark);
  await expect(pts.locator('.report-grades-word')).toHaveText('');
  const blank = row(at.none);
  await expect(blank.locator('.report-grades-figs')).toHaveText('');
  await expect(blank).not.toContainText('—');
  // The blank row keeps its height, and nothing in the block runs past its box.
  const h = async r => (await r.boundingBox()).height;
  expect(Math.abs((await h(blank)) - (await h(pts)))).toBeLessThan(1);
  const over = await page.evaluate(
    () => [...document.querySelectorAll('.report-grades-figs')].filter(c => c.scrollWidth > c.clientWidth + 1).length,
  );
  expect(over).toBe(0);
  expect(errors).toEqual([]);
});
