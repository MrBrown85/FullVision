import { test, expect } from '@playwright/test';
import { openCompPicker, closeCompPicker } from './helpers.js';

/* The assessment form's hover-overs (redesign PR 13, 2026-11-02): a
   chosen competency, a Codes folder, the rubric, the Factor and a Core
   Competency, in the shared #gb-tooltip, on hover and on keyboard focus
   (over the field then, so the next one stays in view). Category, Date
   Assigned and List rows have none since Nov 2. Demo Mode, Science 8. */
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
const tip = page => page.locator('#gb-tooltip');

test('a chosen competency: wording, I Can, source and how often it has been scored', async ({ page }) => {
  await openForm(page);
  await openCompPicker(page);
  await page.locator('.af-code[data-tag="QP3"]').click();
  await closeCompPicker(page);
  const want = await page.evaluate(() => {
    const t = getTagById('sci8', 'QP3');
    const n = getAssessments('sci8').filter(a => (a.tagIds || []).includes('QP3')).length;
    return { text: t.text, ican: t.i_can_statements[0], n };
  });
  await page.locator('#af-comp-chosen .af-comp-chip[data-tag="QP3"]').hover();
  await expect(tip(page)).toBeVisible();
  await expect(tip(page)).toContainText(want.text);
  await expect(tip(page)).toContainText(want.ican);
  await expect(tip(page)).toContainText(`Scored on ${want.n} assessment`);
  await page.mouse.move(5, 5);
  await expect(tip(page)).toBeHidden();
});

test('a folder lists each competency with its count', async ({ page }) => {
  await openForm(page);
  await openCompPicker(page);
  const group = page.locator('.af-codes-group-name').first();
  const ids = (await group.getAttribute('data-tags')).split(',');
  await group.hover();
  await expect(tip(page).locator('.gb-tip-row')).toHaveCount(ids.length);
  await expect(tip(page)).toContainText('How many assessments have scored each one so far this year.');
});

test('Category and Date Assigned have no hover-over', async ({ page }) => {
  await openForm(page);
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('#af-category').hover();
  await page.waitForTimeout(800);
  await expect(tip(page)).toBeHidden();
  await page.locator('#af-date-assigned').hover();
  await page.waitForTimeout(800);
  await expect(tip(page)).toBeHidden();
  // The category's hint stays as it was.
  await expect(page.locator('#af-category')).toHaveAttribute('aria-describedby', 'af-category-hint');
});

test('Factor says what the multiplier does', async ({ page }) => {
  await openForm(page);
  await page.locator('#af-weight').hover();
  await expect(tip(page)).toContainText('Factor 1\u00d7');
  await expect(tip(page)).toContainText('Counts once toward each competency it scores');
});

test('a Core Competency shows the Ministry’s description and how often it is tagged', async ({ page }) => {
  await openForm(page);
  await page.locator('.af-cc-chip[data-cc="COL"]').hover();
  await expect(tip(page)).toContainText(
    'Collaborating involves the skills, strategies, and dispositions that people use to work together to pursue common purposes and accomplish common goals.',
  );
  await expect(tip(page)).toContainText(/Communication · tagged on \d+ of \d+ assessments/);
});

test('the rubric lists its criteria and how often it is used', async ({ page }) => {
  await openForm(page);
  const r = await page.evaluate(() => {
    const x = getRubrics('sci8')[0];
    return { id: x.id, name: x.name, n: x.criteria.length };
  });
  await page.locator('[data-action="chooseRubric"]').first().click();
  await page.locator(`#af-rubric-view .af-start-row[data-rid="${r.id}"]`).click();
  await page.locator('#af-rubric-view [data-action="startPickUse"]').click();
  await page.locator('.af-rubric-card-name').first().hover();
  await expect(tip(page).locator('.gb-tip-head')).toContainText(r.name);
  await expect(tip(page).locator('.gb-tip-row')).toHaveCount(r.n);
});

test('a field focused below the fold keeps its tip as the page scrolls to it', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 560 });
  await openForm(page);
  await page.evaluate(() => window.scrollTo(0, 0));
  await page.locator('#af-weight').focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(page.locator('#af-weight')).toBeFocused();
  await page.waitForTimeout(300);
  await expect(tip(page)).toBeVisible();
  await expect(tip(page)).toContainText('Factor 1\u00d7');
});

test('a hover waits for a pause; passing over a field shows nothing', async ({ page }) => {
  await openForm(page);
  await page.locator('#af-weight').hover();
  await page.waitForTimeout(150);
  await expect(tip(page)).toBeHidden();
  await expect(tip(page)).toBeVisible();
  // Passing over Core Competencies on the way somewhere else.
  await page.mouse.move(5, 5);
  await page.locator('.af-cc-chip[data-cc="COL"]').hover();
  await page.mouse.move(5, 5);
  await page.waitForTimeout(700);
  await expect(tip(page)).toBeHidden();
});
