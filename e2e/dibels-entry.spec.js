import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp, TEST_COURSE } from './helpers.js';

// A DIBELS 8 benchmark records each window's raw reading scores. The whole
// class goes in a table; one student goes in the grade editor's card. The
// levels follow the Grade 8 cut points, and no grade is shown.
const ASSESSMENT = {
  id: 'assess-dibels',
  title: 'DIBELS 8 Benchmark',
  date: '2026-10-03',
  type: 'formative',
  tagIds: [],
  scoreMode: 'dibels',
  maxPoints: 0,
  weight: 1,
  collaboration: 'individual',
  created: new Date('2026-10-03').toISOString(),
};

async function seed(page) {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  await page.addInitScript(
    ({ assessment, cid }) => {
      localStorage.setItem('gb-assessments-' + cid, JSON.stringify([assessment]));
    },
    { assessment: ASSESSMENT, cid: TEST_COURSE.id },
  );
}

const saved = (page, sid, period) =>
  page.evaluate(({ cid, sid, period }) => getDibelsScore(cid, sid, 'assess-dibels', period), {
    cid: TEST_COURSE.id,
    sid,
    period,
  });

test('the whole class enters scores in a table that works out the levels', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/assignments');
  const card = page.locator('#ac-assess-dibels');
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();

  const row = card.locator('.dbl-row[data-status-student="stu-001"]');
  await row.locator('.dbl-input[data-field="orfWrc"]').fill('147');
  await page.keyboard.press('Tab');
  await expect(row.locator('.dbl-input[data-field="orfErrors"]')).toBeFocused();
  await page.keyboard.type('2');
  await page.keyboard.press('Tab');
  await page.keyboard.type('21');
  await page.keyboard.press('Tab');
  await page.keyboard.type('3');
  await page.keyboard.press('Tab');

  await expect(row.locator('[data-out="accuracy"]')).toHaveText('98.7%');
  await expect(row.locator('[data-out="orfLevel"]')).toHaveText('Above');
  await expect(row.locator('[data-out="adjusted"]')).toHaveText('19.5');
  await expect(row.locator('[data-out="mazeLevel"]')).toHaveText('Strategic');
  await expect(card.locator('.dbl-summary')).toContainText('1 of');
  expect(await saved(page, 'stu-001', 'boy')).toEqual({
    orfWrc: 147,
    orfErrors: 2,
    mazeCorrect: 21,
    mazeIncorrect: 3,
  });

  // Each window keeps its own scores.
  await card.locator('[data-action="setDibelsPeriod"][data-period="moy"]').click();
  await expect(row.locator('.dbl-input[data-field="orfWrc"]')).toHaveValue('');
});

test('the grade editor shows one student’s card and levels, not a grade', async ({ page }) => {
  await seed(page);
  await gotoApp(page, '/gradebook');
  await page.locator('[data-action="setView"][data-mode="scores"]').click();
  await page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-dibels"]').click();

  const dialog = page.locator('#grader-overlay');
  await expect(dialog.locator('.dbl-card-wrap')).toHaveCount(1);
  await expect(dialog.locator('.grader-grade')).toBeHidden();
  await dialog.locator('.dbl-input[data-field="orfWrc"]').fill('130');
  await page.keyboard.press('Tab');
  await expect(dialog.locator('.dbl-input[data-field="orfErrors"]')).toBeFocused();
  await expect(dialog.locator('[data-out="orfLevel"]')).toHaveText('Core');
  await expect(dialog.locator('.grader-dibels-levels')).toContainText('Core');
  expect((await saved(page, 'stu-001', 'boy')).orfWrc).toBe(130);

  await dialog.locator('[data-grader="close"], .grader-done').first().click();
  await expect(page.locator('.gb-scores-cell[data-sid="stu-001"][data-aid="assess-dibels"]')).toContainText('Core');
});
