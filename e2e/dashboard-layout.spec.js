/**
 * The class dashboard's boxes outside the middle row: the top bar's Missing
 * and Late opens the gradebook, pointing at a competency lights its chip on
 * the student cards, and a card's flag. The middle row itself (its height,
 * its two thirds and one third, every box 12 px from the next, stacking
 * under 900 px) is e2e/dashboard-row.spec.js since D9, when the two
 * competency cards side by side at one height went. Demo Mode, Science 8.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-comp-tile .dash-comp-card').waitFor();
}

// Draws a pair of views without the menu (the menu is tested elsewhere).
async function showViews(page, comp, core) {
  await page.evaluate(
    ([comp, core]) => {
      localStorage.setItem('fv-dash-comp-view:sci8', comp);
      localStorage.setItem('fv-dash-core-view:sci8', core);
      PageDashboard.render();
    },
    [comp, core],
  );
  await expect(page.locator('.dash-comp-card')).toHaveAttribute('data-view', comp);
}

test('Missing and Late opens the gradebook', async ({ page }) => {
  await openDashboard(page);
  // Something missing (new work with no score), so the cell is a link.
  await page.evaluate(() => {
    const today = getTodayStr();
    saveAssessments(
      'sci8',
      getAssessments('sci8').concat([{ id: 'zz-missing', title: 'Late Lab', date: today, dueDate: today, tagIds: [] }]),
    );
    const st = getStudents('sci8')[0];
    const statuses = Object.assign({}, getAssignmentStatuses('sci8'));
    statuses[st.id + ':zz-missing'] = 'NS';
    saveAssignmentStatuses('sci8', statuses);
    PageDashboard.render();
  });
  const cell = page.locator('.dash-glance-missing');
  await expect(cell).toHaveAttribute('data-href', '/gradebook?course=sci8');
  await cell.click();
  await expect(page).toHaveURL(/\/gradebook\?course=sci8/);
});

test('pointing at a competency lights its chip on every student card, and only then', async ({ page }) => {
  await openDashboard(page);
  await showViews(page, 'avg', 'self');
  const row = page.locator('.dash-comp-card .dash-comp-row').nth(1);
  const key = await row.getAttribute('data-key');
  const cards = await page.locator('.dash-grid > .dash-card').count();
  const lit = page.locator('.dash-grid .dash-card-seg.is-lit');
  await row.hover();
  await expect(lit).toHaveCount(cards);
  expect(await lit.evaluateAll(els => els.every(el => el.dataset.key))).toBe(true);
  expect(new Set(await lit.evaluateAll(els => els.map(el => el.dataset.key)))).toEqual(new Set([key]));
  // An outline only: no card re-sorted, no chip faded.
  await expect(page.locator('.dash-card-strip.has-focus')).toHaveCount(0);
  await page.locator('.dash-students-title').hover();
  await expect(lit).toHaveCount(0);
  // With the competency filter set, pointing lights nothing.
  await row.click();
  await expect(page.locator('.dash-comp-chip')).toBeVisible();
  await page.locator('.dash-comp-card .dash-comp-row').nth(2).hover();
  await expect(lit).toHaveCount(0);
});

test("the flag at a student card's foot is 22px wide and flips to Unflag", async ({ page }) => {
  await openDashboard(page);
  const card = page.locator('.dash-grid > .dash-card').first();
  const flag = card.locator('.dash-card-footer > .dash-flag-btn');
  const box = await flag.boundingBox();
  expect(Math.round(box.width)).toBe(22);
  await flag.click();
  await expect(card.locator('.dash-card-footer > .dash-flag-btn')).toHaveAttribute('aria-label', 'Unflag student');
});
