import { test, expect } from '@playwright/test';
import { openCompPicker, closeCompPicker } from './helpers.js';

/* Create and Add Another (redesign PR 11, 2026-11-02): saves, then a fresh
   form keeps Classes, Module, Scoring, Max Points, Factor and the dates; the
   title is empty and focused; the Category is not kept. Ctrl/⌘+Shift+Enter
   does the same. Demo Mode, Science 8. */
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

test('saves, then reopens keeping the shared settings', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Lab Quiz 1');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  const mod = await page.evaluate(() => {
    const o = document.querySelector('#af-module option:not([value=""])');
    return o ? o.value : '';
  });
  if (mod) await page.selectOption('#af-module', mod);
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.fill('#af-maxpoints', '20');
  await page.selectOption('#af-weight', '2');
  await page.fill('#af-date-assigned', '2026-11-03');
  await page.fill('#af-due', '2026-11-05');
  await openCompPicker(page);
  await page.locator('.af-code[data-tag="QP3"]').click();
  await closeCompPicker(page);
  await page.locator('[data-action="saveAndAddAnother"]').click();

  const made = await page.evaluate(() => getAssessments('sci8').find(a => a.title === 'Lab Quiz 1'));
  expect(made).toEqual(
    expect.objectContaining({ scoreMode: 'points', maxPoints: 20, weight: 2, dueDate: '2026-11-05' }),
  );

  await expect(page.locator('#af-title')).toBeFocused();
  await expect(page.locator('#af-title')).toHaveValue('');
  await expect(page.locator('.af-heading')).toHaveCount(0);
  await expect(page.locator('#af-scoremode')).toHaveValue('points');
  await expect(page.locator('#af-maxpoints')).toHaveValue('20');
  await expect(page.locator('#af-weight')).toHaveValue('2');
  await expect(page.locator('#af-date-assigned')).toHaveValue('2026-11-03');
  await expect(page.locator('#af-due')).toHaveValue('2026-11-05');
  if (mod) await expect(page.locator('#af-module')).toHaveValue(mod);
  await expect(page.locator('#af-category')).toHaveValue('');
  expect(await page.locator('.af-tag-cb:checked').count()).toBe(0);
});

test('Ctrl/⌘+Shift+Enter creates and adds another', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Lab Quiz 2');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.locator('#af-title').focus();
  await page.keyboard.press('ControlOrMeta+Shift+Enter');
  await expect.poll(() => page.evaluate(() => getAssessments('sci8').some(a => a.title === 'Lab Quiz 2'))).toBe(true);
  await expect(page.locator('#af-title')).toBeFocused();
  await expect(page.locator('#af-title')).toHaveValue('');
});

test('editing has no Create and Add Another', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="cancelAssessForm"]').click();
  const aid = await page.evaluate(() => getAssessments('sci8')[0].id);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('.af-heading-title')).toHaveText('Edit Assessment');
  await expect(page.locator('[data-action="saveAndAddAnother"]')).toHaveCount(0);
});

test('the reopened form keeps what was typed when the other class’s copy lands', async ({ page }) => {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => {
    COURSES.sci8b = Object.assign(structuredClone(COURSES.sci8), { id: 'sci8b', name: 'Science 8', block: 'B' });
    saveCourses(COURSES);
    window.Router.navigate('/assignments?course=sci8');
  });
  await page.locator('button', { hasText: 'New Assessment' }).first().click();
  await page.fill('#af-title', 'Lab 1');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  const b = page.locator('.af-copy-chip[data-cid="sci8b"]');
  if (!(await b.count())) test.skip(true, 'No second class chip in Demo');
  await b.click();
  await page.locator('[data-action="saveAndAddAnother"]').click();
  await page.fill('#af-title', 'Lab 2');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  // Finish the copy (its review dialog, if any).
  const ok = page.locator('.copy-review-ok, [data-copy-ok], .confirm-ok').first();
  if (await ok.isVisible().catch(() => false)) await ok.click();
  await page.waitForTimeout(500);
  await expect(page.locator('#af-title')).toHaveValue('Lab 2');
  await expect(page.locator('#af-category')).toHaveValue('sci8-cat-labs');
});

// Nov 3 sweep (step 4 group 2 #12): a data refresh that waited for the
// teacher to leave the title redrew the page as they clicked Points, and the
// next form came back blank (title, dates, Rubric scoring) with the click lost.
test('a refresh waiting on the title keeps the next form and the click', async ({ page }) => {
  await openForm(page);
  await page.fill('#af-title', 'Lab Quiz 3');
  await page.selectOption('#af-category', 'sci8-cat-labs');
  await page.fill('#af-date-assigned', '2026-10-20');
  await page.fill('#af-due', '2026-10-22');
  await page.locator('[data-action="saveAndAddAnother"]').click();
  await page.fill('#af-title', 'Lab Quiz 4');
  // A refresh lands while the title has focus: it waits for the focusout.
  await page.evaluate(() => _invalidateAndRerender());
  await page.locator('.af-scoremode-btn[data-mode="points"]').click();
  await page.waitForTimeout(100);
  await expect(page.locator('#af-title')).toHaveValue('Lab Quiz 4');
  await expect(page.locator('#af-date-assigned')).toHaveValue('2026-10-20');
  await expect(page.locator('#af-due')).toHaveValue('2026-10-22');
  await expect(page.locator('#af-scoremode')).toHaveValue('points');
});

test('a redraw keeps the Edit form as typed', async ({ page }) => {
  await openForm(page);
  await page.locator('[data-action="cancelAssessForm"]').click();
  const aid = await page.evaluate(() => getAssessments('sci8')[0].id);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await page.fill('#af-title', 'Renamed While a Refresh Lands');
  await page.evaluate(() => window.Router.getCurrentPage().render());
  await expect(page.locator('#af-title')).toHaveValue('Renamed While a Refresh Lands');
  await expect(page.locator('#af-title')).toBeFocused();
});
