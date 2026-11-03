import { test, expect } from '@playwright/test';

/* Editing scored work (redesign PR 9, 2026-11-02): the heading says how
   many students are scored; changing the scoring or the rubric asks first.
   Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function editScored(page, withRubric, setup) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  if (setup) await page.evaluate(setup);
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
  await page.locator(`#af-rubric-view .af-start-row[data-rid="${other}"]`).click();
  await page.locator('#af-rubric-view [data-action="startPickUse"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Change the Rubric?');
  await page.locator('.af-dialog-card button', { hasText: 'Cancel' }).click();
  await expect(page.locator('#af-rubric')).toHaveValue(a.rubricId);
});

// Science 7, another curriculum, with a copy of one of Science 8's rubrics.
function addScience7() {
  COURSES.sci7 = Object.assign(structuredClone(COURSES.sci8), {
    id: 'sci7',
    name: 'Science 7',
    curriculumTags: ['SCI7'],
  });
  saveCourses(COURSES);
  saveLearningMap('sci7', Object.assign(structuredClone(getLearningMap('sci8')), { _customized: true }));
  saveRubrics('sci7', [Object.assign(structuredClone(getRubrics('sci8')[0]), { id: 'sci7-r0', copyGroup: null })]);
}

test('copying a rubric onto scored work with no rubric asks first', async ({ page }) => {
  await editScored(page, false, addScience7);
  await page.locator('[data-action="rubricFromClass"]').click();
  await page.selectOption('#af-copy-from', 'sci7');
  const card = page.locator('#af-rubric-view .af-start-card[data-start="copy"]');
  await card.locator('.af-start-row').first().click();
  await card.locator('[data-action="startPickUse"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Change the Rubric?');
  await page.locator('.af-dialog-card button', { hasText: 'Cancel' }).click();
  await expect(page.locator('#af-rubric')).toHaveValue('');
});

test('a Blank rubric on scored work with no rubric asks first, on Save Rubric and on Save Changes', async ({
  page,
}) => {
  const a = await editScored(page, false);
  await page.locator('.af-rubric-start[data-start="blank"]').click();
  const ed = page.locator('#af-rubric-view .af-ge-card');
  await ed.locator('[data-ge="level"][data-i="0"][data-level="4"]').fill('Goes beyond.');
  await page.fill('#af-ge-name', 'Lab Rubric');
  await ed.locator('[data-action="geSave"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Change the Rubric?');
  await page.locator('.af-dialog-card button', { hasText: 'Cancel' }).click();
  // Cancel keeps the editor and its writing; the work keeps no rubric.
  await expect(ed).toBeVisible();
  await expect(page.locator('#af-rubric')).toHaveValue('');
  // Save Changes with the editor open asks too, and saves once confirmed.
  await page.locator('[data-action="saveEditAssess"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Change the Rubric?');
  expect(await page.evaluate(id => getAssessments('sci8').find(x => x.id === id).rubricId || '', a.id)).toBe('');
  await page.locator('.af-dialog-card button', { hasText: 'Change the Rubric' }).click();
  await expect
    .poll(() =>
      page.evaluate(id => {
        const x = getAssessments('sci8').find(y => y.id === id);
        const r = x && x.rubricId && getRubricById('sci8', x.rubricId);
        return r ? r.name : null;
      }, a.id),
    )
    .toBe('Lab Rubric');
});
