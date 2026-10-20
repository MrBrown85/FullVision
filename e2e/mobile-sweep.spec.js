import { test, expect } from '@playwright/test';

/* The phone's class sweep (docs/DECISIONS.md, "Observations (2026-10-18)",
   Mockup B): work down the roster with a starter and Save and next, see the
   count rise, and undo a mistake. Runs in Demo Mode on Science 8. */

async function enterDemoOnPhone(page, viewport) {
  await page.setViewportSize(viewport);
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher-mobile\//);
  await page.locator('.m-tab-item[data-tab="observe"]').click();
  await page.getByRole('button', { name: 'Start a sweep' }).click();
  await expect(page.locator('#m-screen-obs-sweep')).toBeVisible();
}

async function observedCount(page) {
  const text = await page.locator('#m-sweep-count').textContent();
  const m = text.match(/^(\d+) of (\d+) observed today$/);
  expect(m).not.toBeNull();
  return Number(m[1]);
}

test.describe('Phone class sweep', () => {
  test('saves two students with starters, counts them, and undoes the second', async ({ page }) => {
    await enterDemoOnPhone(page, { width: 375, height: 667 });
    const start = await observedCount(page);
    const panel = page.locator('#m-sweep-panel');

    const first = page.locator('.m-sweep-tile[data-state=""]').first();
    const firstSid = await first.getAttribute('data-sid');
    await first.click();
    await expect(panel.locator('.m-sweep-panel-name')).toBeVisible();
    const save = panel.getByRole('button', { name: 'Save and Next' });
    await expect(save).toBeDisabled();
    await panel.locator('.m-sweep-starter', { hasText: 'Strong collaboration with peers' }).click();
    await expect(panel.locator('.m-sweep-type.m-selected')).toHaveText('Strength');
    await save.click();

    await expect(page.locator('#m-toast')).toContainText('Saved for');
    await expect(page.locator('#m-sweep-count')).toHaveText(`${start + 1} of 27 observed today`);
    await expect(page.locator(`.m-sweep-tile[data-sid="${firstSid}"]`)).toHaveAttribute('data-state', 'done');

    // Save and next opened the next student left.
    const second = page.locator('.m-sweep-tile[aria-current="true"]');
    const secondSid = await second.getAttribute('data-sid');
    expect(secondSid).not.toBe(firstSid);
    await panel.locator('.m-sweep-starter', { hasText: 'Asked a great question in class' }).click();
    await panel.getByRole('button', { name: 'Save and Next' }).click();
    await expect(page.locator('#m-sweep-count')).toHaveText(`${start + 2} of 27 observed today`);
    const secondTile = page.locator(`.m-sweep-tile[data-sid="${secondSid}"]`);
    await expect(secondTile).toHaveAttribute('data-state', 'done');

    await page.locator('#m-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(page.locator('#m-sweep-count')).toHaveText(`${start + 1} of 27 observed today`);
    await expect(secondTile).toHaveAttribute('data-state', '');
    const left = await page.evaluate(
      sid => (JSON.parse(localStorage.getItem('gb-quick-obs-sci8') || '{}')[sid] || []).map(o => o.text),
      secondSid,
    );
    expect(left).not.toContain('Asked a great question in class');

    // Leaving the sweep refreshes the feed with the first save on top.
    await page.locator('#m-screen-obs-sweep [data-action="m-back"]').click();
    await expect(page.locator('#m-screen-obs-sweep')).toHaveCount(0);
    await expect(page.locator('#m-obs-cards .m-obs-card').first()).toContainText('Strong collaboration with peers');
  });

  test('fits a 320px screen with 44px touch targets', async ({ page }) => {
    await enterDemoOnPhone(page, { width: 320, height: 568 });
    await page.locator('.m-sweep-tile').first().click();
    await expect(page.locator('.m-sweep-panel-name')).toBeVisible();
    const fits = await page.evaluate(() => {
      const screen = document.getElementById('m-screen-obs-sweep');
      return screen.scrollWidth <= screen.clientWidth + 1;
    });
    expect(fits).toBe(true);
    const small = await page.evaluate(() =>
      [...document.querySelectorAll('#m-screen-obs-sweep button')]
        .filter(b => b.offsetParent !== null)
        .filter(b => b.getBoundingClientRect().height < 44)
        .map(b => b.textContent.trim()),
    );
    expect(small).toEqual([]);
  });
});
