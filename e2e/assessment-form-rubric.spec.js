import { test, expect } from '@playwright/test';

/* The rubric in the assessment form (redesign PR 6, 2026-11-02): a chosen
   rubric is a card with its wording; with none, four ways to start one;
   graded on competencies with no rubric, the Competency Rubric shows each
   level's wording, and Edit My Wording keeps the teacher's own. Demo Mode,
   Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

// These tests use the Codes chips; List is the default since Nov 2.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fv-assess-comp-view', 'codes'));
});

// Choose a Rubric opens the picker; '' uses no rubric; a number picks that row.
async function pickRubric(page, rid) {
  await page.locator('[data-action="chooseRubric"]').first().click();
  const bank = page.locator('#af-rubric-view');
  if (rid === '') return bank.locator('[data-action="startPickNone"]').click();
  if (typeof rid === 'object') {
    await bank
      .locator('.af-start-row')
      .nth(rid.index - 1)
      .click();
  } else {
    await bank.locator('.af-start-row[data-rid="' + rid + '"]').click();
  }
  await bank.locator('[data-action="startPickUse"]').click();
}

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('with no rubric, three starts, Blank first; the scoring card reads Rubric', async ({ page }) => {
  await openForm(page);
  await expect(page.locator('.af-scoremode-btn[data-mode="proficiency"]')).toHaveText('Rubric');
  // No "Rubric (optional)" on screen; the label is for screen readers.
  await expect(page.locator('#af-rubric-label')).toHaveClass(/af-visually-hidden/);
  const starts = page.locator('.af-rubric-start .af-start-name');
  await expect(starts).toHaveText(['Blank Rubric', 'Choose a Rubric', 'Copy From Another Class']);
});

test('a chosen rubric is a card with its wording; Pick Another Rubric changes it', async ({ page }) => {
  await openForm(page);
  const r = await page.evaluate(() => {
    const x = getRubrics('sci8')[0];
    return { id: x.id, name: x.name, first: x.criteria[0].levels[3] };
  });
  await pickRubric(page, r.id);
  const card = page.locator('#af-rubric-view .af-rubric-card');
  await expect(card.locator('.af-rubric-card-name')).toHaveText(r.name);
  await expect(card.locator('.rb-grid')).toContainText(r.first);
  await pickRubric(page, '');
  await expect(page.locator('.af-rubric-start')).toHaveCount(3);
});

test('the Competency Rubric shows the wording of each level for the chosen ones', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-code[data-tag="QP3"]').click();
  const want = await page.evaluate(async () => {
    await CompetencyWording.loadBank();
    return CompetencyWording.levelWording(getTagById('sci8', 'QP3'), 3).text;
  });
  const grid = page.locator('#af-tag-rubric .rb-grid');
  await expect(grid).toContainText(want);
  // A rubric replaces it.
  await pickRubric(page, { index: 1 });
  await expect(page.locator('#af-tag-rubric .rb-grid')).toHaveCount(0);
});

test('Edit My Wording keeps the teacher’s own words for a level', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-code[data-tag="QP3"]').click();
  await page.locator('[data-action="editMyWording"]').click();
  const box = page.locator('.af-wording-card textarea[data-tag="QP3"][data-level="3"]');
  await box.fill('Asks a clear question that an investigation can answer.');
  await page.locator('[data-wording="save"]').click();
  await expect(page.locator('#af-tag-rubric .rb-grid')).toContainText(
    'Asks a clear question that an investigation can answer.',
  );
});

test('Use This Rubric makes the Competency Rubric this assessment’s rubric, saved on Create', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Density Lab');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('.af-code[data-tag="QP3"]').click();
  await page.locator('.af-code[data-tag="PA4"]').click();
  const card = page.locator('#af-tag-rubric .af-tag-rubric-card');
  await expect(card.locator('.af-tag-rubric-note')).toContainText('Use This Rubric makes it a rubric');
  const n = await page.evaluate(() => getRubrics('sci8').length);
  await card.locator('[data-action="useCompetencyRubric"]').click();
  const chosen = page.locator('#af-rubric-view .af-rubric-card');
  await expect(chosen.locator('.af-rubric-card-name')).toHaveText('Density Lab Rubric');
  await expect(chosen.locator('.rb-grid tbody tr')).toHaveCount(2);
  // Held, not saved, until the assessment is created.
  expect(await page.evaluate(() => getRubrics('sci8').length)).toBe(n);
  await page.locator('[data-action="saveNewAssess"]').click();
  await expect
    .poll(() =>
      page.evaluate(() => {
        const a = getAssessments('sci8').find(x => x.title === 'Density Lab');
        const r = a && getRubricById('sci8', a.rubricId);
        return r ? r.criteria.map(c => c.tagIds[0]) : null;
      }),
    )
    .toEqual(['QP3', 'PA4']);
});

test('Last used names the rubric on the latest assessment; Use It Again chooses it', async ({ page }) => {
  await openForm(page);
  const want = await page.evaluate(() => {
    const a = getAssessments('sci8')
      .filter(x => x.rubricId && getRubricById('sci8', x.rubricId))
      .sort((p, q) => String(q.dateAssigned || q.date || '').localeCompare(String(p.dateAssigned || p.date || '')))[0];
    return { id: a.rubricId, name: getRubricById('sci8', a.rubricId).name };
  });
  const line = page.locator('.af-rubric-last');
  await expect(line).toContainText('Last used ' + want.name);
  await line.locator('[data-action="useLastRubric"]').click();
  await expect(page.locator('#af-rubric')).toHaveValue(want.id);
  await expect(page.locator('#af-rubric-view .af-rubric-card-name')).toHaveText(want.name);
});
