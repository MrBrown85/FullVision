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

test('from the Home Screen the page does not bounce', async ({ page }) => {
  await page.goto('/s/');
  const rule = await page.evaluate(() => {
    for (const sheet of document.styleSheets) {
      let rules;
      try {
        rules = sheet.cssRules;
      } catch {
        continue;
      }
      for (const r of rules) {
        if (r instanceof CSSMediaRule && /display-mode:\s*standalone/.test(r.conditionText)) {
          for (const inner of r.cssRules) if (inner.selectorText === 'html') return inner.style.overscrollBehavior;
        }
      }
    }
    return null;
  });
  expect(rule).toBe('none');
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
