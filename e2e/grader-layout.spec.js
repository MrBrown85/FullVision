import { test, expect } from '@playwright/test';

/* Grading layout in Demo Mode's Science 8 (sci8a3 plain rubric, sci8a19
   Advanced rubric, sci8a18 single-point, sci8a2 competencies):
   - at 1024px Toggle Sidebar opens the student list over the page;
   - picking a level or hovering one moves nothing;
   - single-point controls stay inside their column;
   - Missing | Excused | Late in one order everywhere;
   - one hover prompt, and the descriptor bar beside the student list. */

async function demo(page, route) {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(r => window.Router.navigate(r), route);
}
async function openCard(page, aid) {
  const card = page.locator('#ac-' + aid);
  await card.waitFor();
  if (!(await card.evaluate(el => el.classList.contains('open')))) await card.locator('.assess-title').click();
  await card.scrollIntoViewIfNeeded();
  return card;
}
async function openDialog(page, aid, sid) {
  await page.locator('#gb-data td.gb-scores-cell[data-aid="' + aid + '"][data-sid="' + sid + '"]').click();
  return page.locator('#grader-overlay .grader-dialog');
}
const box = loc =>
  loc.evaluate(el => {
    const r = el.getBoundingClientRect();
    return {
      top: Math.round(r.top),
      height: Math.round(r.height),
      left: Math.round(r.left),
      right: Math.round(r.right),
    };
  });

test('at 1024px Toggle Sidebar opens the student list over the page', async ({ page }) => {
  await demo(page, '/assignments?course=sci8');
  await page.setViewportSize({ width: 1024, height: 768 });
  const sidebar = page.locator('#gb-sidebar');
  const toggle = page.locator('[data-action="toggleSidebar"]').first();
  await expect(sidebar).toBeHidden();
  const mainLeft = (await box(page.locator('.page-main'))).left;

  await toggle.click();
  await expect(sidebar).toBeVisible();
  await expect(toggle).toHaveAttribute('aria-expanded', 'true');
  // Over the page: the page doesn't move.
  expect((await box(page.locator('.page-main'))).left).toBe(mainLeft);
  await page.keyboard.press('Escape');
  await expect(sidebar).toBeHidden();

  await toggle.click();
  await page.mouse.click(900, 600);
  await expect(sidebar).toBeHidden();

  // Picking a student opens focus grading and closes the list.
  await toggle.click();
  await page.locator('#gb-roster-list .student-row[data-sid="st2"]').click();
  await expect(sidebar).toBeHidden();
  await expect(page.locator('.focus-banner')).toContainText('Noor');

  // Wide again: the sidebar is back beside the page.
  await page.setViewportSize({ width: 1440, height: 900 });
  await expect(sidebar).toBeVisible();
});

test('picking or hovering a rubric level moves nothing', async ({ page }) => {
  await demo(page, '/gradebook?course=sci8');
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    for (const aid of ['sci8a3', 'sci8a19']) {
      const dialog = await openDialog(page, aid, 'st3');
      const crits = dialog.locator('.grdt-crit');
      const first = crits.nth(0);
      // Start from no level on the first criterion.
      const chosen = first.locator('.grdt-tile.is-chosen');
      if (await chosen.count()) await chosen.locator('.grdt-chosen-label').click();
      await expect(first.locator('.grdt-tile.is-chosen')).toHaveCount(0);
      const before = [await box(first), await box(crits.nth(1))];
      const tile = first.locator('.grdt-tile[data-level="2"]');
      await tile.hover();
      expect([await box(first), await box(crits.nth(1))]).toEqual(before);
      await tile.click({ position: { x: 20, y: 6 } });
      await expect(first.locator('.grdt-tile.is-chosen')).toHaveCount(1);
      expect([await box(first), await box(crits.nth(1))]).toEqual(before);
      // The chosen tile's − | + stay on the name's line.
      const head = first.locator('.grdt-tile.is-chosen .grdt-tile-head');
      expect((await box(head)).height).toBeLessThanOrEqual(28);
      await dialog.locator('.grader-done').click();
    }
  }
});

test('class view at 1024px: the chosen level keeps its height', async ({ page }) => {
  await demo(page, '/assignments?course=sci8');
  await page.setViewportSize({ width: 1024, height: 900 });
  const card = await openCard(page, 'sci8a2');
  const row = card.locator('.rsg-criterion-row').nth(2);
  await row.scrollIntoViewIfNeeded();
  const level = row.locator('.rsg-level.l1');
  // Start from no level on the row (clicking the chosen level clears it).
  const was = row.locator('.rsg-level.has-mods .rsg-level-name');
  if (await was.count()) await was.click();
  await expect(row.locator('.rsg-level.has-mods')).toHaveCount(0);
  const before = await box(row);
  const plain = (await box(row.locator('.rsg-level.l3'))).height;
  await level.hover();
  expect(await box(row)).toEqual(before);
  await level.click();
  await expect(row.locator('.rsg-level.has-mods')).toHaveCount(1);
  expect(await box(row)).toEqual(before);
  const chosen = row.locator('.rsg-level.has-mods');
  expect((await box(chosen)).height).toBe(plain);
  // Name and − | + on one line.
  const name = await box(chosen.locator('.rsg-level-name'));
  const mods = await box(chosen.locator('.rsg-mods'));
  expect(Math.abs(name.top + name.height / 2 - (mods.top + mods.height / 2))).toBeLessThanOrEqual(2);
});

test('single-point controls stay in their column at 1024px', async ({ page }) => {
  await demo(page, '/gradebook?course=sci8');
  for (const width of [1440, 1024]) {
    await page.setViewportSize({ width, height: 900 });
    const dialog = await openDialog(page, 'sci8a18', 'st1');
    await expect(dialog.locator('.grsp-legend')).toContainText('Work On');
    await expect(dialog.locator('.grsp-legend')).toContainText('Went Beyond');
    await expect(dialog.locator('.grsp-legend')).not.toContainText('Areas for Growth');
    await expect(dialog.locator('.grsp-legend')).not.toContainText('Going Beyond');
    const crit = dialog.locator('.grsp-crit').first();
    const work = await box(crit.locator('.grsp-note.is-work'));
    const beyond = await box(crit.locator('.grsp-note.is-beyond'));
    for (const sel of ['.grsp-controls .grdl-seg', '.grsp-controls .grdl-stepper, .grsp-controls [role="group"]']) {
      const b = await box(crit.locator(sel).last());
      expect(b.left).toBeGreaterThanOrEqual(work.right);
      expect(b.right).toBeLessThanOrEqual(beyond.left);
    }
    await dialog.locator('.grader-done').click();
  }
});

test('Missing | Excused | Late everywhere; the dialog prints Print Rubrics', async ({ page }) => {
  await demo(page, '/assignments?course=sci8');
  const order = ['Missing', 'Excused', 'Late'];
  const rubric = await openCard(page, 'sci8a3');
  await expect(rubric.locator('.rsg-status').first().locator('.grader-status-btn')).toHaveText(order);
  const pts = await openCard(page, 'sci8q1');
  await expect(pts.locator('.ldg-status').first().locator('.grader-status-btn')).toHaveText(order);
  await page.locator('#gb-roster-list .student-row[data-sid="st1"]').click();
  await expect(page.locator('#ac-sci8a3 .grader-inline .grader-status .grader-status-btn')).toHaveText(order);

  await page.evaluate(() => window.Router.navigate('/gradebook?course=sci8'));
  const dialog = await openDialog(page, 'sci8a19', 'st1');
  await expect(dialog.locator('.grader-status .grader-status-btn')).toHaveText(order);
  await expect(dialog.locator('.grader-print')).toHaveText('Print Rubrics');
  await dialog.locator('.grader-done').click();
  const ptsDialog = await openDialog(page, 'sci8q1', 'st1');
  await expect(ptsDialog.locator('.grader-print')).toHaveText('Print Scores');
});

test('rubric class view: one hover prompt; the bar starts after the student list', async ({ page }) => {
  await demo(page, '/assignments?course=sci8');
  const card = await openCard(page, 'sci8a3');
  await expect(card.locator('.rsg-header-hint')).toHaveText('Hover a level to see its wording');
  const bar = page.locator('#rsg-descriptor-bar');
  await expect(bar).toBeHidden();
  await expect(page.getByText('Hover a rubric level to see its descriptor')).toHaveCount(0);
  const level = card.locator('.rsg-criterion-row .rsg-level.l3').first();
  await level.hover();
  await expect(bar).toBeVisible();
  const sidebar = await box(page.locator('#gb-sidebar'));
  expect((await box(bar)).left).toBeGreaterThanOrEqual(sidebar.right);
});
