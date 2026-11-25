/**
 * The Assignments page's List view (teacher/assign-list.js; Colin, Nov 16).
 * Demo Mode, Science 8, at 1366 x 900: Grade | Bulk Edit on the toolbar, one row
 * per assessment that fits the window, ticked rows changed together with
 * Undo, Keep This Order after a sort, a row dragged by its handle, and Open.
 */
import { test, expect } from '@playwright/test';
import { demoStudentPageOff } from './demo-student-page-off.js';
import { clickToolbarItem } from './helpers.js';

test.beforeEach(({ page }) => demoStudentPageOff(page));

test.use({ viewport: { width: 1366, height: 900 } });

const SHOTS = process.env.FV_SHOTS || '';
const shot = (page, name) => (SHOTS ? page.screenshot({ path: SHOTS + '/' + name + '.png' }) : null);

const titles = page => page.locator('tr[data-alv-row] .alv-title').evaluateAll(els => els.map(el => el.value));
const pieces = (page, ids) =>
  page.evaluate(ids => {
    const cid = getActiveCourse();
    return ids.map(id => getAssessments(cid).find(a => a.id === id));
  }, ids);

test('List: change many rows at once, sort and keep the order, drag a row, open one; grade changes ask first', async ({
  page,
}) => {
  const errors = [];
  page.on('pageerror', e => errors.push(String(e)));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => {
    var cid = typeof getActiveCourse === 'function' && getActiveCourse();
    return !!cid && getAssessments(cid).length > 0;
  });
  const total = await page.evaluate(() => getAssessments(getActiveCourse()).length);

  await page.goto('/assignments');
  await clickToolbarItem(page, 'more', '[data-alv-view="list"]');
  await expect(page.locator('tr[data-alv-row]')).toHaveCount(total);
  // In Bulk Edit the ⋯ menu holds Rubrics alone, and Done Editing goes back.
  await expect(page.locator('.atb-end > [data-alv-view="cards"]')).toHaveText('Done Editing');
  await expect(page.locator('.atb-more-wrap .assess-menu-item')).toHaveText(['Rubrics']);
  await expect(page.locator('.alv-count')).toHaveText(total + ' of ' + total);
  // The rows fit the page beside the class list: no sideways scroll.
  const fits = await page.locator('.alv-scroll').evaluate(el => el.scrollWidth <= el.clientWidth + 1);
  expect(fits).toBe(true);
  await shot(page, 'list');

  // Tick the second row, Shift-tick the fourth: three rows.
  const ids = await page.locator('tr[data-alv-row]').evaluateAll(els => els.map(el => el.dataset.alvRow));
  await page.locator('tr[data-alv-row]').nth(1).locator('.alv-tick-col input').check();
  await page
    .locator('tr[data-alv-row]')
    .nth(3)
    .locator('.alv-tick-col input')
    .click({ modifiers: ['Shift'] });
  await expect(page.locator('.alv-bar-n')).toHaveText('3 Selected');
  const before = (await pieces(page, ids.slice(1, 4))).map(a => a.dueDate || a.due_date || null);
  await page.locator('[data-alv-bulk="due"]').fill('2026-12-01');
  await expect(page.locator('.alv-bar-done')).toHaveText('Set Due Date for 3 assessments.');
  expect((await pieces(page, ids.slice(1, 4))).map(a => a.dueDate)).toEqual(['2026-12-01', '2026-12-01', '2026-12-01']);
  await shot(page, 'ticked');
  await page.locator('[data-alv-act="undo"]').click();
  expect((await pieces(page, ids.slice(1, 4))).map(a => a.dueDate || a.due_date || null)).toEqual(before);
  await page.locator('[data-alv-act="clearSel"]').click();
  await expect(page.locator('.alv-bar')).toHaveCount(0);

  // A Factor moves grades: it asks first, and Undo puts it back.
  const first = ids[0];
  const weight = () =>
    page.evaluate(id => getAssessmentWeight(getAssessments(getActiveCourse()).find(a => a.id === id)), first);
  const was = await weight();
  await page.locator('[data-alv-f="' + first + ':up"]').click();
  const dialog = page.locator('.confirm-card');
  await expect(dialog.locator('.confirm-title')).toHaveText('Change the Factor?');
  await expect(dialog.locator('.confirm-message')).toContainText(
    'This changes students\u2019 grades. You can undo it.',
  );
  await shot(page, 'factor-question');
  await page.locator('#confirm-cancel-btn').click();
  expect(await weight()).toBe(was);
  await page.locator('[data-alv-f="' + first + ':up"]').click();
  await page.locator('#confirm-ok-btn').click();
  expect(await weight()).toBe(was + 0.5);
  await expect(page.locator('.alv-undo-bar')).toContainText('Changed the Factor of');
  await page.locator('.alv-undo-bar [data-alv-act="undo"]').click();
  expect(await weight()).toBe(was);
  await expect(page.locator('.alv-bar')).toHaveCount(0);

  // Sorting by Title changes nothing until Keep This Order.
  const sortedTitles = (await titles(page)).slice().sort((a, b) => a.localeCompare(b));
  await page.locator('[data-alv-sort="title"]').click();
  expect(await titles(page)).toEqual(sortedTitles);
  await expect(page.locator('.alv-sort-bar')).toContainText('Sorted by Title.');
  await page.locator('[data-alv-act="keepOrder"]').click();
  await expect(page.locator('.alv-sort-bar')).toHaveCount(0);
  const saved = await page.evaluate(() =>
    getAssessments(getActiveCourse())
      .slice()
      .sort((a, b) => a.display_order - b.display_order)
      .map(a => a.title),
  );
  expect(saved).toEqual(sortedTitles);

  // Drag the first row by its handle onto the top half of the fourth: it lands third.
  const rows = page.locator('tr[data-alv-row]');
  await rows
    .nth(0)
    .locator('.alv-grip')
    .dragTo(rows.nth(3), { targetPosition: { x: 300, y: 3 } });
  expect((await titles(page)).slice(0, 3)).toEqual([sortedTitles[1], sortedTitles[2], sortedTitles[0]]);

  // Open puts the form above the List.
  await rows.nth(0).locator('[data-action="editAssess"]').click();
  await expect(page.locator('#af-title')).toHaveValue(sortedTitles[1]);
  await shot(page, 'open');

  // The form's Save Changes asks before a Factor change too, and offers Undo.
  const openId = await rows.nth(0).getAttribute('data-alv-row');
  const formWeight = () =>
    page.evaluate(id => getAssessmentWeight(getAssessments(getActiveCourse()).find(a => a.id === id)), openId);
  const formWas = await formWeight();
  await page.locator('#af-weight').fill(String(formWas + 1));
  await page.locator('[data-action="saveEditAssess"]').click();
  await expect(page.locator('.confirm-card .confirm-title')).toHaveText('Change the Factor?');
  await shot(page, 'form-question');
  await page.locator('#confirm-ok-btn').click();
  expect(await formWeight()).toBe(formWas + 1);
  await expect(page.locator('#undo-toast')).toContainText('Changed the Factor of');
  await page.locator('#undo-toast .undo-toast-btn').click();
  expect(await formWeight()).toBe(formWas);
  await expect(page.locator('tr[data-alv-row]')).toHaveCount(total);

  // The view is kept: back on the page, the List.
  await page.goto('/dashboard');
  await page.goto('/assignments');
  await expect(page.locator('tr[data-alv-row]')).toHaveCount(total);
  expect(errors).toEqual([]);
});
