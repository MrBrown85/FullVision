import { test, expect } from '@playwright/test';

// Dark mode's level colours are light, so the Competencies tiles' numbers are
// dark on them (white was about 2.7:1). The colours themselves don't change.
test.use({ colorScheme: 'dark' });

test('dark mode level tiles have dark numbers on at least 4.5:1', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/\/dashboard/);
  await page.goto('/gradebook');
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  await expect(page.locator('.gb-score-val.s3').first()).toBeVisible();
  const ratios = await page.evaluate(() => {
    const lum = c => {
      const [r, g, b] = c
        .match(/\d+(\.\d+)?/g)
        .slice(0, 3)
        .map(Number)
        .map(v => {
          v /= 255;
          return v <= 0.03928 ? v / 12.92 : Math.pow((v + 0.055) / 1.055, 2.4);
        });
      return 0.2126 * r + 0.7152 * g + 0.0722 * b;
    };
    return [1, 2, 3, 4].map(n => {
      const el = document.querySelector('.gb-score-val.s' + n);
      if (!el) return null;
      const cs = getComputedStyle(el);
      const a = lum(cs.color);
      const b = lum(cs.backgroundColor);
      return Math.round(((Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05)) * 10) / 10;
    });
  });
  for (const r of ratios.filter(Boolean)) expect(r).toBeGreaterThanOrEqual(4.5);
});
