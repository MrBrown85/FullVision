import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* What Changed Since You Last Looked (S4-F5), in Demo Mode, against the
   built site with the live site's CSP: the count on Assignments, the line
   over All Assignments with its New filter, and Updated on a changed grade.
   Nothing is sent. Set S4_SHOTS to a folder to save pictures (light). */

const SHOTS = process.env.S4_SHOTS || '';
async function picture(page, name) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${SHOTS}/S4-F5-${name}.png`, fullPage: true });
}

async function demo(page) {
  const posts = [];
  page.on('request', req => {
    if (/functions\/v1\//.test(req.url())) posts.push(req.url());
  });
  await page.goto('/s/#demo-card');
  await page.getByRole('button', { name: 'Continue' }).click();
  await page.getByLabel('Student Number').fill('1234567');
  await page.getByRole('button', { name: 'Yes, That’s Me' }).click();
  await expect(page.getByRole('button', { name: 'To Do 3' })).toBeVisible();
  return posts;
}

for (const size of [
  { tag: 'phone', use: PHONE },
  { tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('on a ' + size.tag, () => {
    test.use(size.use);

    test('the count on Assignments, N Things Since You Last Looked, New, and Updated', async ({ page }) => {
      const posts = await demo(page);
      const tabs = page.locator(size.tag === 'phone' ? '.sp-tabs-bottom' : '.sp-tabs-top');
      await expect(tabs.getByRole('button', { name: 'Assignments 6 new' })).toBeVisible();
      await expect(tabs.locator('.sp-tab-badge')).toHaveText('6');
      await page.getByRole('button', { name: 'All assignments' }).click();
      await expect(page.getByText('6 Things Since You Last Looked')).toBeVisible();
      await page.getByRole('button', { name: 'New 6' }).click();
      await expect(page.locator('.sp-row')).toHaveCount(6);
      await fits(page);
      await named(page);
      await contrast(page);
      await picture(page, size.tag + '-all-new');
      await page.getByRole('button', { name: /Lab Safety Contract/ }).click();
      await expect(page.locator('.sp-piece.sp-picked .sp-flag').first()).toHaveText(/^Updated \S+ \d+$/);
      await fits(page);
      await contrast(page);
      await picture(page, size.tag + '-updated-card');
      expect(posts).toEqual([]);
    });
  });
}
