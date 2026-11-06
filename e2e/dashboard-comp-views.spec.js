/**
 * The Curricular Competencies card's views and the page's competency filter
 * (docs/plans/dashboard-cards-plan.md, part B). Demo Mode, Science 8 (a
 * Proficiency class, so it opens on Level Mix).
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 } });

async function openDashboard(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.locator('.dash-comp-card .dash-comp-row').first().waitFor();
}

// Each card's value on a column, in the order the cards are drawn (0 when
// not assessed yet).
function cardValues(page, key) {
  return page.evaluate(k => {
    const col = DashInsights.columns('sci8').find(c => c.key === k);
    return Array.from(document.querySelectorAll('.dash-grid > .dash-card[data-sid]')).map(el => {
      const sid = el.getAttribute('data-sid');
      return col.which.groupId
        ? getGroupProficiency('sci8', sid, col.which.groupId)
        : getSectionProficiency('sci8', sid, col.which.sectionId);
    });
  }, key);
}

test('the view menu works from the keyboard and the pick is remembered', async ({ page }) => {
  await openDashboard(page);
  const pill = page.locator('#dash-view-btn-comp');
  const menu = page.locator('#dash-view-menu-comp');
  await expect(pill).toHaveText('Level Mix');
  await pill.focus();
  await page.keyboard.press('ArrowDown');
  await expect(menu).toBeVisible();
  await expect(page.locator('#dash-view-menu-comp [aria-checked="true"]')).toBeFocused();
  await page.keyboard.press('Home');
  await page.keyboard.press('Enter');
  await expect(pill).toHaveText('Class Average');
  await expect(pill).toBeFocused();
  await expect(page.locator('.dash-comp-card .dash-outcome-bar-fill').first()).toBeVisible();

  // Back to Level Mix with the keyboard.
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('ArrowDown');
  await page.keyboard.press('Enter');
  await expect(pill).toHaveText('Level Mix');
  await expect(page.locator('.dash-comp-card .dash-comp-cell').first()).toBeVisible();
  expect(await page.evaluate(() => localStorage.getItem('fv-dash-comp-view:sci8'))).toBe('mix');
});

// Science 8 has six folders: every view draws six rows (Needs Support: the
// students, which are more), so beside Core Competencies the card is the
// same height in each.
test('every view keeps the card one height', async ({ page }) => {
  await openDashboard(page);
  const heights = [];
  for (const view of ['avg', 'mix', 'below', 'trend']) {
    await page.locator('#dash-view-btn-comp').click();
    await page.locator(`#dash-view-menu-comp [data-view="${view}"]`).click();
    await expect(page.locator('.dash-comp-card')).toHaveAttribute('data-view', view);
    heights.push(Math.round((await page.locator('.dash-comp-card').boundingBox()).height));
  }
  expect(new Set(heights).size).toBe(1);
});

test('a row filters the page: the chip, the weakest first, the focused chips; × clears it', async ({ page }) => {
  await openDashboard(page);
  const row = page.locator('.dash-comp-card .dash-comp-pick').nth(2);
  const key = await row.getAttribute('data-key');
  const label = (await row.textContent()).trim();
  await row.click();
  await expect(row).toHaveAttribute('aria-pressed', 'true');

  const bar = page.locator('.dash-comp-filter');
  await expect(bar.locator('.dash-comp-chip')).toHaveText(label + '×');
  await expect(bar).toContainText('Weakest first');
  await expect(bar.locator('.dash-comp-record')).toHaveText(/^Record an Observation for the \d+ Below$/);
  await expect(bar.locator('.dash-comp-gb')).toHaveText('View ' + label + ' in Gradebook →');

  // Weakest first, the not-yet-assessed last.
  const vals = await cardValues(page, key);
  const scored = vals.filter(v => v > 0);
  expect(scored).toEqual([...scored].sort((a, b) => a - b));
  expect(vals.slice(0, scored.length).every(v => v > 0)).toBe(true);
  // Every card outlines the picked competency's chip.
  const cards = await page.locator('.dash-grid > .dash-card').count();
  await expect(page.locator(`.dash-card-seg.is-focus[data-key="${key}"]`)).toHaveCount(cards);

  // "Record an Observation" opens the capture with those students picked.
  const n = Number((await bar.locator('.dash-comp-record').textContent()).match(/\d+/)[0]);
  await bar.locator('.dash-comp-record').click();
  await expect(page.locator('.obsc-dialog .obsc-chip-student')).toHaveCount(n);
  await page.keyboard.press('Escape');
  await expect(page.locator('.obsc-dialog')).toHaveCount(0);

  await bar.locator('.dash-comp-chip').click();
  await expect(page.locator('.dash-comp-filter')).toHaveCount(0);
  await expect(page.locator('.dash-card-seg.is-focus')).toHaveCount(0);
  await expect(page.locator('.dash-comp-card .dash-comp-pick').nth(2)).toHaveAttribute('aria-pressed', 'false');
});

test('Escape clears the filter', async ({ page }) => {
  await openDashboard(page);
  await page.locator('.dash-comp-card .dash-comp-pick').first().click();
  await expect(page.locator('.dash-comp-filter')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.locator('.dash-comp-filter')).toHaveCount(0);
});

test('nothing slides when less motion is asked for', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await openDashboard(page);
  await page.locator('.dash-comp-card .dash-comp-pick').first().click();
  await expect(page.locator('.dash-comp-filter')).toBeVisible();
  await expect(page.locator('.dash-card.is-sliding')).toHaveCount(0);
  const t = await page
    .locator('.dash-card')
    .first()
    .evaluate(el => getComputedStyle(el).transitionDuration);
  // The app's own rule (styles.css) leaves at most 0.01ms.
  expect(t.split(',').every(d => parseFloat(d) * (d.trim().endsWith('ms') ? 1 : 1000) <= 0.01)).toBe(true);
});
