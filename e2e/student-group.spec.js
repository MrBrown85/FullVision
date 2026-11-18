import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* The student's group card (S12-F1), in Demo Mode with a piece sent as One
   per Group (#demo-card-group), against the built site with the live
   site's CSP: counts only, and Add a Page opens Check and Send. Nothing
   leaves the browser. */

for (const [where, device] of [
  ['on a phone', PHONE],
  ['on a Chromebook', CHROMEBOOK],
]) {
  test.describe(where, () => {
    test.use(device);

    test('a group-mate sent it: Sent, Group, the counts, Add a Page', async ({ page }) => {
      const posts = [];
      page.on('request', req => {
        if (/functions\/v1\//.test(req.url())) posts.push(req.url());
      });
      const errors = [];
      page.on('pageerror', e => errors.push(String(e)));
      await page.goto('/s/#demo-card-group');
      await page.getByRole('button', { name: 'Continue' }).click();
      await page.getByLabel('Student Number').fill('1234567');
      await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
      // The sample class has bulletins, so the page opens on them (B1g); Assignments is the next tab.
      await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
      // Sent by a group-mate: not on Assignments, the first row of My Learning's Your Work.
      await expect(page.locator('.sp-piece', { hasText: 'Cell Model Project' })).toHaveCount(0);
      await page.getByRole('button', { name: /^My Learning/ }).click();
      const row = page.locator('.sp-ml-work .sp-ml-row').first();
      await expect(row).toContainText('Cell Model Project');
      await expect(row.locator('.sp-row-sub')).toHaveText(
        /^Sent \w{3} \d{1,2}(, \d{1,2}:\d\d [ap]\.m\.)? · waiting for feedback$/,
      );
      await row.click();
      // Its card, on My Learning: on a phone with the way back; on a Chromebook beside My Learning's list.
      if (where === 'on a phone') await expect(page.locator('.sp-fb-back')).toHaveText('My Learning');
      else
        await expect(page.locator('.sp-side-row', { hasText: 'Cell Model Project' })).toHaveAttribute(
          'aria-pressed',
          'true',
        );
      const card = page.locator('.sp-piece', { hasText: 'Cell Model Project' });
      await expect(card.getByText('Group', { exact: true })).toBeVisible();
      await expect(card.getByText('3 in your group. Someone in your group sent it.')).toBeVisible();
      await fits(page);
      await named(page);
      await contrast(page);
      await card.getByRole('button', { name: 'Add a Page' }).click();
      await expect(page.getByRole('heading', { name: 'Check and Send' })).toBeVisible();
      expect(posts).toEqual([]);
      expect(errors).toEqual([]);
    });
  });
}
