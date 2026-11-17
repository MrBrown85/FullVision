/**
 * Opening an assessment card on the Assignments page leaves its title
 * exactly as it was: same size, same place (Colin, Nov 17: the title
 * growing as the card opened was distracting, and teachers already know
 * which piece it is).
 */
import { test, expect } from '@playwright/test';

test('an opened card keeps its title and header the same', async ({ page }) => {
  await page.setViewportSize({ width: 1400, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.goto('/assignments');
  await page.waitForSelector('.assess-card');
  const card = page.locator('.assess-card:not(.open)').first();
  const id = await card.getAttribute('id');
  const measure = () =>
    page.evaluate(id => {
      const c = document.getElementById(id);
      const t = c.querySelector('.assess-title');
      const r = t.getBoundingClientRect();
      const h = c.querySelector('.assess-header').getBoundingClientRect();
      return { size: getComputedStyle(t).fontSize, x: r.left - h.left, y: r.top - h.top };
    }, id);
  const closed = await measure();
  await card.locator('.assess-header').click();
  await expect(page.locator('#' + id)).toHaveClass(/open/);
  await page.waitForTimeout(400);
  const open = await measure();
  expect(open).toEqual(closed);
});
