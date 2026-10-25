import { test, expect } from '@playwright/test';

/* The evidence drawer on a student page competency card (docs/DECISIONS.md,
   "Observations (2026-10-18)", item 5): one dated list of the competency's
   scores and linked observations, a line on how the level is worked out,
   and Add observation with the competency filled in. The level an
   observation carries is evidence only, so the badges do not move. Runs in
   Demo Mode on Mei Wong (st23) in Science 8. */

async function enterDemo(page) {
  await page.goto('/login.html');
  await page.locator('#demo-mode-btn').click();
  await page.waitForURL(/teacher\/app\.html/);
}

async function meiObs(page) {
  return page.evaluate(() => JSON.parse(localStorage.getItem('gb-quick-obs-sci8') || '{}').st23 || []);
}

test.describe('Competency card evidence drawer', () => {
  test('lists scores, adds a linked observation with a level, and leaves the levels alone', async ({ page }) => {
    await enterDemo(page);
    await page.goto('/teacher/app.html#/student?id=st23&course=sci8');

    // The first competency row with scores (the Competencies tab opens first).
    const card = page
      .locator('.stu-comp')
      .filter({ has: page.locator('.dash-tag-evidence', { hasText: /score/ }) })
      .first();
    const row = card.locator('.dash-tag-row');
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    const countText = (await row.locator('.dash-tag-evidence').textContent()).trim();
    const m = countText.match(/^(\d+) scores? · (\d+) observations?$/);
    expect(m, countText).not.toBeNull();
    const scores = Number(m[1]);
    const linked = Number(m[2]);
    expect(scores).toBeGreaterThan(0);
    const tagId = await row.getAttribute('data-tagid');
    const levelBadge = await row.locator('.stu-level').textContent();
    const collapsed = (await card.boundingBox()).height;

    // Expand: the explanation line, then the scores.
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    const drawer = card.locator('.ced');
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('.ced-explain')).toHaveText(/^Competency level: .+\.$/);
    await expect(drawer.locator('.ced-list a.tag-assess-row')).toHaveCount(scores);
    await expect(drawer.locator('.ced-obs-row')).toHaveCount(linked);

    // Add an observation from the drawer, linked to this competency, looks Extending.
    await drawer.getByRole('button', { name: 'Add observation' }).click();
    const strip = drawer.locator('.ced-capture .obsc');
    await expect(strip).toBeVisible();
    await expect(strip).toContainText('Competency: ');
    await strip.locator('#ced-level-btn').click();
    await strip.locator('[data-obsc="setLevel"][data-value="4"]').click();
    await expect(strip.locator('#ced-level-btn')).toHaveText('Level: looks Extending');
    const text = 'Designed her own fair test for the pendulum';
    await strip.locator('textarea').fill(text);
    await page.keyboard.press('Enter');

    // In the drawer, newest first, with its level.
    const obsRow = drawer.locator('.ced-obs-row').first();
    await expect(obsRow).toContainText(text);
    await expect(obsRow.locator('.obsc-pill-level')).toHaveText('Looks Extending');
    await expect(drawer.locator('.ced-list .ced-item').first()).toContainText(text);
    await expect(row.locator('.dash-tag-evidence')).toHaveText(
      scores +
        (scores === 1 ? ' score' : ' scores') +
        ' · ' +
        (linked + 1) +
        (linked === 0 ? ' observation' : ' observations'),
    );

    // Saved with the competency and the level.
    const saved = (await meiObs(page)).find(o => o.text === text);
    expect(saved).toMatchObject({ competencyId: tagId, level: 4 });

    // The drawer row opens it in the Observations tab.
    await obsRow.click();
    await expect(page.locator('#stu-tab-evidence')).toHaveAttribute('aria-selected', 'true');
    const panelCard = page.locator('#ev-list .obs-card[data-obid="' + saved.id + '"]');
    await expect(panelCard).toHaveClass(/ev-card-hit/);
    await expect(panelCard).toContainText(text);
    await expect(panelCard.locator('.obsc-pill-level')).toHaveText('Looks Extending');
    await expect(page.locator('.ev-tl-mark[data-obid="' + saved.id + '"]')).toHaveCount(1);

    // Evidence only: the level badge did not move. The drawer is still open.
    await page.locator('#stu-tab-comps').click();
    await expect(row).toHaveAttribute('aria-expanded', 'true');
    await expect(row.locator('.stu-level')).toHaveText(levelBadge);

    // Leaving the tab closed the strip; collapsing returns the card to its height.
    await expect(strip).toHaveCount(0);
    await expect(drawer.getByRole('button', { name: 'Add observation' })).toBeVisible();
    await row.click();
    await expect(row).toHaveAttribute('aria-expanded', 'false');
    expect((await card.boundingBox()).height).toBeCloseTo(collapsed, 0);
  });
});
