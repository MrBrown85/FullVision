import { test, expect } from '@playwright/test';

/* The assessment form as cards (redesign PR 1, 2026-11-02): inside the blue
   ring, a heading and white cards for What It Is, Scoring, Competencies,
   Students and More Options. Every control keeps its id, so saving is as
   before. Demo Mode, Science 8. */

async function openForm(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await expect(page.locator('#af-title')).toBeVisible();
}

for (const [width, height] of [
  [1440, 900],
  [1366, 640],
  [1024, 768],
]) {
  test(`the form is cards and doesn't overflow at ${width}px`, async ({ page }) => {
    await page.setViewportSize({ width, height });
    await openForm(page);
    const form = page.locator('#new-assess-form');
    await expect(form.locator('.af-heading-title')).toHaveText('New Assessment');
    const titles = await form.locator('.af-card .af-card-title').allTextContents();
    expect(titles).toEqual(['Scoring', 'Competencies', 'Students', 'More Options']);
    await expect(form.locator('.af-card-what #af-title')).toBeVisible();
    // Category, Module, Date Assigned and Due Date share one row.
    const row = form.locator('.af-row-what');
    await expect(row.locator('#af-category')).toBeVisible();
    await expect(row.locator('#af-module')).toBeVisible();
    await expect(row.locator('#af-date-assigned')).toBeVisible();
    await expect(row.locator('#af-due')).toBeVisible();
    // Today's Date is gone: the Date Assigned field already says it.
    await expect(form).not.toContainText("Today's Date");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

test('More Options holds Description and Evidence Type, closed until opened', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page);
  const toggle = page.locator('.af-more-toggle');
  await expect(toggle).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('#af-desc')).toBeHidden();
  await expect(page.locator('#af-evidence')).toBeHidden();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  await expect(page.locator('#af-desc')).toBeVisible();
  await expect(page.locator('#af-evidence')).toBeVisible();
});

test('a new assessment saves its fields from the cards as before', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page);
  await page.fill('#af-title', 'Card Layout Check');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('.af-tag-cb[value="QP3"]').check();
  await page.locator('.af-more-toggle').click();
  await page.fill('#af-desc', 'A short description.');
  await page.selectOption('#af-evidence', 'video');
  await page.locator('[data-action="saveNewAssess"]').click();
  const saved = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Card Layout Check'));
  expect(saved).toBeTruthy();
  expect(saved.categoryId).toBe('sci8-cat-labs');
  expect(saved.tagIds).toEqual(['QP3']);
  expect(saved.description).toBe('A short description.');
  expect(saved.evidenceType).toBe('video');
});

test('editing opens More Options when the work has a description', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page);
  await page.fill('#af-title', 'Has a Description');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('.af-more-toggle').click();
  await page.fill('#af-desc', 'Read me.');
  await page.locator('[data-action="saveNewAssess"]').click();
  const aid = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Has a Description').id);
  await page.evaluate(id => document.querySelector('[data-action="editAssess"][data-aid="' + id + '"]').click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  await expect(page.locator('#af-desc')).toBeVisible();
  await expect(page.locator('#af-desc')).toHaveValue('Read me.');
});
