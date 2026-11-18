import { test, expect } from '@playwright/test';
import { PHONE, CHROMEBOOK, fits, named, contrast } from './student-card-fake.js';

/* Reflect (S4-F4; the Questionnaires tab until 2026-11-14), in Demo
   Mode, against the built site with the live site's CSP. Demo Mode lists
   sample questionnaires and opens them on the slip's own screens; nothing
   is sent. Phone reports are not on the card's page any more.
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
  // The sample class has bulletins, so the page opens on them (B1g); Assignments is the next tab.
  await page.locator('.sp-tab[data-tab="assignments"]').locator('visible=true').first().click();
  await expect(page.getByRole('button', { name: 'Outstanding 2' })).toBeVisible();
  return posts;
}

for (const size of [
  { tag: 'phone', use: PHONE },
  { tag: 'chromebook', use: CHROMEBOOK },
]) {
  test.describe('on a ' + size.tag, () => {
    test.use(size.use);

    test('Reflect: Start opens the questions, and the page is one press away', async ({ page }) => {
      const posts = await demo(page);
      const tabs = page.locator(size.tag === 'phone' ? '.sp-tabs-bottom' : '.sp-tabs-top');
      // Four tabs, Bulletins first (B1g): no Reports.
      await expect(tabs.locator('.sp-tab-label')).toHaveText(['Bulletins', 'Assignments', 'My Learning', 'Reflect']);
      await tabs.getByRole('button', { name: 'Reflect' }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Reflect' })).toBeVisible();
      await expect(
        page.getByRole('heading', { level: 2, name: 'November Reflection' }).locator('visible=true'),
      ).toBeVisible();
      await expect(page.getByRole('button', { name: 'See Your Report' })).toHaveCount(0);
      await fits(page);
      await named(page);
      await contrast(page);
      await picture(page, size.tag + '-reflections');
      await page.getByRole('button', { name: 'Start' }).locator('visible=true').first().click();
      await expect(page.locator('.sp-main')).toBeVisible();
      await picture(page, size.tag + '-questionnaire-open');
      await page.getByRole('button', { name: 'Back', exact: true }).click();
      await expect(page.getByRole('heading', { level: 1, name: 'Reflect' })).toBeFocused();
      expect(posts).toEqual([]);
    });
  });
}
