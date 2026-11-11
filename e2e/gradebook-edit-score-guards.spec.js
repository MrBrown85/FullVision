import { test, expect } from '@playwright/test';

/* Right-click Edit Score (Nov 3 UI audit): rubric and Complete/Incomplete
   work open the grader instead of a number box. The whole 1 to 4 rule, the
   points typo and Clear Score with its ticks and Cmd+Z are pinned in
   tests/pin-gradebook-writes.test.js, tests/gradebook-typo-keeps-score.test.js
   and tests/gradebook-clear-score-undo-ticks.test.js. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openScores(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.waitForSelector('.gb-scores-cell');
}
// The first scored student on an assessment of the kind asked for.
async function pick(page, kind) {
  return page.evaluate(k => {
    const as = getAssessments('sci8').filter(a => {
      const pts = isPointsScored(a);
      if (k === 'points') return pts && !isCompletionScored(a);
      if (k === 'complete') return isCompletionScored(a);
      if (k === 'rubric') return !pts && a.rubricId;
      if (k === 'advanced') return !pts && a.rubricId && rubricStyle(getRubricById('sci8', a.rubricId)) === 'advanced';
      if (k === 'level') return !pts && !a.rubricId && !isCompletionScored(a);
      return false;
    });
    const scores = getScores('sci8');
    for (const a of as)
      for (const sid of Object.keys(scores))
        if ((scores[sid] || []).some(e => e.assessmentId === a.id && e.score > 0)) return { aid: a.id, sid };
    return as[0] ? { aid: as[0].id, sid: getStudents('sci8')[0].id } : null;
  }, kind);
}
const cell = (page, p) => page.locator('.gb-scores-cell[data-aid="' + p.aid + '"][data-sid="' + p.sid + '"]');
async function menu(page, p, item) {
  await cell(page, p).click({ button: 'right' });
  await page.locator('.gb-ctx-item[data-ctx="' + item + '"]').click();
}
const entries = (page, p) =>
  page.evaluate(
    ({ aid, sid }) =>
      JSON.stringify((getScores('sci8')[sid] || []).filter(e => e.assessmentId === aid).map(e => [e.tagId, e.score])),
    p,
  );

test('rubric and Complete/Incomplete work open the grader, changing nothing', async ({ page }) => {
  await openScores(page);
  for (const kind of ['rubric', 'complete']) {
    const p = await pick(page, kind);
    const before = await entries(page, p);
    await menu(page, p, 'editCell');
    await expect(page.locator('.gb-scores-input')).toHaveCount(0);
    await expect.poll(() => page.evaluate(() => PageAssignments.graderOpen())).toBe(true);
    expect(await entries(page, p)).toBe(before);
    await page.keyboard.press('Escape');
    await expect.poll(() => page.evaluate(() => PageAssignments.graderOpen())).toBe(false);
  }
});
