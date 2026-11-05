import { test, expect } from '@playwright/test';
import { openCompPicker, closeCompPicker } from './helpers.js';

// These tests use the Codes chips; List is the default since Nov 2.
test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('fv-assess-comp-view', 'codes'));
});

/* The assessment form as cards (redesign PR 1, 2026-11-02): inside the blue
   ring, a heading and white cards for What It Is, Scoring, Competencies,
   Students and More Options (Evidence Type; Description sits under the
   title since Nov 2). Every control keeps its id, so saving is as
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
    // No heading on a new assessment (Nov 2): the form is plainly that.
    await expect(form.locator('.af-heading')).toHaveCount(0);
    const titles = await form.locator('.af-card .af-card-title').allTextContents();
    // Competencies above Scoring; no More Options (Colin, Nov 4).
    expect(titles).toEqual(['Competencies', 'Scoring', 'Students']);
    await expect(form.locator('.af-card-what #af-title')).toBeVisible();
    // Category, Evidence Type, Module, Date Assigned and Due Date share one row.
    const row = form.locator('.af-row-what');
    await expect(row.locator('#af-category')).toBeVisible();
    await expect(row.locator('#af-evidence')).toBeVisible();
    await expect(row.locator('#af-module')).toBeVisible();
    await expect(row.locator('#af-date-assigned')).toBeVisible();
    await expect(row.locator('#af-due')).toBeVisible();
    // Today's Date is gone: the Date Assigned field already says it.
    await expect(form).not.toContainText("Today's Date");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth > window.innerWidth);
    expect(overflow).toBe(false);
  });
}

test('Description sits under the title; Evidence Type sits beside Category', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page);
  // Under the title, in What It Is (teachers preferred it there, Nov 2).
  await expect(page.locator('.af-card-what #af-desc')).toBeVisible();
  const [t, d] = await Promise.all([page.locator('#af-title').boundingBox(), page.locator('#af-desc').boundingBox()]);
  expect(d.y).toBeGreaterThan(t.y);
  expect(d.y - (t.y + t.height)).toBeLessThan(60);
  // Evidence Type is back where it was before More Options (Colin, Nov 4).
  await expect(page.locator('.af-more-toggle, .af-card-more')).toHaveCount(0);
  const [c, e] = await Promise.all([
    page.locator('#af-category').boundingBox(),
    page.locator('#af-evidence').boundingBox(),
  ]);
  expect(Math.abs(e.y - c.y)).toBeLessThan(2);
  expect(e.x).toBeGreaterThan(c.x + c.width);
});

test('a new assessment saves its fields from the cards as before', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page);
  await page.fill('#af-title', 'Card Layout Check');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await openCompPicker(page);
  await page.locator('.af-code[data-tag=\"QP3\"]').click();
  await closeCompPicker(page);
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

test('editing shows the description under the title', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await openForm(page);
  await page.fill('#af-title', 'Has a Description');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.fill('#af-desc', 'Read me.');
  await page.locator('[data-action="saveNewAssess"]').click();
  const aid = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Has a Description').id);
  await page.evaluate(id => document.querySelector('[data-action="editAssess"][data-aid="' + id + '"]').click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  await expect(page.locator('#af-desc')).toBeVisible();
  await expect(page.locator('#af-desc')).toHaveValue('Read me.');
});
