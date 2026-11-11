import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, gotoApp } from './helpers.js';

// The confirm dialog on a phone: full width, both buttons on screen, Cancel
// and a tap on the dim both close it. (Carried over from the March phone file.)
test('the confirm dialog fits a phone and closes from Cancel or the dim', async ({ page }) => {
  await mockAuth(page);
  await seedCourse(page);
  await seedStudents(page);
  const MOBILE = { width: 375, height: 667 };
  await page.setViewportSize(MOBILE);
  await gotoApp(page, '/dashboard');
  const open = () =>
    page.evaluate(() => {
      window.showConfirm('Test', 'Are you sure?', 'Delete', 'danger', () => {});
    });

  await open();
  const card = page.locator('.confirm-card');
  await expect(card).toBeVisible();
  expect((await card.boundingBox()).width).toBeGreaterThan(300);
  const cancelBtn = page.locator('#confirm-cancel-btn');
  const okBtn = page.locator('#confirm-ok-btn');
  await expect(cancelBtn).toBeVisible();
  await expect(okBtn).toBeVisible();
  const cancelBox = await cancelBtn.boundingBox();
  const okBox = await okBtn.boundingBox();
  expect(cancelBox.y + cancelBox.height).toBeLessThan(MOBILE.height);
  expect(okBox.y + okBox.height).toBeLessThan(MOBILE.height);

  await cancelBtn.click();
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);

  await open();
  await page.locator('.confirm-overlay').click({ position: { x: 10, y: 10 } });
  await expect(page.locator('.confirm-overlay')).toHaveCount(0);
});
