import { test, expect } from '@playwright/test';

/* Right-click Edit Score and Clear Score (Nov 3 UI audit): a typed
   proficiency is a whole 1–4 or nothing changes; rubric and
   Complete/Incomplete work open the grader instead of a number box; a
   points typo leaves the score; Clear Score takes an Advanced Rubric's
   ticks with it and ⌘Z puts the score back. Demo Mode, Science 8. */
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

test('a typed proficiency must be a whole 1 to 4', async ({ page }) => {
  await openScores(page);
  const p = await pick(page, 'level');
  test.skip(!p, 'no plain proficiency work in the demo');
  const before = await entries(page, p);
  for (const bad of ['3.5', '9', '0.4']) {
    await menu(page, p, 'editCell');
    await cell(page, p).locator('.gb-scores-input').fill(bad);
    await cell(page, p)
      .locator('.gb-scores-input')
      .evaluate(el => el.blur());
    expect(await entries(page, p)).toBe(before);
  }
  await menu(page, p, 'editCell');
  await cell(page, p).locator('.gb-scores-input').fill('2');
  await cell(page, p)
    .locator('.gb-scores-input')
    .evaluate(el => el.blur());
  await expect.poll(() => entries(page, p)).toMatch(/,2\]/);
});

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

test('a points typo leaves the score', async ({ page }) => {
  await openScores(page);
  const p = await pick(page, 'points');
  const before = await page.evaluate(({ aid, sid }) => getPointsScore('sci8', sid, aid), p);
  await menu(page, p, 'editCell');
  await cell(page, p)
    .locator('.gb-scores-input')
    .evaluate(el => {
      el.type = 'text';
      el.value = 'q';
      el.blur();
    });
  expect(await page.evaluate(({ aid, sid }) => getPointsScore('sci8', sid, aid), p)).toBe(before);
});

test('Clear Score takes the ticks with it, and ⌘Z puts the score back', async ({ page }) => {
  await openScores(page);
  const p = await pick(page, 'advanced');
  test.skip(!p, 'no Advanced Rubric work in the demo');
  await page.evaluate(({ aid, sid }) => {
    const r = getRubricById('sci8', getAssessments('sci8').find(a => a.id === aid).rubricId);
    const check = r.criteria.flatMap(c => c.checks || [])[0];
    if (check) setRubricCheck('sci8', sid, aid, check.id, true);
  }, p);
  const before = await entries(page, p);
  await menu(page, p, 'clearCell');
  expect(await entries(page, p)).toBe('[]');
  expect(await page.evaluate(({ aid, sid }) => getRubricCheckIds('sci8', sid, aid).length, p)).toBe(0);
  await page.keyboard.press(process.platform === 'darwin' ? 'Meta+z' : 'Control+z');
  await expect.poll(() => entries(page, p)).toBe(before);
});
