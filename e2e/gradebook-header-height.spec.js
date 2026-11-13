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

  // The height is worked out from the titles' text before the draw is
  // written: it must be what measuring each drawn title gives.
  test('a redraw sizes the header as measuring the titles on the page does', async ({ page }) => {
    await mockAuth(page);
    await seedCourse(page);
    await seedStudents(page);
    await seedAssessments(page, [
      { ...TEST_ASSESSMENT, title: 'Quiz 1' },
      { ...TEST_ASSESSMENT, id: 'a-long', title: 'Ecosystems and Energy Flow Lab' },
    ]);
    await gotoApp(page, '/gradebook');
    const height = () => page.evaluate(() => document.querySelector('.gb-grid-colhead').getBoundingClientRect().height);
    const measured = () =>
      page.evaluate(() => {
        const ctx = document.createElement('canvas').getContext('2d');
        let widest = 0;
        document
          .querySelectorAll('#gb-colheads .gb-scores-assess-name, #gb-colheads .gb-scores-assess-meta')
          .forEach(el => {
            const cs = getComputedStyle(el);
            ctx.font = cs.fontWeight + ' ' + cs.fontSize + ' ' + cs.fontFamily;
            widest = Math.max(widest, ctx.measureText(el.textContent).width);
          });
        return Math.max(100, Math.min(170, Math.ceil((widest + 48) / Math.SQRT2)));
      });
    const want = await measured();
    expect(want).toBeGreaterThan(100);
    expect(await height()).toBe(want);
    // Competencies and back: the Scores header drawn again.
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await page.locator('[data-action="setView"][data-mode="scores"]').click();
    await expect(page.locator('.gb-grid-colhead').first()).toBeVisible();
    expect(await height()).toBe(want);
  });
});
