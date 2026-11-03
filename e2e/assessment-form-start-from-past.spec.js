import { test, expect } from '@playwright/test';

/* Start From a Past Assessment (redesign PR 12, 2026-11-02): a picker of the
   teacher's assessments in every class, searched by title; picking one fills
   the form with dates reset and the title selected; nothing is saved until
   Create. Demo Mode, Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('picking one of this class’s assessments fills the form; nothing is saved', async ({ page }) => {
  await openForm(page);
  const src = await page.evaluate(() => {
    const a =
      getAssessments('sci8').find(x => x.rubricId && (x.coreCompetencyIds || []).length) ||
      getAssessments('sci8').find(x => x.rubricId);
    return {
      id: a.id,
      title: a.title,
      rubricId: a.rubricId,
      cc: a.coreCompetencyIds || [],
      n: getAssessments('sci8').length,
    };
  });
  await page.locator('[data-action="startFromPast"]').click();
  await expect(page.locator('#af-past-title')).toHaveText('Start From a Past Assessment');
  await expect(page.locator('#af-past-find')).toBeFocused();
  await page.fill('#af-past-find', src.title);
  await page.locator('.af-past-row', { hasText: src.title }).first().click();
  await expect(page.locator('#af-title')).toHaveValue(src.title);
  await expect(page.locator('#af-title')).toBeFocused();
  expect(
    await page.evaluate(() => {
      const t = document.getElementById('af-title');
      return t.selectionStart === 0 && t.selectionEnd === t.value.length;
    }),
  ).toBe(true);
  await expect(page.locator('#af-rubric')).toHaveValue(src.rubricId);
  const today = await page.evaluate(() => courseToday('sci8'));
  await expect(page.locator('#af-date-assigned')).toHaveValue(today);
  const cc = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.af-cc-chip.active')).map(c => c.dataset.cc),
  );
  expect(cc.sort()).toEqual(src.cc.slice().sort());
  expect(await page.evaluate(() => getAssessments('sci8').length)).toBe(src.n);
});

test('points work brings its scoring and competencies', async ({ page }) => {
  await openForm(page);
  const src = await page.evaluate(() => {
    const a =
      getAssessments('sci8').find(x => x.scoreMode === 'points' && (x.tagIds || []).length) ||
      getAssessments('sci8').find(x => !x.rubricId && (x.tagIds || []).length);
    return { title: a.title, mode: a.scoreMode || 'proficiency', mp: a.maxPoints, tags: a.tagIds };
  });
  await page.locator('[data-action="startFromPast"]').click();
  await page.fill('#af-past-find', src.title);
  await page.locator('#af-past-find').press('Enter');
  await expect(page.locator('#af-scoremode')).toHaveValue(src.mode);
  if (src.mode === 'points') await expect(page.locator('#af-maxpoints')).toHaveValue(String(src.mp));
  const ticked = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(c => c.value),
  );
  expect(ticked.sort()).toEqual(src.tags.slice().sort());
});

test('Escape closes the picker and leaves the form as it was', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Mine');
  await page.locator('[data-action="startFromPast"]').click();
  await page.keyboard.press('Escape');
  await expect(page.locator('#af-past-title')).toHaveCount(0);
  await expect(page.locator('#af-title')).toHaveValue('Mine');
});

test('editing has no Start From a Past Assessment', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="cancelAssessForm"]').click();
  const aid = await page.evaluate(() => getAssessments('sci8')[0].id);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  await expect(page.locator('[data-action="startFromPast"]')).toHaveCount(0);
});

test('from another class: competencies matched by name, the rubric a copy held until Create', async ({ page }) => {
  await openForm(page);
  // Demo has one class: last year's Science 8, with one assessment on a rubric.
  const src = await page.evaluate(() => {
    COURSES.past1 = Object.assign(structuredClone(COURSES.sci8), { id: 'past1', name: 'Science 8 Last Year' });
    saveCourses(COURSES);
    saveLearningMap('past1', Object.assign(structuredClone(getLearningMap('sci8')), { _customized: true }));
    const r = structuredClone(getRubrics('sci8')[0]);
    r.id = 'past1-rubric';
    saveRubrics('past1', [r]);
    const tags = [...new Set(r.criteria.flatMap(c => c.tagIds || []))];
    saveAssessments('past1', [
      {
        id: 'past1-a',
        title: 'Old Pendulum Lab',
        dateAssigned: '2025-10-01',
        date: '2025-10-01',
        rubricId: r.id,
        tagIds: tags,
        type: 'summative',
      },
    ]);
    return { rubric: r.name, tags, n: getRubrics('sci8').length };
  });
  await page.locator('[data-action="startFromPast"]').click();
  await page.fill('#af-past-find', 'Old Pendulum');
  await expect(page.locator('.af-past-group')).toHaveText([/Science 8 Last Year/]);
  await page.locator('.af-past-row', { hasText: 'Old Pendulum Lab' }).click();
  await expect(page.locator('#af-title')).toHaveValue('Old Pendulum Lab');
  const chosen = await page.evaluate(() => document.getElementById('af-rubric').value);
  expect(chosen).not.toBe('');
  expect(await page.evaluate(id => !!getRubricById('sci8', id), chosen)).toBe(false);
  const ticked = await page.evaluate(() =>
    Array.from(document.querySelectorAll('.af-tag-cb:checked')).map(c => c.value),
  );
  expect(ticked.length).toBe(src.tags.length);
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect.poll(() => page.evaluate(() => getRubrics('sci8').length)).toBe(src.n + 1);
  const made = await page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.title === 'Old Pendulum Lab');
    return { rubric: getRubricById('sci8', a.rubricId).name, dateAssigned: a.dateAssigned, today: courseToday('sci8') };
  });
  expect(made.rubric).toBe(src.rubric);
  expect(made.dateAssigned).toBe(made.today);
});
