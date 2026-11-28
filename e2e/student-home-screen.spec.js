import { test, expect } from '@playwright/test';
import { PHONE } from './student-card-fake.js';

/* The student page added to the Home Screen opens as an app (its own
   manifest, scoped to /s/, starting at /s/ without a card's code), and its
   header and bottom tabs stay on the screen's edges while the page scrolls.
   In Home Screen mode the page itself does not bounce. Playwright cannot
   open a page in Home Screen mode, so that rule is checked in the CSS. */

test.use(PHONE);

async function demo(page) {
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.locator('.sp-view .sp-tabs').locator('visible=true')).toBeVisible();
}

test('the page has a Home Screen manifest of its own', async ({ page, request }) => {
  await page.goto('/s/');
  await expect(page.locator('meta[name="apple-mobile-web-app-capable"]')).toHaveAttribute('content', 'yes');
  const href = await page.locator('link[rel="manifest"]').getAttribute('href');
  const res = await request.get(new URL(href, page.url()).toString());
  const m = await res.json();
  expect(m.display).toBe('standalone');
  expect(m.start_url).toBe('/s/');
  expect(m.scope).toBe('/s/');
});

test('the page does not bounce, in Safari or from the Home Screen', async ({ page }) => {
  await page.goto('/s/');
  // Apps don't bounce (Colin, Nov 27 2026): the rule is on the page itself, not only in Home Screen mode.
  const html = await page.evaluate(() => getComputedStyle(document.documentElement).overscrollBehaviorY);
  const body = await page.evaluate(() => getComputedStyle(document.body).overscrollBehaviorY);
  expect(html).toBe('none');
  expect(body).toBe('none');
});

test('the header and the tabs stay on the edges while the page scrolls', async ({ page }) => {
  await demo(page);
  await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
  // Enough to scroll, whatever the sample class has.
  await page.evaluate(() => {
    const pad = document.createElement('div');
    pad.style.height = '2000px';
    const tabs = [...document.querySelectorAll('.sp-view .sp-tabs')].find(t => t.offsetParent);
    tabs.parentNode.insertBefore(pad, tabs);
  });
  for (const y of [0, 600, 1400]) {
    await page.evaluate(top => window.scrollTo(0, top), y);
    const edges = await page.evaluate(() => {
      const head = document.querySelector('.sp-view .sp-head').getBoundingClientRect();
      const tabs = [...document.querySelectorAll('.sp-view .sp-tabs')]
        .find(t => t.offsetParent)
        .getBoundingClientRect();
      return { head: head.top, tabs: Math.round(tabs.bottom), h: window.innerHeight };
    });
    expect(edges.head).toBe(0);
    expect(edges.tabs).toBe(edges.h);
  }
});

const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function asIphone(page, standalone) {
  await page.addInitScript(
    ([ua, st]) => {
      Object.defineProperty(navigator, 'userAgent', { get: () => ua });
      Object.defineProperty(navigator, 'standalone', { get: () => st });
    },
    [IPHONE_UA, standalone],
  );
}

test('the Add to Home Screen card shows on the sign-in screen until Not Now', async ({ page }) => {
  await asIphone(page, false);
  await page.goto('/s/');
  const card = page.locator('.sp-a2hs');
  await expect(card).toBeVisible();
  await expect(card).toContainText('Add FullVision to Your Home Screen');
  await page.getByRole('button', { name: 'Not Now' }).click();
  await expect(card).toHaveCount(0);
  await page.reload();
  await expect(page.locator('main.sp-main-center')).toBeVisible();
  await expect(card).toHaveCount(0);
});

test('the card shows once more after sign-in, with its one line', async ({ page }) => {
  await asIphone(page, false);
  await demo(page);
  await expect(page.locator('.sp-a2hs')).toContainText('You\u2019ll sign in once in the app.');
});

test('opened from the Home Screen the card never shows', async ({ page }) => {
  await asIphone(page, true);
  await page.goto('/s/');
  await expect(page.locator('main.sp-main-center')).toBeVisible();
  await expect(page.locator('.sp-a2hs')).toHaveCount(0);
});
