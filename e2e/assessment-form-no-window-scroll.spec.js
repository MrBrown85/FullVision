import { test, expect } from '@playwright/test';

/* Nov 13: the new-assessment form left a grey band under the page. The
   form's hidden Rubric label (.af-visually-hidden) sat ~1000px down the
   page layout, so the window itself could scroll; focusing the title on
   open scrolled it, and the app (built to fill the window) slid up off a
   blank strip. The window never scrolls: only the page's own area does. */

for (const height of [650, 900]) {
  test(`opening New Assessment leaves the window where it is (${height}px tall)`, async ({ page }) => {
    await page.setViewportSize({ width: 1000, height });
    await page.goto('/login.html?demo=1');
    await page.waitForURL(/\/dashboard/, { timeout: 15000 });
    await page.waitForFunction(() => getAssessments('sci8').length > 0);
    await page.evaluate(() => window.Router.navigate('/assignments?course=sci8'));
    await expect(page.locator('.assess-card').first()).toBeVisible();
    await page.getByRole('button', { name: /New Assessment/ }).click();
    await expect(page.locator('#af-title')).toBeFocused();
    const win = await page.evaluate(() => {
      const se = document.scrollingElement;
      return { top: se.scrollTop, tall: se.scrollHeight, view: se.clientHeight };
    });
    expect(win.top).toBe(0);
    expect(win.tall).toBeLessThanOrEqual(win.view);
    // The form's footer sits at the foot of the window, with nothing under it.
    const gap = await page.evaluate(() => {
      const main = document.getElementById('main').getBoundingClientRect();
      return Math.round(window.innerHeight - main.bottom);
    });
    expect(gap).toBe(0);
  });
}
