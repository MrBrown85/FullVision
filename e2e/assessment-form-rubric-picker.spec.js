import { test, expect } from '@playwright/test';
import { openCompPicker, closeCompPicker } from './helpers.js';

/* Choose a Rubric (redesign PR 7; in place since rubric starts PR 3,
   2026-11-02): opens under its button, joined to it, from the assessment
   form. Suggested rubrics share the
   competencies chosen; Recently Used; Everything Else; search finds a
   rubric by an assessment it was on or a competency code. Demo Mode,
   Science 8. */
test.use({ viewport: { width: 1440, height: 900 } });

// These tests use the Codes chips; List is the default since Nov 2.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fv-assess-comp-view', 'codes'));
});

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

test('opens in place under its button, search focused; suggests rubrics that share the ticked competencies', async ({
  page,
}) => {
  await openForm(page);
  await page.fill('#af-title', 'Density Lab');
  await openCompPicker(page);
  await page.locator('.af-code[data-tag="QP3"]').click();
  await page.locator('.af-code[data-tag="PC2"]').click();
  await closeCompPicker(page);
  await page.locator('.af-rubric-start[data-action="chooseRubric"]').click();
  await expect(page.locator('#rubric-bank-overlay')).toHaveCount(0);
  const card = page.locator('#af-rubric-view .af-start-card');
  await expect(card).toBeVisible();
  await expect(page.locator('.af-rubric-start[data-action="chooseRubric"]')).toHaveClass(/is-open/);
  await expect(page.locator('#af-start-search')).toBeFocused();
  const groups = await card.locator('.af-start-group').allTextContents();
  expect(groups[0]).toBe('Suggested · they score what you ticked');
  // The first suggestion feeds both competencies, is selected, and its name heads the card.
  const first = await card.locator('.af-start-row').first().getAttribute('data-rid');
  const feeds = await page.evaluate(id => getRubricById('sci8', id).criteria.flatMap(c => c.tagIds || []), first);
  expect(feeds).toEqual(expect.arrayContaining(['QP3', 'PC2']));
  const name = await page.evaluate(id => getRubricById('sci8', id).name, first);
  await expect(card.locator('.af-rubric-card-head .af-rubric-card-name')).toHaveText(name);
  await expect(card.locator('[data-action="startPickUse"]')).toHaveText('Use This Rubric');
  await expect(card.locator('[data-action="closeStart"]')).toHaveText('Close');
  // The other starts step back; Last used hides while a start is open.
  await expect(page.locator('.af-rubric-starts')).toHaveClass(/has-open/);
  await expect(page.locator('.af-rubric-last')).toHaveCount(0);
});

test('search finds a rubric by an assessment it was used on', async ({ page }) => {
  await openForm(page);
  const hit = await page.evaluate(() => {
    const a = getAssessments('sci8').find(x => x.rubricId);
    return { title: a.title, rid: a.rubricId };
  });
  await page.locator('[data-action="chooseRubric"]').click();
  await page.locator('#af-start-search').fill(hit.title);
  await expect(page.locator(`#af-rubric-view .af-start-row[data-rid="${hit.rid}"]`)).toBeVisible();
  await expect(page.locator('#af-start-search')).toBeFocused();
});

test('Use This Rubric puts it on the form; arrows and Enter do too; Esc closes', async ({ page }) => {
  await openForm(page);
  const r = await page.evaluate(() => getRubrics('sci8')[1]);
  await page.locator('[data-action="chooseRubric"]').click();
  await page.locator(`#af-rubric-view .af-start-row[data-rid="${r.id}"]`).click();
  await page.locator('#af-rubric-view [data-action="startPickUse"]').click();
  await expect(page.locator('.af-start-card')).toHaveCount(0);
  await expect(page.locator('#af-rubric')).toHaveValue(r.id);
  await expect(page.locator('.af-rubric-card-name')).toHaveText(r.name);
  // Pick Another Rubric opens Choose in the rubric's place; arrow down, Enter.
  await page.locator('.af-rubric-card [data-action="chooseRubric"]').click();
  await expect(page.locator('.af-start-card[data-in-place="true"]')).toBeVisible();
  const before = await page.locator('#af-rubric').inputValue();
  await page.locator('#af-start-search').press('ArrowDown');
  await page.locator('#af-start-search').press('Enter');
  await expect(page.locator('.af-start-card')).toHaveCount(0);
  expect(await page.locator('#af-rubric').inputValue()).not.toBe(before);
  // Esc closes without changing anything.
  await page.locator('.af-rubric-card [data-action="chooseRubric"]').click();
  const now = await page.locator('#af-rubric').inputValue();
  await page.keyboard.press('Escape');
  await expect(page.locator('.af-start-card')).toHaveCount(0);
  await expect(page.locator('#af-rubric')).toHaveValue(now);
});
