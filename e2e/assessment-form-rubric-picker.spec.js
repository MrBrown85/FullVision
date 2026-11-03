import { test, expect } from '@playwright/test';

/* Choose a Rubric (redesign PR 7, 2026-11-02): the Rubric Bank's window in
   pick mode, from the assessment form. Suggested rubrics share the
   competencies chosen; Recently Used; Everything Else; search finds a
   rubric by an assessment it was on or a competency code. Demo Mode,
   Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('suggests rubrics that share the chosen competencies, then recent, then the rest', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Density Lab');
  await page.locator('.af-code[data-tag="QP3"]').click();
  await page.locator('.af-code[data-tag="PC2"]').click();
  await page.locator('[data-action="chooseRubric"]').click();
  const bank = page.locator('#rubric-bank-overlay');
  await expect(bank.locator('#rb-heading')).toHaveText('Choose a Rubric for Density Lab');
  const groups = await bank.locator('.rb-group').allTextContents();
  expect(groups[0]).toMatch(/^Suggested · \d+$/);
  // The first suggestion feeds both competencies.
  const first = await bank.locator('.rb-row').first().getAttribute('data-rid');
  const feeds = await page.evaluate(id => getRubricById('sci8', id).criteria.flatMap(c => c.tagIds || []), first);
  expect(feeds).toEqual(expect.arrayContaining(['QP3', 'PC2']));
  await expect(bank.locator('[data-rb="pick-use"]')).toHaveText('Use This Rubric');
  await expect(bank.locator('[data-rb="new-menu"]')).toHaveCount(0);
});

test('search finds a rubric by an assessment it was used on', async ({ page }) => {
  await openForm(page);
  const hit = await page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.rubricId);
    return { title: a.title, rid: a.rubricId };
  });
  await page.locator('[data-action="chooseRubric"]').click();
  await page.fill('#rb-search', hit.title);
  await expect(page.locator(`#rubric-bank-overlay .rb-row[data-rid="${hit.rid}"]`)).toBeVisible();
});

test('Use This Rubric puts it on the form; Enter does too', async ({ page }) => {
  await openForm(page);
  const r = await page.evaluate(() => getRubrics('sci8')[1]);
  await page.locator('[data-action="chooseRubric"]').click();
  await page.locator(`#rubric-bank-overlay .rb-row[data-rid="${r.id}"]`).click();
  await page.locator('#rubric-bank-overlay [data-rb="pick-use"]').click();
  await expect(page.locator('#rubric-bank-overlay')).toHaveCount(0);
  await expect(page.locator('#af-rubric')).toHaveValue(r.id);
  await expect(page.locator('.af-rubric-card-name')).toHaveText(r.name);
  // Pick Another Rubric, arrow down, Enter.
  await page.locator('.af-rubric-card [data-action="chooseRubric"]').click();
  await page.locator('#rb-search').press('ArrowDown');
  await page.locator('#rubric-bank-overlay .rb-row.is-selected').press('Enter');
  await expect(page.locator('#rubric-bank-overlay')).toHaveCount(0);
  await expect(page.locator('#af-rubric')).not.toHaveValue('');
});
