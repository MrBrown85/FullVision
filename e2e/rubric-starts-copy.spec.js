import { test, expect } from '@playwright/test';

/* Copy From Another Class, in place (rubric starts PR 4, 2026-11-02): any
   of the teacher's classes; a class linked to the same curriculum brings
   its competencies with the copy, any other brings criteria and wording
   only. The copy is held until the assessment is created. Demo Mode, with
   two seeded classes. */
test.use({ viewport: { width: 1440, height: 1000 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    const base = getRubrics('sci8').slice(0, 2);
    // Block B: Science 8 again (same curriculum). Science 7: another one.
    COURSES.sci8b = Object.assign(structuredClone(COURSES.sci8), { id: 'sci8b', name: 'Science 8', block: 'B' });
    COURSES.sci7 = Object.assign(structuredClone(COURSES.sci8), {
      id: 'sci7',
      name: 'Science 7',
      block: '',
      curriculumTags: ['SCI7'],
    });
    saveCourses(COURSES);
    for (const id of ['sci8b', 'sci7']) {
      saveLearningMap(id, Object.assign(structuredClone(getLearningMap('sci8')), { _customized: true }));
      saveRubrics(
        id,
        base.map((r, i) => Object.assign(structuredClone(r), { id: id + '-r' + i, copyGroup: null })),
      );
    }
    window.Router.navigate('/assignments?course=sci8');
  });
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.fill('#af-title', 'Density Lab');
  await page.selectOption('#af-category', 'sci8-cat-labs');
}

test('opens in place; from the same curriculum the copy keeps its competencies', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="rubricFromClass"]').click();
  const card = page.locator('#af-rubric-view .af-start-card[data-start="copy"]');
  await expect(card).toBeVisible();
  await expect(page.locator('#af-copy-from')).toBeFocused();
  await page.selectOption('#af-copy-from', 'sci8b');
  await expect(card.locator('.af-start-row')).toHaveCount(2);
  await expect(card.locator('.af-start-row').first().locator('.af-start-codes')).toBeVisible();
  await expect(card.locator('.af-tag-tip, .af-tag-rubric-note')).toContainText('same curriculum');
  const src = await page.evaluate(() => getRubricById('sci8b', 'sci8b-r0'));
  const n = await page.evaluate(() => getRubrics('sci8').length);
  await card.locator('[data-action="startPickUse"]').click();
  await expect(card).toHaveCount(0);
  await expect(page.locator('#af-rubric-view .af-rubric-card-name')).toContainText(src.name);
  // Held, not saved, until Create.
  expect(await page.evaluate(() => getRubrics('sci8').length)).toBe(n);
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = getAssessments('sci8').find(x => x.title === 'Density Lab');
        const r = a && getRubricById('sci8', a.rubricId);
        return r ? r.criteria.map(c => c.tagIds.length > 0) : null;
      }),
    )
    .toEqual(src.criteria.map(c => (c.tagIds || []).length > 0));
});

test('from a different curriculum: no codes, and the copy brings criteria and wording only', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="rubricFromClass"]').click();
  await page.selectOption('#af-copy-from', 'sci7');
  const card = page.locator('#af-rubric-view .af-start-card[data-start="copy"]');
  await expect(card.locator('.af-start-row')).toHaveCount(2);
  await expect(card.locator('.af-start-codes')).toHaveCount(0);
  await expect(card.locator('.af-tag-rubric-note')).toContainText('different curriculum');
  const words = await page.evaluate(() => getRubricById('sci7', 'sci7-r0').criteria[0].levels[3]);
  await expect(card.locator('.af-start-preview')).toContainText(words);
  await card.locator('.af-start-row').first().press('Enter');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = getAssessments('sci8').find(x => x.title === 'Density Lab');
        const r = a && getRubricById('sci8', a.rubricId);
        return r ? r.criteria.every(c => !c.tagIds.length) && r.criteria[0].levels[3] : null;
      }),
    )
    .toBe(words);
});

test('Esc closes without copying', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="rubricFromClass"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('.af-start-card')).toHaveCount(0);
  await expect(page.locator('#af-rubric')).toHaveValue('');
});
