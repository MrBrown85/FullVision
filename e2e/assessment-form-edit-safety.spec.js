import { test, expect } from '@playwright/test';

/* Editing scored work (redesign PR 9, 2026-11-02): the heading says how
   many students are scored; changing the scoring or the rubric asks first.
   Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function editScored(page, withRubric) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await expect(page.locator('[data-action="editAssess"]').first()).toBeAttached();
  const a = await page.evaluate(rub => {
    const scored = x => getStudents('sci8').filter(s => hasScoreOrFeedback('sci8', s.id, x.id)).length;
    const list = getAssessments('sci8').filter(
      x => !!x.rubricId === rub && (x.scoreMode || 'proficiency') === 'proficiency',
    );
    const hit = list.find(x => scored(x) > 0);
    return { id: hit.id, n: scored(hit), rubricId: hit.rubricId || '' };
  }, withRubric);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), a.id);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  return a;
}

test('the heading says how many students are scored', async ({ page }) => {
  const a = await editScored(page, true);
  await expect(page.locator('.af-heading-note')).toHaveText(
    a.n + (a.n === 1 ? ' student scored.' : ' students scored.') + ' Changing the scoring or the rubric asks first.',
  );
});

test('changing the scoring of scored work asks; Cancel keeps it', async ({ page }) => {
  await editScored(page, false);
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Change the Scoring?');
  await page.locator('.af-dialog-card button', { hasText: 'Cancel' }).click();
  await expect(page.locator('#af-scoremode')).toHaveValue('proficiency');
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.locator('.af-dialog-card button', { hasText: 'Change the Scoring' }).click();
  await expect(page.locator('#af-scoremode')).toHaveValue('points');
});

test('changing the rubric of scored work asks first', async ({ page }) => {
  const a = await editScored(page, true);
  const other = await page.evaluate(rid => getRubrics('sci8').find(r => r.id !== rid).id, a.rubricId);
  await page.locator('.af-rubric-card [data-action="chooseRubric"]').click();
  await page.locator(`#rubric-bank-overlay .rb-row[data-rid="${other}"]`).click();
  await page.locator('#rubric-bank-overlay [data-rb="pick-use"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Change the Rubric?');
  await page.locator('.af-dialog-card button', { hasText: 'Cancel' }).click();
  await expect(page.locator('#af-rubric')).toHaveValue(a.rubricId);
});
