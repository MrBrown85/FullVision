import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* Questionnaires and My Reports (S4-F4), in Demo Mode, against the built
   site with the live site's CSP. Demo Mode lists sample questionnaires and
   reports and opens them on the slip's own screens; nothing is sent.
   Set S4_SHOTS to a folder to save a picture of each screen (light). */

const SHOTS = process.env.S4_SHOTS || '';
async function picture(page, name) {
  if (!SHOTS) return;
  await page.emulateMedia({ colorScheme: 'light' });
  await page.screenshot({ path: `${SHOTS}/S4-F4-${name}.png`, fullPage: true });
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

    test('Questionnaires: Start opens the questions, and the page is one press away', async ({ page }) => {
      const posts = await demo(page);
      const tabs = page.locator(size.tag === 'phone' ? '.sp-tabs-bottom' : '.sp-tabs-top');
      await tabs.getByRole('button', { name: 'Questionnaires' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Questionnaires' })).toBeVisible();
      await expect(page.getByRole('heading', { level: 2, name: 'November Reflection' })).toBeVisible();
      await fits(page);
      await named(page);
      await contrast(page);
      await picture(page, size.tag + '-questionnaires');
      await page.getByRole('button', { name: 'Start' }).click();
      await expect(page.locator('.sp-main')).toBeVisible();
      await picture(page, size.tag + '-questionnaire-open');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Questionnaires' })).toBeFocused();
      expect(posts).toEqual([]);
    });

    test('My Reports: the newest with its result, See Your Report, and back', async ({ page }) => {
      const posts = await demo(page);
      const tabs = page.locator(size.tag === 'phone' ? '.sp-tabs-bottom' : '.sp-tabs-top');
      await tabs.getByRole('button', { name: 'Reports' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'My Reports' })).toBeVisible();
      await expect(page.locator('.sp-form-card:visible .sp-flag-new')).toHaveText('New');
      await fits(page);
      await named(page);
      await contrast(page);
      await picture(page, size.tag + '-reports');
      await page.locator('.sp-form-card:visible').getByRole('button', { name: 'See Your Report' }).click();
      await expect(page.locator('.pr-view')).toBeVisible();
      await fits(page);
      await picture(page, size.tag + '-report-open');
      await page.getByRole('button', { name: 'Back to Your Page' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'My Reports' })).toBeFocused();
      expect(posts).toEqual([]);
    });
  });
}
