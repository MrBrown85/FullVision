import { test, expect } from '@playwright/test';

/* Whole-rubric competencies (rubric starts PR 6, 2026-11-03): the Blank
   Rubric editor's Whole Rubric Scores line takes competencies the whole
   rubric scores; one there is left out of every criterion's picker and the
   other way round; the gradebook shows one combined level for it. Demo
   Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 1000 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.fill('#af-title', 'Density Lab');
  await page.selectOption('#af-category', 'sci8-cat-labs');
}
const editor = page => page.locator('#af-rubric-view .af-ge-card');

test('Whole Rubric Scores takes competencies, never also on a criterion', async ({ page }) => {
  await openForm(page);
  const ed = editor(page);
  await expect(ed.locator('.af-ge-whole')).toContainText('Whole Rubric Scores');
  // A competency on the first criterion is not offered to the whole rubric.
  await ed.locator('[data-action="gePicker"][data-i="0"]').click();
  await page.fill('#af-ge-pick-search', 'qp3');
  await ed.locator('[data-action="gePick"][data-tag="QP3"]').click();
  await ed.locator('[data-action="gePicker"][data-i="-2"]').click();
  await expect(page.locator('#af-ge-pick-search')).toBeFocused();
  await page.fill('#af-ge-pick-search', 'qp3');
  await expect(ed.locator('[data-action="gePick"][data-tag="QP3"]')).toHaveCount(0);
  await page.fill('#af-ge-pick-search', 'pa4');
  await ed.locator('[data-action="gePick"][data-tag="PA4"]').click();
  await expect(ed.locator('.af-ge-whole .af-ge-chip')).toContainText('PA4');
  // ...and a whole-rubric competency is not offered to a criterion.
  await ed.locator('[data-action="gePicker"][data-i="0"]').click();
  await page.fill('#af-ge-pick-search', 'pa4');
  await expect(ed.locator('[data-action="gePick"][data-tag="PA4"]')).toHaveCount(0);
  await page.keyboard.press('Escape');
  // × takes it off again.
  await ed.locator('.af-ge-whole [data-action="geRemoveTag"][data-tag="PA4"]').click();
  await expect(ed.locator('.af-ge-whole .af-ge-chip')).toHaveCount(0);
});

test('Create saves the whole rubric’s competencies; the gradebook shows one level', async ({ page }) => {
  await openForm(page);
  const ed = editor(page);
  await page.fill('#af-ge-name', 'Density Lab Report');
  await ed.locator('[data-action="geAddCrit"]').click();
  await ed.locator('[data-action="gePicker"][data-i="-2"]').click();
  await page.fill('#af-ge-pick-search', 'pa4');
  await ed.locator('[data-action="gePick"][data-tag="PA4"]').click();
  await ed.locator('[data-action="geSave"]').click();
  await page.locator('[data-action="saveNewAssess"]').click();
  const ids = await page.evaluate(async () => {
    for (let i = 0; i < 50; i++) {
      const a = getAssessments('sci8').find(x => x.title === 'Density Lab');
      const r = a && a.rubricId && getRubricById('sci8', a.rubricId);
      if (r) return { aid: a.id, tagIds: r.tagIds, crits: r.criteria.map(c => [c.id, c.tagIds.length]) };
      await new Promise(res => setTimeout(res, 100));
    }
    return null;
  });
  expect(ids.tagIds).toEqual(['PA4']);
  expect(ids.crits.map(c => c[1])).toEqual([0, 0]);
  // 4 and 2 average 3 of 4 (75%): Proficient on the default table.
  const sid = await page.evaluate(
    ({ aid, crits }) => {
      const sid = getStudents('sci8')[0].id;
      const a = getAssessments('sci8').find(x => x.id === aid);
      upsertScore('sci8', sid, aid, crits[0][0], 4, a.date, a.type, '');
      upsertScore('sci8', sid, aid, crits[1][0], 2, a.date, a.type, '');
      clearProfCache();
      return sid;
    },
    { aid: ids.aid, crits: ids.crits },
  );
  const evidence = await page.evaluate(
    ({ sid, aid }) => getTagScores('sci8', sid, 'PA4').filter(s => s.assessmentId === aid),
    { sid, aid: ids.aid },
  );
  expect(evidence).toHaveLength(1);
  expect(evidence[0].score).toBe(3);
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  // By criterion (the default), each criterion column names the whole
  // rubric's competency.
  await expect(page.locator('[data-tip-text*="· PA4"]').first()).toBeAttached();
  // By competency: one column, one combined level.
  await page.evaluate(() => {
    localStorage.setItem('gb_rubricColumns_sci8', 'competencies');
    window.Router.navigate('/assignments?course=sci8');
  });
  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  const cell = page.locator('td.gb-score[data-aid="' + ids.aid + '"][data-sid="' + sid + '"][data-tid="PA4"]');
  await expect(cell).toHaveText(/3/);
  await expect(cell).toHaveAttribute('title', /whole rubric: its criteria come to 75%/);
});
