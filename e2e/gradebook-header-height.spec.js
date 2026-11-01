import { test, expect } from '@playwright/test';
import { mockAuth, seedCourse, seedStudents, seedAssessments, gotoApp, TEST_ASSESSMENT } from './helpers.js';

// The slanted Scores header is just tall enough for its titles, and a height
// the teacher drags to is kept.

test.describe('Scores header height', () => {
  test('fits short titles and keeps a dragged height', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page, [{ ...TEST_ASSESSMENT, title: 'Quiz 1' }]);
    await gotoApp(page, '/gradebook');
    const height = () => page.evaluate(() => document.querySelector('.gb-grid-colhead').getBoundingClientRect().height);
    expect(await height()).toBeLessThan(150);

    const handle = await page.locator('.gb-header-resize-handle').boundingBox();
    await page.mouse.move(handle.x + 200, handle.y + 3);
    await page.mouse.down();
    await page.mouse.move(handle.x + 200, handle.y + 63);
    await page.mouse.up();
    const dragged = await height();
    await page.reload();
    await expect(page.locator('.gb-grid-colhead').first()).toBeVisible();
    expect(await height()).toBe(dragged);
  });
});
