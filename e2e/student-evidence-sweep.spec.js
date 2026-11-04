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
