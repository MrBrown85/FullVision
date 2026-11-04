import { test, expect } from '@playwright/test';

/* The student page's Observations tab (Nov 3 sweep, step 4), in Demo
   Mode on Mei Wong (st23) in Science 8. */

test.use({ viewport: { width: 1440, height: 900 } });

async function openObservations(page) {
  await page.goto('/login.html?demo=1');
  await page.waitForURL(/\/dashboard/, { timeout: 15000 });
  await page.waitForFunction(() => getAssessments('sci8').length > 0);
  await page.evaluate(() => window.Router.navigate('/student?id=st23&course=sci8&tab=evidence'));
  await page.locator('#ev-panel').waitFor();
  return page.locator('#ev-panel');
}

const tileCount = async page => {
  const t = await page.locator('#stu-tab-evidence .stu-tab-stat').textContent();
  return Number(t.split(' ')[0]);
};

test('the Observations tile counts an add, a delete and an Undo at once', async ({ page }) => {
  const panel = await openObservations(page);
  const start = await tileCount(page);
  const input = panel.locator('#note-capture-input');
  await input.click();
  await input.fill('Explained her poster to a visitor');
  await page.keyboard.press('Enter');
  await expect.poll(() => tileCount(page)).toBe(start + 1);

  await panel.locator('#ev-list .obs-card').first().hover();
  await panel.locator('#ev-list .obs-card').first().locator('.obs-card-delete').click();
  await expect.poll(() => tileCount(page)).toBe(start);
  await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
  await expect.poll(() => tileCount(page)).toBe(start + 1);
});

test('Flag after a Concern shows on the roster at once, with an Undo', async ({ page }) => {
  const panel = await openObservations(page);
  await page.evaluate(() => {
    const f = getFlags('sci8');
    delete f.st23;
    saveFlags('sci8', f);
  });
  const row = page.locator('#gb-roster-list .student-row[data-sid="st23"]');
  await panel.locator('[data-obsc="type"][data-value="concern"]').click();
  await panel.locator('#note-capture-input').fill('Did not start the lab');
  await page.keyboard.press('Enter');
  await panel.locator('[data-obsc="flag"]').click();
  await expect(row).toContainText('⚑');
  await expect(page.locator('#undo-toast')).toContainText('flagged');
  await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
  await expect(row).not.toContainText('⚑');
  expect(await page.evaluate(() => !!getFlags('sci8').st23)).toBe(false);
});

test('the capture box stays where it is when the first observation is added', async ({ page }) => {
  const panel = await openObservations(page);
  // Mei with no observations yet.
  await page.evaluate(() => {
    getStudentQuickObs('sci8', 'st23').forEach(o => deleteQuickOb('sci8', 'st23', o.id));
    window.PageStudent.render();
  });
  await expect(panel.locator('#ev-list .obs-card')).toHaveCount(0);
  const input = panel.locator('#note-capture-input');
  const before = await input.boundingBox();
  await input.click();
  await input.fill('First observation of the term');
  await page.keyboard.press('Enter');
  await expect(panel.locator('#ev-list .obs-card')).toHaveCount(1);
  const after = await input.boundingBox();
  expect(Math.abs(after.y - before.y)).toBeLessThanOrEqual(2);
});

test('a card opens the edit window to fix a typo, and its Delete has Undo', async ({ page }) => {
  const panel = await openObservations(page);
  const card = panel.locator('#ev-list .obs-card').first();
  const obId = await card.getAttribute('data-obid');
  await card.locator('.obs-card-text').click();
  const editor = page.locator('#obs-focus-card');
  await expect(editor).toBeVisible();
  await expect(page.locator('#focus-textarea')).toBeFocused();
  await page.locator('#focus-textarea').fill('Fixed the typo here');
  await page.keyboard.press('Enter');
  await expect(editor).toHaveCount(0);
  await expect(panel.locator('#ev-list .obs-card[data-obid="' + obId + '"] .obs-card-text')).toHaveText(
    'Fixed the typo here',
  );
  expect(await page.evaluate(id => getStudentQuickObs('sci8', 'st23').find(o => o.id === id).text, obId)).toBe(
    'Fixed the typo here',
  );

  // Keyboard: Enter on a focused card opens it; Delete hides it with Undo.
  await panel.locator('#ev-list .obs-card[data-obid="' + obId + '"]').focus();
  await page.keyboard.press('Enter');
  await expect(editor).toBeVisible();
  await page.locator('#obs-focus-card [data-action="focusDelete"]').click();
  await expect(panel.locator('#ev-list .obs-card[data-obid="' + obId + '"]')).toHaveCount(0);
  await page.locator('#undo-toast').getByRole('button', { name: 'Undo' }).click();
  await expect(panel.locator('#ev-list .obs-card[data-obid="' + obId + '"]')).toHaveCount(1);
});
