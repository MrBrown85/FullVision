import { test, expect } from '@playwright/test';

/* The student's questionnaire page (s/) on a phone, in its demo. */

// 320 px (the smallest phones) wraps "Something that is me" onto two lines.
test.use({ viewport: { width: 320, height: 700 }, isMobile: true, hasTouch: true });

test('the strengths boxes side by side line up, even when a label wraps', async ({ page }) => {
  await page.goto('/s/#demo');
  await page.locator('[data-act="start"]').click();
  const ident = page.locator('#sp-ident');
  if (await ident.count()) {
    await ident.fill('123');
    await page.locator('[data-act="start"]').click();
  }
  const boxes = page.locator('.sp-shield input');
  await expect(boxes.first()).toBeVisible();
  const tall = await page
    .locator('.sp-shield label')
    .evaluateAll(els => els.filter(l => l.getBoundingClientRect().height > 20).length);
  expect(tall).toBeGreaterThan(0);
  const tops = await boxes.evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().top)));
  for (let i = 0; i + 1 < tops.length; i += 2) expect(Math.abs(tops[i] - tops[i + 1])).toBeLessThanOrEqual(1);
});
