import { test, expect } from '@playwright/test';

/* The student page's one Evidence panel (docs/DECISIONS.md, "Observations
   (2026-10-18)"): a timeline strip, the capture strip with the student
   fixed, tabs with counts, and the Observations page's cards. Runs in Demo
   Mode on Mei Wong (st23) in Science 8. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher\/app\.html/);
}

async function meiObs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('gb-quick-obs-sci8') || '{}').st23 || []);
}

test.describe('Student page Evidence panel', () => {
  test('shows tabs with counts, adds through the strip, and deletes with Undo', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/teacher/app.html#/student?id=st23&course=sci8');

    const panel = page.locator('#ev-panel');
    await expect(panel.getByRole('heading', { name: 'Evidence' })).toBeVisible();
    await expect(page.getByText('Assignment Feedback')).toHaveCount(0);
    await expect(page.getByText('Notes & Observations')).toHaveCount(0);

    const start = (await meiObs(page)).length;
    expect(start).toBeGreaterThan(0);
    const tabs = panel.getByRole('tab');
    await expect(tabs).toHaveText([
      new RegExp('^All ' + start + '$'),
      /^By competency \d+$/,
      /^Assessments \d+$/,
      /^Concerns \d+$/,
    ]);
    await expect(panel.locator('#ev-list .obs-card')).toHaveCount(start);
    await expect(panel.locator('.ev-tl-mark')).toHaveCount(start);

    // Concerns tab lists only concerns.
    await panel.getByRole('tab', { name: /^Concerns/ }).click();
    const concerns = await panel.locator('#ev-list .obs-card').count();
    await expect(panel.locator('#ev-list .obs-card:not([data-sentiment="concern"])')).toHaveCount(0);
    expect(concerns).toBeLessThan(start);

    // Add one through the strip; it leads the All tab and joins the timeline.
    await panel.getByRole('tab', { name: /^All/ }).click();
    const input = panel.locator('#note-capture-input');
    await input.click();
    await input.fill('Explained her poster to a visitor without notes');
    await page.keyboard.press('Enter');
    await expect(panel.getByRole('tab', { name: /^All/ })).toHaveText('All ' + (start + 1));
    const first = panel.locator('#ev-list .obs-card').first();
    await expect(first).toContainText('Explained her poster to a visitor without notes');
    const newId = await first.getAttribute('data-obid');
    const mark = panel.locator('.ev-tl-mark[data-obid="' + newId + '"]');
    await expect(mark).toHaveCount(1);

    // Its mark is keyboard reachable and jumps to the card.
    await mark.focus();
    await expect(panel.locator('#ev-tl-tip')).toContainText('Explained her poster');
    await page.keyboard.press('Enter');
    await expect(first).toHaveClass(/ev-card-hit/);

    // Delete, Undo, then delete for good.
    await first.locator('.obs-card-delete').click();
    await expect(panel.locator('#ev-list .obs-card[data-obid="' + newId + '"]')).toHaveCount(0);
    await expect(mark).toHaveCount(0);
    await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
    await expect(panel.locator('#ev-list .obs-card[data-obid="' + newId + '"]')).toHaveCount(1);
    expect((await meiObs(page)).some(o => o.id === newId)).toBe(true);

    await panel.locator('#ev-list .obs-card[data-obid="' + newId + '"] .obs-card-delete').click();
    await expect(panel.getByRole('tab', { name: /^All/ })).toHaveText('All ' + start);
    await expect.poll(async () => (await meiObs(page)).some(o => o.id === newId), { timeout: 10_000 }).toBe(false);
  });

  test('the dashboard card shows type dots and days since the last observation', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/teacher/app.html#/dashboard?course=sci8');
    const line = page.locator('.dash-card[data-sid="st23"] .dash-card-obs');
    await expect(line.locator('.dash-obs-dot')).toHaveCount(3);
    const when = line.locator('.dash-obs-when');
    await expect(when).toHaveText(/^Last observed (today|yesterday|\d+ days ago)$/);
    const days = Number(((await when.textContent()).match(/(\d+) days/) || [0, 0])[1]);
    // Amber from three weeks, as the dashboard's overdue list.
    if (days >= 21) await expect(when).toHaveClass(/is-overdue/);
    else await expect(when).not.toHaveClass(/is-overdue/);
    await expect(line.locator('.dash-obs-count')).toHaveText(/^· \d+ (this term|in all)$/);
  });
});
