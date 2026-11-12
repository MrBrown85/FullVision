/**
 * The student list and the Help panel slide when their buttons are pressed,
 * and the page beside them resizes with them. They end fully open or fully
 * closed, even when pressed again mid-slide. With reduced motion there is no
 * slide: the change is complete at once.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1440, height: 900 }, serviceWorkers: 'block' });

async function openDemo(page) {
  await page.route('**/help/index.json', r => r.fulfill({ contentType: 'application/json', body: '[]' }));
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.evaluate(() => window.Router.navigate('/assignments'));
  await page.locator('#gb-sidebar').waitFor();
}
const sidebarWidth = page =>
  page.evaluate(() => document.getElementById('sidebar-mount').getBoundingClientRect().width);
const helpWidth = page =>
  page.evaluate(() => {
    const p = document.getElementById('help-panel');
    return p ? p.getBoundingClientRect().width : 0;
  });
const mainWidth = page => page.evaluate(() => document.querySelector('.page-main').getBoundingClientRect().width);

test.describe('with motion', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('the student list slides, the page follows, and it ends fully shut and fully open', async ({ page }) => {
    await openDemo(page);
    const full = await sidebarWidth(page);
    const mainFull = await mainWidth(page);
    expect(full).toBeGreaterThan(100);
    await page.click('[data-action="toggleSidebar"]');
    // Mid-slide: between open and shut, and the page is between its two widths.
    await page.waitForTimeout(60);
    const mid = await sidebarWidth(page);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(full);
    const mainMid = await mainWidth(page);
    expect(mainMid).toBeGreaterThan(mainFull);
    // The toolbar's own class picker waits until the list is gone.
    await expect(page.locator('.assess-course-select')).toBeHidden();
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect(page.locator('#page-layout')).not.toHaveClass(/sidebar-sliding/);
    await expect(page.locator('.assess-course-select')).toBeVisible();
    await expect(page.locator('#gb-sidebar')).toBeHidden();
    await page.click('[data-action="toggleSidebar"]');
    await expect.poll(() => sidebarWidth(page)).toBe(full);
    await expect(page.locator('#gb-sidebar')).toBeVisible();
    await expect(page.locator('#sidebar-mount')).toHaveAttribute('style', /^$|^(?!.*width)/);
    // Pressed again and again, quickly: it still settles on the last press.
    for (let i = 0; i < 5; i++) {
      await page.click('[data-action="toggleSidebar"]');
      await page.waitForTimeout(70);
    }
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect.poll(() => mainWidth(page)).toBeGreaterThan(mainFull);
  });

  test('the Help panel slides in and out and ends fully open or gone', async ({ page }) => {
    await openDemo(page);
    const mainFull = await mainWidth(page);
    await page.click('[data-action="toggleHelp"]');
    await page.waitForTimeout(60);
    const mid = await helpWidth(page);
    expect(mid).toBeGreaterThan(0);
    expect(mid).toBeLessThan(400);
    await expect.poll(() => helpWidth(page)).toBe(400);
    await expect(page.locator('#help-panel')).not.toHaveClass(/help-sliding/);
    expect(await mainWidth(page)).toBeCloseTo(mainFull - 400, 0);
    await page.click('[data-action="toggleHelp"]');
    await expect(page.locator('#help-panel')).toHaveCount(0);
    expect(await mainWidth(page)).toBeCloseTo(mainFull, 0);
    // Quick presses, ending on open then on closed.
    for (let i = 0; i < 3; i++) {
      await page.click('[data-action="toggleHelp"]');
      await page.waitForTimeout(80);
    }
    await expect.poll(() => helpWidth(page)).toBe(400);
    await page.click('[data-action="toggleHelp"]');
    await expect(page.locator('#help-panel')).toHaveCount(0);
  });
});

test.describe('with reduced motion', () => {
  test.use({ reducedMotion: 'reduce' });

  test('both panels change at once', async ({ page }) => {
    await openDemo(page);
    const full = await sidebarWidth(page);
    await page.click('[data-action="toggleSidebar"]');
    expect(await sidebarWidth(page)).toBe(0);
    await page.click('[data-action="toggleSidebar"]');
    expect(await sidebarWidth(page)).toBe(full);
    await page.click('[data-action="toggleHelp"]');
    expect(await helpWidth(page)).toBe(400);
    await page.click('[data-action="toggleHelp"]');
    await expect(page.locator('#help-panel')).toHaveCount(0);
  });
});

test.describe('quick exits', () => {
  test.use({ reducedMotion: 'no-preference' });

  test('a dialog leaves at once and its copy fades away', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => window.showConfirm('Delete?', 'Sure?', 'Delete', 'danger', () => {}));
    await expect(page.locator('.confirm-overlay')).toHaveCount(1);
    await page.keyboard.press('Escape');
    // The real dialog is gone now; only a see-through copy is left.
    expect(await page.locator('.confirm-overlay:not(.fv-leaving)').count()).toBe(0);
    await expect(page.locator('.confirm-overlay')).toHaveCount(0);
  });
});
