import { test, expect } from '@playwright/test';

/* Competencies-view column headers in Demo Mode on Science 8: dates stay on
   one line, long titles clamp to two lines and show in full on hover or
   keyboard focus, and "Newest first" is remembered on this device. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher\/app\.html/);
}

async function openGradebook(page) {
  await page.goto('/teacher/app.html#/gradebook?course=sci8');
  await page.locator('[data-action="setView"][data-mode="detailed"]').click();
  await expect(page.locator('.gb-grid-assess-group').first()).toBeVisible();
}

const LONG_TITLE = 'Photosynthesis and Cellular Respiration Comparison Lab Report With Reflection';

test.describe('Gradebook column headers', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await enterDemo(page);
  });

  test('assessment dates sit on one line', async ({ page }) => {
    await openGradebook(page);
    const dates = page.locator('.gb-grid-assess-group .gb-assess-date');
    expect(await dates.count()).toBeGreaterThan(3);
    const lines = await dates.evaluateAll(els =>
      els.map(el => {
        const lh = parseFloat(getComputedStyle(el).lineHeight) || el.getBoundingClientRect().height;
        return { text: el.textContent, lines: Math.round(el.getBoundingClientRect().height / lh) };
      }),
    );
    for (const d of lines) {
      expect(d.text).toMatch(/^[A-Z][a-z]{2} \d{1,2}(, \d{4})?$/);
      expect(d.lines, d.text).toBe(1);
    }
  });

  test('a long title clamps to two lines and shows in full on focus and hover', async ({ page }) => {
    const aid = await page.evaluate(title => {
      const list = getAssessments('sci8');
      const a = list.find(x => !(x.tagIds || []).length || x.scoreMode === 'points') || list[0];
      a.title = title;
      saveAssessments('sci8', list);
      return a.id;
    }, LONG_TITLE);
    await openGradebook(page);
    const link = page.locator('.gb-grid-assess-group .gb-assess-title[data-href$="open=' + aid + '"]');
    await expect(link).toHaveText(LONG_TITLE);
    const box = await link.evaluate(el => ({
      clamped: el.scrollHeight > el.clientHeight + 1,
      lines: Math.round(el.clientHeight / parseFloat(getComputedStyle(el).lineHeight)),
    }));
    expect(box.clamped).toBe(true);
    expect(box.lines).toBe(2);

    const tip = page.locator('#gb-tooltip');
    await link.focus();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(LONG_TITLE);
    await link.blur();
    await expect(tip).toBeHidden();

    await link.hover();
    await expect(tip).toBeVisible();
    await expect(tip).toHaveText(LONG_TITLE);
  });

  test('Newest first puts the latest assessment first and is remembered after reload', async ({ page }) => {
    await openGradebook(page);
    const firstDate = () =>
      page.evaluate(() => {
        const a = document.querySelector('.gb-grid-assess-group .gb-assess-title');
        const id = new URL(a.dataset.href, location.href).hash.match(/open=([^&]+)/)[1];
        return getAssessments('sci8').find(x => x.id === id).date;
      });
    const dates = await page.evaluate(() =>
      getAssessments('sci8')
        .map(a => a.date || '')
        .sort(),
    );
    const toggle = page.getByRole('button', { name: 'Newest first' });
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    expect(await firstDate()).toBe(dates[0]);

    await toggle.click();
    await expect(page.getByRole('button', { name: 'Newest first' })).toHaveAttribute('aria-pressed', 'true');
    expect(await firstDate()).toBe(dates[dates.length - 1]);

    // The gradebook always opens on Scores (#305); Newest first is what is remembered.
    await page.reload();
    await page.locator('[data-action="setView"][data-mode="detailed"]').click();
    await expect(page.locator('.gb-grid-assess-group').first()).toBeVisible();
    await expect(page.getByRole('button', { name: 'Newest first' })).toHaveAttribute('aria-pressed', 'true');
    expect(await firstDate()).toBe(dates[dates.length - 1]);
  });
});
