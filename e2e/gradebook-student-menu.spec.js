/**
 * The menu on a student's name in the Gradebook, and the card on it
 * (teacher/gradebook-student-menu.js, teacher/student-outlook.js), in Demo
 * Mode's sample class: a click opens the menu where it opened the student's
 * page; Mark Missing, Excuse and Clear open a list beside their line; the
 * keyboard reaches every line; and the card stays one width inside the window.
 */
import { test, expect } from '@playwright/test';

test.use({ viewport: { width: 1400, height: 900 } });

test.beforeEach(async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.goto('/gradebook');
  await page.waitForSelector('.gb-scores-cell', { timeout: 10000 });
});

// A student with blank cells (no grade, whatever the dates) in the columns on screen: [row index, how many, id].
const withBlanks = page =>
  page.evaluate(() => {
    const cid = getActiveCourse();
    const shown = [...document.querySelectorAll('#gb-colheads .gb-grid-colhead[data-aid]')].map(h => h.dataset.aid);
    const rows = [...document.querySelectorAll('#gb-rowheads .gb-grid-rowhead-name')].map(n => n.dataset.sid);
    for (let i = 0; i < rows.length; i++) {
      const n = getAssessments(cid).filter(
        a =>
          shown.includes(a.id) &&
          !getAssignmentStatus(cid, rows[i], a.id) &&
          assessmentCellValue(cid, rows[i], a).kind === 'none' &&
          canSetAssignmentStatus(cid, rows[i], a.id, 'NS'),
      ).length;
      if (n > 0) return [i, n, rows[i]];
    }
    return null;
  });
const missingOf = (page, sid) =>
  page.evaluate(
    s =>
      Object.entries(getAssignmentStatuses(getActiveCourse())).filter(([k, v]) => k.startsWith(s + ':') && v === 'NS')
        .length,
    sid,
  );

test('a click on a name opens its menu, and a list marks the row with Undo', async ({ page }) => {
  // Every piece due at the end of the term, as in the class where "due by today" marked only one.
  await page.evaluate(() => {
    const cid = getActiveCourse();
    const list = getAssessments(cid);
    list.forEach(a => (a.dueDate = '2099-01-31'));
    saveAssessments(cid, list);
    PageGradebook.render();
  });
  const [row, blanks, sid] = await withBlanks(page);
  const name = page.locator('#gb-rowheads .gb-grid-rowhead-name').nth(row);
  const before = await missingOf(page, sid);
  await name.click();
  const menu = page.locator('.gb-ctx-menu');
  await expect(menu).toBeVisible();
  await expect(page).toHaveURL(/\/gradebook/);
  // The card stays away while the menu is open.
  await name.hover();
  await page.waitForTimeout(600);
  await expect(page.locator('#gb-tooltip')).toBeHidden();

  // Mark Missing's list opens beside its line, inside the window.
  const list = page.locator('.gb-ctx-sub[data-sub="missing"]');
  await expect(list).toBeHidden();
  await menu.locator('[data-ctx="sub:missing"]').hover();
  await expect(list).toBeVisible();
  const [m, l] = await page.evaluate(() =>
    ['.gb-ctx-menu', '.gb-ctx-sub[data-sub="missing"]'].map(s =>
      document.querySelector(s).getBoundingClientRect().toJSON(),
    ),
  );
  expect(l.left).toBeGreaterThanOrEqual(m.right - 6);
  expect(l.right).toBeLessThanOrEqual(1400);
  expect(l.bottom).toBeLessThanOrEqual(900);
  // Another line's list takes its place; a line with no list closes it.
  await menu.locator('[data-ctx="sub:excuse"]').hover();
  await expect(list).toBeHidden();
  await expect(page.locator('.gb-ctx-sub[data-sub="excuse"]')).toBeVisible();
  await menu.locator('[data-ctx="observe"]').hover();
  await expect(page.locator('.gb-ctx-sub[data-sub="excuse"]')).toBeHidden();

  await menu.locator('[data-ctx="sub:missing"]').hover();
  const all = list.locator('.gb-ctx-item').first();
  await expect(all).toHaveText(new RegExp('All Blank Cells\\s*' + blanks));
  await all.click();
  await expect(menu).toHaveCount(0);
  expect(await missingOf(page, sid)).toBe(before + blanks);
  await expect(page.locator('#undo-toast')).toContainText(
    blanks === 1 ? '1 blank cell marked Missing' : blanks + ' blank cells marked Missing',
  );
  await page.locator('#undo-toast [data-action="executeUndo"]').click();
  expect(await missingOf(page, sid)).toBe(before);
});

test('the keyboard opens the menu, moves through it and its lists, and gives the name its focus back', async ({
  page,
}) => {
  const name = page.locator('#gb-rowheads .gb-grid-rowhead-name').nth(1);
  await name.focus();
  await page.keyboard.press('Enter');
  const menu = page.locator('.gb-ctx-menu');
  await expect(menu.locator('[data-ctx="openStudent"]')).toBeFocused();
  await page.keyboard.press('ArrowDown');
  await expect(menu.locator('[data-ctx="showOnly"]')).toBeFocused();
  await page.keyboard.press('End');
  await expect(menu.locator('[data-ctx="sub:clear"]')).toBeFocused();
  // → opens the list on its first line that can be picked; ← goes back to the line.
  await page.keyboard.press('ArrowUp');
  await expect(menu.locator('[data-ctx="sub:excuse"]')).toBeFocused();
  await page.keyboard.press('ArrowRight');
  const list = page.locator('.gb-ctx-sub[data-sub="excuse"]');
  await expect(list).toBeVisible();
  await expect(list.locator('.gb-ctx-item:not(.is-disabled)').first()).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(list).toBeHidden();
  await expect(menu.locator('[data-ctx="sub:excuse"]')).toBeFocused();
  // Escape in a list closes the list; Escape again closes the menu.
  await page.keyboard.press('Enter');
  await expect(list).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(list).toBeHidden();
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toHaveCount(0);
  await expect(name).toBeFocused();
});

test('the card on a name is one width, inside the window, and shows no competencies', async ({ page }) => {
  const names = page.locator('#gb-rowheads .gb-grid-rowhead-name');
  const count = await names.count();
  for (const i of [0, count - 1]) {
    await page.mouse.move(900, 450);
    await names.nth(i).hover();
    const tip = page.locator('#gb-tooltip.gb-tip-student');
    await expect(tip).toBeVisible();
    const box = await tip.boundingBox();
    expect(Math.round(box.width)).toBe(296);
    expect(box.y).toBeGreaterThanOrEqual(0);
    expect(box.y + box.height).toBeLessThanOrEqual(900);
    await expect(tip).not.toContainText('Competencies');
    // The sample class has categories: a bar each.
    expect(await tip.locator('.gb-card-seg').count()).toBeGreaterThan(0);
  }
});
