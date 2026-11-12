import { test, expect } from '@playwright/test';

/* The grader dialog's competency levels (Nov 2 mockup): hovering, focusing
   or (on a touch screen) holding a level shows its three lines in a bar over
   the dialog's foot; the dialog keeps its size, and a hold doesn't pick the
   level. Demo Mode, Cece on Science 8's Immune System Quick Check: Drawing
   Conclusions (PA5) and Sharing Findings (CM1), both from the curriculum
   bank. */
test.use({ viewport: { width: 1440, height: 900 } });

async function open(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  // The demo class seeds after the curriculum bank loads.
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => saveDashboardPrefs({ closedModules: { sci8: [] } })); // these checks want every unit folder open
  await page.evaluate(() => window.Router.navigate('/assignments'));
  await page.locator('#ac-sci8a2').waitFor();
  await page.evaluate(() => PageAssignments.openGrader('sci8', 'sci8a2', 'st1'));
  const dlg = page.locator('.grader-dialog');
  await dlg.waitFor();
  return dlg;
}

test('hovering a level shows its lines over the foot, and the dialog keeps its size', async ({ page }) => {
  const dlg = await open(page);
  const level = dlg.locator('.grdl-card[data-tag="PA5"] .grdl-level[data-level="2"]');
  const before = await dlg.boundingBox();
  await level.hover();
  const bar = dlg.locator('.grdl-wording-bar');
  await expect(bar).toBeVisible();
  await expect(bar).toContainText('Developing: Draws conclusions using science concepts with growing consistency.');
  await expect(bar).toContainText('Proficient means: I can');
  await expect(bar).toContainText('Next step:');
  expect(await dlg.boundingBox()).toEqual(before);
  // Above the foot, inside the dialog.
  const b = await bar.boundingBox();
  const foot = await dlg.locator('.grader-foot').boundingBox();
  expect(b.y + b.height).toBeLessThanOrEqual(foot.y);
  await dlg.locator('.grader-toolbar').hover();
  await expect(bar).toBeHidden();
});

test('a level reached with Tab shows its lines', async ({ page }) => {
  const dlg = await open(page);
  await dlg.locator('.grdl-card[data-tag="CM1"] .grdl-level[data-level="1"]').focus();
  await expect(dlg.locator('.grdl-wording-bar')).toContainText('Emerging:');
});

test('holding a level on a touch screen shows its lines and doesn’t pick it', async ({ page }) => {
  const dlg = await open(page);
  const level = dlg.locator('.grdl-card[data-tag="PA5"] .grdl-level[data-level="1"]');
  await expect(level).toHaveAttribute('aria-pressed', 'false');
  await level.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
  await page.waitForTimeout(600);
  const bar = dlg.locator('.grdl-wording-bar');
  await expect(bar).toContainText('Emerging:');
  await level.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
  await level.dispatchEvent('click', { bubbles: true });
  await expect(bar).toBeHidden();
  await expect(dlg.locator('.grdl-card[data-tag="PA5"] .grdl-level[data-level="1"]')).toHaveAttribute(
    'aria-pressed',
    'false',
  );
  // A quick tap still picks it.
  await level.dispatchEvent('pointerdown', { pointerType: 'touch', bubbles: true });
  await level.dispatchEvent('pointerup', { pointerType: 'touch', bubbles: true });
  await level.dispatchEvent('click', { bubbles: true });
  await expect(dlg.locator('.grdl-card[data-tag="PA5"] .grdl-level[data-level="1"]')).toHaveAttribute(
    'aria-pressed',
    'true',
  );
});

test('the lines go when the grader moves to another student', async ({ page }) => {
  const dlg = await open(page);
  await dlg.locator('.grdl-card[data-tag="PA5"] .grdl-level[data-level="2"]').focus();
  const bar = dlg.locator('.grdl-wording-bar');
  await expect(bar).toBeVisible();
  await page.evaluate(() => PageAssignments.openGrader('sci8', 'sci8a2', 'st2'));
  await expect(page.locator('.grader-dialog .grdl-wording-bar:visible')).toHaveCount(0);
});
