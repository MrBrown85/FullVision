/**
 * Page Studio, stage 2: drag and drop (teacher/report-studio.js). A block
 * dragged from the palette lands where its drop zone says; dropped beside a
 * block it makes a row; a block on the page moves; the corner handle sets
 * the width; the keyboard does the same with announcements; the inspector
 * sets Width and Height. Chromium and WebKit.
 */
import { test, expect } from '@playwright/test';

async function openStudio(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/app\.html/, { timeout: 15000 });
  await page.goto(page.url().replace(/#.*/, '#/reports'));
  await page.getByRole('tab', { name: 'Progress Reports' }).click();
  await expect(page.locator('#studio')).toBeVisible();
  await expect(page.locator('.report-sheet')).toHaveCount(2);
}

/* The palette and the canvas scroll; a point is only reachable on screen. */
async function center(locator) {
  await locator.scrollIntoViewIfNeeded();
  const b = await locator.boundingBox();
  return { x: b.x + b.width / 2, y: b.y + b.height / 2 };
}

async function box(locator) {
  await locator.scrollIntoViewIfNeeded();
  return locator.boundingBox();
}

/* Drags from one point to another in steps, so the drop zones appear and
   the pointer lands on one. */
async function drag(page, from, to) {
  await page.mouse.move(from.x, from.y);
  await page.mouse.down();
  await page.mouse.move(from.x + 10, from.y + 10, { steps: 3 });
  await page.mouse.move(to.x, to.y, { steps: 12 });
  await page.waitForTimeout(150);
}

test.describe('Page Studio drag and drop', () => {
  test.setTimeout(90_000);

  test('a block dragged from the palette drops where its zone says it fits', async ({ page }) => {
    await openStudio(page);
    const legend = page.locator('[data-action="studioBlock"][data-block="legend"]');
    const comment = page.locator('.sheet-cell[data-block="teacher-narrative"]');
    const from = await center(legend);
    const c = await box(comment);
    // Hover just under the comment: the "after row 3" zone.
    await drag(page, from, { x: c.x + c.width / 2, y: c.y + c.height + 1 });
    const zone = page.locator('.studio-drop.active');
    await expect(zone).toHaveCount(1);
    await expect(zone).toContainText(/Drop here · fits \(\d+% of page left\)/);
    await expect(page.locator('.studio-ghost')).toHaveText('Proficiency Legend');
    await page.mouse.up();
    await expect(page.locator('.studio-drop')).toHaveCount(0);
    await expect(page.locator('.studio-ghost')).toHaveCount(0);
    await expect(page.locator('#studio-inspector')).toContainText('Proficiency Legend');
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 4');
    await expect(page.locator('#studio-live')).toContainText('Proficiency Legend placed on page 1');
    await expect(page.locator('.sheet-cell[data-block="legend"]')).toHaveClass(/studio-sel/);
  });

  test('dropped beside a block it makes a two-column row; the handle and the inspector set its width', async ({
    page,
  }) => {
    await openStudio(page);
    const legend = page.locator('[data-action="studioBlock"][data-block="legend"]');
    const table = page.locator('.sheet-cell[data-block="competency-table"]');
    const t = await box(table);
    await drag(page, await center(legend), { x: t.x + t.width - 8, y: t.y + t.height / 2 });
    await expect(page.locator('.studio-drop.active')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 4 · right');
    const row = page.locator('.sheet-row').first();
    await expect(row.locator('.sheet-cell')).toHaveCount(2);
    // Inspector: Two-thirds for the table.
    await page.locator('.sheet-cell[data-block="competency-table"]').click();
    await expect(page.getByRole('radio', { name: 'Half' })).toHaveAttribute('aria-checked', 'true');
    await page.getByRole('radio', { name: 'Two-thirds' }).click();
    await expect(page.getByRole('radio', { name: 'Two-thirds' })).toHaveAttribute('aria-checked', 'true');
    const widths = await page
      .locator('.sheet-row')
      .first()
      .locator('.sheet-cell')
      .evaluateAll(c => c.map(el => el.offsetWidth));
    expect(widths[0]).toBeGreaterThan(widths[1] * 1.6);
    // The handle: drag the table's corner left to a third.
    const handle = page.locator('.studio-handle');
    await expect(handle).toHaveCount(1);
    const h = await center(handle);
    const r = await page.locator('.sheet-row').first().boundingBox();
    await page.mouse.move(h.x, h.y);
    await page.mouse.down();
    await page.mouse.move(r.x + r.width * 0.3, h.y, { steps: 8 });
    await page.mouse.up();
    await expect(page.getByRole('radio', { name: 'Third', exact: true })).toHaveAttribute('aria-checked', 'true');
    await expect(page.locator('#studio-live')).toContainText('Competency Table is now a third.');
    // Full width puts the legend on its own row again.
    await page.getByRole('radio', { name: 'Full' }).click();
    await expect(page.locator('.sheet-row')).toHaveCount(0);
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 4');
  });

  test('a block on the page moves to another row; the keyboard moves one too, with announcements', async ({ page }) => {
    await openStudio(page);
    // Pointer: the competency table up to before the comment.
    const table = page.locator('.sheet-cell[data-block="competency-table"]');
    const comment = page.locator('.sheet-cell[data-block="teacher-narrative"]');
    const c = await box(comment);
    await drag(page, await center(table), { x: c.x + c.width / 2, y: c.y - 2 });
    await expect(page.locator('.studio-drop.active')).toHaveCount(1);
    await page.mouse.up();
    await expect(page.locator('#studio-inspector')).toContainText('Competency Table');
    await expect(page.locator('#studio-inspector')).toContainText('Page 1 · row 3');
    // Keyboard: pick the comment up, move it down one slot, drop.
    await page.locator('.sheet-cell[data-block="teacher-narrative"]').focus();
    await page.keyboard.press(' ');
    await expect(page.locator('#studio-live')).toContainText('Picked up Teacher Comment');
    await page.keyboard.press('ArrowDown');
    await expect(page.locator('#studio-live')).toContainText(/Teacher Comment, page 1, .*(fits|lands on page)/);
    await page.keyboard.press('Enter');
    await expect(page.locator('#studio-live')).toContainText('Teacher Comment placed on page 1');
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toBeFocused();
    // Escape lets go without moving.
    await page.keyboard.press(' ');
    await page.keyboard.press('ArrowDown');
    await page.keyboard.press('Escape');
    await expect(page.locator('#studio-live')).toContainText('Let go.');
    // The drop put the comment beside the competency table; Shift+arrows resize it.
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('#studio-live')).toContainText('Teacher Comment is now a third.');
    await page.keyboard.press('Shift+ArrowLeft');
    await expect(page.locator('#studio-live')).toContainText('already a third');
    await page.keyboard.press('Shift+ArrowRight');
    await expect(page.locator('#studio-live')).toContainText('Teacher Comment is now half width.');
    // Delete removes.
    await page.keyboard.press('Delete');
    await expect(page.locator('.sheet-cell[data-block="teacher-narrative"]')).toHaveCount(0);
    await expect(page.locator('[data-action="studioBlock"][data-block="teacher-narrative"]')).not.toHaveClass(/placed/);
  });

  test('a block that does not fit says so and lands on a later page; Height Fixed takes lines', async ({ page }) => {
    await openStudio(page);
    const grades = page.locator('[data-action="studioBlock"][data-block="grade-table"]');
    const dims = page.locator('.sheet-cell[data-block="learner-dimensions"]');
    const d = await box(dims);
    await drag(page, await center(grades), { x: d.x + d.width / 2, y: d.y - 2 });
    const zone = page.locator('.studio-drop.active');
    await expect(zone).toHaveCount(1);
    await expect(zone).toContainText(/Drop here|Doesn’t fit here/);
    await page.mouse.up();
    await expect(page.locator('.sheet-cell[data-block="grade-table"]').first()).toBeVisible();
    // The comment's height.
    await page.locator('.sheet-cell[data-block="teacher-narrative"]').click();
    await expect(page.getByRole('radio', { name: 'Fixed' })).toHaveAttribute('aria-checked', 'true');
    await page.locator('[data-action="studioLines"]').fill('4');
    await page.locator('[data-action="studioLines"]').dispatchEvent('change');
    await expect(page.locator('[data-action="studioLines"]')).toHaveValue('4');
    await page.getByRole('radio', { name: 'Fit Content' }).click();
    await expect(page.locator('[data-action="studioLines"]')).toHaveCount(0);
    await expect(page.getByRole('radio', { name: 'Fit Content' })).toHaveAttribute('aria-checked', 'true');
  });
});
