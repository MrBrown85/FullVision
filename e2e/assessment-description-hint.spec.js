import { test, expect } from '@playwright/test';

/* S4-W1 follow-up (Colin's ruling 111): the assessment form's Description
   box says "Students see this on their page." only while the class's
   Student Page is on, in Demo Mode as signed in
   (tests/assessment-form-description-hint.test.js holds the HTML). */

const SHOTS = process.env.NIGHT_SHOTS || '';

async function demo(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
}

async function editForm(page, aid) {
  await page.goto('/assignments?course=sci8');
  await page.waitForSelector('#ac-' + aid);
  await page.evaluate(id => document.querySelector(`[data-action="editAssess"][data-aid="${id}"]`).click(), aid);
  await expect(page.locator('#af-desc')).toBeVisible();
}

test('the Description hint shows only while the Student Page is on', async ({ page }) => {
  await page.setViewportSize({ width: 1366, height: 900 });
  await demo(page);
  const aid = await page.evaluate(() => getAssessments('sci8')[0].id);

  await editForm(page, aid);
  await expect(page.locator('#af-desc-hint')).toHaveCount(0);
  await expect(page.locator('.af-card-what')).not.toContainText('Students see this on their page.');

  await page.evaluate(() => setStudentPageSwitch('sci8', true));
  await editForm(page, aid);
  const hint = page.locator('.af-card-what #af-desc-hint');
  await expect(hint).toHaveText('Students see this on their page.');
  await expect(page.locator('#af-desc')).toHaveAttribute('aria-describedby', 'af-desc-hint');
  // Right under the box.
  const [box, line] = await Promise.all([page.locator('#af-desc').boundingBox(), hint.boundingBox()]);
  expect(line.y).toBeGreaterThanOrEqual(box.y + box.height);
  expect(line.y - (box.y + box.height)).toBeLessThan(16);
  if (SHOTS) await page.locator('.af-card-what').screenshot({ path: SHOTS + '/S4-W1-description-hint-1366.png' });

  await page.evaluate(() => setStudentPageSwitch('sci8', false));
  await editForm(page, aid);
  await expect(page.locator('#af-desc-hint')).toHaveCount(0);
});
