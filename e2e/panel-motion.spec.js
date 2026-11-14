/**
 * The student list and the Help panel slide (by transform) when their buttons
 * are pressed, and the page beside them takes its new width at once, as the
 * slide starts. They end fully open or fully closed, even when pressed again
 * mid-slide. With reduced motion there is no
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
    // Every frame of the slide, from the press: some frame has the list
    // part-way out (its transform), with the page already at its new width.
    // (A fixed wait missed the middle on a busy machine.)
    const frames = page.evaluate(
      () =>
        new Promise(resolve => {
          const out = [];
          const start = performance.now();
          const tick = () => {
            out.push([
              document.getElementById('gb-sidebar').getBoundingClientRect().left,
              document.querySelector('.page-main').getBoundingClientRect().width,
              getComputedStyle(document.querySelector('.assess-course-select')).display !== 'none',
            ]);
            if (performance.now() - start < 600) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.click('[data-action="toggleSidebar"]');
    const mid = (await frames).filter(([left]) => left > -full && left < 0);
    expect(mid.length).toBeGreaterThan(0);
    expect(mid.every(([, m]) => m > mainFull)).toBe(true);
    // The page does not resize frame by frame: one width the whole slide.
    expect(new Set(mid.map(([, m]) => Math.round(m))).size).toBe(1);
    // The toolbar's own class picker waits until the list is gone.
    expect(mid.some(([, , picker]) => picker)).toBe(false);
    await expect.poll(() => sidebarWidth(page)).toBe(0);
    await expect(page.locator('#page-layout')).not.toHaveClass(/sidebar-sliding/);
    await expect(page.locator('.assess-course-select')).toBeVisible();
    await expect(page.locator('#gb-sidebar')).toBeHidden();
    await page.click('[data-action="toggleSidebar"]');
    await expect.poll(() => sidebarWidth(page)).toBe(full);
    await expect(page.locator('#gb-sidebar')).toBeVisible();
    await expect(page.locator('#sidebar-mount')).not.toHaveAttribute('style', /width/);
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
    // Every frame of the slide, from the press: some frame is part-way in.
    // (A fixed wait missed the middle on a busy machine.)
    const frames = page.evaluate(
      () =>
        new Promise(resolve => {
          const out = [];
          const start = performance.now();
          const tick = () => {
            const p = document.getElementById('help-panel');
            out.push(p ? p.getBoundingClientRect().left : -1);
            if (performance.now() - start < 600) requestAnimationFrame(tick);
            else resolve(out);
          };
          requestAnimationFrame(tick);
        }),
    );
    await page.click('[data-action="toggleHelp"]');
    const vw = await page.evaluate(() => document.documentElement.clientWidth);
    expect((await frames).some(l => l > vw - 400 && l < vw)).toBe(true);
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

test.describe('closing', () => {
  test.use({ reducedMotion: 'no-preference' });

  // Dialogs and menus close at once, with nothing left fading in the page
  // (Colin, Nov 11: "Close instantly").
  test('a dialog closes at once, even with motion on', async ({ page }) => {
    await openDemo(page);
    await page.evaluate(() => window.showConfirm('Delete?', 'Sure?', 'Delete', 'danger', () => {}));
    await expect(page.locator('.confirm-overlay')).toHaveCount(1);
    await page.keyboard.press('Escape');
    expect(await page.locator('.confirm-overlay').count()).toBe(0);
  });
});
