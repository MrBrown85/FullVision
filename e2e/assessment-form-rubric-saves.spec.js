import { test, expect } from '@playwright/test';

/* Nothing saves before the assessment (redesign PR 8, 2026-11-02): a rubric
   made from the form (blank, drafted, or a copy) is saved only when the
   assessment is created; Cancel with something filled in asks first; Edit
   Rubric on a rubric other assessments use asks: Edit a Copy (the default)
   or Edit All. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

const rubricNames = page => page.evaluate(() => getRubrics('sci8').map(r => r.name));

test('a blank rubric from the form waits; Discard keeps neither', async ({ page }) => {
  await openForm(page);
  const before = await rubricNames(page);
  await page.fill('#af-title', 'Held Rubric Check');
  await page.locator('[data-action="newRubricFromForm"]').click();
  await page.fill('#re-name', 'Held Rubric');
  await page.locator('[data-action="saveRubricEdit"]').click();
  await expect(page.locator('.af-rubric-card-meta')).toContainText('new, saved when the assessment is created');
  expect(await rubricNames(page)).toEqual(before);
  await page.locator('[data-action="cancelAssessForm"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Discard This Assessment?');
  await page.locator('.af-dialog-card button', { hasText: 'Discard' }).click();
  await expect(page.locator('#new-assess-form')).toBeHidden();
  expect(await rubricNames(page)).toEqual(before);
});

test('Create saves the held rubric, then the assessment with it', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Made With a New Rubric');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('[data-action="newRubricFromForm"]').click();
  await page.fill('#re-name', 'Brand New Rubric');
  await page.locator('[data-action="saveRubricEdit"]').click();
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = getAssessments('sci8').find(x => x.title === 'Made With a New Rubric');
        const r = a && getRubricById('sci8', a.rubricId);
        return r ? r.name : null;
      }),
    )
    .toBe('Brand New Rubric');
});

test('Edit Rubric on a shared rubric asks; Edit a Copy is the default and leaves the original', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Density Lab');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  const lab = await page.evaluate(() => {
    const r = getRubrics('sci8').find(x => getAssessments('sci8').filter(a => a.rubricId === x.id).length > 1);
    return { id: r.id, name: r.name, n: getAssessments('sci8').filter(a => a.rubricId === r.id).length };
  });
  await page.locator('[data-action="chooseRubric"]').click();
  await page.locator(`#rubric-bank-overlay .rb-row[data-rid="${lab.id}"]`).click();
  await page.locator('#rubric-bank-overlay [data-rb="pick-use"]').click();
  await page.locator('[data-action="editRubricFromForm"]').click();
  await expect(page.locator('#af-dialog-title')).toHaveText('Edit ' + lab.name);
  await expect(page.locator('.af-dialog-card button', { hasText: `Edit All ${lab.n + 1} Assessments` })).toBeVisible();
  const copyBtn = page.locator('.af-dialog-card button', { hasText: 'Edit a Copy for Density Lab' });
  await expect(copyBtn).toBeFocused();
  await copyBtn.click();
  await expect(page.locator('#re-name')).toHaveValue(lab.name + ' · Density Lab');
  await page.locator('[data-action="saveRubricEdit"]').click();
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(() =>
      page.evaluate(src => {
        const a = getAssessments('sci8').find(x => x.title === 'Density Lab');
        return a
          ? { id: a.rubricId, name: getRubricById('sci8', a.rubricId).name, original: !!getRubricById('sci8', src) }
          : null;
      }, lab.id),
    )
    .toEqual(expect.objectContaining({ name: lab.name + ' · Density Lab', original: true }));
});

test('Cancel with nothing filled in closes without asking', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="cancelAssessForm"]').click();
  await expect(page.locator('#new-assess-form')).toBeHidden();
  await expect(page.locator('#af-dialog-title')).toHaveCount(0);
});
